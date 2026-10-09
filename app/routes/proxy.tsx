// Customer-facing withdrawal flow, served on the storefront through the Shopify
// app proxy (https://{shop}/apps/withdraw -> this route). Works for guests; no
// login required. Flow: form -> review (signed state) -> confirm -> success.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isLocale, strings, type Locale } from "../lib/i18n";
import { randomNonce, signToken, verifyToken } from "../lib/signing.server";
import {
  HONEYPOT_NAME,
  renderFormPage,
  renderMessagePage,
  renderReviewPage,
  renderSuccessPage,
  type RenderOptions,
} from "../lib/storefront-render";
import {
  extractCoreValues,
  inputName,
  validateSubmission,
  type SubmissionValues,
} from "../lib/submission-validation";
import { formatDateTime } from "../lib/timezone";
import { getFormVersion, getPublishedForm } from "../models/form.server";
import { lookupOrder, tagOrder, type OrderLookupResult } from "../models/order-lookup.server";
import { clientIp, consumeRateLimit } from "../models/rate-limit.server";
import { effectiveTimezone, ensureShop, type ShopWithSettings } from "../models/shop.server";
import { createWithdrawalRequest } from "../models/submission.server";
import { processEmailQueue } from "../models/email.server";

const REVIEW_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface FormToken {
  s: string; // shop id
  n: string; // nonce, becomes the idempotency key
  iat: number; // issued at (ms)
}

interface ReviewToken extends FormToken {
  v: string; // form version id
  a: SubmissionValues;
}

type ProxyContext = Awaited<ReturnType<typeof authenticate.public.appProxy>>;

