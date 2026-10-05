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
const MALFORMED = ['{oops', '', 'null', '{}', '"x"'];

async function seedTemplateExercises(db: DatabaseModule): Promise<void> {
  await db.getDatabase().runAsync('UPDATE weekly_template SET exercises = ?', [TEMPLATE_JSON]);
}

async function readExercises(db: DatabaseModule, date: string): Promise<string | undefined> {
  const row = await db
    .getDatabase()
    .getFirstAsync<{ exercises: string }>('SELECT exercises FROM daily_log WHERE date = ?', [date]);
  return row?.exercises;
}

describe('syncRollingSchedule() backfill with malformed stored exercises', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.dontMock('expo-sqlite');
  });

  it.each(MALFORMED)('leaves %j untouched at today, today-7 and today+7', async (bad) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await seedTemplateExercises(db);
    await db.getDatabase().runAsync("UPDATE app_state SET value = ? WHERE key = 'app_start_date'", [
      addDays(todayKey(), -30),
    ]);
    await db.syncRollingSchedule();

    const dates = [addDays(todayKey(), -7), todayKey(), addDays(todayKey(), 7)];
    for (const d of dates) {
      await db.getDatabase().runAsync(
        `INSERT OR IGNORE INTO daily_log (date, walking_task, hammer_task) VALUES (?, '', '')`,
        [d]
      );
      await db.getDatabase().runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [bad, d]);
    }
    warn.mockClear();

    await expect(db.syncRollingSchedule()).resolves.toBeUndefined();

    for (const d of dates) {
      expect(await readExercises(db, d)).toBe(bad);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    dates.forEach((d, i) => expect(warn.mock.calls[i][0]).toContain(d));
    if (bad) expect(warn.mock.calls[0][0]).not.toContain(bad);
  });

  it('backfills a [] row with template exercises, all not completed', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await seedTemplateExercises(db);
    const today = todayKey();
    await db.getDatabase().runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', ['[]', today]);
    warn.mockClear();

    await db.syncRollingSchedule();

    const parsed = JSON.parse((await readExercises(db, today)) as string);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((e: { completed: boolean }) => e.completed === false)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a malformed row does not block inserts or other backfills', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await seedTemplateExercises(db);
    const today = todayKey();
    const empty = addDays(today, 1);
    const missing = addDays(today, 2);
    const raw = db.getDatabase();
    await raw.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', ['{oops', today]);
    await raw.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', ['[]', empty]);
    await raw.runAsync('DELETE FROM daily_log WHERE date = ?', [missing]);
    warn.mockClear();

    await db.syncRollingSchedule();

    expect(await readExercises(db, today)).toBe('{oops');
    expect(JSON.parse((await readExercises(db, empty)) as string).length).toBeGreaterThan(0);
    expect(await readExercises(db, missing)).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
