import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createShop, resetDb, submitRequest } from "../helpers";
import {
  getDefaultForm,
  getPublishedForm,
  publishDraft,
  resetDraftToDefault,
  restorePreviousVersion,
  saveDraft,
  unpublish,
} from "../../app/models/form.server";
import { getRequestDetail } from "../../app/models/request.server";
import type { FormSchema } from "../../app/lib/form-schema";

const DOMAIN = "forms.myshopify.com";

describe("submissions", () => {
  beforeEach(resetDb);

  it("issues sequential, per-shop request numbers and enqueues both emails", async () => {
    const shop = await createShop(DOMAIN);
    await prisma.shop.update({ where: { id: shop.id }, data: { contactEmail: "owner@example.com" } });
    const first = await submitRequest(DOMAIN);
    const second = await submitRequest(DOMAIN);
    expect(first.request.requestNumber).toBe("WD-000001");
    expect(second.request.requestNumber).toBe("WD-000002");
    await createShop("other.myshopify.com");
    expect((await submitRequest("other.myshopify.com")).request.requestNumber).toBe("WD-000001");

    const kinds = (await prisma.emailLog.findMany({ where: { requestId: first.request.id } })).map((e) => e.kind).sort();
    expect(kinds).toEqual(["CUSTOMER_CONFIRMATION", "MERCHANT_NOTIFICATION"]);
  });

  it("is idempotent for repeated and concurrent submissions with the same key", async () => {
    const shop = await createShop(DOMAIN);
    await prisma.shopSettings.update({ where: { shopId: shop.id }, data: { merchantNotificationEmails: "owner@example.com" } });
    const one = await submitRequest(DOMAIN, {}, "same-key");
    const again = await submitRequest(DOMAIN, {}, "same-key");
    expect(again.duplicate).toBe(true);
    expect(again.request.id).toBe(one.request.id);

    const results = await Promise.all(Array.from({ length: 5 }, () => submitRequest(DOMAIN, {}, "race-key")));
    expect(new Set(results.map((r) => r.request.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await prisma.withdrawalRequest.count()).toBe(2);
    expect(await prisma.emailLog.count()).toBe(4);
  });

  it("keeps the submitted labels when the form is edited later", async () => {
    const shop = await createShop(DOMAIN);
    const { request } = await submitRequest(DOMAIN);
    const form = await getDefaultForm(shop.id, shop.settings.defaultFormId);
    const draft = structuredClone(form.draftSchema) as unknown as FormSchema;
    draft.fields.find((f) => f.id === "customer_name")!.label = "Renamed label";
    expect((await saveDraft(shop.id, form.id, draft)).ok).toBe(true);
    expect((await publishDraft(shop.id, form.id)).ok).toBe(true);

    const detail = await getRequestDetail(shop.id, request.id);
    expect(detail.answers.find((a) => a.fieldId === "customer_name")?.label).toBe("Full name");
    expect(detail.formVersion?.version).toBe(1);
    const live = await getPublishedForm(shop.id, shop.settings.defaultFormId);
    expect(live?.version.version).toBe(2);
  });
});

describe("form versioning", () => {
  beforeEach(resetDb);

  it("saves drafts, publishes versions, unpublishes, restores and resets", async () => {
    const shop = await createShop(DOMAIN);
    const form = await getDefaultForm(shop.id, shop.settings.defaultFormId);
    const draft = structuredClone(form.draftSchema) as unknown as FormSchema;

    // Invalid drafts are rejected with readable messages and not stored.
    const invalid = { ...draft, fields: draft.fields.filter((f) => f.type !== "customer_email") };
    const rejected = await saveDraft(shop.id, form.id, invalid);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.join(" ")).toContain("Customer email");

    draft.title = "Version two";
    await saveDraft(shop.id, form.id, draft);
    // Saving a draft does not change the live form.
    expect((await getPublishedForm(shop.id, form.id))?.schema.title).toBe("Withdrawal from contract");
    await publishDraft(shop.id, form.id);
    expect((await getPublishedForm(shop.id, form.id))?.schema.title).toBe("Version two");

    await unpublish(shop.id, form.id);
    expect(await getPublishedForm(shop.id, form.id)).toBeNull();

    // Unpublished: restore re-publishes the latest version.
    expect((await restorePreviousVersion(shop.id, form.id)).ok).toBe(true);
    expect((await getPublishedForm(shop.id, form.id))?.version.version).toBe(2);
    // Published v2: restore goes back to v1 and loads it into the draft.
    await restorePreviousVersion(shop.id, form.id);
    const restored = await getDefaultForm(shop.id, form.id);
    expect(restored.publishedVersion?.version).toBe(1);
    expect((restored.draftSchema as unknown as FormSchema).title).toBe("Withdrawal from contract");
    expect((await restorePreviousVersion(shop.id, form.id)).ok).toBe(false);

    draft.title = "Temp";
    await saveDraft(shop.id, form.id, draft);
    await resetDraftToDefault(shop.id, form.id);
    const reset = await getDefaultForm(shop.id, form.id);
    expect((reset.draftSchema as unknown as FormSchema).title).toBe("Withdrawal from contract");
    expect(await prisma.formVersion.count({ where: { formId: form.id } })).toBe(2);
  });
});
