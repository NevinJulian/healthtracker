import type {
  DailyLogExportRow,
  MealExportRow,
  WorkoutSetExportRow,
} from '../db/database';

export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Spreadsheets run a text cell starting with one of these as a formula. */
export function guardFormula(text: string): string {
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = guardFormula(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BOM = '﻿';
const EOL = '\r\n';

export function buildCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((fields) => fields.map(escapeCsvField).join(',') + EOL);
  return BOM + lines.join('');
}

export function workoutSetsToCsv(rows: readonly WorkoutSetExportRow[]): string {
  return buildCsv(
    ['date', 'exercise', 'set_index', 'set_type', 'reps', 'weight_kg', 'created_at'],
    rows.map((r) => [
      r.date,
      r.exercise,
      r.set_index,
      r.set_type === 'warmup' ? 'warmup' : 'working',
      r.reps,
      r.weight_kg,
      r.created_at,
    ])
  );
}

export function dailyLogToCsv(rows: readonly DailyLogExportRow[]): string {
  return buildCsv(
    ['date', 'body_weight', 'water_ml', 'walk_completed', 'hammer_completed', 'fasting_completed'],
    rows.map((r) => [
      r.date,
      r.body_weight,
      r.water_ml,
      r.walk_completed,
      r.hammer_completed,
      r.fasting_completed,
    ])
  );
}

export function mealsToCsv(rows: readonly MealExportRow[]): string {
  return buildCsv(
    ['date', 'meal_type', 'recipe_title', 'calories', 'protein', 'carbs', 'fat', 'is_consumed'],
    rows.map((r) => [
      r.date,
      r.meal_type,
      r.recipe_title,
      r.calories,
      r.protein,
      r.carbs,
      r.fat,
      r.is_consumed,
    ])
  );
}
