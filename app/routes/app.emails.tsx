import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { EmailTemplateKind } from "@prisma/client";
import prisma from "../db.server";
import { requireAdmin } from "../lib/admin-context.server";
import { enqueueTestEmail, getTemplates, processEmailQueue, resetTemplate, updateTemplate } from "../models/email.server";
import { emailProviderStatus } from "../services/email-provider.server";
import {
  SAMPLE_CONTEXT,
  TEMPLATE_KIND_LABELS,
  TEMPLATE_VARIABLES,
  findUnknownVariables,
  renderSubject,
  renderText,
  type TemplateKind,
} from "../lib/email-template";
import { randomNonce } from "../lib/signing.server";
import { formatDateTime } from "../lib/timezone";

const val = (e: unknown) => (e as { currentTarget: { value: string } }).currentTarget.value;
const checked = (e: unknown) => (e as { currentTarget: { checked: boolean } }).currentTarget.checked;
const KINDS = Object.keys(TEMPLATE_KIND_LABELS) as TemplateKind[];
const isKind = (v: unknown): v is EmailTemplateKind => typeof v === "string" && (KINDS as string[]).includes(v);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, timeZone } = await requireAdmin(request);
  const [templates, logs] = await Promise.all([
    getTemplates(shop.id),
    prisma.emailLog.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, kind: true, status: true, attempts: true, lastError: true, createdAt: true, subject: true },
    }),
  ]);
  return {
    templates: templates.map((t) => ({ kind: t.kind, subject: t.subject, body: t.body, enabled: t.enabled })),
    provider: emailProviderStatus(),
    defaultTestRecipient: shop.contactEmail ?? "",
    shopName: shop.name ?? shop.shopDomain,
    logs: logs.map((l) => ({ ...l, createdAt: formatDateTime(l.createdAt, timeZone) })),
  };
};

type ActionResult = { ok: boolean; message: string; errors?: string[] };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const kind = form.get("kind");
  if (!isKind(kind)) return data<ActionResult>({ ok: false, message: "Unknown template" }, { status: 400 });

  if (intent === "save") {
    const result = await updateTemplate(shop.id, kind, {
      subject: String(form.get("subject") ?? ""),
      body: String(form.get("body") ?? ""),
      enabled: form.get("enabled") === "true",
    });
    return result.ok
      ? { ok: true, message: "Template saved" }
      : data<ActionResult>({ ok: false, message: "Template not saved", errors: result.errors }, { status: 422 });
  }
  if (intent === "reset") {
    await resetTemplate(shop.id, kind);
    return { ok: true, message: "Template reset to default" };
  }
  if (intent === "test") {
    const to = String(form.get("to") ?? "").trim();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) {
      return data<ActionResult>({ ok: false, message: "Enter a valid test recipient" }, { status: 400 });
    }
    const subject = String(form.get("subject") ?? "");
    const body = String(form.get("body") ?? "");
    const unknown = [...findUnknownVariables(subject), ...findUnknownVariables(body)];
    if (unknown.length) {
      return data<ActionResult>({ ok: false, message: `Unknown variables: ${unknown.join(", ")}` }, { status: 422 });
    }
    const row = await enqueueTestEmail(shop.id, {
      kind,
      to,
      subject,
      body,
      ctx: { ...SAMPLE_CONTEXT, shop_name: shop.name ?? shop.shopDomain },
      nonce: randomNonce(),
    });
    if (row) await processEmailQueue({ ids: [row.id] });
    const sent = row ? await prisma.emailLog.findUnique({ where: { id: row.id } }) : null;
    return sent?.status === "SENT"
      ? { ok: true, message: `Test email processed (${emailProviderStatus().provider})` }
      : { ok: false, message: `Test email failed: ${sent?.lastError ?? "unknown error"}` };
  }
  return data<ActionResult>({ ok: false, message: "Unknown action" }, { status: 400 });
};

const STATUS_TONE = { SENT: "success", PENDING: "info", SENDING: "info", FAILED: "warning", DEAD: "critical" } as const;

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;
type TemplateRow = LoaderData["templates"][number];

