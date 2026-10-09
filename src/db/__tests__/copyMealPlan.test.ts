import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

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

const R1 = 'r001';
const R2 = 'r002';

interface PlanRow {
  id: number;
  date: string;
  meal_type: string;
  recipe_id: string;
  is_consumed: number;
  consumed_from_inventory_id: number | null;
}

async function rowsAt(db: DatabaseModule, date: string, mealType: string): Promise<PlanRow[]> {
  return db
    .getDatabase()
    .getAllAsync<PlanRow>('SELECT * FROM weekly_meal_plan WHERE date = ? AND meal_type = ?', [date, mealType]);
}

async function planId(db: DatabaseModule, date: string, mealType: string): Promise<number> {
  const rows = await rowsAt(db, date, mealType);
  if (rows.length !== 1) throw new Error(`expected one plan row, found ${rows.length}`);
  return rows[0].id;
}

async function planCount(db: DatabaseModule): Promise<number> {
  const row = await db.getDatabase().getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM weekly_meal_plan');
  return row?.c ?? 0;
}

describe('copyMealToDates', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('copies into empty slots, skips an occupied one and leaves it unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    await db.assignMealToPlan('2030-01-03', 'Lunch', R2);
    const occupiedBefore = (await rowsAt(db, '2030-01-03', 'Lunch'))[0];
    const sourceId = await planId(db, '2030-01-01', 'Lunch');

    const result = await db.copyMealToDates(sourceId, ['2030-01-02', '2030-01-03', '2030-01-04']);

    expect(result).toEqual({ copied: 2, skipped: 1 });
    for (const date of ['2030-01-02', '2030-01-04']) {
      const rows = await rowsAt(db, date, 'Lunch');
      expect(rows).toHaveLength(1);
      expect(rows[0].recipe_id).toBe(R1);
      expect(rows[0].is_consumed).toBe(0);
      expect(rows[0].consumed_from_inventory_id).toBeNull();
    }
    expect(await rowsAt(db, '2030-01-03', 'Lunch')).toEqual([occupiedBefore]);
  });

  it('copies a consumed source unticked and leaves inventory unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [R1, 2, '2029-12-01']
    );
    await db.assignMealToPlan('2030-01-01', 'Dinner', R1);
    const sourceId = await planId(db, '2030-01-01', 'Dinner');
    await db.toggleMealConsumed(sourceId, true);
    const inventoryBefore = await raw.getAllAsync('SELECT * FROM meal_inventory ORDER BY id');

    const result = await db.copyMealToDates(sourceId, ['2030-01-02']);

    expect(result).toEqual({ copied: 1, skipped: 0 });
    const copy = (await rowsAt(db, '2030-01-02', 'Dinner'))[0];
    expect(copy.is_consumed).toBe(0);
    expect(copy.consumed_from_inventory_id).toBeNull();
    expect(await raw.getAllAsync('SELECT * FROM meal_inventory ORDER BY id')).toEqual(inventoryBefore);
  });

  it('does not touch inventory for a recipe with no stock', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    const sourceId = await planId(db, '2030-01-01', 'Lunch');

    const result = await db.copyMealToDates(sourceId, ['2030-01-02']);

    expect(result).toEqual({ copied: 1, skipped: 0 });
    const inventory = await db.getDatabase().getAllAsync('SELECT * FROM meal_inventory');
    expect(inventory).toEqual([]);
  });

  it('ignores the source date, duplicate dates and malformed dates', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    const sourceId = await planId(db, '2030-01-01', 'Lunch');

    const result = await db.copyMealToDates(sourceId, [
      '2030-01-01',
      '2030-01-02',
      '2030-01-02',
      '2030-1-5',
      'nonsense',
      '2030-13-40',
    ]);

    expect(result).toEqual({ copied: 1, skipped: 0 });
    expect(await planCount(db)).toBe(2);
    expect(await rowsAt(db, '2030-01-02', 'Lunch')).toHaveLength(1);
  });

  it('returns nothing copied for an unknown plan id', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.copyMealToDates(9999, ['2030-01-02'])).toEqual({ copied: 0, skipped: 0 });
    expect(await planCount(db)).toBe(0);
  });

  it('fills only the same meal type of the target day', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    await db.assignMealToPlan('2030-01-02', 'Dinner', R2);
    const sourceId = await planId(db, '2030-01-01', 'Lunch');

    const result = await db.copyMealToDates(sourceId, ['2030-01-02']);

    expect(result).toEqual({ copied: 1, skipped: 0 });
    expect((await rowsAt(db, '2030-01-02', 'Dinner'))[0].recipe_id).toBe(R2);
    expect((await rowsAt(db, '2030-01-02', 'Lunch'))[0].recipe_id).toBe(R1);
  });
});

