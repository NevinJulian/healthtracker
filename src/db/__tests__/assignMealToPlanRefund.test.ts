/**
 * Regression tests for #303: assignMealToPlan() overwrites an already-consumed
 * weekly_meal_plan slot without refunding the inventory it debited, and
 * without running inside a transaction. There's also no UNIQUE(date,
 * meal_type) constraint, so duplicate rows for the same slot can exist.
 *
 * Bug (pre-fix, database.ts assignMealToPlan ~1231-1248):
 *   - The UPDATE branch sets only recipe_id and is_consumed = 0. It never
 *     credits back consumed_from_inventory_id (#302's pointer), and never
 *     clears it, so a reassigned slot both silently loses a portion AND
 *     carries a stale pointer into its next tick/untick cycle.
 *   - No withTransactionAsync wrapping.
 *   - No UNIQUE(date, meal_type) index — nothing stops two rows existing for
 *     the same slot (v26 DDL only; v34 only adds a column).
 *
 * Fix:
 *   - _creditPortion(db, planRow) extracted from toggleMealConsumed's untick
 *     branch (pure refactor — #302's tests must still pass unmodified).
 *   - assignMealToPlan runs fully inside withTransactionAsync; if the
 *     existing slot row is consumed, credits it back via _creditPortion
 *     first, then clears consumed_from_inventory_id on the UPDATE.
 *   - Migration v35 dedupes any pre-existing duplicate (date, meal_type)
 *     rows (crediting losers' consumed inventory first), then adds
 *     idx_weekly_meal_plan_date_meal_type UNIQUE(date, meal_type).
 *
 * Orchestrator dedupe rule (#303): survivor is the consumed row with the
 * highest id if any row in the group is consumed, otherwise the highest id
 * overall. Losers that were themselves consumed with a recorded pointer
 * credit +1 to that batch (count-based) before being deleted.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * toggleMealConsumedInventory.test.ts (#302).
 *
 * Issue #303
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS } from '../schema';

type DatabaseModule = typeof import('../database');
type RawDb = Awaited<ReturnType<typeof createSqljsDb>>;

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

async function planRow(db: DatabaseModule, date: string, meal_type: string): Promise<any> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<any>(
    'SELECT * FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
    [date, meal_type]
  );
  if (!row) throw new Error('plan row not found');
  return row;
}

async function planRowCount(db: DatabaseModule, date: string, meal_type: string): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
    [date, meal_type]
  );
  return row?.count ?? 0;
}

async function inventoryPortions(raw: RawDb, id: number): Promise<number> {
  const row = await raw.getFirstAsync<{ portions_available: number }>(
    'SELECT portions_available FROM meal_inventory WHERE id = ?',
    [id]
  );
  if (!row) throw new Error('inventory row not found');
  return row.portions_available;
}

describe('assignMealToPlan() refund + transaction (#303)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('reassigning a consumed slot refunds the debited batch and clears the pointer', async () => {
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

    await db.assignMealToPlan('2024-06-01', 'dinner', RECIPE_ID);
    const row1 = await planRow(db, '2024-06-01', 'dinner');
    await db.toggleMealConsumed(row1.id, true); // debits the batch, records the pointer

    expect(await inventoryPortions(raw, batch!.id)).toBe(0);

    // Reassign the same slot — this is the fix under test.
    await db.assignMealToPlan('2024-06-01', 'dinner', RECIPE_ID);

    expect(await inventoryPortions(raw, batch!.id)).toBe(1); // refunded
    const row2 = await planRow(db, '2024-06-01', 'dinner');
    expect(row2.is_consumed).toBe(0);
    expect(row2.consumed_from_inventory_id).toBeNull();
  });

  it('reassigning an unconsumed slot does not touch inventory', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [RECIPE_ID, 3, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      [RECIPE_ID]
    );

    await db.assignMealToPlan('2024-06-01', 'lunch', RECIPE_ID);
    await db.assignMealToPlan('2024-06-01', 'lunch', RECIPE_ID); // reassign, never ticked

    expect(await inventoryPortions(raw, batch!.id)).toBe(3);
    expect(await planRowCount(db, '2024-06-01', 'lunch')).toBe(1);
  });

  it('two sequential assignMealToPlan calls for the same slot produce exactly one row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.assignMealToPlan('2024-06-05', 'breakfast', RECIPE_ID);
    await db.assignMealToPlan('2024-06-05', 'breakfast', RECIPE_ID);

    expect(await planRowCount(db, '2024-06-05', 'breakfast')).toBe(1);
  });
});

describe('migration v35 — dedupe weekly_meal_plan + unique index (#303)', () => {
  it('v35 is the next integer version after v34', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(Math.max(...versions)).toBe(35);
    expect(versions.filter((v) => v === 35)).toHaveLength(1);
  });

  async function migrateToV34(raw: RawDb): Promise<void> {
    await raw.execAsync(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    const upToV34 = MIGRATIONS.filter((m) => m.version <= 34);
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

  async function applyV35(raw: RawDb): Promise<void> {
    const v35 = MIGRATIONS.find((m) => m.version === 35);
    expect(v35).toBeDefined();
    await raw.execAsync(v35!.sql);
  }

  it('one consumed (with pointer) + one unconsumed duplicate: the consumed row survives with no refund', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      ['rTest', 5, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      ['rTest']
    );

    // Unconsumed, lower id.
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES ('2024-06-01', 'dinner', 'rTest', 0, NULL)"
    );
    // Consumed, higher id, points at the batch.
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-01', 'dinner', 'rTest', batch!.id]
    );

    await applyV35(raw);

    const rows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-01' AND meal_type = 'dinner'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_consumed).toBe(1);
    expect(rows[0].consumed_from_inventory_id).toBe(batch!.id);

    const invAfter = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );
    expect(invAfter?.portions_available).toBe(5); // unchanged — no refund
  });

  it('two unconsumed duplicates: MAX(id) survives', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);

    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES ('2024-06-02', 'lunch', 'rTest', 0)"
    );
    const first = await raw.getFirstAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-02' AND meal_type = 'lunch'"
    );
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES ('2024-06-02', 'lunch', 'rTest', 0)"
    );
    const second = await raw.getFirstAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-02' AND meal_type = 'lunch' AND id != ?",
      [first!.id]
    );
    expect(second!.id).toBeGreaterThan(first!.id);

    await applyV35(raw);

    const rows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-02' AND meal_type = 'lunch'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(second!.id);
  });

  it('two consumed duplicates: the higher-id row survives and the loser credits its batch', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      ['rTest', 2, '2024-01-01']
    );
    const loserBatch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      ['rTest']
    );

    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-03', 'breakfast', 'rTest', loserBatch!.id]
    );
    const loser = await raw.getFirstAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-03' AND meal_type = 'breakfast'"
    );
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES ('2024-06-03', 'breakfast', 'rTest', 1, NULL)"
    );
    const survivor = await raw.getFirstAsync<{ id: number }>(
      "SELECT id FROM weekly_meal_plan WHERE date = '2024-06-03' AND meal_type = 'breakfast' AND id != ?",
      [loser!.id]
    );
    expect(survivor!.id).toBeGreaterThan(loser!.id);

    await applyV35(raw);

    const rows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-03' AND meal_type = 'breakfast'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(survivor!.id);
    expect(rows[0].is_consumed).toBe(1);

    const invAfter = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [loserBatch!.id]
    );
    expect(invAfter?.portions_available).toBe(3); // 2 + 1 credited from the deleted loser
  });

  it('two losers pointing at the same batch both credit it (count-based)', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      ['rTest', 0, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      ['rTest']
    );

    // Three rows in the same slot: two consumed losers pointing at the same
    // batch, one consumed survivor (highest id) with no pointer of its own.
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-04', 'dinner', 'rTest', batch!.id]
    );
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-04', 'dinner', 'rTest', batch!.id]
    );
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES ('2024-06-04', 'dinner', 'rTest', 1, NULL)"
    );

    await applyV35(raw);

    const rows = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-04' AND meal_type = 'dinner'"
    );
    expect(rows).toHaveLength(1);

    const invAfter = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );
    expect(invAfter?.portions_available).toBe(2); // 0 + 1 + 1 from both losers
  });

  it('is idempotent: applying v35 a second time changes nothing', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);

    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      ['rTest', 1, '2024-01-01']
    );
    const batch = await raw.getFirstAsync<{ id: number }>(
      'SELECT id FROM meal_inventory WHERE recipe_id = ?',
      ['rTest']
    );
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, ?)',
      ['2024-06-06', 'lunch', 'rTest', batch!.id]
    );
    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES ('2024-06-06', 'lunch', 'rTest', 0, NULL)"
    );

    await applyV35(raw);
    const rowsAfterFirst = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-06' AND meal_type = 'lunch'"
    );
    const invAfterFirst = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );

    // Re-run the same SQL, as if the migration executed twice.
    await applyV35(raw);

    const rowsAfterSecond = await raw.getAllAsync<any>(
      "SELECT * FROM weekly_meal_plan WHERE date = '2024-06-06' AND meal_type = 'lunch'"
    );
    const invAfterSecond = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = ?',
      [batch!.id]
    );

    expect(rowsAfterSecond).toEqual(rowsAfterFirst);
    expect(invAfterSecond?.portions_available).toBe(invAfterFirst?.portions_available);
  });

  it('creates a unique index on (date, meal_type) that rejects a raw duplicate insert', async () => {
    const raw = await createSqljsDb();
    await migrateToV34(raw);
    await applyV35(raw);

    await raw.runAsync(
      "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES ('2024-06-07', 'dinner', 'rTest', 0)"
    );

    await expect(
      raw.runAsync(
        "INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES ('2024-06-07', 'dinner', 'rTest', 0)"
      )
    ).rejects.toThrow();
  });
});
