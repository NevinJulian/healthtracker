/**
 * Regression test for #301: _syncRollingSchedule() was forward-only
 * (`for (let offset = 0; offset <= DAYS_AHEAD; offset++)`), so if the app
 * isn't opened for a while, the days that elapse in between get no daily_log
 * row at all — a permanent gap in history, since #300 stopped pruning but
 * never taught sync to fill backward.
 *
 * Fix: the insert range now runs from
 * `floor = MAX(startDateISO, today - BACKFILL_CAP_DAYS)` through
 * `today + DAYS_AHEAD`, so a sync after a gap backfills the missing days
 * (capped at BACKFILL_CAP_DAYS=90 so a huge gap can't insert thousands of
 * rows in one call).
 *
 * Orchestrator amendment kept separate: the *existing-row* "exercises are
 * '[]', backfill them from the template" pass must NOT run over the widened
 * range — only over its old range (today - DAYS_HISTORY .. today +
 * DAYS_AHEAD). Otherwise an old row would retroactively receive today's
 * template exercises, marked incomplete — inventing history the user never
 * had.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts / getRollingWindow.test.ts / getDailyLogsBetween.test.ts.
 *
 * gym-weight cycle constants (21-day cycle, +5kg/cycle) are documented in
 * CLAUDE.md ("Gym weight auto-progresses on a 21-day cycle (buildHammerTask,
 * CYCLE_DAYS/KG_PER_CYCLE)") — stable domain behaviour, not a guessed
 * implementation detail.
 *
 * Issue #301
 */

import { addDays, daysBetween, dateKeyToLocalDate, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

const CYCLE_DAYS = 21;
const KG_PER_CYCLE = 5;
const BACKFILL_CAP_DAYS = 90;
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

/** Move "now" forward to `dateKey` (local midnight) using fake timers, without
 * re-mocking anything that would disturb the already-loaded sql.js/wasm
 * module (initDatabase() must be called BEFORE this, under real timers). */
function travelTo(dateKey: string): void {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'queueMicrotask',
      'nextTick', 'hrtime', 'performance',
    ],
  });
  jest.setSystemTime(dateKeyToLocalDate(dateKey));
}

async function insertRawLogRow(
  db: DatabaseModule,
  date: string,
  fields: Record<string, unknown>
): Promise<void> {
  const rawDb = db.getDatabase();
  const columns = ['date', ...Object.keys(fields)];
  const placeholders = columns.map(() => '?').join(', ');
  await rawDb.runAsync(
    `INSERT INTO daily_log (${columns.join(', ')}) VALUES (${placeholders})`,
    [date, ...Object.values(fields)]
  );
}

