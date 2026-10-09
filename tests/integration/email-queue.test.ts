import { afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createShop, resetDb, submitRequest } from "../helpers";
import { MAX_EMAIL_ATTEMPTS, processEmailQueue, retryEmail } from "../../app/models/email.server";
import { setEmailProviderForTesting, type OutgoingEmail } from "../../app/services/email-provider.server";

const DOMAIN = "mail.myshopify.com";

function fakeProvider(fail = false) {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    provider: {
      name: "fake",
      async send(email: OutgoingEmail) {
        await new Promise((r) => setTimeout(r, 20));
        if (fail) throw new Error("SMTP 451 temporary failure");
        sent.push(email);
        return { providerId: `fake-${sent.length}` };
      },
    },
  };
}

describe("email outbox", () => {
  beforeEach(async () => {
    await resetDb();
    await createShop(DOMAIN);
    await prisma.shopSettings.updateMany({ data: { merchantNotificationEmails: "owner@example.com" } });
  });
  afterEach(() => setEmailProviderForTesting(null));

  it("sends each email exactly once, even with concurrent workers", async () => {
    const fake = fakeProvider();
    setEmailProviderForTesting(fake.provider);
    await submitRequest(DOMAIN, { customer_name: "<b>Erika</b>" });

    await Promise.all([processEmailQueue(), processEmailQueue(), processEmailQueue()]);
    await processEmailQueue();
    expect(fake.sent).toHaveLength(2);
    const customer = fake.sent.find((e) => e.to.includes("erika@example.com"))!;
    expect(customer.subject).toContain("WD-000001");
    expect(customer.html).toContain("&lt;b&gt;Erika&lt;/b&gt;");
    expect(customer.html).not.toContain("<b>Erika</b>");
    // Customer emails never include admin-only answers.
    expect(customer.text).not.toContain("online_withdrawal_form");
    const merchant = fake.sent.find((e) => e.to.includes("owner@example.com"))!;
    expect(merchant.replyTo).toBe("erika@example.com");
    expect(merchant.text).toContain("online_withdrawal_form");
    expect(await prisma.emailLog.count({ where: { status: "SENT" } })).toBe(2);
  });

  it("records failures, backs off and gives up after the maximum attempts", async () => {
    const failing = fakeProvider(true);
    setEmailProviderForTesting(failing.provider);
    await submitRequest(DOMAIN);
    await processEmailQueue();
    let rows = await prisma.emailLog.findMany();
    expect(rows.every((r) => r.status === "FAILED" && r.attempts === 1)).toBe(true);
    expect(rows[0].lastError).toContain("451");
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: nothing is retried.
    await processEmailQueue();
    expect((await prisma.emailLog.findFirstOrThrow()).attempts).toBe(1);

    for (let i = 1; i < MAX_EMAIL_ATTEMPTS; i++) {
      await prisma.emailLog.updateMany({ data: { nextAttemptAt: new Date(0) } });
      await processEmailQueue();
    }
    rows = await prisma.emailLog.findMany();
    expect(rows.every((r) => r.status === "DEAD" && r.attempts === MAX_EMAIL_ATTEMPTS)).toBe(true);

    // A manual retry with a working provider delivers it.
    const ok = fakeProvider();
    setEmailProviderForTesting(ok.provider);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(await retryEmail(shop.id, rows[0].id)).toBe(true);
    expect(ok.sent).toHaveLength(1);
  });
});
