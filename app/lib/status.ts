export const REQUEST_STATUSES = [
  "REQUESTED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
] as const;

export type RequestStatusValue = (typeof REQUEST_STATUSES)[number];

/** Statuses counted as "open" on the dashboard. */
export const OPEN_STATUSES: readonly RequestStatusValue[] = ["REQUESTED", "IN_REVIEW", "APPROVED"];
/** Statuses counted as "processed / done" on the dashboard. */
export const DONE_STATUSES: readonly RequestStatusValue[] = ["COMPLETED", "REJECTED"];

export const STATUS_LABELS: Record<RequestStatusValue | "ARCHIVED", string> = {
  REQUESTED: "Requested",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export type BadgeTone = "info" | "warning" | "success" | "critical" | "neutral" | "caution";

export const STATUS_TONES: Record<RequestStatusValue | "ARCHIVED", BadgeTone> = {
  REQUESTED: "info",
  IN_REVIEW: "caution",
  APPROVED: "success",
  REJECTED: "critical",
  COMPLETED: "neutral",
  ARCHIVED: "neutral",
};

export function isRequestStatus(value: unknown): value is RequestStatusValue {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value);
}