function respond(ctx: ProxyContext, body: string, status = 200) {
  return ctx.liquid(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

function pickLocale(url: URL, fallback: string): Locale {
  const requested = (url.searchParams.get("lang") ?? "").slice(0, 2).toLowerCase();
  if (isLocale(requested)) return requested;
  return isLocale(fallback) ? fallback : "en";
}

function renderOptions(shop: ShopWithSettings, locale: Locale): RenderOptions {
  return {
    locale,
    appearance: {
      accentColor: shop.settings.buttonBgColor,
      accentTextColor: shop.settings.buttonTextColor,
      periodDays: shop.settings.withdrawalPeriodDays,
      periodNote: shop.settings.withdrawalPeriodNote,
    },
  };
}

function newFormToken(shopId: string, iat = Date.now(), nonce = randomNonce()): string {
  return signToken<FormToken>("form", { s: shopId, n: nonce, iat });
}

async function resolveShop(ctx: ProxyContext, url: URL): Promise<ShopWithSettings | null> {
  const shopDomain = url.searchParams.get("shop");
  // No offline session means the app is not (or no longer) installed.
  if (!shopDomain || !ctx.session) return null;
  const shop = await ensureShop(shopDomain);
  const lastSeen = shop.proxyLastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeen > 60 * 60 * 1000) {
    await prisma.shop.update({ where: { id: shop.id }, data: { proxyLastSeenAt: new Date() } });
  }
  return shop;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await resolveShop(ctx, url);
  const locale = pickLocale(url, shop?.settings.defaultLocale ?? "en");
  const fallbackOpts: RenderOptions = { locale, appearance: { accentColor: "", accentTextColor: "", periodDays: 14 } };
  if (!shop) return respond(ctx, renderMessagePage(strings(locale).unavailable, fallbackOpts), 503);

  const published = await getPublishedForm(shop.id, shop.settings.defaultFormId);
  const opts = renderOptions(shop, locale);
  if (!published) return respond(ctx, renderMessagePage(strings(locale).unavailable, opts), 503);

  return respond(
    ctx,
    renderFormPage({ schema: published.schema, formToken: newFormToken(shop.id), liquidPrefill: true }, opts),
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = await resolveShop(ctx, url);
  const locale = pickLocale(url, shop?.settings.defaultLocale ?? "en");
  const t = strings(locale);
  const fallbackOpts: RenderOptions = { locale, appearance: { accentColor: "", accentTextColor: "", periodDays: 14 } };
  if (!shop) return respond(ctx, renderMessagePage(t.unavailable, fallbackOpts), 503);
  const opts = renderOptions(shop, locale);

  const published = await getPublishedForm(shop.id, shop.settings.defaultFormId);
  if (!published) return respond(ctx, renderMessagePage(t.unavailable, opts), 503);

  const formData = await request.formData();
  const step = String(formData.get("_step") ?? "");
  const ip = clientIp(request);

  const showForm = (input: Parameters<typeof renderFormPage>[0], status = 200) =>
    respond(ctx, renderFormPage(input, opts), status);

  if (step === "review") {
    const token = verifyToken<FormToken>("form", String(formData.get("_t") ?? ""));
    // Honeypot filled in: almost certainly a bot. Respond without detail.
    if (String(formData.get(HONEYPOT_NAME) ?? "") !== "") {
      return respond(ctx, renderMessagePage(t.tooMany, opts), 400);
    }
    if (!(await consumeRateLimit(shop.id, "review", ip, shop.settings.rateLimitPerHour * 6))) {
      return respond(ctx, renderMessagePage(t.tooMany, opts), 429);
    }
    const getAll = (name: string) => formData.getAll(name).map((v) => (typeof v === "string" ? v : ""));
    const result = validateSubmission(published.schema, getAll);

    if (!token || token.s !== shop.id) {
      return showForm({
        schema: published.schema,
        values: result.values,
        formToken: newFormToken(shop.id),
        alert: t.expired,
      });
    }
    // Minimum fill time: humans take at least a few seconds.
    if (Date.now() - token.iat < shop.settings.minFillSeconds * 1000) {
      return showForm({
        schema: published.schema,
        values: result.values,
        formToken: newFormToken(shop.id, token.iat - shop.settings.minFillSeconds * 1000, token.n),
        alert: t.expired,
      });
    }
    if (!result.ok) {
      return showForm(
        { schema: published.schema, values: result.values, errors: result.errors, formToken: newFormToken(shop.id, token.iat, token.n) },
        422,
      );
    }
    const payloadToken = signToken<ReviewToken>("review", {
      s: shop.id,
      n: token.n,
      iat: Date.now(),
      v: published.version.id,
      a: result.values,
    });
    return respond(ctx, renderReviewPage({ schema: published.schema, values: result.values, payloadToken }, opts));
  }

  if (step === "edit" || step === "confirm") {
    const payload = verifyToken<ReviewToken>("review", String(formData.get("_p") ?? ""));
    const fresh = () =>
      showForm({ schema: published.schema, formToken: newFormToken(shop.id), alert: t.expired });
    if (!payload || payload.s !== shop.id || Date.now() - payload.iat > REVIEW_TOKEN_MAX_AGE_MS) return fresh();
    const version = await getFormVersion(shop.id, payload.v);
    if (!version) return fresh();

    if (step === "edit") {
      return showForm({
        schema: version.schema,
        values: payload.a,
        formToken: newFormToken(shop.id, payload.iat - 60_000, payload.n),
      });
    }

    // Duplicate confirm (double click / refresh): show the original success page.
    const timeZone = effectiveTimezone(shop, shop.settings);
    const existing = await prisma.withdrawalRequest.findUnique({
      where: { shopId_idempotencyKey: { shopId: shop.id, idempotencyKey: payload.n } },
    });
    if (existing) {
      return respond(
        ctx,
        renderSuccessPage(
          { requestNumber: existing.requestNumber, submittedAtText: formatDateTime(existing.submittedAt, timeZone) },
          opts,
        ),
      );
    }

    // Re-validate: the signed payload is trusted for integrity, but the schema
    // rules are always re-applied server-side before persisting.
    const asArray = (v: SubmissionValues[string] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
    const byName = new Map(version.schema.fields.map((f) => [inputName(f.id), asArray(payload.a[f.id])]));
    const result = validateSubmission(version.schema, (name) => byName.get(name) ?? []);
    if (!result.ok) {
      return showForm({
        schema: version.schema,
        values: result.values,
        errors: result.errors,
        formToken: newFormToken(shop.id, payload.iat - 60_000, payload.n),
      }, 422);
    }

    if (!(await consumeRateLimit(shop.id, "submit", ip, shop.settings.rateLimitPerHour))) {
      return respond(ctx, renderMessagePage(t.tooMany, opts), 429);
    }

    const core = extractCoreValues(version.schema, result.values);
    let verification: OrderLookupResult = { status: "UNVERIFIED", reason: "disabled" };
    if (shop.settings.orderLookupEnabled && core.orderReference && core.customerEmail) {
      verification = await lookupOrder(ctx.admin, ctx.session?.scope, core.orderReference, core.customerEmail);
    }

    const created = await createWithdrawalRequest({
      shop,
      formVersionId: version.version.id,
      schema: version.schema,
      values: result.values,
      idempotencyKey: payload.n,
      locale,
      shopifyCustomerId: url.searchParams.get("logged_in_customer_id"),
      verification:
        verification.status === "VERIFIED"
          ? { status: "VERIFIED", orderId: verification.orderId, processedAt: verification.processedAt }
          : { status: verification.status },
    });

    if (!created.duplicate) {
      // Deliver now so the customer gets the confirmation promptly; failures
      // stay queued and are retried by the background job.
      processEmailQueue({ ids: created.emailIds }).catch((e) =>
        console.error("[proxy] Immediate email delivery failed:", (e as Error).message),
      );
      if (shop.settings.orderTaggingEnabled && ctx.admin && created.request.shopifyOrderId) {
        tagOrder(ctx.admin, created.request.shopifyOrderId, shop.settings.orderTag)
          .then((ok) =>
            ok
              ? prisma.withdrawalRequest.update({ where: { id: created.request.id }, data: { orderTaggedAt: new Date() } })
              : null,
          )
          .catch((e) => console.error("[proxy] Order tagging failed:", (e as Error).message));
      }
    }

    return respond(
      ctx,
      renderSuccessPage(
        {
          requestNumber: created.request.requestNumber,
          submittedAtText: `${formatDateTime(created.request.submittedAt, timeZone)} (${timeZone})`,
        },
        opts,
      ),
    );
  }

  return showForm({ schema: published.schema, formToken: newFormToken(shop.id) }, 400);
};
