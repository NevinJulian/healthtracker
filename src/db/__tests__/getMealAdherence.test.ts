/**
 * #307 — getMealAdherence(days) has no upper date bound.
 *
 * getMealAdherence() queries `weekly_meal_plan WHERE date >= cutoffISO` with
 * no ceiling, so future planned-but-not-yet-consumed meals (rows the app
 * plans ahead of time) count as "planned" without any chance of having been
 * consumed yet — dragging the adherence ratio down for reasons that have
 * nothing to do with the user's actual behaviour. The sole consumer is
 * Analytics' "Plan adherence" bar.
 *
 * Fix: bound the query with `AND date <= ?` (today), so only past/today
 * rows are counted. Today's still-unconsumed meals continue to count.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * assignMealToPlanRefund.test.ts (#303) / toggleMealConsumedInventory.test.ts
 * (#302). RECIPE_ID 'r001' is seeded by seedRecipeLibrary() during
 * initDatabase(), same as those tests.
 *
 * Issue #307
 */

import { addDays, todayKey } from '../../utils/dates';
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

describe('getMealAdherence() (#307)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('excludes future planned meals from both planned and consumed counts', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    const pastDates = [addDays(today, -2), addDays(today, -1)];
    const futureDates = [addDays(today, 1), addDays(today, 2)];

    // Two past meals, both consumed. v35's UNIQUE(date, meal_type) means one
    // row per date/meal slot, so each date uses the same meal_type ('dinner').
    for (const date of pastDates) {
      await db.assignMealToPlan(date, 'dinner', RECIPE_ID);
      const row = await db
        .getDatabase()
        .getFirstAsync<{ id: number }>(
          'SELECT id FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
          [date, 'dinner']
        );
      await db.toggleMealConsumed(row!.id, true);
    }

    // Two future meals, planned but (necessarily) not yet consumed.
    for (const date of futureDates) {
      await db.assignMealToPlan(date, 'dinner', RECIPE_ID);
    }

    const summary = await db.getMealAdherence(30);

    expect(summary.planned).toBe(2);
    expect(summary.consumed).toBe(2);
    expect(summary.adherenceRatio).toBe(1);
  });
});
