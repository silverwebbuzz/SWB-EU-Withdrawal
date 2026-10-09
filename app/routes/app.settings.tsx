import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";
import { requireAdmin } from "../lib/admin-context.server";
import { updateSettings } from "../models/shop.server";
import { writeButtonConfig } from "../models/app-metafield.server";
import { listPrivacyRequests } from "../models/privacy.server";
import { LOCALES, LOCALE_LABELS } from "../lib/i18n";
import { isValidTimeZone, formatDateTime } from "../lib/timezone";

const val = (e: unknown) => (e as { currentTarget: { value: string } }).currentTarget.value;
const checked = (e: unknown) => (e as { currentTarget: { checked: boolean } }).currentTarget.checked;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1a1a1a");
const emailList = z
  .string()
  .max(1000)
  .refine(
    (s) => s.split(",").map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)),
    "Enter valid email addresses separated by commas",
  );
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const settingsSchema = z.object({
  timezoneOverride: z.string().max(64).refine((v) => v === "" || isValidTimeZone(v), "Unknown IANA time zone"),
  defaultLocale: z.enum(LOCALES),
  buttonLabel: z.string().trim().min(1, "Button label is required").max(100),
  buttonHelpText: z.string().max(500),
  buttonBgColor: hex,
  buttonTextColor: hex,
  merchantNotificationEmails: emailList,
  replyToEmail: z.string().max(254).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Invalid email"),
  sendStatusChangeEmails: bool,
  withdrawalPeriodDays: z.coerce.number().int().min(1).max(365),
  withdrawalPeriodNote: z.string().max(1000),
  orderLookupEnabled: bool,
  orderTaggingEnabled: bool,
  orderTag: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N} _.-]+$/u, "Letters, digits, spaces, - _ . only"),
  rateLimitPerHour: z.coerce.number().int().min(1).max(100),
  minFillSeconds: z.coerce.number().int().min(0).max(60),
  retentionDays: z.coerce.number().int().min(0).max(3650),
  setupBlockConfirmed: bool,
  setupLegalReviewed: bool,
});

type SettingsForm = z.input<typeof settingsSchema>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, settings, timeZone, scopes } = await requireAdmin(request);
  let granted: string[] = [];
  try {
    granted = (await scopes.query()).granted;
  } catch (error) {
    console.error("[settings] Could not query granted scopes:", (error as Error).message);
  }
  const privacy = await listPrivacyRequests(shop.id);
  return {
    shop: { name: shop.name, domain: shop.shopDomain, shopifyTimezone: shop.ianaTimezone, effectiveTimezone: timeZone },
    granted,
    privacy: privacy.map((p) => ({ ...p, createdAt: formatDateTime(p.createdAt, timeZone) })),
    form: {
      timezoneOverride: settings.timezoneOverride ?? "",
      defaultLocale: settings.defaultLocale,
      buttonLabel: settings.buttonLabel,
      buttonHelpText: settings.buttonHelpText ?? "",
      buttonBgColor: settings.buttonBgColor,
      buttonTextColor: settings.buttonTextColor,
      merchantNotificationEmails: settings.merchantNotificationEmails ?? "",
      replyToEmail: settings.replyToEmail ?? "",
      sendStatusChangeEmails: String(settings.sendStatusChangeEmails),
      withdrawalPeriodDays: String(settings.withdrawalPeriodDays),
      withdrawalPeriodNote: settings.withdrawalPeriodNote ?? "",
      orderLookupEnabled: String(settings.orderLookupEnabled),
      orderTaggingEnabled: String(settings.orderTaggingEnabled),
      orderTag: settings.orderTag,
      rateLimitPerHour: String(settings.rateLimitPerHour),
      minFillSeconds: String(settings.minFillSeconds),
      retentionDays: String(settings.retentionDays),
      setupBlockConfirmed: String(settings.setupBlockConfirmed),
      setupLegalReviewed: String(settings.setupLegalReviewed),
    } satisfies Record<keyof SettingsForm, string>,
  };
};

