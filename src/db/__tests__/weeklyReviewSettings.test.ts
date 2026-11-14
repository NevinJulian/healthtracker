import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

async function freshDb(): Promise<DatabaseModule> {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  const db = require('../database') as DatabaseModule;
  await db.initDatabase();
  return db;
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

describe('weekly review settings', () => {
  it('is enabled on a fresh database, Sunday at 19:00', async () => {
    const db = await freshDb();
    expect(await db.getWeeklyReviewEnabled()).toBe(true);
    expect(await db.getWeeklyReviewDay()).toBe(0);
    expect(await db.getWeeklyReviewTime()).toBe('19:00');
  });

  it('turns off and on again', async () => {
    const db = await freshDb();
    await db.setWeeklyReviewEnabled(false);
    expect(await db.getWeeklyReviewEnabled()).toBe(false);
    expect(await db.getSetting('weeklyReviewEnabled')).toBe('false');
    await db.setWeeklyReviewEnabled(true);
    expect(await db.getWeeklyReviewEnabled()).toBe(true);
  });

  it('treats any stored value other than false as enabled', async () => {
    const db = await freshDb();
    await db.setSetting('weeklyReviewEnabled', 'garbage');
    expect(await db.getWeeklyReviewEnabled()).toBe(true);
  });

  it('round-trips the day and the time', async () => {
    const db = await freshDb();
    await db.setWeeklyReviewDay(5);
    await db.setWeeklyReviewTime('07:45');
    expect(await db.getWeeklyReviewDay()).toBe(5);
    expect(await db.getWeeklyReviewTime()).toBe('07:45');
    expect(await db.getSetting('weeklyReviewDay')).toBe('5');
    expect(await db.getSetting('weeklyReviewTime')).toBe('07:45');
  });

  it.each([-1, 7, 1.5, NaN])('rejects day %p and writes nothing', async (value) => {
    const db = await freshDb();
    await db.setWeeklyReviewDay(2);
    await expect(db.setWeeklyReviewDay(value)).rejects.toThrow(RangeError);
    expect(await db.getSetting('weeklyReviewDay')).toBe('2');
  });

  it.each(['25:00', '8:00', 'abc', ' 08:00'])('rejects time %j and writes nothing', async (value) => {
    const db = await freshDb();
    await db.setWeeklyReviewTime('09:15');
    await expect(db.setWeeklyReviewTime(value)).rejects.toThrow(RangeError);
    expect(await db.getSetting('weeklyReviewTime')).toBe('09:15');
  });

  it.each(['7', 'abc', ''])('falls back to Sunday for a stored day of %j', async (stored) => {
    const db = await freshDb();
    await db.setSetting('weeklyReviewDay', stored);
    expect(await db.getWeeklyReviewDay()).toBe(0);
  });

  it.each(['25:00', 'abc', ''])('falls back to 19:00 for a stored time of %j', async (stored) => {
    const db = await freshDb();
    await db.setSetting('weeklyReviewTime', stored);
    expect(await db.getWeeklyReviewTime()).toBe('19:00');
  });
});

describe('getWorkoutSetsBetween', () => {
  it('returns every exercise and both set types for the inclusive date range, in order', async () => {
    const db = await freshDb();
    await db.logWorkoutSet('2026-11-07', 'Squat', { reps: 5, weightKg: 90 });
    await db.logWorkoutSet('2026-11-08', 'Squat', { reps: 10, weightKg: 60, setType: 'warmup' });
    await db.logWorkoutSet('2026-11-08', 'Squat', { reps: 5, weightKg: 100 });
    await db.logWorkoutSet('2026-11-08', 'Bench Press', { reps: 5, weightKg: 80 });
    await db.logWorkoutSet('2026-11-10', 'Deadlift', { reps: 3, weightKg: 140 });
    await db.logWorkoutSet('2026-11-14', 'Bench Press', { reps: 5, weightKg: 82.5 });
    await db.logWorkoutSet('2026-11-15', 'Squat', { reps: 5, weightKg: 105 });

    const rows = await db.getWorkoutSetsBetween('2026-11-08', '2026-11-14');

    expect(
      rows.map((r) => [r.date, r.exercise, r.set_index, r.set_type ?? null, r.weight_kg])
    ).toEqual([
      ['2026-11-08', 'Bench Press', 0, null, 80],
      ['2026-11-08', 'Squat', 0, 'warmup', 60],
      ['2026-11-08', 'Squat', 1, null, 100],
      ['2026-11-10', 'Deadlift', 0, null, 140],
      ['2026-11-14', 'Bench Press', 0, null, 82.5],
    ]);
  });

  it('returns an empty list when nothing falls in the range', async () => {
    const db = await freshDb();
    await db.logWorkoutSet('2026-11-01', 'Squat', { reps: 5, weightKg: 90 });
    expect(await db.getWorkoutSetsBetween('2026-11-08', '2026-11-14')).toEqual([]);
  });
});
