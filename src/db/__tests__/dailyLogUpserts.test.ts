/**
 * Regression test for #305: the five daily_log writers (upsertLogField,
 * upsertExerciseCompleted, upsertBodyWeight, addWater, setWaterForDay) are bare `UPDATE ... WHERE date = ?` statements.
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
const WINDOW_EDGE = () => addDays(todayKey(), 7);

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

  it('upsertExerciseCompleted creates the row for a date with no row (far past) without throwing', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

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

  it('addWater creates the row and persists the value for a date with no row (far past)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

    expect(await db.getWaterForDay(date)).toBe(0);

    await db.addWater(date, 500);

    expect(await db.getWaterForDay(date)).toBe(500);
    expect(await db.getLogByDate(date)).not.toBeNull();
  });

  it('setWaterForDay creates the row and persists the value for a date with no row (far past)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = FAR_PAST();

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
    const targetDate = WINDOW_EDGE();

    // "Expected": run sync with the clock moved to targetDate, so sync
    // generates that date's row through its normal (non-ensure-row) path.
    const expectedDb = loadFreshDatabaseModule();
    await expectedDb.initDatabase(); // real time — records app_start_date = today
    await expectedDb.getDatabase().runAsync('DELETE FROM daily_log WHERE date = ?', [targetDate]);
    travelTo(targetDate);
    await expectedDb.syncRollingSchedule();
    const expected = await expectedDb.getLogByDate(targetDate);
    jest.useRealTimers();
    jest.dontMock('expo-sqlite');

    expect(expected).not.toBeNull();

    // "Actual": real today, row absent — only reachable
    // via a writer's _ensureDailyLogRow() ensure-step.
    const actualDb = loadFreshDatabaseModule();
    await actualDb.initDatabase();
    await actualDb.getDatabase().runAsync('DELETE FROM daily_log WHERE date = ?', [targetDate]);
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

/**
 * Regression tests for #319.
 *
 * upsertExerciseCompleted() reads daily_log.exercises, parses it with the
 * lenient parseExercises() (returns [] on any malformed JSON), toggles one
 * entry, and writes JSON.stringify(...) back. Two problems:
 *
 *  1. If the stored text is malformed, the lenient parse silently treats it
 *     as [], and the write-back then replaces the corrupted-but-maybe-
 *     recoverable original with a *destroyed* value (typically just the
 *     one toggled entry, or []) — the write path must never do this.
 *
 *  2. Read-modify-write with no serialisation: two overlapping calls for
 *     the same date can both read the same pre-toggle array; the second
 *     write clobbers the first toggle (lost update).
 *
 * The fix adds a strict write-only parse (_tryParseExercisesForWrite) that
 * rejects instead of coercing to [], and chains every call onto a
 * module-level promise so read-modify-write sequences never interleave.
 */
describe('upsertExerciseCompleted rejects on malformed stored JSON instead of destroying it (#319)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('rejects, logs the date via console.error, and leaves the stored text byte-for-byte unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey(); // initDatabase()'s startup sync already created today's row

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rawDb = db.getDatabase();
    const corrupted = '{not valid json';
    await rawDb.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [corrupted, date]);

    await expect(db.upsertExerciseCompleted(date, 'some-exercise-id', true)).rejects.toThrow();

    const mentionsDate = consoleErrorSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes(date))
    );
    expect(mentionsDate).toBe(true);

    const row = await rawDb.getFirstAsync<{ exercises: string }>(
      'SELECT exercises FROM daily_log WHERE date = ?',
      [date]
    );
    expect(row?.exercises).toBe(corrupted);

    consoleErrorSpy.mockRestore();
  });

  it('read path (parseExercises, via getLogByDate) is unaffected by the write-path change: still returns [] for the same malformed text', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();

    const rawDb = db.getDatabase();
    await rawDb.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [
      '{not valid json',
      date,
    ]);

    const entry = await db.getLogByDate(date);
    expect(entry?.exercises).toEqual([]);
  });
});

