// Email templates, transactional outbox and delivery worker.
//
// Emails are written to EmailLog inside the same transaction as the event that
// triggers them, then delivered by processEmailQueue(). Each row has a unique
// (shopId, dedupeKey), so retrying the triggering action never enqueues a
// second copy, and rows are claimed atomically so two workers cannot send the
// same row concurrently.
import type { EmailLog, EmailTemplateKind, Prisma, PrismaClient, RequestStatus } from "@prisma/client";
import prisma from "../db.server";
import {
  DEFAULT_TEMPLATES,
  findUnknownVariables,
  renderHtml,
  renderSubject,
  renderText,
  type TemplateContext,
} from "../lib/email-template";
import { STATUS_LABELS } from "../lib/status";
import { formatDateTime } from "../lib/timezone";
import { getEmailProvider } from "../services/email-provider.server";
import { getEnv } from "../lib/env.server";

type Tx = Prisma.TransactionClient | PrismaClient;

export const MAX_EMAIL_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const STALE_SENDING_MS = 15 * 60 * 1000;

export interface RequestForEmail {
  id: string;
  requestNumber: string;
  customerName: string | null;
  customerEmail: string;
  orderReference: string | null;
  submittedAt: Date;
  status: RequestStatus;
  answers: { label: string; value: unknown; adminOnly: boolean; fieldType: string }[];
}

export interface ShopForEmail {
  id: string;
  shopDomain: string;
  name: string | null;
  contactEmail: string | null;
}

export async function getTemplates(shopId: string) {
  return prisma.emailTemplate.findMany({ where: { shopId }, orderBy: { kind: "asc" } });
}

export type TemplateUpdateResult = { ok: true } | { ok: false; errors: string[] };

export async function updateTemplate(
  shopId: string,
  kind: EmailTemplateKind,
  input: { subject: string; body: string; enabled: boolean },
): Promise<TemplateUpdateResult> {
  const errors: string[] = [];
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n?/g, "\n");
  if (!subject) errors.push("Subject is required.");
  if (subject.length > 250) errors.push("Subject must be at most 250 characters.");
  if (!body.trim()) errors.push("Body is required.");
  if (body.length > 20_000) errors.push("Body must be at most 20,000 characters.");
  const unknown = [...findUnknownVariables(subject), ...findUnknownVariables(body)];
  if (unknown.length) errors.push(`Unknown variables: ${[...new Set(unknown)].map((v) => `{{${v}}}`).join(", ")}`);
  if (errors.length) return { ok: false, errors };

  await prisma.emailTemplate.upsert({
    where: { shopId_kind: { shopId, kind } },
    create: { shopId, kind, subject, body, enabled: input.enabled },
    update: { subject, body, enabled: input.enabled },
  });
  return { ok: true };
}

export async function resetTemplate(shopId: string, kind: EmailTemplateKind) {
  const d = DEFAULT_TEMPLATES[kind];
  await prisma.emailTemplate.update({
    where: { shopId_kind: { shopId, kind } },
    data: { subject: d.subject, body: d.body },
  });
}

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === "yes") return "Yes";
  return String(value ?? "");
}

export function adminRequestUrl(shopDomain: string, requestId: string): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return `https://admin.shopify.com/store/${store}/apps/${apiKey}/app/withdrawals/${requestId}`;
}

export function buildTemplateContext(
  shop: ShopForEmail,
  request: RequestForEmail,
  timeZone: string,
  audience: "customer" | "merchant",
): TemplateContext {
  const answers = request.answers
    .filter((a) => audience === "merchant" || !a.adminOnly)
    .filter((a) => answerText(a.value) !== "")
    .map((a) => `${a.label}: ${answerText(a.value)}`)
    .join("\n");
  return {
    customer_name: request.customerName ?? "",
    customer_email: request.customerEmail,
    order_reference: request.orderReference ?? "",
    request_number: request.requestNumber,
    submitted_at: `${formatDateTime(request.submittedAt, timeZone)} (${timeZone})`,
    shop_name: shop.name ?? shop.shopDomain,
    request_status: STATUS_LABELS[request.status],
    answers,
    admin_url: audience === "merchant" ? adminRequestUrl(shop.shopDomain, request.id) : "",
  };
}

async function enqueue(
  tx: Tx,
  data: {
    shopId: string;
    requestId: string | null;
    kind: string;
    dedupeKey: string;
    to: string[];
    replyTo?: string | null;
    subject: string;
    body: string;
    ctx: TemplateContext;
  },
) {
  if (data.to.length === 0) return null;
  // Upsert on the dedupe key: re-running the same event is a no-op.
  return tx.emailLog.upsert({
    where: { shopId_dedupeKey: { shopId: data.shopId, dedupeKey: data.dedupeKey } },
    create: {
      shopId: data.shopId,
      requestId: data.requestId,
      kind: data.kind,
      dedupeKey: data.dedupeKey,
      toAddress: data.to.join(","),
      replyTo: data.replyTo ?? null,
      subject: renderSubject(data.subject, data.ctx),
      bodyText: renderText(data.body, data.ctx),
      bodyHtml: renderHtml(data.body, data.ctx),
    },
    update: {},
  });
}

