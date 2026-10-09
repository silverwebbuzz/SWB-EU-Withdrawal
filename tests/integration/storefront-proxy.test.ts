// End-to-end tests of the customer flow through the app proxy route, with real
// Shopify signature validation, server-side validation and persistence.
import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createInstalledShop, createShop, resetDb, signedProxyUrl } from "../helpers";
import { action, loader } from "../../app/routes/proxy";
import { updateSettings } from "../../app/models/shop.server";
import { getDefaultForm, unpublish } from "../../app/models/form.server";

const DOMAIN = "storefront.myshopify.com";
type Args = Parameters<typeof loader>[0];

async function run(fn: typeof loader | typeof action, request: Request) {
  try {
    const res = await fn({ request, params: {}, context: {} } as unknown as Args);
    return { status: res.status, html: await res.text(), type: res.headers.get("content-type") };
  } catch (thrown) {
    if (thrown instanceof Response) return { status: thrown.status, html: await thrown.text(), type: null };
    throw thrown;
  }
}

const get = (extra: Record<string, string> = {}) => run(loader, new Request(signedProxyUrl(DOMAIN, extra)));
const post = (body: Record<string, string>, ip = "203.0.113.7", extra: Record<string, string> = {}) =>
  run(
    action,
    new Request(signedProxyUrl(DOMAIN, extra), {
      method: "POST",
      body: new URLSearchParams(body),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ip },
    }),
  );

const hidden = (html: string, name: string) =>
  html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1]?.replace(/&#123;|&#125;/g, "") ?? "";

const validFields = {
  f_customer_name: "Erika Mustermann",
  f_customer_email: "erika@example.com",
  f_order_reference: "#1001",
  f_withdrawal_scope: "entire_order",
  f_declaration: "yes",
};

async function reviewToken(fields: Record<string, string> = validFields, ip?: string) {
  const form = await get();
  const t = hidden(form.html, "_t");
  const review = await post({ _step: "review", _t: t, ...fields }, ip);
  return { review, payload: hidden(review.html, "_p") };
}

describe("storefront withdrawal flow (app proxy)", () => {
  beforeEach(async () => {
    await resetDb();
    const shop = await createInstalledShop(DOMAIN);
    await updateSettings(shop.id, { minFillSeconds: 0, merchantNotificationEmails: "owner@example.com" });
  });

  it("rejects requests without a valid Shopify signature", async () => {
    const url = new URL(signedProxyUrl(DOMAIN));
    url.searchParams.set("shop", "evil.myshopify.com");
    expect((await run(loader, new Request(url))).status).toBe(400);
  });

  it("renders the published form as Liquid without requiring a login", async () => {
    const res = await get({ lang: "de" });
    expect(res.status).toBe(200);
    expect(res.type).toContain("application/liquid");
    expect(res.html).toContain("Withdrawal from contract");
    expect(res.html).toContain("Weiter zur Überprüfung");
    expect(res.html).toContain('{{ customer.email | escape }}'); // prefill for logged-in customers
    expect((await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } })).proxyLastSeenAt).not.toBeNull();
  });

  it("completes review → confirm, shows a reference and stores the request once", async () => {
    const { review, payload } = await reviewToken();
    expect(review.status).toBe(200);
    expect(review.html).toContain("Please review your withdrawal");
    expect(await prisma.withdrawalRequest.count()).toBe(0); // nothing stored before confirmation

    const confirm = await post({ _step: "confirm", _p: payload });
    expect(confirm.status).toBe(200);
    expect(confirm.html).toContain("WD-000001");
    const stored = await prisma.withdrawalRequest.findFirstOrThrow({ include: { answers: true } });
    expect(stored.customerEmail).toBe("erika@example.com");
    expect(stored.orderVerification).toBe("UNVERIFIED");
    expect(stored.answers.find((a) => a.fieldId === "source")?.value).toBe("online_withdrawal_form");
    expect(await prisma.emailLog.count({ where: { requestId: stored.id } })).toBe(2);

    // Double click / refresh: same reference, no second request.
    const again = await post({ _step: "confirm", _p: payload });
    expect(again.html).toContain("WD-000001");
    expect(await prisma.withdrawalRequest.count()).toBe(1);
  });

  it("re-renders the form with errors for invalid input", async () => {
    const form = await get();
    const res = await post({
      _step: "review",
      _t: hidden(form.html, "_t"),
      ...validFields,
      f_customer_email: "not-an-email",
      f_withdrawal_scope: "something_else",
    });
    expect(res.status).toBe(422);
    expect(res.html).toContain("Enter a valid email address.");
    expect(res.html).toContain("Choose one of the available options.");
    expect(res.html).toContain('aria-invalid="true"');
  });

  it("escapes malicious input in the review page", async () => {
    const { review } = await reviewToken({
      ...validFields,
      f_customer_name: '<script>alert(1)</script>{{ shop.metafields }}',
    });
    expect(review.html).not.toContain("<script>alert(1)");
    expect(review.html).toContain("&lt;script&gt;");
    expect(review.html).not.toContain("{{ shop.metafields }}");
  });

  it("rejects tampered or expired review payloads", async () => {
    const { payload } = await reviewToken();
    const [body, sig] = payload.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
    decoded.a.customer_email = "attacker@example.com";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    const res = await post({ _step: "confirm", _p: forged });
    expect(res.html).toContain("Your session has expired");
    expect(await prisma.withdrawalRequest.count()).toBe(0);
  });

  it("blocks honeypot submissions and too-fast submissions", async () => {
    const form = await get();
    const bot = await post({ _step: "review", _t: hidden(form.html, "_t"), ...validFields, swb_website: "http://spam" });
    expect(bot.status).toBe(400);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    await updateSettings(shop.id, { minFillSeconds: 30 });
    const fresh = await get();
    const fast = await post({ _step: "review", _t: hidden(fresh.html, "_t"), ...validFields });
    expect(fast.html).not.toContain("Please review your withdrawal");
  });

  it("rate limits confirmations per visitor", async () => {
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    await updateSettings(shop.id, { rateLimitPerHour: 2 });
    for (let i = 0; i < 2; i++) {
      const { payload } = await reviewToken(validFields, "198.51.100.1");
      expect((await post({ _step: "confirm", _p: payload }, "198.51.100.1")).status).toBe(200);
    }
    const { payload } = await reviewToken(validFields, "198.51.100.1");
    expect((await post({ _step: "confirm", _p: payload }, "198.51.100.1")).status).toBe(429);
    // A different visitor is unaffected.
    const other = await reviewToken(validFields, "198.51.100.2");
    expect((await post({ _step: "confirm", _p: other.payload }, "198.51.100.2")).status).toBe(200);
    // Only hashes are stored, never IPs.
    const hits = await prisma.rateLimitHit.findMany();
    expect(hits.some((h) => h.keyHash.includes("198.51"))).toBe(false);
  });

  it("shows an unavailable message when the form is unpublished or the app is not installed", async () => {
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    const form = await getDefaultForm(shop.id, null);
    await unpublish(shop.id, form.id);
    expect((await get()).status).toBe(503);

    await createShop("no-session.myshopify.com");
    const res = await run(loader, new Request(signedProxyUrl("no-session.myshopify.com")));
    expect(res.status).toBe(503);
  });
});
