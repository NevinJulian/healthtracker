/**
 * Regression tests for #302: toggleMealConsumed() debits FIFO on tick but
 * used to credit the wrong batch (or fabricate a brand-new one) on untick.
 *
 * Bug (pre-fix, database.ts ~1247-1287):
 *   - Debit (tick) is guarded by `if (inv)` and picks the oldest batch with
 *     stock (`portions_available > 0 ORDER BY date_cooked ASC`).
 *   - Credit (untick) is UNCONDITIONAL, picks the *most recently cooked*
 *     batch (`ORDER BY date_cooked DESC`, no `> 0` filter), and falls back
 *     to `INSERT ... 1` when no row exists at all.
 *   So unticking with zero stock creates inventory out of nothing, and
 *   unticking with multiple batches can credit a batch that was never
 *   debited.
 *
 * Fix (v34): weekly_meal_plan gains a nullable consumed_from_inventory_id
 * column. Tick records which batch it debited; untick credits back exactly
 * that batch (a no-op if it's gone) and never inserts. Legacy rows ticked
 * before v34 have a NULL pointer and get NO credit on untick — conservative
 * by design (see toggleMealConsumed's comment in database.ts).
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts / getDailyLogsBetween.test.ts.
 *
 * Issue #302
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS } from '../schema';

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

async function planRowId(db: DatabaseModule, date: string, meal_type: string): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ id: number }>(
    'SELECT id FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
    [date, meal_type]
  );
  if (!row) throw new Error('plan row not found');
  return row.id;
}

async function inventoryTotal(db: DatabaseModule, recipe_id: string): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(portions_available) AS total FROM meal_inventory WHERE recipe_id = ?',
    [recipe_id]
  );
  return row?.total ?? 0;
}

async function inventoryRowCount(db: DatabaseModule, recipe_id: string): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM meal_inventory WHERE recipe_id = ?',
    [recipe_id]
  );
  return row?.count ?? 0;
}

describe('toggleMealConsumed() inventory correctness (#302)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('zero stock: tick then untick leaves meal_inventory with no new rows and total 0', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.assignMealToPlan('2024-06-01', 'dinner', RECIPE_ID);
    const id = await planRowId(db, '2024-06-01', 'dinner');

    expect(await inventoryRowCount(db, RECIPE_ID)).toBe(0);

    await db.toggleMealConsumed(id, true);
    await db.toggleMealConsumed(id, false);

    expect(await inventoryRowCount(db, RECIPE_ID)).toBe(0);
    expect(await inventoryTotal(db, RECIPE_ID)).toBe(0);
  });

  it('two batches: untick credits back the exact batch it debited, not the most recent one', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    // Batch A: 1 portion, cooked long ago.
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [RECIPE_ID, 1, '2024-01-01']
    );
    const batchA = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ? AND date_cooked = ?',
      [RECIPE_ID, '2024-01-01']
    );

    await db.assignMealToPlan('2024-06-01', 'dinner', RECIPE_ID);
    const id = await planRowId(db, '2024-06-01', 'dinner');

    // Tick: debits batch A (its only stock) to 0.
    await db.toggleMealConsumed(id, true);
    const aAfterTick = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batchA!.id]
    );
    expect(aAfterTick?.portions_available).toBe(0);

    // Cook batch B via logCookedMeal(). Since A now has 0 portions,
    // logCookedMeal's own `portions_available > 0` search won't find it and
    // must create a genuinely distinct row.
    await db.logCookedMeal(RECIPE_ID, 2);
    const rowCountAfterCook = await inventoryRowCount(db, RECIPE_ID);
    expect(rowCountAfterCook).toBe(2); // A and B are distinct rows

    const batchB = await raw.getFirstAsync<{ id: number; portions_available: number }>(
      'SELECT id, portions_available FROM meal_inventory WHERE recipe_id = ? AND id != ?',
      [RECIPE_ID, batchA!.id]
    );
    expect(batchB?.portions_available).toBe(2);

    // Untick: must credit A (the batch actually debited), not B (the most
    // recently cooked batch, which is what the pre-fix `ORDER BY
    // date_cooked DESC` picked).
    await db.toggleMealConsumed(id, false);

    const aFinal = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batchA!.id]
    );
    const bFinal = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batchB!.id]
    );
    expect(aFinal?.portions_available).toBe(1);
    expect(bFinal?.portions_available).toBe(2); // unchanged
    expect(await inventoryTotal(db, RECIPE_ID)).toBe(1 + 2);
  });

  it('conserves total portions_available across an arbitrary tick/untick sequence, never exceeding what was cooked', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    const COOKED = 3;
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [RECIPE_ID, COOKED, '2024-01-01']
    );

    await db.assignMealToPlan('2024-06-01', 'dinner', RECIPE_ID);
    const id = await planRowId(db, '2024-06-01', 'dinner');

    // Deliberately includes repeated ticks/unticks (no-ops on an already-set
    // state) to exercise idempotency, not just alternation.
    const sequence = [true, false, true, true, false, false, true, false];

    for (const next of sequence) {
      await db.toggleMealConsumed(id, next);
      const total = await inventoryTotal(db, RECIPE_ID);
      expect(total).toBeLessThanOrEqual(COOKED);
      expect(total).toBeGreaterThanOrEqual(COOKED - 1); // at most one portion ever "out"
      expect(await inventoryRowCount(db, RECIPE_ID)).toBe(1); // never fabricates a row
    }
  });

  it('legacy NULL-pointer consumed row: untick gives no credit and creates no row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    // Simulate a row that was ticked before v34 shipped: is_consumed = 1,
    // consumed_from_inventory_id left NULL. Also seed unrelated stock so a
    // buggy "credit the most recent batch" implementation would have
    // something to (wrongly) credit.
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [RECIPE_ID, 2, '2024-01-01']
    );
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, NULL)',
      ['2024-06-02', 'lunch', RECIPE_ID]
    );
    const id = await planRowId(db, '2024-06-02', 'lunch');

    const totalBefore = await inventoryTotal(db, RECIPE_ID);
    const rowCountBefore = await inventoryRowCount(db, RECIPE_ID);

    await db.toggleMealConsumed(id, false);

    expect(await inventoryTotal(db, RECIPE_ID)).toBe(totalBefore); // no credit
    expect(await inventoryRowCount(db, RECIPE_ID)).toBe(rowCountBefore); // no new row

    const plan = await raw.getFirstAsync<{ is_consumed: number }>(
      'SELECT is_consumed FROM weekly_meal_plan WHERE id = ?',
      [id]
    );
    expect(plan?.is_consumed).toBe(0);
  });

  it('deleted source batch: untick is a no-op and does not throw', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [RECIPE_ID, 1, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      [RECIPE_ID]
    );

    await db.assignMealToPlan('2024-06-03', 'breakfast', RECIPE_ID);
    const id = await planRowId(db, '2024-06-03', 'breakfast');

    await db.toggleMealConsumed(id, true); // debits and records the pointer

    // The batch is deleted out from under the pointer (e.g. some other flow).
    await raw.runAsync('DELETE FROM meal_inventory WHERE id = ?', [batch!.id]);
    expect(await inventoryRowCount(db, RECIPE_ID)).toBe(0);

    await expect(db.toggleMealConsumed(id, false)).resolves.not.toThrow();

    expect(await inventoryRowCount(db, RECIPE_ID)).toBe(0); // still no rows created
    const plan = await raw.getFirstAsync<{ is_consumed: number }>(
      'SELECT is_consumed FROM weekly_meal_plan WHERE id = ?',
      [id]
    );
    expect(plan?.is_consumed).toBe(0);
  });
});

describe('migration v34 (#302)', () => {
  it('applies to a fresh DB and adds weekly_meal_plan.consumed_from_inventory_id', async () => {
    const raw = await createSqljsDb();
    await raw.execAsync(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    for (const m of MIGRATIONS) {
      await raw.execAsync(m.sql);
      await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
    }

    const cols = await raw.getAllAsync<{ name: string }>('PRAGMA table_info(weekly_meal_plan)');
    expect(cols.map((c) => c.name)).toContain('consumed_from_inventory_id');
  });

  it('applies on a DB already at v33 and preserves existing weekly_meal_plan rows', async () => {
    const raw = await createSqljsDb();
    await raw.execAsync(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    const upToV33 = MIGRATIONS.filter((m) => m.version <= 33);
    for (const m of upToV33) {
      await raw.execAsync(m.sql);
      await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
    }

    await raw.runAsync(
      `INSERT INTO recipe_library
         (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, freezerTips)
       VALUES ('rTest', 'Test Recipe', 'test', 1, 1, 1, 1, 1, 1, '[]', '[]', '')`
    );
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES ('2024-01-01', 'dinner', 'rTest', 1)"
    );

    const v34 = MIGRATIONS.find((m) => m.version === 34);
    expect(v34).toBeDefined();
    await raw.execAsync(v34!.sql);
    await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [34]);

    const rows = await raw.getAllAsync<{ is_consumed: number; consumed_from_inventory_id: number | null }>(
      'SELECT is_consumed, consumed_from_inventory_id FROM weekly_meal_plan'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_consumed).toBe(1);
    expect(rows[0].consumed_from_inventory_id).toBeNull();
  });

  it('v34 is the next integer version after v33', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(Math.max(...versions)).toBe(34);
    expect(versions.filter((v) => v === 34)).toHaveLength(1);
  });
});
