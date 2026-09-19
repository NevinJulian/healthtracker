/**
 * Database layer for the 7-Day Rolling Window architecture.
 *
 * Fixes applied previously:
 *   - #34  Better error propagation
 *   - #35  Multi-row INSERT replaced by versioned individual statements
 *   - #36  _db singleton only assigned after full successful init
 *   - #37  SELECT moved outside withTransactionAsync
 *   - #38  _db reset to null on failure
 *   - #39  Versioned migration runner using schema_version table
 *   - Old-schema reset: detects incompatible daily_log and wipes DB
 *
 * Feature additions (issue #40):
 *   - Exercise[] JSON column on weekly_template and daily_log
 *   - upsertExerciseCompleted() — toggles a single exercise in the JSON array
 *   - updateTemplateExercises() — replaces the full exercise list for a weekday
 *   - resetIfIncompatibleSchema now also detects missing exercises column
 */

import * as SQLite from 'expo-sqlite';
import { CREATE_SCHEMA_VERSION_TABLE, MIGRATIONS, Exercise } from './schema';
import { bioForceExercises } from '../../bioForceExercises';
import { recipes } from '../data/recipes';
import { NUTRITION_GOALS, NutritionGoals } from '../nutrition/goals';
import type { Sex, ActivityLevel, GoalType } from '../nutrition/tdee';
import {
  localDateKey,
  addDays as _addDaysKey,
  daysBetween as _daysBetweenKey,
  dateKeyToLocalDate,
} from '../utils/dates';

// Re-export NutritionGoals so screens only need to import from database.ts
export type { NutritionGoals };

// Re-export profile types from tdee.ts so callers only ever import from database.ts
export type { Sex, ActivityLevel, GoalType };

export interface RecipeIngredient {
  name: string;
  baseQuantity: number;
  unit: string;
}

export interface Recipe {
  id: string;
  title: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  prepTimeMinutes: number;
  defaultServings: number;
  ingredients: RecipeIngredient[];
  instructions: string;
  freezerTips: string;
}

export interface ShoppingListItem {
  id: number;
  ingredient_name: string;
  total_quantity: number;
  unit: string;
  is_checked: boolean;
}

export interface BioForceExercise {
  id: number;
  title: string;
  muscleGroup: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty: string;
  cablePosition: string;
  attachment: string;
  seat: string;
  sets: string;
  reps: string;
  description: string;
  tips: string[];
  videoId: string;
  videoTitle: string;
}

export interface MealInventoryItem {
  id: number;
  recipe_id: string;
  portions_available: number;
  date_cooked: string;
}

export interface WeeklyMealPlanItem {
  id: number;
  date: string;
  meal_type: string;
  recipe_id: string;
  is_consumed: boolean;
  /**
   * meal_inventory.id this row's tick debited (v34, #302). Set when a tick
   * finds stock to debit; NULL when ticked with no stock, when never
   * consumed, or on legacy rows ticked before this column existed. Untick
   * credits back exactly this batch (never "most recent") and never an
   * INSERT fallback — see toggleMealConsumed.
   */
  consumed_from_inventory_id: number | null;
}

// Re-export Exercise so screens only import from database.ts
export type { Exercise };

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DB_NAME = 'healthtracker.db';
const START_DATE_KEY = 'app_start_date';

const KG_PER_CYCLE = 5;
const CYCLE_DAYS = 21;
const DAYS_AHEAD = 7;
const DAYS_HISTORY = 7;
const BACKFILL_CAP_DAYS = 90;

let _db: SQLite.SQLiteDatabase | null = null;

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface WeeklyTemplateDay {
  day_of_week: number;
  walking_task: string;
  hammer_task: string;
  is_rest_day: boolean;
  is_meal_prep_day: boolean;
  exercises: Exercise[];
}

export interface AdditionalWorkout {
  id: string;
  name: string;
  muscle_group?: string;
  sets?: string;
  reps?: string;
  completed: boolean;
}

export interface DailyLogEntry {
  date: string;
  walking_task: string;
  hammer_task: string;
  walk_completed: boolean;
  hammer_completed: boolean;
  fasting_completed: boolean;
  is_rest_day: boolean;
  is_meal_prep_day: boolean;
  exercises: Exercise[];
  body_weight: number | null;
  additional_workouts: AdditionalWorkout[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Return a YYYY-MM-DD string for `date` using LOCAL calendar getters.
 * Re-exported from src/utils/dates so that screens importing toISODate from
 * database.ts continue to work without changes.
 *
 * Issue #279: previously this was defined inline here using local getters,
 * which was already correct.  Now delegated to the canonical utility so there
 * is exactly one implementation.
 */
export function toISODate(date: Date = new Date()): string {
  return localDateKey(date);
}

function buildHammerTask(base: string, isRestDay: boolean, daysDiff: number): string {
  if (isRestDay) return `${base} @ Light Weight`;
  const cycle = Math.floor(daysDiff / CYCLE_DAYS);
  if (cycle === 0) return `${base} @ Baseline`;
  return `${base} @ Baseline + ${cycle * KG_PER_CYCLE}kg`;
}

/**
 * True when `value` is a syntactically valid YYYY-MM-DD date key that
 * round-trips through the Date constructor to the same calendar day
 * (rejects both the wrong shape and overflow like "2026-13-40").
 *
 * Guards `_syncRollingSchedule()`'s rolling-window floor against a garbled
 * `app_start_date` — e.g. restored verbatim from a corrupted backup — which
 * would otherwise turn `_daysBetweenKey()` into NaN arithmetic and silently
 * generate zero rows (#301).
 */
function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Safely parse a JSON string as Exercise[]; returns [] on any error. */
function parseExercises(raw: string | null | undefined): Exercise[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Strict counterpart to parseExercises(), used ONLY by the write path in
 * upsertExerciseCompleted() (#319). parseExercises() is the read path and
 * stays lenient on purpose (returns [] on malformed input — screens rely on
 * that). But upsertExerciseCompleted() reads, patches, and writes the array
 * back: if it used the lenient parse, malformed stored JSON would silently
 * become [] and then get persisted, permanently destroying whatever was
 * actually stored. This returns a discriminated result instead of throwing
 * so the caller decides how to fail (console.error + throw, see below).
 */
function _tryParseExercisesForWrite(
  raw: string | null | undefined
): { ok: true; value: Exercise[] } | { ok: false } {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function parseAdditionalWorkouts(raw: string | null | undefined): AdditionalWorkout[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// Versioned migration runner
// ─────────────────────────────────────────────

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(CREATE_SCHEMA_VERSION_TABLE);

  const appliedRows = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_version ORDER BY version ASC'
  );
  const applied = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    console.log(`[DB] Applying migration v${migration.version}…`);
    // Each migration's SQL and its schema_version bookkeeping row commit or
    // roll back together (#314). A per-migration transaction — not one
    // transaction around the whole loop — so a kill/throw partway through
    // this migration can't leave its schema/data change applied without a
    // recorded version (which would re-apply it forever on relaunch, or
    // double-apply a data migration like v35), while migrations that already
    // committed on an earlier run stay committed.
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
    });
    console.log(`[DB] Migration v${migration.version} applied ✓`);
  }
}

async function seedBioForceLibrary(db: SQLite.SQLiteDatabase): Promise<void> {
  // Check if we already have exercises
  const countRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM bio_force_library'
  );
  if (countRow && countRow.count > 0) return;

  console.log('[DB] Seeding Bio Force Library...');
  const insertStmt = await db.prepareAsync(
    'INSERT INTO bio_force_library (id, name, muscle_group, description, video_url, data) VALUES (?, ?, ?, ?, ?, ?)'
  );
  
  try {
    await db.withTransactionAsync(async () => {
      for (const ex of bioForceExercises) {
        await insertStmt.executeAsync([
          ex.id,
          ex.title,
          ex.muscleGroup,
          ex.description,
          ex.videoId ? `https://www.youtube.com/watch?v=${ex.videoId}` : '',
          JSON.stringify(ex),
        ]);
      }
    });
  } finally {
    await insertStmt.finalizeAsync().catch((e) => console.warn('[DB] finalize failed:', e));
  }
  console.log('[DB] Bio Force Library seeded ✓');
}

