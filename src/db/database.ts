/**
 * Database layer for the 7-Day Rolling Window architecture.
 *
 * Key concepts:
 *   - app_state stores the app_start_date (ISO date string, set once on first launch)
 *   - weekly_template holds 7 base rows indexed by JavaScript day-of-week (0=Sun…6=Sat)
 *   - daily_log is the rolling tracker: always contains today–7 to today+7
 *   - syncRollingSchedule() must be called on every app launch
 */

import * as SQLite from 'expo-sqlite';
import { ALL_MIGRATIONS } from './schema';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DB_NAME = 'healthtracker.db';
const START_DATE_KEY = 'app_start_date';

// Weight added per 21-day progression cycle (kg)
const KG_PER_CYCLE = 5;
// Number of days per progression cycle
const CYCLE_DAYS = 21;
// Days to generate ahead of today
const DAYS_AHEAD = 7;
// Days of history to retain (older than this are pruned)
const DAYS_HISTORY = 7;

let _db: SQLite.SQLiteDatabase | null = null;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WeeklyTemplateDay {
  day_of_week: number;     // 0=Sun, 1=Mon … 6=Sat
  walking_task: string;
  hammer_task: string;
  is_rest_day: boolean;
  is_meal_prep_day: boolean;
}

export interface DailyLogEntry {
  date: string;            // ISO date: YYYY-MM-DD
  walking_task: string;
  hammer_task: string;
  walk_completed: boolean;
  hammer_completed: boolean;
  fasting_completed: boolean;
  is_rest_day: boolean;
  is_meal_prep_day: boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Returns today as a YYYY-MM-DD string in local time. */
export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns a new Date offset by `days` from the given date (midnight local). */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Returns the difference in whole calendar days between two ISO date strings. */
function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA);
  const b = new Date(isoB);
  // Normalise to midnight UTC to avoid DST issues
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Builds the suffixed hammer_task string with the weight progression.
 *   cycle = floor(daysDiff / 21)
 *   if is_rest_day  → appends " @ Light Weight"
 *   else cycle == 0 → appends " @ Baseline"
 *   else            → appends " @ Baseline + <cycle*5>kg"
 */
function buildHammerTask(
  baseTask: string,
  isRestDay: boolean,
  daysDiff: number
): string {
  if (isRestDay) return `${baseTask} @ Light Weight`;
  const cycle = Math.floor(daysDiff / CYCLE_DAYS);
  if (cycle === 0) return `${baseTask} @ Baseline`;
  return `${baseTask} @ Baseline + ${cycle * KG_PER_CYCLE}kg`;
}

// ─────────────────────────────────────────────
// Database Init
// ─────────────────────────────────────────────

/**
 * Opens the database, runs all migrations/seeds, records start date on first
 * launch, then syncs the rolling schedule.
 * Must be awaited before any other DB call.
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  _db = await SQLite.openDatabaseAsync(DB_NAME);

  // Enable WAL for better concurrent reads
  await _db.execAsync('PRAGMA journal_mode = WAL;');

  // Run all migrations (idempotent CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE)
  for (const statement of ALL_MIGRATIONS) {
    await _db.execAsync(statement);
  }

  // Record start date on very first launch
  const existing = await _db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  if (!existing) {
    const today = toISODate();
    await _db.runAsync(
      'INSERT INTO app_state (key, value) VALUES (?, ?)',
      [START_DATE_KEY, today]
    );
  }

  // Generate / prune the rolling window
  await syncRollingSchedule();

  return _db;
}

/** Returns the open DB instance. initDatabase() must have been called first. */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialised. Call initDatabase() first.');
  return _db;
}

// ─────────────────────────────────────────────
// Task 3 — Rolling Schedule Sync
// ─────────────────────────────────────────────

/**
 * Ensures the daily_log table always has entries from today up to today+7.
 * Any entry older than today-7 is pruned.
 *
 * Called automatically by initDatabase() and can be called manually on
 * app foregrounding.
 */
export async function syncRollingSchedule(): Promise<void> {
  const db = getDatabase();

  // 1. Fetch app_start_date for progression maths
  const startRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  const startDateISO = startRow?.value ?? toISODate();

  // 2. Fetch the weekly template (all 7 rows)
  const templateRows = await db.getAllAsync<{
    day_of_week: number;
    walking_task: string;
    hammer_task: string;
    is_rest_day: number;
    is_meal_prep_day: number;
  }>('SELECT * FROM weekly_template');

  const templateMap = new Map<number, typeof templateRows[number]>();
  for (const row of templateRows) {
    templateMap.set(row.day_of_week, row);
  }

  // 3. Determine the dates that should exist: today … today+DAYS_AHEAD
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await db.withTransactionAsync(async () => {
    for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
      const targetDate = addDays(today, offset);
      const targetISO = toISODate(targetDate);

      // Skip if a log entry already exists for this date
      const existing = await db.getFirstAsync<{ date: string }>(
        'SELECT date FROM daily_log WHERE date = ?',
        [targetISO]
      );
      if (existing) continue;

      // Look up the template row for this weekday
      const dow = targetDate.getDay(); // 0=Sun … 6=Sat
      const template = templateMap.get(dow);
      if (!template) continue; // No template row — skip (shouldn't happen)

      // Calculate progression
      const daysDiff = daysBetween(startDateISO, targetISO);
      const hammerWithWeight = buildHammerTask(
        template.hammer_task,
        template.is_rest_day === 1,
        daysDiff
      );

      // Insert the generated log entry (all checkboxes start unchecked)
      await db.runAsync(
        `INSERT OR IGNORE INTO daily_log
           (date, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
         VALUES (?, ?, ?, ?, ?)`,
        [
          targetISO,
          template.walking_task,
          hammerWithWeight,
          template.is_rest_day,
          template.is_meal_prep_day,
        ]
      );
    }

    // 4. Prune entries older than today - DAYS_HISTORY
    const cutoff = toISODate(addDays(today, -DAYS_HISTORY));
    await db.runAsync('DELETE FROM daily_log WHERE date < ?', [cutoff]);
  });
}

