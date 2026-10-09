import { describe, expect, it } from "vitest";
import { defaultWithdrawalFormSchema, newField, parseFormSchema, type FormSchema } from "../../app/lib/form-schema";

const base = () => defaultWithdrawalFormSchema();

describe("form schema validation", () => {
  it("accepts the default template", () => {
    expect(parseFormSchema(base()).success).toBe(true);
  });

  it("rejects duplicate field IDs", () => {
    const s = base();
    s.fields.push({ ...s.fields[1], id: s.fields[1].id, type: "text" });
    const r = parseFormSchema(s);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("Duplicate field ID");
  });

  it("requires exactly one required customer email field", () => {
    const s = base();
    s.fields = s.fields.filter((f) => f.type !== "customer_email");
    expect(parseFormSchema(s).success).toBe(false);

    const t = base();
    t.fields.find((f) => f.type === "customer_email")!.required = false;
    expect(parseFormSchema(t).success).toBe(false);
  });

  it("rejects a second singleton field", () => {
    const s = base();
    s.fields.push({ ...newField("order_reference", s.fields.map((f) => f.id)) });
    expect(parseFormSchema(s).success).toBe(false);
  });

  it("requires options for option fields and unique option values", () => {
    const s = base();
    s.fields.push({ id: "pick", type: "select", label: "Pick", required: false, visibility: "customer", options: [] });
    expect(parseFormSchema(s).success).toBe(false);
    s.fields[s.fields.length - 1].options = [
      { value: "a", label: "A" },
      { value: "a", label: "A again" },
    ];
    expect(parseFormSchema(s).success).toBe(false);
  });

  it("forces hidden fields to be admin-only", () => {
    const s = base();
    s.fields.push({ id: "secret", type: "hidden", label: "Secret", required: false, visibility: "customer" });
    expect(parseFormSchema(s).success).toBe(false);
  });

  it("rejects unknown properties such as scripts or HTML flags", () => {
    const s = base() as FormSchema & { script?: string };
    s.script = "alert(1)";
    expect(parseFormSchema(s).success).toBe(false);
    const t = base();
    (t.fields[1] as unknown as Record<string, unknown>).html = "<b>x</b>";
    expect(parseFormSchema(t).success).toBe(false);
  });

  it("rejects invalid field IDs", () => {
    const s = base();
    s.fields[1].id = "Bad ID!";
    expect(parseFormSchema(s).success).toBe(false);
  });

  it("generates unique IDs for new fields", () => {
    const a = newField("text", []);
    const b = newField("text", [a.id]);
    expect(a.id).not.toBe(b.id);
  });
});
