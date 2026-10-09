import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createShop, resetDb, submitRequest } from "../helpers";
import {
  addNote,
  changeStatus,
  exportRequests,
  getDashboard,
  getRequestDetail,
  listRequests,
  RequestNotFoundError,
  setArchived,
} from "../../app/models/request.server";
import { FormNotFoundError, getDefaultForm, publishDraft, saveDraft } from "../../app/models/form.server";
import { retryEmail } from "../../app/models/email.server";
import { getPrivacyRequest } from "../../app/models/privacy.server";

describe("multi-tenant isolation", () => {
  beforeEach(resetDb);

  it("never exposes or mutates another shop's requests", async () => {
    const a = await createShop("shop-a.myshopify.com");
    const b = await createShop("shop-b.myshopify.com");
    const { request } = await submitRequest(a.shopDomain);

    await expect(getRequestDetail(b.id, request.id)).rejects.toBeInstanceOf(RequestNotFoundError);
    await expect(changeStatus(b, request.id, "APPROVED", "staff:1", { notifyCustomer: false })).rejects.toBeInstanceOf(
      RequestNotFoundError,
    );
    await expect(addNote(b.id, request.id, "hi", "staff:1")).rejects.toBeInstanceOf(RequestNotFoundError);
    await expect(setArchived(b.id, request.id, true, "staff:1")).rejects.toBeInstanceOf(RequestNotFoundError);

    expect((await listRequests(b.id, { archived: false }, "UTC")).total).toBe(0);
    expect(await exportRequests(b.id, { archived: false }, "UTC")).toHaveLength(0);
    expect((await getDashboard(b.id, "UTC")).counts).toEqual({ open: 0, today: 0, done: 0 });

    const email = await prisma.emailLog.findFirstOrThrow({ where: { requestId: request.id } });
    await prisma.emailLog.update({ where: { id: email.id }, data: { status: "FAILED" } });
    expect(await retryEmail(b.id, email.id)).toBe(false);

    // The original is untouched.
    const fresh = await getRequestDetail(a.id, request.id);
    expect(fresh.status).toBe("REQUESTED");
    expect(fresh.notes).toHaveLength(0);
    expect(fresh.archivedAt).toBeNull();
  });

  it("never edits another shop's form", async () => {
    const a = await createShop("shop-a.myshopify.com");
    const b = await createShop("shop-b.myshopify.com");
    const formA = await getDefaultForm(a.id, a.settings.defaultFormId);
    await expect(saveDraft(b.id, formA.id, formA.draftSchema)).rejects.toBeInstanceOf(FormNotFoundError);
    await expect(publishDraft(b.id, formA.id)).rejects.toBeInstanceOf(FormNotFoundError);
    // A shop's default-form pointer cannot resolve to a foreign form.
    const resolved = await getDefaultForm(b.id, formA.id);
    expect(resolved.shopId).toBe(b.id);
  });

  it("scopes privacy exports by shop", async () => {
    const a = await createShop("shop-a.myshopify.com");
    const b = await createShop("shop-b.myshopify.com");
    const rec = await prisma.privacyDataRequest.create({
      data: { shopId: a.id, customerEmail: "x@example.com", requestCount: 0, payload: [] },
    });
    expect(await getPrivacyRequest(b.id, rec.id)).toBeNull();
    expect(await getPrivacyRequest(a.id, rec.id)).not.toBeNull();
  });
});
