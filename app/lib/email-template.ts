// Minimal, logic-free email templating: only {{variable}} substitution from an
// allow-list. Values are HTML-escaped in the HTML part; templates cannot run code.
import { escapeHtml } from "./html";

export const TEMPLATE_VARIABLES = [
  "customer_name",
  "customer_email",
  "order_reference",
  "request_number",
  "submitted_at",
  "shop_name",
  "request_status",
  "answers",
  "admin_url",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateContext = Partial<Record<TemplateVariable, string>>;

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function findUnknownVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(VAR_RE)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

export function renderText(template: string, ctx: TemplateContext): string {
  return template.replace(VAR_RE, (_, name: string) => ctx[name as TemplateVariable] ?? "");
}

/** Subject lines must never contain line breaks (header injection). */
export function renderSubject(template: string, ctx: TemplateContext): string {
  return renderText(template, ctx).replace(/[\r\n]+/g, " ").trim().slice(0, 250);
}

/** Converts a plain-text body into simple, escaped HTML paragraphs. */
export function renderHtml(template: string, ctx: TemplateContext): string {
  const text = renderText(template, ctx);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return (
    '<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:15px;line-height:1.5;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">' +
    paragraphs +
    "</body></html>"
  );
}

export const DEFAULT_TEMPLATES = {
  CUSTOMER_CONFIRMATION: {
    subject: "We received your withdrawal – {{request_number}}",
    body:
      "Hello {{customer_name}},\n\n" +
      "we confirm that we received your withdrawal notice on {{submitted_at}}.\n\n" +
      "Reference: {{request_number}}\nOrder: {{order_reference}}\n\n" +
      "Your submission:\n{{answers}}\n\n" +
      "This email confirms receipt of your notice. We will contact you about the next steps, " +
      "such as returning items and refunds.\n\n" +
      "Kind regards\n{{shop_name}}",
  },
  MERCHANT_NOTIFICATION: {
    subject: "New withdrawal request {{request_number}} (order {{order_reference}})",
    body:
      "A new withdrawal request was submitted on {{submitted_at}}.\n\n" +
      "Reference: {{request_number}}\nCustomer: {{customer_name}} <{{customer_email}}>\n" +
      "Order: {{order_reference}}\n\n{{answers}}\n\nOpen in admin: {{admin_url}}",
  },
  STATUS_CHANGE: {
    subject: "Update on your withdrawal {{request_number}}",
    body:
      "Hello {{customer_name}},\n\n" +
      "the status of your withdrawal request {{request_number}} is now: {{request_status}}.\n\n" +
      "Kind regards\n{{shop_name}}",
  },
} as const;

export type TemplateKind = keyof typeof DEFAULT_TEMPLATES;

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  CUSTOMER_CONFIRMATION: "Customer submission confirmation",
  MERCHANT_NOTIFICATION: "Merchant new-request notification",
  STATUS_CHANGE: "Customer status-change email",
};

export const SAMPLE_CONTEXT: TemplateContext = {
  customer_name: "Erika Mustermann",
  customer_email: "erika@example.com",
  order_reference: "#1001",
  request_number: "WD-000042",
  submitted_at: "9 Oct 2026, 14:05",
  shop_name: "Example Store",
  request_status: "In review",
  answers: "Full name: Erika Mustermann\nOrder number: #1001\nWhat would you like to withdraw from?: The entire order",
  admin_url: "https://admin.shopify.com/store/example/apps/withdrawals",
};
