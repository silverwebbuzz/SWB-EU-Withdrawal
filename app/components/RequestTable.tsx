import { StatusBadge, VerificationBadge } from "./StatusBadge";
import type { RequestStatusValue } from "../lib/status";
import { formatDateTime } from "../lib/timezone";

export interface RequestRow {
  id: string;
  requestNumber: string;
  customerName: string | null;
  customerEmail: string;
  orderReference: string | null;
  orderVerification: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND";
  status: RequestStatusValue;
  submittedAt: string | Date;
  archivedAt: string | Date | null;
}

export function RequestTable({
  rows,
  timeZone,
  emptyHeading,
  emptyText,
}: {
  rows: RequestRow[];
  timeZone: string;
  emptyHeading: string;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <s-box padding="large-200">
        <s-stack direction="block" gap="small-200" alignItems="center">
          <s-icon type="order" />
          <s-heading>{emptyHeading}</s-heading>
          <s-paragraph color="subdued">{emptyText}</s-paragraph>
        </s-stack>
      </s-box>
    );
  }
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Customer</s-table-header>
        <s-table-header>Date / time</s-table-header>
        <s-table-header listSlot="secondary">Order</s-table-header>
        <s-table-header>Reference</s-table-header>
        <s-table-header listSlot="inline">Status</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => (
          <s-table-row key={r.id} clickDelegate={`req-${r.id}`}>
            <s-table-cell>
              <s-stack direction="block" gap="none">
                <s-link id={`req-${r.id}`} href={`/app/withdrawals/${r.id}`}>
                  {r.customerName || r.customerEmail}
                </s-link>
                {r.customerName ? <s-text color="subdued">{r.customerEmail}</s-text> : null}
              </s-stack>
            </s-table-cell>
            <s-table-cell>{formatDateTime(r.submittedAt, timeZone)}</s-table-cell>
            <s-table-cell>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text>{r.orderReference || "—"}</s-text>
                <VerificationBadge value={r.orderVerification} />
              </s-stack>
            </s-table-cell>
            <s-table-cell>{r.requestNumber}</s-table-cell>
            <s-table-cell>
              <StatusBadge status={r.status} archived={Boolean(r.archivedAt)} />
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
