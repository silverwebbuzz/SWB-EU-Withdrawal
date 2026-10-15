import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../lib/admin-context.server";
import { getDashboard } from "../models/request.server";
import { getDefaultForm } from "../models/form.server";
import { useState, useSyncExternalStore } from "react";
import type { RequestRow } from "../components/RequestTable";
import { StatusBadge } from "../components/StatusBadge";
import { formatDateAndTime } from "../lib/timezone";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, settings, timeZone } = await requireAdmin(request);
  const [dashboard, form] = await Promise.all([
    getDashboard(shop.id, timeZone),
    getDefaultForm(shop.id, settings.defaultFormId),
  ]);
  const checklist = [
    { label: "Withdrawal form published", done: Boolean(form.publishedVersionId), href: "/app/form-builder" },
    { label: "Withdrawal button added to your theme", done: settings.setupBlockConfirmed, href: "/app/help" },
    { label: "Storefront form opened at least once", done: Boolean(shop.proxyLastSeenAt), href: "/app/help" },
    { label: "Notification recipients configured", done: Boolean(settings.merchantNotificationEmails), href: "/app/settings" },
    { label: "Settings reviewed with legal counsel", done: settings.setupLegalReviewed, href: "/app/settings" },
  ];
  return { ...dashboard, timeZone, checklist };
};

type Tone = "warning" | "info" | "success";

function SummaryCard({ icon, tone, label, text }: { icon: "clock" | "calendar" | "check-circle"; tone: Tone; label: string; text: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="large">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-icon type={icon} tone={tone} />
        </s-box>
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline">
            <s-badge tone={tone}>{label}</s-badge>
          </s-stack>
          <s-text>{text}</s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0][0]).toUpperCase();
}

function orderHref(r: RequestRow): string {
  if (r.shopifyOrderId) return `shopify://admin/orders/${r.shopifyOrderId.split("/").pop()}`;
  return `shopify://admin/orders?query=${encodeURIComponent(r.orderReference ?? "")}`;
}

function RecentTable({ rows, timeZone }: { rows: RequestRow[]; timeZone: string }) {
  if (rows.length === 0) {
    return (
      <s-box padding="large-200">
        <s-stack direction="block" gap="small-200" alignItems="center">
          <s-icon type="order" />
          <s-heading>No withdrawal requests yet</s-heading>
          <s-paragraph color="subdued">Requests submitted through your storefront form will appear here.</s-paragraph>
        </s-stack>
      </s-box>
    );
  }
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Customer</s-table-header>
        <s-table-header>Date</s-table-header>
        <s-table-header listSlot="secondary">Order</s-table-header>
        <s-table-header listSlot="inline">Status</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((r) => {
          const name = r.customerName || r.customerEmail;
          const { date, time } = formatDateAndTime(r.submittedAt, timeZone);
          return (
            <s-table-row key={r.id} clickDelegate={`req-${r.id}`}>
              <s-table-cell>
                <s-stack direction="inline" gap="small-300" alignItems="center">
                  <s-avatar initials={initials(name)} alt={name} size="small" />
                  <s-stack direction="block" gap="none">
                    <s-link id={`req-${r.id}`} href={`/app/withdrawals/${r.id}`}>
                      {name}
                    </s-link>
                    {r.customerName ? <s-text color="subdued">{r.customerEmail}</s-text> : null}
                  </s-stack>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-stack direction="block" gap="none">
                  <s-text>{date}</s-text>
                  <s-text color="subdued">{time}</s-text>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                {r.orderReference ? (
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <s-link href={orderHref(r)} target="_blank" accessibilityLabel={`Open order ${r.orderReference} in Shopify admin`}>
                      <s-icon type="external" />
                    </s-link>
                    <s-text>{r.orderReference}</s-text>
                  </s-stack>
                ) : (
                  <s-text color="subdued">—</s-text>
                )}
              </s-table-cell>
              <s-table-cell>
                <StatusBadge status={r.status} archived={Boolean(r.archivedAt)} />
              </s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}

const TIP_KEY = "overview-tip-dismissed";

const noopSubscribe = () => () => {};

function readTipDismissed(): boolean {
  try {
    return window.localStorage.getItem(TIP_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Overview() {
  const { counts, recent, timeZone, checklist } = useLoaderData<typeof loader>();
  const remaining = checklist.filter((c) => !c.done);
  const [dismissed, setDismissed] = useState(false);
  const storedDismissed = useSyncExternalStore(noopSubscribe, readTipDismissed, () => true);
  const tipHidden = dismissed || storedDismissed;

  const dismissTip = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Storage unavailable; the tip just reappears next visit.
    }
  };

  return (
    <s-page heading="Overview">
      <s-button slot="primary-action" variant="primary" href="/app/withdrawals">
        Open all withdrawals
      </s-button>
      <s-button slot="secondary-actions" href="/app/settings">
        Settings
      </s-button>

      {remaining.length > 0 ? (
        <s-banner heading={`Setup: ${checklist.length - remaining.length} of ${checklist.length} steps done`} tone="info">
          <s-unordered-list>
            {remaining.map((c) => (
              <s-list-item key={c.label}>
                <s-link href={c.href}>{c.label}</s-link>
              </s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      ) : null}

      <s-section>
        <s-grid gridTemplateColumns="@container (inline-size > 600px) 1fr 1fr 1fr, 1fr" gap="base">
          <SummaryCard icon="clock" tone="warning" label="Open" text={`${counts.open} Open withdrawals`} />
          <SummaryCard icon="calendar" tone="info" label="Today" text={`${counts.today} Received today`} />
          <SummaryCard icon="check-circle" tone="success" label="Done" text={`${counts.done} Processed`} />
        </s-grid>
      </s-section>

      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>Recent withdrawal requests</s-heading>
              <s-text color="subdued">The latest 5 submitted requests</s-text>
            </s-stack>
            <s-button icon="arrow-right" href="/app/withdrawals">
              Show all
            </s-button>
          </s-stack>
        </s-box>
        <RecentTable rows={recent} timeZone={timeZone} />
      </s-section>

      {tipHidden ? null : (
        <s-banner tone="info" dismissible onDismiss={dismissTip}>
          <s-text type="strong">Tip:</s-text> Use the full overview under &apos;Withdrawals&apos; to manage all requests
          with advanced filter and search functions.
        </s-banner>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
