import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

function loadFreshDatabaseModule(
  raw: SqljsExpoDb,
  openSpy: jest.Mock,
  deleteSpy: jest.Mock
): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: openSpy.mockImplementation(async () => raw),
    deleteDatabaseAsync: deleteSpy,
    SQLiteDatabase: class {},
  }));
  return require('../database') as DatabaseModule;
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('initDatabase with a daily_log table that has no date column', () => {
  async function setup() {
    const base = await createSqljsDb();
    const closeSpy = jest.fn(async () => {});
    const raw: SqljsExpoDb = { ...base, closeAsync: closeSpy };
    await raw.execAsync('CREATE TABLE daily_log (id INTEGER PRIMARY KEY, day TEXT)');
    await raw.runAsync('INSERT INTO daily_log (day) VALUES (?)', ['2020-01-01']);
    const openSpy = jest.fn();
    const deleteSpy = jest.fn(async () => {});
    const db = loadFreshDatabaseModule(raw, openSpy, deleteSpy);
    return { raw, db, closeSpy, openSpy, deleteSpy };
  }

  it('rejects with a readable message, leaves the data alone, and fails the same way on retry', async () => {
    const { raw, db, closeSpy, openSpy, deleteSpy } = await setup();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const first = db.initDatabase();
    await expect(first).rejects.toThrow(/daily_log/);
    await expect(first).rejects.toThrow(/date/);
    await expect(first).rejects.toThrow(/Save data/);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);

    const rows = await raw.getAllAsync<{ day: string }>('SELECT day FROM daily_log');
    expect(rows).toEqual([{ day: '2020-01-01' }]);

    await expect(db.initDatabase()).rejects.toThrow(/daily_log/);
    expect(deleteSpy).not.toHaveBeenCalled();
    const after = await raw.getAllAsync<{ day: string }>('SELECT day FROM daily_log');
    expect(after).toEqual([{ day: '2020-01-01' }]);

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
