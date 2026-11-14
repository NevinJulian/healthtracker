import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type BackupModule = typeof import('../../services/backup');
type SqljsDb = Awaited<ReturnType<typeof createSqljsDb>>;

const APPLIED_KEY = 'adaptiveTdeeAppliedOn';

function loadFresh(failOnParam?: { current: string | null }): {
  db: DatabaseModule;
  backup: BackupModule;
} {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => {
      const raw: SqljsDb = await createSqljsDb();
      const realRun = raw.runAsync.bind(raw);
      raw.runAsync = (async (sql: string, params?: unknown) => {
        if (
          failOnParam?.current &&
          Array.isArray(params) &&
          params.includes(failOnParam.current)
        ) {
          throw new Error('disk full');
        }
        return realRun(sql, params as never);
      }) as typeof raw.runAsync;
      return raw;
    },
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  return {
    db: require('../database') as DatabaseModule,
    backup: require('../../services/backup') as BackupModule,
  };
}

describe('adaptive TDEE apply', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('reads null when nothing was applied', async () => {
    const { db } = loadFresh();
    await db.initDatabase();
    expect(await db.getAdaptiveTdeeAppliedOn()).toBeNull();
  });

  it.each(['yesterday', '2024-6-3', '2024-06-03T10:00', ''])(
    'reads null for the malformed value %p',
    async (value) => {
      const { db } = loadFresh();
      await db.initDatabase();
      await db.setSetting(APPLIED_KEY, value);
      expect(await db.getAdaptiveTdeeAppliedOn()).toBeNull();
    }
  );

  it('writes the calorie goal and the apply date and leaves protein alone', async () => {
    const { db } = loadFresh();
    await db.initDatabase();
    await db.setNutritionGoals(2000, 140);

    await db.applyAdaptiveCalorieGoal(2150, '2024-06-30');

    expect(await db.getNutritionGoals()).toEqual({ calories: 2150, protein: 140 });
    expect(await db.getAdaptiveTdeeAppliedOn()).toBe('2024-06-30');
  });

  it('commits neither the goal nor the date when the second write fails, and the queue keeps working', async () => {
    const fail = { current: null as string | null };
    const { db } = loadFresh(fail);
    await db.initDatabase();
    await db.setNutritionGoals(2000, 140);

    fail.current = APPLIED_KEY;
    await expect(db.applyAdaptiveCalorieGoal(2150, '2024-06-30')).rejects.toThrow('disk full');
    fail.current = null;

    expect(await db.getNutritionGoals()).toEqual({ calories: 2000, protein: 140 });
    expect(await db.getAdaptiveTdeeAppliedOn()).toBeNull();

    await db.applyAdaptiveCalorieGoal(2100, '2024-07-01');
    expect(await db.getNutritionGoals()).toEqual({ calories: 2100, protein: 140 });
  });

  it.each([
    ['NaN', NaN, '2024-06-30'],
    ['Infinity', Infinity, '2024-06-30'],
    ['a fraction', 2150.5, '2024-06-30'],
    ['below 1000', 999, '2024-06-30'],
    ['above 10000', 10001, '2024-06-30'],
    ['a malformed date', 2150, '2024-6-30'],
    ['an empty date', 2150, ''],
  ])('rejects %s and writes nothing', async (_name, kcal, date) => {
    const { db } = loadFresh();
    await db.initDatabase();
    await db.setNutritionGoals(2000, 140);

    await expect(db.applyAdaptiveCalorieGoal(kcal, date)).rejects.toThrow();

    expect(await db.getNutritionGoals()).toEqual({ calories: 2000, protein: 140 });
    expect(await db.getAdaptiveTdeeAppliedOn()).toBeNull();
  });

  it.each([1000, 10000])('accepts %d kcal', async (kcal) => {
    const { db } = loadFresh();
    await db.initDatabase();
    await db.applyAdaptiveCalorieGoal(kcal, '2024-06-30');
    expect((await db.getNutritionGoals()).calories).toBe(kcal);
  });

  it('keeps the goal and the apply date through a backup and restore', async () => {
    const { db, backup } = loadFresh();
    await db.initDatabase();
    await db.setNutritionGoals(2000, 140);
    await db.applyAdaptiveCalorieGoal(2150, '2024-06-30');

    const payload = await backup.buildBackupPayload();
    await db.setNutritionGoals(1800, 100);
    await db.setSetting(APPLIED_KEY, '2020-01-01');
    await db.restoreFromPayload(payload.tables, payload.schemaVersion);

    expect(await db.getNutritionGoals()).toEqual({ calories: 2150, protein: 140 });
    expect(await db.getAdaptiveTdeeAppliedOn()).toBe('2024-06-30');
  });
});
