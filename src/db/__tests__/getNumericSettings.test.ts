import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

const CALORIES_KEY = 'nutritionGoalCalories';
const PROTEIN_KEY = 'nutritionGoalProtein';
const HEIGHT_KEY = 'profileHeightCm';
const AGE_KEY = 'profileAge';

const DEFAULT_CALORIES = 1800;
const DEFAULT_PROTEIN = 150;

function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  return require('../database') as DatabaseModule;
}

async function freshDb(): Promise<DatabaseModule> {
  const db = loadFreshDatabaseModule();
  await db.initDatabase();
  return db;
}

describe('getNutritionGoals and getUserProfile reject invalid stored numeric strings', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  describe.each([
    ['calories', CALORIES_KEY, DEFAULT_CALORIES],
    ['protein', PROTEIN_KEY, DEFAULT_PROTEIN],
  ] as const)('nutrition goal %s', (field, key, fallback) => {
    it.each(['', '  ', 'abc', '0', '-5'])('falls back to the default for stored %j', async (stored) => {
      const db = await freshDb();
      await db.setSetting(key, stored);
      expect((await db.getNutritionGoals())[field]).toBe(fallback);
    });

    it('returns a valid stored value unchanged', async () => {
      const db = await freshDb();
      await db.setSetting(key, '2200');
      expect((await db.getNutritionGoals())[field]).toBe(2200);
    });

    it('has no upper bound', async () => {
      const db = await freshDb();
      await db.setSetting(key, '99999');
      expect((await db.getNutritionGoals())[field]).toBe(99999);
    });

    it('falls back to the default when the key is missing', async () => {
      const db = await freshDb();
      expect((await db.getNutritionGoals())[field]).toBe(fallback);
    });
  });

  describe.each([
    ['heightCm', HEIGHT_KEY, ['49', '251'], '175'],
    ['age', AGE_KEY, ['9', '121'], '30'],
  ] as const)('profile %s', (field, key, outOfRange, valid) => {
    it.each(['', '  ', 'abc', '0', '-5'])('is null for stored %j', async (stored) => {
      const db = await freshDb();
      await db.setSetting(key, stored);
      expect((await db.getUserProfile())[field]).toBeNull();
    });

    it.each(outOfRange)('is null for out-of-range stored %j', async (stored) => {
      const db = await freshDb();
      await db.setSetting(key, stored);
      expect((await db.getUserProfile())[field]).toBeNull();
    });

    it('returns a valid stored value unchanged', async () => {
      const db = await freshDb();
      await db.setSetting(key, valid);
      expect((await db.getUserProfile())[field]).toBe(Number(valid));
    });

    it('is null when the key is missing', async () => {
      const db = await freshDb();
      expect((await db.getUserProfile())[field]).toBeNull();
    });
  });

  it('accepts the range boundaries', async () => {
    const db = await freshDb();
    await db.setSetting(HEIGHT_KEY, '50');
    await db.setSetting(AGE_KEY, '120');
    const profile = await db.getUserProfile();
    expect(profile.heightCm).toBe(50);
    expect(profile.age).toBe(120);
  });
});
