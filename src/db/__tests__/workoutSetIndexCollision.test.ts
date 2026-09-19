/**
 * Regression tests for #317: `workout_set_log.set_index` had no UNIQUE
 * constraint (v33), and its only writer — DashboardScreen's `handleLogSet`,
 * the single call site of `logWorkoutSet` (database.ts) — computed the new
 * row's `set_index` client-side as `existingSets.length`, where
 * `existingSets` came from whatever `getWorkoutSetsForDay` last returned.
 * Deleting a middle set shortens that array, so the next logged set's
 * `set_index` recomputes to a value a surviving row already has:
 *
 *   sets = [0, 1, 2]           (existingSets.length === 3)
 *   delete set_index=1          -> sets = [0, 2]
 *   log a new set                -> setIndex = existingSets.length === 2
 *                                    -> COLLIDES with the surviving set_index=2 row
 *
 * `getWorkoutSetsForDay`/`getWorkoutHistory` also ordered by `set_index ASC`
 * (a value with no uniqueness guarantee), so read order wasn't even stable
 * across collisions.
 *
 * Fix:
 *   - `logWorkoutSet(date, exercise, { reps, weightKg })` no longer takes a
 *     caller-supplied `setIndex`. It assigns one atomically via a single
 *     INSERT…SELECT that computes `COALESCE(MAX(set_index), -1) + 1` for the
 *     (date, exercise) pair inside the same statement — no separate
 *     read-then-write that a delete could race.
 *   - `getWorkoutSetsForDay`/`getWorkoutHistory` now order by
 *     `created_at ASC, id ASC` (after the grouping column) — `set_index`
 *     becomes a uniqueness key, not an ordering key.
 *   - v37 (schema.ts) renumbers every existing row densely per
 *     (date, exercise), ordered by (created_at, id), then adds
 *     `UNIQUE(date, exercise, set_index)` so the database itself rejects any
 *     future collision.
 *   - `restoreFromPayload` (database.ts) generalises the #303 v35
 *     post-restore-migration pattern into `POST_RESTORE_MIGRATION_VERSIONS =
 *     [35, 37]`: both unique indexes are dropped before the restore loop (so
 *     a legacy backup with colliding/gapped workout_set_log rows can be
 *     inserted at all) and both migrations' own SQL is re-run, in order,
 *     after the loop, inside the same transaction.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts / migrationAtomicity.test.ts.
 *
 * Issue #317
 */

import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS as REAL_MIGRATIONS } from '../schema';
import { bestSetPerDay } from '../../screens/analyticsHelpers';
import type { WorkoutSet } from '../database';

type DatabaseModule = typeof import('../database');

/** Fresh in-memory DB per call — used by tests that don't need to inspect
 * or reuse the same underlying sql.js instance across "relaunches". */
function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

/**
 * initDatabase()'s failure path calls db.closeAsync() to clean up. These
 * tests need the underlying sql.js Database to survive a simulated crash
 * (like a real on-disk file would), so closeAsync is neutered on the copy
 * handed to openDatabaseAsync — mirrors migrationAtomicity.test.ts's
 * keepAlive().
 */
function keepAlive(raw: SqljsExpoDb): SqljsExpoDb {
  return { ...raw, closeAsync: async () => {} };
}

/** Loads database.ts wired to a specific (already-created) raw db, so
 * multiple loadFreshDatabaseModuleWithRaw() calls against the same `raw`
 * simulate relaunching the app against the same on-disk database. */
function loadFreshDatabaseModuleWithRaw(raw: SqljsExpoDb): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => raw,
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

/** Applies every real migration up to and including v36 directly against
 * `raw`, bypassing v37 — mirrors migrationAtomicity.test.ts's
 * migrateToV34(). Lets a test seed pre-v37 collision/gap data that could
 * never be inserted once v37's unique index exists. */
async function migrateToV36(raw: SqljsExpoDb): Promise<void> {
  await raw.execAsync(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
  );
  const upToV36 = REAL_MIGRATIONS.filter((m) => m.version <= 36);
  for (const m of upToV36) {
    await raw.execAsync(m.sql);
    await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
  }
}

