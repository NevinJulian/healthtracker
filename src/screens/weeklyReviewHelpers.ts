import { addDays } from '../utils/dates';
import { computePRs, formatWeightRate, type WorkoutSetSlice } from './analyticsHelpers';

export interface DateRange {
  from: string;
  to: string;
}

export interface ReviewWindows {
  current: DateRange;
  previous: DateRange;
}

export interface ReviewLogDay {
  date: string;
  is_rest_day: boolean;
  hammer_completed: boolean;
  walk_completed: boolean;
  body_weight: number | null;
}

export interface ReviewIntakeDay {
  date: string;
  calories: number;
  protein: number;
}

export interface WeeklyReviewInput {
  today: string;
  logs: ReviewLogDay[];
  sets: WorkoutSetSlice[];
  intake: ReviewIntakeDay[];
  goals: { calories: number; protein: number };
  weightRatePerWeek: number | null;
}

export interface ReviewRow {
  label: string;
  value: string;
  previous: string | null;
  change: string | null;
}

export interface ReviewSection {
  title: string;
  emptyText: string | null;
  rows: ReviewRow[];
}

export interface WeeklyReview {
  windows: ReviewWindows;
  ranges: { current: string; previous: string };
  nothingLogged: boolean;
  sections: ReviewSection[];
}

export interface NewBest {
  exercise: string;
  weightKg: number;
}

