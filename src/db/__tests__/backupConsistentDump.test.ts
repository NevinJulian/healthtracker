/**
 * A backup dump is one point in time: every table in the file is from the
 * same moment. The dump reads its tables as one unit on the write queue, so
 * a write or a restore that arrives while it is running lands after it, and
 * a dump that arrives during a restore waits for the restore.
 *
 * The interrupting call is fired, not awaited, from inside the unit that
 * holds the queue: awaiting a queued call from there would never settle.
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type BackupModule = typeof import('../../services/backup');
type Tables = Record<string, Record<string, unknown>[]>;

function loadFreshModules(files: Map<string, string>): { db: DatabaseModule; backup: BackupModule } {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  jest.doMock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///document/',
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: async () => undefined,
    writeAsStringAsync: async (uri: string, content: string) => {
      files.set(uri, content);
    },
    readAsStringAsync: async (uri: string) => {
      const content = files.get(uri);
      if (content === undefined) throw new Error(`ENOENT ${uri}`);
      return content;
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    deleteAsync: async (uri: string) => {
      files.delete(uri);
    },
    readDirectoryAsync: async (dir: string) =>
      [...files.keys()]
        .filter((uri) => uri.startsWith(dir) && !uri.slice(dir.length).includes('/'))
        .map((uri) => uri.slice(dir.length)),
    getInfoAsync: async (uri: string) => {
      const content = files.get(uri);
      if (content !== undefined) return { exists: true, isDirectory: false, uri, size: content.length };
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      const isDir = [...files.keys()].some((key) => key.startsWith(prefix));
      return { exists: isDir, isDirectory: isDir, uri };
    },
  }));
  const db = require('../database') as DatabaseModule;
  const backup = require('../../services/backup') as BackupModule;
  return { db, backup };
}

async function yieldMacrotasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/**
 * Hooks the first getAllAsync whose SQL matches `when`. Once that read has
 * returned, the hook fires `interrupt` without awaiting it and gives it every
 * chance to run before the caller carries on.
 */
function interruptAt(
  db: DatabaseModule,
  when: (sql: string) => boolean,
  interrupt: () => Promise<unknown>
): { fired: () => Promise<unknown> | null; unhook: () => void } {
  const raw = db.getDatabase();
  const original = raw.getAllAsync;
  const hooked = raw as unknown as { getAllAsync: typeof original };
  let fired: Promise<unknown> | null = null;
  hooked.getAllAsync = (async (...args: Parameters<typeof original>) => {
    const result = await original.apply(raw, args);
    if (fired === null && typeof args[0] === 'string' && when(args[0])) {
      fired = interrupt();
      fired.catch(() => {});
      await yieldMacrotasks();
    }
    return result;
  }) as typeof original;
  return {
    fired: () => fired,
    unhook: () => {
      hooked.getAllAsync = original;
    },
  };
}

function canonical(tables: Tables): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => JSON.stringify(row)).sort()])
  );
}

function readTables(files: Map<string, string>, uri: string): Tables {
  return (JSON.parse(files.get(uri) ?? '{}') as { tables: Tables }).tables;
}

const RECIPE_ID = 'r001';
const PLAN_DATE = '2026-10-08';

function portionsLeft(tables: Tables): number {
  return tables.meal_inventory.reduce((sum, row) => sum + Number(row.portions_available), 0);
}

function mealsEaten(tables: Tables): number {
  return tables.weekly_meal_plan.filter((row) => row.is_consumed === 1).length;
}

const DUMPS: [string, (backup: BackupModule, files: Map<string, string>) => Promise<Tables>][] = [
  ['buildBackupPayload', async (backup) => (await backup.buildBackupPayload()).tables],
  ['the manual export', async (backup, files) => readTables(files, await backup.exportBackup())],
  ['the safety snapshot', async (backup, files) => readTables(files, await backup.writeSafetySnapshot())],
  [
    'the automatic backup',
    async (backup, files) => {
      await backup.runAutoBackupIfDue(new Date('2026-10-08T14:03:00Z'));
      const [entry] = await backup.listAutoBackups();
      return readTables(files, entry.uri);
    },
  ],
];

