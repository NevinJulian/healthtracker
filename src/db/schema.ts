/**
 * SQLite schema for the 7-Day Rolling Window architecture.
 *
 * Three domain tables:
 *   1. app_state       — key-value store (e.g., app_start_date)
 *   2. weekly_template — 7 base rows, one per weekday (seeded below)
 *   3. daily_log       — rolling tracker, date-keyed, pruned to ±7 days
 *
 * Migration tracking:
 *   schema_version — records every applied migration version so that each
 *   statement runs exactly once, even across app updates.
 *
 * v11: ADD COLUMN exercises TEXT to weekly_template
 * v12: ADD COLUMN exercises TEXT to daily_log
 */

// ─── Exercise type (shared between DB layer and UI) ───────────────────────────

export interface Exercise {
  /** Stable per-exercise identifier — survives restarts. */
  id: string;
  name: string;
  sets: string;
  reps: string;
  /** YouTube URL; empty string if no tutorial available. */
  videoUrl: string;
  /** Per-day completion state stored in daily_log.exercises. */
  completed: boolean;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export const CREATE_SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY NOT NULL
  );
`;

export const CREATE_BIO_FORCE_LIBRARY_TABLE = `
  CREATE TABLE IF NOT EXISTS bio_force_library (
    id INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    muscle_group TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    data TEXT NOT NULL
  );
`;

export const CREATE_RECIPE_LIBRARY_TABLE = `
  CREATE TABLE IF NOT EXISTS recipe_library (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    calories INTEGER NOT NULL,
    protein INTEGER NOT NULL,
    carbs INTEGER NOT NULL,
    fat INTEGER NOT NULL,
    prepTimeMinutes INTEGER NOT NULL,
    defaultServings INTEGER NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    freezerTips TEXT
  );
`;

export const CREATE_SHOPPING_LIST_TABLE = `
  CREATE TABLE IF NOT EXISTS shopping_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_name TEXT NOT NULL,
    total_quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    is_checked INTEGER NOT NULL DEFAULT 0
  );
`;

export const CREATE_MEAL_INVENTORY_TABLE = `
  CREATE TABLE IF NOT EXISTS meal_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    portions_available INTEGER NOT NULL CHECK(portions_available >= 0),
    date_cooked TEXT NOT NULL,
    FOREIGN KEY(recipe_id) REFERENCES recipe_library(id)
  );
`;

/**
 * v27 — Cooking Tasks queue.
 * Rows are inserted when the user adds a recipe to the Shopping List,
 * and deleted (with inventory update) when they press "Finished Cooking".
 */
export const CREATE_COOKING_TASKS_TABLE = `
  CREATE TABLE IF NOT EXISTS cooking_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    servings_to_cook INTEGER NOT NULL,
    FOREIGN KEY(recipe_id) REFERENCES recipe_library(id)
  );
`;

export const CREATE_WEEKLY_MEAL_PLAN_TABLE = `
  CREATE TABLE IF NOT EXISTS weekly_meal_plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    recipe_id TEXT NOT NULL,
    is_consumed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(recipe_id) REFERENCES recipe_library(id)
  );
`;

// ─── Table DDL ────────────────────────────────────────────────────────────────

export const CREATE_APP_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

export const CREATE_WEEKLY_TEMPLATE_TABLE = `
  CREATE TABLE IF NOT EXISTS weekly_template (
    day_of_week      INTEGER PRIMARY KEY NOT NULL,
    walking_task     TEXT    NOT NULL,
    hammer_task      TEXT    NOT NULL,
    is_rest_day      INTEGER NOT NULL DEFAULT 0,
    is_meal_prep_day INTEGER NOT NULL DEFAULT 0
  );
`;

export const CREATE_DAILY_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS daily_log (
    date              TEXT    PRIMARY KEY NOT NULL,
    walking_task      TEXT    NOT NULL,
    hammer_task       TEXT    NOT NULL,
    walk_completed    INTEGER NOT NULL DEFAULT 0,
    hammer_completed  INTEGER NOT NULL DEFAULT 0,
    fasting_completed INTEGER NOT NULL DEFAULT 0,
    is_rest_day       INTEGER NOT NULL DEFAULT 0,
    is_meal_prep_day  INTEGER NOT NULL DEFAULT 0
  );
`;

// ─── Column additions (v11 / v12) ─────────────────────────────────────────────

export const ADD_EXERCISES_TO_WEEKLY_TEMPLATE = `
  ALTER TABLE weekly_template ADD COLUMN exercises TEXT NOT NULL DEFAULT '[]';
`;

export const ADD_EXERCISES_TO_DAILY_LOG = `
  ALTER TABLE daily_log ADD COLUMN exercises TEXT NOT NULL DEFAULT '[]';
`;

// ─── Column additions (v20 / v21) ─────────────────────────────────────────────

export const ADD_BODY_WEIGHT_TO_DAILY_LOG = `
  ALTER TABLE daily_log ADD COLUMN body_weight REAL;
`;

export const ADD_ADDITIONAL_WORKOUTS_TO_DAILY_LOG = `
  ALTER TABLE daily_log ADD COLUMN additional_workouts TEXT NOT NULL DEFAULT '[]';
`;