/** Enqueues the customer confirmation and merchant notification for a new request. */
export async function enqueueSubmissionEmails(
  tx: Tx,
  input: {
    shop: ShopForEmail;
    request: RequestForEmail;
    timeZone: string;
    merchantRecipients: string[];
    replyTo: string | null;
  },
) {
  const templates = await tx.emailTemplate.findMany({ where: { shopId: input.shop.id } });
  const byKind = (kind: EmailTemplateKind) =>
    templates.find((t) => t.kind === kind) ?? { ...DEFAULT_TEMPLATES[kind], enabled: true };

  const customerTpl = byKind("CUSTOMER_CONFIRMATION");
  if (customerTpl.enabled) {
    await enqueue(tx, {
      shopId: input.shop.id,
      requestId: input.request.id,
      kind: "CUSTOMER_CONFIRMATION",
      dedupeKey: `${input.request.id}:CUSTOMER_CONFIRMATION`,
      to: [input.request.customerEmail],
      replyTo: input.replyTo ?? input.shop.contactEmail,
      subject: customerTpl.subject,
      body: customerTpl.body,
      ctx: buildTemplateContext(input.shop, input.request, input.timeZone, "customer"),
    });
  }
  const merchantTpl = byKind("MERCHANT_NOTIFICATION");
  if (merchantTpl.enabled) {
    await enqueue(tx, {
      shopId: input.shop.id,
      requestId: input.request.id,
      kind: "MERCHANT_NOTIFICATION",
      dedupeKey: `${input.request.id}:MERCHANT_NOTIFICATION`,
      to: input.merchantRecipients,
      replyTo: input.request.customerEmail,
      subject: merchantTpl.subject,
      body: merchantTpl.body,
      ctx: buildTemplateContext(input.shop, input.request, input.timeZone, "merchant"),
    });
  }
}

export async function enqueueStatusChangeEmail(
  tx: Tx,
  input: { shop: ShopForEmail; request: RequestForEmail; timeZone: string; historyId: string; replyTo: string | null },
) {
  const tpl = await tx.emailTemplate.findUnique({
    where: { shopId_kind: { shopId: input.shop.id, kind: "STATUS_CHANGE" } },
  });
  if (!tpl?.enabled) return null;
  return enqueue(tx, {
    shopId: input.shop.id,
    requestId: input.request.id,
    kind: "STATUS_CHANGE",
    dedupeKey: `${input.request.id}:STATUS_CHANGE:${input.historyId}`,
    to: [input.request.customerEmail],
    replyTo: input.replyTo ?? input.shop.contactEmail,
    subject: tpl.subject,
    body: tpl.body,
    ctx: buildTemplateContext(input.shop, input.request, input.timeZone, "customer"),
  });
}

export async function enqueueTestEmail(
  shopId: string,
  input: { kind: EmailTemplateKind; to: string; subject: string; body: string; ctx: TemplateContext; nonce: string },
) {
  return enqueue(prisma, {
    shopId,
    requestId: null,
    kind: `TEST_${input.kind}`,
    dedupeKey: `test:${input.nonce}`,
    to: [input.to],
    subject: `[Test] ${input.subject}`,
    body: input.body,
    ctx: input.ctx,
  });
}

function nextAttemptDelayMs(attempts: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  return minutes * 60 * 1000;
}

async function deliver(row: EmailLog): Promise<void> {
  const attempts = row.attempts + 1;
  try {
    const provider = getEmailProvider();
    const result = await provider.send({
      to: row.toAddress.split(",").filter(Boolean),
      replyTo: row.replyTo,
      subject: row.subject,
      text: row.bodyText,
      html: row.bodyHtml,
      idempotencyKey: `${row.shopId}:${row.dedupeKey}`,
    });
    await prisma.emailLog.update({
      where: { id: row.id },
      data: { status: "SENT", attempts, sentAt: new Date(), providerId: result.providerId ?? null, lastError: null },
    });
  } catch (error) {
    const dead = attempts >= MAX_EMAIL_ATTEMPTS;
    // Store only the error message; never the email body or recipient list.
    const message = ((error as Error).message || "Unknown error").slice(0, 1000);
    console.error(`[email] Delivery failed for ${row.id} (attempt ${attempts}): ${message}`);
    await prisma.emailLog.update({
      where: { id: row.id },
      data: {
        status: dead ? "DEAD" : "FAILED",
        attempts,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts)),
      },
    });
  }
}

/**
 * Delivers due emails. Optionally restricted to specific row IDs (used right
 * after a submission so customers get their confirmation immediately).
 */
export async function processEmailQueue(options: { ids?: string[]; limit?: number } = {}): Promise<number> {
  const now = new Date();
  // Rows stuck in SENDING (crashed worker) become retryable again.
  await prisma.emailLog.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { status: "FAILED", lastError: "Worker interrupted while sending; retrying" },
  });

  const due = await prisma.emailLog.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: now },
      ...(options.ids ? { id: { in: options.ids } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 25,
  });

  let sent = 0;
  for (const row of due) {
    // Atomic claim: only one worker can move a row from PENDING/FAILED to SENDING.
    const claimed = await prisma.emailLog.updateMany({
      where: { id: row.id, status: row.status, attempts: row.attempts },
      data: { status: "SENDING" },
    });
    if (claimed.count !== 1) continue;
    await deliver(row);
    sent++;
  }
  return sent;
}

/** Manually re-queue a failed or dead email (merchant action). */
export async function retryEmail(shopId: string, emailId: string): Promise<boolean> {
  const { count } = await prisma.emailLog.updateMany({
    where: { id: emailId, shopId, status: { in: ["FAILED", "DEAD"] } },
    data: { status: "PENDING", nextAttemptAt: new Date(), attempts: 0 },
  });
  if (count === 1) await processEmailQueue({ ids: [emailId] });
  return count === 1;
}

export function isEmailConfiguredForDelivery(): boolean {
  return getEnv().EMAIL_PROVIDER !== "log";
}
