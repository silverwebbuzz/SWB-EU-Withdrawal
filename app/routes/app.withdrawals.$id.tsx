import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { describeActor, requireAdmin } from "../lib/admin-context.server";
import {
  addNote,
  changeStatus,
  getRequestDetail,
  RequestNotFoundError,
  setArchived,
} from "../models/request.server";
import { retryEmail } from "../models/email.server";
import { isRequestStatus, REQUEST_STATUSES, STATUS_LABELS } from "../lib/status";
import { formatDateTime } from "../lib/timezone";
import { StatusBadge, VerificationBadge } from "../components/StatusBadge";

const inputValue = (e: Event) => (e.currentTarget as unknown as { value: string }).value;
const inputChecked = (e: Event) => (e.currentTarget as unknown as { checked: boolean }).checked;

function answerText(value: unknown, fieldType: string): string {
  if (Array.isArray(value)) return value.join(", ");
  if (fieldType === "checkbox") return value === "yes" ? "Yes" : "No";
  return String(value ?? "");
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, settings, timeZone } = await requireAdmin(request);
  let detail;
  try {
    detail = await getRequestDetail(shop.id, params.id ?? "");
  } catch (error) {
    if (error instanceof RequestNotFoundError) throw new Response("Not found", { status: 404 });
    throw error;
  }

  let periodHint: string | null = null;
  if (detail.orderProcessedAt) {
    const days = Math.floor((detail.submittedAt.getTime() - detail.orderProcessedAt.getTime()) / 86_400_000);
    periodHint =
      `Submitted ${days} day(s) after the order was placed (configured period: ${settings.withdrawalPeriodDays} days). ` +
      "The legally relevant start date is often delivery, not order date — check before deciding.";
  }

  return {
    timeZone,
    periodHint,
    statusEmailsEnabled: settings.sendStatusChangeEmails,
    request: {
      id: detail.id,
      requestNumber: detail.requestNumber,
      status: detail.status,
      archived: Boolean(detail.archivedAt),
      customerName: detail.customerName,
      customerEmail: detail.customerEmail,
      orderReference: detail.orderReference,
      orderVerification: detail.orderVerification,
      shopifyOrderId: detail.shopifyOrderId,
      orderTaggedAt: detail.orderTaggedAt ? formatDateTime(detail.orderTaggedAt, timeZone) : null,
      loggedInCustomer: Boolean(detail.shopifyCustomerId),
      submittedAt: formatDateTime(detail.submittedAt, timeZone),
      formVersion: detail.formVersion?.version ?? null,
      locale: detail.locale,
    },
    answers: detail.answers.map((a) => ({
      id: a.id,
      label: a.label,
      text: answerText(a.value, a.fieldType),
      adminOnly: a.adminOnly,
    })),
    history: detail.statusHistory.map((h) => ({
      id: h.id,
      event: h.event,
      from: h.fromStatus,
      to: h.toStatus,
      actor: describeActor(h.actor),
      at: formatDateTime(h.createdAt, timeZone),
    })),
    notes: detail.notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: describeActor(n.author),
      at: formatDateTime(n.createdAt, timeZone),
    })),
    emails: detail.emailLogs.map((e) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      attempts: e.attempts,
      lastError: e.lastError,
      at: formatDateTime(e.sentAt ?? e.createdAt, timeZone),
    })),
  };
};

type ActionResult = { ok: boolean; message: string };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { shop, actor } = await requireAdmin(request);
  const id = params.id ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "status": {
        const to = form.get("status");
        if (!isRequestStatus(to)) return data<ActionResult>({ ok: false, message: "Invalid status" }, { status: 400 });
        const result = await changeStatus(shop, id, to, actor, { notifyCustomer: form.get("notify") === "true" });
        return { ok: true, message: result.changed ? `Status changed to ${STATUS_LABELS[to]}` : "Status unchanged" };
      }
      case "note": {
        const result = await addNote(shop.id, id, String(form.get("body") ?? ""), actor);
        return result.ok ? { ok: true, message: "Note added" } : data<ActionResult>({ ok: false, message: result.error }, { status: 400 });
      }
      case "archive":
      case "restore":
        await setArchived(shop.id, id, intent === "archive", actor);
        return { ok: true, message: intent === "archive" ? "Request archived" : "Request restored" };
      case "retry_email": {
        const ok = await retryEmail(shop.id, String(form.get("emailId") ?? ""));
        return { ok, message: ok ? "Email re-queued" : "Email cannot be retried" };
      }
      default:
        return data<ActionResult>({ ok: false, message: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof RequestNotFoundError) throw new Response("Not found", { status: 404 });
    return data<ActionResult>({ ok: false, message: (error as Error).message }, { status: 409 });
  }
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Submitted",
  STATUS_CHANGE: "Status changed",
  ARCHIVED: "Archived",
  RESTORED: "Restored from archive",
};

const EMAIL_TONES = { SENT: "success", PENDING: "info", SENDING: "info", FAILED: "warning", DEAD: "critical" } as const;