describe('concurrent upsertExerciseCompleted calls for the same date are serialised, not lost (#319)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('two calls for different exercise ids, started without awaiting each other, both persist', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();

    const rawDb = db.getDatabase();
    const seeded = [
      { id: 'ex-a', name: 'Exercise A', sets: '3', reps: '10', videoUrl: '', completed: false },
      { id: 'ex-b', name: 'Exercise B', sets: '3', reps: '10', videoUrl: '', completed: false },
    ];
    await rawDb.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [
      JSON.stringify(seeded),
      date,
    ]);

    // Deliberately NOT awaited one-at-a-time — both start before either
    // finishes, exercising the read-modify-write race.
    const p1 = db.upsertExerciseCompleted(date, 'ex-a', true);
    const p2 = db.upsertExerciseCompleted(date, 'ex-b', true);
    await Promise.all([p1, p2]);

    const after = await db.getLogByDate(date);
    const a = after?.exercises.find((ex) => ex.id === 'ex-a');
    const b = after?.exercises.find((ex) => ex.id === 'ex-b');
    expect(a?.completed).toBe(true);
    expect(b?.completed).toBe(true);
  });
});

describe('a rejected upsertExerciseCompleted call does not wedge the serialisation queue (#319)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('a later queued call for a different date still resolves after an earlier one rejected', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const badDate = todayKey();
    const goodDate = FAR_PAST(); // no row yet — _ensureDailyLogRow creates one with valid exercises='[]'

    const rawDb = db.getDatabase();
    await rawDb.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [
      '{not valid json',
      badDate,
    ]);

    // Queued back-to-back, neither awaited individually first.
    const badCall = db.upsertExerciseCompleted(badDate, 'some-id', true);
    const goodCall = db.upsertExerciseCompleted(goodDate, 'some-other-id', true);

    await expect(badCall).rejects.toThrow();
    await expect(goodCall).resolves.not.toThrow();

    consoleErrorSpy.mockRestore();
  });
});

/**
 * #369, the plain-writer half. A single-statement writer isn't a
 * transaction, but any statement issued while ANOTHER unit's transaction is
 * open joins that transaction. If that transaction then rolls back, the
 * write is silently undone after its caller was told it succeeded.
 *
 * Here the other unit is a restore that fails partway through (a NOT NULL
 * violation) and rolls back. The user ticks today's walk while the restore
 * is mid-transaction, right after its DELETE FROM daily_log. Every exported
 * writer now goes through the write queue, so the tick waits for the restore
 * to finish and then applies. Before that, it ran inside the restore's
 * transaction and was rolled back with it.
 */
describe('a plain daily_log write cannot be swallowed by another unit\'s rollback (#369)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('a walk tick fired mid-restore survives the restore failing and rolling back', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const today = todayKey();
    expect((await db.getLogByDate(today))?.walk_completed).toBe(false);

    const raw = db.getDatabase();
    const originalGetAll = raw.getAllAsync;
    let tick: Promise<void> | null = null;
    (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = (async (
      ...args: Parameters<typeof originalGetAll>
    ) => {
      const result = await originalGetAll.apply(raw, args);
      // First PRAGMA table_info = inside the restore transaction, right
      // after DELETE FROM daily_log.
      if (tick === null && typeof args[0] === 'string' && args[0].startsWith('PRAGMA table_info')) {
        tick = db.upsertLogField(today, 'walk_completed', true);
        tick.catch(() => {}); // awaited below
        // Give an unqueued write every chance to run to completion here.
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      }
      return result;
    }) as typeof originalGetAll;

    await expect(
      db.restoreFromPayload({
        daily_log: [{ date: null, walking_task: 'Walk' }], // NOT NULL date -> throws
      }, 38)
    ).rejects.toBeDefined();
    (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = originalGetAll;

    expect(tick).not.toBeNull();
    await expect(tick!).resolves.toBeUndefined();
    // The caller was told the tick succeeded, so it must actually be there.
    expect((await db.getLogByDate(today))?.walk_completed).toBe(true);
  });
});

