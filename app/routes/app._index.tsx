import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../lib/admin-context.server";
import { getDashboard } from "../models/request.server";
import { getDefaultForm } from "../models/form.server";
import { RequestTable } from "../components/RequestTable";

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

function SummaryCard({ heading, value, hint }: { heading: string; value: number; hint: string }) {
  return (
    <s-section>
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{heading}</s-text>
        <s-heading>
          <span style={{ fontSize: "1.75rem" }}>{value}</span>
        </s-heading>
        <s-text color="subdued">{hint}</s-text>
      </s-stack>
    </s-section>
  );
}

export default function Overview() {
  const { counts, recent, timeZone, checklist } = useLoaderData<typeof loader>();
  const remaining = checklist.filter((c) => !c.done);

  return (
    <s-page heading="Overview">
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

      <s-grid gridTemplateColumns="@container (inline-size > 600px) 1fr 1fr 1fr, 1fr" gap="base">
        <SummaryCard heading="Open withdrawals" value={counts.open} hint="Requested, in review or approved" />
        <SummaryCard heading="Received today" value={counts.today} hint={`Calendar day in ${timeZone}`} />
        <SummaryCard heading="Processed / done" value={counts.done} hint="Completed or rejected, incl. archived" />
      </s-grid>

      <s-section heading="Recent withdrawal requests" padding="none">
        <RequestTable
          rows={recent}
          timeZone={timeZone}
          emptyHeading="No withdrawal requests yet"
          emptyText="Requests submitted through your storefront form will appear here."
        />
        <s-box padding="base">
          <s-button href="/app/withdrawals">Show all</s-button>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