const RECIPE_ID = 'r001'; // seeded by seedRecipeLibrary()

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('logWorkoutSet() atomic set_index assignment (#317)', () => {
  it('deletes a middle set, logs a new one, and never collides on (date, exercise, set_index)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const date = '2024-07-01';
    const exercise = 'Bench Press';

    await db.logWorkoutSet(date, exercise, { reps: 5, weightKg: 60 });
    await db.logWorkoutSet(date, exercise, { reps: 5, weightKg: 62.5 });
    await db.logWorkoutSet(date, exercise, { reps: 5, weightKg: 65 });

    let sets = await db.getWorkoutSetsForDay(date);
    expect(sets.map((s) => s.set_index)).toEqual([0, 1, 2]);

    // Delete the middle set (set_index 1) — the old bug's trigger.
    const middle = sets.find((s) => s.set_index === 1)!;
    await db.deleteWorkoutSet(middle.id);

    // Log a new set. Pre-fix, DashboardScreen (and the old logWorkoutSet
    // signature) would recompute setIndex from the now-shorter array
    // (length 2) and collide with the surviving set_index=2 row.
    await db.logWorkoutSet(date, exercise, { reps: 5, weightKg: 67.5 });

    sets = await db.getWorkoutSetsForDay(date);
    const setIndexes = sets.map((s) => s.set_index);
    expect(new Set(setIndexes).size).toBe(setIndexes.length); // no duplicates
    expect(setIndexes).toEqual([0, 2, 3]);
  });

  it('getWorkoutSetsForDay returns the same order on repeated reads', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const date = '2024-07-02';
    await db.logWorkoutSet(date, 'Squat', { reps: 5, weightKg: 80 });
    await db.logWorkoutSet(date, 'Squat', { reps: 5, weightKg: 82.5 });
    await db.logWorkoutSet(date, 'Deadlift', { reps: 3, weightKg: 100 });

    const first = await db.getWorkoutSetsForDay(date);
    const second = await db.getWorkoutSetsForDay(date);
    expect(second).toEqual(first);
  });
});