describe('addAdditionalWorkout and toggleAdditionalWorkout read-modify-write inside one queued unit', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const A = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };
  const B = { id: 'b', name: 'Run', muscle_group: 'Legs', sets: '1', reps: '1', completed: false };

  async function readRaw(db: DatabaseModule, date: string): Promise<string | undefined> {
    const row = await db.getDatabase().getFirstAsync<{ additional_workouts: string }>(
      'SELECT additional_workouts FROM daily_log WHERE date = ?',
      [date]
    );
    return row?.additional_workouts;
  }

  async function seedRaw(db: DatabaseModule, date: string, raw: string): Promise<void> {
    await db
      .getDatabase()
      .runAsync('UPDATE daily_log SET additional_workouts = ? WHERE date = ?', [raw, date]);
  }

  it('un-awaited add(A) and toggle(B) on a row seeded with B both persist', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seedRaw(db, date, JSON.stringify([B]));

    const add = db.addAdditionalWorkout(date, A);
    const toggle = db.toggleAdditionalWorkout(date, B.id);
    await Promise.all([add, toggle]);

    expect(JSON.parse((await readRaw(db, date)) as string)).toEqual([{ ...B, completed: true }, A]);
  });

  it('two un-awaited adds leave both workouts stored', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();

    await Promise.all([db.addAdditionalWorkout(date, A), db.addAdditionalWorkout(date, B)]);

    expect(JSON.parse((await readRaw(db, date)) as string)).toEqual([A, B]);
  });

  it.each(['{not json', '{}'])('add and toggle reject on malformed stored value %s and leave it unchanged', async (raw) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seedRaw(db, date, raw);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(db.addAdditionalWorkout(date, A)).rejects.toThrow(date);
    await expect(db.toggleAdditionalWorkout(date, A.id)).rejects.toThrow(date);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(await readRaw(db, date)).toBe(raw);
    consoleErrorSpy.mockRestore();
  });

  it('add and toggle create the row for a date with none', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const added = FAR_PAST();
    const toggled = addDays(FAR_PAST(), -1);

    await db.addAdditionalWorkout(added, A);
    await expect(db.toggleAdditionalWorkout(toggled, 'missing')).rejects.toThrow('missing');

    expect(JSON.parse((await readRaw(db, added)) as string)).toEqual([A]);
    expect(await readRaw(db, toggled)).toBe('[]');
  });

  it('toggle with an unknown id rejects and leaves the stored value unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    const raw = '[ {"id":"b","name":"Run","completed":false} ]';
    await seedRaw(db, date, raw);

    await expect(db.toggleAdditionalWorkout(date, 'nope')).rejects.toThrow('nope');

    expect(await readRaw(db, date)).toBe(raw);
  });

  it('an unknown-id toggle rejects with a plain Error naming the date and the id', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seedRaw(db, date, JSON.stringify([B]));

    const error = await db.toggleAdditionalWorkout(date, 'nope').then(
      () => undefined,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(db.CorruptJsonError);
    expect((error as Error).message).toContain(date);
    expect((error as Error).message).toContain('nope');
  });

  it('a rejected toggle does not block the next queued toggle', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seedRaw(db, date, JSON.stringify([B]));

    const rejected = db.toggleAdditionalWorkout(date, 'nope');
    const valid = db.toggleAdditionalWorkout(date, B.id);

    await expect(rejected).rejects.toThrow('nope');
    await expect(valid).resolves.toBeUndefined();
    expect(JSON.parse((await readRaw(db, date)) as string)).toEqual([{ ...B, completed: true }]);
  });

  it('toggle of a known id flips completed in both directions', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seedRaw(db, date, JSON.stringify([A, B]));

    await db.toggleAdditionalWorkout(date, B.id);
    expect(JSON.parse((await readRaw(db, date)) as string)).toEqual([A, { ...B, completed: true }]);

    await db.toggleAdditionalWorkout(date, B.id);
    expect(JSON.parse((await readRaw(db, date)) as string)).toEqual([A, B]);
  });
});

describe('refused writes throw a typed CorruptJsonError naming the column and date', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const workout = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };

  async function seed(db: DatabaseModule, date: string, column: string, raw: string): Promise<void> {
    await db.getDatabase().runAsync(`UPDATE daily_log SET ${column} = ? WHERE date = ?`, [raw, date]);
  }

  it('upsertExerciseCompleted rejects with column=exercises', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await seed(db, date, 'exercises', '{not json');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const err = await db.upsertExerciseCompleted(date, 'x', true).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(db.CorruptJsonError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ column: 'exercises', date });
    spy.mockRestore();
  });

  it.each(['add', 'toggle'] as const)(
    '%s on additional_workouts rejects with column=additional_workouts',
    async (kind) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      const date = todayKey();
      await seed(db, date, 'additional_workouts', '{}');
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const call =
        kind === 'add'
          ? db.addAdditionalWorkout(date, workout)
          : db.toggleAdditionalWorkout(date, 'a');
      const err = await call.catch((e: unknown) => e);

      expect(err).toBeInstanceOf(db.CorruptJsonError);
      expect(err).toMatchObject({ column: 'additional_workouts', date });
      spy.mockRestore();
    }
  );
});