export default function EmailEditor() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [kind, setKind] = useState<TemplateKind>("CUSTOMER_CONFIRMATION");
  const [testTo, setTestTo] = useState(data.defaultTestRecipient);
  const current = data.templates.find((t) => t.kind === kind);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Remount the editor with fresh state when switching templates or after a save/reset.
  return (
    <TemplateEditor
      key={`${kind}|${current?.subject}|${current?.body}|${current?.enabled}`}
      data={data}
      current={current}
      kind={kind}
      setKind={setKind}
      testTo={testTo}
      setTestTo={setTestTo}
      fetcher={fetcher}
    />
  );
}

function TemplateEditor({
  data: { provider, shopName, logs },
  current,
  kind,
  setKind,
  testTo,
  setTestTo,
  fetcher,
}: {
  data: LoaderData;
  current: TemplateRow | undefined;
  kind: TemplateKind;
  setKind: (k: TemplateKind) => void;
  testTo: string;
  setTestTo: (v: string) => void;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
}) {
  const [subject, setSubject] = useState(current?.subject ?? "");
  const [body, setBody] = useState(current?.body ?? "");
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const busy = fetcher.state !== "idle";

  const unknown = useMemo(() => [...new Set([...findUnknownVariables(subject), ...findUnknownVariables(body)])], [subject, body]);
  const ctx = { ...SAMPLE_CONTEXT, shop_name: shopName };
  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, kind, subject, body, enabled: String(enabled), ...extra }, { method: "post" });

  return (
    <s-page heading="Email Editor" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => submit("save")} disabled={busy || unknown.length > 0}>
        Save template
      </s-button>
      <s-button slot="secondary-actions" onClick={() => submit("reset")} disabled={busy}>
        Reset to default
      </s-button>

      <s-banner tone={provider.configured ? "success" : "warning"}>{provider.message}</s-banner>
      {fetcher.data?.errors?.length ? (
        <s-banner tone="critical">
          <s-unordered-list>
            {fetcher.data.errors.map((e) => (
              <s-list-item key={e}>{e}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section heading="Template">
        <s-stack direction="block" gap="base">
          <s-select label="Email" value={kind} onChange={(e) => setKind(val(e) as TemplateKind)}>
            {KINDS.map((k) => (
              <s-option key={k} value={k}>
                {TEMPLATE_KIND_LABELS[k]}
              </s-option>
            ))}
          </s-select>
          <s-checkbox
            label={kind === "STATUS_CHANGE" ? "Enabled (also turn on status emails in Settings)" : "Enabled"}
            checked={enabled}
            onChange={(e) => setEnabled(checked(e))}
          />
          <s-text-field label="Subject" value={subject} maxLength={250} onInput={(e) => setSubject(val(e))} />
          <s-text-area
            label="Body (plain text; a blank line starts a new paragraph)"
            rows={14}
            value={body}
            onInput={(e) => setBody(val(e))}
            error={unknown.length ? `Unknown variables: ${unknown.map((v) => `{{${v}}}`).join(", ")}` : undefined}
          />
          <s-text color="subdued">
            Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join("  ")}. Customer data is escaped automatically;
            HTML in templates is shown as text.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Preview (sample data)">
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{renderSubject(subject, ctx)}</s-text>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <span style={{ whiteSpace: "pre-wrap" }}>{renderText(body, ctx)}</span>
          </s-box>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Send a test">
        <s-stack direction="block" gap="base">
          <s-email-field label="Recipient" value={testTo} onInput={(e) => setTestTo(val(e))} />
          <s-button onClick={() => submit("test", { to: testTo })} disabled={busy || unknown.length > 0}>
            Send test email
          </s-button>
          <s-text color="subdued">Uses sample data and the unsaved text above.</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Delivery log">
        {logs.length === 0 ? <s-text color="subdued">No emails yet.</s-text> : null}
        <s-stack direction="block" gap="small-200">
          {logs.map((l) => (
            <s-stack key={l.id} direction="block" gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={STATUS_TONE[l.status]}>{l.status}</s-badge>
                <s-text>{l.kind.replace(/_/g, " ").toLowerCase()}</s-text>
              </s-stack>
              <s-text color="subdued">
                {l.createdAt} · {l.attempts} attempt(s)
              </s-text>
              {l.lastError ? <s-text tone="critical">{l.lastError}</s-text> : null}
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
