// Merchant-side access to withdrawal requests. Every function takes the
// authenticated shop's ID and includes it in the WHERE clause (IDOR protection).
import type { Prisma, RequestStatus } from "@prisma/client";
import prisma from "../db.server";
import { DONE_STATUSES, OPEN_STATUSES, isRequestStatus } from "../lib/status";
import { startOfTodayRange, zonedMidnightToUtc } from "../lib/timezone";
import { enqueueStatusChangeEmail, processEmailQueue } from "./email.server";
import { effectiveTimezone, type ShopWithSettings } from "./shop.server";

export const PAGE_SIZE = 25;
export const EXPORT_LIMIT = 10_000;

export class RequestNotFoundError extends Error {
  constructor() {
    super("Withdrawal request not found");
  }
}

export interface RequestFilters {
  q?: string;
  status?: RequestStatus;
  from?: string; // yyyy-mm-dd, shop time zone
  to?: string; // yyyy-mm-dd inclusive, shop time zone
  archived: boolean;
  page?: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams, archived: boolean): RequestFilters {
  const status = params.get("status");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const page = Number(params.get("page") ?? "1");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100) || undefined,
    status: isRequestStatus(status) ? status : undefined,
    from: YMD.test(from) ? from : undefined,
    to: YMD.test(to) ? to : undefined,
    archived,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function buildWhere(shopId: string, f: RequestFilters, timeZone: string): Prisma.WithdrawalRequestWhereInput {
  const where: Prisma.WithdrawalRequestWhereInput = {
    shopId,
    archivedAt: f.archived ? { not: null } : null,
  };
  if (f.status) where.status = f.status;
  if (f.from || f.to) {
    where.submittedAt = {
      ...(f.from ? { gte: zonedMidnightToUtc(f.from, timeZone) } : {}),
      ...(f.to ? { lt: zonedMidnightToUtc(nextDay(f.to), timeZone) } : {}),
    };
  }
  if (f.q) {
    // MySQL's default utf8mb4 collation makes `contains` case-insensitive.
    const q = f.q;
    where.OR = [
      { customerEmailNorm: { contains: q.toLowerCase() } },
      { customerName: { contains: q } },
      { orderReference: { contains: q.replace(/^#/, "") } },
      { requestNumber: { contains: q.toUpperCase() } },
    ];
  }
  return where;
}

const listSelect = {
  id: true,
  requestNumber: true,
  customerName: true,
  customerEmail: true,
  orderReference: true,
  orderVerification: true,
  status: true,
  submittedAt: true,
  archivedAt: true,
} satisfies Prisma.WithdrawalRequestSelect;

export async function listRequests(shopId: string, filters: RequestFilters, timeZone: string) {
  const where = buildWhere(shopId, filters, timeZone);
  const page = filters.page ?? 1;
  const [total, rows] = await Promise.all([
    prisma.withdrawalRequest.count({ where }),
    prisma.withdrawalRequest.findMany({
      where,
      select: listSelect,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, rows, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getDashboard(shopId: string, timeZone: string, now = new Date()) {
  const { start, end } = startOfTodayRange(timeZone, now);
  const [open, today, done, recent] = await Promise.all([
    prisma.withdrawalRequest.count({
      where: { shopId, archivedAt: null, status: { in: [...OPEN_STATUSES] } },
    }),
    prisma.withdrawalRequest.count({ where: { shopId, submittedAt: { gte: start, lt: end } } }),
    prisma.withdrawalRequest.count({ where: { shopId, status: { in: [...DONE_STATUSES] } } }),
    prisma.withdrawalRequest.findMany({
      where: { shopId, archivedAt: null },
      select: listSelect,
      orderBy: { submittedAt: "desc" },
      take: 5,
    }),
  ]);
  return { counts: { open, today, done }, recent };
}

export async function getRequestDetail(shopId: string, requestId: string) {
  const request = await prisma.withdrawalRequest.findFirst({
    where: { id: requestId, shopId },
    include: {
      answers: { orderBy: { position: "asc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      emailLogs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, status: true, attempts: true, sentAt: true, lastError: true, createdAt: true },
      },
      formVersion: { select: { version: true } },
    },
  });
  if (!request) throw new RequestNotFoundError();
  return request;
}

async function requireOwned(shopId: string, requestId: string) {
  const request = await prisma.withdrawalRequest.findFirst({
    where: { id: requestId, shopId },
    include: { answers: true },
  });
  if (!request) throw new RequestNotFoundError();
  return request;
}

export async function changeStatus(
  shop: ShopWithSettings,
  requestId: string,
  toStatus: RequestStatus,
  actor: string,
  options: { notifyCustomer: boolean },
): Promise<{ changed: boolean }> {
  const request = await requireOwned(shop.id, requestId);
  if (request.status === toStatus) return { changed: false };

  const emailIds = await prisma.$transaction(async (tx) => {
    // Conditional update guards against concurrent edits of the same request.
    const { count } = await tx.withdrawalRequest.updateMany({
      where: { id: requestId, shopId: shop.id, status: request.status },
      data: { status: toStatus },
    });
    if (count !== 1) throw new Error("The request was changed by someone else. Reload and try again.");
    const history = await tx.requestStatusHistory.create({
      data: {
        shopId: shop.id,
        requestId,
        event: "STATUS_CHANGE",
        fromStatus: request.status,
        toStatus,
        actor,
      },
    });
    if (options.notifyCustomer && shop.settings.sendStatusChangeEmails) {
      const email = await enqueueStatusChangeEmail(tx, {
        shop,
        request: { ...request, status: toStatus },
        timeZone: effectiveTimezone(shop, shop.settings),
        historyId: history.id,
        replyTo: shop.settings.replyToEmail,
      });
      return email ? [email.id] : [];
    }
    return [];
  });
  if (emailIds.length) await processEmailQueue({ ids: emailIds });
  return { changed: true };
}

export async function addNote(shopId: string, requestId: string, body: string, author: string) {
  await requireOwned(shopId, requestId);
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Note cannot be empty." };
  if (text.length > 5000) return { ok: false as const, error: "Note must be at most 5,000 characters." };
  await prisma.internalNote.create({ data: { shopId, requestId, body: text, author } });
  return { ok: true as const };
}

export async function setArchived(shopId: string, requestId: string, archived: boolean, actor: string) {
  const request = await requireOwned(shopId, requestId);
  if (Boolean(request.archivedAt) === archived) return;
  await prisma.$transaction([
    prisma.withdrawalRequest.update({
      where: { id: request.id },
      data: { archivedAt: archived ? new Date() : null },
    }),
    prisma.requestStatusHistory.create({
      data: { shopId, requestId, event: archived ? "ARCHIVED" : "RESTORED", actor },
    }),
  ]);
}

export async function exportRequests(shopId: string, filters: RequestFilters, timeZone: string) {
  return prisma.withdrawalRequest.findMany({
    where: buildWhere(shopId, filters, timeZone),
    orderBy: { submittedAt: "desc" },
    take: EXPORT_LIMIT,
    include: { answers: { orderBy: { position: "asc" } } },
  });
}

/** Retention: deletes archived requests older than `days` (0 disables). */
export async function purgeArchivedRequests(shopId: string, days: number, now = new Date()) {
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const { count } = await prisma.withdrawalRequest.deleteMany({
    where: { shopId, archivedAt: { not: null, lt: cutoff } },
  });
  return count;
}
