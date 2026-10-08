/**
 * Restoring a backup with several weekly_meal_plan rows in one
 * (date, meal_type) slot keeps one row per slot and credits the batch of every
 * consumed loser that still points at a live inventory batch.
 *
 * Survivor per slot: a consumed row with a live inventory pointer, else the
 * highest-id consumed row, else the highest-id row (highest id wins ties).
 *
 * Same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts.
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
const DAY = '2024-06-01';

const BATCHES = [
  { id: 1, recipe_id: RECIPE_ID, portions_available: 2, date_cooked: '2024-05-01' },
  { id: 2, recipe_id: RECIPE_ID, portions_available: 5, date_cooked: '2024-05-02' },
  { id: 3, recipe_id: RECIPE_ID, portions_available: 0, date_cooked: '2024-05-03' },
];

interface PlanRow {
  id: number;
  meal: string;
  consumed: 0 | 1;
  pointer: number | null;
  date?: string;
}

interface Case {
  name: string;
  plan: PlanRow[];
  survivors: number[];
  portions: [number, number, number];
}

const CASES: Case[] = [
  {
    name: 'a consumed row with a live pointer beats a higher-id consumed row without one',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 1, pointer: 1 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: null },
      { id: 12, meal: 'breakfast', consumed: 0, pointer: null },
    ],
    survivors: [10],
    portions: [2, 5, 0],
  },
  {
    name: 'the highest-id consumed row with a live pointer wins and the other consumed loser credits its batch',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 1, pointer: 1 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: 2 },
    ],
    survivors: [11],
    portions: [3, 5, 0],
  },
  {
    name: 'a dangling pointer falls back to the highest-id consumed row and credits nothing',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 1, pointer: 99 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: null },
      { id: 12, meal: 'breakfast', consumed: 0, pointer: null },
    ],
    survivors: [11],
    portions: [2, 5, 0],
  },
  {
    name: 'with no consumed row the highest id survives and nothing is credited',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 0, pointer: null },
      { id: 11, meal: 'breakfast', consumed: 0, pointer: 1 },
      { id: 12, meal: 'breakfast', consumed: 0, pointer: null },
    ],
    survivors: [12],
    portions: [2, 5, 0],
  },
  {
    name: 'every consumed loser credits its own batch',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 1, pointer: 1 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: 1 },
      { id: 12, meal: 'breakfast', consumed: 1, pointer: 2 },
    ],
    survivors: [12],
    portions: [4, 5, 0],
  },
  {
    name: 'an unconsumed loser credits nothing even when it still has a pointer',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 0, pointer: 1 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: 2 },
    ],
    survivors: [11],
    portions: [2, 5, 0],
  },
  {
    name: 'two slots are deduplicated independently in one restore',
    plan: [
      { id: 10, meal: 'breakfast', consumed: 1, pointer: 1 },
      { id: 11, meal: 'breakfast', consumed: 1, pointer: 2 },
      { id: 12, meal: 'lunch', consumed: 1, pointer: 3 },
      { id: 13, meal: 'lunch', consumed: 1, pointer: 2 },
      { id: 14, meal: 'dinner', consumed: 0, pointer: null },
      { id: 15, meal: 'breakfast', consumed: 0, pointer: null, date: '2024-06-02' },
    ],
    survivors: [11, 13, 14, 15],
    portions: [3, 5, 1],
  },
  {
    name: 'an empty plan table leaves the inventory alone',
    plan: [],
    survivors: [],
    portions: [2, 5, 0],
  },
];

describe('restoreFromPayload() slot dedupe', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it.each(CASES)('$name', async ({ plan, survivors, portions }) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.restoreFromPayload(
      {
        meal_inventory: BATCHES,
        weekly_meal_plan: plan.map((r) => ({
          id: r.id,
          date: r.date ?? DAY,
          meal_type: r.meal,
          recipe_id: RECIPE_ID,
          is_consumed: r.consumed,
          consumed_from_inventory_id: r.pointer,
        })),
      },
      SCHEMA_VERSION
    );

    const raw = db.getDatabase();
    const plans = await raw.getAllAsync<{ id: number }>('SELECT id FROM weekly_meal_plan ORDER BY id');
    expect(plans.map((p) => p.id)).toEqual(survivors);

    const batches = await raw.getAllAsync<{ id: number; portions_available: number }>(
      'SELECT id, portions_available FROM meal_inventory ORDER BY id'
    );
    expect(batches.map((b) => b.portions_available)).toEqual(portions);
  });
});
