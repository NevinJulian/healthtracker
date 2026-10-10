import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type BackupModule = typeof import('../../services/backup');

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

// The notification resync after a restore records this marker in app_state.
const RESYNC_MARKER = 'notificationIdSweepV1Done';

function canonical(rows: Record<string, unknown>[]): string[] {
  return rows
    .filter((row) => row.key !== RESYNC_MARKER)
    .map((row) => JSON.stringify(row))
    .sort();
}

describe('automatic backup round trip', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.dontMock('expo-file-system/legacy');
  });

  it('restores the database to the state the automatic backup was taken in', async () => {
    const files = new Map<string, string>();
    const { db, backup } = loadFreshModules(files);
    await db.initDatabase();

    await db.setSetting('autoBackupKey', 'before');
    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 8, weightKg: 60 });
    await db.updateTemplateDay(1, 'Custom Walk Task', 'Custom Hammer Task');
    const before = await backup.buildBackupPayload();

    await backup.runAutoBackupIfDue(new Date('2026-10-08T14:03:00Z'));
    const [entry] = await backup.listAutoBackups();
    expect(entry.name).toBe('healthtracker-auto-20261008T140300Z.json');

    await db.setSetting('autoBackupKey', 'after');
    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 3, weightKg: 100 });
    await db.updateTemplateDay(1, 'Other Walk Task', 'Other Hammer Task');
    const changed = await backup.buildBackupPayload();
    expect(canonical(changed.tables.app_state)).not.toEqual(canonical(before.tables.app_state));

    const result = await backup.restoreBackupFromUri(entry.uri);

    expect(result.safetySnapshotUri.startsWith('file:///document/safety-snapshots/')).toBe(true);
    const after = await backup.buildBackupPayload();
    expect(Object.keys(after.tables).sort()).toEqual(Object.keys(before.tables).sort());
    for (const table of Object.keys(before.tables)) {
      expect({ table, rows: canonical(after.tables[table]) }).toEqual({
        table,
        rows: canonical(before.tables[table]),
      });
    }
    expect(files.has(entry.uri)).toBe(true);
  });
});
