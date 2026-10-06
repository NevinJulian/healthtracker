import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  return require('../database') as DatabaseModule;
}

const RECIPE_ID = 'r001';
const DATE = '2024-06-01';

type Raw = ReturnType<DatabaseModule['getDatabase']>;

async function addBatch(raw: Raw, portions: number, dateCooked: string): Promise<number> {
  const res = await raw.runAsync(
    'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
    [RECIPE_ID, portions, dateCooked]
  );
  return res.lastInsertRowId;
}

async function portions(raw: Raw, id: number): Promise<number> {
  const row = await raw.getFirstAsync<{ portions_available: number }>(
    'SELECT portions_available FROM meal_inventory WHERE id = ?',
    [id]
  );
  return row!.portions_available;
}

async function planRowId(raw: Raw): Promise<number> {
  const row = await raw.getFirstAsync<{ id: number }>(
    'SELECT id FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
    [DATE, 'dinner']
  );
  return row!.id;
}

async function planRowCount(raw: Raw): Promise<number> {
  const row = await raw.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM weekly_meal_plan'
  );
  return row!.count;
}

describe('removeMealFromPlan() inventory refund', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('removing a consumed row credits the debited batch back and deletes the row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const batch = await addBatch(raw, 3, '2024-01-01');
    await db.assignMealToPlan(DATE, 'dinner', RECIPE_ID);
    const id = await planRowId(raw);
    await db.toggleMealConsumed(id, true);
    expect(await portions(raw, batch)).toBe(2);

    await db.removeMealFromPlan(id);

    expect(await portions(raw, batch)).toBe(3);
    expect(await planRowCount(raw)).toBe(0);
  });

  it('removing an unconsumed row leaves inventory unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const batch = await addBatch(raw, 3, '2024-01-01');
    await db.assignMealToPlan(DATE, 'dinner', RECIPE_ID);

    await db.removeMealFromPlan(await planRowId(raw));

    expect(await portions(raw, batch)).toBe(3);
    expect(await planRowCount(raw)).toBe(0);
  });

  it('credits only the exact batch that was debited', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const older = await addBatch(raw, 1, '2024-01-01');
    const newer = await addBatch(raw, 1, '2024-02-01');
    await db.assignMealToPlan(DATE, 'dinner', RECIPE_ID);
    const id = await planRowId(raw);
    await db.toggleMealConsumed(id, true);
    expect(await portions(raw, older)).toBe(0);
    expect(await portions(raw, newer)).toBe(1);

    await db.removeMealFromPlan(id);

    expect(await portions(raw, older)).toBe(1);
    expect(await portions(raw, newer)).toBe(1);
  });

  it('a consumed row with a NULL pointer is deleted without touching inventory', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const batch = await addBatch(raw, 3, '2024-01-01');
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed, consumed_from_inventory_id) VALUES (?, ?, ?, 1, NULL)',
      [DATE, 'dinner', RECIPE_ID]
    );

    await db.removeMealFromPlan(await planRowId(raw));

    expect(await portions(raw, batch)).toBe(3);
    expect(await planRowCount(raw)).toBe(0);
  });

  it('removing a nonexistent id does not throw and changes nothing', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const batch = await addBatch(raw, 3, '2024-01-01');
    await db.assignMealToPlan(DATE, 'dinner', RECIPE_ID);

    await expect(db.removeMealFromPlan(999999)).resolves.toBeUndefined();

    expect(await portions(raw, batch)).toBe(3);
    expect(await planRowCount(raw)).toBe(1);
  });

  it('a failing DELETE rolls the credit back', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const batch = await addBatch(raw, 3, '2024-01-01');
    await db.assignMealToPlan(DATE, 'dinner', RECIPE_ID);
    const id = await planRowId(raw);
    await db.toggleMealConsumed(id, true);

    const originalRunAsync = (raw as unknown as SqljsExpoDb).runAsync.bind(raw);
    (raw as unknown as SqljsExpoDb).runAsync = (async (sql: string, params?: unknown) => {
      if (sql.includes('DELETE FROM weekly_meal_plan')) {
        throw new Error('simulated failure on delete');
      }
      return originalRunAsync(sql, params as any);
    }) as SqljsExpoDb['runAsync'];

    await expect(db.removeMealFromPlan(id)).rejects.toThrow('simulated failure on delete');

    expect(await portions(raw, batch)).toBe(2);
    expect(await planRowCount(raw)).toBe(1);
  });
});
