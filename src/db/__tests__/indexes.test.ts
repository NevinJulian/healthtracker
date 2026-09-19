/**
 * Regression tests for #331: `workout_set_log` and `meal_inventory` had no
 * indexes across 35 migrations, so the following real callers in
 * database.ts did a full table scan on every read — and `workout_set_log`
 * grows without bound (one row per logged set, forever):
 *
 *   - getWorkoutSetsForDay: SELECT * FROM workout_set_log WHERE date = ?
 *   - getWorkoutHistory:    SELECT * FROM workout_set_log
 *                           WHERE exercise = ? AND date >= ? ORDER BY date
 *   - logCookedMeal / toggleMealConsumed / the inventory upsert:
 *                           SELECT * FROM meal_inventory
 *                           WHERE recipe_id = ? AND portions_available > 0
 *
 * v36 (schema.ts) appends three plain, non-unique indexes for exactly these
 * access patterns. `daily_log.date` is the PRIMARY KEY already, so it needs
 * no index. Deliberately NOT added (see schema.ts's comment above v36):
 * `weekly_meal_plan(date)` — v35's UNIQUE (date, meal_type) index already
 * serves date-prefix scans — and `cook_log(recipe_id)` — no query filters
 * on it.
 *
 * Uses the same sql.js real-database approach as migrations.integration.test.ts
 * so `EXPLAIN QUERY PLAN` reflects actual SQLite planner behaviour, not a
 * mock. This suite must fail at 8baa245 (pre-v36): the index-name and
 * EXPLAIN QUERY PLAN assertions below show `SCAN workout_set_log` /
 * `SCAN meal_inventory` before this migration exists.
 *
 * Issue #331
 */

import path from 'path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { MIGRATIONS } from '../schema';

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

/** Builds a fresh in-memory DB with every migration applied, in order. */
function buildMigratedDb(): Database {
  const db = new SQL.Database();
  db.run(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
  );
  for (const migration of MIGRATIONS) {
    db.run(migration.sql);
    db.run('INSERT OR IGNORE INTO schema_version (version) VALUES (?)', [migration.version]);
  }
  return db;
}

/** Returns the `detail` column of every EXPLAIN QUERY PLAN row, joined. */
function planDetail(db: Database, sql: string): string {
  const res = db.exec(`EXPLAIN QUERY PLAN ${sql}`);
  expect(res.length).toBeGreaterThan(0);
  const detailIdx = res[0].columns.indexOf('detail');
  return (res[0].values as unknown[][]).map((row) => String(row[detailIdx])).join(' | ');
}

function usesIndex(detail: string, indexName: string): boolean {
  return (
    detail.includes(`USING INDEX ${indexName}`) ||
    detail.includes(`USING COVERING INDEX ${indexName}`)
  );
}

describe('v36 indexes (#331)', () => {
  let db: Database;

  beforeAll(() => {
    db = buildMigratedDb();
  });

  afterAll(() => {
    db.close();
  });

  // Orchestrator correction: no version-snapshot assertion (the #303
  // lesson) — #317 will append v37 later and must not break this test.
  // Assert append-safe invariants instead.
  it('v36 exists exactly once and immediately follows v35', () => {
    const v35Entries = MIGRATIONS.filter((m) => m.version === 35);
    const v36Entries = MIGRATIONS.filter((m) => m.version === 36);
    expect(v35Entries).toHaveLength(1);
    expect(v36Entries).toHaveLength(1);
    expect(v36Entries[0].version).toBe(v35Entries[0].version + 1);
  });

  it('sqlite_master has all three v36 index names after all migrations', () => {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'index'");
    const names = (res[0].values as [string][]).map(([n]) => n);
    expect(names).toContain('idx_workout_set_log_date');
    expect(names).toContain('idx_workout_set_log_exercise_date');
    expect(names).toContain('idx_meal_inventory_recipe');
  });

  it("getWorkoutSetsForDay's query (WHERE date = ?) uses idx_workout_set_log_date", () => {
    const detail = planDetail(
      db,
      `SELECT * FROM workout_set_log WHERE date = '2024-01-01'
       ORDER BY exercise ASC, set_index ASC`
    );
    expect(usesIndex(detail, 'idx_workout_set_log_date')).toBe(true);
  });

  it("getWorkoutHistory's query (WHERE exercise = ? AND date >= ? ORDER BY date) uses idx_workout_set_log_exercise_date", () => {
    const detail = planDetail(
      db,
      `SELECT * FROM workout_set_log WHERE exercise = 'Bench Press' AND date >= '2024-01-01'
       ORDER BY date ASC, set_index ASC`
    );
    expect(usesIndex(detail, 'idx_workout_set_log_exercise_date')).toBe(true);
  });

  it("the meal_inventory active-stock query (WHERE recipe_id = ? AND portions_available > 0) uses idx_meal_inventory_recipe", () => {
    const detail = planDetail(
      db,
      "SELECT * FROM meal_inventory WHERE recipe_id = 'rTest' AND portions_available > 0"
    );
    expect(usesIndex(detail, 'idx_meal_inventory_recipe')).toBe(true);
  });

  it("re-running v36's SQL is a no-op", () => {
    const v36 = MIGRATIONS.find((m) => m.version === 36)!;
    expect(() => db.run(v36.sql)).not.toThrow();

    const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'index'");
    const names = (res[0].values as [string][]).map(([n]) => n);
    const countOf = (n: string) => names.filter((x) => x === n).length;
    expect(countOf('idx_workout_set_log_date')).toBe(1);
    expect(countOf('idx_workout_set_log_exercise_date')).toBe(1);
    expect(countOf('idx_meal_inventory_recipe')).toBe(1);
  });
});
