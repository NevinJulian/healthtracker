/**
 * #300 amendment: getDailyLogsBetween(fromKey, toKey) is a new explicit
 * date-range query over daily_log, added so analytics call sites can move
 * off the now-windowed getRollingWindow() and query an arbitrary range
 * (e.g. 30/90-day stats) directly instead. Not yet wired into any screen —
 * AnalyticsDashboardScreen.tsx belongs to another lane and is switched over
 * separately.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts / getRollingWindow.test.ts.
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

async function insertBareLogRow(
  db: DatabaseModule,
  date: string
): Promise<void> {
  const rawDb = db.getDatabase();
  await rawDb.runAsync(
    'INSERT INTO daily_log (date, walking_task, hammer_task) VALUES (?, ?, ?)',
    [date, 'Walk 10k', 'Bench 3x8']
  );
}

describe('getDailyLogsBetween() (#300)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('returns exactly the rows within an inclusive date range, ascending', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    const justBefore = addDays(today, -401);
    const rangeFrom = addDays(today, -400);
    const rangeTo = addDays(today, -399);
    const justAfter = addDays(today, -398);

    for (const date of [justBefore, rangeFrom, rangeTo, justAfter]) {
      await insertBareLogRow(db, date);
    }

    const rows = await db.getDailyLogsBetween(rangeFrom, rangeTo);
    const dates = rows.map((r) => r.date);

    expect(dates).toEqual([rangeFrom, rangeTo]);
    expect(dates).not.toContain(justBefore);
    expect(dates).not.toContain(justAfter);
  });
});