describe('copyDayToDate', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('copies Lunch into a free slot and skips an occupied Dinner, leaving it unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    await db.assignMealToPlan('2030-01-01', 'Dinner', R1);
    await db.assignMealToPlan('2030-01-02', 'Dinner', R2);
    const occupiedBefore = (await rowsAt(db, '2030-01-02', 'Dinner'))[0];

    const result = await db.copyDayToDate('2030-01-01', '2030-01-02');

    expect(result).toEqual({ copied: 1, skipped: 1 });
    const lunch = await rowsAt(db, '2030-01-02', 'Lunch');
    expect(lunch).toHaveLength(1);
    expect(lunch[0].recipe_id).toBe(R1);
    expect(lunch[0].is_consumed).toBe(0);
    expect(lunch[0].consumed_from_inventory_id).toBeNull();
    expect(await rowsAt(db, '2030-01-02', 'Dinner')).toEqual([occupiedBefore]);
  });

  it('copies consumed meals unticked and leaves inventory unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    await raw.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
      [R1, 2, '2029-12-01']
    );
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);
    await db.assignMealToPlan('2030-01-01', 'Dinner', R1);
    await db.toggleMealConsumed(await planId(db, '2030-01-01', 'Lunch'), true);
    const inventoryBefore = await raw.getAllAsync('SELECT * FROM meal_inventory ORDER BY id');

    const result = await db.copyDayToDate('2030-01-01', '2030-01-02');

    expect(result).toEqual({ copied: 2, skipped: 0 });
    for (const mealType of ['Lunch', 'Dinner']) {
      const rows = await rowsAt(db, '2030-01-02', mealType);
      expect(rows).toHaveLength(1);
      expect(rows[0].is_consumed).toBe(0);
      expect(rows[0].consumed_from_inventory_id).toBeNull();
    }
    expect(await raw.getAllAsync('SELECT * FROM meal_inventory ORDER BY id')).toEqual(inventoryBefore);
  });

  it('copies only the slots the source day has', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Dinner', R1);

    const result = await db.copyDayToDate('2030-01-01', '2030-01-02');

    expect(result).toEqual({ copied: 1, skipped: 0 });
    expect(await rowsAt(db, '2030-01-02', 'Lunch')).toHaveLength(0);
    expect(await rowsAt(db, '2030-01-02', 'Dinner')).toHaveLength(1);
  });

  it('copies nothing from an empty source day', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.copyDayToDate('2030-01-01', '2030-01-02')).toEqual({ copied: 0, skipped: 0 });
    expect(await planCount(db)).toBe(0);
  });

  it('copies nothing when the source and target are the same day', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);

    expect(await db.copyDayToDate('2030-01-01', '2030-01-01')).toEqual({ copied: 0, skipped: 0 });
    expect(await planCount(db)).toBe(1);
  });

  it('copies nothing for a malformed date', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.assignMealToPlan('2030-01-01', 'Lunch', R1);

    expect(await db.copyDayToDate('2030-01-01', 'nonsense')).toEqual({ copied: 0, skipped: 0 });
    expect(await db.copyDayToDate('2030-13-40', '2030-01-02')).toEqual({ copied: 0, skipped: 0 });
    expect(await planCount(db)).toBe(1);
  });
});
