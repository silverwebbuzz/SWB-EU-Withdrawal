import { beforeEach, describe, expect, it } from "vitest";
import prisma from "../../app/db.server";
import { createShop, resetDb, submitRequest } from "../helpers";
import {
  addNote,
  changeStatus,
  getDashboard,
  getRequestDetail,
  listRequests,
  parseFilters,
  purgeArchivedRequests,
  setArchived,
} from "../../app/models/request.server";
import { ensureShop, updateSettings } from "../../app/models/shop.server";

const DOMAIN = "requests.myshopify.com";

describe("merchant request workflow", () => {
  beforeEach(resetDb);

  it("computes dashboard counts in the shop time zone", async () => {
    const shop = await createShop(DOMAIN);
    const r1 = await submitRequest(DOMAIN);
    const r2 = await submitRequest(DOMAIN, { customer_email: "b@example.com" });
    const r3 = await submitRequest(DOMAIN, { customer_email: "c@example.com" });
    // r1 falls on 8 Oct in Berlin, r2 just after midnight on 9 Oct (Berlin is UTC+2 in October).
    await prisma.withdrawalRequest.update({
      where: { id: r1.request.id },
      data: { submittedAt: new Date("2026-10-08T21:30:00Z") }, // 23:30 Berlin, 8 Oct
    });
    await prisma.withdrawalRequest.update({
      where: { id: r2.request.id },
      data: { submittedAt: new Date("2026-10-08T22:30:00Z") }, // 00:30 Berlin, 9 Oct
    });
    await prisma.withdrawalRequest.update({
      where: { id: r3.request.id },
      data: { status: "COMPLETED", submittedAt: new Date("2026-10-07T12:00:00Z") },
    });

    const now = new Date("2026-10-09T10:00:00Z");
    const berlin = await getDashboard(shop.id, "Europe/Berlin", now);
    expect(berlin.counts.open).toBe(2);
    expect(berlin.counts.done).toBe(1);
    expect(berlin.counts.today).toBe(1); // only r2
    expect(berlin.recent).toHaveLength(3);

    const utc = await getDashboard(shop.id, "UTC", now);
    expect(utc.counts.today).toBe(0); // both on 8 Oct in UTC
  });

  it("records an audit trail for status changes, notes and archive/restore", async () => {
    await createShop(DOMAIN);
    const shop = await ensureShop(DOMAIN);
    const { request } = await submitRequest(DOMAIN);

    expect((await changeStatus(shop, request.id, "IN_REVIEW", "staff:42", { notifyCustomer: false })).changed).toBe(true);
    expect((await changeStatus(shop, request.id, "IN_REVIEW", "staff:42", { notifyCustomer: false })).changed).toBe(false);
    await changeStatus(shop, request.id, "APPROVED", "staff:7", { notifyCustomer: false });
    expect((await addNote(shop.id, request.id, "   ", "staff:42")).ok).toBe(false);
    expect((await addNote(shop.id, request.id, "Called customer", "staff:42")).ok).toBe(true);
    await setArchived(shop.id, request.id, true, "staff:7");
    expect((await listRequests(shop.id, { archived: false }, "UTC")).total).toBe(0);
    expect((await listRequests(shop.id, { archived: true }, "UTC")).total).toBe(1);
    await setArchived(shop.id, request.id, false, "staff:7");

    const detail = await getRequestDetail(shop.id, request.id);
    expect(detail.status).toBe("APPROVED");
    expect(detail.archivedAt).toBeNull();
    expect(detail.notes[0].body).toBe("Called customer");
    const events = detail.statusHistory.map((h) => [h.event, h.fromStatus, h.toStatus, h.actor]).reverse();
    expect(events).toEqual([
      ["CREATED", null, "REQUESTED", "customer"],
      ["STATUS_CHANGE", "REQUESTED", "IN_REVIEW", "staff:42"],
      ["STATUS_CHANGE", "IN_REVIEW", "APPROVED", "staff:7"],
      ["ARCHIVED", null, null, "staff:7"],
      ["RESTORED", null, null, "staff:7"],
    ]);
  });

  it("queues a status-change email only when enabled and requested", async () => {
    const created = await createShop(DOMAIN);
    const { request } = await submitRequest(DOMAIN);
    await prisma.emailTemplate.update({
      where: { shopId_kind: { shopId: created.id, kind: "STATUS_CHANGE" } },
      data: { enabled: true },
    });
    let shop = await ensureShop(DOMAIN);
    await changeStatus(shop, request.id, "IN_REVIEW", "staff:1", { notifyCustomer: true });
    expect(await prisma.emailLog.count({ where: { requestId: request.id, kind: "STATUS_CHANGE" } })).toBe(0);

    await updateSettings(shop.id, { sendStatusChangeEmails: true });
    shop = await ensureShop(DOMAIN);
    await changeStatus(shop, request.id, "APPROVED", "staff:1", { notifyCustomer: false });
    await changeStatus(shop, request.id, "COMPLETED", "staff:1", { notifyCustomer: true });
    const emails = await prisma.emailLog.findMany({ where: { requestId: request.id, kind: "STATUS_CHANGE" } });
    expect(emails).toHaveLength(1);
    expect(emails[0].bodyText).toContain("Completed");
  });

  it("filters by search, status and date range", async () => {
    const shop = await createShop(DOMAIN);
    const a = await submitRequest(DOMAIN, { customer_name: "Anna Alpha", customer_email: "anna@example.com", order_reference: "#2001" });
    await submitRequest(DOMAIN, { customer_name: "Bert Beta", customer_email: "bert@example.com", order_reference: "#2002" });
    await prisma.withdrawalRequest.update({
      where: { id: a.request.id },
      data: { status: "REJECTED", submittedAt: new Date("2026-09-01T12:00:00Z") },
    });

    const q = (s: string) => listRequests(shop.id, parseFilters(new URLSearchParams(s), false), "Europe/Berlin");
    expect((await q("q=ANNA")).total).toBe(1);
    expect((await q("q=2002")).rows[0].customerName).toBe("Bert Beta");
    expect((await q("q=%232001")).total).toBe(1);
    expect((await q("status=REJECTED")).total).toBe(1);
    expect((await q("status=BOGUS")).total).toBe(2); // invalid filter ignored
    expect((await q("from=2026-09-01&to=2026-09-01")).total).toBe(1);
    expect((await q("from=2026-09-02")).total).toBe(1);
    expect((await q(`q=${a.request.requestNumber.toLowerCase()}`)).total).toBe(1);
  });

  it("purges archived requests past the retention period only", async () => {
    const shop = await createShop(DOMAIN);
    const old = await submitRequest(DOMAIN);
    const recent = await submitRequest(DOMAIN);
    const open = await submitRequest(DOMAIN);
    await prisma.withdrawalRequest.update({ where: { id: old.request.id }, data: { archivedAt: new Date("2025-01-01") } });
    await prisma.withdrawalRequest.update({ where: { id: recent.request.id }, data: { archivedAt: new Date() } });
    expect(await purgeArchivedRequests(shop.id, 0)).toBe(0);
    expect(await purgeArchivedRequests(shop.id, 365)).toBe(1);
    const left = await prisma.withdrawalRequest.findMany({ where: { shopId: shop.id }, select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([recent.request.id, open.request.id].sort());
    expect(await prisma.withdrawalAnswer.count({ where: { requestId: old.request.id } })).toBe(0);
  });
});
