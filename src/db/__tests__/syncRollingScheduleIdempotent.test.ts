/**
 * Regression test for #336 (gap 1/3): syncRollingSchedule() must be
 * idempotent. Running it twice back-to-back with no time passing in between
 * must be a complete no-op on daily_log — same row count, same bytes in
 * every column, for every row.
 *
 * #300 and #301 each have their own tests (syncRollingSchedule.test.ts,
 * backfillGap.test.ts) proving retention and gap-backfill in isolation. This
 * test instead builds ONE daily_log state that exercises every branch
 * _syncRollingSchedule() (database.ts) can take across two back-to-back
 * calls —
 *   - a row inside the window with real completion data (present before
 *     the first call)
 *   - a row from before the app's start date (outside anything sync ever
 *     revisits)
 *   - a gap inside the window that the first call must backfill
 *   - a second gap the first call also backfills, which the user then
 *     edits (simulating an in-app edit) between the two sync calls, so
 *     its exercises differ from what weekly_template would generate by
 *     the time the second call runs
 * — then asserts the SECOND call changes nothing at all: not the row
 * count, not one column of one row, including the just-edited row.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts / backfillGap.test.ts. The snapshot is a raw
 * `SELECT * FROM daily_log ORDER BY date` through the adapter (not
 * getDailyLogsBetween()/DailyLogEntry, which drops columns not in that
 * interface, e.g. water_ml — see database.ts:149-161) so every column is
 * actually covered, per the work order.
 *
 * Issue #336
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
  const [y, m, d] = dateKey.split('-').map(Number);
  jest.setSystemTime(new Date(y, m - 1, d));
}

async function insertRawLogRow(
  db: DatabaseModule,
  date: string,
  fields: Record<string, string | number>
): Promise<void> {
  const rawDb = db.getDatabase();
  const columns = ['date', ...Object.keys(fields)];
  const placeholders = columns.map(() => '?').join(', ');
  await rawDb.runAsync(
    `INSERT INTO daily_log (${columns.join(', ')}) VALUES (${placeholders})`,
    [date, ...Object.values(fields)]
  );
}

async function snapshotDailyLog(db: DatabaseModule): Promise<Record<string, unknown>[]> {
  const rawDb = db.getDatabase();
  return rawDb.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM daily_log ORDER BY date ASC'
  );
}

const CUSTOM_EXERCISES_JSON = JSON.stringify([
  { id: 'custom-1', name: 'User Added Burpees', sets: '3', reps: '15', videoUrl: '', completed: true },
]);

describe('syncRollingSchedule() is idempotent on a second, back-to-back call (#336)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('leaves daily_log byte-for-byte identical (row count and every column) across a second sync', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase(); // real time — records app_start_date = day0, runs the first (day0) sync

    const day0 = todayKey();
    const dayN = addDays(day0, 25); // well inside BACKFILL_CAP_DAYS=90, past the original window

    travelTo(dayN);

    // Row inside the new window with real completion data.
    const completedRowDate = addDays(dayN, -3);
    await insertRawLogRow(db, completedRowDate, {
      walking_task: 'Walk 10k',
      hammer_task: 'Bench 3x8',
      walk_completed: 1,
      hammer_completed: 1,
      body_weight: 68.4,
      water_ml: 1500,
    });

    // Row from before the app's own start date — outside anything sync
    // ever revisits (floorISO can never go before startDateISO).
    const oldRowDate = addDays(day0, -25);
    await insertRawLogRow(db, oldRowDate, {
      walking_task: 'Legacy walk',
      hammer_task: 'Legacy hammer',
      body_weight: 91.1,
      exercises: JSON.stringify([{ id: 'old-1', name: 'Old Row Marker', sets: '1', reps: '1', videoUrl: '', completed: false }]),
    });

    // A gap inside the window: deliberately NOT inserted, so the first
    // post-travel sync call must backfill it.
    const gapDate = addDays(dayN, -5);
    const gapBeforeFirstSync = await db.getLogByDate(gapDate);
    expect(gapBeforeFirstSync).toBeNull();

    // A second, distinct gap date — also missing before the first sync, so
    // it too is freshly created (from the template, completed:false) by the
    // first call below. This is the row we'll simulate a user edit on
    // *between* the two sync calls, so the idempotency assertion is
    // specifically about a second call, not just re-asserting state a first
    // call already wrote.
    const editedAfterCreationDate = addDays(dayN, -4);
    const editedBeforeFirstSync = await db.getLogByDate(editedAfterCreationDate);
    expect(editedBeforeFirstSync).toBeNull();

    // ── First post-travel sync: establishes the baseline state ──────────
    await db.syncRollingSchedule();

    // Sanity: all states are actually present as intended before we test
    // idempotency against them.
    const afterFirstSync = await snapshotDailyLog(db);
    const byDate = new Map(afterFirstSync.map((r) => [r.date as string, r]));

    const completedRow = byDate.get(completedRowDate);
    expect(completedRow).toBeDefined();
    expect(completedRow?.walk_completed).toBe(1);
    expect(completedRow?.hammer_completed).toBe(1);
    expect(completedRow?.body_weight).toBe(68.4);

    const oldRow = byDate.get(oldRowDate);
    expect(oldRow).toBeDefined();
    expect(oldRow?.body_weight).toBe(91.1);

    const gapRow = byDate.get(gapDate);
    expect(gapRow).toBeDefined(); // backfilled by the first sync

    const editedRowAfterCreation = byDate.get(editedAfterCreationDate);
    expect(editedRowAfterCreation).toBeDefined(); // also backfilled by the first sync

    // Simulate the user editing that freshly-created row's exercises
    // in-app (e.g. via updateTemplateExercises-style UI, or per-exercise
    // completion) before the next screen focus re-triggers sync. This must
    // now differ from whatever weekly_template would generate for that
    // weekday — exactly the "user-edited, differs from template" case.
    const rawDb = db.getDatabase();
    await rawDb.runAsync('UPDATE daily_log SET exercises = ? WHERE date = ?', [
      CUSTOM_EXERCISES_JSON,
      editedAfterCreationDate,
    ]);

    const afterUserEdit = await snapshotDailyLog(db);
    const rowCountAfterUserEdit = afterUserEdit.length;

    // ── Second sync: must be a complete no-op, including on the row the
    // user just edited ───────────────────────────────────────────────────
    await db.syncRollingSchedule();
    const afterSecondSync = await snapshotDailyLog(db);

    expect(afterSecondSync.length).toBe(rowCountAfterUserEdit);
    expect(afterSecondSync).toEqual(afterUserEdit);
  });
});