describe('resetCorruptDayColumn keeps the corrupt text and writes a fresh value', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  type Row = Record<string, unknown>;
  const templateExercises = [
    { id: 't1', name: 'Squat', muscle_group: 'Legs', sets: '3', reps: '5', completed: true },
    { id: 't2', name: 'Row', muscle_group: 'Back', sets: '3', reps: '8', completed: false },
  ];

  async function setup(): Promise<{ db: DatabaseModule; date: string }> {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await db
      .getDatabase()
      .runAsync('UPDATE weekly_template SET exercises = ? WHERE day_of_week = ?', [
        JSON.stringify(templateExercises),
        dateKeyToLocalDate(date).getDay(),
      ]);
    return { db, date };
  }

  async function seed(db: DatabaseModule, date: string, column: string, raw: string): Promise<void> {
    await db.getDatabase().runAsync(`UPDATE daily_log SET ${column} = ? WHERE date = ?`, [raw, date]);
  }

  async function logRow(db: DatabaseModule, date: string): Promise<Row> {
    return (await db.getDatabase().getFirstAsync<Row>('SELECT * FROM daily_log WHERE date = ?', [date])) as Row;
  }

  async function kept(db: DatabaseModule, key: string): Promise<string | undefined> {
    const row = await db
      .getDatabase()
      .getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [key]);
    return row?.value;
  }

  async function keptCount(db: DatabaseModule): Promise<number> {
    const row = await db
      .getDatabase()
      .getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM app_state WHERE key LIKE 'corrupt_json:%'");
    return row?.n ?? 0;
  }

  it('additional_workouts: stores the byte-identical text under the exact key and writes []', async () => {
    const { db, date } = await setup();
    const corrupt = '{not json é \n';
    await seed(db, date, 'additional_workouts', corrupt);
    const before = await logRow(db, date);

    await db.resetCorruptDayColumn(date, 'additional_workouts');

    expect(await kept(db, `corrupt_json:additional_workouts:${date}`)).toBe(corrupt);
    const after = await logRow(db, date);
    expect(after.additional_workouts).toBe('[]');
    expect({ ...after, additional_workouts: null }).toEqual({ ...before, additional_workouts: null });
  });

  it('exercises: writes the template exercises all uncompleted and leaves the other column alone', async () => {
    const { db, date } = await setup();
    const w = JSON.stringify([{ id: 'w', name: 'Run', completed: true }]);
    await seed(db, date, 'additional_workouts', w);
    await seed(db, date, 'exercises', '[1,');
    const before = await logRow(db, date);

    await db.resetCorruptDayColumn(date, 'exercises');

    expect(await kept(db, `corrupt_json:exercises:${date}`)).toBe('[1,');
    const after = await logRow(db, date);
    expect(JSON.parse(after.exercises as string)).toEqual(templateExercises.map((e) => ({ ...e, completed: false })));
    expect(after.additional_workouts).toBe(w);
    expect({ ...after, exercises: null }).toEqual({ ...before, exercises: null });
  });

  it('a second reset with different corrupt text keeps both under :2, then :3', async () => {
    const { db, date } = await setup();
    await seed(db, date, 'additional_workouts', '{first');
    await db.resetCorruptDayColumn(date, 'additional_workouts');
    await seed(db, date, 'additional_workouts', '{second');
    await db.resetCorruptDayColumn(date, 'additional_workouts');
    await seed(db, date, 'additional_workouts', '{third');
    await db.resetCorruptDayColumn(date, 'additional_workouts');

    const key = `corrupt_json:additional_workouts:${date}`;
    expect(await kept(db, key)).toBe('{first');
    expect(await kept(db, `${key}:2`)).toBe('{second');
    expect(await kept(db, `${key}:3`)).toBe('{third');
  });

  it('identical corrupt text is not duplicated', async () => {
    const { db, date } = await setup();
    await seed(db, date, 'additional_workouts', '{same');
    await db.resetCorruptDayColumn(date, 'additional_workouts');
    await seed(db, date, 'additional_workouts', '{same');
    await db.resetCorruptDayColumn(date, 'additional_workouts');

    expect(await keptCount(db)).toBe(1);
  });

  it.each(['exercises', 'additional_workouts'] as const)(
    'refuses with no write when %s is not corrupt',
    async (column) => {
      const { db, date } = await setup();
      const before = await logRow(db, date);

      await expect(db.resetCorruptDayColumn(date, column)).rejects.toThrow(date);

      expect(await logRow(db, date)).toEqual(before);
      expect(await keptCount(db)).toBe(0);
    }
  );

  it('refuses with no write for a date with no row', async () => {
    const { db } = await setup();
    const date = addDays(todayKey(), -2000);

    await expect(db.resetCorruptDayColumn(date, 'exercises')).rejects.toThrow();

    expect(await keptCount(db)).toBe(0);
    expect(await logRow(db, date)).toBeNull();
  });

  it('rolls the kept text back when the fresh-value write fails', async () => {
    const { db, date } = await setup();
    await seed(db, date, 'additional_workouts', '{bad');
    await db.getDatabase().execAsync(
      "CREATE TRIGGER block_reset BEFORE UPDATE OF additional_workouts ON daily_log WHEN NEW.additional_workouts = '[]' BEGIN SELECT RAISE(ABORT, 'blocked'); END"
    );

    await expect(db.resetCorruptDayColumn(date, 'additional_workouts')).rejects.toThrow();

    expect(await keptCount(db)).toBe(0);
    expect((await logRow(db, date)).additional_workouts).toBe('{bad');
  });

  it('the kept text appears in the real backup payload, and add and toggle work after the reset', async () => {
    const { db, date } = await setup();
    await seed(db, date, 'additional_workouts', '{bad');
    await db.resetCorruptDayColumn(date, 'additional_workouts');

    const { buildBackupPayload } = require('../../services/backup') as typeof import('../../services/backup');
    const payload = await buildBackupPayload();
    expect(payload.tables.app_state).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: `corrupt_json:additional_workouts:${date}`, value: '{bad' }),
      ])
    );

    const w = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };
    await db.addAdditionalWorkout(date, w);
    await db.toggleAdditionalWorkout(date, 'a');
    expect(JSON.parse((await logRow(db, date)).additional_workouts as string)).toEqual([{ ...w, completed: true }]);
  });

  it('exercise toggles work after resetting exercises', async () => {
    const { db, date } = await setup();
    await seed(db, date, 'exercises', '{bad');
    await db.resetCorruptDayColumn(date, 'exercises');

    await db.upsertExerciseCompleted(date, 't1', true);

    const after = JSON.parse((await logRow(db, date)).exercises as string) as { id: string; completed: boolean }[];
    expect(after.find((e) => e.id === 't1')?.completed).toBe(true);
  });
});

