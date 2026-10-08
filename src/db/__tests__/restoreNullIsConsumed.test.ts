/**
 * A hand-edited or third-party backup can carry a NULL (or no) is_consumed on
 * a weekly_meal_plan row. The column is NOT NULL DEFAULT 0, so a NULL used to
 * abort the whole restore. It is now read as "not eaten".
 *
 * Same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyRefundWarning.test.ts.
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
  return require('../database') as DatabaseModule;
}

const RECIPE_ID = 'r001'; // seeded by seedRecipeLibrary()
const SCHEMA_VERSION = 38;

function planRow(isConsumed?: unknown): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 10,
    date: '2024-06-01',
    meal_type: 'breakfast',
    recipe_id: RECIPE_ID,
  };
  if (isConsumed !== undefined) row.is_consumed = isConsumed;
  return row;
}

async function restoredIsConsumed(db: DatabaseModule): Promise<unknown> {
  const row = await db
    .getDatabase()
    .getFirstAsync<{ is_consumed: unknown }>('SELECT is_consumed FROM weekly_meal_plan WHERE id = 10');
  return row?.is_consumed;
}

describe('restoreFromPayload() with an odd weekly_meal_plan.is_consumed', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('restores a NULL as 0 and still restores the rest of the payload', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await expect(
      db.restoreFromPayload(
        {
          weekly_meal_plan: [planRow(null)],
          daily_log: [{ date: '2024-06-01', walking_task: 'Walk', hammer_task: 'Hammer' }],
        },
        SCHEMA_VERSION
      )
    ).resolves.toBeDefined();

    expect(await restoredIsConsumed(db)).toBe(0);
    const log = await db
      .getDatabase()
      .getFirstAsync<{ date: string }>("SELECT date FROM daily_log WHERE date = '2024-06-01'");
    expect(log?.date).toBe('2024-06-01');
  });

  it('restores a missing key as 0', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.restoreFromPayload({ weekly_meal_plan: [planRow()] }, SCHEMA_VERSION);

    expect(await restoredIsConsumed(db)).toBe(0);
  });

  it.each([0, 1])('restores %i unchanged', async (value) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.restoreFromPayload({ weekly_meal_plan: [planRow(value)] }, SCHEMA_VERSION);

    expect(await restoredIsConsumed(db)).toBe(value);
  });

  it('restores a non-numeric value unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.restoreFromPayload({ weekly_meal_plan: [planRow('yes')] }, SCHEMA_VERSION);

    expect(await restoredIsConsumed(db)).toBe('yes');
  });
});
