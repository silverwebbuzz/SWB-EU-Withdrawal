// Form schema shared by the admin builder, the storefront renderer and the
// server-side submission validator. Schemas are plain JSON validated with zod;
// merchant-entered text is always treated as text, never as HTML or script.
import { z } from "zod";

export const INPUT_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "radio",
  "checkbox",
  "checkbox_group",
  "hidden",
  "order_reference",
  "customer_name",
  "customer_email",
] as const;

export const CONTENT_FIELD_TYPES = ["heading", "paragraph"] as const;

export const FIELD_TYPES = [...INPUT_FIELD_TYPES, ...CONTENT_FIELD_TYPES] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type InputFieldType = (typeof INPUT_FIELD_TYPES)[number];

/** Field types that may appear at most once because they map to request columns. */
export const SINGLETON_FIELD_TYPES: readonly FieldType[] = [
  "order_reference",
  "customer_name",
  "customer_email",
];

export const OPTION_FIELD_TYPES: readonly FieldType[] = [
  "select",
  "radio",
  "checkbox_group",
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  textarea: "Textarea",
  email: "Email",
  phone: "Phone",
  number: "Number",
  date: "Date",
  select: "Select / dropdown",
  radio: "Radio group",
  checkbox: "Checkbox",
  checkbox_group: "Checkbox group",
  hidden: "Hidden / system field",
  order_reference: "Order number",
  customer_name: "Customer name",
  customer_email: "Customer email",
  heading: "Section heading",
  paragraph: "Explanatory text",
};

export const MAX_FIELDS = 50;
export const MAX_OPTIONS = 50;
export const MAX_TEXT_LENGTH = 5000;

const plainText = (max: number) =>
  z
    .string()
    .max(max)
    // Strip control characters except tab/newline; text is escaped on output.
    // eslint-disable-next-line no-control-regex
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));

export const fieldIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, "Field IDs must be lowercase letters, digits or underscores");

export const optionSchema = z.object({
  value: z.string().min(1).max(100),
  label: plainText(200).pipe(z.string().min(1)),
});

export const validationSchema = z
  .object({
    minLength: z.number().int().min(0).max(MAX_TEXT_LENGTH).optional(),
    maxLength: z.number().int().min(1).max(MAX_TEXT_LENGTH).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    // A safe, merchant-chosen preset instead of arbitrary regex (ReDoS risk).
    pattern: z.enum(["none", "alphanumeric", "digits"]).optional(),
  })
  .strict();

export const fieldSchema = z
  .object({
    id: fieldIdSchema,
    type: z.enum(FIELD_TYPES),
    label: plainText(200),
    helpText: plainText(1000).optional(),
    placeholder: plainText(200).optional(),
    required: z.boolean().default(false),
    defaultValue: plainText(1000).optional(),
    options: z.array(optionSchema).max(MAX_OPTIONS).optional(),
    validation: validationSchema.optional(),
    // "customer": rendered on the storefront. "admin": stored on the request
    // with its default value but never shown to or accepted from customers.
    visibility: z.enum(["customer", "admin"]).default("customer"),
  })
  .strict()
  .superRefine((field, ctx) => {
    const isContent = (CONTENT_FIELD_TYPES as readonly string[]).includes(field.type);
    if (!isContent && field.label.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Label is required" });
    }
    if (isContent && field.type === "heading" && field.label.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Heading text is required" });
    }
    if (OPTION_FIELD_TYPES.includes(field.type)) {
      if (!field.options || field.options.length === 0) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option" });
      } else {
        const values = field.options.map((o) => o.value);
        if (new Set(values).size !== values.length) {
          ctx.addIssue({ code: "custom", path: ["options"], message: "Option values must be unique" });
        }
      }
    }
    if (field.type === "hidden" && field.visibility !== "admin") {
      ctx.addIssue({ code: "custom", path: ["visibility"], message: "Hidden fields are admin-only" });
    }
    if (field.type === "customer_email" && field.visibility !== "customer") {
      ctx.addIssue({ code: "custom", path: ["visibility"], message: "Customer email must be visible to customers" });
    }
    const v = field.validation;
    if (v?.minLength !== undefined && v?.maxLength !== undefined && v.minLength > v.maxLength) {
      ctx.addIssue({ code: "custom", path: ["validation"], message: "Min length exceeds max length" });
    }
    if (v?.min !== undefined && v?.max !== undefined && v.min > v.max) {
      ctx.addIssue({ code: "custom", path: ["validation"], message: "Min exceeds max" });
    }
  });

