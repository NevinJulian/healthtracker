/**
 * SQLite schema definitions for the 90-Day Health Tracker.
 * Run these in order on every app launch (CREATE TABLE IF NOT EXISTS is idempotent).
 */

export const CREATE_SCHEDULE_TABLE = `
  CREATE TABLE IF NOT EXISTS schedule (
    day_number          INTEGER PRIMARY KEY,
    walking_task        TEXT    NOT NULL,
    workout_description TEXT    NOT NULL,
    target_weight       REAL,
    is_rest_day         INTEGER NOT NULL DEFAULT 0,
    is_meal_prep_day    INTEGER NOT NULL DEFAULT 0
  );
`;

export const CREATE_DAILY_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS daily_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number        INTEGER UNIQUE NOT NULL REFERENCES schedule(day_number),
    walk_completed    INTEGER NOT NULL DEFAULT 0,
    workout_completed INTEGER NOT NULL DEFAULT 0,
    fasting_completed INTEGER NOT NULL DEFAULT 0,
    logged_date       TEXT
  );
`;

export const ALL_MIGRATIONS = [
  CREATE_SCHEDULE_TABLE,
  CREATE_DAILY_LOG_TABLE,
];
