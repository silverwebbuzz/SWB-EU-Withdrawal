// Server-side validation of a customer submission against a published form
// schema. Browser validation is a convenience only; this is the source of truth.
import {
  isContentField,
  MAX_TEXT_LENGTH,
  OPTION_FIELD_TYPES,
  type FormField,
  type FormSchema,
} from "./form-schema";

export type AnswerValue = string | string[];
export type SubmissionValues = Record<string, AnswerValue>;

export type ValidationErrorCode =
  | "required"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_number"
  | "invalid_date"
  | "invalid_option"
  | "too_short"
  | "too_long"
  | "too_small"
  | "too_large"
  | "invalid_format";

export interface ValidationError {
  code: ValidationErrorCode;
  /** Numeric parameter for messages such as "at most {n} characters". */
  param?: number;
}

export type SubmissionResult =
  | { ok: true; values: SubmissionValues }
  | { ok: false; values: SubmissionValues; errors: Record<string, ValidationError> };

/** Name of the HTML input carrying a field's value. */
export const inputName = (fieldId: string) => `f_${fieldId}`;

// Deliberately simple and linear-time patterns (no catastrophic backtracking).
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;
const PHONE_RE = /^\+?[0-9 ()./-]{5,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_REF_RE = /^#?[A-Za-z0-9][A-Za-z0-9 _./-]{0,49}$/;

export function customerFields(schema: FormSchema): FormField[] {
  return schema.fields.filter((f) => f.visibility === "customer" && !isContentField(f));
}

function clean(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function textLimit(field: FormField): number {
  const fallback = field.type === "textarea" ? MAX_TEXT_LENGTH : 500;
  return Math.min(field.validation?.maxLength ?? fallback, MAX_TEXT_LENGTH);
}

function validateField(field: FormField, raw: string[]): { value: AnswerValue; error?: ValidationError } {
  if (field.type === "checkbox_group") {
    const allowed = new Set((field.options ?? []).map((o) => o.value));
    const picked = Array.from(new Set(raw.map(clean).filter(Boolean)));
    if (picked.some((v) => !allowed.has(v))) return { value: [], error: { code: "invalid_option" } };
    if (field.required && picked.length === 0) return { value: picked, error: { code: "required" } };
    return { value: picked };
  }

  if (field.type === "checkbox") {
    const checked = raw.some((v) => v === "on" || v === "true" || v === "yes");
    if (field.required && !checked) return { value: "", error: { code: "required" } };
    return { value: checked ? "yes" : "" };
  }

  const value = clean(raw[0] ?? "");
  if (value === "") {
    return field.required ? { value, error: { code: "required" } } : { value };
  }

  const max = textLimit(field);
  if (value.length > max) return { value, error: { code: "too_long", param: max } };
  const min = field.validation?.minLength;
  if (min !== undefined && value.length < min) return { value, error: { code: "too_short", param: min } };

  switch (field.type) {
    case "email":
    case "customer_email":
      if (value.length > 254 || !EMAIL_RE.test(value)) return { value, error: { code: "invalid_email" } };
      return { value };
    case "phone":
      return PHONE_RE.test(value) ? { value } : { value, error: { code: "invalid_phone" } };
    case "number": {
      if (!/^-?\d+([.,]\d+)?$/.test(value)) return { value, error: { code: "invalid_number" } };
      const n = Number(value.replace(",", "."));
      const { min: lo, max: hi } = field.validation ?? {};
      if (lo !== undefined && n < lo) return { value, error: { code: "too_small", param: lo } };
      if (hi !== undefined && n > hi) return { value, error: { code: "too_large", param: hi } };
      return { value };
    }
    case "date":
      return isValidIsoDate(value) ? { value } : { value, error: { code: "invalid_date" } };
    case "order_reference":
      return ORDER_REF_RE.test(value) ? { value } : { value, error: { code: "invalid_format" } };
    default:
      break;
  }

  if (OPTION_FIELD_TYPES.includes(field.type)) {
    const allowed = (field.options ?? []).some((o) => o.value === value);
    return allowed ? { value } : { value, error: { code: "invalid_option" } };
  }

  const pattern = field.validation?.pattern;
  if (pattern === "digits" && !/^\d+$/.test(value)) return { value, error: { code: "invalid_format" } };
  if (pattern === "alphanumeric" && !/^[\p{L}\p{N} ]+$/u.test(value)) {
    return { value, error: { code: "invalid_format" } };
  }
  return { value };
}

/**
 * Validates raw form input. `getAll(name)` returns every submitted value for an
 * input name (FormData.getAll or an equivalent). Unknown inputs are ignored;
 * admin-only fields are never read from input and take their default value.
 */
export function validateSubmission(
  schema: FormSchema,
  getAll: (name: string) => string[],
): SubmissionResult {
  const values: SubmissionValues = {};
  const errors: Record<string, ValidationError> = {};

  for (const field of schema.fields) {
    if (isContentField(field)) continue;
    if (field.visibility === "admin") {
      values[field.id] = field.defaultValue ?? "";
      continue;
    }
    const { value, error } = validateField(field, getAll(inputName(field.id)).slice(0, 100));
    values[field.id] = value;
    if (error) errors[field.id] = error;
  }

  return Object.keys(errors).length > 0 ? { ok: false, values, errors } : { ok: true, values };
}

/** Pulls the values that map to request columns out of validated answers. */
export function extractCoreValues(schema: FormSchema, values: SubmissionValues) {
  const byType = (type: FormField["type"]) => {
    const field = schema.fields.find((f) => f.type === type);
    const v = field ? values[field.id] : undefined;
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  return {
    customerEmail: byType("customer_email"),
    customerName: byType("customer_name"),
    orderReference: byType("order_reference"),
  };
}

export function formatAnswer(value: AnswerValue, field?: Pick<FormField, "type" | "options">): string {
  const labelFor = (v: string) => field?.options?.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(labelFor).join(", ");
  if (field?.type === "checkbox") return value === "yes" ? "Yes" : "No";
  return field && OPTION_FIELD_TYPES.includes(field.type) ? labelFor(value) : value;
}