export const formSchemaSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: plainText(200).pipe(z.string().min(1, "Form title is required")),
    intro: plainText(MAX_TEXT_LENGTH).optional(),
    submitLabel: plainText(100).optional(),
    fields: z.array(fieldSchema).min(1).max(MAX_FIELDS),
  })
  .strict()
  .superRefine((form, ctx) => {
    const ids = new Set<string>();
    form.fields.forEach((f, i) => {
      if (ids.has(f.id)) {
        ctx.addIssue({ code: "custom", path: ["fields", i, "id"], message: `Duplicate field ID "${f.id}"` });
      }
      ids.add(f.id);
    });
    for (const t of SINGLETON_FIELD_TYPES) {
      if (form.fields.filter((f) => f.type === t).length > 1) {
        ctx.addIssue({ code: "custom", path: ["fields"], message: `Only one ${FIELD_TYPE_LABELS[t]} field is allowed` });
      }
    }
    const email = form.fields.find((f) => f.type === "customer_email");
    if (!email) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "A Customer email field is required to send the confirmation email",
      });
    } else if (!email.required) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: "The Customer email field must be required" });
    }
  });

export type FormField = z.infer<typeof fieldSchema>;
export type FormSchema = z.infer<typeof formSchemaSchema>;

export function isContentField(field: Pick<FormField, "type">): boolean {
  return (CONTENT_FIELD_TYPES as readonly string[]).includes(field.type);
}

export function parseFormSchema(input: unknown) {
  return formSchemaSchema.safeParse(input);
}

/** Generates a stable field ID that is unique within the form. */
export function makeFieldId(type: FieldType, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = type.replace(/[^a-z0-9_]/g, "_");
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

export function newField(type: FieldType, existingIds: Iterable<string>): FormField {
  const id = makeFieldId(type, existingIds);
  const base: FormField = {
    id,
    type,
    label: FIELD_TYPE_LABELS[type],
    required: false,
    visibility: type === "hidden" ? "admin" : "customer",
  };
  if (OPTION_FIELD_TYPES.includes(type)) {
    base.options = [
      { value: "option_1", label: "Option 1" },
      { value: "option_2", label: "Option 2" },
    ];
  }
  if (type === "customer_email") base.required = true;
  if (type === "heading") base.label = "Section heading";
  if (type === "paragraph") base.label = "";
  if (type === "paragraph") base.helpText = "Explanatory text shown to the customer.";
  return base;
}

/**
 * Starter template for an EU withdrawal form. It is a sensible starting point
 * only and does not by itself guarantee legal compliance.
 */
export function defaultWithdrawalFormSchema(): FormSchema {
  return {
    schemaVersion: 1,
    title: "Withdrawal from contract",
    intro:
      "Use this form to notify us that you withdraw from your contract. You do not need an account. " +
      "After you review and confirm, you will receive a confirmation by email.",
    submitLabel: "Confirm withdrawal",
    fields: [
      { id: "heading_contact", type: "heading", label: "Your details", required: false, visibility: "customer" },
      {
        id: "customer_name",
        type: "customer_name",
        label: "Full name",
        required: true,
        visibility: "customer",
        validation: { maxLength: 200 },
      },
      {
        id: "customer_email",
        type: "customer_email",
        label: "Email address",
        helpText: "We send the confirmation of receipt to this address.",
        required: true,
        visibility: "customer",
      },
      { id: "heading_order", type: "heading", label: "Contract / order", required: false, visibility: "customer" },
      {
        id: "order_reference",
        type: "order_reference",
        label: "Order number",
        placeholder: "e.g. #1001",
        helpText: "You can find the order number in your order confirmation email.",
        required: true,
        visibility: "customer",
      },
      {
        id: "order_date",
        type: "date",
        label: "Order date / date of receipt",
        required: false,
        visibility: "customer",
      },
      {
        id: "withdrawal_scope",
        type: "radio",
        label: "What would you like to withdraw from?",
        required: true,
        visibility: "customer",
        options: [
          { value: "entire_order", label: "The entire order" },
          { value: "partial_order", label: "Only some items" },
        ],
        defaultValue: "entire_order",
      },
      {
        id: "items",
        type: "textarea",
        label: "Affected items (if only some items)",
        required: false,
        visibility: "customer",
        validation: { maxLength: 2000 },
      },
      {
        id: "declaration",
        type: "checkbox",
        label: "I/We hereby give notice that I/we withdraw from my/our contract for the items listed above.",
        required: true,
        visibility: "customer",
      },
      {
        id: "source",
        type: "hidden",
        label: "Source",
        defaultValue: "online_withdrawal_form",
        required: false,
        visibility: "admin",
      },
    ],
  };
}
