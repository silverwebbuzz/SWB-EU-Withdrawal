import { createHmac } from "node:crypto";
import prisma from "../app/db.server";
import { ensureShop } from "../app/models/shop.server";
import { getPublishedForm } from "../app/models/form.server";
import { createWithdrawalRequest } from "../app/models/submission.server";
import { defaultWithdrawalFormSchema } from "../app/lib/form-schema";
import type { SubmissionValues } from "../app/lib/submission-validation";

const TABLES = [
  "WithdrawalAnswer",
  "RequestStatusHistory",
  "InternalNote",
  "EmailLog",
  "WithdrawalRequest",
  "FormVersion",
  "Form",
  "EmailTemplate",
  "PrivacyDataRequest",
  "ShopSettings",
  "Shop",
  "Session",
  "RateLimitHit",
  "ProcessedWebhook",
];

export async function resetDb() {
  // FOREIGN_KEY_CHECKS is per connection, so run everything on one connection.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of TABLES) await tx.$executeRawUnsafe(`DELETE FROM \`${t}\``);
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  });
}

export async function createShop(domain: string) {
  return ensureShop(domain);
}

export async function createInstalledShop(domain: string, scope = "") {
  const shop = await ensureShop(domain);
  await prisma.session.create({
    data: { id: `offline_${domain}`, shop: domain, state: "", isOnline: false, accessToken: "shpat_test", scope },
  });
  return shop;
}

export function sampleValues(overrides: Partial<SubmissionValues> = {}): SubmissionValues {
  return {
    customer_name: "Erika Mustermann",
    customer_email: "erika@example.com",
    order_reference: "#1001",
    order_date: "",
    withdrawal_scope: "entire_order",
    items: "",
    declaration: "yes",
    source: "online_withdrawal_form",
    ...overrides,
  };
}

let counter = 0;
export async function submitRequest(shopDomain: string, overrides: Partial<SubmissionValues> = {}, key?: string) {
  const shop = await ensureShop(shopDomain);
  const published = await getPublishedForm(shop.id, shop.settings.defaultFormId);
  if (!published) throw new Error("No published form");
  return createWithdrawalRequest({
    shop,
    formVersionId: published.version.id,
    schema: published.schema ?? defaultWithdrawalFormSchema(),
    values: sampleValues(overrides),
    idempotencyKey: key ?? `key-${Date.now()}-${counter++}`,
    locale: "en",
  });
}

/** Builds a signed app proxy URL exactly as Shopify does. */
export function signedProxyUrl(shopDomain: string, extra: Record<string, string> = {}, path = "/proxy") {
  const params: Record<string, string> = {
    shop: shopDomain,
    logged_in_customer_id: "",
    path_prefix: "/apps/withdraw",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extra,
  };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(message).digest("hex");
  const qs = new URLSearchParams({ ...params, signature });
  return `${process.env.SHOPIFY_APP_URL}${path}?${qs.toString()}`;
}

export function signedWebhookRequest(topic: string, shopDomain: string, payload: unknown, webhookId = `wh-${Date.now()}`) {
  const body = JSON.stringify(payload);
  const hmac = createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(body).digest("base64");
  return new Request(`${process.env.SHOPIFY_APP_URL}/webhooks/compliance`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shopDomain,
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-Webhook-Id": webhookId,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Event-Id": `ev-${webhookId}`,
      "X-Shopify-Triggered-At": new Date().toISOString(),
    },
  });
}
