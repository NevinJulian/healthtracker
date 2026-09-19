/**
 * Regression tests for #314: runMigrations() (database.ts ~227-242) used to
 * run a migration's SQL via a bare `db.execAsync(migration.sql)` and then
 * record it as applied via a SEPARATE `db.runAsync('INSERT INTO
 * schema_version …')` — no transaction around the pair. A process kill
 * between the two calls left the schema/data mutated but unrecorded, so the
 * next launch re-applies the same migration:
 *
 *   - For an ALTER TABLE ADD COLUMN migration (v11, v12, v20, v21, v31, v34)
 *     the column already exists, so the re-run throws "duplicate column
 *     name" forever, and initDatabase() rethrows into App.tsx's dead-end
 *     error screen.
 *   - For v35 (credit meal_inventory → delete duplicate weekly_meal_plan
 *     rows → create unique index), a kill after the credit UPDATE but before
 *     schema_version is recorded means the credit runs AGAIN on the next
 *     launch — double-crediting inventory that was never actually consumed
 *     twice (the #303 blocker: reproduced by #303's tester on lane A).
 *
 * Fix: each migration now runs inside its OWN `db.withTransactionAsync()` —
 * not one transaction around the whole loop, so migrations that already
 * committed on a previous run stay committed even if a later one fails.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * assignMealToPlanRefund.test.ts / toggleMealConsumedInventory.test.ts.
 *
 * Issue #314
 */

import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS as REAL_MIGRATIONS } from '../schema';

type DatabaseModule = typeof import('../database');

/**
 * initDatabase()'s failure path calls `db.closeAsync()` to clean up. That
 * would free the underlying sql.js Database, but these tests need to
 * inspect state (or "relaunch" against the exact same instance) after a
 * simulated kill — exactly like a real device, whose on-disk SQLite file
 * survives a crash untouched. So closeAsync is neutered on the copy of the
 * adapter handed to `openDatabaseAsync`; the real underlying sql.js
 * Database (captured in `raw`'s closures) is never actually freed.
 */
function keepAlive(raw: SqljsExpoDb): SqljsExpoDb {
  return { ...raw, closeAsync: async () => {} };
}

/**
 * Loads a fresh copy of database.ts wired to `raw` via a mocked
 * expo-sqlite, optionally with `../schema`'s exports overridden (used only
 * by the throwing-migration case below). Mirrors the
 * resetModules+doMock+require pattern from assignMealToPlanRefund.test.ts.
 */
function loadFreshDatabaseModule(
  raw: SqljsExpoDb,
  schemaOverride?: Record<string, unknown>
): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => raw,
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  if (schemaOverride) {
    jest.doMock('../schema', () => ({
      ...jest.requireActual('../schema'),
      ...schemaOverride,
    }));
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
  jest.dontMock('../schema');
});

describe('runMigrations atomicity (#314)', () => {
  it('a fresh install runs every real migration (v1→v35) to completion via the real runner', async () => {
    const raw = keepAlive(await createSqljsDb());
    const db = loadFreshDatabaseModule(raw);

    await db.initDatabase();

    const recorded = await raw.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version'
    );
    const recordedVersions = recorded.map((r) => r.version).sort((a, b) => a - b);
    const expectedVersions = REAL_MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    expect(recordedVersions).toEqual(expectedVersions);
  });

  it('running the real migration runner again on an already-migrated DB is a no-op', async () => {
    const raw = keepAlive(await createSqljsDb());

    const db1 = loadFreshDatabaseModule(raw);
    await db1.initDatabase();

    const before = await raw.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version'
    );

    const db2 = loadFreshDatabaseModule(raw);
    await expect(db2.initDatabase()).resolves.toBeDefined();

    const after = await raw.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version'
    );
    expect(after).toEqual(before);
  });

  it('a migration whose SQL throws partway leaves no schema_version row for it, rolls back its own schema change, and keeps earlier migrations applied', async () => {
    const raw = keepAlive(await createSqljsDb());

    // Appended after the real list so v1..v35 all commit first, exactly as
    // "migrations before it stay applied" requires.
    const throwingVersion = Math.max(...REAL_MIGRATIONS.map((m) => m.version)) + 1;
    const THROWING_SQL = `
      ALTER TABLE daily_log ADD COLUMN _atomicity_probe TEXT;
      SELECT * FROM this_table_does_not_exist;
    `;

    const db = loadFreshDatabaseModule(raw, {
      MIGRATIONS: [...REAL_MIGRATIONS, { version: throwingVersion, sql: THROWING_SQL }],
    });

    await expect(db.initDatabase()).rejects.toThrow();

    // The failing migration's own DDL must be rolled back...
    const cols = await raw.getAllAsync<{ name: string }>('PRAGMA table_info(daily_log)');
    expect(cols.map((c) => c.name)).not.toContain('_atomicity_probe');

    // ...and must not be recorded as applied...
    const recorded = await raw.getAllAsync<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version'
    );
    const recordedVersions = recorded.map((r) => r.version);
    expect(recordedVersions).not.toContain(throwingVersion);

    // ...while every real migration that ran before it committed for good.
    for (const m of REAL_MIGRATIONS) {
      expect(recordedVersions).toContain(m.version);
    }
  });
});

