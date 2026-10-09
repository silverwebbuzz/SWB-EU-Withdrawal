import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../lib/admin-context.server";
import { getDefaultForm } from "../models/form.server";
import { createDemoRequests, demoDataAllowed } from "../models/demo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, settings } = await requireAdmin(request);
  const form = await getDefaultForm(shop.id, settings.defaultFormId);
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const admin = `https://${shop.shopDomain}/admin/themes/current/editor`;
  return {
    storefrontUrl: `https://${shop.shopDomain}/apps/withdraw`,
    published: Boolean(form.publishedVersionId),
    proxySeen: Boolean(shop.proxyLastSeenAt),
    embedLink: `${admin}?context=apps&activateAppId=${apiKey}/withdrawal_embed`,
    blockLink: `${admin}?template=index&addAppBlockId=${apiKey}/withdrawal_button&target=newAppsSection`,
    demoAllowed: demoDataAllowed(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  if (!demoDataAllowed()) throw new Response("Not found", { status: 404 });
  try {
    return { message: `Created ${await createDemoRequests(shop)} sample requests (no emails sent).` };
  } catch (error) {
    return { message: (error as Error).message };
  }
};

export default function Help() {
  const { storefrontUrl, published, proxySeen, embedLink, blockLink, demoAllowed } = useLoaderData<typeof loader>();
  const demo = useFetcher<typeof action>();
  return (
    <s-page heading="Documentation / Help">
      {demoAllowed ? (
        <s-section heading="Development: sample data">
          <s-stack direction="block" gap="small-200">
            <s-paragraph color="subdued">
              Creates eight sample requests (example.com addresses) to explore the dashboard and inbox. Only available
              when NODE_ENV is not production.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button loading={demo.state !== "idle"} onClick={() => demo.submit({}, { method: "post" })}>
                Create sample requests
              </s-button>
            </s-stack>
            {demo.data?.message ? <s-text>{demo.data.message}</s-text> : null}
          </s-stack>
        </s-section>
      ) : null}
      <s-section heading="1. Publish your withdrawal form">
        <s-paragraph>
          Open the <s-link href="/app/form-builder">Form Builder</s-link>, adjust the fields and texts, preview them and
          click <s-text type="strong">Publish</s-text>. Status: {published ? "published ✓" : "not published"}.
        </s-paragraph>
      </s-section>

      <s-section heading="2. Your storefront form">
        <s-paragraph>
          The form is served on your store domain through a Shopify app proxy and uses your theme&apos;s layout. Customers
          do not need an account:
        </s-paragraph>
        <s-paragraph>
          <s-link href={storefrontUrl} target="_blank">
            {storefrontUrl}
          </s-link>
        </s-paragraph>
        <s-paragraph color="subdued">
          {proxySeen ? "The storefront form has been opened ✓" : "The storefront form has not been opened yet."} If you use
          a custom domain, the same path (/apps/withdraw) works there too. Password-protected development stores require
          the storefront password first.
        </s-paragraph>
      </s-section>

      <s-section heading="3. Add the withdrawal button to your theme">
        <s-paragraph>
          Apps cannot edit your theme automatically. Add the button yourself in the theme editor using one of these
          options (both are part of this app&apos;s theme app extension and do not change theme code):
        </s-paragraph>
        <s-ordered-list>
          <s-list-item>
            <s-text type="strong">Floating button (app embed):</s-text> Theme editor → App embeds → turn on
            &quot;Floating withdrawal button&quot; → Save.{" "}
            <s-link href={embedLink} target="_blank">
              Open theme editor
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Button in a section (app block):</s-text> Theme editor → choose a section (for example
            the footer) → Add block → Apps → &quot;Withdrawal button&quot; → Save.{" "}
            <s-link href={blockLink} target="_blank">
              Add to home page
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Plain link:</s-text> add a menu item (Online Store → Navigation, e.g. footer menu) that
            points to <code>/apps/withdraw</code>.
          </s-list-item>
        </s-ordered-list>
        <s-paragraph color="subdued">
          After adding it, confirm the step in <s-link href="/app/settings">Settings → Setup checklist</s-link>. The app
          cannot read your theme to detect this.
        </s-paragraph>
      </s-section>

      <s-section heading="How a withdrawal works">
        <s-ordered-list>
          <s-list-item>The customer opens the form, enters their details and order number, and continues.</s-list-item>
          <s-list-item>A review page shows all answers. Nothing is submitted until the customer confirms.</s-list-item>
          <s-list-item>
            On confirmation the request is stored with a unique reference number (e.g. WD-000123) and timestamp, and the
            customer sees a success page.
          </s-list-item>
          <s-list-item>
            The customer receives a confirmation email; you receive a notification. Delivery is logged and retried.
          </s-list-item>
          <s-list-item>
            You review the request under Withdrawals, add notes and change its status. Returns and refunds are handled in
            Shopify as usual — the app never refunds or cancels orders.
          </s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section heading="Data and privacy">
        <s-unordered-list>
          <s-list-item>Stored: submitted form answers, name, email, order reference, timestamps, status history, notes, email delivery status.</s-list-item>
          <s-list-item>Not stored: IP addresses (only a keyed hash for rate limiting, deleted after 24 hours), payment data.</s-list-item>
          <s-list-item>Shopify privacy webhooks are handled: customer data requests are listed in Settings; customer and shop redaction delete the data.</s-list-item>
          <s-list-item>Optional automatic deletion of archived requests can be configured in Settings.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Legal note">
        <s-paragraph>
          The EU electronic withdrawal-function requirement (Directive (EU) 2023/2673) applies from 19 June 2026. Which
          contracts it covers, applicable periods and exceptions depend on your business, products and the
          customer&apos;s country. This app provides workflow tools and does not guarantee legal compliance. Please have
          your setup reviewed by qualified counsel. See also Shopify&apos;s{" "}
          <s-link href="https://help.shopify.com/en/manual/compliance/legal/eu-right-of-withdrawal" target="_blank">
            EU right of withdrawal guidance
          </s-link>
          .
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
