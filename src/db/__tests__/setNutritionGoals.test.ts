import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type SqljsDb = Awaited<ReturnType<typeof createSqljsDb>>;

const PROTEIN_KEY = 'nutritionGoalProtein';

function loadFreshDatabaseModule(failOnParam?: { current: string | null }): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => {
      const db: SqljsDb = await createSqljsDb();
      const realRun = db.runAsync.bind(db);
      db.runAsync = (async (sql: string, params?: unknown) => {
        if (
          failOnParam?.current &&
          Array.isArray(params) &&
          params.includes(failOnParam.current)
        ) {
          throw new Error('disk full');
        }
        return realRun(sql, params as never);
      }) as typeof db.runAsync;
      return db;
    },
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  return require('../database') as DatabaseModule;
}

describe('setNutritionGoals', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('writes both goals', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setNutritionGoals(2500, 160);

    expect(await db.getNutritionGoals()).toEqual({ calories: 2500, protein: 160 });
  });

  it('leaves both goals unchanged when the second write fails, and the queue keeps working', async () => {
    const fail = { current: null as string | null };
    const db = loadFreshDatabaseModule(fail);
    await db.initDatabase();
    await db.setNutritionGoals(2000, 120);

    fail.current = PROTEIN_KEY;
    await expect(db.setNutritionGoals(2500, 160)).rejects.toThrow('disk full');
    fail.current = null;

    expect(await db.getNutritionGoals()).toEqual({ calories: 2000, protein: 120 });

    await db.setNutritionGoals(2600, 170);
    expect(await db.getNutritionGoals()).toEqual({ calories: 2600, protein: 170 });
  });
});
