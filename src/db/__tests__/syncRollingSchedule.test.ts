/**
 * Regression test for #300: syncRollingSchedule() must not delete daily_log
 * history outside the 7-day rolling window.
 *
 * Runs against a real (in-memory, sql.js/WASM) SQLite engine via
 * src/db/testHelpers/sqljsExpoAdapter.ts, rather than the no-op
 * __mocks__/expo-sqlite.js, so the DELETE statement in
 * _syncRollingSchedule() (src/db/database.ts) actually executes and its
 * effect on stored rows can be observed.
 *
 * database.ts holds a module-level singleton DB connection, so each test
 * resets the module registry and re-mocks expo-sqlite before re-requiring
 * database.ts, guaranteeing a brand-new in-memory database per test (see
 * the header comment in sqljsExpoAdapter.ts for why).
 *
 * Issue #300
 */

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

describe('syncRollingSchedule() history retention (#300)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('keeps a daily_log row far outside the rolling window after syncRollingSchedule()', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    // Never a literal date — always derived from the real date helpers.
    const oldDate = addDays(todayKey(), -400);

    const rawDb = db.getDatabase();
    await rawDb.runAsync(
      `INSERT INTO daily_log
         (date, walking_task, hammer_task, walk_completed, body_weight, water_ml)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [oldDate, 'Walk 10k', 'Bench 3x8', 1, 70.5, 2000]
    );

    // Sanity check: the row is there before the sync runs.
    const before = await db.getLogByDate(oldDate);
    expect(before).not.toBeNull();

    await db.syncRollingSchedule();

    const after = await db.getLogByDate(oldDate);
    expect(after).not.toBeNull();
    expect(after?.walk_completed).toBe(true);
    expect(after?.body_weight).toBe(70.5);
  });
});
