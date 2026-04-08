/**
 * SQLite schema for the 7-Day Rolling Window architecture.
 *
 * Three tables:
 *   1. app_state       — key-value store (e.g., app_start_date)
 *   2. weekly_template — 7 base rows, one per weekday (seeded below)
 *   3. daily_log       — rolling tracker, date-keyed, pruned to ±7 days
 */

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
    day_of_week     INTEGER PRIMARY KEY NOT NULL,
    walking_task    TEXT    NOT NULL,
    hammer_task     TEXT    NOT NULL,
    is_rest_day     INTEGER NOT NULL DEFAULT 0,
    is_meal_prep_day INTEGER NOT NULL DEFAULT 0
  );
`;

export const CREATE_DAILY_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS daily_log (
    date             TEXT    PRIMARY KEY NOT NULL,
    walking_task     TEXT    NOT NULL,
    hammer_task      TEXT    NOT NULL,
    walk_completed   INTEGER NOT NULL DEFAULT 0,
    hammer_completed INTEGER NOT NULL DEFAULT 0,
    fasting_completed INTEGER NOT NULL DEFAULT 0,
    is_rest_day      INTEGER NOT NULL DEFAULT 0,
    is_meal_prep_day INTEGER NOT NULL DEFAULT 0
  );
`;

// ─── Seed Data ────────────────────────────────────────────────────────────────
// INSERT OR IGNORE ensures these rows are only inserted once and are never
// overwritten by subsequent app launches. The user can edit them via the
// Template Editor screen, which uses UPDATE directly.

export const SEED_WEEKLY_TEMPLATE = `
  INSERT OR IGNORE INTO weekly_template
    (day_of_week, walking_task, hammer_task, is_rest_day, is_meal_prep_day)
  VALUES
    (
      1,
      'Office Pad (10k-15k steps)',
      'Chest Press, Lat Pulldown, Seated Row, Butterfly (3 x 8-10)',
      0, 0
    ),
    (
      2,
      'Office Pad (10k-15k steps)',
      'Smith Squats, Reverse Lunges, Leg Ext, Leg Curls (4 x 10-12)',
      0, 0
    ),
    (
      3,
      'Rest (No Walk)',
      'Cable Bicep Curls, Tricep Pushdowns, Cable Crunches (3 x 15)',
      1, 0
    ),
    (
      4,
      'Office Pad (10k-15k steps)',
      'Incline Press, Pull-ups, Upright Row, Lateral Raise (4 x 6-8)',
      0, 0
    ),
    (
      5,
      'Office Pad (10k-15k steps)',
      'Cable RDLs, Split Squats, Leg Ext, Leg Curls (3 x 15-20)',
      0, 0
    ),
    (
      6,
      'Meal Prep Weekend (No Walk)',
      'Face Pulls, Pull-throughs, Calf Raises, Core Twists (3 x 12-15)',
      0, 1
    ),
    (
      0,
      'Buochs Marina Loop (6.99 km)',
      'Light Cable Recovery & 45min Deep Stretching',
      1, 0
    );
`;

export const ALL_MIGRATIONS = [
  CREATE_APP_STATE_TABLE,
  CREATE_WEEKLY_TEMPLATE_TABLE,
  CREATE_DAILY_LOG_TABLE,
  SEED_WEEKLY_TEMPLATE,
];