async function seedRecipeLibrary(db: SQLite.SQLiteDatabase): Promise<void> {
  const countRow = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM recipe_library'
  );
  if (countRow && countRow.count > 0) return;

  console.log('[DB] Seeding Recipe Library...');
  const insertStmt = await db.prepareAsync(
    `INSERT OR IGNORE INTO recipe_library 
      (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, freezerTips)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  
  try {
    await db.withTransactionAsync(async () => {
      for (const r of recipes) {
        await insertStmt.executeAsync([
          r.id,
          r.title,
          r.category,
          r.calories,
          r.protein,
          r.carbs,
          r.fat,
          r.prepTimeMinutes,
          r.defaultServings,
          JSON.stringify(r.ingredients),
          r.instructions,
          r.freezerTips || '',
        ]);
      }
    });
  } finally {
    await insertStmt.finalizeAsync().catch((e) => console.warn('[DB] finalize failed:', e));
  }
  console.log('[DB] Recipe Library seeded ✓');
}

// ─────────────────────────────────────────────
// Old-schema reset helper
// ─────────────────────────────────────────────

/**
 * Detects incompatible schemas left by previous app versions:
 *   1. daily_log missing 'date' column (very old schema)
 *   2. (Compatible schema — no reset needed)
 *
 * Note: missing 'exercises' column is handled by migrations v11/v12 via
 * ALTER TABLE, so no reset is needed for that case.
 */
async function resetIfIncompatibleSchema(
  db: SQLite.SQLiteDatabase
): Promise<SQLite.SQLiteDatabase> {
  const columns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(daily_log)'
  );

  if (columns.length === 0) return db; // Fresh install
  const hasDateColumn = columns.some((c) => c.name === 'date');
  if (hasDateColumn) return db; // Compatible

  console.warn(
    '[DB] Incompatible daily_log schema detected (missing "date" column). ' +
    'Deleting old database and starting fresh…'
  );
  await db.closeAsync();
  await SQLite.deleteDatabaseAsync(DB_NAME);
  console.log('[DB] Old database deleted. Opening fresh database…');
  const freshDb = await SQLite.openDatabaseAsync(DB_NAME);
  await freshDb.execAsync('PRAGMA journal_mode = WAL;');
  return freshDb;
}

// ─────────────────────────────────────────────
// Rolling schedule sync — internal impl
// ─────────────────────────────────────────────

type WeeklyTemplateRow = {
  day_of_week: number;
  walking_task: string;
  hammer_task: string;
  is_rest_day: number;
  is_meal_prep_day: number;
  exercises: string;
};

/** The daily_log column values a freshly-generated row for a date should have. */
interface DailyLogRowValues {
  date: string;
  walking_task: string;
  hammer_task: string;
  is_rest_day: number;
  is_meal_prep_day: number;
  exercises: string;
}

/**
 * Pure per-date row-value computation — the weekly_template lookup by
 * day_of_week, exercises reset, and buildHammerTask progression that used to
 * live inline in _syncRollingSchedule()'s loop. Extracted (#305) so
 * _syncRollingSchedule() and _ensureDailyLogRow() share exactly one
 * implementation and can never drift apart.
 *
 * Takes exactly the inputs _syncRollingSchedule() has always used —
 * `startDateISO` is the RAW value read from app_state (not the
 * sanitised/clamped variant _syncRollingSchedule() computes for its own
 * insert-range floor) — so the gym-weight progression's semantics are
 * unchanged by this refactor. (#363 tracks any actual change to that
 * formula separately.)
 *
 * Returns null when weekly_template has no row for `targetISO`'s weekday —
 * shouldn't happen given the 7-row invariant (CLAUDE.md), but
 * weekly_template is user-editable data, not a compile-time guarantee, so
 * both callers must handle it rather than assume it.
 */
function _buildDailyLogRowValues(
  targetISO: string,
  templateMap: Map<number, WeeklyTemplateRow>,
  startDateISO: string
): DailyLogRowValues | null {
  const dow = dateKeyToLocalDate(targetISO).getDay();
  const template = templateMap.get(dow);
  if (!template) return null;

  // Parse template exercises (reset completed → false)
  const templateExercises = parseExercises(template.exercises);
  const baseExercises = templateExercises.map((ex) => ({ ...ex, completed: false }));
  const baseExercisesJson = JSON.stringify(baseExercises);

  const daysDiff = _daysBetweenKey(startDateISO, targetISO);
  const hammerWithWeight = buildHammerTask(
    template.hammer_task,
    template.is_rest_day === 1,
    daysDiff
  );

  return {
    date: targetISO,
    walking_task: template.walking_task,
    hammer_task: hammerWithWeight,
    is_rest_day: template.is_rest_day,
    is_meal_prep_day: template.is_meal_prep_day,
    exercises: baseExercisesJson,
  };
}

async function _syncRollingSchedule(db: SQLite.SQLiteDatabase): Promise<void> {
  const startRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  const startDateISO = startRow?.value ?? toISODate();

  const templateRows = await db.getAllAsync<WeeklyTemplateRow>('SELECT * FROM weekly_template');

  const templateMap = new Map<number, WeeklyTemplateRow>();
  for (const row of templateRows) {
    templateMap.set(row.day_of_week, row);
  }

  const todayISO = toISODate();
  // cutoffISO gates the *existing-row* exercises backfill further below —
  // kept at its pre-#301 range (today - DAYS_HISTORY) on purpose. Widening
  // the INSERT range (below) must not also widen this: retroactively handing
  // an old row today's template exercises would invent history the user
  // never had (#301, orchestrator amendment).
  const cutoffISO = _addDaysKey(todayISO, -DAYS_HISTORY);
  // floorISO gates how far back MISSING rows get inserted: up to
  // BACKFILL_CAP_DAYS in the past, but never before the app's own start date
  // — there's no schedule to backfill before the user started using the app.
  const backfillFloorISO = _addDaysKey(todayISO, -BACKFILL_CAP_DAYS);
  // A garbled/legacy startDateISO (e.g. restored from a corrupted backup)
  // must not poison the range with NaN arithmetic — fall back to the
  // 90-day cap instead (#301).
  const safeStartDateISO = isValidDateKey(startDateISO) ? startDateISO : backfillFloorISO;
  const lowerBoundISO =
    safeStartDateISO > backfillFloorISO ? safeStartDateISO : backfillFloorISO;
  // A startDateISO in the future (e.g. restored from a device whose clock
  // ran fast, or that crossed a timezone) must not push the floor past
  // today — today..today+DAYS_AHEAD always has to generate regardless of
  // what startDateISO claims (#301).
  const floorISO = lowerBoundISO < todayISO ? lowerBoundISO : todayISO;

  // Pre-fetch existing rows with their exercises OUTSIDE the transaction (#37)
  const existingRows = await db.getAllAsync<{ date: string; exercises: string }>(
    'SELECT date, exercises FROM daily_log WHERE date >= ?',
    [floorISO]
  );
  const existingDates = new Set(existingRows.map((r) => r.date));

  type InsertParams = [string, string, string, number, number, string];
  const inserts: InsertParams[] = [];

  // Backfill: existing entries whose exercises are empty but template now has them
  type BackfillParams = [string, string]; // [exercisesJson, date]
  const backfills: BackfillParams[] = [];

  const startOffset = _daysBetweenKey(todayISO, floorISO);
  for (let offset = startOffset; offset <= DAYS_AHEAD; offset++) {
    const targetISO = _addDaysKey(todayISO, offset);
    const rowValues = _buildDailyLogRowValues(targetISO, templateMap, startDateISO);
    if (!rowValues) continue;

    if (existingDates.has(targetISO)) {
      // Row exists — check if exercises need to be backfilled. Restricted to
      // the pre-#301 range (cutoffISO..today+DAYS_AHEAD): dates further back
      // than that were never visited by this pass before #301 widened the
      // insert range below, and must stay untouched (see cutoffISO comment).
      if (targetISO >= cutoffISO) {
        const existing = existingRows.find((r) => r.date === targetISO);
        const currentExercises = parseExercises(existing?.exercises);
        const templateExerciseCount = parseExercises(rowValues.exercises).length;
        if (currentExercises.length === 0 && templateExerciseCount > 0) {
          backfills.push([rowValues.exercises, targetISO]);
        }
      }
      continue;
    }

    inserts.push([
      rowValues.date,
      rowValues.walking_task,
      rowValues.hammer_task,
      rowValues.is_rest_day,
      rowValues.is_meal_prep_day,
      rowValues.exercises,
    ]);
  }

  await db.withTransactionAsync(async () => {
    for (const params of inserts) {
      await db.runAsync(
        `INSERT OR IGNORE INTO daily_log
           (date, walking_task, hammer_task, is_rest_day, is_meal_prep_day, exercises)
         VALUES (?, ?, ?, ?, ?, ?)`,
        params
      );
    }
    // Backfill exercises into rows that currently have an empty array
    for (const [exercisesJson, date] of backfills) {
      await db.runAsync(
        'UPDATE daily_log SET exercises = ? WHERE date = ?',
        [exercisesJson, date]
      );
    }
  });
}

// ─────────────────────────────────────────────
// Ensure-row helper for daily_log writers (#305)
// ─────────────────────────────────────────────

/**
 * Ensure a daily_log row exists for `date`. If missing, inserts one using
 * exactly the column values _syncRollingSchedule() would generate for that
 * date — same weekly_template lookup, same (raw, unsanitised) startDateISO
 * handling, same exercises reset — via the shared _buildDailyLogRowValues()
 * builder, so an on-demand row can never drift from what the next sync
 * would have produced for it. `INSERT OR IGNORE` makes this safe to call
 * unconditionally before every daily_log UPDATE: a no-op when the row is
 * already there.
 *
 * Every column outside the builder's set (walk_completed, hammer_completed,
 * fasting_completed, body_weight, water_ml, additional_workouts) takes its
 * schema DEFAULT — identical to a row _syncRollingSchedule() itself inserts.
 *
 * Silently inserts nothing if weekly_template has no row for `date`'s
 * weekday — shouldn't happen given the 7-row invariant (CLAUDE.md), but
 * this helper must not throw over user-editable template data. The caller's
 * own UPDATE then simply won't find the row, and _assertWrote() surfaces
 * that loudly instead of the previous silent no-op.
 */
async function _ensureDailyLogRow(db: SQLite.SQLiteDatabase, date: string): Promise<void> {
  const startRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  const startDateISO = startRow?.value ?? toISODate();

  const templateRows = await db.getAllAsync<WeeklyTemplateRow>('SELECT * FROM weekly_template');
  const templateMap = new Map<number, WeeklyTemplateRow>();
  for (const row of templateRows) {
    templateMap.set(row.day_of_week, row);
  }

  const rowValues = _buildDailyLogRowValues(date, templateMap, startDateISO);
  if (!rowValues) return;

  await db.runAsync(
    `INSERT OR IGNORE INTO daily_log
       (date, walking_task, hammer_task, is_rest_day, is_meal_prep_day, exercises)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      rowValues.date,
      rowValues.walking_task,
      rowValues.hammer_task,
      rowValues.is_rest_day,
      rowValues.is_meal_prep_day,
      rowValues.exercises,
    ]
  );
}

/**
 * Throws a clear error when a daily_log writer's UPDATE didn't touch exactly
 * one row. Called immediately after each writer's UPDATE, once
 * _ensureDailyLogRow() has guaranteed the row exists for any date whose
 * weekday has a weekly_template row — so `changes !== 1` here means
 * something is actually wrong (e.g. weekly_template is missing a row for
 * that weekday), surfaced loudly instead of the previous silent no-op (#305).
 */
function _assertWrote(result: SQLite.SQLiteRunResult, fnName: string, date: string): void {
  if (result.changes !== 1) {
    throw new Error(
      `[DB] ${fnName}: expected to update exactly 1 daily_log row for date=${date}, but ${result.changes} row(s) changed`
    );
  }
}

// ─────────────────────────────────────────────
// Database Init
// ─────────────────────────────────────────────

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  console.log('[DB] Opening database…');
  let db = await SQLite.openDatabaseAsync(DB_NAME);

  try {
    await db.execAsync('PRAGMA journal_mode = WAL;');

    db = await resetIfIncompatibleSchema(db);

    await runMigrations(db);
    await seedBioForceLibrary(db);
    await seedRecipeLibrary(db);

    const existing = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_state WHERE key = ?',
      [START_DATE_KEY]
    );
    if (!existing) {
      const today = toISODate();
      console.log(`[DB] First launch — recording start date: ${today}`);
      await db.runAsync('INSERT INTO app_state (key, value) VALUES (?, ?)', [START_DATE_KEY, today]);
    }

    await _syncRollingSchedule(db);

    _db = db;
    console.log('[DB] Initialisation complete ✓');
  } catch (err) {
    console.error('[DB] Initialisation failed — closing connection:', err);
    await db.closeAsync().catch((e) => console.warn('[DB] Cleanup close failed:', e));
    throw err;
  }

  return _db!;
}

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialised. Call initDatabase() first.');
  return _db;
}

// ─────────────────────────────────────────────
// Rolling Schedule Sync (public API)
// ─────────────────────────────────────────────

