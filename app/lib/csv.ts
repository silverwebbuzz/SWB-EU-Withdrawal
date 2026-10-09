// CSV helpers. Every cell is quoted, and cells that a spreadsheet would treat
// as a formula are prefixed with an apostrophe (OWASP "CSV injection").
const FORMULA_TRIGGERS = /^[=+\-@\t\r＝＋－＠]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_TRIGGERS.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel detects UTF-8 (customer names often contain umlauts etc.).
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
