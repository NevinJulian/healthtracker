import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

const DATE = '2024-03-01';
const EXERCISE = 'Bench Press';

async function loadDb(): Promise<{ mod: DatabaseModule; raw: SqljsExpoDb }> {
  const raw = await createSqljsDb();
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => raw,
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  const mod = require('../database') as DatabaseModule;
  await mod.initDatabase();
  return { mod, raw };
}

async function insertReversedClock(raw: SqljsExpoDb): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await raw.runAsync(
      `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at)
       VALUES (?, ?, ?, 5, 60, ?)`,
      [DATE, EXERCISE, i, `2024-03-01T10:00:0${3 - i}.000Z`]
    );
  }
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('workout set display order', () => {
  it('getWorkoutSetsForDay orders by set_index regardless of created_at', async () => {
    const { mod, raw } = await loadDb();
    await insertReversedClock(raw);
    const sets = await mod.getWorkoutSetsForDay(DATE);
    expect(sets.map((s) => s.set_index)).toEqual([0, 1, 2]);
  });

  it('getWorkoutHistory orders by set_index regardless of created_at, with and without a since date', async () => {
    const { mod, raw } = await loadDb();
    await insertReversedClock(raw);
    const all = await mod.getWorkoutHistory(EXERCISE);
    const since = await mod.getWorkoutHistory(EXERCISE, '2024-01-01');
    expect(all.map((s) => s.set_index)).toEqual([0, 1, 2]);
    expect(since.map((s) => s.set_index)).toEqual([0, 1, 2]);
  });
});
