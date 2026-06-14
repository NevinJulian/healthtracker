/**
 * Real-database integration tests using sql.js (pure JS/WASM SQLite).
 *
 * These tests use sql.js DIRECTLY - NOT expo-sqlite - so the existing
 * expo-sqlite mock (jest.config.js moduleNameMapper) is completely bypassed
 * and all regular unit-test suites are left untouched.
 *
 * Coverage:
 *   a. Apply every migration in MIGRATIONS to a fresh in-memory DB and assert
 *      all SQL executes without error. Verify the final schema contains the
 *      expected tables and columns, including recent additions that have never
 *      previously run in tests: daily_log.water_ml (v31), body_measurements
 *      (v32), and workout_set_log (v33).
 *   b. Backup/restore round-trip: seed representative rows, dump all user
 *      tables, then inside a transaction DELETE + reinsert every row (skipping
 *      schema_version), and assert data integrity.
 *
 * sql.js init: initSqlJs is async; we use Jest beforeAll.
 * locateFile resolves the .wasm from node_modules so it works in both CI
 * (ubuntu) and local (Windows) without path guessing.
 *
 * Issue #292
 */

import path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { MIGRATIONS } from '../schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns list of user table names (excluding sqlite_% internals). */
function listTables(db: Database): string[] {
  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  if (res.length === 0) return [];
  return (res[0].values as [string][]).map(([name]) => name);
}

/** Returns list of column names for a given table. */
function listColumns(db: Database, table: string): string[] {
  const res = db.exec(`PRAGMA table_info(${table})`);
  if (res.length === 0) return [];
  const nameIdx = res[0].columns.indexOf('name');
  return (res[0].values as string[][]).map((row) => row[nameIdx]);
}

/** SELECT all rows from a table as plain objects. */
function selectAll(db: Database, table: string): Record<string, unknown>[] {
  const res = db.exec(`SELECT * FROM ${table}`);
  if (res.length === 0) return [];
  const { columns, values } = res[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(
        path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),
        file
      ),
  });
}, 30_000);

// ---------------------------------------------------------------------------
// a. Migration correctness
// ---------------------------------------------------------------------------

describe('MIGRATIONS array shape', () => {
  it('has no duplicate versions', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    const unique = new Set(versions);
    expect(unique.size).toBe(versions.length);
  });

  it('versions are strictly increasing', () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBeGreaterThan(MIGRATIONS[i - 1].version);
    }
  });

  it('starts at version 1', () => {
    expect(MIGRATIONS[0].version).toBe(1);
  });
});

