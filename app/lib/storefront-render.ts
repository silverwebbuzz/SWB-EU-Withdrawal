// Renders the customer-facing withdrawal pages as HTML strings.
//
// Output is served through the Shopify app proxy as `application/liquid`, so
// Shopify parses it as Liquid inside the shop's theme. Every dynamic value goes
// through escapeLiquidHtml (HTML + brace escaping) so neither merchants nor
// customers can inject markup, script or Liquid. Our own constant CSS/JS is
// wrapped in {% raw %} blocks. The same markup powers the admin preview.
import { escapeLiquidHtml as esc } from "./html";
import { isContentField, type FormField, type FormSchema } from "./form-schema";
import { strings, type Locale } from "./i18n";
import {
  formatAnswer,
  inputName,
  type SubmissionValues,
  type ValidationError,
} from "./submission-validation";

export interface StorefrontAppearance {
  accentColor: string;
  accentTextColor: string;
  periodDays: number;
  periodNote?: string | null;
}

export interface RenderOptions {
  locale: Locale;
  appearance: StorefrontAppearance;
  /** When true, the output is plain HTML for the admin preview (no Liquid). */
  preview?: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
export const safeColor = (c: string | null | undefined, fallback: string) => (c && HEX_RE.test(c) ? c : fallback);

export const HONEYPOT_NAME = "swb_website";

export const STOREFRONT_CSS = `
.swb{--swb-accent:#1a1a1a;--swb-accent-text:#fff;--swb-border:#c9cccf;--swb-error:#b3261e;
  max-width:640px;margin:32px auto;padding:0 16px;font:inherit;color:inherit;box-sizing:border-box}
.swb *,.swb *::before,.swb *::after{box-sizing:border-box}
.swb h1{font-size:1.75rem;line-height:1.2;margin:0 0 12px}
.swb h2{font-size:1.2rem;margin:28px 0 8px}
.swb p{margin:0 0 12px;line-height:1.5}
.swb-intro{white-space:pre-line}
.swb-note{font-size:.9rem;opacity:.85;border-left:3px solid var(--swb-border);padding-left:10px}
.swb-field{margin:0 0 18px;border:0;padding:0;min-width:0}
.swb-label,.swb legend{display:block;font-weight:600;margin:0 0 6px;padding:0}
.swb-opt{font-weight:400;opacity:.75;font-size:.9em}
.swb-help{display:block;font-size:.875rem;opacity:.8;margin-top:4px}
.swb input[type=text],.swb input[type=email],.swb input[type=tel],.swb input[type=number],.swb input[type=date],
.swb select,.swb textarea{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--swb-border);
  border-radius:6px;font:inherit;background:#fff;color:#1a1a1a}
.swb textarea{min-height:110px;resize:vertical}
.swb input:focus-visible,.swb select:focus-visible,.swb textarea:focus-visible,.swb button:focus-visible,
.swb a:focus-visible{outline:3px solid var(--swb-accent);outline-offset:2px}
.swb-choice{display:flex;gap:10px;align-items:flex-start;margin:6px 0;font-weight:400}
.swb-choice input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--swb-accent)}
.swb-error{color:var(--swb-error);font-size:.9rem;margin-top:6px;display:block}
.swb-invalid input,.swb-invalid select,.swb-invalid textarea{border-color:var(--swb-error)}
.swb-alert{border:1px solid var(--swb-error);color:var(--swb-error);border-radius:6px;padding:12px;margin:0 0 18px}
.swb-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}
.swb-btn{min-height:48px;padding:12px 22px;border-radius:6px;border:2px solid var(--swb-accent);font:inherit;
  font-weight:600;cursor:pointer;background:var(--swb-accent);color:var(--swb-accent-text)}
.swb-btn[disabled]{opacity:.6;cursor:progress}
.swb-btn-secondary{background:transparent;color:inherit;border-color:var(--swb-border)}
.swb-review{border:1px solid var(--swb-border);border-radius:8px;padding:4px 16px;margin:16px 0}
.swb-review dt{font-weight:600;margin-top:12px}
.swb-review dd{margin:2px 0 12px;white-space:pre-wrap;word-break:break-word}
.swb-success{border:1px solid var(--swb-border);border-radius:8px;padding:20px}
.swb-ref{font-size:1.4rem;font-weight:700;letter-spacing:.03em}
.swb-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
@media (max-width:480px){.swb h1{font-size:1.45rem}.swb-btn{width:100%}}
`;

// Disables submit buttons after the first click to avoid double submissions.
const STOREFRONT_JS = `
document.querySelectorAll('form.swb-form').forEach(function(f){f.addEventListener('submit',function(e){
var b=e.submitter;if(f.dataset.sent){e.preventDefault();return;}f.dataset.sent='1';
if(b){setTimeout(function(){b.disabled=true;},0);}});});
`;

function wrap(body: string, opts: RenderOptions): string {
  const accent = safeColor(opts.appearance.accentColor, "#1a1a1a");
  const accentText = safeColor(opts.appearance.accentTextColor, "#ffffff");
  const style = `--swb-accent:${accent};--swb-accent-text:${accentText}`;
  if (opts.preview) {
    return `<style>${STOREFRONT_CSS}</style><div class="swb" style="${style}" lang="${opts.locale}">${body}</div>`;
  }
  return (
    `{% raw %}<style>${STOREFRONT_CSS}</style>{% endraw %}` +
    `<div class="swb" style="${style}" lang="${opts.locale}">${body}</div>` +
    `{% raw %}<script>${STOREFRONT_JS}</script>{% endraw %}`
  );
}

function fieldDomId(field: FormField) {
  return `swb-f-${field.id}`;
}

function errorText(error: ValidationError, locale: Locale): string {
  return strings(locale).errors[error.code](error.param);
}

function renderInputField(
  field: FormField,
  value: string | string[] | undefined,
  error: ValidationError | undefined,
  opts: RenderOptions,
  liquidPrefill: boolean,
): string {
  const t = strings(opts.locale);
  const id = fieldDomId(field);
  const name = inputName(field.id);
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [field.helpText ? helpId : "", error ? errId : ""].filter(Boolean).join(" ");
  const aria = `${describedBy ? ` aria-describedby="${describedBy}"` : ""}${error ? ' aria-invalid="true"' : ""}`;
  const req = field.required ? " required" : "";
  const labelText = `${esc(field.label)}${field.required ? "" : ` <span class="swb-opt">(${esc(t.optional)})</span>`}`;
  const help = field.helpText ? `<span class="swb-help" id="${helpId}">${esc(field.helpText)}</span>` : "";
  const err = error ? `<span class="swb-error" id="${errId}">${esc(errorText(error, opts.locale))}</span>` : "";
  const cls = `swb-field${error ? " swb-invalid" : ""}`;
  const single = Array.isArray(value) ? "" : (value ?? field.defaultValue ?? "");
  const placeholder = field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : "";

  // Pre-fill name/email for logged-in customers via trusted Liquid we control.
  let valueAttr = `value="${esc(single)}"`;
  if (liquidPrefill && !single && field.type === "customer_email") valueAttr = 'value="{{ customer.email | escape }}"';
  if (liquidPrefill && !single && field.type === "customer_name") valueAttr = 'value="{{ customer.name | escape }}"';

  if (field.type === "checkbox") {
    const checked = value === "yes" || (value === undefined && field.defaultValue === "yes") ? " checked" : "";
    return `<div class="${cls}"><label class="swb-choice"><input type="checkbox" id="${id}" name="${name}" value="yes"${checked}${req}${aria}><span>${labelText}</span></label>${help}${err}</div>`;
  }

  if (field.type === "radio" || field.type === "checkbox_group") {
    const multiple = field.type === "checkbox_group";
    const selected = new Set(Array.isArray(value) ? value : [single]);
    const options = (field.options ?? [])
      .map((o, i) => {
        const checked = selected.has(o.value) ? " checked" : "";
        // `required` on a radio group is valid HTML; on checkbox groups it would force every box.
        const r = !multiple && field.required && i === 0 ? " required" : "";
        return `<label class="swb-choice"><input type="${multiple ? "checkbox" : "radio"}" name="${name}" value="${esc(o.value)}"${checked}${r}><span>${esc(o.label)}</span></label>`;
      })
      .join("");
    return `<fieldset class="${cls}"${aria}><legend>${labelText}</legend>${options}${help}${err}</fieldset>`;
  }

  let control: string;
  switch (field.type) {
    case "textarea":
      control = `<textarea id="${id}" name="${name}"${placeholder}${req}${aria} maxlength="${field.validation?.maxLength ?? 5000}">${esc(single)}</textarea>`;
      break;
    case "select": {
      const opts2 = (field.options ?? [])
        .map((o) => `<option value="${esc(o.value)}"${o.value === single ? " selected" : ""}>${esc(o.label)}</option>`)
        .join("");
      control = `<select id="${id}" name="${name}"${req}${aria}><option value="">${esc(t.selectPlaceholder)}</option>${opts2}</select>`;
      break;
    }
    default: {
      const typeMap: Partial<Record<FormField["type"], string>> = {
        email: "email",
        customer_email: "email",
        phone: "tel",
        number: "number",
        date: "date",
      };
      const autocomplete: Partial<Record<FormField["type"], string>> = {
        customer_email: "email",
        customer_name: "name",
        phone: "tel",
      };
      const ac = autocomplete[field.type] ? ` autocomplete="${autocomplete[field.type]}"` : "";
      const max = field.validation?.maxLength ? ` maxlength="${field.validation.maxLength}"` : "";
      control = `<input type="${typeMap[field.type] ?? "text"}" id="${id}" name="${name}" ${valueAttr}${placeholder}${req}${ac}${max}${aria}>`;
    }
  }
  return `<div class="${cls}"><label class="swb-label" for="${id}">${labelText}</label>${control}${help}${err}</div>`;
}

export interface FormPageInput {
  schema: FormSchema;
  values?: SubmissionValues;
  errors?: Record<string, ValidationError>;
  /** Signed token (issued-at + nonce) used for minimum fill time checks. */
  formToken: string;
  alert?: string;
  liquidPrefill?: boolean;
}

export function renderFormPage(input: FormPageInput, opts: RenderOptions): string {
  const t = strings(opts.locale);
  const { schema, values = {}, errors = {} } = input;
  const hasErrors = Object.keys(errors).length > 0;
  const parts: string[] = [`<h1>${esc(schema.title)}</h1>`];
  if (schema.intro) parts.push(`<p class="swb-intro">${esc(schema.intro)}</p>`);
  const note = opts.appearance.periodNote?.trim() || t.periodNote(opts.appearance.periodDays);
  parts.push(`<p class="swb-note">${esc(note)}</p>`);
  const alert = input.alert ?? (hasErrors ? t.fixErrors : "");
  if (alert) parts.push(`<div class="swb-alert" role="alert">${esc(alert)}</div>`);

  const fields = schema.fields
    .filter((f) => f.visibility === "customer")
    .map((f) => {
      if (f.type === "heading") return `<h2>${esc(f.label)}</h2>`;
      if (f.type === "paragraph") return `<p>${esc(f.helpText ?? f.label)}</p>`;
      return renderInputField(f, values[f.id], errors[f.id], opts, Boolean(input.liquidPrefill));
    })
    .join("");

  parts.push(
    `<form class="swb-form" method="post" action="" novalidate>` +
      `<input type="hidden" name="_step" value="review">` +
      `<input type="hidden" name="_t" value="${esc(input.formToken)}">` +
      `<div class="swb-hp" aria-hidden="true"><label>Website<input type="text" name="${HONEYPOT_NAME}" tabindex="-1" autocomplete="off"></label></div>` +
      fields +
      `<div class="swb-actions"><button class="swb-btn" type="submit">${esc(t.continue)}</button></div>` +
      `</form>`,
  );
  return wrap(parts.join(""), opts);
}

export function renderReviewPage(
  input: { schema: FormSchema; values: SubmissionValues; payloadToken: string },
  opts: RenderOptions,
): string {
  const t = strings(opts.locale);
  const rows = input.schema.fields
    .filter((f) => f.visibility === "customer" && !isContentField(f))
    .map((f) => {
      const v = input.values[f.id];
      let shown = v === undefined ? "" : formatAnswer(v, f);
      if (f.type === "checkbox") shown = v === "yes" ? t.yes : t.no;
      return `<dt>${esc(f.label)}</dt><dd>${shown ? esc(shown) : "—"}</dd>`;
    })
    .join("");
  const body =
    `<h1>${esc(t.reviewHeading)}</h1><p>${esc(t.reviewIntro)}</p>` +
    `<dl class="swb-review">${rows}</dl>` +
    `<form class="swb-form" method="post" action="">` +
    `<input type="hidden" name="_p" value="${esc(input.payloadToken)}">` +
    `<div class="swb-actions">` +
    `<button class="swb-btn" type="submit" name="_step" value="confirm">${esc(input.schema.submitLabel || t.confirm)}</button>` +
    `<button class="swb-btn swb-btn-secondary" type="submit" name="_step" value="edit" formnovalidate>${esc(t.edit)}</button>` +
    `</div></form>`;
  return wrap(body, opts);
}

export function renderSuccessPage(
  input: { requestNumber: string; submittedAtText: string },
  opts: RenderOptions,
): string {
  const t = strings(opts.locale);
  const body =
    `<div class="swb-success" role="status"><h1>${esc(t.successHeading)}</h1>` +
    `<p>${esc(t.successBody)}</p>` +
    `<p>${esc(t.reference)}:<br><span class="swb-ref">${esc(input.requestNumber)}</span></p>` +
    `<p>${esc(t.submittedAt)}: ${esc(input.submittedAtText)}</p></div>`;
  return wrap(body, opts);
}

export function renderMessagePage(message: string, opts: RenderOptions): string {
  return wrap(`<div class="swb-alert" role="alert">${esc(message)}</div>`, opts);
}