export async function syncRollingSchedule(): Promise<void> {
  return _syncRollingSchedule(getDatabase());
}

// ─────────────────────────────────────────────
// Daily Log CRUD
// ─────────────────────────────────────────────

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
    exercises: string;
    body_weight: number | null;
    additional_workouts: string;
  }>('SELECT * FROM daily_log WHERE date = ?', [date]);

  if (!row) return null;
  return mapLogRow(row);
}

/**
 * Returns daily_log rows for the current 7-day rolling window only
 * (today - DAYS_HISTORY .. today + DAYS_AHEAD, inclusive), using the same
 * todayISO/_addDaysKey arithmetic _syncRollingSchedule() uses to generate
 * that window — so this always matches what sync just produced.
 *
 * Before #300's amendment this was an unbounded `SELECT * FROM daily_log`;
 * it only ever *looked* windowed because _syncRollingSchedule() used to
 * delete everything outside the window on every sync. Now that history is
 * retained, this query does the bounding itself instead.
 */
export async function getRollingWindow(): Promise<DailyLogEntry[]> {
  const todayISO = toISODate();
  const fromISO = _addDaysKey(todayISO, -DAYS_HISTORY);
  const toISO = _addDaysKey(todayISO, DAYS_AHEAD);
  return getDailyLogsBetween(fromISO, toISO);
}

/**
 * Returns daily_log rows with date in [fromKey, toKey], inclusive on both
 * ends, ordered ascending by date. Row shape matches getRollingWindow().
 *
 * Intended for callers (e.g. analytics) that need an explicit date range
 * rather than the current rolling window — added in #300 for later
 * adoption; not yet wired into any screen.
 */
export async function getDailyLogsBetween(
  fromKey: string,
  toKey: string
): Promise<DailyLogEntry[]> {
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
    exercises: string;
    body_weight: number | null;
    additional_workouts: string;
  }>(
    'SELECT * FROM daily_log WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [fromKey, toKey]
  );

  return rows.map(mapLogRow);
}

export async function upsertLogField(
  date: string,
  field: 'walk_completed' | 'hammer_completed' | 'fasting_completed',
  value: boolean
): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, date);
  const result = await db.runAsync(
    `UPDATE daily_log SET ${field} = ? WHERE date = ?`,
    [value ? 1 : 0, date]
  );
  _assertWrote(result, 'upsertLogField', date);
}

/**
 * Serialisation queue for upsertExerciseCompleted() (#319). It's a
 * read-modify-write: read daily_log.exercises, toggle one entry, write the
 * whole array back. Two overlapping calls for the same date can both read
 * the pre-toggle array and the second write clobbers the first toggle
 * (lost update). Chaining every call onto this module-level promise forces
 * the read-modify-write sequences to run one at a time, so they can't
 * interleave — each call awaits the previous one's settlement (including a
 * rejection) before its own body starts.
 *
 * Deliberately NOT `withTransactionAsync`: a single UPDATE statement is
 * already atomic by itself, and the real expo-sqlite withTransactionAsync
 * is a bare, non-queued BEGIN/COMMIT on the shared connection — overlapping
 * transactions can roll back each other's work (filed as #369, a systemic
 * issue out of scope here). Wrapping this in another non-queued transaction
 * would only widen that exposure; the plain queue below avoids it entirely.
 */
let _upsertExerciseCompletedQueue: Promise<void> = Promise.resolve();

/**
 * Toggles the `completed` flag on a single exercise within daily_log.exercises
 * for the given date. Reads the current JSON, patches it, then writes back.
 *
 * Malformed stored JSON is refused rather than coerced to [] and persisted
 * (which would destroy the original) — see _tryParseExercisesForWrite().
 * Calls are serialised per-process; see _upsertExerciseCompletedQueue above.
 */
export function upsertExerciseCompleted(
  date: string,
  exerciseId: string,
  value: boolean
): Promise<void> {
  const run = _upsertExerciseCompletedQueue.then(() =>
    _upsertExerciseCompletedImpl(date, exerciseId, value)
  );
  // Swallow the rejection on the CHAIN link only (not on `run`, which the
  // caller still sees) so a failed call doesn't wedge later queued calls.
  _upsertExerciseCompletedQueue = run.catch(() => {});
  return run;
}

async function _upsertExerciseCompletedImpl(
  date: string,
  exerciseId: string,
  value: boolean
): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, date);
  const row = await db.getFirstAsync<{ exercises: string }>(
    'SELECT exercises FROM daily_log WHERE date = ?',
    [date]
  );
  const parsed = _tryParseExercisesForWrite(row?.exercises);
  if (!parsed.ok) {
    console.error(
      `[DB] upsertExerciseCompleted: malformed exercises JSON for date=${date} — refusing to write, stored value left unchanged`
    );
    throw new Error(`[DB] upsertExerciseCompleted: malformed exercises JSON for date=${date}`);
  }
  const updated = parsed.value.map((ex) =>
    ex.id === exerciseId ? { ...ex, completed: value } : ex
  );
  const result = await db.runAsync(
    'UPDATE daily_log SET exercises = ? WHERE date = ?',
    [JSON.stringify(updated), date]
  );
  _assertWrote(result, 'upsertExerciseCompleted', date);
}

export async function upsertBodyWeight(date: string, weight: number): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, date);
  const result = await db.runAsync(
    'UPDATE daily_log SET body_weight = ? WHERE date = ?',
    [weight, date]
  );
  _assertWrote(result, 'upsertBodyWeight', date);
}

export async function upsertAdditionalWorkouts(
  date: string,
  workouts: AdditionalWorkout[]
): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, date);
  const result = await db.runAsync('UPDATE daily_log SET additional_workouts = ? WHERE date = ?', [
    JSON.stringify(workouts),
    date,
  ]);
  _assertWrote(result, 'upsertAdditionalWorkouts', date);
}

export async function getWeightHistory(days: number): Promise<{ date: string; weight: number }[]> {
  const db = getDatabase();
  const cutoffISO = _addDaysKey(toISODate(), -days);

  const rows = await db.getAllAsync<{ date: string; body_weight: number }>(
    'SELECT date, body_weight FROM daily_log WHERE date >= ? AND body_weight IS NOT NULL ORDER BY date ASC',
    [cutoffISO]
  );

  return rows.map((r) => ({ date: r.date, weight: r.body_weight }));
}

// ─────────────────────────────────────────────
// Weekly Template CRUD
// ─────────────────────────────────────────────

export async function getBioForceLibrary(): Promise<BioForceExercise[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ data: string }>('SELECT data FROM bio_force_library');
  return rows.map((r) => JSON.parse(r.data) as BioForceExercise);
}

export async function getWeeklyTemplate(): Promise<WeeklyTemplateDay[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    day_of_week: number;
    walking_task: string;
    hammer_task: string;
    is_rest_day: number;
    is_meal_prep_day: number;
    exercises: string;
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
    exercises: parseExercises(r.exercises),
  }));
}

/** Updates the walking_task, hammer_task for a given day_of_week. */
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

/**
 * Replaces the full exercise list for a given weekday in weekly_template.
 * The UI calls this when the user adds, edits, or deletes exercises in the
 * Template Editor.
 */
export async function updateTemplateExercises(
  dayOfWeek: number,
  exercises: Exercise[]
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    'UPDATE weekly_template SET exercises = ? WHERE day_of_week = ?',
    [JSON.stringify(exercises), dayOfWeek]
  );
}

// ─────────────────────────────────────────────
// App State helpers
// ─────────────────────────────────────────────

export async function getStartDate(): Promise<string> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  return row?.value ?? toISODate();
}

export async function getCycleForDate(dateISO: string): Promise<number> {
  const startISO = await getStartDate();
  const diff = _daysBetweenKey(startISO, dateISO);
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
  exercises: string;
  body_weight?: number | null;
  additional_workouts?: string;
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
    exercises: parseExercises(row.exercises),
    body_weight: row.body_weight ?? null,
    additional_workouts: parseAdditionalWorkouts(row.additional_workouts),
  };
}

// ─────────────────────────────────────────────
// Recipes CRUD
// ─────────────────────────────────────────────

export async function getRecipes(category?: string): Promise<Recipe[]> {
  const db = getDatabase();
  let rows: any[];
  if (category && category !== 'All') {
    rows = await db.getAllAsync('SELECT * FROM recipe_library WHERE category = ?', [category]);
  } else {
    rows = await db.getAllAsync('SELECT * FROM recipe_library');
  }

  return rows.map((r) => ({
    ...r,
    ingredients: JSON.parse(r.ingredients),
  }));
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM recipe_library WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    ingredients: JSON.parse(row.ingredients),
  };
}

// ─── Private insert helper ────────────────────────────────────────────────────

/**
 * Shared INSERT helper used by both importRecipe and createRecipe.
 * Callers choose the conflict strategy: IGNORE (import) or REPLACE (create).
 */
