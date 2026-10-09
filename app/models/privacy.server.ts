// Handlers for Shopify's mandatory privacy compliance webhooks.
// See https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

interface CustomerPayload {
  customer?: { id?: number | string | null; email?: string | null } | null;
  orders_requested?: (number | string)[];
  orders_to_redact?: (number | string)[];
}

const orderGid = (id: number | string) => `gid://shopify/Order/${id}`;
const customerIdString = (id: number | string | null | undefined) =>
  id === null || id === undefined || id === "" ? null : String(id);

function customerWhere(shopId: string, payload: CustomerPayload, orderIds: (number | string)[]) {
  const email = payload.customer?.email?.trim().toLowerCase();
  const customerId = customerIdString(payload.customer?.id);
  const or: Prisma.WithdrawalRequestWhereInput[] = [];
  if (email) or.push({ customerEmailNorm: email });
  if (customerId) or.push({ shopifyCustomerId: customerId });
  if (orderIds.length) or.push({ shopifyOrderId: { in: orderIds.map(orderGid) } });
  return or.length ? { shopId, OR: or } : null;
}

/**
 * customers/data_request: collect what we store about the customer so the
 * merchant can provide it. The export is kept in the app for the merchant.
 */
export async function handleCustomerDataRequest(shopDomain: string, payload: CustomerPayload) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { found: 0 };
  const where = customerWhere(shop.id, payload, payload.orders_requested ?? []);
  const requests = where
    ? await prisma.withdrawalRequest.findMany({
        where,
        include: { answers: { where: { adminOnly: false }, orderBy: { position: "asc" } } },
      })
    : [];
  const exportData = requests.map((r) => ({
    requestNumber: r.requestNumber,
    submittedAt: r.submittedAt.toISOString(),
    status: r.status,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    orderReference: r.orderReference,
    answers: r.answers.map((a) => ({ label: a.label, value: a.value })),
  }));
  await prisma.privacyDataRequest.create({
    data: {
      shopId: shop.id,
      customerEmail: payload.customer?.email?.trim().toLowerCase() || null,
      shopifyCustomerId: customerIdString(payload.customer?.id),
      requestCount: requests.length,
      payload: exportData as unknown as Prisma.InputJsonValue,
    },
  });
  return { found: requests.length };
}

/** customers/redact: delete the customer's requests (answers, notes, emails cascade). */
export async function handleCustomerRedact(shopDomain: string, payload: CustomerPayload) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return { deleted: 0 };
  const where = customerWhere(shop.id, payload, payload.orders_to_redact ?? []);
  if (!where) return { deleted: 0 };
  const email = payload.customer?.email?.trim().toLowerCase();
  const [deleted] = await prisma.$transaction([
    prisma.withdrawalRequest.deleteMany({ where }),
    prisma.privacyDataRequest.deleteMany({
      where: {
        shopId: shop.id,
        OR: [
          ...(email ? [{ customerEmail: email }] : []),
          ...(customerIdString(payload.customer?.id)
            ? [{ shopifyCustomerId: customerIdString(payload.customer?.id) }]
            : []),
        ],
      },
    }),
  ]);
  return { deleted: deleted.count };
}

/** shop/redact (48h after uninstall): delete everything stored for the shop. */
export async function handleShopRedact(shopDomain: string) {
  await prisma.$transaction([
    prisma.shop.deleteMany({ where: { shopDomain } }), // cascades to all shop-owned rows
    prisma.session.deleteMany({ where: { shop: shopDomain } }),
  ]);
}

export async function listPrivacyRequests(shopId: string) {
  return prisma.privacyDataRequest.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, customerEmail: true, requestCount: true, createdAt: true },
  });
}

export async function getPrivacyRequest(shopId: string, id: string) {
  return prisma.privacyDataRequest.findFirst({ where: { id, shopId } });
}

/** Records the webhook ID; returns false if it was already processed. */
export async function markWebhookProcessed(webhookId: string, shopDomain: string, topic: string): Promise<boolean> {
  if (!webhookId) return true;
  try {
    await prisma.processedWebhook.create({ data: { webhookId, shopDomain, topic } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}

export async function forgetWebhook(webhookId: string) {
  // Lets Shopify's retry run the handler again if processing failed.
  await prisma.processedWebhook.deleteMany({ where: { webhookId } });
}
