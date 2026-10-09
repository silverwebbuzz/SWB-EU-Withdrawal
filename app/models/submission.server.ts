import { Prisma, type OrderVerification, type WithdrawalRequest } from "@prisma/client";
import prisma from "../db.server";
import { isContentField, type FormSchema } from "../lib/form-schema";
import { extractCoreValues, type SubmissionValues } from "../lib/submission-validation";
import { enqueueSubmissionEmails } from "./email.server";
import { effectiveTimezone, notificationRecipients, type ShopWithSettings } from "./shop.server";

export function formatRequestNumber(n: number): string {
  return `WD-${String(n).padStart(6, "0")}`;
}

export interface CreateRequestInput {
  shop: ShopWithSettings;
  formVersionId: string;
  schema: FormSchema;
  values: SubmissionValues;
  idempotencyKey: string;
  locale: string;
  shopifyCustomerId?: string | null;
  verification?: {
    status: OrderVerification;
    orderId?: string | null;
    processedAt?: Date | null;
  };
  /** Development demo data only: skip the outbox so no emails are sent. */
  skipEmails?: boolean;
}

export interface CreateRequestResult {
  request: WithdrawalRequest;
  duplicate: boolean;
  emailIds: string[];
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Persists a validated submission exactly once per idempotency key. A repeat
 * (double click, refresh, retry) returns the original request instead.
 */
export async function createWithdrawalRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
  const { shop, schema, values } = input;
  const existing = await prisma.withdrawalRequest.findUnique({
    where: { shopId_idempotencyKey: { shopId: shop.id, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return { request: existing, duplicate: true, emailIds: [] };

  const core = extractCoreValues(schema, values);
  if (!core.customerEmail) throw new Error("Validated submission is missing the customer email");

  try {
    return await prisma.$transaction(async (tx) => {
      const counter = await tx.shop.update({
        where: { id: shop.id },
        data: { requestCounter: { increment: 1 } },
        select: { requestCounter: true },
      });

      const request = await tx.withdrawalRequest.create({
        data: {
          shopId: shop.id,
          requestNumber: formatRequestNumber(counter.requestCounter),
          formVersionId: input.formVersionId,
          customerEmail: core.customerEmail!,
          customerEmailNorm: core.customerEmail!.toLowerCase(),
          customerName: core.customerName ?? null,
          orderReference: core.orderReference ?? null,
          orderVerification: input.verification?.status ?? "UNVERIFIED",
          shopifyOrderId: input.verification?.orderId ?? null,
          orderProcessedAt: input.verification?.processedAt ?? null,
          shopifyCustomerId: input.shopifyCustomerId || null,
          locale: input.locale,
          idempotencyKey: input.idempotencyKey,
        },
      });

      const answers = schema.fields
        .filter((f) => !isContentField(f))
        .map((f, position) => ({
          shopId: shop.id,
          requestId: request.id,
          fieldId: f.id,
          fieldType: f.type,
          label: f.label,
          value: (values[f.id] ?? "") as Prisma.InputJsonValue,
          adminOnly: f.visibility === "admin",
          position,
        }));
      await tx.withdrawalAnswer.createMany({ data: answers });

      await tx.requestStatusHistory.create({
        data: { shopId: shop.id, requestId: request.id, event: "CREATED", toStatus: "REQUESTED", actor: "customer" },
      });

      if (!input.skipEmails) await enqueueSubmissionEmails(tx, {
        shop,
        request: { ...request, answers },
        timeZone: effectiveTimezone(shop, shop.settings),
        // Fall back to the store contact email so merchants are never left uninformed.
        merchantRecipients: notificationRecipients(shop.settings).length
          ? notificationRecipients(shop.settings)
          : shop.contactEmail
            ? [shop.contactEmail]
            : [],
        replyTo: shop.settings.replyToEmail,
      });
      const emails = await tx.emailLog.findMany({ where: { requestId: request.id }, select: { id: true } });
      return { request, duplicate: false, emailIds: emails.map((e) => e.id) };
    });
  } catch (error) {
    // Two concurrent submits with the same key: the loser returns the winner's row.
    if (isUniqueViolation(error)) {
      const winner = await prisma.withdrawalRequest.findUnique({
        where: { shopId_idempotencyKey: { shopId: shop.id, idempotencyKey: input.idempotencyKey } },
      });
      if (winner) return { request: winner, duplicate: true, emailIds: [] };
    }
    throw error;
  }
}