async function _insertRecipe(
  db: SQLite.SQLiteDatabase,
  recipe: Recipe,
  conflict: 'IGNORE' | 'REPLACE',
): Promise<SQLite.SQLiteRunResult> {
  return db.runAsync(
    `INSERT OR ${conflict} INTO recipe_library
       (id, title, category, calories, protein, carbs, fat, prepTimeMinutes,
        defaultServings, ingredients, instructions, freezerTips)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recipe.id,
      recipe.title,
      recipe.category,
      recipe.calories,
      recipe.protein,
      recipe.carbs,
      recipe.fat,
      recipe.prepTimeMinutes,
      recipe.defaultServings,
      JSON.stringify(recipe.ingredients),
      recipe.instructions,
      recipe.freezerTips ?? '',
    ],
  );
}

/**
 * Import a recipe into the library.  Uses INSERT OR IGNORE so calling it
 * twice with the same id is safe (duplicate guard returns false).
 *
 * @returns true when the recipe was newly inserted, false when it already existed.
 */
export async function importRecipe(recipe: Recipe): Promise<boolean> {
  const db = getDatabase();
  const result = await _insertRecipe(db, recipe, 'IGNORE');
  // lastInsertRowId > 0 means a row was actually inserted
  return (result.changes ?? 0) > 0;
}

/**
 * Returns true when the recipe id belongs to the 100 seeded ground-stock
 * recipes (ids matching /^r\d{3}$/, i.e. r001–r100).  These recipes are
 * protected from deletion — derive the guard from the id pattern so no
 * schema migration or extra column is needed.
 */
export function isSeededRecipe(id: string): boolean {
  return /^r\d{3}$/.test(id);
}

/**
 * Insert a user-created recipe into recipe_library.
 * Assigns a stable `custom-<timestamp>` id so the recipe participates in
 * the shopping/cooking/meal-plan pipeline identically to seeded recipes.
 * Caller should set recipe.id = `custom-${Date.now()}` before passing in,
 * OR pass the recipe without an id and let this function generate one.
 *
 * If recipe.id is already set (e.g. to a custom-* value from a prior call),
 * it is used as-is (INSERT OR REPLACE so re-saves are idempotent).
 */
export async function createRecipe(recipe: Recipe): Promise<void> {
  const db = getDatabase();
  const recipeWithId: Recipe = recipe.id
    ? recipe
    : { ...recipe, id: `custom-${Date.now()}` };
  await _insertRecipe(db, recipeWithId, 'REPLACE');
}

/**
 * Update an existing recipe_library row by id.
 * All fields including recomputed macros and the ingredients JSON are replaced.
 */
export async function updateRecipe(recipe: Recipe): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `UPDATE recipe_library
     SET title = ?, category = ?, calories = ?, protein = ?, carbs = ?, fat = ?,
         prepTimeMinutes = ?, defaultServings = ?, ingredients = ?,
         instructions = ?, freezerTips = ?
     WHERE id = ?`,
    [
      recipe.title,
      recipe.category,
      recipe.calories,
      recipe.protein,
      recipe.carbs,
      recipe.fat,
      recipe.prepTimeMinutes,
      recipe.defaultServings,
      JSON.stringify(recipe.ingredients),
      recipe.instructions,
      recipe.freezerTips ?? '',
      recipe.id,
    ],
  );
}

/**
 * Delete a recipe from recipe_library by id.
 * Callers should check isSeededRecipe(id) before calling this and refuse
 * to delete protected seed recipes (r001–r100).
 */
export async function deleteRecipe(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM recipe_library WHERE id = ?', [id]);
}

/**
 * Return all distinct category strings present in recipe_library,
 * sorted alphabetically.  Used by the editor to populate the category picker.
 */
export async function getRecipeCategories(): Promise<string[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ category: string }>(
    'SELECT DISTINCT category FROM recipe_library ORDER BY category ASC',
  );
  return rows.map((r) => r.category);
}

// ─────────────────────────────────────────────
// Open Food Facts cache CRUD
// ─────────────────────────────────────────────

export interface OFFCacheEntry {
  ingredient_name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fetched_at: string;
}

/** Read a cached OFF entry by normalised ingredient name. */
export async function getOFFCache(name: string): Promise<OFFCacheEntry | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<OFFCacheEntry>(
    'SELECT * FROM off_cache WHERE ingredient_name = ?',
    [name.toLowerCase()],
  );
  return row ?? null;
}

/** Write (or overwrite) a cached OFF entry. */
export async function putOFFCache(
  name: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO off_cache
       (ingredient_name, kcal, protein, carbs, fat, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name.toLowerCase(), kcal, protein, carbs, fat, new Date().toISOString()],
  );
}

// ─────────────────────────────────────────────
// Shopping List CRUD
// ─────────────────────────────────────────────

export async function getShoppingListItems(): Promise<ShoppingListItem[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM shopping_list ORDER BY is_checked ASC, id DESC');
  return rows.map((r) => ({
    ...r,
    is_checked: r.is_checked === 1,
  }));
}

export async function addShoppingListItem(name: string, total_quantity: number, unit: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    'INSERT INTO shopping_list (ingredient_name, total_quantity, unit, is_checked) VALUES (?, ?, ?, 0)',
    [name, total_quantity, unit]
  );
}

export async function toggleShoppingListItem(id: number, is_checked: boolean): Promise<void> {
  const db = getDatabase();
  await db.runAsync('UPDATE shopping_list SET is_checked = ? WHERE id = ?', [is_checked ? 1 : 0, id]);
}

export async function clearCompletedShoppingList(): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM shopping_list WHERE is_checked = 1');
}

// ─────────────────────────────────────────────
// Meal Inventory & Planner CRUD
// ─────────────────────────────────────────────

export interface MealInventoryWithRecipe extends MealInventoryItem {
  recipe: Recipe;
}

export async function getMealInventory(): Promise<MealInventoryWithRecipe[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<any>(`
    SELECT m.*, r.title, r.calories, r.protein, r.carbs, r.fat 
    FROM meal_inventory m
    JOIN recipe_library r ON m.recipe_id = r.id
    WHERE m.portions_available > 0
    ORDER BY m.date_cooked DESC
  `);
  
  return rows.map((r) => ({
    id: r.id,
    recipe_id: r.recipe_id,
    portions_available: r.portions_available,
    date_cooked: r.date_cooked,
    recipe: {
      id: r.recipe_id,
      title: r.title,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
    } as Recipe
  }));
}

export async function logCookedMeal(recipe_id: string, portions: number): Promise<void> {
  const db = getDatabase();
  const date_cooked = toISODate();

  await db.withTransactionAsync(async () => {
    // Check if active stock exists
    const existing = await db.getFirstAsync<any>(
      'SELECT * FROM meal_inventory WHERE recipe_id = ? AND portions_available > 0',
      [recipe_id]
    );
    if (existing) {
      await db.runAsync(
        'UPDATE meal_inventory SET portions_available = portions_available + ?, date_cooked = ? WHERE id = ?',
        [portions, date_cooked, existing.id]
      );
    } else {
      await db.runAsync(
        'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
        [recipe_id, portions, date_cooked]
      );
    }

    // Persist cook event to cook_log so history accumulates for analytics (#267 v30)
    await db.runAsync(
      'INSERT INTO cook_log (recipe_id, portions, date) VALUES (?, ?, ?)',
      [recipe_id, portions, date_cooked]
    );
  });
}

export async function getWeeklyMealPlan(): Promise<WeeklyMealPlanItem[]> {
  const db = getDatabase();
  return await db.getAllAsync<WeeklyMealPlanItem>('SELECT * FROM weekly_meal_plan');
}

export interface MealPlanWithRecipe extends WeeklyMealPlanItem {
  recipe?: Recipe;
}

export async function getTodaysMealsWithRecipe(date: string): Promise<MealPlanWithRecipe[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<any>(`
    SELECT p.*, r.title, r.calories, r.protein, r.carbs, r.fat 
    FROM weekly_meal_plan p
    LEFT JOIN recipe_library r ON p.recipe_id = r.id
    WHERE p.date = ?
    ORDER BY p.meal_type DESC
  `, [date]);
  
  return rows.map(r => ({
    ...r,
    is_consumed: Boolean(r.is_consumed),
    recipe: r.recipe_id ? {
      id: r.recipe_id,
      title: r.title,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
    } : undefined
  }));
}

/**
 * Assigns a recipe to a (date, meal_type) slot, creating the row if it
 * doesn't exist yet. If the slot already holds a consumed meal, the portion
 * it debited is credited back (#303) — reassigning a slot always resets its
 * consumption, even when the incoming recipe_id is the same one that was
 * already there, since the user is re-picking what's in that slot and the
 * previous tick no longer describes anything real. Runs entirely inside one
 * transaction: select, optional credit, and the insert/update must all
 * succeed or none of them do.
 */
export async function assignMealToPlan(date: string, meal_type: string, recipe_id: string): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<any>(
      'SELECT * FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
      [date, meal_type]
    );
    if (existing) {
      if (existing.is_consumed === 1) {
        await _creditPortion(db, existing);
      }
      await db.runAsync(
        'UPDATE weekly_meal_plan SET recipe_id = ?, is_consumed = 0, consumed_from_inventory_id = NULL WHERE id = ?',
        [recipe_id, existing.id]
      );
    } else {
      await db.runAsync(
        'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 0)',
        [date, meal_type, recipe_id]
      );
    }
  });
}

export async function removeMealFromPlan(id: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM weekly_meal_plan WHERE id = ?', [id]);
}

/**
 * Credits back the exact meal_inventory batch a weekly_meal_plan row's
 * consumption was debited from (#302's consumed_from_inventory_id pointer).
 * A no-op if the pointer is NULL (legacy row, or nothing was ever debited)
 * or if the batch it points at no longer exists.
 *
 * Extracted from toggleMealConsumed's untick branch so assignMealToPlan
 * (#303) can reuse the exact same credit logic when a consumed slot is
 * reassigned. Does NOT open its own transaction — the adapter's
 * withTransactionAsync is not reentrant, so every caller must already be
 * inside one.
 */
async function _creditPortion(
  db: SQLite.SQLiteDatabase,
  planRow: { consumed_from_inventory_id: number | null }
): Promise<void> {
  if (planRow.consumed_from_inventory_id != null) {
    await db.runAsync(
      'UPDATE meal_inventory SET portions_available = portions_available + 1 WHERE id = ?',
      [planRow.consumed_from_inventory_id]
    );
  }
}

export async function toggleMealConsumed(id: number, is_consumed: boolean): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    const meal = await db.getFirstAsync<any>('SELECT * FROM weekly_meal_plan WHERE id = ?', [id]);
    if (!meal) return;

    // Tracks which meal_inventory row (if any) this plan row's consumption
    // is attributed to. Defaults to whatever was already recorded, so a
    // toggle to the same state (a no-op transition below) leaves it alone.
    let consumedFromInventoryId: number | null = meal.consumed_from_inventory_id ?? null;

    // Changing to consumed: debit FIFO from the oldest batch with stock,
    // and record which batch it came from (#302) so a later untick can
    // credit back that exact row instead of guessing. If there's no stock,
    // don't debit anything and leave the pointer NULL — never pretend a
    // portion was consumed from inventory that doesn't exist.
    if (is_consumed && meal.is_consumed === 0) {
      const inv = await db.getFirstAsync<any>(
        'SELECT * FROM meal_inventory WHERE recipe_id = ? AND portions_available > 0 ORDER BY date_cooked ASC LIMIT 1',
        [meal.recipe_id]
      );
      if (inv) {
        await db.runAsync(
          'UPDATE meal_inventory SET portions_available = portions_available - 1 WHERE id = ?',
          [inv.id]
        );
        consumedFromInventoryId = inv.id;
      } else {
        consumedFromInventoryId = null;
      }
    }
    // Reverting from consumed back to planned: credit back ONLY the exact
    // batch this row was debited from — never the most-recently-cooked
    // batch, and never an INSERT fallback (#302); both of those used to
    // create inventory that was never actually cooked. A no-op if that
    // batch row no longer exists (e.g. deleted elsewhere).
    //
    // Orchestrator decision (#302): a row ticked before migration v34 has
    // a NULL consumed_from_inventory_id (legacy data) and gets NO credit
    // here. This is deliberately conservative — it can under-count one
    // portion once, but it can never fabricate stock from nothing.
    else if (!is_consumed && meal.is_consumed === 1) {
      await _creditPortion(db, meal);
      consumedFromInventoryId = null;
    }

    await db.runAsync(
      'UPDATE weekly_meal_plan SET is_consumed = ?, consumed_from_inventory_id = ? WHERE id = ?',
      [is_consumed ? 1 : 0, consumedFromInventoryId, id]
    );
  });
}

// ─────────────────────────────────────────────
// Cooking Tasks CRUD
// ─────────────────────────────────────────────

export interface CookingTask {
  id: number;
  recipe_id: string;
  servings_to_cook: number;
}

export interface CookingTaskWithRecipe extends CookingTask {
  recipe: Recipe;
}

/**
 * Inserts a new cooking task linked to the given recipe and serving count.
 * Called alongside Shopping List population from RecipeDetailScreen.
 */
export async function insertCookingTask(
  recipe_id: string,
  servings_to_cook: number
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    'INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)',
    [recipe_id, servings_to_cook]
  );
}

/**
 * Atomically adds every ingredient of a recipe to the shopping list and
 * queues it as a cooking task (#320).
 *
 * Previously RecipeDetailScreen's handleAddToShoppingList looped
 * addShoppingListItem() per ingredient (each an autocommitted single-row
 * INSERT) and then made a separate call to insertCookingTask(). A failure
 * partway through the loop left a half-written shopping list with no
 * matching cooking task, and the screen's catch only surfaced an Alert —
 * nothing rolled back. This wraps the whole batch in one
 * db.withTransactionAsync, same pattern as finishCooking() above.
 *
 * addShoppingListItem() and insertCookingTask() are called directly here
 * (reusing their existing single-row SQL) because neither opens its own
 * transaction — each is just one runAsync — so they're safe to call from
 * inside this one.
 *
 * Note on #369: the real expo-sqlite withTransactionAsync is a bare,
 * non-queued BEGIN/COMMIT on the shared connection, so two overlapping
 * transactions can roll back each other's work. The overlap risk here is
 * low in practice: RecipeDetailScreen's success/failure Alert blocks
 * navigation before the screen loses focus, and syncRollingSchedule only
 * runs on initial load and on focus — so nothing else starts a second
 * transaction while this one is in flight.
 */
export async function addRecipeToShoppingList(
  items: { name: string; quantity: number; unit: string }[],
  recipeId: string,
  servings: number
): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await addShoppingListItem(item.name, item.quantity, item.unit);
    }
    await insertCookingTask(recipeId, servings);
  });
}

/**
 * Returns all cooking tasks joined with their corresponding recipe metadata.
 * Results are ordered by insertion order (oldest task first) so the user
 * cooks in the order they planned their shopping.
 *
 * @returns Array of cooking tasks with full recipe details embedded.
 */
export async function getCookingTasks(): Promise<CookingTaskWithRecipe[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<any>(`
    SELECT
      ct.id,
      ct.recipe_id,
      ct.servings_to_cook,
      r.title,
      r.calories,
      r.protein,
      r.carbs,
      r.fat,
      r.instructions,
      r.ingredients,
      r.prepTimeMinutes,
      r.defaultServings,
      r.category,
      r.freezerTips
    FROM cooking_tasks ct
    JOIN recipe_library r ON ct.recipe_id = r.id
    ORDER BY ct.id ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    recipe_id: r.recipe_id,
    servings_to_cook: r.servings_to_cook,
    recipe: {
      id: r.recipe_id,
      title: r.title,
      category: r.category,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      prepTimeMinutes: r.prepTimeMinutes,
      defaultServings: r.defaultServings,
      ingredients: JSON.parse(r.ingredients ?? '[]'),
      instructions: r.instructions,
      freezerTips: r.freezerTips ?? '',
    } as Recipe,
  }));
}

