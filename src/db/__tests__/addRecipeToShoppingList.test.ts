/**
 * Regression tests for #320: RecipeDetailScreen's handleAddToShoppingList
 * looped addShoppingListItem() once per ingredient (each an autocommitted
 * `db.runAsync`, database.ts ~1189-1195) and then made a separate call to
 * insertCookingTask() (~1438-1447). Neither callee opens a transaction, so
 * a failure partway through the loop left a half-written shopping list
 * with no matching cooking task — the screen's catch only showed an Alert,
 * there was no rollback.
 *
 * Fix: a new addRecipeToShoppingList() wraps the whole batch (all
 * shopping-list inserts + the cooking-task insert) in one
 * db.withTransactionAsync, same pattern as finishCooking().
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * toggleMealConsumedInventory.test.ts / syncRollingSchedule.test.ts.
 *
 * Issue #320
 */

import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

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

const ITEMS = [
  { name: 'Ingredient A', quantity: 1, unit: 'g' },
  { name: 'Ingredient B', quantity: 2, unit: 'g' },
  { name: 'Ingredient C', quantity: 3, unit: 'g' },
  { name: 'Ingredient D', quantity: 4, unit: 'g' },
  { name: 'Ingredient E', quantity: 5, unit: 'g' },
];

/**
 * Monkeypatches the raw adapter db's runAsync so the Nth statement matching
 * "INSERT INTO shopping_list" throws instead of running. Every other
 * statement (including the cooking_tasks insert and any BEGIN/COMMIT the
 * real withTransactionAsync issues) passes through unchanged.
 */
function failOnNthShoppingListInsert(rawDb: SqljsExpoDb, n: number): void {
  const originalRunAsync = rawDb.runAsync.bind(rawDb);
  let shoppingListInsertCount = 0;
  rawDb.runAsync = (async (sql: string, params?: unknown) => {
    if (sql.includes('INSERT INTO shopping_list')) {
      shoppingListInsertCount += 1;
      if (shoppingListInsertCount === n) {
        throw new Error('simulated failure on shopping_list insert');
      }
    }
    return originalRunAsync(sql, params as any);
  }) as SqljsExpoDb['runAsync'];
}

describe('pre-fix behaviour documented (#320)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('the old per-ingredient loop (addShoppingListItem x5 + insertCookingTask) leaves a partial shopping list and no cooking task when the 3rd insert fails', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    failOnNthShoppingListInsert(raw as unknown as SqljsExpoDb, 3);

    await expect(
      (async () => {
        for (const item of ITEMS) {
          await db.addShoppingListItem(item.name, item.quantity, item.unit);
        }
        await db.insertCookingTask(RECIPE_ID, 2);
      })()
    ).rejects.toThrow('simulated failure on shopping_list insert');

    // The bug: the first 2 inserts already autocommitted before the 3rd
    // failed and stopped the loop, so they're left behind. The cooking
    // task, which was never reached, is missing entirely.
    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(2);
    const tasks = await db.getCookingTasks();
    expect(tasks).toHaveLength(0);
  });
});

describe('addRecipeToShoppingList() (#320)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('an induced failure on the 3rd of 5 inserts leaves shopping_list and cooking_tasks exactly as before (zero new rows)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    failOnNthShoppingListInsert(raw as unknown as SqljsExpoDb, 3);

    let caught: unknown = null;
    try {
      await db.addRecipeToShoppingList(ITEMS, RECIPE_ID, 2);
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBeNull();
    expect((caught as Error).message).toContain('simulated failure on shopping_list insert');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(0);
    const tasks = await db.getCookingTasks();
    expect(tasks).toHaveLength(0);
  });

  it('success: writes 5 shopping-list rows with matching names/quantities/units plus 1 cooking-task row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.addRecipeToShoppingList(ITEMS, RECIPE_ID, 2);

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(5);
    for (const item of ITEMS) {
      const match = rows.find((r) => r.ingredient_name === item.name);
      expect(match).toBeDefined();
      expect(match?.total_quantity).toBe(item.quantity);
      expect(match?.unit).toBe(item.unit);
    }

    const tasks = await db.getCookingTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].recipe_id).toBe(RECIPE_ID);
    expect(tasks[0].servings_to_cook).toBe(2);
  });

  it('makes exactly one DB call site do the work — addShoppingListItem/insertCookingTask stay exported for other callers', () => {
    const db = loadFreshDatabaseModule();
    expect(typeof db.addRecipeToShoppingList).toBe('function');
    expect(typeof db.addShoppingListItem).toBe('function');
    expect(typeof db.insertCookingTask).toBe('function');
  });
});