describe('backup dump consistency', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.dontMock('expo-file-system/legacy');
  });

  it.each(DUMPS)(
    '%s: a meal ticked off while the dump is between two tables is not half in the file',
    async (_name, dump) => {
      const files = new Map<string, string>();
      const { db, backup } = loadFreshModules(files);
      await db.initDatabase();
      await db.logCookedMeal(RECIPE_ID, 3);
      await db.assignMealToPlan(PLAN_DATE, 'dinner', RECIPE_ID);
      const plan = await db.getDatabase().getFirstAsync<{ id: number }>(
        'SELECT id FROM weekly_meal_plan WHERE date = ?',
        [PLAN_DATE]
      );
      if (!plan) throw new Error('plan row not found');

      // recipe_library is read after meal_inventory and before
      // weekly_meal_plan. Ticking the meal takes a portion from the first
      // and marks the row in the second.
      const hook = interruptAt(
        db,
        (sql) => sql === 'SELECT * FROM recipe_library',
        () => db.toggleMealConsumed(plan.id, true)
      );
      const tables = await dump(backup, files);
      hook.unhook();

      expect(hook.fired()).not.toBeNull();
      await expect(hook.fired()).resolves.toBeUndefined();
      expect({ portionsLeft: portionsLeft(tables), mealsEaten: mealsEaten(tables) }).toEqual({
        portionsLeft: 3,
        mealsEaten: 0,
      });

      const live = (await backup.buildBackupPayload()).tables;
      expect({ portionsLeft: portionsLeft(live), mealsEaten: mealsEaten(live) }).toEqual({
        portionsLeft: 2,
        mealsEaten: 1,
      });
    }
  );

  it('a restore fired while the dump is between two tables lands after the dump', async () => {
    const files = new Map<string, string>();
    const { db, backup } = loadFreshModules(files);
    await db.initDatabase();
    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 8, weightKg: 60 });
    const schemaVersion = await db.getCurrentSchemaVersion();
    const before = (await backup.buildBackupPayload()).tables;

    // daily_log is read after app_state and before workout_set_log.
    const hook = interruptAt(
      db,
      (sql) => sql === 'SELECT * FROM daily_log',
      () =>
        db.restoreFromPayload(
          { app_state: [{ key: 'marker', value: 'restored' }], workout_set_log: [] },
          schemaVersion
        )
    );
    const during = (await backup.buildBackupPayload()).tables;
    hook.unhook();

    expect(hook.fired()).not.toBeNull();
    await expect(hook.fired()).resolves.toBeDefined();
    expect(canonical(during)).toEqual(canonical(before));

    const after = (await backup.buildBackupPayload()).tables;
    expect(after.app_state).toEqual([{ key: 'marker', value: 'restored' }]);
    expect(after.workout_set_log).toEqual([]);
  });

  it('a dump fired in the middle of a restore waits for it and reads the restored data', async () => {
    const files = new Map<string, string>();
    const { db, backup } = loadFreshModules(files);
    await db.initDatabase();
    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 8, weightKg: 60 });
    const schemaVersion = await db.getCurrentSchemaVersion();

    // The first PRAGMA table_info is inside the restore's transaction, after
    // DELETE FROM app_state and before its rows are inserted again.
    let dumped: Tables | null = null;
    const hook = interruptAt(
      db,
      (sql) => sql.startsWith('PRAGMA table_info'),
      async () => {
        dumped = (await backup.buildBackupPayload()).tables;
      }
    );
    await db.restoreFromPayload(
      { app_state: [{ key: 'marker', value: 'restored' }], workout_set_log: [] },
      schemaVersion
    );
    hook.unhook();

    expect(hook.fired()).not.toBeNull();
    await hook.fired();
    const after = (await backup.buildBackupPayload()).tables;
    expect(dumped).not.toBeNull();
    expect(canonical(dumped ?? {})).toEqual(canonical(after));
    expect(after.app_state).toEqual([{ key: 'marker', value: 'restored' }]);
  });

  it('a full restore, which dumps and then restores on the same queue, completes and leaves the queue free', async () => {
    const files = new Map<string, string>();
    const { db, backup } = loadFreshModules(files);
    await db.initDatabase();
    const source = await backup.writeSafetySnapshot();

    const [result, concurrentDump] = await Promise.all([
      backup.restoreBackupFromUri(source),
      backup.buildBackupPayload(),
    ]);

    expect(result.tablesRestored).toBeGreaterThan(0);
    expect(Object.keys(concurrentDump.tables)).toContain('daily_log');
    await expect(db.setSetting('afterRestore', 'ok')).resolves.toBeUndefined();
    await expect(db.getSetting('afterRestore')).resolves.toBe('ok');
  });
});
