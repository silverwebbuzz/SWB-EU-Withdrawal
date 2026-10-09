import { STATUS_LABELS, STATUS_TONES, type RequestStatusValue } from "../lib/status";

export function StatusBadge({ status, archived }: { status: RequestStatusValue; archived?: boolean }) {
  return (
    <s-stack direction="inline" gap="small-200">
      <s-badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</s-badge>
      {archived ? <s-badge tone="neutral">{STATUS_LABELS.ARCHIVED}</s-badge> : null}
    </s-stack>
  );
}

export function VerificationBadge({ value }: { value: "VERIFIED" | "UNVERIFIED" | "NOT_FOUND" }) {
  if (value === "VERIFIED") return <s-badge tone="success">Order verified</s-badge>;
  if (value === "NOT_FOUND") return <s-badge tone="warning">Order not matched</s-badge>;
  return <s-badge tone="neutral">Unverified</s-badge>;
}
