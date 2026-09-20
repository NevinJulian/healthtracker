/**
 * Regression tests for the silent loss of the meal refund path when a
 * pre-v34 backup is restored (#310, found by a cold review of PR #376).
 *
 * v34 (#302) added weekly_meal_plan.consumed_from_inventory_id so unticking
 * a meal credits exactly the batch it was debited from. A backup exported
 * before v34 (a v33-shaped payload) has no such key on its rows. It restores
 * perfectly happily — the live column just lands NULL — and nothing told the
 * user that every meal already marked as eaten in that backup can no longer
 * refund: _creditPortion() only credits a batch it can point at, so
 * unticking one of those meals silently returns nothing to inventory.
 *
 * restoreFromPayload() now detects the missing key on the payload itself
 * (not on the restored rows, where the column always exists) and reports
 * how many consumed rows it affects, so SettingsScreen can warn.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts.
 *
 * Issue #310
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

/** A v33-shaped weekly_meal_plan row: no consumed_from_inventory_id key. */
function legacyPlanRow(
  id: number,
  mealType: string,
  isConsumed: 0 | 1
): Record<string, unknown> {
  return {
    id,
    date: '2024-06-01',
    meal_type: mealType,
    recipe_id: RECIPE_ID,
    is_consumed: isConsumed,
  };
}

describe('restoreFromPayload() with a pre-v34 (v33-shaped) backup (#310)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('reports how many consumed meals lost their refund path', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const result = await db.restoreFromPayload({
      meal_inventory: [
        { id: 1, recipe_id: RECIPE_ID, portions_available: 4, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        legacyPlanRow(10, 'breakfast', 1),
        legacyPlanRow(11, 'lunch', 1),
        legacyPlanRow(12, 'dinner', 0),
      ],
    });

    // Two consumed rows, one unconsumed — only the consumed ones matter.
    expect(result.consumedMealsWithoutRefund).toBe(2);

    // The restore itself still succeeded in full.
    expect(result.rowsRestored).toBe(4);
  });

  it('restores those rows with a NULL pointer, so unticking really does not refund', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.restoreFromPayload({
      meal_inventory: [
        { id: 1, recipe_id: RECIPE_ID, portions_available: 4, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [legacyPlanRow(10, 'breakfast', 1)],
    });

    const raw = db.getDatabase();
    const restored = await raw.getFirstAsync<{ consumed_from_inventory_id: number | null }>(
      'SELECT consumed_from_inventory_id FROM weekly_meal_plan WHERE id = 10'
    );
    expect(restored?.consumed_from_inventory_id).toBeNull();

    // Untick it: the warning is honest, the portion does not come back.
    await db.toggleMealConsumed(10, false);
    const batch = await raw.getFirstAsync<{ portions_available: number }>(
      'SELECT portions_available FROM meal_inventory WHERE id = 1'
    );
    expect(batch?.portions_available).toBe(4);
  });

  it('does not warn for a current-schema backup that carries the column', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const result = await db.restoreFromPayload({
      meal_inventory: [
        { id: 1, recipe_id: RECIPE_ID, portions_available: 4, date_cooked: '2024-01-01' },
      ],
      weekly_meal_plan: [
        {
          id: 10,
          date: '2024-06-01',
          meal_type: 'breakfast',
          recipe_id: RECIPE_ID,
          is_consumed: 1,
          consumed_from_inventory_id: 1,
        },
      ],
    });

    expect(result.consumedMealsWithoutRefund).toBeUndefined();
  });

  it('does not warn when a legacy backup has no consumed meals at all', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const result = await db.restoreFromPayload({
      weekly_meal_plan: [legacyPlanRow(10, 'breakfast', 0), legacyPlanRow(11, 'lunch', 0)],
    });

    expect(result.consumedMealsWithoutRefund).toBeUndefined();
  });
});
