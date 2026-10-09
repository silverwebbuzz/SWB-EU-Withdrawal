import { describe, expect, it } from "vitest";
import { defaultWithdrawalFormSchema, type FormSchema } from "../../app/lib/form-schema";
import { extractCoreValues, inputName, validateSubmission } from "../../app/lib/submission-validation";

function input(values: Record<string, string | string[]>) {
  return (name: string) => {
    const key = name.replace(/^f_/, "");
    const v = values[key];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
}

const valid = {
  customer_name: "Erika Mustermann",
  customer_email: "erika@example.com",
  order_reference: "#1001",
  withdrawal_scope: "entire_order",
  declaration: "on",
};

describe("validateSubmission", () => {
  const schema = defaultWithdrawalFormSchema();

  it("accepts a valid submission and normalises checkbox values", () => {
    const r = validateSubmission(schema, input(valid));
    expect(r.ok).toBe(true);
    expect(r.values.declaration).toBe("yes");
    expect(extractCoreValues(schema, r.values)).toEqual({
      customerEmail: "erika@example.com",
      customerName: "Erika Mustermann",
      orderReference: "#1001",
    });
  });

  it("reports required fields", () => {
    const r = validateSubmission(schema, input({}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.customer_email.code).toBe("required");
      expect(r.errors.declaration.code).toBe("required");
    }
  });

  it("rejects invalid emails and header-injection attempts", () => {
    for (const email of ["not-an-email", "a@b", "x@example.com\nBcc: evil@example.com", "<script>@x.com"]) {
      const r = validateSubmission(schema, input({ ...valid, customer_email: email }));
      expect(r.ok, email).toBe(false);
    }
  });

  it("rejects option values that are not in the schema", () => {
    const r = validateSubmission(schema, input({ ...valid, withdrawal_scope: "refund_everything" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.withdrawal_scope.code).toBe("invalid_option");
  });

  it("enforces max length and strips control characters", () => {
    const long = validateSubmission(schema, input({ ...valid, items: "x".repeat(2001) }));
    expect(long.ok).toBe(false);
    const ctrl = validateSubmission(schema, input({ ...valid, customer_name: "Erika\u0000\u0007 M" }));
    expect(ctrl.ok).toBe(true);
    expect(ctrl.values.customer_name).toBe("Erika M");
  });

  it("never accepts admin-only values from the client", () => {
    const r = validateSubmission(schema, input({ ...valid, source: "attacker_supplied" }));
    expect(r.values.source).toBe("online_withdrawal_form");
  });

  it("keeps markup as inert text (escaped on output, not stripped)", () => {
    const r = validateSubmission(schema, input({ ...valid, items: '<img src=x onerror="alert(1)">' }));
    expect(r.ok).toBe(true);
    expect(r.values.items).toBe('<img src=x onerror="alert(1)">');
  });

  it("validates dates, numbers, phones and checkbox groups", () => {
    const s: FormSchema = {
      ...schema,
      fields: [
        ...schema.fields,
        { id: "d", type: "date", label: "D", required: true, visibility: "customer" },
        { id: "n", type: "number", label: "N", required: true, visibility: "customer", validation: { min: 1, max: 5 } },
        { id: "p", type: "phone", label: "P", required: true, visibility: "customer" },
        {
          id: "g",
          type: "checkbox_group",
          label: "G",
          required: true,
          visibility: "customer",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    };
    const bad = validateSubmission(s, input({ ...valid, d: "2026-02-30", n: "9", p: "call me", g: ["a", "z"] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.d.code).toBe("invalid_date");
      expect(bad.errors.n.code).toBe("too_large");
      expect(bad.errors.p.code).toBe("invalid_phone");
      expect(bad.errors.g.code).toBe("invalid_option");
    }
    const good = validateSubmission(s, input({ ...valid, d: "2026-10-01", n: "3", p: "+49 30 1234567", g: ["a", "b", "a"] }));
    expect(good.ok).toBe(true);
    expect(good.values.g).toEqual(["a", "b"]);
  });

  it("uses the f_ prefix for input names", () => {
    expect(inputName("customer_email")).toBe("f_customer_email");
  });
});
