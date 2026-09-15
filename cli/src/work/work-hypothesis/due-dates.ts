/**
 * Due-date semantics for confirmed to-dos.
 *
 * A due date is stored as a plain YYYY-MM-DD string. Its state (upcoming / today /
 * overdue) depends on the current day, so it is computed at render time and is
 * never persisted. A cached state would go stale and keep reporting a passed
 * deadline as if it were still ahead.
 */

export type DueState = "upcoming" | "today" | "overdue" | "expired";

export interface DueStatus {
  state: DueState;
  /** Whole days past the due date. 0 on the due date, negative when still ahead. */
  daysPastDue: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Days of grace before a passed date counts as overdue. */
const OVERDUE_GRACE_DAYS = 0;

/**
 * Days a missed deadline is still chased, after which it expires.
 *
 * A date that passed long ago is usually not work any more — an event that ran,
 * a window that closed. Reporting it as "N days overdue" forever treats a closed
 * window as an open commitment, so past this point the item is expired: it stops
 * leading the brief and stops carrying an overdue count.
 */
const OVERDUE_CHASE_DAYS = 3;

/** Roll a passed date into next year only when the next occurrence is this near. */
const YEAR_ROLL_WINDOW_DAYS = 62;

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function partsOf(isoDate: string | undefined): DateParts | undefined {
  if (!isoDate) return undefined;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { year, month, day };
}

/** UTC midnight of the local calendar day — compares plain dates across time zones. */
export function localDayStart(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dueStatus(
  isoDate: string | undefined,
  now: Date = new Date(),
): DueStatus | undefined {
  const parts = partsOf(isoDate);
  if (!parts) return undefined;
  const due = Date.UTC(parts.year, parts.month - 1, parts.day);
  const daysPastDue = Math.round((localDayStart(now) - due) / DAY_MS);
  if (daysPastDue > OVERDUE_CHASE_DAYS) return { state: "expired", daysPastDue };
  if (daysPastDue > OVERDUE_GRACE_DAYS) return { state: "overdue", daysPastDue };
  if (daysPastDue === 0) return { state: "today", daysPastDue: 0 };
  return { state: "upcoming", daysPastDue };
}

export function isOverdue(isoDate: string | undefined, now: Date = new Date()): boolean {
  return dueStatus(isoDate, now)?.state === "overdue";
}

/** A date that passed too long ago to still be a live commitment. */
export function isExpired(isoDate: string | undefined, now: Date = new Date()): boolean {
  return dueStatus(isoDate, now)?.state === "expired";
}

export function overdueDaysPhrase(daysPastDue: number): string {
  return daysPastDue === 1 ? "1 day overdue" : `${daysPastDue} days overdue`;
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** "Tuesday 15 September 2026" — today's calendar day, spoken. */
export function formatDaySpoken(now: Date = new Date()): string {
  return `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${FULL_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Opening line of every brief: "Today is Tuesday 15 September 2026."
 * Every relative claim (overdue, due today, stalled for days) is read against
 * this day, so the day is stated before the claims that depend on it.
 */
export function todayLine(now: Date = new Date()): string {
  return `Today is ${formatDaySpoken(now)}.`;
}

/** "5 September", with the year appended when it is not the current year. */
export function formatDueSpoken(isoDate: string, now: Date = new Date()): string {
  const parts = partsOf(isoDate);
  if (!parts) return isoDate;
  const label = `${parts.day} ${FULL_MONTHS[parts.month - 1]}`;
  return parts.year === now.getFullYear() ? label : `${label} ${parts.year}`;
}

/** "5 Sep", with the year appended when it is not the current year. */
export function formatDueLabel(isoDate: string, now: Date = new Date()): string {
  const parts = partsOf(isoDate);
  if (!parts) return isoDate;
  const label = `${parts.day} ${SHORT_MONTHS[parts.month - 1]}`;
  return parts.year === now.getFullYear() ? label : `${label} ${parts.year}`;
}

/**
 * Clause for a due date that tells the truth about the past:
 * "due 20 September" / "due today" / "was due 5 September, 10 days overdue".
 */
export function formatDueNote(isoDate: string, now: Date = new Date()): string {
  const status = dueStatus(isoDate, now);
  if (!status) return `due ${isoDate}`;
  if (status.state === "overdue") {
    return `was due ${formatDueSpoken(isoDate, now)}, ${overdueDaysPhrase(status.daysPastDue)}`;
  }
  if (status.state === "expired") {
    return `was due ${formatDueSpoken(isoDate, now)}, and that date has passed`;
  }
  if (status.state === "today") return "due today";
  return `due ${formatDueSpoken(isoDate, now)}`;
}

/**
 * Resolve the year for a day/month given in text.
 *
 * A date that has just passed keeps its year, so a missed deadline reads as
 * overdue. It rolls into next year only when the next occurrence is genuinely
 * near — the year-boundary case, such as "by 2 January" said in late December.
 */
export function resolveDueYear(month: number, day: number, now: Date = new Date()): number {
  const today = localDayStart(now);
  const candidate = Date.UTC(now.getFullYear(), month, day);
  if (candidate >= today - 2 * DAY_MS) return now.getFullYear();
  const nextOccurrence = Date.UTC(now.getFullYear() + 1, month, day);
  if (nextOccurrence - today <= YEAR_ROLL_WINDOW_DAYS * DAY_MS) return now.getFullYear() + 1;
  return now.getFullYear();
}