// ─── Exercise seed data ───────────────────────────────────────────────────────
// Stable IDs use deterministic short strings so they never change between
// migrations or reinstalls — the UI relies on these IDs for completion state.

/** Monday — Upper Push/Pull */
export const EXERCISES_MON: Exercise[] = [
  {
    id: 'mon-01', name: 'Chest Press', sets: '3', reps: '8-10',
    videoUrl: 'https://www.youtube.com/watch?v=cgHlQLlYffk', completed: false,
  },
  {
    id: 'mon-02', name: 'Lat Pulldown', sets: '3', reps: '8-10',
    videoUrl: 'https://www.youtube.com/watch?v=TRC5LCYi6W0', completed: false,
  },
  {
    id: 'mon-03', name: 'Seated Row', sets: '3', reps: '8-10',
    videoUrl: 'https://www.youtube.com/watch?v=qvJK5l34WsY', completed: false,
  },
  {
    id: 'mon-04', name: 'Butterfly', sets: '3', reps: '8-10',
    videoUrl: 'https://www.youtube.com/watch?v=y5Z4V_cBDoE', completed: false,
  },
];

/** Tuesday — Lower Body */
export const EXERCISES_TUE: Exercise[] = [
  {
    id: 'tue-01', name: 'Smith Squats', sets: '4', reps: '10-12',
    videoUrl: 'https://www.youtube.com/watch?v=KvpLvDF0kfA', completed: false,
  },
  {
    id: 'tue-02', name: 'Reverse Lunges', sets: '4', reps: '10-12',
    videoUrl: '', completed: false,
  },
  {
    id: 'tue-03', name: 'Leg Extension', sets: '4', reps: '10-12',
    videoUrl: 'https://www.youtube.com/watch?v=MAbThtU8Sis', completed: false,
  },
  {
    id: 'tue-04', name: 'Leg Curls', sets: '4', reps: '10-12',
    videoUrl: 'https://www.youtube.com/watch?v=MAbThtU8Sis', completed: false,
  },
];

/** Wednesday — Arms / Core (rest day) */
export const EXERCISES_WED: Exercise[] = [
  {
    id: 'wed-01', name: 'Cable Bicep Curls', sets: '3', reps: '15',
    videoUrl: 'https://www.youtube.com/watch?v=Z8CE9QVpNtM', completed: false,
  },
  {
    id: 'wed-02', name: 'Tricep Pushdowns', sets: '3', reps: '15',
    videoUrl: 'https://www.youtube.com/watch?v=Z8CE9QVpNtM', completed: false,
  },
  {
    id: 'wed-03', name: 'Cable Crunches', sets: '3', reps: '15',
    videoUrl: '', completed: false,
  },
];

/** Thursday — Upper Heavy */
export const EXERCISES_THU: Exercise[] = [
  {
    id: 'thu-01', name: 'Incline Press', sets: '4', reps: '6-8',
    videoUrl: '', completed: false,
  },
  {
    id: 'thu-02', name: 'Pull-ups', sets: '4', reps: '6-8',
    videoUrl: '', completed: false,
  },
  {
    id: 'thu-03', name: 'Upright Row', sets: '4', reps: '6-8',
    videoUrl: '', completed: false,
  },
  {
    id: 'thu-04', name: 'Lateral Raise', sets: '4', reps: '6-8',
    videoUrl: '', completed: false,
  },
];

/** Friday — Lower Volume */
export const EXERCISES_FRI: Exercise[] = [
  {
    id: 'fri-01', name: 'Cable RDLs', sets: '3', reps: '15-20',
    videoUrl: '', completed: false,
  },
  {
    id: 'fri-02', name: 'Split Squats', sets: '3', reps: '15-20',
    videoUrl: '', completed: false,
  },
  {
    id: 'fri-03', name: 'Leg Extension', sets: '3', reps: '15-20',
    videoUrl: 'https://www.youtube.com/watch?v=MAbThtU8Sis', completed: false,
  },
  {
    id: 'fri-04', name: 'Leg Curls', sets: '3', reps: '15-20',
    videoUrl: 'https://www.youtube.com/watch?v=MAbThtU8Sis', completed: false,
  },
];

/** Saturday — Accessories / Meal Prep */
export const EXERCISES_SAT: Exercise[] = [
  {
    id: 'sat-01', name: 'Face Pulls', sets: '3', reps: '12-15',
    videoUrl: '', completed: false,
  },
  {
    id: 'sat-02', name: 'Pull-throughs', sets: '3', reps: '12-15',
    videoUrl: '', completed: false,
  },
  {
    id: 'sat-03', name: 'Calf Raises', sets: '3', reps: '12-15',
    videoUrl: '', completed: false,
  },
  {
    id: 'sat-04', name: 'Core Twists', sets: '3', reps: '12-15',
    videoUrl: '', completed: false,
  },
];

/** Sunday — Recovery */
export const EXERCISES_SUN: Exercise[] = [
  {
    id: 'sun-01', name: 'Light Cable Recovery', sets: '1', reps: 'Light',
    videoUrl: '', completed: false,
  },
  {
    id: 'sun-02', name: 'Deep Stretching', sets: '1', reps: '45 min',
    videoUrl: '', completed: false,
  },
];

