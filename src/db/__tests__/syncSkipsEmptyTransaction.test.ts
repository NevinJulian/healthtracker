import { addDays, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

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

const TEMPLATE_JSON = '[{"id":"tpl","name":"Template","completed":false}]';

async function countTransactions(db: DatabaseModule, run: () => Promise<void>): Promise<number> {
  const raw = db.getDatabase();
  const original = raw.withTransactionAsync;
  let calls = 0;
  (raw as unknown as { withTransactionAsync: typeof original }).withTransactionAsync = (async (
    ...args: Parameters<typeof original>
  ) => {
    calls++;
    return original.apply(raw, args);
  }) as typeof original;
  try {
    await run();
  } finally {
    (raw as unknown as { withTransactionAsync: typeof original }).withTransactionAsync = original;
  }
  return calls;
}

async function scalar<T>(db: DatabaseModule, sql: string, params: (string | number)[] = []): Promise<T | undefined> {
  const row = await db.getDatabase().getFirstAsync<Record<string, T>>(sql, params);
  return row ? Object.values(row)[0] : undefined;
}

describe('syncRollingSchedule() skips the transaction when there is nothing to write', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.dontMock('expo-sqlite');
  });

  it('makes no transaction on a second sync of an already-synced database', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(0);
  });

  it('makes one transaction and inserts rows when the window is empty', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.getDatabase().runAsync('DELETE FROM daily_log');
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(1);
    expect(await scalar<number>(db, 'SELECT COUNT(*) FROM daily_log WHERE date = ?', [todayKey()])).toBe(1);
  });

  it('makes one transaction and inserts a single missing row in the window', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const target = addDays(todayKey(), 3);
    await db.getDatabase().runAsync('DELETE FROM daily_log WHERE date = ?', [target]);
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(1);
    expect(await scalar<number>(db, 'SELECT COUNT(*) FROM daily_log WHERE date = ?', [target])).toBe(1);
  });

  it('makes one transaction and backfills an empty-exercises row in the window', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.getDatabase().runAsync('UPDATE weekly_template SET exercises = ?', [TEMPLATE_JSON]);
    await db.getDatabase().runAsync("UPDATE daily_log SET exercises = '[]' WHERE date = ?", [todayKey()]);
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(1);
    expect(await scalar<string>(db, 'SELECT exercises FROM daily_log WHERE date = ?', [todayKey()])).toContain('tpl');
  });

  it('makes one transaction and rewrites a garbled start date even with nothing else to write', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.getDatabase().runAsync("UPDATE app_state SET value = 'garbage' WHERE key = 'app_start_date'");
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(1);
    expect(await scalar<string>(db, "SELECT value FROM app_state WHERE key = 'app_start_date'")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it('makes no transaction for a malformed-exercises row alone and still warns', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.getDatabase().runAsync('UPDATE weekly_template SET exercises = ?', [TEMPLATE_JSON]);
    await db.getDatabase().runAsync("UPDATE daily_log SET exercises = '{oops' WHERE date = ?", [todayKey()]);
    warn.mockClear();
    expect(await countTransactions(db, () => db.syncRollingSchedule())).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(todayKey());
  });
});
