// Time zone helpers without extra dependencies. "Today" on the dashboard is the
// calendar day in the shop's time zone (settings override, else Shopify's).

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Returns the UTC instant of local midnight for `yyyy-mm-dd` in `timeZone`. */
export function zonedMidnightToUtc(ymd: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes handle DST transitions around midnight.
  let utc = guess - tzOffsetMs(new Date(guess), timeZone);
  utc = guess - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** Calendar date (yyyy-mm-dd) of `instant` in `timeZone`. */
export function zonedDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

/** [start, end) of the current local day in `timeZone`, as UTC instants. */
export function startOfTodayRange(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const today = zonedDate(now, timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start: zonedMidnightToUtc(today, timeZone), end: zonedMidnightToUtc(tomorrow, timeZone) };
}

export function formatDateTime(instant: Date | string, timeZone: string, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(instant));
}