describe('All migrations apply to a fresh in-memory DB without error', () => {
  let db: Database;

  beforeAll(() => {
    db = new SQL.Database();
    db.run(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
  });

  afterAll(() => {
    db.close();
  });

  it('applies every migration SQL and records the version', () => {
    for (const migration of MIGRATIONS) {
      expect(() => {
        db.run(migration.sql);
        db.run(
          'INSERT OR IGNORE INTO schema_version (version) VALUES (?)',
          [migration.version]
        );
      }).not.toThrow();
    }
  });

  const EXPECTED_TABLES = [
    'schema_version',
    'app_state',
    'weekly_template',
    'daily_log',
    'bio_force_library',
    'recipe_library',
    'shopping_list',
    'meal_inventory',
    'weekly_meal_plan',
    'cooking_tasks',
    'off_cache',
    'cook_log',
    'body_measurements',
    'workout_set_log',
  ];

  it.each(EXPECTED_TABLES)('table "%s" exists after all migrations', (tbl) => {
    expect(listTables(db)).toContain(tbl);
  });

  it('daily_log has water_ml column (v31)', () => {
    expect(listColumns(db, 'daily_log')).toContain('water_ml');
  });

  it('body_measurements has all expected columns (v32)', () => {
    const cols = listColumns(db, 'body_measurements');
    for (const c of ['id', 'date', 'waist_cm', 'chest_cm', 'hips_cm', 'thigh_cm', 'arm_cm']) {
      expect(cols).toContain(c);
    }
  });

  it('workout_set_log has all expected columns (v33)', () => {
    const cols = listColumns(db, 'workout_set_log');
    for (const c of ['id', 'date', 'exercise', 'set_index', 'reps', 'weight_kg', 'created_at']) {
      expect(cols).toContain(c);
    }
  });

  it('daily_log has all core columns', () => {
    const cols = listColumns(db, 'daily_log');
    for (const c of [
      'date', 'walking_task', 'hammer_task',
      'walk_completed', 'hammer_completed', 'fasting_completed',
      'is_rest_day', 'is_meal_prep_day',
      'exercises', 'body_weight', 'additional_workouts', 'water_ml',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('schema_version records every migration version', () => {
    const res = db.exec('SELECT version FROM schema_version ORDER BY version');
    const recorded = res.length > 0
      ? (res[0].values as [number][]).map(([v]) => v)
      : [];
    for (const m of MIGRATIONS) {
      expect(recorded).toContain(m.version);
    }
  });
});

// ---------------------------------------------------------------------------
// b. Backup/restore round-trip
// ---------------------------------------------------------------------------

describe('Backup/restore round-trip (mirrors exportBackup/restoreFromPayload approach)', () => {
  let db: Database;

  beforeAll(() => {
    db = new SQL.Database();
    db.run(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    for (const migration of MIGRATIONS) {
      db.run(migration.sql);
      db.run('INSERT OR IGNORE INTO schema_version (version) VALUES (?)', [migration.version]);
    }

    db.run(
      `INSERT INTO daily_log
        (date, walking_task, hammer_task, walk_completed, hammer_completed,
         fasting_completed, is_rest_day, is_meal_prep_day, exercises,
         body_weight, additional_workouts, water_ml)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['2024-03-15', 'Walk 10k', 'Bench 3x8', 1, 0, 1, 0, 0, '[]', 82.5, '[]', 2400]
    );

    db.run(
      `INSERT INTO body_measurements (date, waist_cm, chest_cm, hips_cm, thigh_cm, arm_cm)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['2024-03-15', 82.0, 100.0, 95.0, 56.0, 35.0]
    );

    db.run(
      `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['2024-03-15', 'Bench Press', 0, 8, 80.0, '2024-03-15T08:00:00Z']
    );

    db.run(
      'INSERT OR IGNORE INTO app_state (key, value) VALUES (?, ?)',
      ['app_start_date', '2024-01-01']
    );
  });

  afterAll(() => {
    db.close();
  });

  it('seeded rows are readable before restore', () => {
    const logRows = selectAll(db, 'daily_log');
    expect(logRows).toHaveLength(1);
    expect(logRows[0]['date']).toBe('2024-03-15');
    expect(logRows[0]['water_ml']).toBe(2400);
    expect(logRows[0]['body_weight']).toBe(82.5);

    const measRows = selectAll(db, 'body_measurements');
    expect(measRows).toHaveLength(1);
    expect(measRows[0]['waist_cm']).toBe(82.0);

    const setRows = selectAll(db, 'workout_set_log');
    expect(setRows).toHaveLength(1);
    expect(setRows[0]['exercise']).toBe('Bench Press');
    expect(setRows[0]['weight_kg']).toBe(80.0);
  });

  it('round-trips all user data intact and leaves schema_version untouched', () => {
    const svBefore = selectAll(db, 'schema_version');
    expect(svBefore.length).toBeGreaterThan(0);

    // Dump all user tables (mirrors exportBackup approach)
    const allTables = listTables(db);
    const userTables = allTables.filter((t) => t !== 'schema_version');
    const dump: Record<string, Record<string, unknown>[]> = {};
    for (const tbl of userTables) {
      dump[tbl] = selectAll(db, tbl);
    }

    // Restore: DELETE + reinsert inside a transaction, skipping schema_version
    db.run('BEGIN');
    try {
      for (const tbl of userTables) {
        db.run(`DELETE FROM ${tbl}`);
        for (const row of dump[tbl]) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const cols = keys.join(', ');
          const placeholders = keys.map(() => '?').join(', ');
          const values = keys.map((k) => row[k] as (string | number | null));
          db.run(`INSERT INTO ${tbl} (${cols}) VALUES (${placeholders})`, values);
        }
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }

    const logRows = selectAll(db, 'daily_log');
    expect(logRows).toHaveLength(1);
    expect(logRows[0]['date']).toBe('2024-03-15');
    expect(logRows[0]['water_ml']).toBe(2400);
    expect(logRows[0]['body_weight']).toBe(82.5);
    expect(logRows[0]['walk_completed']).toBe(1);

    const measRows = selectAll(db, 'body_measurements');
    expect(measRows).toHaveLength(1);
    expect(measRows[0]['waist_cm']).toBe(82.0);
    expect(measRows[0]['chest_cm']).toBe(100.0);

    const setRows = selectAll(db, 'workout_set_log');
    expect(setRows).toHaveLength(1);
    expect(setRows[0]['exercise']).toBe('Bench Press');
    expect(setRows[0]['reps']).toBe(8);
    expect(setRows[0]['weight_kg']).toBe(80.0);

    const appState = selectAll(db, 'app_state');
    const startDate = appState.find((r) => r['key'] === 'app_start_date');
    expect(startDate?.['value']).toBe('2024-01-01');

    // schema_version must be completely untouched
    const svAfter = selectAll(db, 'schema_version');
    expect(svAfter).toEqual(svBefore);
  });
});