describe('v37 migration (#317): deterministic renumber + unique index', () => {
  it('renumbers colliding and gapped set_index values by (date, exercise) partition, ordered by (created_at, id), and only creates the unique index after the renumber succeeds', async () => {
    const raw = keepAlive(await createSqljsDb());
    await migrateToV36(raw);

    // Inserted directly (bypassing logWorkoutSet) so this can create
    // collisions and gaps that could never happen through the app itself
    // once v37's unique index exists — exactly the legacy data v37 has to
    // clean up on upgrade.
    const rows: Array<{
      date: string;
      exercise: string;
      set_index: number;
      reps: number;
      weight_kg: number;
      created_at: string;
    }> = [
      { date: '2024-07-10', exercise: 'Row', set_index: 0, reps: 8, weight_kg: 40, created_at: '2024-07-10T10:00:00.000Z' },
      { date: '2024-07-10', exercise: 'Row', set_index: 0, reps: 8, weight_kg: 42, created_at: '2024-07-10T10:05:00.000Z' }, // collision
      { date: '2024-07-10', exercise: 'Row', set_index: 5, reps: 8, weight_kg: 44, created_at: '2024-07-10T10:10:00.000Z' }, // gap
      { date: '2024-07-10', exercise: 'Press', set_index: 2, reps: 5, weight_kg: 20, created_at: '2024-07-10T09:00:00.000Z' }, // separate partition
    ];
    for (const r of rows) {
      await raw.runAsync(
        `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [r.date, r.exercise, r.set_index, r.reps, r.weight_kg, r.created_at]
      );
    }

    // Relaunch: schema_version stops at 36, so this run applies v37 for
    // real — including creating a UNIQUE index over data that, before the
    // renumber, has a literal duplicate (date, exercise, set_index). If the
    // index were created BEFORE the renumber, this would throw a UNIQUE
    // constraint violation instead of resolving.
    const db = loadFreshDatabaseModuleWithRaw(raw);
    await expect(db.initDatabase()).resolves.toBeDefined();

    const rowCreationOrder = await raw.getAllAsync<{ id: number }>(
      "SELECT id FROM workout_set_log WHERE date = '2024-07-10' AND exercise = 'Row' ORDER BY created_at ASC, id ASC"
    );
    const renumbered = await raw.getAllAsync<{ id: number; set_index: number }>(
      "SELECT id, set_index FROM workout_set_log WHERE date = '2024-07-10' AND exercise = 'Row' ORDER BY set_index ASC"
    );
    expect(renumbered.map((r) => r.set_index)).toEqual([0, 1, 2]);
    expect(renumbered.map((r) => r.id)).toEqual(rowCreationOrder.map((r) => r.id));

    const press = await raw.getAllAsync<{ set_index: number }>(
      "SELECT set_index FROM workout_set_log WHERE date = '2024-07-10' AND exercise = 'Press'"
    );
    expect(press).toEqual([{ set_index: 0 }]); // renumbered independently, own partition

    const indexRow = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workout_set_log_date_exercise_set_index'"
    );
    expect(indexRow).not.toBeNull();
  });

  it("re-running v37's SQL on an already-migrated, gap-free DB is a no-op", async () => {
    const raw = keepAlive(await createSqljsDb());
    const db = loadFreshDatabaseModuleWithRaw(raw);
    await db.initDatabase(); // fresh install: every migration, including v37, applied cleanly

    const date = '2024-07-11';
    await db.logWorkoutSet(date, 'Curl', { reps: 10, weightKg: 15 });
    await db.logWorkoutSet(date, 'Curl', { reps: 10, weightKg: 17.5 });

    const before = await raw.getAllAsync<{ id: number; set_index: number }>(
      'SELECT id, set_index FROM workout_set_log ORDER BY id ASC'
    );

    const v37 = REAL_MIGRATIONS.find((m) => m.version === 37);
    expect(v37).toBeDefined();
    await expect(raw.execAsync(v37!.sql)).resolves.toBeUndefined();

    const after = await raw.getAllAsync<{ id: number; set_index: number }>(
      'SELECT id, set_index FROM workout_set_log ORDER BY id ASC'
    );
    expect(after).toEqual(before);

    const countRow = await raw.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name = 'idx_workout_set_log_date_exercise_set_index'"
    );
    expect(countRow?.c).toBe(1);
  });
});

describe('v37 kill-safety (#317, migrationAtomicity.test.ts pattern)', () => {
  it("kills v37 after the renumber UPDATE (before the unique index is created and schema_version is recorded), rolls the renumber back, then relaunching applies v37 exactly once", async () => {
    const raw = keepAlive(await createSqljsDb());
    await migrateToV36(raw);

    const rows: Array<{
      date: string;
      exercise: string;
      set_index: number;
      reps: number;
      weight_kg: number;
      created_at: string;
    }> = [
      { date: '2024-07-20', exercise: 'Lunge', set_index: 0, reps: 10, weight_kg: 20, created_at: '2024-07-20T10:00:00.000Z' },
      { date: '2024-07-20', exercise: 'Lunge', set_index: 0, reps: 10, weight_kg: 22, created_at: '2024-07-20T10:05:00.000Z' }, // collision
      { date: '2024-07-20', exercise: 'Lunge', set_index: 5, reps: 10, weight_kg: 24, created_at: '2024-07-20T10:10:00.000Z' }, // gap
    ];
    for (const r of rows) {
      await raw.runAsync(
        `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [r.date, r.exercise, r.set_index, r.reps, r.weight_kg, r.created_at]
      );
    }

    const v37 = REAL_MIGRATIONS.find((m) => m.version === 37);
    expect(v37).toBeDefined();

    // Wrap execAsync so that, for v37's SQL specifically, only its FIRST
    // statement (the renumber UPDATE) runs before it "crashes" —
    // simulating a kill between the renumber and the (never-reached)
    // CREATE UNIQUE INDEX + schema_version write.
    let v37ExecCount = 0;
    const killingRaw: SqljsExpoDb = {
      ...raw,
      execAsync: async (sql: string) => {
        if (sql === v37!.sql) {
          v37ExecCount++;
          if (v37ExecCount === 1) {
            const updateStatementOnly = sql.split(';')[0] + ';';
            await raw.execAsync(updateStatementOnly);
            throw new Error('simulated kill after v37 renumber UPDATE');
          }
        }
        return raw.execAsync(sql);
      },
      closeAsync: async () => {},
    };

    const dbKill = loadFreshDatabaseModuleWithRaw(killingRaw);
    await expect(dbKill.initDatabase()).rejects.toThrow();

    // Rolled back: no schema_version row for v37, no index, and the table
    // is back to its pre-migration colliding/gapped state — because the
    // renumber UPDATE and the CREATE UNIQUE INDEX are the same migration's
    // SQL, run inside runMigrations()'s single per-migration transaction.
    const sv37AfterKill = await raw.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_version WHERE version = 37'
    );
    expect(sv37AfterKill).toBeNull();

    const stillColliding = await raw.getAllAsync<{ set_index: number }>(
      "SELECT set_index FROM workout_set_log WHERE date = '2024-07-20' AND exercise = 'Lunge' ORDER BY id ASC"
    );
    expect(stillColliding.map((r) => r.set_index)).toEqual([0, 0, 5]);

    const indexAfterKill = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workout_set_log_date_exercise_set_index'"
    );
    expect(indexAfterKill).toBeNull();

    // "Relaunch": reset JS modules, SAME sql.js instance, real execAsync.
    const dbRelaunch = loadFreshDatabaseModuleWithRaw(raw);
    await expect(dbRelaunch.initDatabase()).resolves.toBeDefined();

    const renumberedAfterRelaunch = await raw.getAllAsync<{ set_index: number }>(
      "SELECT set_index FROM workout_set_log WHERE date = '2024-07-20' AND exercise = 'Lunge' ORDER BY set_index ASC"
    );
    expect(renumberedAfterRelaunch.map((r) => r.set_index)).toEqual([0, 1, 2]);

    const sv37AfterRelaunch = await raw.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_version WHERE version = 37'
    );
    expect(sv37AfterRelaunch).not.toBeNull();
  });
});