/**
 * Atomic transaction that:
 *   1. Upserts meal_inventory (adds servings_to_cook to portions_available)
 *   2. Deletes the cooking task row
 *
 * Called when the user presses "Finished Cooking" on the CookingTasksScreen.
 */
export async function finishCooking(
  taskId: number,
  recipe_id: string,
  servings_to_cook: number
): Promise<void> {
  const db = getDatabase();
  const date_cooked = toISODate();

  await db.withTransactionAsync(async () => {
    // Upsert meal_inventory: increment if an active record exists, else insert
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ? AND portions_available > 0',
      [recipe_id]
    );

    if (existing) {
      await db.runAsync(
        'UPDATE meal_inventory SET portions_available = portions_available + ?, date_cooked = ? WHERE id = ?',
        [servings_to_cook, date_cooked, existing.id]
      );
    } else {
      await db.runAsync(
        'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
        [recipe_id, servings_to_cook, date_cooked]
      );
    }

    // Remove the completed cooking task
    await db.runAsync('DELETE FROM cooking_tasks WHERE id = ?', [taskId]);
  });
}

/**
 * Removes a cooking task from the queue without logging it to inventory.
 * Used when the user cancels/dismisses a task from CookingTasksScreen.
 *
 * @param taskId - The primary key of the cooking_tasks row to remove.
 */
export async function deleteCookingTask(taskId: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM cooking_tasks WHERE id = ?', [taskId]);
}

// ─────────────────────────────────────────────
// Nutrition Analytics Queries (#267)
// ─────────────────────────────────────────────

export interface DailyMacroTotals {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Number of consumed meals that contributed to this day's totals. */
  mealCount: number;
}

/**
 * Return per-day macro totals (calories, protein, carbs, fat) from meals
 * that were marked as consumed in weekly_meal_plan, joined to recipe_library
 * for macro values. Only days that have at least one consumed meal appear.
 *
 * @param days - How many calendar days back to look (default 30).
 */
export async function getConsumedMacrosByDay(days: number = 30): Promise<DailyMacroTotals[]> {
  const db = getDatabase();
  const cutoffISO = _addDaysKey(toISODate(), -days);

  const rows = await db.getAllAsync<{
    date: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_count: number;
  }>(
    `SELECT
       p.date,
       SUM(r.calories) AS calories,
       SUM(r.protein)  AS protein,
       SUM(r.carbs)    AS carbs,
       SUM(r.fat)      AS fat,
       COUNT(*)        AS meal_count
     FROM weekly_meal_plan p
     JOIN recipe_library r ON p.recipe_id = r.id
     WHERE p.is_consumed = 1
       AND p.date >= ?
     GROUP BY p.date
     ORDER BY p.date ASC`,
    [cutoffISO]
  );

  return rows.map((r) => ({
    date: r.date,
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
    mealCount: r.meal_count ?? 0,
  }));
}

export interface MealAdherenceSummary {
  /** Total meals that were planned (all weekly_meal_plan rows in window). */
  planned: number;
  /** Total meals that were consumed (is_consumed = 1) in the same window. */
  consumed: number;
  /** consumed / planned as a 0–1 fraction; 0 when planned = 0. */
  adherenceRatio: number;
}

/**
 * Compute meal plan adherence: how many planned meals were actually consumed
 * over the past `days` calendar days.
 *
 * @param days - Window size in days (default 30).
 */
export async function getMealAdherence(days: number = 30): Promise<MealAdherenceSummary> {
  const db = getDatabase();
  const cutoffISO = _addDaysKey(toISODate(), -days);

  const row = await db.getFirstAsync<{ planned: number; consumed: number }>(
    `SELECT
       COUNT(*) AS planned,
       SUM(CASE WHEN is_consumed = 1 THEN 1 ELSE 0 END) AS consumed
     FROM weekly_meal_plan
     WHERE date >= ?`,
    [cutoffISO]
  );

  const planned = row?.planned ?? 0;
  const consumed = row?.consumed ?? 0;
  return {
    planned,
    consumed,
    adherenceRatio: planned > 0 ? consumed / planned : 0,
  };
}

export interface EatenRecipeRow {
  recipe_id: string;
  title: string;
  count: number;
}

/**
 * Return the top `limit` most-consumed recipes from weekly_meal_plan history,
 * ordered by consumed count descending.
 *
 * @param limit - Maximum number of recipes to return (default 5).
 */
export async function getMostEatenRecipes(limit: number = 5): Promise<EatenRecipeRow[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ recipe_id: string; title: string; count: number }>(
    `SELECT p.recipe_id, r.title, COUNT(*) AS count
     FROM weekly_meal_plan p
     JOIN recipe_library r ON p.recipe_id = r.id
     WHERE p.is_consumed = 1
     GROUP BY p.recipe_id
     ORDER BY count DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((r) => ({
    recipe_id: r.recipe_id,
    title: r.title,
    count: r.count,
  }));
}

export interface AverageConsumedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Total number of consumed meal rows used in the average. */
  sampleSize: number;
}

/**
 * Compute average per-meal macros (calories, protein, carbs, fat) across all
 * meals that have been marked consumed in weekly_meal_plan.
 *
 * Returns zeros with sampleSize = 0 when no consumed meals exist.
 */
export async function getAverageConsumedMacros(): Promise<AverageConsumedMacros> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    sample_size: number;
  }>(
    `SELECT
       AVG(r.calories) AS calories,
       AVG(r.protein)  AS protein,
       AVG(r.carbs)    AS carbs,
       AVG(r.fat)      AS fat,
       COUNT(*)        AS sample_size
     FROM weekly_meal_plan p
     JOIN recipe_library r ON p.recipe_id = r.id
     WHERE p.is_consumed = 1`
  );

  return {
    calories: Math.round(row?.calories ?? 0),
    protein: Math.round(row?.protein ?? 0),
    carbs: Math.round(row?.carbs ?? 0),
    fat: Math.round(row?.fat ?? 0),
    sampleSize: row?.sample_size ?? 0,
  };
}

export interface CookedRecipeRow {
  recipe_id: string;
  title: string;
  totalPortions: number;
  cookEvents: number;
}

/**
 * Return the top `limit` most-cooked recipes from cook_log (v30), ordered by
 * total portions cooked descending. Returns an empty array when cook_log has
 * no rows yet (the table is new — data accumulates as the user cooks).
 *
 * @param limit - Maximum number of recipes to return (default 5).
 */
export async function getMostCookedRecipes(limit: number = 5): Promise<CookedRecipeRow[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    recipe_id: string;
    title: string;
    total_portions: number;
    cook_events: number;
  }>(
    `SELECT cl.recipe_id, r.title,
            SUM(cl.portions) AS total_portions,
            COUNT(*)          AS cook_events
     FROM cook_log cl
     JOIN recipe_library r ON cl.recipe_id = r.id
     GROUP BY cl.recipe_id
     ORDER BY total_portions DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((r) => ({
    recipe_id: r.recipe_id,
    title: r.title,
    totalPortions: r.total_portions ?? 0,
    cookEvents: r.cook_events ?? 0,
  }));
}