describe('v35 kill-safety (#303 blocker)', () => {
  async function migrateToV34(raw: SqljsExpoDb): Promise<void> {
    await raw.execAsync(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    const upToV34 = REAL_MIGRATIONS.filter((m) => m.version <= 34);
    for (const m of upToV34) {
      await raw.execAsync(m.sql);
      await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
    }
    await raw.runAsync(
      `INSERT INTO recipe_library
         (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, freezerTips)
       VALUES ('rTest', 'Test Recipe', 'test', 1, 1, 1, 1, 1, 1, '[]', '[]', '')`
    );
  }

  it('kills after v35\'s credit UPDATE (before schema_version is recorded), rolls the credit back, then relaunching applies v35 exactly once', async () => {
    const raw = keepAlive(await createSqljsDb());
    await migrateToV34(raw);

    // A v34 device with a duplicate (date, meal_type) slot: a consumed loser
    // pointing at a batch that's already down to 0 portions (it was the
    // loser's own tick that drained it).
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      ['rTest', 0, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      ['rTest']
    );
    expect(batch).not.toBeNull();

    // Loser: consumed, points at the drained batch.
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-10', 'dinner', 'rTest', batch!.id]
    );
    // Survivor: higher id, also consumed, no pointer of its own.
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES ('2024-06-10', 'dinner', 'rTest', 1, NULL)"
    );

    const v35 = REAL_MIGRATIONS.find((m) => m.version === 35);
    expect(v35).toBeDefined();

    // Wrap execAsync so that, for v35's SQL specifically, only its FIRST
    // statement (the credit UPDATE) runs before it "crashes" — simulating a
    // kill between the credit and the (never-reached) schema_version write.
    let v35ExecCount = 0;
    const killingRaw: SqljsExpoDb = {
      ...raw,
      execAsync: async (sql: string) => {
        if (sql === v35!.sql) {
          v35ExecCount++;
          if (v35ExecCount === 1) {
            const creditStatementOnly = sql.split(';')[0] + ';';
            await raw.execAsync(creditStatementOnly);
            throw new Error('simulated kill after v35 credit UPDATE');
          }
        }
        return raw.execAsync(sql);
      },
      closeAsync: async () => {},
    };

    const dbKill = loadFreshDatabaseModule(killingRaw);
    await expect(dbKill.initDatabase()).rejects.toThrow();

    // Rolled back to 0 — not left credited at 1 with no record of the kill.
    const afterKill = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );
    expect(afterKill?.portions_available).toBe(0);

    const sv35AfterKill = await raw.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_version WHERE version = 35'
    );
    expect(sv35AfterKill).toBeNull();

    // The dedupe DELETE never ran either — both duplicate rows still there.
    const rowsAfterKill = await raw.getAllAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-10' AND meal_type = 'dinner'"
    );
    expect(rowsAfterKill).toHaveLength(2);

    // "Relaunch": reset JS modules, SAME sql.js instance, real execAsync.
    const dbRelaunch = loadFreshDatabaseModule(raw);
    await expect(dbRelaunch.initDatabase()).resolves.toBeDefined();

    const afterRelaunch = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );
    // Credited exactly once — NOT double-credited to 2 by the re-run.
    expect(afterRelaunch?.portions_available).toBe(1);

    const sv35AfterRelaunch = await raw.getFirstAsync<{ version: number }>(
      'SELECT version FROM schema_version WHERE version = 35'
    );
    expect(sv35AfterRelaunch).not.toBeNull();

    const rowsAfterRelaunch = await raw.getAllAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-10' AND meal_type = 'dinner'"
    );
    expect(rowsAfterRelaunch).toHaveLength(1); // deduped once v35 completed
  });
});
