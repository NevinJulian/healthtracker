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

export function buildCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  void header;
  void rows;
  return '';
}

export function workoutSetsToCsv(rows: readonly WorkoutSetExportRow[]): string {
  void rows;
  return '';
}

export function dailyLogToCsv(rows: readonly DailyLogExportRow[]): string {
  void rows;
  return '';
}

export function mealsToCsv(rows: readonly MealExportRow[]): string {
  void rows;
  return '';
}