describe('restoreFromPayload() with colliding/gapped workout_set_log rows (#317)', () => {
  it('restores a payload with colliding and gapped set_index values: succeeds, other tables restore, rows are renumbered, and the unique index exists afterwards', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      workout_set_log: [
        { id: 1, date: '2024-08-01', exercise: 'Bench', set_index: 0, reps: 5, weight_kg: 60, created_at: '2024-08-01T10:00:00.000Z' },
        { id: 2, date: '2024-08-01', exercise: 'Bench', set_index: 0, reps: 5, weight_kg: 62.5, created_at: '2024-08-01T10:05:00.000Z' }, // collision
        { id: 3, date: '2024-08-01', exercise: 'Bench', set_index: 9, reps: 5, weight_kg: 65, created_at: '2024-08-01T10:10:00.000Z' }, // gap
      ],
      app_state: [{ key: 'app_start_date', value: '2024-01-01' }],
    };

    // Pre-fix, workout_set_log has no unique index at all, so this restore
    // would succeed trivially WITHOUT renumbering — the assertions below on
    // the renumbered set_index values and the index's existence are what
    // catch that.
    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    const rows = await raw.getAllAsync<{ id: number; set_index: number }>(
      "SELECT id, set_index FROM workout_set_log WHERE date = '2024-08-01' AND exercise = 'Bench' ORDER BY set_index ASC"
    );
    expect(rows.map((r) => r.set_index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]); // renumbered by (created_at, id)

    const appState = await raw.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_state WHERE key = 'app_start_date'"
    );
    expect(appState?.value).toBe('2024-01-01'); // other tables did restore

    const indexRow = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workout_set_log_date_exercise_set_index'"
    );
    expect(indexRow).not.toBeNull();
  });

  it('restores a payload with BOTH legacy weekly_meal_plan duplicates (#303) and workout_set_log collisions (#317) in one transaction: both post-restore migrations run in order, and both unique indexes exist afterwards', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      meal_inventory: [
        { id: 1, recipe_id: RECIPE_ID, portions_available: 5, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        { id: 10, date: '2024-06-01', meal_type: 'dinner', recipe_id: RECIPE_ID, is_consumed: 0, consumed_from_inventory_id: null },
        { id: 11, date: '2024-06-01', meal_type: 'dinner', recipe_id: RECIPE_ID, is_consumed: 1, consumed_from_inventory_id: 1 },
      ],
      workout_set_log: [
        { id: 20, date: '2024-08-02', exercise: 'Row', set_index: 3, reps: 8, weight_kg: 40, created_at: '2024-08-02T09:00:00.000Z' },
        { id: 21, date: '2024-08-02', exercise: 'Row', set_index: 3, reps: 8, weight_kg: 41, created_at: '2024-08-02T09:05:00.000Z' },
      ],
    };

    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    const planRows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-01' AND meal_type = 'dinner'"
    );
    expect(planRows).toHaveLength(1);

    const setRows = await raw.getAllAsync<{ set_index: number }>(
      "SELECT set_index FROM workout_set_log WHERE date = '2024-08-02' AND exercise = 'Row' ORDER BY set_index ASC"
    );
    expect(setRows.map((r) => r.set_index)).toEqual([0, 1]);

    const idx35 = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_weekly_meal_plan_date_meal_type'"
    );
    const idx37 = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_workout_set_log_date_exercise_set_index'"
    );
    expect(idx35).not.toBeNull();
    expect(idx37).not.toBeNull();
  });
});

describe('bestSetPerDay() is unaffected by set_index gaps (#317 pinning test)', () => {
  it('picks the best set per day by weight_kg/reps regardless of gaps in the underlying set_index values', () => {
    // WorkoutSetSlice (analyticsHelpers.ts) never carries set_index at all —
    // this fixture uses full WorkoutSet rows (a structural superset) with
    // deliberately gapped set_index to pin that bestSetPerDay's output
    // depends only on date/weight_kg/reps, never on set_index.
    const history: WorkoutSet[] = [
      { id: 1, date: '2024-09-01', exercise: 'Bench', set_index: 0, reps: 5, weight_kg: 60, created_at: '2024-09-01T10:00:00.000Z' },
      { id: 2, date: '2024-09-01', exercise: 'Bench', set_index: 7, reps: 5, weight_kg: 65, created_at: '2024-09-01T10:05:00.000Z' },
      { id: 3, date: '2024-09-02', exercise: 'Bench', set_index: 2, reps: 8, weight_kg: 50, created_at: '2024-09-02T10:00:00.000Z' },
    ];

    const result = bestSetPerDay(history);
    expect(result.map((r) => ({ date: r.date, weight_kg: r.weight_kg, reps: r.reps }))).toEqual([
      { date: '2024-09-01', weight_kg: 65, reps: 5 },
      { date: '2024-09-02', weight_kg: 50, reps: 8 },
    ]);
  });
});
