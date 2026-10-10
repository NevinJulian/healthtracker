import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

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

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('getLastSetForExercise', () => {
  it('returns the latest earlier day, not an older one', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-01', EXERCISE, { reps: 5, weightKg: 70 });
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 8, weightKg: 80 });
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set).toMatchObject({ date: '2024-03-05', reps: 8, weight_kg: 80 });
  });

  it('ignores today and later rows', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 8, weightKg: 80 });
    await mod.logWorkoutSet('2024-03-10', EXERCISE, { reps: 3, weightKg: 100 });
    await mod.logWorkoutSet('2024-03-11', EXERCISE, { reps: 3, weightKg: 110 });
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set?.date).toBe('2024-03-05');
  });

  it('returns the highest set_index of the day', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 10, weightKg: 60 });
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 8, weightKg: 70 });
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 6, weightKg: 75 });
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set).toMatchObject({ set_index: 2, reps: 6, weight_kg: 75 });
  });

  it('skips warm-ups on the same day', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 8, weightKg: 80 });
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 10, weightKg: 40, setType: 'warmup' });
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set).toMatchObject({ reps: 8, weight_kg: 80 });
  });

  it('falls through a warm-up-only day to the older working day', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-01', EXERCISE, { reps: 5, weightKg: 70 });
    await mod.logWorkoutSet('2024-03-05', EXERCISE, { reps: 10, weightKg: 40, setType: 'warmup' });
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set).toMatchObject({ date: '2024-03-01', reps: 5, weight_kg: 70 });
  });

  it('counts an unknown set_type as a working set', async () => {
    const { mod, raw } = await loadDb();
    await raw.runAsync(
      `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at, set_type)
       VALUES (?, ?, 0, 4, 90, ?, ?)`,
      ['2024-03-05', EXERCISE, '2024-03-05T10:00:00.000Z', 'dropset']
    );
    const set = await mod.getLastSetForExercise(EXERCISE, '2024-03-10');
    expect(set).toMatchObject({ reps: 4, weight_kg: 90 });
  });

  it('ignores other exercises and matches the name exactly', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet('2024-03-05', 'Squat', { reps: 8, weightKg: 100 });
    await mod.logWorkoutSet('2024-03-05', 'bench press', { reps: 8, weightKg: 50 });
    expect(await mod.getLastSetForExercise(EXERCISE, '2024-03-10')).toBeNull();
  });

  it('returns null with no history', async () => {
    const { mod } = await loadDb();
    expect(await mod.getLastSetForExercise(EXERCISE, '2024-03-10')).toBeNull();
  });
});
