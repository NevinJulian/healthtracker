/**
 * analyticsHelpers.ts
 *
 * Pure, DB-free helper functions for AnalyticsDashboardScreen.
 * All functions are side-effect free and fully unit-testable.
 *
 * Issue #265 — Analytics · strength progression + longer trends & streaks
 * Issue #267 — Analytics · nutrition adherence + meal & recipe insights
 * Issue #279 — timezone / local-date hardening (date utils delegated to src/utils/dates.ts)
 */

import {
  dateKeyToLocalDate,
  localDateKey,
  addDays as _addDays,
  daysBetween as _daysBetween,
} from '../utils/dates';

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
  if (startDateISO > endDateISO) return [];

  const result: StrengthPoint[] = [];
  let cursorISO = startDateISO;

  while (cursorISO <= endDateISO) {
    // DST-safe calendar-day difference via the centralised helper
    const daysDiff = dateDiffDays(startDateISO, cursorISO);
    const cycle = Math.floor(daysDiff / CYCLE_DAYS);
    const weightKg = baselineKg + cycle * KG_PER_CYCLE;
    result.push({ date: cursorISO, weightKg, cycle });
    cursorISO = offsetDate(cursorISO, 1);
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
// Date utilities — delegated to src/utils/dates (issue #279)
// ─────────────────────────────────────────────

/** Parse an ISO date string (YYYY-MM-DD) as local midnight. */
const parseISO = dateKeyToLocalDate;

/** Format a Date as YYYY-MM-DD using local calendar getters. */
const formatISO = localDateKey;

/** Return how many calendar days b is after a (negative if before). */
const dateDiffDays = _daysBetween;

/** Return an ISO date string offset by `days` from `isoDate`. */
const offsetDate = _addDays;

// ─────────────────────────────────────────────
// Nutrition adherence helpers (#267)
// ─────────────────────────────────────────────

export interface DailyMacroPoint {
  date: string;
  calories: number;
  protein: number;
}

/**
 * Given a list of per-day macro totals from `getConsumedMacrosByDay()`,
 * compute how many days are at or above the given calorie goal and protein goal.
 *
 * Returns a 0–1 fraction for each goal (0 when input is empty).
 */
export function computeGoalAdherenceDays(
  days: DailyMacroPoint[],
  calorieGoal: number,
  proteinGoal: number
): { calorieAdherence: number; proteinAdherence: number } {
  if (days.length === 0) return { calorieAdherence: 0, proteinAdherence: 0 };
  const calDays = days.filter((d) => d.calories >= calorieGoal).length;
  const protDays = days.filter((d) => d.protein >= proteinGoal).length;
  return {
    calorieAdherence: calDays / days.length,
    proteinAdherence: protDays / days.length,
  };
}

/**
 * Normalise a series of daily macro totals to a 0–1 range relative to `goalValue`
 * for use in a View-based chart (bar heights). A day at or above the goal is 1.0.
 * Days exceeding the goal are capped at 1.0.
 *
 * Returns the same array with each point replaced by its clamped ratio.
 * Handles goalValue = 0 gracefully (returns all zeros).
 */
export function normaliseMacroSeries(
  days: DailyMacroPoint[],
  key: 'calories' | 'protein',
  goalValue: number
): number[] {
  if (goalValue <= 0) return days.map(() => 0);
  return days.map((d) => Math.min(1, d[key] / goalValue));
}

/**
 * Build a compact display label for a per-day macro chart.
 * Returns "dd/MM" for the first and last item; empty string for all others.
 * Used by the View-based chart to avoid label clutter.
 */
export function macroChartDateLabel(index: number, total: number, date: string): string {
  if (total <= 1) return date.substring(8, 10) + '/' + date.substring(5, 7);
  if (index === 0 || index === total - 1) {
    return date.substring(8, 10) + '/' + date.substring(5, 7);
  }
  return '';
}

/**
 * Compute the 7-day rolling average of a macro series. Returns an array of
 * the same length; the first min(6, length-1) entries use a shorter window.
 * Useful for smoothing noisy daily data.
 */
export function rollingAverage(values: number[], window: number = 7): number[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

// ─────────────────────────────────────────────
// Hydration helpers (#283)
// ─────────────────────────────────────────────

export interface HydrationDay {
  date: string;
  water_ml: number;
}

/**
 * Compute the average daily water intake over the given array of daily rows.
 * Returns 0 when the array is empty.
 *
 * @param days - Array of {date, water_ml} entries (any date range, any order).
 */
export function hydrationAverage(days: HydrationDay[]): number {
  if (days.length === 0) return 0;
  const total = days.reduce((sum, d) => sum + d.water_ml, 0);
  return Math.round(total / days.length);
}

/**
 * Compute how many days in the array reached or exceeded `goalMl`.
 * Returns a 0–1 fraction (0 when the array is empty).
 *
 * @param days   - Array of {date, water_ml} entries.
 * @param goalMl - Daily hydration goal in ml.
 */
export function hydrationGoalAdherence(days: HydrationDay[], goalMl: number): number {
  if (days.length === 0 || goalMl <= 0) return 0;
  const met = days.filter((d) => d.water_ml >= goalMl).length;
  return met / days.length;
}

// ─────────────────────────────────────────────
// Body-measurement helpers (#283)
// ─────────────────────────────────────────────

export interface MeasurementPoint {
  waist_cm: number | null;
  chest_cm: number | null;
  hips_cm: number | null;
  thigh_cm: number | null;
  arm_cm: number | null;
}

export type MeasurementField = keyof MeasurementPoint;

/**
 * Given an ordered array of measurement records (oldest → newest), compute
 * the change in a specific field from the first non-null value to the last
 * non-null value.
 *
 * Returns null when fewer than two non-null values exist for that field.
 *
 * @param records - Array of MeasurementPoint objects, oldest first.
 * @param field   - Which measurement to compute the delta for.
 */
export function measurementDelta(
  records: MeasurementPoint[],
  field: MeasurementField
): number | null {
  const values = records.map((r) => r[field]).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  return values[values.length - 1] - values[0];
}

/**
 * Return the latest non-null value for `field` across the records array,
 * or null when no records contain a value for that field.
 *
 * @param records - Array of MeasurementPoint objects, oldest first.
 * @param field   - Which field to extract.
 */
export function latestMeasurementValue(
  records: MeasurementPoint[],
  field: MeasurementField
): number | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const v = records[i][field];
    if (v !== null) return v;
  }
  return null;
}

