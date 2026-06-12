/**
 * src/utils/dates.ts
 *
 * Single source of truth for all local-calendar date operations in HealthTracker.
 *
 * Every date key stored in the database (daily_log, meal_inventory, cook_log,
 * weekly_meal_plan, etc.) is a YYYY-MM-DD string derived from the LOCAL
 * calendar date — never from UTC / toISOString().
 *
 * Issue #279 — timezone / local-date hardening
 */

// ─────────────────────────────────────────────
// Core: local YYYY-MM-DD string from a Date
// ─────────────────────────────────────────────

/**
 * Return a YYYY-MM-DD string built from the **local** calendar date of `date`.
 * Defaults to the current moment when called without arguments.
 *
 * Uses local getters (getFullYear / getMonth / getDate) — never toISOString()
 * — so the result is correct for users in any timezone, including across DST
 * boundaries.
 */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convenience wrapper — returns the local date key for right now.
 * Equivalent to `localDateKey()` but reads more clearly at call sites.
 */
export function todayKey(): string {
  return localDateKey();
}

// ─────────────────────────────────────────────
// Parse a date key as a local-midnight Date
// ─────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD string into a `Date` set to **local midnight** on that
 * calendar day.
 *
 * `new Date('YYYY-MM-DD')` is parsed as UTC midnight by the spec — which
 * means it lands on the previous calendar day for users west of UTC.  This
 * function avoids that by using the `Date(y, m, d)` constructor with numeric
 * parts (always interpreted as local time).
 */
export function dateKeyToLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

// ─────────────────────────────────────────────
// Calendar-day arithmetic
// ─────────────────────────────────────────────

/**
 * Return a new YYYY-MM-DD string that is `n` calendar days after (or before,
 * when n is negative) `dateKey`.
 *
 * Operates on local midnight dates so the result is always a clean calendar
 * day — not an hour off due to DST transitions.
 */
export function addDays(dateKey: string, n: number): string {
  const d = dateKeyToLocalDate(dateKey);
  d.setDate(d.getDate() + n);
  return localDateKey(d);
}

/**
 * Return the number of calendar days from `a` to `b` (positive when b is
 * after a, negative when b is before a).
 *
 * Uses local-midnight dates and rounds the millisecond difference so DST
 * transitions (which introduce a ±1 h offset) do not skew the result.
 */
export function daysBetween(a: string, b: string): number {
  const da = dateKeyToLocalDate(a);
  const db = dateKeyToLocalDate(b);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * Return a `Date` set to local midnight for today.
 * Useful when you need a `Date` object (e.g. to drive a loop day-by-day)
 * rather than a string.
 */
export function localMidnightToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
