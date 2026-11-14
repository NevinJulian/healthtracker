import { addDays, daysBetween } from '../utils/dates';
import { formulaTdee, goalDelta, type ActivityLevel, type GoalType, type Sex } from './tdee';

export const WINDOW_DAYS = 28;
export const MIN_LOGGED_DAYS = 14;
export const MIN_LOGGED_KCAL = 1000;
export const MIN_WEIGHINS = 10;
export const KCAL_PER_KG = 7700;
export const BAND_LOW = 0.7;
export const BAND_HIGH = 1.3;
export const MAX_GOAL_CHANGE = 0.1;
export const APPLY_WAIT_DAYS = 7;
export const APPLY_DEADBAND_KCAL = 10;

const MIN_GOAL_KCAL = 1000;

export interface AdaptiveTdeeInput {
  todayISO: string;
  intake: { date: string; calories: number }[];
  trend: { date: string; trend: number }[];
  profile: {
    sex: Sex | null;
    age: number | null;
    heightCm: number | null;
    activityLevel: ActivityLevel | null;
    goalType: GoalType | null;
  };
}

export interface AdaptiveTdeeStats {
  windowStart: string;
  windowEnd: string;
  loggedDays: number;
  leftOutDays: number;
  meanIntake: number | null;
  weighIns: number;
  slopeKgPerDay: number | null;
  weightChangeKg: number | null;
  latestTrendWeight: number | null;
  formulaTdee: number | null;
}

export type InsufficientReason = 'logged_days' | 'weigh_ins' | 'profile' | 'out_of_range';

export type AdaptiveTdeeResult =
  | ({ status: 'estimate'; estimate: number } & AdaptiveTdeeStats)
  | ({
      status: 'insufficient';
      reason: InsufficientReason;
      progress: { have: number; need: number } | null;
      rawEstimate: number | null;
    } & AdaptiveTdeeStats);

// Floating-point products such as 2200 * 0.7 land a hair off the exact value.
function exact(value: number): number {
  return Number(value.toFixed(6));
}

function round10(value: number): number {
  return Math.round(exact(value / 10)) * 10;
}

function leastSquaresSlope(points: { x: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - meanX) * (p.y - meanY);
    sxx += (p.x - meanX) ** 2;
  }
  return sxx === 0 ? null : sxy / sxx;
}

export function computeAdaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdeeResult {
  const windowStart = addDays(input.todayISO, -WINDOW_DAYS);
  const windowEnd = addDays(input.todayISO, -1);
  const inWindow = (date: string) => date >= windowStart && date <= windowEnd;

  const days = input.intake.filter((d) => inWindow(d.date));
  const logged = days.filter((d) => d.calories >= MIN_LOGGED_KCAL);
  const loggedDays = logged.length;
  const leftOutDays = days.length - loggedDays;
  const meanIntake =
    loggedDays > 0 ? logged.reduce((sum, d) => sum + d.calories, 0) / loggedDays : null;

  const upToYesterday = input.trend.filter((t) => t.date <= windowEnd);
  const windowTrend = upToYesterday.filter((t) => t.date >= windowStart);
  const weighIns = windowTrend.length;
  const slopeKgPerDay = leastSquaresSlope(
    windowTrend.map((t) => ({ x: daysBetween(windowStart, t.date), y: t.trend }))
  );
  const latestTrendWeight =
    upToYesterday.length > 0 ? upToYesterday[upToYesterday.length - 1].trend : null;

  const { sex, age, heightCm, activityLevel, goalType } = input.profile;
  const formula =
    sex !== null &&
    age !== null &&
    heightCm !== null &&
    activityLevel !== null &&
    goalType !== null &&
    latestTrendWeight !== null
      ? formulaTdee({ sex, age, heightCm, activityLevel, goalType }, latestTrendWeight)
      : null;

  const stats: AdaptiveTdeeStats = {
    windowStart,
    windowEnd,
    loggedDays,
    leftOutDays,
    meanIntake,
    weighIns,
    slopeKgPerDay,
    weightChangeKg: slopeKgPerDay === null ? null : slopeKgPerDay * WINDOW_DAYS,
    latestTrendWeight,
    formulaTdee: formula,
  };

  const insufficient = (
    reason: InsufficientReason,
    progress: { have: number; need: number } | null,
    rawEstimate: number | null = null
  ): AdaptiveTdeeResult => ({ status: 'insufficient', reason, progress, rawEstimate, ...stats });

  if (loggedDays < MIN_LOGGED_DAYS || meanIntake === null) {
    return insufficient('logged_days', { have: loggedDays, need: MIN_LOGGED_DAYS });
  }
  if (weighIns < MIN_WEIGHINS || slopeKgPerDay === null) {
    return insufficient('weigh_ins', { have: weighIns, need: MIN_WEIGHINS });
  }
  if (formula === null) {
    return insufficient('profile', null);
  }

  const raw = meanIntake - slopeKgPerDay * KCAL_PER_KG;
  if (
    !Number.isFinite(raw) ||
    exact(raw) < exact(formula * BAND_LOW) ||
    exact(raw) > exact(formula * BAND_HIGH)
  ) {
    return insufficient('out_of_range', null, Number.isFinite(raw) ? raw : null);
  }

  return { status: 'estimate', estimate: round10(raw), ...stats };
}

export function suggestGoalCalories(a: {
  estimate: number;
  goalType: GoalType;
  currentGoal: number;
}): number {
  const upper = Math.floor(exact((a.currentGoal * (1 + MAX_GOAL_CHANGE)) / 10)) * 10;
  const lower = Math.ceil(exact((a.currentGoal * (1 - MAX_GOAL_CHANGE)) / 10)) * 10;
  const wanted = round10(a.estimate + goalDelta(a.goalType));
  return Math.max(MIN_GOAL_KCAL, Math.min(upper, Math.max(lower, wanted)));
}

export function canApply(a: {
  suggestion: number;
  currentGoal: number;
  todayISO: string;
  appliedOn: string | null;
}): { show: boolean; returnsOn: string | null } {
  const returnsOn = a.appliedOn !== null ? addDays(a.appliedOn, APPLY_WAIT_DAYS) : null;
  if (returnsOn !== null && a.todayISO < returnsOn) {
    return { show: false, returnsOn };
  }
  return {
    show: Math.abs(a.suggestion - a.currentGoal) > APPLY_DEADBAND_KCAL,
    returnsOn: null,
  };
}