export interface InventorySnapshot {
  /** Total number of distinct recipes currently in stock. */
  recipesInStock: number;
  /** Sum of portions_available across all in-stock recipes. */
  totalPortions: number;
  /** Per-recipe rows for display. */
  items: Array<{
    recipe_id: string;
    title: string;
    portionsAvailable: number;
  }>;
}

/**
 * Return a snapshot of the current meal inventory: how many recipes are in
 * stock and their available portion counts. Uses meal_inventory joined to
 * recipe_library. Empty when no meals are currently prepared.
 */
export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    recipe_id: string;
    title: string;
    portions_available: number;
  }>(
    `SELECT m.recipe_id, r.title, m.portions_available
     FROM meal_inventory m
     JOIN recipe_library r ON m.recipe_id = r.id
     WHERE m.portions_available > 0
     ORDER BY m.portions_available DESC`
  );

  const totalPortions = rows.reduce((sum, r) => sum + (r.portions_available ?? 0), 0);

  return {
    recipesInStock: rows.length,
    totalPortions,
    items: rows.map((r) => ({
      recipe_id: r.recipe_id,
      title: r.title,
      portionsAvailable: r.portions_available,
    })),
  };
}

// ─────────────────────────────────────────────
// App Settings helpers (backed by app_state)
// ─────────────────────────────────────────────

/**
 * Read a value from app_state by key. Returns null when the key is absent.
 * Use the typed wrappers (getWorkoutReminderEnabled etc.) rather than calling
 * this directly where possible.
 */
export async function getSetting(key: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

/**
 * Persist a string value in app_state. Upserts so repeated calls are safe.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// ── Typed setting keys ────────────────────────

const SETTING_WORKOUT_REMINDER_ENABLED = 'workoutReminderEnabled';
const SETTING_WORKOUT_REMINDER_TIME = 'workoutReminderTime';
const DEFAULT_WORKOUT_REMINDER_TIME = '08:00';

export async function getWorkoutReminderEnabled(): Promise<boolean> {
  const raw = await getSetting(SETTING_WORKOUT_REMINDER_ENABLED);
  return raw === 'true';
}

export async function setWorkoutReminderEnabled(enabled: boolean): Promise<void> {
  await setSetting(SETTING_WORKOUT_REMINDER_ENABLED, enabled ? 'true' : 'false');
}

export async function getWorkoutReminderTime(): Promise<string> {
  const raw = await getSetting(SETTING_WORKOUT_REMINDER_TIME);
  return raw ?? DEFAULT_WORKOUT_REMINDER_TIME;
}

export async function setWorkoutReminderTime(time: string): Promise<void> {
  await setSetting(SETTING_WORKOUT_REMINDER_TIME, time);
}

// ── Cooking reminder settings (Unit 3b) ──────────

const SETTING_COOK_WHEN_EMPTY_ENABLED = 'cookWhenEmptyEnabled';
const SETTING_WEEKLY_COOK_DAY_ENABLED = 'weeklyCookDayEnabled';
const SETTING_WEEKLY_COOK_DAY = 'weeklyCookDay';
const SETTING_WEEKLY_COOK_DAY_TIME = 'weeklyCookDayTime';
const SETTING_COOK_EMPTY_NOTIFIED = 'cookEmptyNotified';

const DEFAULT_WEEKLY_COOK_DAY = 0;        // Sunday
const DEFAULT_WEEKLY_COOK_DAY_TIME = '10:00';

export async function getCookWhenEmptyEnabled(): Promise<boolean> {
  const raw = await getSetting(SETTING_COOK_WHEN_EMPTY_ENABLED);
  return raw === 'true';
}

export async function setCookWhenEmptyEnabled(enabled: boolean): Promise<void> {
  await setSetting(SETTING_COOK_WHEN_EMPTY_ENABLED, enabled ? 'true' : 'false');
}

export async function getWeeklyCookDayEnabled(): Promise<boolean> {
  const raw = await getSetting(SETTING_WEEKLY_COOK_DAY_ENABLED);
  return raw === 'true';
}

export async function setWeeklyCookDayEnabled(enabled: boolean): Promise<void> {
  await setSetting(SETTING_WEEKLY_COOK_DAY_ENABLED, enabled ? 'true' : 'false');
}

/** Returns the cook day as 0–6 (0 = Sunday). */
export async function getWeeklyCookDay(): Promise<number> {
  const raw = await getSetting(SETTING_WEEKLY_COOK_DAY);
  if (raw === null) return DEFAULT_WEEKLY_COOK_DAY;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? DEFAULT_WEEKLY_COOK_DAY : parsed;
}

export async function setWeeklyCookDay(day: number): Promise<void> {
  await setSetting(SETTING_WEEKLY_COOK_DAY, String(day));
}

export async function getWeeklyCookDayTime(): Promise<string> {
  const raw = await getSetting(SETTING_WEEKLY_COOK_DAY_TIME);
  return raw ?? DEFAULT_WEEKLY_COOK_DAY_TIME;
}

export async function setWeeklyCookDayTime(time: string): Promise<void> {
  await setSetting(SETTING_WEEKLY_COOK_DAY_TIME, time);
}

/**
 * Returns true when the cook-empty notification has already been sent for
 * the current empty episode (debounce). Reset this via resetCookEmptyNotified()
 * whenever cooking finishes and inventory is replenished.
 */
export async function getCookEmptyNotified(): Promise<boolean> {
  const raw = await getSetting(SETTING_COOK_EMPTY_NOTIFIED);
  return raw === 'true';
}

export async function setCookEmptyNotified(notified: boolean): Promise<void> {
  await setSetting(SETTING_COOK_EMPTY_NOTIFIED, notified ? 'true' : 'false');
}

/**
 * Reset the cook-empty debounce flag so the next inventory-empty episode
 * can trigger a notification again. Call this after finishCooking() or
 * logCookedMeal() to mark inventory as replenished.
 */
export async function resetCookEmptyNotified(): Promise<void> {
  await setCookEmptyNotified(false);
}

// ── Meal-time reminder settings (#287) ──────────

/**
 * The three meal slots that can each carry a daily reminder.
 */
export type MealType = 'breakfast' | 'lunch' | 'dinner';

const MEAL_REMINDER_ENABLED_KEYS: Record<MealType, string> = {
  breakfast: 'mealReminderBreakfastEnabled',
  lunch:     'mealReminderLunchEnabled',
  dinner:    'mealReminderDinnerEnabled',
};

const MEAL_REMINDER_TIME_KEYS: Record<MealType, string> = {
  breakfast: 'mealReminderBreakfastTime',
  lunch:     'mealReminderLunchTime',
  dinner:    'mealReminderDinnerTime',
};

/** Sensible defaults — disabled until the user opts in. */
const MEAL_REMINDER_DEFAULT_TIMES: Record<MealType, string> = {
  breakfast: '08:00',
  lunch:     '12:30',
  dinner:    '18:30',
};

export async function getMealReminderEnabled(meal: MealType): Promise<boolean> {
  const raw = await getSetting(MEAL_REMINDER_ENABLED_KEYS[meal]);
  return raw === 'true';
}

export async function setMealReminderEnabled(meal: MealType, enabled: boolean): Promise<void> {
  await setSetting(MEAL_REMINDER_ENABLED_KEYS[meal], enabled ? 'true' : 'false');
}

/** Returns the saved reminder time for the meal, or the default if not yet persisted. */
export async function getMealReminderTime(meal: MealType): Promise<string> {
  const raw = await getSetting(MEAL_REMINDER_TIME_KEYS[meal]);
  return raw ?? MEAL_REMINDER_DEFAULT_TIMES[meal];
}

export async function setMealReminderTime(meal: MealType, time: string): Promise<void> {
  await setSetting(MEAL_REMINDER_TIME_KEYS[meal], time);
}

// ─────────────────────────────────────────────
// Backup & restore helpers (#277)
// ─────────────────────────────────────────────

/**
 * Return the highest version number recorded in schema_version.
 * Used by the backup service to tag the payload and by the restore
 * path to enforce the compatibility gate.
 */
export async function getCurrentSchemaVersion(): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ max_version: number | null }>(
    'SELECT MAX(version) AS max_version FROM schema_version'
  );
  return row?.max_version ?? 0;
}

/**
 * Return all user-owned table names from sqlite_master, excluding any
 * internal SQLite tables (sqlite_*) and the schema_version table (never
 * backed up or overwritten during restore).
 */
export async function listUserTables(): Promise<string[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name != 'schema_version'
     ORDER BY name ASC`
  );
  return rows.map((r) => r.name);
}

/**
 * Return all rows from the named table as plain objects.
 * Called once per table during backup export.
 */
export async function dumpTable(
  tableName: string
): Promise<Record<string, unknown>[]> {
  const db = getDatabase();
  // Table name is from sqlite_master — safe to interpolate.
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${tableName}`
  );
  return rows;
}

/**
 * Restore all tables from the backup payload inside a single transaction.
 * Rules:
 *   - schema_version and sqlite_* tables are never touched.
 *   - Only tables that exist in the current DB are restored (unknown tables
 *     in older/newer backups are silently skipped).
 *   - Per-row INSERT uses that row's own column list so new columns added by
 *     later migrations default-fill rather than error.
 *   - A backup made before #303's migration v35 shipped can legitimately
 *     contain duplicate (date, meal_type) rows in weekly_meal_plan (v35's
 *     own unique index didn't exist yet when it was taken, and
 *     validatePayload() accepts any backup at or below the current schema
 *     version). v35's idx_weekly_meal_plan_date_meal_type index always
 *     exists on the live DB by the time restore runs, so the second INSERT
 *     of such a pair would throw — and since restore is one transaction,
 *     that would roll back every table, not just this one. So: drop the
 *     index before restoring, restore every table exactly as before, then
 *     re-run v35's own SQL (looked up at runtime, never copied or
 *     reimplemented, so it can't drift from the migration) against the
 *     just-restored data — crediting any consumed loser's batch in the
 *     just-restored meal_inventory, deleting losers per the same survivor
 *     rule the migration uses, and recreating the index. A clean,
 *     already-deduped (post-v35) backup is unaffected: nothing matches the
 *     credit or delete, and the index is simply recreated.
 *
 * A row's own keys are NOT trusted as column identifiers: unlike values,
 * column names can't be parameterised, so a backup file (user-supplied,
 * JSON.parse'd from a picked file) with a crafted row key would otherwise
 * be interpolated straight into the INSERT's column list — a SQL injection
 * path (#315). Each table's real columns are read once via
 * `PRAGMA table_info(<table>)` (table name is already whitelisted against
 * listUserTables() above) and every row is filtered down to only the keys
 * that are real columns before the INSERT is built. A row left with zero
 * known keys is skipped entirely — not inserted, not counted in
 * rowsRestored. What got dropped is reported per table, both via
 * console.warn (this module's existing best-effort logging style) and via
 * the optional `skipped` field on the return value.
 *
 * @param payloadTables  The `tables` object from the BackupPayload.
 * @returns A summary of what was restored, plus optionally what was skipped.
 */
