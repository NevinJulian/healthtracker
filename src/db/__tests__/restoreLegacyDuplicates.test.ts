/**
 * Regression tests for the #303 restore regression found by security review
 * (round trip 2): before v35 shipped, assignMealToPlan() could leave
 * duplicate (date, meal_type) rows in weekly_meal_plan, so a real user's
 * JSON backup made on an older app version can legitimately contain them.
 * validatePayload() accepts any backup at or below the current schema
 * version, so restoring such a backup is a supported path, not a
 * theoretical one.
 *
 * Bug (pre-fix, restoreFromPayload, database.ts ~1976-2015): restore does a
 * plain per-table DELETE + INSERT loop inside one withTransactionAsync. Once
 * v35's idx_weekly_meal_plan_date_meal_type unique index exists (which it
 * always does on any device running this app version, since runMigrations()
 * applies it at startup), the second INSERT of a duplicate (date,
 * meal_type) pair throws a UNIQUE constraint error — and because the WHOLE
 * restore is one transaction, EVERY table rolls back, not just
 * weekly_meal_plan. An otherwise perfectly valid backup becomes completely
 * unrestorable, worst on a new/wiped device where the backup is the only
 * copy of the user's data.
 *
 * Fix: restoreFromPayload() now (1) drops the unique index before the
 * restore loop, (2) restores every table exactly as before, then (3) —
 * still inside the same transaction — re-runs v35's own SQL (looked up at
 * runtime via `MIGRATIONS.find(m => m.version === 35)!.sql`, never copied
 * or reimplemented) against the just-restored data. That credits any
 * consumed loser's batch in the just-restored meal_inventory, deletes the
 * losers per the exact same survivor rule the migration uses, and recreates
 * the unique index. A clean, already-deduped (post-v35) backup is
 * unaffected: nothing matches the credit or delete WHERE clauses, and the
 * index is simply recreated.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * assignMealToPlanRefund.test.ts.
 *
 * Issue #303
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

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

const RECIPE_ID = 'r001'; // seeded by seedRecipeLibrary()

async function uniqueIndexExists(db: DatabaseModule): Promise<boolean> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_weekly_meal_plan_date_meal_type'"
  );
  return row != null;
}

describe('restoreFromPayload() with pre-v35 duplicate weekly_meal_plan rows (#303)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('restores a legacy backup with one consumed + one unconsumed duplicate slot: succeeds, other tables restore, survivor keeps its consumption with no refund, index exists', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      meal_inventory: [
        { id: 1, recipe_id: RECIPE_ID, portions_available: 5, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        // Unconsumed, lower id.
        { id: 10, date: '2024-06-01', meal_type: 'dinner', recipe_id: RECIPE_ID, is_consumed: 0, consumed_from_inventory_id: null },
        // Consumed, higher id, points at the batch above.
        { id: 11, date: '2024-06-01', meal_type: 'dinner', recipe_id: RECIPE_ID, is_consumed: 1, consumed_from_inventory_id: 1 },
      ],
      app_state: [{ key: 'app_start_date', value: '2024-01-01' }],
    };

    // Pre-fix, this throws (UNIQUE constraint violation on the second
    // weekly_meal_plan row) and the whole transaction — including app_state
    // — rolls back. That must not happen.
    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    const planRows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-01' AND meal_type = 'dinner'"
    );
    expect(planRows).toHaveLength(1);
    expect(planRows[0].id).toBe(11); // the consumed row survives
    expect(planRows[0].is_consumed).toBe(1);
    expect(planRows[0].consumed_from_inventory_id).toBe(1); // unchanged — no refund

    const inv = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = 1'
    );
    expect(inv?.portions_available).toBe(5); // unchanged — the loser was never consumed

    const appState = await raw.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_state WHERE key = 'app_start_date'"
    );
    expect(appState?.value).toBe('2024-01-01'); // other tables did restore

    expect(await uniqueIndexExists(db)).toBe(true);
  });

  it('restores a legacy backup with two CONSUMED duplicate rows: the loser is deleted and its batch is credited +1, matching v35', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      meal_inventory: [
        { id: 2, recipe_id: RECIPE_ID, portions_available: 2, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        // Loser: consumed, lower id, points at the batch.
        { id: 20, date: '2024-06-03', meal_type: 'breakfast', recipe_id: RECIPE_ID, is_consumed: 1, consumed_from_inventory_id: 2 },
        // Survivor: consumed, higher id, no pointer of its own.
        { id: 21, date: '2024-06-03', meal_type: 'breakfast', recipe_id: RECIPE_ID, is_consumed: 1, consumed_from_inventory_id: null },
      ],
    };

    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    const planRows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-03' AND meal_type = 'breakfast'"
    );
    expect(planRows).toHaveLength(1);
    expect(planRows[0].id).toBe(21);
    expect(planRows[0].is_consumed).toBe(1);

    const inv = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = 2'
    );
    expect(inv?.portions_available).toBe(3); // 2 + 1 credited back from the deleted loser

    expect(await uniqueIndexExists(db)).toBe(true);
  });

  it('restores a clean post-v35 backup (no duplicates) exactly as before, and the index exists afterwards', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      meal_inventory: [
        { id: 3, recipe_id: RECIPE_ID, portions_available: 1, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        { id: 30, date: '2024-06-05', meal_type: 'lunch', recipe_id: RECIPE_ID, is_consumed: 1, consumed_from_inventory_id: 3 },
      ],
    };

    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    const planRows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-05' AND meal_type = 'lunch'"
    );
    expect(planRows).toHaveLength(1);
    expect(planRows[0].id).toBe(30);
    expect(planRows[0].is_consumed).toBe(1);
    expect(planRows[0].consumed_from_inventory_id).toBe(3); // untouched — it's the sole row

    const inv = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = 3'
    );
    expect(inv?.portions_available).toBe(1); // unchanged — nothing to credit

    expect(await uniqueIndexExists(db)).toBe(true);
  });
});
