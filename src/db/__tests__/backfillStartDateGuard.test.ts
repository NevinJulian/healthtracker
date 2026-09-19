/**
 * Regression test for the #301 round-2 rejection.
 *
 * `floorISO = startDateISO > backfillFloorISO ? startDateISO : backfillFloorISO`
 * (introduced by the first #301 fix, ab6ae5e) has no upper clamp at
 * `todayISO`. If `startDateISO` is ever AHEAD of today, `floorISO` lands in
 * the future too, `startOffset = _daysBetweenKey(todayISO, floorISO)` comes
 * out positive, and the loop `for (offset = startOffset; offset <=
 * DAYS_AHEAD; ...)` skips offset 0 — today's row, and every row up to
 * `floorISO - 1`, are never generated. This repeats on every sync and every
 * screen focus until the device's real date catches up to the bad start
 * date.
 *
 * Reachable in practice: `restoreFromPayload` restores `app_state.
 * app_start_date` verbatim, so a backup taken on a device whose clock ran
 * fast (e.g. before its first NTP sync) or that crossed a timezone can
 * carry a future start date.
 *
 * Tester's repro (fails on ab6ae5e; not reproducible on 0aad077, since the
 * pre-#301 loop always started at offset 0 regardless of startDateISO):
 *   1. initDatabase() on a fresh DB
 *   2. UPDATE app_state SET value = <today+1> WHERE key = 'app_start_date'
 *   3. DELETE FROM daily_log
 *   4. syncRollingSchedule()
 *   5. getLogByDate(today) returns null — should be a row.
 *
 * Also covers a garbled / non-YYYY-MM-DD `app_start_date` (e.g. restored
 * from a corrupted backup): the string comparison used to build floorISO
 * must not throw, and must not silently generate zero rows (which is what
 * happens if a malformed date key produces NaN date arithmetic and NaN
 * fails every offset<=DAYS_AHEAD loop guard).
 *
 * Round-3 addition: `'not-a-date'` alone does NOT exercise `isValidDateKey`
 * — as a *string*, `'not-a-date' > todayISO` (letters sort after digits),
 * so the `MIN(lowerBoundISO, todayISO)` clamp catches it on its own; the
 * validator is redundant for that input; deleting `isValidDateKey` entirely
 * still leaves that case green. A shape-valid but calendar-invalid date —
 * day 99 of the *previous* month, e.g. `"2026-08-99"` — sorts BEFORE today
 * as a string (so the clamp does NOT catch it), but
 * `new Date(y, m - 1, 99)` overflows forward past today (99 days into a
 * ~30-day month lands roughly 2 months later), reproducing the original
 * "today's row never generated" bug if `isValidDateKey` is removed. This is
 * the case that actually proves the validator is load-bearing.
 *
 * Issue #301
 */

import { addDays, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

const START_DATE_KEY = 'app_start_date';
const DAYS_AHEAD = 7;

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

async function setStartDate(db: DatabaseModule, value: string): Promise<void> {
  const rawDb = db.getDatabase();
  await rawDb.runAsync('UPDATE app_state SET value = ? WHERE key = ?', [value, START_DATE_KEY]);
}

function expectedForwardWindow(today: string): string[] {
  const expected: string[] = [];
  for (let i = 0; i <= DAYS_AHEAD; i++) expected.push(addDays(today, i));
  return expected;
}

/**
 * Builds a shape-valid ("\d{4}-\d{2}-\d{2}") but calendar-invalid date key:
 * day 99 of the month before today. As a STRING this sorts BEFORE today
 * (year/month digits are <= today's), so it is not caught by clamping
 * floorISO to todayISO. But `new Date(y, m - 1, 99)` — the calculation
 * `isValidDateKey` round-trips through — overflows day 99 forward past the
 * end of that month, landing on a real Date well AFTER today. That's the
 * only input in this file that actually requires `isValidDateKey` (as
 * opposed to the todayISO clamp) to keep today's row from disappearing.
 */
function previousMonthOverflowDate(today: string): string {
  const [y, m] = today.split('-').map(Number);
  let py = y;
  let pm = m - 1;
  if (pm === 0) {
    pm = 12;
    py -= 1;
  }
  return `${py}-${String(pm).padStart(2, '0')}-99`;
}

describe('syncRollingSchedule() tolerates a bad app_start_date (#301 round 2)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it.each([1, 30])(
    'still generates today..today+DAYS_AHEAD when app_start_date is %i day(s) in the future',
    async (daysInFuture) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();

      const today = todayKey();
      const futureStart = addDays(today, daysInFuture);
      await setStartDate(db, futureStart);

      const rawDb = db.getDatabase();
      await rawDb.runAsync('DELETE FROM daily_log');

      await db.syncRollingSchedule();

      const todayRow = await db.getLogByDate(today);
      expect(todayRow).not.toBeNull();

      const rows = await db.getDailyLogsBetween(today, addDays(today, DAYS_AHEAD));
      expect(rows.map((r) => r.date)).toEqual(expectedForwardWindow(today));
    }
  );

  it('does not throw and still fills today..today+DAYS_AHEAD when app_start_date is garbled', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    await setStartDate(db, 'not-a-date');

    const rawDb = db.getDatabase();
    await rawDb.runAsync('DELETE FROM daily_log');

    await db.syncRollingSchedule(); // must not throw

    const rows = await db.getDailyLogsBetween(today, addDays(today, DAYS_AHEAD));
    expect(rows.map((r) => r.date)).toEqual(expectedForwardWindow(today));
  });

  it('does not throw and still fills today..today+DAYS_AHEAD when app_start_date is a shape-valid but calendar-overflow date (e.g. day 99 of last month)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    const garbled = previousMonthOverflowDate(today);
    await setStartDate(db, garbled);

    const rawDb = db.getDatabase();
    await rawDb.runAsync('DELETE FROM daily_log');

    await db.syncRollingSchedule(); // must not throw

    const todayRow = await db.getLogByDate(today);
    expect(todayRow).not.toBeNull();

    const rows = await db.getDailyLogsBetween(today, addDays(today, DAYS_AHEAD));
    expect(rows.map((r) => r.date)).toEqual(expectedForwardWindow(today));
  });

  it('does not throw and still fills today..today+DAYS_AHEAD when app_start_date is empty', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const today = todayKey();
    await setStartDate(db, '');

    const rawDb = db.getDatabase();
    await rawDb.runAsync('DELETE FROM daily_log');

    await db.syncRollingSchedule(); // must not throw

    const rows = await db.getDailyLogsBetween(today, addDays(today, DAYS_AHEAD));
    expect(rows.map((r) => r.date)).toEqual(expectedForwardWindow(today));
  });
});
