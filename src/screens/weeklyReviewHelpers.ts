import type { WorkoutSetSlice } from './analyticsHelpers';

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

export function reviewWindows(today: string): ReviewWindows {
  return {
    current: { from: '', to: today },
    previous: { from: '', to: '' },
  };
}

export function formatDateRange(from: string, to: string): string {
  return '';
}

export function formatNumber(value: number): string {
  return '';
}

export function formatChange(delta: number, singular: string, plural: string = singular): string {
  return '';
}

export function newBests(sets: WorkoutSetSlice[], window: DateRange): NewBest[] {
  return [];
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const windows = reviewWindows(input.today);
  return { windows, ranges: { current: '', previous: '' }, nothingLogged: true, sections: [] };
}