type ActionResult = { ok: boolean; message: string; fieldErrors?: Record<string, string> };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, scopes } = await requireAdmin(request);
  const parsed = settingsSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return data<ActionResult>({ ok: false, message: "Please fix the highlighted fields", fieldErrors }, { status: 422 });
  }
  const s = parsed.data;

  // Optional scopes must actually be granted before enabling dependent features.
  if (s.orderLookupEnabled || s.orderTaggingEnabled) {
    const { granted } = await scopes.query();
    if (s.orderLookupEnabled && !granted.includes("read_orders") && !granted.includes("write_orders")) {
      return data<ActionResult>(
        { ok: false, message: "Order lookup needs the read_orders permission. Grant it and save again." },
        { status: 403 },
      );
    }
    if (s.orderTaggingEnabled && !granted.includes("write_orders")) {
      return data<ActionResult>(
        { ok: false, message: "Order tagging needs the write_orders permission. Grant it and save again." },
        { status: 403 },
      );
    }
  }

  await updateSettings(shop.id, {
    ...s,
    timezoneOverride: s.timezoneOverride || null,
    buttonHelpText: s.buttonHelpText || null,
    merchantNotificationEmails: s.merchantNotificationEmails
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join(", "),
    replyToEmail: s.replyToEmail || null,
    withdrawalPeriodNote: s.withdrawalPeriodNote || null,
  });

  const metafieldError = await writeButtonConfig(admin, {
    label: s.buttonLabel,
    help_text: s.buttonHelpText,
    bg: s.buttonBgColor,
    fg: s.buttonTextColor,
  }).catch((e: Error) => e.message);
  if (metafieldError) {
    return { ok: false, message: `Settings saved, but the storefront button defaults could not be synced: ${metafieldError}` };
  }
  return { ok: true, message: "Settings saved" };
};

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.state, fetcher.data, shopify]);

  // Remount with the persisted values whenever they change on the server.
  return <SettingsForm key={JSON.stringify(data.form)} data={data} fetcher={fetcher} />;
}

