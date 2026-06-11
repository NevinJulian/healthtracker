/**
 * analyticsHelpers.ts
 *
 * Pure, DB-free helper functions for AnalyticsDashboardScreen.
 * All functions are side-effect free and fully unit-testable.
 *
 * Issue #265 — Analytics · strength progression + longer trends & streaks
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface StreakResult {
  current: number;
  longest: number;
}

export interface StreakSet {
  gym: StreakResult;
  walk: StreakResult;
  fasting: StreakResult;
}

export interface DailyLogSlice {
  date: string;
  walk_completed: boolean;
  hammer_completed: boolean;
  fasting_completed: boolean;
}

export interface StrengthPoint {
  date: string;
  /** Weight in kg at baseline + progression */
  weightKg: number;
  /** 0-based cycle index */
  cycle: number;
}

// ─────────────────────────────────────────────
// Streak computation
// ─────────────────────────────────────────────

/**
 * Compute current and longest streaks for gym, walk, and fasting
 * from an array of daily-log slices (any date range, any order).
 *
 * "Current" streak = consecutive days ending on `todayISO` (going back).
 * "Longest" streak = maximum consecutive run across the full window.
 *
 * A day that is absent from the logs array is treated as missed.
 *
 * @param logs - Array of daily log slices, any order.
 * @param todayISO - ISO date string for today (YYYY-MM-DD).
 */
export function computeStreaks(
  logs: DailyLogSlice[],
  todayISO: string
): StreakSet {
  // Build a map of date -> flags for O(1) lookups
  const byDate = new Map<string, DailyLogSlice>();
  for (const l of logs) {
    byDate.set(l.date, l);
  }

  // Sort all known dates ascending
  const sortedDates = [...byDate.keys()].sort();

  if (sortedDates.length === 0) {
    const zero: StreakResult = { current: 0, longest: 0 };
    return { gym: zero, walk: zero, fasting: zero };
  }

  // ── Longest streaks (scan forward) ──────────────────────────────────────────
  // Walk consecutive days: if a date is missing from sortedDates we can't
  // assume it is "missed" for the longest calc because getRollingWindow may
  // only return a window (e.g. ±7 days).  We therefore only count gaps as
  // breaks when two adjacent rows in sortedDates are more than 1 calendar day
  // apart (explicit gap) OR when the flag is false.

  function computeLongest(flag: (l: DailyLogSlice) => boolean): number {
    let longest = 0;
    let run = 0;
    let prevDate: string | null = null;

    for (const d of sortedDates) {
      const l = byDate.get(d)!;
      const isConsecutive =
        prevDate !== null && dateDiffDays(prevDate, d) === 1;

      if (!isConsecutive && prevDate !== null) {
        // Gap in dates — reset run
        run = 0;
      }

      if (flag(l)) {
        run++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
      prevDate = d;
    }
    return longest;
  }

  const longestGym = computeLongest((l) => l.hammer_completed);
  const longestWalk = computeLongest((l) => l.walk_completed);
  const longestFasting = computeLongest((l) => l.fasting_completed);

  // ── Current streaks (scan backward from today) ───────────────────────────────
  function computeCurrent(flag: (l: DailyLogSlice) => boolean): number {
    let streak = 0;
    let cursor = todayISO;

    // Walk backwards day by day
    for (let i = 0; i < 366; i++) {
      const entry = byDate.get(cursor);
      if (!entry) break; // day not in logs → streak ends
      if (!flag(entry)) break;
      streak++;
      cursor = offsetDate(cursor, -1);
    }
    return streak;
  }

  const currentGym = computeCurrent((l) => l.hammer_completed);
  const currentWalk = computeCurrent((l) => l.walk_completed);
  const currentFasting = computeCurrent((l) => l.fasting_completed);

  return {
    gym: { current: currentGym, longest: longestGym },
    walk: { current: currentWalk, longest: longestWalk },
    fasting: { current: currentFasting, longest: longestFasting },
  };
}

// ─────────────────────────────────────────────
// Strength progression computation
// ─────────────────────────────────────────────

/** Baseline label when no cycles have elapsed yet */
export const BASELINE_LABEL = 'Baseline';

/** Number of kg added per completed cycle */
export const KG_PER_CYCLE = 5;

/** Number of days per cycle */
export const CYCLE_DAYS = 21;

/**
 * Compute the gym-weight progression curve from `startDateISO` up to
 * `endDateISO` (inclusive), sampled daily.
 *
 * The weight at any date is:  baseline + floor((daysDiff / CYCLE_DAYS)) * KG_PER_CYCLE
 * where daysDiff = calendar days since startDateISO (0 on start day).
 *
 * Returns an empty array if startDateISO > endDateISO.
 *
 * @param startDateISO - App start date (from getStartDate()).
 * @param endDateISO   - Last date to include (usually today).
 * @param baselineKg   - Baseline weight (shown as "Baseline" in the chart).
 *                       We use 0 here and let the UI show relative kg added.
 */
export function computeStrengthProgression(
  startDateISO: string,
  endDateISO: string,
  baselineKg: number = 0
): StrengthPoint[] {
  const start = parseISO(startDateISO);
  const end = parseISO(endDateISO);

  if (start > end) return [];

  const result: StrengthPoint[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const iso = formatISO(cursor);
    const daysDiff = Math.round(
      (cursor.getTime() - start.getTime()) / 86_400_000
    );
    const cycle = Math.floor(daysDiff / CYCLE_DAYS);
    const weightKg = baselineKg + cycle * KG_PER_CYCLE;
    result.push({ date: iso, weightKg, cycle });
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

/**
 * Given the full progression series, return a deduplicated list of
 * "step" points — one entry per cycle boundary (where weight changes).
 * The first point and the last point are always included.
 *
 * Useful for rendering a step-line chart without plotting every single day.
 */
export function progressionSteps(points: StrengthPoint[]): StrengthPoint[] {
  if (points.length === 0) return [];
  const steps: StrengthPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].weightKg !== points[i - 1].weightKg) {
      steps.push(points[i]);
    }
  }
  // Always include the last point (current)
  if (steps[steps.length - 1] !== points[points.length - 1]) {
    steps.push(points[points.length - 1]);
  }
  return steps;
}

// ─────────────────────────────────────────────
// Date utilities (no external dep)
// ─────────────────────────────────────────────

/** Parse an ISO date string (YYYY-MM-DD) as midnight UTC-independent Date. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Format a Date as YYYY-MM-DD. */
function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Return how many calendar days b is after a (negative if before). */
function dateDiffDays(a: string, b: string): number {
  const da = parseISO(a);
  const db = parseISO(b);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** Return an ISO date string offset by `days` from `isoDate`. */
function offsetDate(isoDate: string, days: number): string {
  const d = parseISO(isoDate);
  d.setDate(d.getDate() + days);
  return formatISO(d);
}
