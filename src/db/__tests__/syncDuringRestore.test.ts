/**
 * Outcome tests for syncRollingSchedule() coinciding with a restore (#369).
 *
 * expo-sqlite's withTransactionAsync is a bare, non-queued BEGIN/COMMIT on
 * one shared connection. restoreFromPayload() is the worst possible partner
 * for anything else: inside one transaction it DROPs both unique indexes,
 * runs DELETE FROM on every table, re-inserts everything and re-applies
 * migration SQL. syncRollingSchedule() is the writer most likely to
 * coincide with it, because it runs on every Dashboard focus and on every
 * AppState 'active', and both fire while the document picker and the
 * restore alerts are on screen.
 *
 * This pair used to be guarded by a _restoreInProgress flag that made the
 * sync skip itself. Both now go through the write queue, which serialises
 * every writer, so the flag is gone and these tests pin the OUTCOME instead
 * of a mechanism:
 *
 *   - A sync fired mid-restore (right after the DELETE FROM) writes nothing
 *     into the half-wiped table. It runs after the restore commits, against
 *     the restored data.
 *   - A sync fired just BEFORE the restore's transaction can't backfill over
 *     restored rows from a stale pre-read. The sync reads outside its own
 *     transaction (#37), so this is only safe because the queue boundary is
 *     the whole unit of work, not just BEGIN..COMMIT.
 *   - A restore that throws doesn't wedge the sync off afterwards.
 *
 * The syncs are fired, not awaited, from inside the restore: that is what a
 * screen does. Awaiting a queued call from inside the restore's own unit
 * would be a reentrant call, which the write queue rejects (see
 * writeQueueRules.test.ts).
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts.
 *
 * Issue #369
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';
import { todayKey } from '../../utils/dates';

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

async function dailyLogCount(db: DatabaseModule): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM daily_log');
  return row?.n ?? 0;
}

async function yieldMacrotasks(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Runs restoreFromPayload() with a hook on the first getAllAsync whose SQL
 * matches `when`. The hook fires syncRollingSchedule() without awaiting it,
 * gives it every chance to run, and records daily_log's row count at that
 * moment.
 */
async function restoreWithSyncFiredAt(
  db: DatabaseModule,
  when: (sql: string) => boolean,
  payload: Record<string, Record<string, unknown>[]>
): Promise<{ restore: Promise<unknown>; sync: () => Promise<void> | null; countAtHook: () => number }> {
  const raw = db.getDatabase();
  const originalGetAll = raw.getAllAsync;
  let sync: Promise<void> | null = null;
  let countAtHook = -1;
  (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = (async (
    ...args: Parameters<typeof originalGetAll>
  ) => {
    const result = await originalGetAll.apply(raw, args);
    if (sync === null && typeof args[0] === 'string' && when(args[0])) {
      sync = db.syncRollingSchedule();
      sync.catch(() => {}); // settled and inspected by the caller
      await yieldMacrotasks();
      const row = await raw.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM daily_log');
      countAtHook = row?.n ?? 0;
    }
    return result;
  }) as typeof originalGetAll;

  const restore = db.restoreFromPayload(payload).finally(() => {
    (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = originalGetAll;
  });
  return { restore, sync: () => sync, countAtHook: () => countAtHook };
}

const RESTORED_ROW = {
  date: '2024-06-01',
  walking_task: 'Walk',
  hammer_task: 'Lift',
  walk_completed: 1,
  hammer_completed: 0,
  fasting_completed: 0,
  is_rest_day: 0,
  is_meal_prep_day: 0,
  exercises: '[]',
  body_weight: null,
  additional_workouts: '[]',
  water_ml: 0,
};

describe('syncRollingSchedule() coinciding with restoreFromPayload() (#369)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('a sync fired mid-restore writes nothing into the half-wiped table, then syncs the restored data', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    // The first PRAGMA table_info is inside the restore transaction, right
    // after DELETE FROM daily_log and before the rows are re-inserted: the
    // most dangerous moment in the restore.
    const run = await restoreWithSyncFiredAt(
      db,
      (sql) => sql.startsWith('PRAGMA table_info'),
      { daily_log: [RESTORED_ROW] }
    );
    await expect(run.restore).resolves.toBeDefined();
    expect(run.sync()).not.toBeNull();
    await expect(run.sync()!).resolves.toBeUndefined();

    // Nothing landed in the half-wiped table while the restore held it.
    expect(run.countAtHook()).toBe(0);

    // The restored row survived intact...
    const restored = await db.getLogByDate('2024-06-01');
    expect(restored?.walk_completed).toBe(true);
    // ...and the sync ran afterwards, against the restored data, filling
    // the rolling window back in around it.
    expect(await dailyLogCount(db)).toBeGreaterThan(1);
    expect(await db.getLogByDate(todayKey())).not.toBeNull();
  });

  it("a sync fired just before the restore's transaction can't backfill over restored exercises from a stale read", async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();
    const today = todayKey();

    // Every template day has exercises, and today's LIVE row has none, so
    // a sync that reads the live DB will want to backfill today.
    await raw.runAsync(
      `UPDATE weekly_template SET exercises = '[{"id":"tpl","name":"Template","completed":false}]'`
    );
    await raw.runAsync(`UPDATE daily_log SET exercises = '[]' WHERE date = ?`, [today]);

    // The backup's today row has the user's own completed exercises.
    const mine = [{ id: 'mine', name: 'Mine', completed: true }];
    const run = await restoreWithSyncFiredAt(
      db,
      // listUserTables(): the restore's first read, before its transaction.
      (sql) => sql.includes('FROM sqlite_master'),
      { daily_log: [{ ...RESTORED_ROW, date: today, exercises: JSON.stringify(mine) }] }
    );
    await expect(run.restore).resolves.toBeDefined();
    await expect(run.sync()!).resolves.toBeUndefined();

    // The sync must have seen the restored row (non-empty exercises) and
    // left it alone, not backfilled the template over it from a pre-restore
    // snapshot.
    const after = await db.getLogByDate(today);
    expect(after?.exercises).toEqual(mine);
  });

  it('a restore that throws does not wedge the sync afterwards', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await expect(
      db.restoreFromPayload({
        // NOT NULL date -> the INSERT throws inside the transaction.
        daily_log: [{ date: null, walking_task: 'Walk' }],
      })
    ).rejects.toBeDefined();

    // The failed restore rolled back as a whole, and the sync runs normally.
    const before = await dailyLogCount(db);
    expect(before).toBeGreaterThan(1);
    await expect(db.syncRollingSchedule()).resolves.toBeUndefined();
    expect(await dailyLogCount(db)).toBe(before);
  });
});
