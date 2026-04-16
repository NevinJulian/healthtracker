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

export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA);
  const b = new Date(isoB);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function buildHammerTask(base: string, isRestDay: boolean, daysDiff: number): string {
  if (isRestDay) return `${base} @ Light Weight`;
  const cycle = Math.floor(daysDiff / CYCLE_DAYS);
  if (cycle === 0) return `${base} @ Baseline`;
  return `${base} @ Baseline + ${cycle * KG_PER_CYCLE}kg`;
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
    await db.execAsync(migration.sql);
    await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
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
  
  await insertStmt.finalizeAsync();
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
  
  await insertStmt.finalizeAsync();
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

async function _syncRollingSchedule(db: SQLite.SQLiteDatabase): Promise<void> {
  const startRow = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [START_DATE_KEY]
  );
  const startDateISO = startRow?.value ?? toISODate();

  const templateRows = await db.getAllAsync<{
    day_of_week: number;
    walking_task: string;
    hammer_task: string;
    is_rest_day: number;
    is_meal_prep_day: number;
    exercises: string;
  }>('SELECT * FROM weekly_template');

  const templateMap = new Map<number, typeof templateRows[number]>();
  for (const row of templateRows) {
    templateMap.set(row.day_of_week, row);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoffDate = addDays(today, -DAYS_HISTORY);
  const cutoffISO = toISODate(cutoffDate);

  // Pre-fetch existing rows with their exercises OUTSIDE the transaction (#37)
  const existingRows = await db.getAllAsync<{ date: string; exercises: string }>(
    'SELECT date, exercises FROM daily_log WHERE date >= ?',
    [cutoffISO]
  );
  const existingDates = new Set(existingRows.map((r) => r.date));

  type InsertParams = [string, string, string, number, number, string];
  const inserts: InsertParams[] = [];

  // Backfill: existing entries whose exercises are empty but template now has them
  type BackfillParams = [string, string]; // [exercisesJson, date]
  const backfills: BackfillParams[] = [];

  for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
    const targetDate = addDays(today, offset);
    const targetISO = toISODate(targetDate);
    const dow = targetDate.getDay();
    const template = templateMap.get(dow);
    if (!template) continue;

    // Parse template exercises (reset completed → false)
    const templateExercises = parseExercises(template.exercises);
    const baseExercises = templateExercises.map((ex) => ({ ...ex, completed: false }));
    const baseExercisesJson = JSON.stringify(baseExercises);

    if (existingDates.has(targetISO)) {
      // Row exists — check if exercises need to be backfilled
      const existing = existingRows.find((r) => r.date === targetISO);
      const currentExercises = parseExercises(existing?.exercises);
      if (currentExercises.length === 0 && templateExercises.length > 0) {
        backfills.push([baseExercisesJson, targetISO]);
      }
      continue;
    }

    const daysDiff = daysBetween(startDateISO, targetISO);
    const hammerWithWeight = buildHammerTask(
      template.hammer_task,
      template.is_rest_day === 1,
      daysDiff
    );

    inserts.push([
      targetISO,
      template.walking_task,
      hammerWithWeight,
      template.is_rest_day,
      template.is_meal_prep_day,
      baseExercisesJson,
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
    await db.runAsync('DELETE FROM daily_log WHERE date < ?', [cutoffISO]);
  });
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
    exercises: string;
    body_weight: number | null;
    additional_workouts: string;
  }>('SELECT * FROM daily_log ORDER BY date ASC');

  return rows.map(mapLogRow);
}

export async function upsertLogField(
  date: string,
  field: 'walk_completed' | 'hammer_completed' | 'fasting_completed',
  value: boolean
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`UPDATE daily_log SET ${field} = ? WHERE date = ?`, [value ? 1 : 0, date]);
}

/**
 * Toggles the `completed` flag on a single exercise within daily_log.exercises
 * for the given date. Reads the current JSON, patches it, then writes back.
 */
export async function upsertExerciseCompleted(
  date: string,
  exerciseId: string,
  value: boolean
): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ exercises: string }>(
    'SELECT exercises FROM daily_log WHERE date = ?',
    [date]
  );
  const exercises = parseExercises(row?.exercises);
  const updated = exercises.map((ex) =>
    ex.id === exerciseId ? { ...ex, completed: value } : ex
  );
  await db.runAsync(
    'UPDATE daily_log SET exercises = ? WHERE date = ?',
    [JSON.stringify(updated), date]
  );
}

export async function upsertBodyWeight(date: string, weight: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync('UPDATE daily_log SET body_weight = ? WHERE date = ?', [weight, date]);
}

export async function upsertAdditionalWorkouts(
  date: string,
  workouts: AdditionalWorkout[]
): Promise<void> {
  const db = getDatabase();
  await db.runAsync('UPDATE daily_log SET additional_workouts = ? WHERE date = ?', [
    JSON.stringify(workouts),
    date,
  ]);
}

export async function getWeightHistory(days: number): Promise<{ date: string; weight: number }[]> {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const rows = await db.getAllAsync<{ date: string; body_weight: number }>(
    'SELECT date, body_weight FROM daily_log WHERE date >= ? AND body_weight IS NOT NULL ORDER BY date ASC',
    [toISODate(cutoffDate)]
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

export async function assignMealToPlan(date: string, meal_type: string, recipe_id: string): Promise<void> {
  const db = getDatabase();
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM weekly_meal_plan WHERE date = ? AND meal_type = ?', 
    [date, meal_type]
  );
  if (existing) {
    await db.runAsync(
      'UPDATE weekly_meal_plan SET recipe_id = ?, is_consumed = 0 WHERE id = ?',
      [recipe_id, existing.id]
    );
  } else {
    await db.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 0)',
      [date, meal_type, recipe_id]
    );
  }
}

export async function removeMealFromPlan(id: number): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM weekly_meal_plan WHERE id = ?', [id]);
}

export async function toggleMealConsumed(id: number, is_consumed: boolean): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    const meal = await db.getFirstAsync<any>('SELECT * FROM weekly_meal_plan WHERE id = ?', [id]);
    if (!meal) return;
    
    // Changing to consumed
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
      }
    } 
    // Reverting from consumed back to planned
    else if (!is_consumed && meal.is_consumed === 1) {
       const inv = await db.getFirstAsync<any>(
        'SELECT * FROM meal_inventory WHERE recipe_id = ? ORDER BY date_cooked DESC LIMIT 1', 
        [meal.recipe_id]
      );
      if (inv) {
         await db.runAsync(
          'UPDATE meal_inventory SET portions_available = portions_available + 1 WHERE id = ?',
          [inv.id]
        );
      } else {
         await db.runAsync(
          'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, 1, ?)',
          [meal.recipe_id, toISODate()]
        );
      }
    }
    
    await db.runAsync('UPDATE weekly_meal_plan SET is_consumed = ? WHERE id = ?', [is_consumed ? 1 : 0, id]);
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
 * Returns all cooking tasks joined with their corresponding recipe metadata.
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
