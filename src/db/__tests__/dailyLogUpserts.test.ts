/**
 * Regression test for #305: the six daily_log writers (upsertLogField,
 * upsertExerciseCompleted, upsertBodyWeight, upsertAdditionalWorkouts,
 * addWater, setWaterForDay) are bare `UPDATE ... WHERE date = ?` statements.
 * When called for a date that has no daily_log row yet (e.g. outside the
 * current 7-day rolling window — the window is only today ± 7 days, but a
 * screen can still be showing/editing a date further out, like a date from
 * history or from a stale rolling-window snapshot), the UPDATE silently
 * touches zero rows and the write is lost. `addWater`'s docblock even
 * claimed this was "upsert-safe", which was false.
 *
 * Fix: each writer now calls `_ensureDailyLogRow()` first, which
 * INSERT-OR-IGNOREs a row built by the same per-date row-value computation
 * `_syncRollingSchedule()` uses (`_buildDailyLogRowValues()`), so an
 * on-demand row is indistinguishable from one sync would have generated.
 * Each writer's UPDATE is then asserted (`_assertWrote()`) to have touched
 * exactly one row.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts / backfillGap.test.ts, so the real INSERT/
 * UPDATE statements execute against a real (in-memory) SQLite engine.
 *
 * Issue #305
 */

import { addDays, dateKeyToLocalDate, todayKey } from '../../utils/dates';
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

/** Move "now" forward/back to `dateKey` (local midnight) using fake timers.
 * initDatabase() must be called BEFORE this, under real timers, so
 * app_start_date is recorded from the real clock (matches backfillGap.test.ts). */
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

const FAR_PAST = () => addDays(todayKey(), -400);
const FAR_FUTURE = () => addDays(todayKey(), 400);

describe('daily_log writers create a missing row instead of silently no-op-ing (#305)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('upsertLogField creates the row and persists the value for a date with no row (far past)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    expect(await db.getLogByDate(date)).toBeNull();

    await db.upsertLogField(date, 'walk_completed', true);

    const after = await db.getLogByDate(date);
    expect(after).not.toBeNull();
    expect(after?.walk_completed).toBe(true);
  });

  it('upsertExerciseCompleted creates the row for a date with no row (far future) without throwing', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_FUTURE();

    expect(await db.getLogByDate(date)).toBeNull();

    await expect(
      db.upsertExerciseCompleted(date, 'some-exercise-id', true)
    ).resolves.not.toThrow();

    const after = await db.getLogByDate(date);
    expect(after).not.toBeNull();
    expect(Array.isArray(after?.exercises)).toBe(true);
  });

  it('upsertBodyWeight creates the row and persists the value for a date with no row (far past)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    await db.upsertBodyWeight(date, 71.4);

    const after = await db.getLogByDate(date);
    expect(after).not.toBeNull();
    expect(after?.body_weight).toBe(71.4);
  });

  it('upsertAdditionalWorkouts creates the row and persists the value for a date with no row (far future)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_FUTURE();

    const workouts = [{ id: 'w1', name: 'Extra Row', completed: false }];
    await db.upsertAdditionalWorkouts(date, workouts);

    const after = await db.getLogByDate(date);
    expect(after).not.toBeNull();
    expect(after?.additional_workouts).toEqual(workouts);
  });

  it('addWater creates the row and persists the value for a date with no row (far past)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    expect(await db.getWaterForDay(date)).toBe(0);

    await db.addWater(date, 500);

    expect(await db.getWaterForDay(date)).toBe(500);
    expect(await db.getLogByDate(date)).not.toBeNull();
  });

  it('setWaterForDay creates the row and persists the value for a date with no row (far future)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_FUTURE();

    await db.setWaterForDay(date, 1200);

    expect(await db.getWaterForDay(date)).toBe(1200);
    expect(await db.getLogByDate(date)).not.toBeNull();
  });
});

describe('auto-created daily_log rows match what syncRollingSchedule() would have generated (#305)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it("has non-null walking_task/hammer_task matching that weekday's template, and valid exercises/additional_workouts arrays", async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    await db.upsertBodyWeight(date, 70);

    const row = await db.getLogByDate(date);
    expect(row).not.toBeNull();
    expect(row?.walking_task).toEqual(expect.any(String));
    expect(row?.walking_task.length).toBeGreaterThan(0);
    expect(row?.hammer_task).toEqual(expect.any(String));
    expect(row?.hammer_task.length).toBeGreaterThan(0);
    expect(Array.isArray(row?.exercises)).toBe(true);
    expect(Array.isArray(row?.additional_workouts)).toBe(true);

    const rawDb = db.getDatabase();
    const dow = dateKeyToLocalDate(date).getDay();
    const template = await rawDb.getFirstAsync<{ walking_task: string; hammer_task: string }>(
      'SELECT walking_task, hammer_task FROM weekly_template WHERE day_of_week = ?',
      [dow]
    );
    expect(row?.walking_task).toBe(template?.walking_task);
    // hammer_task is the template's base task plus a weight-progression
    // suffix (buildHammerTask) — assert it, not equality with the raw template.
    expect(row?.hammer_task.startsWith(template!.hammer_task)).toBe(true);
  });

  it('produces a row identical (aside from the field the writer itself sets) to the one syncRollingSchedule() generates for the same date', async () => {
    const targetDate = FAR_FUTURE();

    // "Expected": run sync with the clock moved to targetDate, so sync
    // generates that date's row through its normal (non-ensure-row) path.
    const expectedDb = loadFreshDatabaseModule();
    await expectedDb.initDatabase(); // real time — records app_start_date = today
    travelTo(targetDate);
    await expectedDb.syncRollingSchedule();
    const expected = await expectedDb.getLogByDate(targetDate);
    jest.useRealTimers();
    jest.dontMock('expo-sqlite');

    expect(expected).not.toBeNull();

    // "Actual": real today, far outside sync's own window — only reachable
    // via a writer's _ensureDailyLogRow() ensure-step.
    const actualDb = loadFreshDatabaseModule();
    await actualDb.initDatabase();
    await actualDb.upsertBodyWeight(targetDate, 70); // body_weight isn't part of the builder — excluded below
    const actual = await actualDb.getLogByDate(targetDate);

    expect(actual).not.toBeNull();
    expect(actual?.walking_task).toBe(expected?.walking_task);
    expect(actual?.hammer_task).toBe(expected?.hammer_task);
    expect(actual?.is_rest_day).toBe(expected?.is_rest_day);
    expect(actual?.is_meal_prep_day).toBe(expected?.is_meal_prep_day);
    expect(actual?.exercises).toEqual(expected?.exercises);
  });
});

describe('addWater on an existing row still accumulates and clamps at 0 (#305 non-regression)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('accumulates across calls and never goes negative', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    // today's row already exists — initDatabase()'s own startup sync creates it.
    const date = todayKey();
    expect(await db.getLogByDate(date)).not.toBeNull();

    await db.addWater(date, 300);
    expect(await db.getWaterForDay(date)).toBe(300);

    await db.addWater(date, 200);
    expect(await db.getWaterForDay(date)).toBe(500);

    await db.addWater(date, -10000);
    expect(await db.getWaterForDay(date)).toBe(0);
  });
});

describe('calling a writer twice for the same missing date creates exactly one row (#305)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('the second write applies and no duplicate row is created', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    await db.upsertBodyWeight(date, 60);
    await db.upsertBodyWeight(date, 65);

    const rows = await db.getDailyLogsBetween(date, date);
    expect(rows.length).toBe(1);
    expect(rows[0].body_weight).toBe(65);
  });
});