export default function RequestDetail() {
  const { request: r, answers, history, notes, emails, timeZone, periodHint, statusEmailsEnabled } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const submit = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" });

  return (
    <s-page heading={`Withdrawal ${r.requestNumber}`} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={r.archived ? "/app/archive" : "/app/withdrawals"}>
        {r.archived ? "Archive" : "Withdrawals"}
      </s-link>
      <s-button
        slot="secondary-actions"
        onClick={() => submit({ intent: r.archived ? "restore" : "archive" })}
        disabled={busy}
      >
        {r.archived ? "Restore" : "Archive"}
      </s-button>

      <s-banner tone="info">
        A withdrawal request is a customer notice, not a processed return or refund. Handle returns and refunds in
        Shopify as usual.
      </s-banner>

      <s-section heading="Submission">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <StatusBadge status={r.status} archived={r.archived} />
            <s-text color="subdued">
              Received {r.submittedAt} ({timeZone})
              {r.formVersion ? ` · form version ${r.formVersion}` : ""}
              {r.locale ? ` · language ${r.locale}` : ""}
            </s-text>
          </s-stack>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header listSlot="labeled">Field</s-table-header>
              <s-table-header listSlot="primary">Answer</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {answers.map((a) => (
                <s-table-row key={a.id}>
                  <s-table-cell>
                    {a.label}
                    {a.adminOnly ? " (admin only)" : ""}
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ whiteSpace: "pre-wrap" }}>{a.text || "—"}</span>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section heading="Internal notes">
        <s-stack direction="block" gap="base">
          {/* Keyed by note count so the input clears once a note is saved. */}
          <NoteInput key={notes.length} busy={busy} onSubmit={(body) => submit({ intent: "note", body })} />
          {notes.length === 0 ? <s-text color="subdued">No notes yet.</s-text> : null}
          {notes.map((n) => (
            <s-box key={n.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small-200">
                <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
                <s-text color="subdued">
                  {n.author} · {n.at}
                </s-text>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Status history">
        <s-unordered-list>
          {history.map((h) => (
            <s-list-item key={h.id}>
              <s-text type="strong">{EVENT_LABELS[h.event] ?? h.event}</s-text>
              {h.event === "STATUS_CHANGE" && h.from && h.to
                ? `: ${STATUS_LABELS[h.from]} → ${STATUS_LABELS[h.to]}`
                : ""}{" "}
              · {h.actor} · {h.at}
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Customer">
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{r.customerName || "—"}</s-text>
          <s-link href={`mailto:${r.customerEmail}`}>{r.customerEmail}</s-link>
          <s-text color="subdued">{r.loggedInCustomer ? "Submitted while logged in" : "Submitted as guest"}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Order">
        <s-stack direction="block" gap="small-200">
          <s-text>{r.orderReference || "—"}</s-text>
          <VerificationBadge value={r.orderVerification} />
          {r.shopifyOrderId ? (
            <s-link
              href={`shopify://admin/orders/${r.shopifyOrderId.split("/").pop()}`}
              target="_blank"
            >
              Open order in Shopify
            </s-link>
          ) : (
            <s-text color="subdued">
              {r.orderVerification === "NOT_FOUND"
                ? "No order with this number and email was found (or it is older than 60 days)."
                : "The order reference was not verified. Check it manually."}
            </s-text>
          )}
          {r.orderTaggedAt ? <s-text color="subdued">Order tagged {r.orderTaggedAt}</s-text> : null}
          {periodHint ? <s-text color="subdued">{periodHint}</s-text> : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Status">
        <StatusControl
          key={r.status}
          current={r.status}
          busy={busy}
          statusEmailsEnabled={statusEmailsEnabled}
          onSubmit={(status, notify) => submit({ intent: "status", status, notify: String(notify) })}
        />
      </s-section>

      <s-section slot="aside" heading="Emails">
        <s-stack direction="block" gap="small-200">
          {emails.length === 0 ? <s-text color="subdued">No emails for this request.</s-text> : null}
          {emails.map((e) => (
            <s-stack key={e.id} direction="block" gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={EMAIL_TONES[e.status]}>{e.status}</s-badge>
                <s-text>{e.kind.replace(/_/g, " ").toLowerCase()}</s-text>
              </s-stack>
              <s-text color="subdued">
                {e.at} · {e.attempts} attempt(s)
              </s-text>
              {e.lastError ? <s-text tone="critical">{e.lastError}</s-text> : null}
              {e.status === "FAILED" || e.status === "DEAD" ? (
                <s-button variant="tertiary" onClick={() => submit({ intent: "retry_email", emailId: e.id })}>
                  Retry now
                </s-button>
              ) : null}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function NoteInput({ busy, onSubmit }: { busy: boolean; onSubmit: (body: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <>
      <s-text-area
        label="Add a note (never shown to the customer)"
        value={note}
        rows={3}
        maxLength={5000}
        onInput={(e) => setNote(inputValue(e as unknown as Event))}
      />
      <s-stack direction="inline">
        <s-button onClick={() => onSubmit(note)} disabled={busy || !note.trim()}>
          Add note
        </s-button>
      </s-stack>
    </>
  );
}

function StatusControl({
  current,
  busy,
  statusEmailsEnabled,
  onSubmit,
}: {
  current: string;
  busy: boolean;
  statusEmailsEnabled: boolean;
  onSubmit: (status: string, notify: boolean) => void;
}) {
  const [status, setStatus] = useState(current);
  const [notify, setNotify] = useState(false);
  return (
    <s-stack direction="block" gap="base">
      <s-select label="Status" value={status} onChange={(e) => setStatus(inputValue(e as unknown as Event))}>
        {REQUEST_STATUSES.map((s) => (
          <s-option key={s} value={s}>
            {STATUS_LABELS[s]}
          </s-option>
        ))}
      </s-select>
      {statusEmailsEnabled ? (
        <s-checkbox
          label="Email the customer about this change"
          checked={notify}
          onChange={(e) => setNotify(inputChecked(e as unknown as Event))}
        />
      ) : (
        <s-text color="subdued">Status-change emails are off (Settings).</s-text>
      )}
      <s-button variant="primary" disabled={busy || status === current} onClick={() => onSubmit(status, notify)}>
        Update status
      </s-button>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
