import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

const WEEKLY_COOK_DAY_KEY = 'weeklyCookDay';
const DEFAULT_WEEKLY_COOK_DAY = 0;

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

describe('getWeeklyCookDay', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it.each(['999', '-1', 'abc', '7', '1.5', '3abc', ''])(
    'returns the default for stored %j',
    async (stored) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();

      await db.setSetting(WEEKLY_COOK_DAY_KEY, stored);

      expect(await db.getWeeklyCookDay()).toBe(DEFAULT_WEEKLY_COOK_DAY);
    }
  );

  it.each([
    ['0', 0],
    ['3', 3],
    ['6', 6],
    [' 3 ', 3],
  ])('returns the day for stored %j', async (stored, expected) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(WEEKLY_COOK_DAY_KEY, stored);

    expect(await db.getWeeklyCookDay()).toBe(expected);
  });

  it('returns the default when no setting row exists', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.getWeeklyCookDay()).toBe(DEFAULT_WEEKLY_COOK_DAY);
  });
});