function SettingsForm({
  data: { shop, granted, privacy, form: initial },
  fetcher,
}: {
  data: LoaderData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
}) {
  const shopify = useAppBridge();
  const [form, setForm] = useState(initial);
  const [scopeMessage, setScopeMessage] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  const errors = fetcher.data?.fieldErrors ?? {};

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof typeof form, label: string, details?: string) => (
    <s-text-field label={label} details={details} value={form[key]} error={errors[key]} onInput={(e) => set(key, val(e))} />
  );
  const toggle = (key: keyof typeof form, label: string, details?: string) => (
    <s-checkbox label={label} details={details} checked={form[key] === "true"} onChange={(e) => set(key, String(checked(e)))} />
  );

  const hasRead = granted.includes("read_orders") || granted.includes("write_orders");
  const hasWrite = granted.includes("write_orders");
  const requestScope = async (scope: "read_orders" | "write_orders") => {
    setScopeMessage(null);
    try {
      const result = await shopify.scopes.request([scope]);
      setScopeMessage(
        result.result === "granted-all"
          ? "Permission granted. Reloading…"
          : "Permission was not granted. The feature stays off.",
      );
      if (result.result === "granted-all") window.location.reload();
    } catch (error) {
      setScopeMessage(`Could not request permission: ${(error as Error).message}`);
    }
  };

  return (
    <s-page heading="Settings">
      <s-button slot="primary-action" variant="primary" disabled={busy} onClick={() => fetcher.submit(form, { method: "post" })}>
        Save
      </s-button>

      <s-banner tone="warning">
        This app provides workflow tools only. You are responsible for configuring the withdrawal period, exceptions and
        wording that apply to your business, products and countries. Please obtain legal advice.
      </s-banner>

      <s-section heading="Store">
        <s-stack direction="block" gap="base">
          <s-text>
            {shop.name ?? shop.domain} · {shop.domain}
          </s-text>
          {text(
            "timezoneOverride",
            "Time zone override (IANA, e.g. Europe/Berlin)",
            `Empty uses your Shopify time zone (${shop.shopifyTimezone}). Currently used: ${shop.effectiveTimezone}. Used for "Received today", dates and filters.`,
          )}
          <s-select label="Customer form language" value={form.defaultLocale} onChange={(e) => set("defaultLocale", val(e))}>
            {LOCALES.map((l) => (
              <s-option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </s-option>
            ))}
          </s-select>
          <s-text color="subdued">
            The theme button passes the storefront language automatically when it is supported. Field labels from the
            Form Builder are shown as entered.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Withdrawal button">
        <s-stack direction="block" gap="base">
          {text("buttonLabel", "Default label")}
          <s-text-area label="Default explanatory text" rows={2} value={form.buttonHelpText} onInput={(e) => set("buttonHelpText", val(e))} />
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-color-field label="Button color" value={form.buttonBgColor} error={errors.buttonBgColor} onChange={(e) => set("buttonBgColor", val(e))} />
            <s-color-field label="Text color" value={form.buttonTextColor} error={errors.buttonTextColor} onChange={(e) => set("buttonTextColor", val(e))} />
          </s-grid>
          <s-text color="subdued">
            These defaults are used by the theme block and the form&apos;s accent color. Individual theme blocks can override them in the theme editor.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Notifications">
        <s-stack direction="block" gap="base">
          {text("merchantNotificationEmails", "New-request notification recipients", "Comma separated")}
          {text("replyToEmail", "Reply-to address for customer emails", "Empty uses your store contact email")}
          {toggle("sendStatusChangeEmails", "Allow status-change emails to customers", "You choose per change whether to notify the customer.")}
        </s-stack>
      </s-section>

      <s-section heading="Withdrawal period (informational)">
        <s-stack direction="block" gap="base">
          {text("withdrawalPeriodDays", "Period shown to customers (days)")}
          <s-text-area
            label="Custom notice text"
            details="Replaces the default sentence shown above the form. Empty uses the translated default."
            rows={2}
            value={form.withdrawalPeriodNote}
            onInput={(e) => set("withdrawalPeriodNote", val(e))}
          />
          <s-text color="subdued">
            A fixed number of days does not cover every product, contract, exception or country. The app never rejects a
            request because of this setting; it is shown to customers and used for hints only.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Orders">
        <s-stack direction="block" gap="base">
          {scopeMessage ? <s-banner tone="info">{scopeMessage}</s-banner> : null}
          {toggle(
            "orderLookupEnabled",
            "Verify order number and email against Shopify orders",
            "Marks requests as verified when the order number and email match. Customers never see order data. Orders older than 60 days cannot be matched.",
          )}
          {!hasRead ? (
            <s-button onClick={() => requestScope("read_orders")}>Grant read_orders permission</s-button>
          ) : (
            <s-text color="subdued">read_orders permission granted.</s-text>
          )}
          {toggle(
            "orderTaggingEnabled",
            "Tag verified orders (off by default)",
            "Adds a tag to the Shopify order when a verified request is submitted. Does not cancel or refund anything.",
          )}
          {text("orderTag", "Order tag")}
          {!hasWrite ? (
            <s-button onClick={() => requestScope("write_orders")}>Grant write_orders permission</s-button>
          ) : (
            <s-text color="subdued">write_orders permission granted.</s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Spam protection">
        <s-stack direction="block" gap="base">
          {text("rateLimitPerHour", "Max submissions per hour per visitor", "Visitors are identified by a keyed hash of their IP; raw IPs are not stored. Hashes are deleted after 24 hours.")}
          {text("minFillSeconds", "Minimum seconds before the form can be reviewed", "Blocks bots that submit instantly. 0 disables.")}
        </s-stack>
      </s-section>

      <s-section heading="Data retention">
        <s-stack direction="block" gap="base">
          {text(
            "retentionDays",
            "Delete archived requests after (days)",
            "0 = keep until deleted. Check your statutory record-keeping obligations before enabling.",
          )}
        </s-stack>
      </s-section>

      <s-section heading="Setup checklist">
        <s-stack direction="block" gap="base">
          {toggle("setupBlockConfirmed", "I added the withdrawal button / app embed in the theme editor")}
          {toggle("setupLegalReviewed", "I reviewed the form, emails and period settings with legal counsel")}
        </s-stack>
      </s-section>

      <s-section heading="Privacy data requests">
        <s-stack direction="block" gap="small-200">
          <s-text color="subdued">
            Created when Shopify sends a customers/data_request webhook. Download the data and provide it to the customer.
          </s-text>
          {privacy.length === 0 ? <s-text color="subdued">No data requests received.</s-text> : null}
          {privacy.map((p) => (
            <s-stack key={p.id} direction="inline" gap="base" alignItems="center">
              <s-text>
                {p.createdAt} · {p.customerEmail ?? "unknown email"} · {p.requestCount} request(s)
              </s-text>
              <s-button
                variant="tertiary"
                onClick={async () => {
                  const response = await fetch(`/app/privacy-export/${encodeURIComponent(p.id)}`);
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `data-request-${p.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download JSON
              </s-button>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
