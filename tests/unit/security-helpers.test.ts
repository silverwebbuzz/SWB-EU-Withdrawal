import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../app/lib/csv";
import { escapeHtml, escapeLiquidHtml } from "../../app/lib/html";
import { findUnknownVariables, renderHtml, renderSubject } from "../../app/lib/email-template";
import { hashKey, signToken, verifyToken } from "../../app/lib/signing.server";
import { renderFormPage, renderReviewPage } from "../../app/lib/storefront-render";
import { defaultWithdrawalFormSchema } from "../../app/lib/form-schema";

describe("CSV export escaping", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
      expect(csvCell(evil).startsWith(`"'`), evil).toBe(true);
    }
  });
  it("quotes and doubles embedded quotes", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe('""');
  });
  it("adds a UTF-8 BOM and CRLF line endings", () => {
    const csv = toCsv(["a"], [["ü"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
  });
});

describe("HTML and Liquid escaping", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("escapes Liquid delimiters", () => {
    const out = escapeLiquidHtml("{{ shop.secret }} {% raw %}");
    expect(out).not.toMatch(/[{}]/);
  });
  it("storefront output never contains customer-supplied Liquid or markup", () => {
    const schema = defaultWithdrawalFormSchema();
    schema.title = "{{ settings.secret }}<script>alert(1)</script>";
    const html = renderReviewPage(
      { schema, values: { customer_name: "{% endraw %}{{ customer.email }}", items: "<img onerror=x>" }, payloadToken: "t" },
      { locale: "en", appearance: { accentColor: "#000000", accentTextColor: "#ffffff", periodDays: 14 } },
    );
    // Only our own {% raw %} wrappers may contain braces.
    const withoutRaw = html.replace(/\{% raw %\}[\s\S]*?\{% endraw %\}/g, "");
    expect(withoutRaw).not.toMatch(/[{}]/);
    expect(withoutRaw).not.toContain("<script>");
    expect(withoutRaw).not.toContain("<img");
  });
  it("rejects non-hex colors in storefront styles", () => {
    const html = renderFormPage(
      { schema: defaultWithdrawalFormSchema(), formToken: "t" },
      {
        locale: "en",
        preview: true,
        appearance: { accentColor: "red;background:url(x)", accentTextColor: "#fff", periodDays: 14 },
      },
    );
    expect(html).not.toContain("url(x)");
  });
});

describe("email templates", () => {
  it("detects unknown variables", () => {
    expect(findUnknownVariables("Hi {{customer_name}} {{password}}")).toEqual(["password"]);
  });
  it("escapes values in HTML and strips newlines from subjects", () => {
    expect(renderHtml("Hi {{customer_name}}", { customer_name: "<b>x</b>" })).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(renderSubject("Re {{customer_name}}", { customer_name: "a\r\nBcc: x@y.z" })).not.toMatch(/[\r\n]/);
  });
});

describe("signed tokens", () => {
  it("round-trips and rejects tampering or wrong purpose", () => {
    const token = signToken("review", { a: 1 });
    expect(verifyToken<{ a: number }>("review", token)).toEqual({ a: 1 });
    expect(verifyToken("form", token)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ a: 2 })).toString("base64url");
    expect(verifyToken("review", `${forged}.${sig}`)).toBeNull();
    expect(verifyToken("review", `${body}.x${sig.slice(1)}`)).toBeNull();
    expect(verifyToken("review", "garbage")).toBeNull();
  });
  it("hashes rate-limit keys without exposing the input", () => {
    const h = hashKey("shop", "1.2.3.4");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("1.2.3.4");
  });
});
