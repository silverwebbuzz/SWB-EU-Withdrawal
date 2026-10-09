const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Escapes text for HTML that Shopify will also parse as Liquid (app proxy
 * responses). Braces are encoded so untrusted text can never form `{{ }}` or
 * `{% %}` tags. Browsers render the entities as the original characters.
 */
export function escapeLiquidHtml(value: unknown): string {
  return escapeHtml(value).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}