// ─────────────────────────────────────────────
// Workout set / PR helpers (#285)
// ─────────────────────────────────────────────

export interface WorkoutSetSlice {
  id: number;
  date: string;
  exercise: string;
  reps: number;
  weight_kg: number;
}

export interface PRRecord {
  /** Best (heaviest) single weight logged, with the date it was achieved. */
  bestWeight: { value: number; date: string } | null;
  /** Best estimated 1-rep max (Epley), with the date it was achieved. */
  best1RM: { value: number; date: string } | null;
  /** Best single-set volume (weight × reps), with the date it was achieved. */
  bestVolume: { value: number; date: string } | null;
}

/**
 * Epley estimated 1-rep max.
 *
 * Formula: weight * (1 + reps / 30)
 * For reps === 1 the formula reduces to `weight * (1 + 1/30)` which is slightly
 * above the actual weight — we special-case it to return `weight` exactly so
 * that a single-rep max is always equal to the actual load lifted.
 *
 * @param weightKg - Weight used for the set in kg.
 * @param reps     - Repetitions performed (must be >= 1).
 */
export function estimated1RM(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * Compute personal records from a chronological history of logged sets for a
 * single exercise.
 *
 * Returns null for each PR category when the history is empty.
 * When multiple sets tie for the best value, the earliest occurrence is used
 * (first-achieved wins).
 *
 * @param history - Array of WorkoutSetSlice objects, ordered chronologically
 *                  (oldest first — as returned by getWorkoutHistory()).
 */
export function computePRs(history: WorkoutSetSlice[]): PRRecord {
  if (history.length === 0) {
    return { bestWeight: null, best1RM: null, bestVolume: null };
  }

  let bestWeight: { value: number; date: string } | null = null;
  let best1RM: { value: number; date: string } | null = null;
  let bestVolume: { value: number; date: string } | null = null;

  for (const set of history) {
    const orm = estimated1RM(set.weight_kg, set.reps);
    const volume = set.weight_kg * set.reps;

    // Best weight — strictly greater (first-achieved wins on tie)
    if (bestWeight === null || set.weight_kg > bestWeight.value) {
      bestWeight = { value: set.weight_kg, date: set.date };
    }

    // Best 1RM — strictly greater (first-achieved wins on tie)
    if (best1RM === null || orm > best1RM.value) {
      best1RM = { value: orm, date: set.date };
    }

    // Best volume — strictly greater (first-achieved wins on tie)
    if (bestVolume === null || volume > bestVolume.value) {
      bestVolume = { value: volume, date: set.date };
    }
  }

  return { bestWeight, best1RM, bestVolume };
}

/**
 * Collapse a set history into one "best set per calendar day" for charting.
 *
 * "Best" = highest weight_kg on that day; on ties, highest reps breaks the tie;
 * if still tied, the first occurrence is returned (stable order).
 *
 * @param history - Array of WorkoutSetSlice objects for a single exercise,
 *                  ordered chronologically (as from getWorkoutHistory()).
 * @returns One entry per distinct date, sorted ascending by date.
 */
export function bestSetPerDay(
  history: WorkoutSetSlice[]
): { date: string; weight_kg: number; reps: number; estimated1RM: number }[] {
  const byDate = new Map<
    string,
    { date: string; weight_kg: number; reps: number; estimated1RM: number }
  >();

  for (const set of history) {
    const existing = byDate.get(set.date);
    const orm = estimated1RM(set.weight_kg, set.reps);

    if (!existing) {
      byDate.set(set.date, {
        date: set.date,
        weight_kg: set.weight_kg,
        reps: set.reps,
        estimated1RM: orm,
      });
    } else if (
      set.weight_kg > existing.weight_kg ||
      (set.weight_kg === existing.weight_kg && set.reps > existing.reps)
    ) {
      byDate.set(set.date, {
        date: set.date,
        weight_kg: set.weight_kg,
        reps: set.reps,
        estimated1RM: orm,
      });
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
}
