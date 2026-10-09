// CSV export of the currently filtered requests. Authenticated and scoped to
// the session's shop; cells are formula-injection safe (see lib/csv.ts).
import type { LoaderFunctionArgs } from "react-router";
import { requireAdmin } from "../lib/admin-context.server";
import { exportRequests, parseFilters } from "../models/request.server";
import { toCsv } from "../lib/csv";
import { STATUS_LABELS } from "../lib/status";
import { formatDateTime } from "../lib/timezone";

function answerToText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, timeZone } = await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params, params.get("archived") === "1");
  const rows = await exportRequests(shop.id, filters, timeZone);

  // One column per field label seen across the exported requests (stable order).
  const answerColumns: string[] = [];
  for (const r of rows) {
    for (const a of r.answers) {
      const key = `${a.label} [${a.fieldId}]`;
      if (!answerColumns.includes(key)) answerColumns.push(key);
    }
  }

  const header = [
    "Reference",
    "Submitted at",
    "Time zone",
    "Status",
    "Archived",
    "Customer name",
    "Customer email",
    "Order reference",
    "Order verification",
    ...answerColumns,
  ];
  const body = rows.map((r) => {
    const answers = new Map(r.answers.map((a) => [`${a.label} [${a.fieldId}]`, answerToText(a.value)]));
    return [
      r.requestNumber,
      formatDateTime(r.submittedAt, timeZone),
      timeZone,
      STATUS_LABELS[r.status],
      r.archivedAt ? "yes" : "no",
      r.customerName ?? "",
      r.customerEmail,
      r.orderReference ?? "",
      r.orderVerification,
      ...answerColumns.map((c) => answers.get(c) ?? ""),
    ];
  });

  return new Response(toCsv(header, body), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="withdrawals.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
