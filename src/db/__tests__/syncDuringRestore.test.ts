/**
 * Regression tests for syncRollingSchedule() running during a restore
 * (#369, found by a cold review of PR #376).
 *
 * expo-sqlite's withTransactionAsync is a bare, non-queued BEGIN/COMMIT on
 * one shared connection, so two overlapping transactions can roll back each
 * other's work. restoreFromPayload() is the worst possible partner: inside
 * one transaction it DROPs both unique indexes, runs DELETE FROM on every
 * table, re-inserts everything and re-applies migration SQL.
 *
 * syncRollingSchedule() is the most likely thing to overlap with it,
 * because it runs on every screen focus and on AppState 'active' — both of
 * which fire while the document picker and the restore alerts are on
 * screen. A sync landing mid-restore inserts daily_log rows into a
 * half-wiped table, and whichever transaction commits second wins.
 *
 * Fix: a module-level _restoreInProgress flag, set for the whole of
 * restoreFromPayload() and cleared in its finally. syncRollingSchedule()
 * returns immediately while it is set. Skipping is safe — the sync is
 * idempotent and runs again on the next focus.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * restoreLegacyDuplicates.test.ts.
 *
 * Issue #369
 */

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

async function dailyLogCount(db: DatabaseModule): Promise<number> {
  const raw = db.getDatabase();
  const row = await raw.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM daily_log');
  return row?.n ?? 0;
}

describe('syncRollingSchedule() during restoreFromPayload() (#369)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('is a no-op while a restore is in progress, and works again afterwards', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    // The restore wipes daily_log and puts back exactly one row. A sync
    // fired from inside the restore must not add the rolling window back.
    let countDuringRestore = -1;
    let flagDuringRestore = false;

    const originalGetAll = db.getDatabase().getAllAsync;
    const raw = db.getDatabase();
    // Hook the restore mid-flight: the first PRAGMA table_info call happens
    // inside the restore transaction, after the DELETE FROM. That is the
    // exact window a focus-triggered sync would land in.
    let hooked = false;
    (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = (async (
      ...args: Parameters<typeof originalGetAll>
    ) => {
      const result = await originalGetAll.call(raw, ...args);
      if (!hooked && typeof args[0] === 'string' && args[0].startsWith('PRAGMA table_info')) {
        hooked = true;
        flagDuringRestore = db.isRestoreInProgress();
        await db.syncRollingSchedule();
        countDuringRestore = await dailyLogCount(db);
      }
      return result;
    }) as typeof originalGetAll;

    await db.restoreFromPayload({
      daily_log: [
        {
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
        },
      ],
    });

    (raw as unknown as { getAllAsync: typeof originalGetAll }).getAllAsync = originalGetAll;

    expect(hooked).toBe(true);
    expect(flagDuringRestore).toBe(true);
    // The hook fires after DELETE FROM daily_log and before the rows are
    // re-inserted — the most dangerous moment in the restore. The sync
    // fired there added nothing, so the table is still empty. Without the
    // guard it repopulates the whole rolling window (~98 rows) into the
    // half-wiped table.
    expect(countDuringRestore).toBe(0);

    // Post-restore the flag is cleared and the sync works normally again.
    expect(db.isRestoreInProgress()).toBe(false);
    await db.syncRollingSchedule();
    expect(await dailyLogCount(db)).toBeGreaterThan(1);
  });

  it('clears the flag even when the restore throws', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await expect(
      db.restoreFromPayload({
        // NOT NULL date -> the INSERT throws inside the transaction.
        daily_log: [{ date: null, walking_task: 'Walk' }],
      })
    ).rejects.toBeDefined();

    expect(db.isRestoreInProgress()).toBe(false);

    // And the sync is live again rather than wedged off permanently.
    const before = await dailyLogCount(db);
    await db.syncRollingSchedule();
    expect(await dailyLogCount(db)).toBeGreaterThanOrEqual(before);
  });
});
