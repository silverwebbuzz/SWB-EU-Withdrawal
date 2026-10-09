import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createInstalledShop, createShop, resetDb, signedWebhookRequest, submitRequest } from "../helpers";
import { action as complianceAction } from "../../app/routes/webhooks.compliance";

const DOMAIN = "privacy.myshopify.com";
type Args = Parameters<typeof complianceAction>[0];
const call = (request: Request) => complianceAction({ request, params: {}, context: {} } as unknown as Args);

async function status(request: Request): Promise<number> {
  try {
    return (await call(request)).status;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown.status;
    throw thrown;
  }
}

describe("privacy compliance webhooks", () => {
  beforeEach(resetDb);

  it("rejects requests with an invalid HMAC signature", async () => {
    await createShop(DOMAIN);
    const req = signedWebhookRequest("customers/redact", DOMAIN, { customer: { email: "erika@example.com" } });
    const tampered = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({ customer: { email: "someone-else@example.com" } }),
    });
    expect(await status(tampered)).toBe(401);
  });

  it("customers/data_request collects the customer's data for the merchant", async () => {
    const shop = await createShop(DOMAIN);
    await submitRequest(DOMAIN, { customer_email: "Erika@Example.com" });
    await submitRequest(DOMAIN, { customer_email: "other@example.com" });
    const res = await call(
      signedWebhookRequest("customers/data_request", DOMAIN, {
        shop_domain: DOMAIN,
        customer: { id: 1, email: "erika@example.com" },
        orders_requested: [],
      }),
    );
    expect(res.status).toBe(200);
    const record = await prisma.privacyDataRequest.findFirstOrThrow({ where: { shopId: shop.id } });
    expect(record.requestCount).toBe(1);
    const payload = record.payload as { customerEmail: string; answers: { label: string }[] }[];
    expect(payload[0].customerEmail).toBe("Erika@Example.com");
    // Admin-only answers are not part of the customer's export.
    expect(payload[0].answers.map((a) => a.label)).not.toContain("Source");
  });

  it("customers/redact deletes only that customer's data, once per webhook ID", async () => {
    await createShop(DOMAIN);
    const target = await submitRequest(DOMAIN, { customer_email: "erika@example.com" });
    await prisma.withdrawalRequest.update({
      where: { id: target.request.id },
      data: { shopifyOrderId: "gid://shopify/Order/555" },
    });
    const byOrder = await submitRequest(DOMAIN, { customer_email: "alias@example.com" });
    await prisma.withdrawalRequest.update({
      where: { id: byOrder.request.id },
      data: { shopifyOrderId: "gid://shopify/Order/556" },
    });
    const keep = await submitRequest(DOMAIN, { customer_email: "keep@example.com" });

    const payload = { customer: { id: 9, email: "erika@example.com" }, orders_to_redact: [556] };
    expect((await call(signedWebhookRequest("customers/redact", DOMAIN, payload, "wh-1"))).status).toBe(200);
    const left = await prisma.withdrawalRequest.findMany({ select: { id: true } });
    expect(left.map((r) => r.id)).toEqual([keep.request.id]);
    expect(await prisma.withdrawalAnswer.count({ where: { requestId: target.request.id } })).toBe(0);
    expect(await prisma.emailLog.count({ where: { requestId: target.request.id } })).toBe(0);

    // Same webhook ID again: acknowledged without re-processing.
    expect((await call(signedWebhookRequest("customers/redact", DOMAIN, payload, "wh-1"))).status).toBe(200);
    expect(await prisma.processedWebhook.count()).toBe(1);
  });

  it("shop/redact deletes everything for the shop", async () => {
    await createInstalledShop(DOMAIN);
    await createShop("other.myshopify.com");
    await submitRequest(DOMAIN);
    await submitRequest("other.myshopify.com");
    expect((await call(signedWebhookRequest("shop/redact", DOMAIN, { shop_domain: DOMAIN }))).status).toBe(200);
    expect(await prisma.shop.count({ where: { shopDomain: DOMAIN } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: DOMAIN } })).toBe(0);
    expect(await prisma.form.count()).toBe(1);
    expect(await prisma.withdrawalRequest.count()).toBe(1);
    expect(await prisma.emailTemplate.count()).toBe(3);
  });
});
