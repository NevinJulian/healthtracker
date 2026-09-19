/**
 * Regression tests for #315: restoreFromPayload() built
 * `INSERT INTO ${tableName} (${keys.join(', ')})` from each backup row's
 * OWN keys, completely unfiltered. Only tableName was whitelisted (against
 * listUserTables()) — a row's keys were trusted verbatim as column
 * identifiers, which cannot be parameterised the way values can.
 *
 * A backup file is user-supplied (picked from the file system and
 * JSON.parse'd), so a crafted row key like
 * `"x); DROP TABLE daily_log; --"` reaching the INSERT's column list is a
 * SQL-injection path, not just a data-corruption one.
 *
 * Fix (database.ts, restoreFromPayload): once per table, read
 * `PRAGMA table_info(<table>)` into a Set of real column names. Each row is
 * filtered to only the keys present in that set before building the INSERT.
 * A row with zero surviving keys is skipped entirely (not inserted, not
 * counted in rowsRestored). What was dropped is reported back via an
 * optional `skipped` field on the return value and a console.warn, per
 * table.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts.
 *
 * Issue #315
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

const MALICIOUS_KEY = 'x); DROP TABLE daily_log; --';

describe('restoreFromPayload() column whitelisting against injected/unknown keys (#315)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('does not throw a SQL error and leaves daily_log intact when a row key is a DROP TABLE payload', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      daily_log: [
        {
          date: '2024-07-01',
          walking_task: 'walk',
          hammer_task: 'hammer',
          [MALICIOUS_KEY]: 'evil',
        },
      ],
    };

    await expect(db.restoreFromPayload(payloadTables)).resolves.toBeDefined();

    const raw = db.getDatabase();

    // The table must still exist, with its real schema intact.
    const tableRow = await raw.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_log'"
    );
    expect(tableRow?.name).toBe('daily_log');

    const cols = await raw.getAllAsync<{ name: string }>(
      'PRAGMA table_info(daily_log)'
    );
    const colNames = cols.map((c) => c.name);
    // The real schema's columns are all still there (not an exhaustive
    // list — other lanes may add columns — just proof the table wasn't
    // dropped/corrupted), and the injected key never became one.
    expect(colNames).toEqual(expect.arrayContaining(['date', 'walking_task', 'hammer_task']));
    expect(colNames).not.toContain(MALICIOUS_KEY);
  });

  it('inserts only the known columns from a row with unknown + known keys, and reports the skip', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      daily_log: [
        {
          date: '2024-07-02',
          walking_task: 'walk',
          hammer_task: 'hammer',
          [MALICIOUS_KEY]: 'evil',
        },
      ],
    };

    const result = await db.restoreFromPayload(payloadTables);

    const raw = db.getDatabase();
    const row = await raw.getFirstAsync<any>(
      "SELECT * FROM daily_log WHERE date = '2024-07-02'"
    );
    expect(row).toBeDefined();
    expect(row.walking_task).toBe('walk');
    expect(row.hammer_task).toBe('hammer');
    expect(Object.keys(row)).not.toContain(MALICIOUS_KEY);

    // The row WAS inserted (it had known columns), so it counts.
    expect(result.rowsRestored).toBe(1);

    // But the unknown column must be reported as skipped.
    expect(result.skipped).toBeDefined();
    const dailyLogSkip = result.skipped!.find((s) => s.table === 'daily_log');
    expect(dailyLogSkip).toBeDefined();
    expect(dailyLogSkip!.columns).toContain(MALICIOUS_KEY);
  });

  it('skips an all-unknown row entirely: not inserted, not counted in rowsRestored', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      daily_log: [
        {
          [MALICIOUS_KEY]: 'evil',
          'another_bogus_column': 'also evil',
        },
      ],
    };

    const result = await db.restoreFromPayload(payloadTables);

    const raw = db.getDatabase();
    const rows = await raw.getAllAsync<any>('SELECT * FROM daily_log');
    expect(rows).toHaveLength(0);

    expect(result.rowsRestored).toBe(0);
    expect(result.tablesRestored).toBe(1);

    expect(result.skipped).toBeDefined();
    const dailyLogSkip = result.skipped!.find((s) => s.table === 'daily_log');
    expect(dailyLogSkip).toBeDefined();
    expect(dailyLogSkip!.rows).toBe(1);
  });

  it('warns via console.warn when a table has skipped/unknown columns', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const payloadTables: Record<string, Record<string, unknown>[]> = {
      daily_log: [
        { date: '2024-07-03', walking_task: 'w', hammer_task: 'h', [MALICIOUS_KEY]: 'evil' },
      ],
    };

    await db.restoreFromPayload(payloadTables);

    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('daily_log'))
    );
    expect(warned).toBe(true);

    warnSpy.mockRestore();
  });
});