export async function restoreFromPayload(
  payloadTables: Record<string, Record<string, unknown>[]>
): Promise<{
  tablesRestored: number;
  rowsRestored: number;
  skipped?: { table: string; columns: string[]; rows: number }[];
}> {
  const db = getDatabase();
  const liveTableNames = await listUserTables();
  const liveTableSet = new Set(liveTableNames);

  let tablesRestored = 0;
  let rowsRestored = 0;
  const skipped: { table: string; columns: string[]; rows: number }[] = [];

  await db.withTransactionAsync(async () => {
    // Drop first so a legacy backup's duplicate weekly_meal_plan rows (see
    // above) can all be inserted below; recreated by v35's own SQL after
    // the restore loop.
    await db.execAsync('DROP INDEX IF EXISTS idx_weekly_meal_plan_date_meal_type');

    for (const [tableName, rows] of Object.entries(payloadTables)) {
      // Skip tables that don't exist in the current schema
      if (!liveTableSet.has(tableName)) continue;

      // Wipe existing rows
      await db.runAsync(`DELETE FROM ${tableName}`);

      // Whitelist this table's real columns (table name is already
      // whitelisted against liveTableSet above; PRAGMA table_info is safe
      // to interpolate a live table name into).
      const columnInfo = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(${tableName})`
      );
      const liveColumnSet = new Set(columnInfo.map((c) => c.name));

      const droppedColumns = new Set<string>();
      let skippedRowCount = 0;

      // Re-insert each row using only the keys that are real columns
      for (const row of rows) {
        const allKeys = Object.keys(row);
        const keys = allKeys.filter((k) => liveColumnSet.has(k));

        for (const k of allKeys) {
          if (!liveColumnSet.has(k)) droppedColumns.add(k);
        }

        if (keys.length === 0) {
          if (allKeys.length > 0) skippedRowCount += 1;
          continue;
        }

        const columns = keys.join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((k) => row[k]);

        await db.runAsync(
          `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`,
          values as (string | number | null)[]
        );
        rowsRestored += 1;
      }

      if (droppedColumns.size > 0 || skippedRowCount > 0) {
        const entry = {
          table: tableName,
          columns: Array.from(droppedColumns).sort(),
          rows: skippedRowCount,
        };
        skipped.push(entry);
        console.warn(
          `[restoreFromPayload] Table "${tableName}": dropped unknown column(s) [${entry.columns.join(', ')}]; ${skippedRowCount} row(s) skipped entirely (no known columns).`
        );
      }

      tablesRestored += 1;
    }

    // Re-apply v35's dedupe/credit/index-creation SQL against the
    // just-restored data, as if v35 had run on it. Looked up at runtime
    // rather than duplicated so this can never drift from the migration.
    const v35 = MIGRATIONS.find((m) => m.version === 35);
    if (!v35) {
      throw new Error(
        'restoreFromPayload: migration v35 not found in MIGRATIONS — cannot rebuild the weekly_meal_plan unique index after restore.'
      );
    }
    await db.execAsync(v35.sql);
  });

  return {
    tablesRestored,
    rowsRestored,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}

// ── Nutrition goal settings (#274) ────────────────────────────────────────────

const SETTING_NUTRITION_GOAL_CALORIES = 'nutritionGoalCalories';
const SETTING_NUTRITION_GOAL_PROTEIN = 'nutritionGoalProtein';

/**
 * Read the user's stored nutrition goals from app_state, falling back to
 * NUTRITION_GOALS defaults for any value that has not been persisted yet.
 *
 * Callers (AnalyticsDashboardScreen, SettingsScreen) should call this in
 * their useFocusEffect / loadData to pick up changes made in Settings.
 */
export async function getNutritionGoals(): Promise<NutritionGoals> {
  const [calRaw, protRaw] = await Promise.all([
    getSetting(SETTING_NUTRITION_GOAL_CALORIES),
    getSetting(SETTING_NUTRITION_GOAL_PROTEIN),
  ]);

  const calories =
    calRaw !== null && !isNaN(Number(calRaw))
      ? Number(calRaw)
      : NUTRITION_GOALS.calories;

  const protein =
    protRaw !== null && !isNaN(Number(protRaw))
      ? Number(protRaw)
      : NUTRITION_GOALS.protein;

  return { calories, protein };
}

/** Persist the user's daily calorie goal (kcal). */
export async function setNutritionGoalCalories(kcal: number): Promise<void> {
  await setSetting(SETTING_NUTRITION_GOAL_CALORIES, String(kcal));
}

/** Persist the user's daily protein goal (grams). */
export async function setNutritionGoalProtein(g: number): Promise<void> {
  await setSetting(SETTING_NUTRITION_GOAL_PROTEIN, String(g));
}

// ── User profile settings (#281) ─────────────────────────────────────────────
//
// Profile fields are stored as simple string KV pairs in app_state.
// No schema migration is needed — the existing KV mechanism is reused.

const SETTING_PROFILE_HEIGHT_CM       = 'profileHeightCm';
const SETTING_PROFILE_AGE             = 'profileAge';
const SETTING_PROFILE_SEX             = 'profileSex';
const SETTING_PROFILE_ACTIVITY_LEVEL  = 'profileActivityLevel';
const SETTING_PROFILE_GOAL_TYPE       = 'profileGoalType';
const SETTING_ONBOARDING_COMPLETE     = 'onboardingComplete';

/**
 * Structured user profile object returned by getUserProfile().
 * All fields are optional — null means the user has not yet entered that value.
 */
export interface UserProfileData {
  heightCm:      number | null;
  age:           number | null;
  sex:           Sex | null;
  activityLevel: ActivityLevel | null;
  goalType:      GoalType | null;
}

/** Read all profile fields at once. Returns null for any unset field. */
export async function getUserProfile(): Promise<UserProfileData> {
  const [hRaw, aRaw, sRaw, alRaw, gtRaw] = await Promise.all([
    getSetting(SETTING_PROFILE_HEIGHT_CM),
    getSetting(SETTING_PROFILE_AGE),
    getSetting(SETTING_PROFILE_SEX),
    getSetting(SETTING_PROFILE_ACTIVITY_LEVEL),
    getSetting(SETTING_PROFILE_GOAL_TYPE),
  ]);

  const heightCm = hRaw !== null && !isNaN(Number(hRaw)) ? Number(hRaw) : null;
  const age      = aRaw !== null && !isNaN(Number(aRaw)) ? Number(aRaw) : null;

  const VALID_SEX: Sex[] = ['male', 'female'];
  const sex = sRaw !== null && (VALID_SEX as string[]).includes(sRaw) ? (sRaw as Sex) : null;

  const VALID_ACTIVITY: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
  const activityLevel =
    alRaw !== null && (VALID_ACTIVITY as string[]).includes(alRaw)
      ? (alRaw as ActivityLevel)
      : null;

  const VALID_GOAL: GoalType[] = ['cut', 'maintain', 'gain'];
  const goalType =
    gtRaw !== null && (VALID_GOAL as string[]).includes(gtRaw)
      ? (gtRaw as GoalType)
      : null;

  return { heightCm, age, sex, activityLevel, goalType };
}

/** Persist the user's height in centimetres. */
export async function setProfileHeightCm(cm: number): Promise<void> {
  await setSetting(SETTING_PROFILE_HEIGHT_CM, String(cm));
}

/** Persist the user's age in years. */
export async function setProfileAge(years: number): Promise<void> {
  await setSetting(SETTING_PROFILE_AGE, String(years));
}

/** Persist the user's biological sex. */
export async function setProfileSex(sex: Sex): Promise<void> {
  await setSetting(SETTING_PROFILE_SEX, sex);
}

/** Persist the user's activity level. */
export async function setProfileActivityLevel(level: ActivityLevel): Promise<void> {
  await setSetting(SETTING_PROFILE_ACTIVITY_LEVEL, level);
}

/** Persist the user's goal type. */
export async function setProfileGoalType(goal: GoalType): Promise<void> {
  await setSetting(SETTING_PROFILE_GOAL_TYPE, goal);
}

/**
 * Returns true once the user has completed (or explicitly skipped) the
 * onboarding flow. App.tsx uses this to decide whether to show
 * OnboardingScreen or jump straight to the navigator.
 */
export async function getOnboardingComplete(): Promise<boolean> {
  const raw = await getSetting(SETTING_ONBOARDING_COMPLETE);
  return raw === 'true';
}

/** Mark onboarding as complete so the gate in App.tsx never shows it again. */
export async function setOnboardingComplete(complete: boolean): Promise<void> {
  await setSetting(SETTING_ONBOARDING_COMPLETE, complete ? 'true' : 'false');
}

/**
 * Return the most recent non-null body_weight from daily_log, or null when
 * no weight has ever been logged. Used by OnboardingScreen to prefill the
 * weight field.
 */
export async function getLatestBodyWeight(): Promise<number | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ body_weight: number }>(
    'SELECT body_weight FROM daily_log WHERE body_weight IS NOT NULL ORDER BY date DESC LIMIT 1'
  );
  return row?.body_weight ?? null;
}

// ── Hydration settings (v31) ──────────────────────────────────────────────────

const SETTING_HYDRATION_GOAL_ML = 'hydrationGoalMl';
const DEFAULT_HYDRATION_GOAL_ML = 2000;

/**
 * Read the user's daily hydration goal in ml from app_state.
 * Defaults to 2000 ml when not yet set.
 */
export async function getHydrationGoal(): Promise<number> {
  const raw = await getSetting(SETTING_HYDRATION_GOAL_ML);
  if (raw !== null && !isNaN(Number(raw))) return Number(raw);
  return DEFAULT_HYDRATION_GOAL_ML;
}

/** Persist the user's daily hydration goal in ml. */
export async function setHydrationGoal(ml: number): Promise<void> {
  await setSetting(SETTING_HYDRATION_GOAL_ML, String(ml));
}

// ── Hydration CRUD (water_ml column on daily_log, migration v31) ──────────────

/**
 * Return today's logged water total for the given date key (YYYY-MM-DD).
 * Returns 0 when the row doesn't exist or water_ml has not been set.
 */
export async function getWaterForDay(dateKey: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ water_ml: number }>(
    'SELECT water_ml FROM daily_log WHERE date = ?',
    [dateKey]
  );
  return row?.water_ml ?? 0;
}

/**
 * Increment (or decrement) the water total for `dateKey` by `ml`.
 * The result is clamped to a minimum of 0 — it never goes negative.
 *
 * Ensures a daily_log row exists for `dateKey` first (#305) — e.g. when
 * `dateKey` is outside the current rolling window — using the same
 * template/hammer-task values syncRollingSchedule() would generate for it,
 * then applies the increment to that row's (default 0) water_ml.
 */
export async function addWater(dateKey: string, ml: number): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, dateKey);
  const result = await db.runAsync(
    `UPDATE daily_log SET water_ml = MAX(0, water_ml + ?) WHERE date = ?`,
    [ml, dateKey]
  );
  _assertWrote(result, 'addWater', dateKey);
}

/**
 * Overwrite the water total for `dateKey` to exactly `ml` (clamped ≥ 0).
 * Ensures a daily_log row exists for `dateKey` first (#305).
 */
export async function setWaterForDay(dateKey: string, ml: number): Promise<void> {
  const db = getDatabase();
  await _ensureDailyLogRow(db, dateKey);
  const clamped = Math.max(0, ml);
  const result = await db.runAsync(
    `UPDATE daily_log SET water_ml = ? WHERE date = ?`,
    [clamped, dateKey]
  );
  _assertWrote(result, 'setWaterForDay', dateKey);
}

/**
 * Return water_ml for each day in the given date range, ordered ascending.
 * Days with no row (outside the rolling window) are omitted.
 *
 * @param sinceDateKey - Earliest date to include (YYYY-MM-DD).
 */
export async function getWaterHistory(
  sinceDateKey: string
): Promise<{ date: string; water_ml: number }[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ date: string; water_ml: number }>(
    'SELECT date, water_ml FROM daily_log WHERE date >= ? ORDER BY date ASC',
    [sinceDateKey]
  );
  return rows;
}

// ── Body measurements CRUD (body_measurements table, migration v32) ───────────

/** A single body-measurement record (one row per date). */
export interface BodyMeasurement {
  id: number;
  date: string;
  waist_cm: number | null;
  chest_cm: number | null;
  hips_cm: number | null;
  thigh_cm: number | null;
  arm_cm: number | null;
}

type MeasurementInput = {
  waist_cm?: number | null;
  chest_cm?: number | null;
  hips_cm?: number | null;
  thigh_cm?: number | null;
  arm_cm?: number | null;
};

/**
 * Upsert a body-measurement entry for `date`.
 *
 * If no row exists for that date, inserts a new one with only the provided
 * fields set (others stay NULL).  If a row already exists, updates only the
 * non-undefined fields so previous measurements are preserved.
 *
 * @param date   - YYYY-MM-DD date key.
 * @param fields - Partial measurement object; undefined fields are ignored.
 */
export async function logBodyMeasurement(
  date: string,
  fields: MeasurementInput
): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM body_measurements WHERE date = ?',
    [date]
  );

  if (!existing) {
    // Insert — only supply provided fields; missing ones default to NULL
    await db.runAsync(
      `INSERT INTO body_measurements (date, waist_cm, chest_cm, hips_cm, thigh_cm, arm_cm)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        date,
        fields.waist_cm ?? null,
        fields.chest_cm ?? null,
        fields.hips_cm ?? null,
        fields.thigh_cm ?? null,
        fields.arm_cm ?? null,
      ]
    );
    return;
  }

  // Update — only the explicitly provided (non-undefined) fields
  const setClauses: string[] = [];
  const values: (number | null)[] = [];

  if (fields.waist_cm !== undefined) { setClauses.push('waist_cm = ?'); values.push(fields.waist_cm ?? null); }
  if (fields.chest_cm !== undefined) { setClauses.push('chest_cm = ?'); values.push(fields.chest_cm ?? null); }
  if (fields.hips_cm  !== undefined) { setClauses.push('hips_cm = ?');  values.push(fields.hips_cm  ?? null); }
  if (fields.thigh_cm !== undefined) { setClauses.push('thigh_cm = ?'); values.push(fields.thigh_cm ?? null); }
  if (fields.arm_cm   !== undefined) { setClauses.push('arm_cm = ?');   values.push(fields.arm_cm   ?? null); }

  if (setClauses.length === 0) return; // Nothing to update

  await db.runAsync(
    `UPDATE body_measurements SET ${setClauses.join(', ')} WHERE id = ?`,
    [...values, existing.id]
  );
}

