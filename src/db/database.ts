import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ALL_MIGRATIONS } from './schema';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ScheduleDay {
  day_number: number;
  walking_task: string;
  workout_description: string;
  target_weight: number | null;
  is_rest_day: boolean;
  is_meal_prep_day: boolean;
}

export interface DailyLog {
  id: number;
  day_number: number;
  walk_completed: boolean;
  workout_completed: boolean;
  fasting_completed: boolean;
  logged_date: string | null;
}

export interface DayWithLog extends ScheduleDay {
  log: DailyLog | null;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DB_NAME = 'healthtracker.db';
const START_DATE_KEY = 'app_start_date';
let _db: SQLite.SQLiteDatabase | null = null;

// ─────────────────────────────────────────────
// Database initialisation
// ─────────────────────────────────────────────

/**
 * Opens the SQLite database, runs all migrations, and seeds the schedule
 * on the very first launch. Call this once at app startup.
 */
export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  _db = await SQLite.openDatabaseAsync(DB_NAME);

  // Enable WAL for better concurrent read performance
  await _db.execAsync('PRAGMA journal_mode = WAL;');

  // Run all schema migrations (idempotent)
  for (const migration of ALL_MIGRATIONS) {
    await _db.execAsync(migration);
  }

  // Record the start date on the first launch
  const existingStartDate = await AsyncStorage.getItem(START_DATE_KEY);
  if (!existingStartDate) {
    const today = new Date().toISOString().split('T')[0];
    await AsyncStorage.setItem(START_DATE_KEY, today);
  }

  // Seed schedule from JSON on first launch (guarded by row count)
  const result = await _db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM schedule'
  );
  if (!result || result.count === 0) {
    const scheduleData = require('../../assets/data/schedule.json') as ScheduleDay[];
    await seedFromJSON(scheduleData);
  }

  return _db;
}

/**
 * Returns the already-open database instance.
 * initDatabase() must have been called first.
 */
export function getDatabase(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialised. Call initDatabase() first.');
  return _db;
}

// ─────────────────────────────────────────────
// Seeding
// ─────────────────────────────────────────────

/**
 * Bulk-inserts all days from a schedule array into the `schedule` table.
 * Runs inside a single transaction for performance.
 */
export async function seedFromJSON(days: ScheduleDay[]): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const day of days) {
      await db.runAsync(
        `INSERT OR REPLACE INTO schedule
           (day_number, walking_task, workout_description, target_weight, is_rest_day, is_meal_prep_day)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          day.day_number,
          day.walking_task,
          day.workout_description,
          day.target_weight ?? null,
          day.is_rest_day ? 1 : 0,
          day.is_meal_prep_day ? 1 : 0,
        ]
      );
    }
  });
}

/**
 * Imports a new schedule from a JSON string, replacing all existing schedule rows.
 * Preserves daily_log data (logs are keyed on day_number which is stable).
 */
export async function importScheduleFromJSON(jsonString: string): Promise<void> {
  let days: ScheduleDay[];
  try {
    days = JSON.parse(jsonString) as ScheduleDay[];
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error('JSON must be a non-empty array of days.');
    }
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }

  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM schedule');
    for (const day of days) {
      await db.runAsync(
        `INSERT INTO schedule
           (day_number, walking_task, workout_description, target_weight, is_rest_day, is_meal_prep_day)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          day.day_number,
          day.walking_task,
          day.workout_description,
          day.target_weight ?? null,
          day.is_rest_day ? 1 : 0,
          day.is_meal_prep_day ? 1 : 0,
        ]
      );
    }
  });
}

// ─────────────────────────────────────────────
// Day-number computation
// ─────────────────────────────────────────────

/**
 * Returns today's day number (1–90) based on the app start date stored in AsyncStorage.
 * Returns 1 if the start date is not set (shouldn't happen after initDatabase).
 */
export async function getTodayDayNumber(): Promise<number> {
  const startDateStr = await AsyncStorage.getItem(START_DATE_KEY);
  if (!startDateStr) return 1;

  const startDate = new Date(startDateStr);
  const today = new Date();
  // Strip time component
  startDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.min(90, diffDays + 1));
}

/**
 * Returns the app start date as a Date object, or today if not set.
 */
export async function getStartDate(): Promise<Date> {
  const stored = await AsyncStorage.getItem(START_DATE_KEY);
  return stored ? new Date(stored) : new Date();
}

