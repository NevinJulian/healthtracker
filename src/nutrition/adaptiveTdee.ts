import type { ActivityLevel, GoalType, Sex } from './tdee';

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

export function computeAdaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdeeResult {
  return {
    status: 'insufficient',
    reason: 'logged_days',
    progress: null,
    rawEstimate: null,
    windowStart: input.todayISO,
    windowEnd: input.todayISO,
    loggedDays: 0,
    leftOutDays: 0,
    meanIntake: null,
    weighIns: 0,
    slopeKgPerDay: null,
    weightChangeKg: null,
    latestTrendWeight: null,
    formulaTdee: null,
  };
}

export function suggestGoalCalories(a: {
  estimate: number;
  goalType: GoalType;
  currentGoal: number;
}): number {
  return a.currentGoal;
}

export function canApply(a: {
  suggestion: number;
  currentGoal: number;
  todayISO: string;
  appliedOn: string | null;
}): { show: boolean; returnsOn: string | null } {
  return { show: false, returnsOn: null };
}
