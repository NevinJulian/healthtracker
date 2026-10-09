import * as Sharing from 'expo-sharing';
import { cacheDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import {
  getAllDailyLogForExport,
  getAllMealsForExport,
  getAllWorkoutSetsForExport,
  type DailyLogExportRow,
  type MealExportRow,
  type WorkoutSetExportRow,
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

/**
 * Write workout_sets.csv, daily_log.csv and meals.csv to the cache directory and
 * share them one after the other. A file that cannot be written or shared is
 * reported and does not stop the next one.
 *
 * @returns The names of the files that failed.
 * @throws  When sharing is unavailable, a table cannot be read, or no file was exported.
 */
export async function exportCsv(): Promise<{ failed: string[] }> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device. Cannot export CSV.');
  }

  const [sets, log, meals] = await Promise.all([
    getAllWorkoutSetsForExport(),
    getAllDailyLogForExport(),
    getAllMealsForExport(),
  ]);
  const files = [
    { name: 'workout_sets.csv', content: workoutSetsToCsv(sets) },
    { name: 'daily_log.csv', content: dailyLogToCsv(log) },
    { name: 'meals.csv', content: mealsToCsv(meals) },
  ];

  const failed: string[] = [];
  for (const file of files) {
    const uri = `${cacheDirectory ?? ''}${file.name}`;
    try {
      await writeAsStringAsync(uri, file.content);
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: `Save ${file.name}`,
        UTI: 'public.comma-separated-values-text',
      });
    } catch (err) {
      console.warn(`[csvExport] Could not export ${file.name}:`, err);
      failed.push(file.name);
    }
  }

  if (failed.length === files.length) {
    throw new Error('Could not export any CSV file.');
  }
  return { failed };
}