// ─────────────────────────────────────────────
// CRUD helpers
// ─────────────────────────────────────────────

/**
 * Fetches a single schedule day combined with its log (if it exists).
 */
export async function getDay(dayNumber: number): Promise<DayWithLog | null> {
  const db = getDatabase();

  const schedule = await db.getFirstAsync<{
    day_number: number;
    walking_task: string;
    workout_description: string;
    target_weight: number | null;
    is_rest_day: number;
    is_meal_prep_day: number;
  }>('SELECT * FROM schedule WHERE day_number = ?', [dayNumber]);

  if (!schedule) return null;

  const log = await db.getFirstAsync<{
    id: number;
    day_number: number;
    walk_completed: number;
    workout_completed: number;
    fasting_completed: number;
    logged_date: string | null;
  }>('SELECT * FROM daily_log WHERE day_number = ?', [dayNumber]);

  return {
    day_number: schedule.day_number,
    walking_task: schedule.walking_task,
    workout_description: schedule.workout_description,
    target_weight: schedule.target_weight,
    is_rest_day: schedule.is_rest_day === 1,
    is_meal_prep_day: schedule.is_meal_prep_day === 1,
    log: log
      ? {
          id: log.id,
          day_number: log.day_number,
          walk_completed: log.walk_completed === 1,
          workout_completed: log.workout_completed === 1,
          fasting_completed: log.fasting_completed === 1,
          logged_date: log.logged_date,
        }
      : null,
  };
}

/**
 * Upserts (inserts or updates) a daily_log row for the given day.
 * Only the provided fields are changed; others keep their current value.
 */
export async function upsertLog(
  dayNumber: number,
  fields: Partial<{
    walk_completed: boolean;
    workout_completed: boolean;
    fasting_completed: boolean;
  }>
): Promise<void> {
  const db = getDatabase();
  const today = new Date().toISOString().split('T')[0];

  // Ensure a row exists
  await db.runAsync(
    `INSERT OR IGNORE INTO daily_log (day_number, logged_date)
     VALUES (?, ?)`,
    [dayNumber, today]
  );

  // Build dynamic SET clause
  const updates: string[] = [];
  const values: (number | string)[] = [];

  if (fields.walk_completed !== undefined) {
    updates.push('walk_completed = ?');
    values.push(fields.walk_completed ? 1 : 0);
  }
  if (fields.workout_completed !== undefined) {
    updates.push('workout_completed = ?');
    values.push(fields.workout_completed ? 1 : 0);
  }
  if (fields.fasting_completed !== undefined) {
    updates.push('fasting_completed = ?');
    values.push(fields.fasting_completed ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(dayNumber);
    await db.runAsync(
      `UPDATE daily_log SET ${updates.join(', ')} WHERE day_number = ?`,
      values as SQLite.SQLiteBindValue[]
    );
  }
}

/**
 * Fetches all 90 schedule days joined with their logs.
 * Used by the Overview screen.
 */
export async function getAllDays(): Promise<DayWithLog[]> {
  const db = getDatabase();

  const rows = await db.getAllAsync<{
    day_number: number;
    walking_task: string;
    workout_description: string;
    target_weight: number | null;
    is_rest_day: number;
    is_meal_prep_day: number;
    log_id: number | null;
    walk_completed: number | null;
    workout_completed: number | null;
    fasting_completed: number | null;
    logged_date: string | null;
  }>(
    `SELECT
       s.day_number,
       s.walking_task,
       s.workout_description,
       s.target_weight,
       s.is_rest_day,
       s.is_meal_prep_day,
       l.id        AS log_id,
       l.walk_completed,
       l.workout_completed,
       l.fasting_completed,
       l.logged_date
     FROM schedule s
     LEFT JOIN daily_log l ON s.day_number = l.day_number
     ORDER BY s.day_number ASC`
  );

  return rows.map((row) => ({
    day_number: row.day_number,
    walking_task: row.walking_task,
    workout_description: row.workout_description,
    target_weight: row.target_weight,
    is_rest_day: row.is_rest_day === 1,
    is_meal_prep_day: row.is_meal_prep_day === 1,
    log:
      row.log_id != null
        ? {
            id: row.log_id,
            day_number: row.day_number,
            walk_completed: row.walk_completed === 1,
            workout_completed: row.workout_completed === 1,
            fasting_completed: row.fasting_completed === 1,
            logged_date: row.logged_date,
          }
        : null,
  }));
}