describe('daily_log writers reject dates outside the valid range', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const writers: [string, (db: DatabaseModule, date: string) => Promise<void>][] = [
    ['upsertLogField', (db, d) => db.upsertLogField(d, 'walk_completed', true)],
    ['upsertExerciseCompleted', (db, d) => db.upsertExerciseCompleted(d, 'some-exercise-id', true)],
    ['upsertBodyWeight', (db, d) => db.upsertBodyWeight(d, 70)],
    ['addWater', (db, d) => db.addWater(d, 250)],
    ['setWaterForDay', (db, d) => db.setWaterForDay(d, 1000)],
  ];

  async function rowCount(db: DatabaseModule, date: string): Promise<number> {
    const row = await db
      .getDatabase()
      .getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM daily_log WHERE date = ?', [date]);
    return row?.n ?? 0;
  }

  const rejected: [string, () => string][] = [
    ['an impossible calendar date', () => '2026-13-40'],
    ['garbage', () => 'garbage'],
    ['an empty string', () => ''],
    ['today + 8', () => addDays(todayKey(), 8)],
    ['a far-future year', () => '2087-01-01'],
  ];

  describe.each(writers)('%s', (_name, write) => {
    it.each(rejected)('rejects %s and creates no row', async (_label, getDate) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      const date = getDate();

      await expect(write(db, date)).rejects.toThrow(/invalid|out of range/i);

      expect(await rowCount(db, date)).toBe(0);
    });

    it.each([
      ['today + 7', () => addDays(todayKey(), 7)],
      ['today', () => todayKey()],
      ['400 days back', () => addDays(todayKey(), -400)],
    ])('accepts %s and creates the missing row', async (_label, getDate) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      const date = getDate();
      await db.getDatabase().runAsync('DELETE FROM daily_log WHERE date = ?', [date]);

      await write(db, date);

      expect(await rowCount(db, date)).toBe(1);
    });

    it('does not block the next queued write after a rejection', async () => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();
      const good = addDays(todayKey(), -400);

      const first = write(db, 'garbage');
      const second = write(db, good);
      await expect(first).rejects.toThrow();
      await expect(second).resolves.toBeUndefined();

      expect(await rowCount(db, good)).toBe(1);
    });
  });
});