/**
 * Return all body-measurement rows since `sinceDateKey` (inclusive), ordered
 * ascending by date.  Returns all rows when `sinceDateKey` is omitted.
 *
 * @param sinceDateKey - Optional earliest date (YYYY-MM-DD) to include.
 */
export async function getBodyMeasurements(
  sinceDateKey?: string
): Promise<BodyMeasurement[]> {
  const db = getDatabase();
  let rows: BodyMeasurement[];
  if (sinceDateKey) {
    rows = await db.getAllAsync<BodyMeasurement>(
      'SELECT * FROM body_measurements WHERE date >= ? ORDER BY date ASC',
      [sinceDateKey]
    );
  } else {
    rows = await db.getAllAsync<BodyMeasurement>(
      'SELECT * FROM body_measurements ORDER BY date ASC'
    );
  }
  return rows;
}

/**
 * Return the single most-recent body-measurement row, or null when no
 * measurements have been logged yet.
 */
export async function getLatestMeasurements(): Promise<BodyMeasurement | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<BodyMeasurement>(
    'SELECT * FROM body_measurements ORDER BY date DESC LIMIT 1'
  );
  return row ?? null;
}

// ── Workout set log CRUD (workout_set_log table, migration v33) ───────────────

/** A single logged workout set. */
export interface WorkoutSet {
  id: number;
  date: string;
  exercise: string;
  set_index: number;
  reps: number;
  weight_kg: number;
  created_at: string;
}

/**
 * Insert one logged set for an exercise on `date`.
 *
 * @param date      - YYYY-MM-DD date key (use toISODate() / localDateKey()).
 * @param exercise  - Exercise name (matches Exercise.name from daily_log.exercises).
 * @param set       - Set details: index within the session, reps performed, weight in kg.
 */
export async function logWorkoutSet(
  date: string,
  exercise: string,
  set: { setIndex: number; reps: number; weightKg: number }
): Promise<void> {
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [date, exercise, set.setIndex, set.reps, set.weightKg, createdAt]
  );
}

/**
 * Return all sets logged for `date`, ordered by exercise name then set_index.
 * Used on the Dashboard to display already-logged sets for today's session.
 *
 * @param date - YYYY-MM-DD date key.
 */
export async function getWorkoutSetsForDay(date: string): Promise<WorkoutSet[]> {
  const db = getDatabase();
  return db.getAllAsync<WorkoutSet>(
    `SELECT * FROM workout_set_log WHERE date = ?
     ORDER BY exercise ASC, set_index ASC`,
    [date]
  );
}

/**
 * Return all sets logged for `exercise` since `sinceDateKey` (inclusive),
 * ordered chronologically (date ASC, set_index ASC). Used to build progression
 * charts and compute PRs.
 *
 * @param exercise      - Exercise name.
 * @param sinceDateKey  - Optional earliest date (YYYY-MM-DD). Defaults to all history.
 */
export async function getWorkoutHistory(
  exercise: string,
  sinceDateKey?: string
): Promise<WorkoutSet[]> {
  const db = getDatabase();
  if (sinceDateKey) {
    return db.getAllAsync<WorkoutSet>(
      `SELECT * FROM workout_set_log WHERE exercise = ? AND date >= ?
       ORDER BY date ASC, set_index ASC`,
      [exercise, sinceDateKey]
    );
  }
  return db.getAllAsync<WorkoutSet>(
    `SELECT * FROM workout_set_log WHERE exercise = ?
     ORDER BY date ASC, set_index ASC`,
    [exercise]
  );
}

/**
 * Return the distinct exercise names that have at least one logged set,
 * sorted alphabetically. Used by the Analytics screen to populate the
 * exercise picker.
 */
export async function getLoggedExercises(): Promise<string[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ exercise: string }>(
    `SELECT DISTINCT exercise FROM workout_set_log ORDER BY exercise ASC`
  );
  return rows.map((r) => r.exercise);
}

/**
 * Delete a single logged set by its primary key id.
 * Used when the user removes a mis-entered set from the Dashboard.
 *
 * @param id - Primary key of the workout_set_log row.
 */
export async function deleteWorkoutSet(id: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM workout_set_log WHERE id = ?', [id]);
}

// ── Backup reminder settings (#293) ──────────────────────────────────────────
//
// Stored as KV pairs in app_state — no schema migration required.
// Disabled by default; the user opts in from the "Data & backup" section of
// SettingsScreen.

const SETTING_BACKUP_REMINDER_ENABLED = 'backupReminderEnabled';
const SETTING_BACKUP_REMINDER_DAY     = 'backupReminderDay';
const SETTING_BACKUP_REMINDER_TIME    = 'backupReminderTime';

const DEFAULT_BACKUP_REMINDER_DAY  = 0;       // Sunday
const DEFAULT_BACKUP_REMINDER_TIME = '18:00'; // 6 pm

/** Returns true when the periodic backup reminder is enabled. Default: false. */
export async function getBackupReminderEnabled(): Promise<boolean> {
  const raw = await getSetting(SETTING_BACKUP_REMINDER_ENABLED);
  return raw === 'true';
}

/** Persist whether the periodic backup reminder is enabled. */
export async function setBackupReminderEnabled(enabled: boolean): Promise<void> {
  await setSetting(SETTING_BACKUP_REMINDER_ENABLED, enabled ? 'true' : 'false');
}

/** Returns the saved weekday (0–6, 0 = Sunday) for the backup reminder. */
export async function getBackupReminderDay(): Promise<number> {
  const raw = await getSetting(SETTING_BACKUP_REMINDER_DAY);
  if (raw === null) return DEFAULT_BACKUP_REMINDER_DAY;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed < 0 || parsed > 6
    ? DEFAULT_BACKUP_REMINDER_DAY
    : parsed;
}

/** Persist the weekday (0–6) for the backup reminder. */
export async function setBackupReminderDay(day: number): Promise<void> {
  await setSetting(SETTING_BACKUP_REMINDER_DAY, String(day));
}

/** Returns the saved time ("HH:MM") for the backup reminder. Default: "18:00". */
export async function getBackupReminderTime(): Promise<string> {
  const raw = await getSetting(SETTING_BACKUP_REMINDER_TIME);
  return raw ?? DEFAULT_BACKUP_REMINDER_TIME;
}

/** Persist the time ("HH:MM") for the backup reminder. */
export async function setBackupReminderTime(time: string): Promise<void> {
  await setSetting(SETTING_BACKUP_REMINDER_TIME, time);
}