// ─── Seed INSERTs (individual rows — compatible with all SQLite versions) ──────

const SEED_MON = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (1, 'Office Pad (10k-15k steps)',
             'Chest Press, Lat Pulldown, Seated Row, Butterfly (3 x 8-10)',
             0, 0);
`;

const SEED_TUE = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (2, 'Office Pad (10k-15k steps)',
             'Smith Squats, Reverse Lunges, Leg Ext, Leg Curls (4 x 10-12)',
             0, 0);
`;

const SEED_WED = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (3, 'Rest (No Walk)',
             'Cable Bicep Curls, Tricep Pushdowns, Cable Crunches (3 x 15)',
             1, 0);
`;

const SEED_THU = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (4, 'Office Pad (10k-15k steps)',
             'Incline Press, Pull-ups, Upright Row, Lateral Raise (4 x 6-8)',
             0, 0);
`;

const SEED_FRI = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (5, 'Office Pad (10k-15k steps)',
             'Cable RDLs, Split Squats, Leg Ext, Leg Curls (3 x 15-20)',
             0, 0);
`;

const SEED_SAT = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (6, 'Meal Prep Weekend (No Walk)',
             'Face Pulls, Pull-throughs, Calf Raises, Core Twists (3 x 12-15)',
             0, 1);
`;

const SEED_SUN = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES (0, 'Buochs Marina Loop (6.99 km)',
             'Light Cable Recovery & 45min Deep Stretching',
             1, 0);
`;

// ─── Exercise JSON seed UPDATEs (migration v13–v19) ───────────────────────────
// Run AFTER the ALTER TABLE migrations so the column exists.
// Uses UPDATE with WHERE day_of_week so they are safe to rerun (no-op if data matches).
// These run as separate versioned migrations so they fire once on each device.

export const SEED_EXERCISES_MON = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_MON)}'
  WHERE day_of_week = 1 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_TUE = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_TUE)}'
  WHERE day_of_week = 2 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_WED = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_WED)}'
  WHERE day_of_week = 3 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_THU = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_THU)}'
  WHERE day_of_week = 4 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_FRI = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_FRI)}'
  WHERE day_of_week = 5 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_SAT = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_SAT)}'
  WHERE day_of_week = 6 AND (exercises IS NULL OR exercises = '[]');
`;

export const SEED_EXERCISES_SUN = `
  UPDATE weekly_template
  SET exercises = '${JSON.stringify(EXERCISES_SUN)}'
  WHERE day_of_week = 0 AND (exercises IS NULL OR exercises = '[]');
`;

// ─── Versioned Migration List ─────────────────────────────────────────────────

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  // v1–v3: table creation
  { version: 1,  sql: CREATE_APP_STATE_TABLE },
  { version: 2,  sql: CREATE_WEEKLY_TEMPLATE_TABLE },
  { version: 3,  sql: CREATE_DAILY_LOG_TABLE },
  // v4–v10: per-row template seeds
  { version: 4,  sql: SEED_MON },
  { version: 5,  sql: SEED_TUE },
  { version: 6,  sql: SEED_WED },
  { version: 7,  sql: SEED_THU },
  { version: 8,  sql: SEED_FRI },
  { version: 9,  sql: SEED_SAT },
  { version: 10, sql: SEED_SUN },
  // v11–v12: add exercises column
  { version: 11, sql: ADD_EXERCISES_TO_WEEKLY_TEMPLATE },
  { version: 12, sql: ADD_EXERCISES_TO_DAILY_LOG },
  // v13–v19: populate exercises JSON for each weekday
  { version: 13, sql: SEED_EXERCISES_MON },
  { version: 14, sql: SEED_EXERCISES_TUE },
  { version: 15, sql: SEED_EXERCISES_WED },
  { version: 16, sql: SEED_EXERCISES_THU },
  { version: 17, sql: SEED_EXERCISES_FRI },
  { version: 18, sql: SEED_EXERCISES_SAT },
  { version: 19, sql: SEED_EXERCISES_SUN },
  // v20–v21: add analytical columns
  { version: 20, sql: ADD_BODY_WEIGHT_TO_DAILY_LOG },
  { version: 21, sql: ADD_ADDITIONAL_WORKOUTS_TO_DAILY_LOG },
  // v22: Bio Force library initialization
  { version: 22, sql: CREATE_BIO_FORCE_LIBRARY_TABLE },
  // v23-v24: Recipe Library & Shopping List initialization
  { version: 23, sql: CREATE_RECIPE_LIBRARY_TABLE },
  { version: 24, sql: CREATE_SHOPPING_LIST_TABLE },
  // v25-v26: Meal Inventory and Weekly Meal Plan
  { version: 25, sql: CREATE_MEAL_INVENTORY_TABLE },
  { version: 26, sql: CREATE_WEEKLY_MEAL_PLAN_TABLE },
  // v27: Cooking Tasks queue
  { version: 27, sql: CREATE_COOKING_TASKS_TABLE },
];
