/**
 * #306 — getWaterHistory(sinceDateKey) had no upper date bound.
 *
 * _syncRollingSchedule() pre-creates daily_log rows for today+1..+7 with
 * water_ml = 0 (the rolling window looks both backward and forward). Since
 * getWaterHistory() only filtered `date >= sinceDateKey`, the sole caller
 * (AnalyticsDashboardScreen's 7-day hydration card, via
 * getWaterHistory(addDays(today, -6))) picked up those future zero rows too
 * — 14 rows instead of 7 — which silently halves the reported average.
 *
 * Fix: getWaterHistory(sinceDateKey, untilDateKey = toISODate()) adds
 * `AND date <= ?`, bounding the query to the true calendar week.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * getDailyLogsBetween.test.ts / syncRollingSchedule.test.ts.
 *
 * Issue #306
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

describe('getWaterHistory() (#306)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('excludes future daily_log rows created by the rolling-window sync', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    const sinceKey = addDays(today, -6);

    // Seed a full past week (today-6..today) with a known water total so
    // the rows are unambiguous.
    for (let i = -6; i <= 0; i++) {
      await db.setWaterForDay(addDays(today, i), 2000);
    }

    // initDatabase() already ran _syncRollingSchedule(), which pre-creates
    // today+1..+7 as daily_log rows with water_ml = 0 (unset). Without an
    // upper bound, getWaterHistory would include those too.
    const rows = await db.getWaterHistory(sinceKey);

    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.date <= today).toBe(true);
    }
    // The true 7-day average should reflect only the seeded past week.
    const avg = rows.reduce((sum, r) => sum + r.water_ml, 0) / rows.length;
    expect(avg).toBe(2000);
  });
});
