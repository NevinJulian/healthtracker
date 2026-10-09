import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS } from '../schema';

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

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('set_type on logged sets', () => {
  it('stores a warm-up as "warmup" and a working set as NULL', async () => {
    const { mod, raw } = await loadDb();
    await mod.logWorkoutSet(DATE, EXERCISE, { reps: 10, weightKg: 40, setType: 'warmup' });
    await mod.logWorkoutSet(DATE, EXERCISE, { reps: 5, weightKg: 80 });

    const sets = await mod.getWorkoutSetsForDay(DATE);
    expect(sets.map((s) => s.set_type)).toEqual(['warmup', null]);

    const stored = await raw.getAllAsync<{ set_type: string | null }>(
      'SELECT set_type FROM workout_set_log ORDER BY set_index'
    );
    expect(stored.map((r) => r.set_type)).toEqual(['warmup', null]);
  });

  it('returns set_type through getWorkoutHistory', async () => {
    const { mod } = await loadDb();
    await mod.logWorkoutSet(DATE, EXERCISE, { reps: 10, weightKg: 40, setType: 'warmup' });
    const history = await mod.getWorkoutHistory(EXERCISE);
    expect(history[0].set_type).toBe('warmup');
  });
});

describe('migration v39', () => {
  it('adds set_type with the exact SQL, last in the list', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1];
    expect(last.version).toBe(39);
    expect(last.sql).toBe('ALTER TABLE workout_set_log ADD COLUMN set_type TEXT;');
  });

  it('leaves a row inserted before v39 as NULL', async () => {
    const raw = await createSqljsDb();
    await raw.execAsync(
      'CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL);'
    );
    for (const m of MIGRATIONS.filter((x) => x.version <= 38)) {
      await raw.execAsync(m.sql);
    }
    await raw.runAsync(
      `INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at)
       VALUES (?, ?, 0, 5, 60, ?)`,
      [DATE, EXERCISE, '2024-03-01T10:00:00.000Z']
    );
    const v39 = MIGRATIONS.find((m) => m.version === 39);
    expect(v39).toBeDefined();
    await raw.execAsync(v39!.sql);
    const row = await raw.getFirstAsync<{ set_type: string | null }>(
      'SELECT set_type FROM workout_set_log'
    );
    expect(row).toEqual({ set_type: null });
  });
});