describe('syncRollingSchedule() backfills gaps after time away (#301)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('fills every date across a 30-day gap between two syncs', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase(); // real time — records app_start_date = day0

    const day0 = todayKey();
    const day30 = addDays(day0, 30);

    travelTo(day30);
    await db.syncRollingSchedule();

    const rows = await db.getDailyLogsBetween(day0, day30);
    const dates = rows.map((r) => r.date);
    const expectedDates: string[] = [];
    for (let i = 0; i <= 30; i++) expectedDates.push(addDays(day0, i));

    expect(dates).toEqual(expectedDates);
  });

  it('leaves a row with real completion data from 15 days ago untouched by a gap sync', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const day0 = todayKey();
    const day20 = addDays(day0, 20);
    const fifteenDaysBeforeDay20 = addDays(day20, -15);

    travelTo(day20);

    await insertRawLogRow(db, fifteenDaysBeforeDay20, {
      walking_task: 'Walk 10k',
      hammer_task: 'Bench 3x8',
      walk_completed: 1,
      hammer_completed: 1,
      body_weight: 71.2,
    });

    await db.syncRollingSchedule();

    const after = await db.getLogByDate(fifteenDaysBeforeDay20);
    expect(after).not.toBeNull();
    expect(after?.walk_completed).toBe(true);
    expect(after?.hammer_completed).toBe(true);
    expect(after?.body_weight).toBe(71.2);
    expect(after?.hammer_task).toBe('Bench 3x8'); // untouched, not overwritten by template
  });

  it('inserts at most BACKFILL_CAP_DAYS + DAYS_AHEAD + 1 rows for a 200-day gap', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const day0 = todayKey();
    const day200 = addDays(day0, 200);

    const before = await db.getDailyLogsBetween(day0, addDays(day0, 400));
    const beforeCount = before.length;

    travelTo(day200);
    await db.syncRollingSchedule();

    const after = await db.getDailyLogsBetween(day0, addDays(day200, DAYS_AHEAD));
    const insertedThisSync = after.length - beforeCount;

    expect(insertedThisSync).toBeLessThanOrEqual(BACKFILL_CAP_DAYS + DAYS_AHEAD + 1);
    expect(insertedThisSync).toBeLessThan(200);
  });

  it('never generates a daily_log row before startDateISO', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const day0 = todayKey();
    const day200 = addDays(day0, 200); // gap far bigger than BACKFILL_CAP_DAYS=90

    travelTo(day200);
    await db.syncRollingSchedule();

    const rows = await db.getDailyLogsBetween(addDays(day0, -1000), addDays(day200, DAYS_AHEAD));
    const dates = rows.map((r) => r.date);
    const minDate = dates.reduce((min, d) => (d < min ? d : min), dates[0]);

    expect(minDate >= day0).toBe(true);
  });

  it('does not retroactively backfill exercises on a row older than the old range, but still backfills one inside it', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    const day0 = todayKey();
    const day50 = addDays(day0, 50);
    const oldRowDate = addDays(day50, -40); // outside old range (today - DAYS_HISTORY=7)
    const recentRowDate = addDays(day50, -3); // inside old range

    travelTo(day50);

    await insertRawLogRow(db, oldRowDate, {
      walking_task: 'Walk 10k',
      hammer_task: 'Bench 3x8',
      exercises: '[]',
    });
    await insertRawLogRow(db, recentRowDate, {
      walking_task: 'Walk 10k',
      hammer_task: 'Bench 3x8',
      exercises: '[]',
    });

    await db.syncRollingSchedule();

    const oldRow = await db.getLogByDate(oldRowDate);
    const recentRow = await db.getLogByDate(recentRowDate);

    expect(oldRow?.exercises).toEqual([]);
    expect(recentRow?.exercises.length).toBeGreaterThan(0);
  });

  it("computes a backfilled past date's hammer-task weight from that date, not today's", async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase(); // app_start_date = day0

    const day0 = todayKey();
    const day60 = addDays(day0, 60);

    travelTo(day60);
    await db.syncRollingSchedule();

    // Pick a backfilled date whose own daysDiff-from-start lands in a
    // different 21-day cycle than "today" (daysDiff=60 → cycle 2, +10kg).
    const targetDate = addDays(day0, 45); // daysDiff=45 → cycle 2, +10kg
    const row = await db.getLogByDate(targetDate);
    expect(row).not.toBeNull();

    if (row?.is_rest_day) {
      // Rest days don't progress weight — nothing to assert here.
      expect(row.hammer_task).toContain('Light Weight');
      return;
    }

    const daysDiff = daysBetween(day0, targetDate);
    const cycle = Math.floor(daysDiff / CYCLE_DAYS);
    const expectedSuffix =
      cycle === 0 ? '@ Baseline' : `@ Baseline + ${cycle * KG_PER_CYCLE}kg`;

    expect(row?.hammer_task).toContain(expectedSuffix);

    // And it must differ from what "today's" cycle would have produced,
    // proving the weight wasn't computed from todayISO.
    const todayDaysDiff = daysBetween(day0, day60);
    const todayCycle = Math.floor(todayDaysDiff / CYCLE_DAYS);
    if (todayCycle !== cycle) {
      const todaySuffix =
        todayCycle === 0 ? '@ Baseline' : `@ Baseline + ${todayCycle * KG_PER_CYCLE}kg`;
      expect(row?.hammer_task).not.toContain(todaySuffix);
    }
  });
});