interface Comparison {
  value: string;
  change: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NO_PREVIOUS = '—';
const MINUS = '−';
const DAYS_IN_WINDOW = 7;

export function reviewWindows(today: string): ReviewWindows {
  return {
    current: { from: addDays(today, -6), to: today },
    previous: { from: addDays(today, -13), to: addDays(today, -7) },
  };
}

function formatDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function formatDateRange(from: string, to: string): string {
  return `${formatDay(from)} – ${formatDay(to)}`;
}

export function formatNumber(value: number): string {
  const grouped = String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value < 0 ? `${MINUS}${grouped}` : grouped;
}

export function formatChange(delta: number, singular: string, plural: string = singular): string {
  if (delta === 0) return 'no change';
  const size = Math.abs(delta);
  return `${delta > 0 ? '+' : MINUS}${size} ${size === 1 ? singular : plural}`;
}

function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

function formatWeightKg(weightKg: number): string {
  return String(Math.round(weightKg * 100) / 100);
}

export function newBests(sets: WorkoutSetSlice[], window: DateRange): NewBest[] {
  const exercises = new Set(sets.filter((s) => inRange(s.date, window)).map((s) => s.exercise));
  const bests: NewBest[] = [];
  for (const exercise of exercises) {
    const own = sets.filter((s) => s.exercise === exercise);
    const prior = computePRs(own.filter((s) => s.date < window.from)).bestWeight;
    const inside = computePRs(own.filter((s) => inRange(s.date, window))).bestWeight;
    if (prior !== null && inside !== null && inside.value > prior.value) {
      bests.push({ exercise, weightKg: inside.value });
    }
  }
  return bests.sort((a, b) => {
    const left = a.exercise.toLowerCase();
    const right = b.exercise.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function trainingStats(logs: ReviewLogDay[], range: DateRange) {
  const rows = logs.filter((l) => inRange(l.date, range));
  const planned = rows.filter((l) => !l.is_rest_day);
  const gymDone = planned.filter((l) => l.hammer_completed).length;
  const walks = rows.filter((l) => l.walk_completed).length;
  return { gymDone, gymPlanned: planned.length, walks, hasData: gymDone > 0 || walks > 0 };
}

function liftingStats(sets: WorkoutSetSlice[], range: DateRange) {
  const working = sets.filter((s) => inRange(s.date, range) && s.set_type !== 'warmup');
  const tonnage = Math.round(working.reduce((sum, s) => sum + s.weight_kg * s.reps, 0));
  return { count: working.length, tonnage, hasData: working.length > 0 };
}

function intakeStats(intake: ReviewIntakeDay[], range: DateRange) {
  const days = intake.filter((d) => inRange(d.date, range));
  const mean = (pick: (d: ReviewIntakeDay) => number) =>
    days.length === 0 ? 0 : Math.round(days.reduce((sum, d) => sum + pick(d), 0) / days.length);
  return {
    days: days.length,
    calories: mean((d) => d.calories),
    protein: mean((d) => d.protein),
    hasData: days.length > 0,
  };
}

function comparedRow(label: string, value: string, previous: Comparison | null): ReviewRow {
  return {
    label,
    value,
    previous: previous ? previous.value : NO_PREVIOUS,
    change: previous ? previous.change : null,
  };
}

function plainRow(label: string, value: string): ReviewRow {
  return { label, value, previous: null, change: null };
}

function trainingSection(input: WeeklyReviewInput, windows: ReviewWindows): ReviewSection {
  const cur = trainingStats(input.logs, windows.current);
  const prev = trainingStats(input.logs, windows.previous);
  if (!cur.hasData) {
    return { title: 'Training', emptyText: 'No sessions or walks logged.', rows: [] };
  }
  return {
    title: 'Training',
    emptyText: null,
    rows: [
      comparedRow(
        'Gym sessions',
        `${cur.gymDone} of ${cur.gymPlanned}`,
        prev.hasData
          ? {
              value: `${prev.gymDone} of ${prev.gymPlanned}`,
              change: formatChange(cur.gymDone - prev.gymDone, 'session', 'sessions'),
            }
          : null
      ),
      comparedRow(
        'Walks',
        `${cur.walks} of ${DAYS_IN_WINDOW}`,
        prev.hasData
          ? {
              value: `${prev.walks} of ${DAYS_IN_WINDOW}`,
              change: formatChange(cur.walks - prev.walks, 'walk', 'walks'),
            }
          : null
      ),
    ],
  };
}

function liftingSection(input: WeeklyReviewInput, windows: ReviewWindows): ReviewSection {
  const cur = liftingStats(input.sets, windows.current);
  const prev = liftingStats(input.sets, windows.previous);
  if (!cur.hasData) {
    return { title: 'Lifting', emptyText: 'No sets logged.', rows: [] };
  }
  return {
    title: 'Lifting',
    emptyText: null,
    rows: [
      comparedRow(
        'Working sets',
        formatNumber(cur.count),
        prev.hasData
          ? {
              value: formatNumber(prev.count),
              change: formatChange(cur.count - prev.count, 'set', 'sets'),
            }
          : null
      ),
      comparedRow(
        'Tonnage',
        `${formatNumber(cur.tonnage)} kg`,
        prev.hasData
          ? {
              value: `${formatNumber(prev.tonnage)} kg`,
              change: formatChange(cur.tonnage - prev.tonnage, 'kg'),
            }
          : null
      ),
    ],
  };
}

function bestsSection(input: WeeklyReviewInput, windows: ReviewWindows): ReviewSection {
  const bests = newBests(input.sets, windows.current);
  if (bests.length === 0) {
    return { title: 'New bests', emptyText: 'No new bests.', rows: [] };
  }
  return {
    title: 'New bests',
    emptyText: null,
    rows: bests.map((best) => plainRow(best.exercise, `${formatWeightKg(best.weightKg)} kg`)),
  };
}

function nutritionSection(input: WeeklyReviewInput, windows: ReviewWindows): ReviewSection {
  const cur = intakeStats(input.intake, windows.current);
  const prev = intakeStats(input.intake, windows.previous);
  if (!cur.hasData) {
    return { title: 'Nutrition', emptyText: 'No meals or entries logged.', rows: [] };
  }
  const { goals } = input;
  return {
    title: 'Nutrition',
    emptyText: null,
    rows: [
      comparedRow(
        'Mean calories',
        `${formatNumber(cur.calories)} kcal`,
        prev.hasData
          ? {
              value: `${formatNumber(prev.calories)} kcal`,
              change: formatChange(cur.calories - prev.calories, 'kcal'),
            }
          : null
      ),
      comparedRow(
        'Mean protein',
        `${formatNumber(cur.protein)} g`,
        prev.hasData
          ? {
              value: `${formatNumber(prev.protein)} g`,
              change: formatChange(cur.protein - prev.protein, 'g'),
            }
          : null
      ),
      comparedRow(
        'Days logged',
        String(cur.days),
        prev.hasData
          ? { value: String(prev.days), change: formatChange(cur.days - prev.days, 'day', 'days') }
          : null
      ),
      plainRow('Goal', `${formatNumber(goals.calories)} kcal · ${formatNumber(goals.protein)} g`),
    ],
  };
}

function weightSection(input: WeeklyReviewInput): ReviewSection {
  const rate = input.weightRatePerWeek;
  if (rate === null || !Number.isFinite(rate)) {
    return { title: 'Weight', emptyText: 'Not enough weigh-ins yet.', rows: [] };
  }
  return { title: 'Weight', emptyText: null, rows: [plainRow('Trend', formatWeightRate(rate))] };
}

function nothingLoggedIn(input: WeeklyReviewInput, range: DateRange): boolean {
  return (
    !trainingStats(input.logs, range).hasData &&
    !input.sets.some((s) => inRange(s.date, range)) &&
    !intakeStats(input.intake, range).hasData &&
    !input.logs.some((l) => inRange(l.date, range) && l.body_weight !== null)
  );
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const windows = reviewWindows(input.today);
  const nothingLogged = nothingLoggedIn(input, windows.current);
  return {
    windows,
    ranges: {
      current: formatDateRange(windows.current.from, windows.current.to),
      previous: formatDateRange(windows.previous.from, windows.previous.to),
    },
    nothingLogged,
    sections: nothingLogged
      ? []
      : [
          trainingSection(input, windows),
          liftingSection(input, windows),
          bestsSection(input, windows),
          nutritionSection(input, windows),
          weightSection(input),
        ],
  };
}
