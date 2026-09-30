/**
 * A garbled or future app_start_date must never reach the hammer-weight
 * progression. Garbled values are replaced by today (and written back by the
 * rolling sync); future values are treated as today without being rewritten.
 *
 * Issues #363, #378
 */

import { addDays, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

const START_DATE_KEY = 'app_start_date';

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
  await db
    .getDatabase()
    .runAsync('UPDATE app_state SET value = ? WHERE key = ?', [value, START_DATE_KEY]);
}

async function readStartDate(db: DatabaseModule): Promise<string | undefined> {
  const row = await db
    .getDatabase()
    .getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [
      START_DATE_KEY,
    ]);
  return row?.value;
}

async function allHammerTasks(db: DatabaseModule): Promise<string[]> {
  const rows = await db
    .getDatabase()
    .getAllAsync<{ hammer_task: string }>('SELECT hammer_task FROM daily_log');
  return rows.map((r) => r.hammer_task);
}

function previousMonthOverflowDate(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}-99`;
}

// Sun (0) and Wed (3) are the rest days in the seeded weekly_template.
function isRestDay(dateKey: string): boolean {
  return [0, 3].includes(new Date(`${dateKey}T12:00:00`).getDay());
}

const BASE_OR_LIGHT = / @ (Baseline|Light Weight)$/;

describe('effective app_start_date', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it.each([1, 30])(
    'a start date %i day(s) in the future yields baseline weights and is left unchanged',
    async (daysInFuture) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      const future = addDays(todayKey(), daysInFuture);
      await setStartDate(db, future);
      await db.getDatabase().runAsync('DELETE FROM daily_log');

      await db.syncRollingSchedule();

      const tasks = await allHammerTasks(db);
      expect(tasks.length).toBeGreaterThan(0);
      for (const t of tasks) expect(t).toMatch(BASE_OR_LIGHT);
      expect(await readStartDate(db)).toBe(future);
    }
  );

  it.each([
    ['not-a-date', () => 'not-a-date'],
    ['empty', () => ''],
    ['calendar overflow', () => previousMonthOverflowDate(todayKey())],
  ])(
    'a garbled (%s) start date yields no NaN, no 90-day backfill, and is replaced by today',
    async (_label, makeValue) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      await setStartDate(db, makeValue());
      await db.getDatabase().runAsync('DELETE FROM daily_log');

      await db.syncRollingSchedule();

      const tasks = await allHammerTasks(db);
      expect(tasks.length).toBeGreaterThan(0);
      for (const t of tasks) {
        expect(t).not.toContain('NaN');
        expect(t).toMatch(BASE_OR_LIGHT);
      }
      const dates = await db
        .getDatabase()
        .getAllAsync<{ date: string }>('SELECT date FROM daily_log ORDER BY date');
      expect(dates[0].date).toBe(todayKey());
      expect(await readStartDate(db)).toBe(todayKey());
    }
  );

  it('a valid start date still progresses: a non-rest day 45 days after it reads Baseline + 10kg', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    let start = addDays(todayKey(), -60);
    let target = addDays(start, 45);
    while (isRestDay(target)) {
      start = addDays(start, -1);
      target = addDays(start, 45);
    }
    await setStartDate(db, start);
    await db.getDatabase().runAsync('DELETE FROM daily_log');

    await db.addWater(target, 100);

    const row = await db.getLogByDate(target);
    expect(row?.hammer_task).toMatch(/ @ Baseline \+ 10kg$/);
    expect(await readStartDate(db)).toBe(start);
  });

  it.each(['not-a-date', '', '2026-13-40', addDays(todayKey(), 5)])(
    'a row created on demand 60 days back with start date %p has no NaN or negative weight and leaves app_state alone',
    async (bad) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      await setStartDate(db, bad);
      await db.getDatabase().runAsync('DELETE FROM daily_log');
      let target = addDays(todayKey(), -60);
      while (isRestDay(target)) target = addDays(target, -1);

      await db.addWater(target, 100);

      const row = await db.getLogByDate(target);
      expect(row).not.toBeNull();
      expect(row?.hammer_task).not.toContain('NaN');
      expect(row?.hammer_task).toMatch(/ @ Baseline$/);
      expect(await readStartDate(db)).toBe(bad);
    }
  );

  it.each(['not-a-date', '', addDays(todayKey(), 5)])(
    'getStartDate and getCycleForDate are valid and finite for start date %p',
    async (bad) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      await setStartDate(db, bad);

      const start = await db.getStartDate();
      expect(start).toBe(todayKey());
      const cycle = await db.getCycleForDate(addDays(todayKey(), -30));
      expect(Number.isFinite(cycle)).toBe(true);
      expect(cycle).toBe(0);
      expect(await readStartDate(db)).toBe(bad);
    }
  );
});
