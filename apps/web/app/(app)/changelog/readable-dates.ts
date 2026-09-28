// Readable dates for the change log (W-14, CP3 finding 4): ISO dates in the text people read (an
// entry's title, its undo reason) show as the ChangeLog mockup writes them, "Mon 28 Sep", with the
// year only when it is not the current one. Display only: the API's `summary` stays the stored text
// with ISO dates (CP3 round 2). Shared by the change-log screen and apps/web/lib/server/changes.ts.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Fixed names, not the locale's: ICU's en-GB writes "Sept", the mockup "Sep".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `text` with each ISO date (`2026-09-28`) read as "Mon 28 Sep", plus the year when it is not
 * `year`. Plan dates are calendar dates, so they are not shifted between time zones.
 */
export function withReadableDates(text: string, year: number): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso, y: string, m: string, d: string) => {
    const date = new Date(`${iso}T00:00:00Z`);
    const month = MONTHS[Number(m) - 1];
    if (Number.isNaN(date.getTime()) || month === undefined) return iso;
    const day = `${WEEKDAYS[(date.getUTCDay() + 6) % 7] ?? ""} ${String(Number(d))} ${month}`;
    return Number(y) === year ? day : `${day} ${y}`;
  });
}
