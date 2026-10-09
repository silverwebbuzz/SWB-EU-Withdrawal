import { useState } from "react";
import { useNavigation, useSearchParams } from "react-router";
import { RequestTable, type RequestRow } from "./RequestTable";
import { REQUEST_STATUSES, STATUS_LABELS } from "../lib/status";

const inputValue = (e: Event) => (e.currentTarget as unknown as { value: string }).value;

interface Props {
  heading: string;
  archived: boolean;
  rows: RequestRow[];
  total: number;
  page: number;
  pageCount: number;
  timeZone: string;
}

export function RequestListPage({ heading, archived, rows, total, page, pageCount, timeZone }: Props) {
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const apply = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    setParams(p);
  };
  const current = { q, status, from, to };
  const hasFilters = Boolean(q || status || from || to);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const p = new URLSearchParams(params);
      p.delete("page");
      if (archived) p.set("archived", "1");
      // App Bridge adds the session token to same-origin fetch requests.
      const response = await fetch(`/app/withdrawals/export?${p.toString()}`);
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `withdrawals-${archived ? "archive-" : ""}${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <s-page heading={heading}>
      <s-button slot="primary-action" onClick={exportCsv} loading={exporting} disabled={total === 0}>
        Export CSV
      </s-button>
      {exportError ? <s-banner tone="critical">{exportError}</s-banner> : null}

      <s-section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply(current);
          }}
        >
          <s-grid gridTemplateColumns="@container (inline-size > 700px) 2fr 1fr 1fr 1fr auto, 1fr" gap="base" alignItems="end">
            <s-search-field
              label="Search"
              placeholder="Name, email, order or reference"
              value={q}
              onInput={(e) => setQ(inputValue(e as unknown as Event))}
            />
            <s-select label="Status" value={status} onChange={(e) => setStatus(inputValue(e as unknown as Event))}>
              <s-option value="">All statuses</s-option>
              {REQUEST_STATUSES.map((s) => (
                <s-option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </s-option>
              ))}
            </s-select>
            <s-date-field label="From" value={from} onChange={(e) => setFrom(inputValue(e as unknown as Event))} />
            <s-date-field label="To" value={to} onChange={(e) => setTo(inputValue(e as unknown as Event))} />
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" type="submit" loading={navigation.state === "loading"}>
                Apply
              </s-button>
              {hasFilters ? (
                <s-button
                  variant="tertiary"
                  onClick={() => {
                    setQ("");
                    setStatus("");
                    setFrom("");
                    setTo("");
                    apply({});
                  }}
                >
                  Clear
                </s-button>
              ) : null}
            </s-stack>
          </s-grid>
        </form>
      </s-section>

      <s-section padding="none" accessibilityLabel="Withdrawal requests">
        <RequestTable
          rows={rows}
          timeZone={timeZone}
          emptyHeading={hasFilters ? "No requests match your filters" : archived ? "The archive is empty" : "No withdrawal requests yet"}
          emptyText={
            hasFilters
              ? "Try a different search or clear the filters."
              : archived
                ? "Archived requests appear here and can be restored at any time."
                : "Requests submitted through your storefront form will appear here."
          }
        />
        {pageCount > 1 ? (
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-text color="subdued">
                {total} request{total === 1 ? "" : "s"} · page {page} of {pageCount}
              </s-text>
              <s-button-group>
                <s-button
                  slot="secondary-actions"
                  disabled={page <= 1}
                  onClick={() => apply({ ...current, page: String(page - 1) })}
                >
                  Previous
                </s-button>
                <s-button
                  slot="secondary-actions"
                  disabled={page >= pageCount}
                  onClick={() => apply({ ...current, page: String(page + 1) })}
                >
                  Next
                </s-button>
              </s-button-group>
            </s-stack>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}
