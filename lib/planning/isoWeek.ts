// ISO-8601 week helpers. Weeks are compared by (iso_year, iso_week) numbers,
// never by naive string or Date parsing.

export interface IsoWeek {
  year: number;
  week: number;
}

const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

/** Number of ISO weeks (52 or 53) in an ISO week-numbering year. */
export function weeksInIsoYear(year: number): number {
  // A year has 53 ISO weeks when Jan 1 is a Thursday, or a Wednesday in a leap year.
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay(); // 0 = Sunday
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

export function parseIsoWeek(value: string): IsoWeek | null {
  const m = ISO_WEEK_RE.exec(value?.trim() ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > weeksInIsoYear(year)) return null;
  return { year, week };
}

export function formatIsoWeek({ year, week }: IsoWeek): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday (UTC) of the given ISO week. */
export function isoWeekMonday({ year, week }: IsoWeek): Date {
  // Jan 4 is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7; // 1 = Monday … 7 = Sunday
  return new Date(jan4.getTime() - (dow - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
}

/** Sunday (UTC) of the given ISO week, as YYYY-MM-DD. */
export function isoWeekEndDate(w: IsoWeek): string {
  return new Date(isoWeekMonday(w).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
}

/** Absolute week ordinal; consecutive ISO weeks differ by exactly 1. */
export function isoWeekOrdinal(w: IsoWeek): number {
  return Math.round(isoWeekMonday(w).getTime() / (7 * DAY_MS));
}

export function compareIsoWeeks(a: IsoWeek, b: IsoWeek): number {
  return a.year - b.year || a.week - b.week;
}

/** The `count` consecutive ISO week labels ending at (and including) `end`. */
export function precedingWeeks(end: IsoWeek, count: number): string[] {
  const endMonday = isoWeekMonday(end).getTime();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(isoWeekFromDate(new Date(endMonday - i * 7 * DAY_MS)));
  }
  return out;
}

/** ISO week label that contains the given UTC date. */
export function isoWeekFromDate(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return formatIsoWeek({ year, week });
}
