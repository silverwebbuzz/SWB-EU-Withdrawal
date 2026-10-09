// Development-only sample data so the dashboard and inbox can be explored
// without submitting real forms. Never available in production builds.
import prisma from "../db.server";
import type { RequestStatus } from "@prisma/client";
import { getPublishedForm } from "./form.server";
import { createWithdrawalRequest } from "./submission.server";
import type { ShopWithSettings } from "./shop.server";

const PEOPLE = [
  ["Erika Mustermann", "erika.demo@example.com"],
  ["Jan de Vries", "jan.demo@example.com"],
  ["Sophie Martin", "sophie.demo@example.com"],
  ["Luca Rossi", "luca.demo@example.com"],
  ["Ana García", "ana.demo@example.com"],
  ["Max Schmidt", "max.demo@example.com"],
  ["Emma Jansen", "emma.demo@example.com"],
  ["Paul Weber", "paul.demo@example.com"],
] as const;

const STATUSES: RequestStatus[] = ["REQUESTED", "REQUESTED", "IN_REVIEW", "APPROVED", "COMPLETED", "REJECTED", "REQUESTED", "COMPLETED"];

export function demoDataAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function createDemoRequests(shop: ShopWithSettings): Promise<number> {
  if (!demoDataAllowed()) throw new Error("Demo data is disabled in production");
  const published = await getPublishedForm(shop.id, shop.settings.defaultFormId);
  if (!published) throw new Error("Publish the form first");

  let created = 0;
  for (const [i, [name, email]] of PEOPLE.entries()) {
    const values: Record<string, string> = {};
    for (const f of published.schema.fields) {
      if (f.type === "customer_name") values[f.id] = name;
      else if (f.type === "customer_email") values[f.id] = email;
      else if (f.type === "order_reference") values[f.id] = `#${1001 + i}`;
      else if (f.type === "checkbox") values[f.id] = "yes";
      else if (f.options?.length) values[f.id] = f.options[0].value;
      else if (f.visibility === "admin") values[f.id] = f.defaultValue ?? "";
    }
    const { request, duplicate } = await createWithdrawalRequest({
      shop,
      formVersionId: published.version.id,
      schema: published.schema,
      values,
      idempotencyKey: `demo-${Date.now()}-${i}`,
      locale: shop.settings.defaultLocale,
      skipEmails: true,
    });
    if (duplicate) continue;
    // Spread over the last ~10 days with a mix of statuses.
    await prisma.withdrawalRequest.update({
      where: { id: request.id },
      data: { status: STATUSES[i], submittedAt: new Date(Date.now() - i * 31 * 60 * 60 * 1000) },
    });
    created++;
  }
  return created;
}
