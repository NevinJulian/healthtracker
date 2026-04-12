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
 */

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Created first, before anything else, so the migration runner can track
 * which statements have already been applied.
 */
export const CREATE_SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY NOT NULL
  );
`;

// ─── Table DDL ────────────────────────────────────────────────────────────────

export const CREATE_APP_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

/**
 * day_of_week follows JavaScript's Date.getDay():
 *   0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday,
 *   4 = Thursday, 5 = Friday, 6 = Saturday
 */
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

// ─── Seed Data ────────────────────────────────────────────────────────────────
// Each weekday gets its own INSERT OR IGNORE statement (one row per statement).
// This is compatible with every SQLite version, including those bundled by
// older Android API levels that do not support multi-row VALUES clauses.
// INSERT OR IGNORE ensures rows are inserted only once and are never
// overwritten — the Template Editor uses UPDATE to modify them later.

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

// ─── Versioned Migration List ─────────────────────────────────────────────────
// Each entry runs exactly once per device, tracked by `schema_version`.
// To add future schema changes (e.g. ALTER TABLE) append a new entry with the
// next version number — never edit or reorder existing entries.

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: CREATE_APP_STATE_TABLE },
  { version: 2, sql: CREATE_WEEKLY_TEMPLATE_TABLE },
  { version: 3, sql: CREATE_DAILY_LOG_TABLE },
  { version: 4, sql: SEED_MON },
  { version: 5, sql: SEED_TUE },
  { version: 6, sql: SEED_WED },
  { version: 7, sql: SEED_THU },
  { version: 8, sql: SEED_FRI },
  { version: 9, sql: SEED_SAT },
  { version: 10, sql: SEED_SUN },
];