describe('stored daily_log arrays are valid only when every item is an object with a string id', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const COLUMNS = ['exercises', 'additional_workouts'] as const;
  const CORRUPT = ['', 'null', '{}', '"x"', '[null]', '[1]', '["a"]', '[{}]', '[{"id":"a"},null]', '{not json'];
  const VALID = ['[]', '[{"id":"a"}]'];
  const workout = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };

  async function setup(column: string, raw: string): Promise<{ db: DatabaseModule; date: string }> {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await db.getDatabase().runAsync(`UPDATE daily_log SET ${column} = ? WHERE date = ?`, [raw, date]);
    return { db, date };
  }

  async function stored(db: DatabaseModule, date: string, column: string): Promise<string> {
    const row = await db
      .getDatabase()
      .getFirstAsync<Record<string, string>>(`SELECT ${column} AS raw FROM daily_log WHERE date = ?`, [date]);
    return (row as Record<string, string>).raw;
  }

  function writers(db: DatabaseModule, date: string, column: (typeof COLUMNS)[number]): Array<() => Promise<void>> {
    return column === 'exercises'
      ? [() => db.upsertExerciseCompleted(date, 'a', true)]
      : [
          () => db.addAdditionalWorkout(date, workout),
          () => db.toggleAdditionalWorkout(date, 'a'),
        ];
  }

  const corruptCases = COLUMNS.flatMap((column) => CORRUPT.map((raw) => [column, raw] as const));
  const validCases = COLUMNS.flatMap((column) => VALID.map((raw) => [column, raw] as const));

  it.each(corruptCases)('%s = %j: writers throw CorruptJsonError and leave the text alone', async (column, raw) => {
    const { db, date } = await setup(column, raw);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    for (const write of writers(db, date, column)) {
      const err = await write().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(db.CorruptJsonError);
      expect(err).toMatchObject({ column, date });
      expect(await stored(db, date, column)).toBe(raw);
    }
    spy.mockRestore();
  });

  it.each(corruptCases)('%s = %j: reset keeps the text and writes a fresh value', async (column, raw) => {
    const { db, date } = await setup(column, raw);

    await db.resetCorruptDayColumn(date, column);

    const keptRow = await db
      .getDatabase()
      .getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [`corrupt_json:${column}:${date}`]);
    expect(keptRow?.value).toBe(raw);
    expect(Array.isArray(JSON.parse(await stored(db, date, column)))).toBe(true);
  });

  it.each(validCases)('%s = %j: writers succeed and reset refuses', async (column, raw) => {
    const { db, date } = await setup(column, raw);

    await expect(db.resetCorruptDayColumn(date, column)).rejects.toThrow('not corrupt');
    for (const write of writers(db, date, column)) {
      await expect(write()).resolves.toBeUndefined();
    }
  });
});

describe('reading daily_log drops items that are not objects with a string id', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const keep = { id: 'a', completed: true };
  const cases: Array<[string, unknown[]]> = [
    ['[null,{"id":"a","completed":true}]', [keep]],
    ['[1]', []],
    ['["a"]', []],
    ['[{}]', []],
    ['[[],{"id":"a","completed":true}]', [keep]],
    ['[{"id":1}]', []],
    ['{}', []],
    ['{not json', []],
  ];

  it.each(cases)('%j reads as %j in both columns without throwing', async (raw, expected) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await db
      .getDatabase()
      .runAsync('UPDATE daily_log SET exercises = ?, additional_workouts = ? WHERE date = ?', [raw, raw, date]);

    const entry = await db.getLogByDate(date);

    expect(entry?.exercises).toEqual(expected);
    expect(entry?.additional_workouts).toEqual(expected);
  });
});

describe('resetCorruptDayColumn only accepts the two known columns', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('rejects %j as an unsupported column', async (column) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await expect(
      db.resetCorruptDayColumn(todayKey(), column as unknown as 'exercises')
    ).rejects.toThrow('unsupported column');
  });
});