// ─────────────────────────────────────────────
// Daily Log CRUD
// ─────────────────────────────────────────────

/**
 * Fetches the log entry for a specific date.
 * Returns null if no entry exists (e.g., before the first sync).
 */
export async function getLogByDate(date: string): Promise<DailyLogEntry | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    date: string;
    walking_task: string;
    hammer_task: string;
    walk_completed: number;
    hammer_completed: number;
    fasting_completed: number;
    is_rest_day: number;
    is_meal_prep_day: number;
  }>('SELECT * FROM daily_log WHERE date = ?', [date]);

  if (!row) return null;
  return mapLogRow(row);
}

/**
 * Returns all daily_log entries in ascending date order.
 * Used by the rolling overview screen.
 */
export async function getRollingWindow(): Promise<DailyLogEntry[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    date: string;
    walking_task: string;
    hammer_task: string;
    walk_completed: number;
    hammer_completed: number;
    fasting_completed: number;
    is_rest_day: number;
    is_meal_prep_day: number;
  }>('SELECT * FROM daily_log ORDER BY date ASC');

  return rows.map(mapLogRow);
}

/**
 * Updates a single boolean field in daily_log for the given date.
 * fieldName must be one of: walk_completed, hammer_completed, fasting_completed
 */
export async function upsertLogField(
  date: string,
  field: 'walk_completed' | 'hammer_completed' | 'fasting_completed',
  value: boolean
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE daily_log SET ${field} = ? WHERE date = ?`,
    [value ? 1 : 0, date]
  );
}

// ─────────────────────────────────────────────
// Weekly Template CRUD
// ─────────────────────────────────────────────

/** Returns all 7 weekly template rows, ordered Mon→Sun. */
export async function getWeeklyTemplate(): Promise<WeeklyTemplateDay[]> {
  const db = getDatabase();
  // Order: Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
  const rows = await db.getAllAsync<{
    day_of_week: number;
    walking_task: string;
    hammer_task: string;
    is_rest_day: number;
    is_meal_prep_day: number;
  }>(
    `SELECT * FROM weekly_template
     ORDER BY CASE day_of_week WHEN 0 THEN 7 ELSE day_of_week END ASC`
  );

  return rows.map((r) => ({
    day_of_week: r.day_of_week,
    walking_task: r.walking_task,
    hammer_task: r.hammer_task,
    is_rest_day: r.is_rest_day === 1,
    is_meal_prep_day: r.is_meal_prep_day === 1,
  }));
}

/** Updates the walking_task and hammer_task for a given day_of_week. */
export async function updateTemplateDay(
  dayOfWeek: number,
  walkingTask: string,
  hammerTask: string
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    'UPDATE weekly_template SET walking_task = ?, hammer_task = ? WHERE day_of_week = ?',
    [walkingTask, hammerTask, dayOfWeek]
  );
}

// ─────────────────────────────────────────────
// App State helpers
// ─────────────────────────────────────────────

/** Returns the app start date stored in app_state. */
export async function getStartDate(): Promise<string> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  return row?.value ?? toISODate();
}

/** Returns the progression cycle number for a given ISO date. */
export async function getCycleForDate(dateISO: string): Promise<number> {
  const startISO = await getStartDate();
  const diff = daysBetween(startISO, dateISO);
  return Math.max(0, Math.floor(diff / CYCLE_DAYS));
}

// ─────────────────────────────────────────────
// Internal row mapper
// ─────────────────────────────────────────────

function mapLogRow(row: {
  date: string;
  walking_task: string;
  hammer_task: string;
  walk_completed: number;
  hammer_completed: number;
  fasting_completed: number;
  is_rest_day: number;
  is_meal_prep_day: number;
}): DailyLogEntry {
  return {
    date: row.date,
    walking_task: row.walking_task,
    hammer_task: row.hammer_task,
    walk_completed: row.walk_completed === 1,
    hammer_completed: row.hammer_completed === 1,
    fasting_completed: row.fasting_completed === 1,
    is_rest_day: row.is_rest_day === 1,
    is_meal_prep_day: row.is_meal_prep_day === 1,
  };
}