describe('syncRollingSchedule leaves a row with an invalid exercises array untouched', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it.each(['[null]', '[{"id":"a"},null]'])('%s inside the backfill window is not overwritten', async (raw) => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await db.getDatabase().runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [raw, date]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await db.syncRollingSchedule();

    const row = await db
      .getDatabase()
      .getFirstAsync<{ exercises: string }>('SELECT exercises FROM daily_log WHERE date = ?', [date]);
    expect(row?.exercises).toBe(raw);
    warn.mockRestore();
  });
});

describe('weekly template exercises are read as stored', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const stored = '[{"name":"X"},{"id":"a","name":"Y"}]';

  it('getWeeklyTemplate returns items without an id unfiltered', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.getDatabase().runAsync('UPDATE weekly_template SET exercises = ? WHERE day_of_week = 3', [stored]);

    const wednesday = (await db.getWeeklyTemplate()).find((d) => d.day_of_week === 3);

    expect(wednesday?.exercises).toEqual(JSON.parse(stored));
  });

  it('a new daily_log row built from that template carries the items with completed reset', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const target = addDays(todayKey(), 5);
    const dow = dateKeyToLocalDate(target).getDay();
    await db.getDatabase().runAsync('UPDATE weekly_template SET exercises = ? WHERE day_of_week = ?', [stored, dow]);
    await db.getDatabase().runAsync('DELETE FROM daily_log WHERE date = ?', [target]);

    await db.syncRollingSchedule();

    const row = await db
      .getDatabase()
      .getFirstAsync<{ exercises: string }>('SELECT exercises FROM daily_log WHERE date = ?', [target]);
    expect(JSON.parse(row?.exercises ?? 'null')).toEqual([
      { name: 'X', completed: false },
      { id: 'a', name: 'Y', completed: false },
    ]);
  });
});

describe('read entries flag a column unreadable exactly when the writers refuse it', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  const COLUMNS = ['exercises', 'additional_workouts'] as const;
  const CORRUPT = ['', 'null', '{}', '"x"', '[null]', '[1]', '["a"]', '[{}]', '[{"id":"a"},null]', '{not json', '[{"name":"x"}]'];
  const VALID = ['[]', '[{"id":"a"}]'];
  const workout = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };
  const cases = COLUMNS.flatMap((column) => [...CORRUPT, ...VALID].map((raw) => [column, raw] as const));

  async function seeded(column: string, raw: string): Promise<{ db: DatabaseModule; date: string }> {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const date = todayKey();
    await db.getDatabase().runAsync(`UPDATE daily_log SET ${column} = ? WHERE date = ?`, [raw, date]);
    return { db, date };
  }

  async function writerRefuses(db: DatabaseModule, date: string, column: (typeof COLUMNS)[number]): Promise<boolean> {
    const write =
      column === 'exercises'
        ? () => db.upsertExerciseCompleted(date, 'a', true)
        : () => db.addAdditionalWorkout(date, workout);
    const err = await write().then(
      () => undefined,
      (e: unknown) => e
    );
    return err instanceof db.CorruptJsonError;
  }

  it.each(cases)('%s = %j: getLogByDate flags it iff the writer refuses it', async (column, raw) => {
    const { db, date } = await seeded(column, raw);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const refuses = await writerRefuses(db, date, column);
    spy.mockRestore();
    await db.getDatabase().runAsync(`UPDATE daily_log SET ${column} = ? WHERE date = ?`, [raw, date]);

    const entry = await db.getLogByDate(date);

    expect(entry?.unreadable?.includes(column) ?? false).toBe(refuses);
  });

  it('a row with both columns corrupt flags both, a valid row flags none', async () => {
    const { db, date } = await seeded('exercises', '{bad');
    await db.getDatabase().runAsync('UPDATE daily_log SET additional_workouts = ? WHERE date = ?', ['[1]', date]);

    expect((await db.getLogByDate(date))?.unreadable).toEqual(['exercises', 'additional_workouts']);

    await db.getDatabase().runAsync('UPDATE daily_log SET exercises = ?, additional_workouts = ? WHERE date = ?', ['[]', '[]', date]);
    expect((await db.getLogByDate(date))?.unreadable ?? []).toEqual([]);
  });

  it('getDailyLogsBetween flags per row', async () => {
    const { db, date } = await seeded('additional_workouts', '{bad');
    const other = addDays(date, 1);

    const rows = await db.getDailyLogsBetween(date, other);

    expect(rows.find((r) => r.date === date)?.unreadable).toEqual(['additional_workouts']);
    expect(rows.find((r) => r.date === other)?.unreadable ?? []).toEqual([]);
  });
});
