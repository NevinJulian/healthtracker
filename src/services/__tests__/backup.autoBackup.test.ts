jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, { content: string; mtime: number }>();
  let clock = 1_000_000;

  const isUnder = (dir: string, uri: string) =>
    uri.startsWith(dir) && !uri.slice(dir.length).includes('/');

  return {
    __files: files,
    documentDirectory: 'file:///document/',
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: jest.fn(async () => undefined),
    writeAsStringAsync: jest.fn(async (uri: string, content: string) => {
      clock -= 1;
      files.set(uri, { content, mtime: clock });
    }),
    readAsStringAsync: jest.fn(async (uri: string) => {
      const file = files.get(uri);
      if (!file) throw new Error(`ENOENT ${uri}`);
      return file.content;
    }),
    moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const file = files.get(from);
      if (!file) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, file);
    }),
    deleteAsync: jest.fn(async (uri: string) => {
      files.delete(uri);
    }),
    readDirectoryAsync: jest.fn(async (dir: string) =>
      [...files.keys()].filter((uri) => isUnder(dir, uri)).map((uri) => uri.slice(dir.length))
    ),
    getInfoAsync: jest.fn(async (uri: string) => {
      const file = files.get(uri);
      if (file) {
        return {
          exists: true,
          isDirectory: false,
          uri,
          size: file.content.length,
          modificationTime: file.mtime,
        };
      }
      const dir = uri.endsWith('/') ? uri : `${uri}/`;
      const isDir = [...files.keys()].some((key) => key.startsWith(dir));
      return { exists: isDir, isDirectory: isDir, uri };
    }),
  };
});

jest.mock('../../db/database', () => ({
  getCurrentSchemaVersion: jest.fn(),
  listUserTables: jest.fn(),
  dumpTable: jest.fn(),
  restoreFromPayload: jest.fn(),
}));

jest.mock('../notifications', () => ({
  reconcileScheduledNotifications: jest.fn(async () => undefined),
}));

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as db from '../../db/database';
import {
  shareFile,
  writeSafetySnapshot,
  runAutoBackupIfDue,
  listAutoBackups,
  restoreBackupFromUri,
} from '../backup';

const fsMock = FileSystem as unknown as typeof FileSystem & {
  __files: Map<string, { content: string; mtime: number }>;
};
const files = fsMock.__files;
const deleteAsync = jest.mocked(FileSystem.deleteAsync);

const SAFETY_DIR = 'file:///document/safety-snapshots/';

function snapshotName(date: Date): string {
  const stamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
  return `healthtracker-pre-restore-${stamp}.json`;
}

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  jest.mocked(db.getCurrentSchemaVersion).mockResolvedValue(5);
  jest.mocked(db.listUserTables).mockResolvedValue(['daily_log']);
  jest.mocked(db.dumpTable).mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('writeSafetySnapshot', () => {
  it('writes into the safety-snapshots folder of the document directory', async () => {
    const uri = await writeSafetySnapshot();

    expect(uri.startsWith(SAFETY_DIR)).toBe(true);
    expect(files.has(uri)).toBe(true);
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(SAFETY_DIR, {
      intermediates: true,
    });
  });

  it('keeps only the newest 3 snapshots', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const base = Date.UTC(2026, 9, 8, 12, 0, 0);
    const written: string[] = [];
    for (let i = 0; i < 5; i++) {
      jest.setSystemTime(base + i * 60_000);
      written.push(await writeSafetySnapshot());
    }

    expect([...files.keys()].filter((uri) => uri.startsWith(SAFETY_DIR)).sort()).toEqual(
      written.slice(2).sort()
    );
  });

  it('leaves files that are not snapshots, and files outside the folder, alone', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const cacheFile = 'file:///cache/healthtracker-pre-restore-2026-01-01T00-00-00.json';
    const foreign = `${SAFETY_DIR}notes.txt`;
    const lookalike = `${SAFETY_DIR}healthtracker-pre-restore-2026-01-01T00-00-00.json.bak`;
    for (const uri of [cacheFile, foreign, lookalike]) {
      files.set(uri, { content: 'x', mtime: 1 });
    }
    const base = Date.UTC(2026, 9, 8, 12, 0, 0);
    for (let i = 0; i < 5; i++) {
      jest.setSystemTime(base + i * 60_000);
      await writeSafetySnapshot();
    }

    const snapshots = [...files.keys()].filter((uri) =>
      /\/safety-snapshots\/healthtracker-pre-restore-[\d-]+T[\d-]+\.json$/.test(uri)
    );
    expect(snapshots).toHaveLength(3);
    expect(files.has(cacheFile)).toBe(true);
    expect(files.has(foreign)).toBe(true);
    expect(files.has(lookalike)).toBe(true);
    expect(deleteAsync).not.toHaveBeenCalledWith(cacheFile, expect.anything());
    expect(deleteAsync).not.toHaveBeenCalledWith(foreign, expect.anything());
    expect(deleteAsync).not.toHaveBeenCalledWith(lookalike, expect.anything());
  });

  it('still returns the snapshot uri when pruning an old snapshot fails', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const base = Date.UTC(2026, 9, 8, 12, 0, 0);
    for (let i = 0; i < 3; i++) {
      files.set(`${SAFETY_DIR}${snapshotName(new Date(base + i * 60_000))}`, {
        content: 'old',
        mtime: 1,
      });
    }
    deleteAsync.mockRejectedValueOnce(new Error('disk error'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.setSystemTime(base + 10 * 60_000);

    const uri = await writeSafetySnapshot();

    expect(uri).toBe(`${SAFETY_DIR}${snapshotName(new Date(base + 10 * 60_000))}`);
    expect(files.has(uri)).toBe(true);
  });
});

const AUTO_DIR = 'file:///document/auto-backups/';
const NOW = new Date(Date.UTC(2026, 9, 8, 14, 3, 0));
const HOUR = 3_600_000;
const AUTO_NAME = /^healthtracker-auto-\d{8}T\d{6}Z\.json$/;

const writeAsyncMock = jest.mocked(FileSystem.writeAsStringAsync);
const moveAsyncMock = jest.mocked(FileSystem.moveAsync);
const readDirMock = jest.mocked(FileSystem.readDirectoryAsync);
const defaultReadDir = readDirMock.getMockImplementation();

function autoName(date: Date): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `healthtracker-auto-${stamp}.json`;
}

function seedAuto(date: Date, content = '{}'): string {
  const uri = `${AUTO_DIR}${autoName(date)}`;
  files.set(uri, { content, mtime: 1 });
  return uri;
}

function autoFiles(): string[] {
  return [...files.keys()].filter((uri) => uri.startsWith(AUTO_DIR)).sort();
}

function deletedUris(): string[] {
  return deleteAsync.mock.calls.map(([uri]) => uri);
}

describe('runAutoBackupIfDue', () => {
  beforeEach(() => {
    if (defaultReadDir) readDirMock.mockImplementation(defaultReadDir);
  });

  it('writes one backup with the UTC timestamp name when none exists', async () => {
    await runAutoBackupIfDue(NOW);

    expect(autoFiles()).toEqual([`${AUTO_DIR}${autoName(NOW)}`]);
    const name = autoFiles()[0].slice(AUTO_DIR.length);
    expect(name).toMatch(AUTO_NAME);
    expect(name).toBe('healthtracker-auto-20261008T140300Z.json');
    const saved = JSON.parse(files.get(autoFiles()[0])?.content ?? '{}');
    expect(saved.format).toBe('healthtracker-backup');
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(AUTO_DIR, { intermediates: true });
  });

  it('writes nothing when the newest backup is 23 hours old', async () => {
    const existing = seedAuto(new Date(NOW.getTime() - 23 * HOUR));

    await runAutoBackupIfDue(NOW);

    expect(autoFiles()).toEqual([existing]);
  });

  it('writes a backup when the newest is 25 hours old', async () => {
    seedAuto(new Date(NOW.getTime() - 25 * HOUR));

    await runAutoBackupIfDue(NOW);

    expect(autoFiles()).toHaveLength(2);
    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
  });

  it('writes a backup when the newest is exactly 24 hours old', async () => {
    seedAuto(new Date(NOW.getTime() - 24 * HOUR));

    await runAutoBackupIfDue(NOW);

    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
  });

  it('treats a backup dated up to an hour ahead as the newest', async () => {
    const ahead = seedAuto(new Date(NOW.getTime() + HOUR / 2));

    await runAutoBackupIfDue(NOW);

    expect(autoFiles()).toEqual([ahead]);
  });

  it('writes a backup when the newest is dated more than an hour ahead, and keeps that file', async () => {
    const ahead = seedAuto(new Date(NOW.getTime() + 2 * HOUR));

    await runAutoBackupIfDue(NOW);

    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
    expect(files.has(ahead)).toBe(true);
  });

  it('decides the newest by file name, not by file-system time', async () => {
    const oldByName = seedAuto(new Date(NOW.getTime() - 30 * HOUR));
    const touched = files.get(oldByName);
    if (touched) touched.mtime = NOW.getTime();

    await runAutoBackupIfDue(NOW);

    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
  });

  it('keeps the newest 7 valid backups and leaves foreign files alone', async () => {
    const old = Array.from({ length: 7 }, (_, i) =>
      seedAuto(new Date(NOW.getTime() - (25 + i * 24) * HOUR))
    );
    const foreign = `${AUTO_DIR}notes.txt`;
    const lookalike = `${AUTO_DIR}healthtracker-auto-20260101T000000Z.json.bak`;
    const otherPrefix = `${AUTO_DIR}healthtracker-backup-2026-01-01.json`;
    for (const uri of [foreign, lookalike, otherPrefix]) {
      files.set(uri, { content: 'keep', mtime: 1 });
    }

    await runAutoBackupIfDue(NOW);

    expect(files.has(old[6])).toBe(false);
    for (const uri of old.slice(0, 6)) expect(files.has(uri)).toBe(true);
    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
    expect(autoFiles().filter((uri) => AUTO_NAME.test(uri.slice(AUTO_DIR.length)))).toHaveLength(7);
    for (const uri of [foreign, lookalike, otherPrefix]) expect(files.has(uri)).toBe(true);
  });

  it('does not prune future-dated backups or count them toward the 7', async () => {
    const ahead = seedAuto(new Date(NOW.getTime() + 5 * HOUR));
    const old = Array.from({ length: 7 }, (_, i) =>
      seedAuto(new Date(NOW.getTime() - (25 + i * 24) * HOUR))
    );

    await runAutoBackupIfDue(NOW);

    expect(files.has(ahead)).toBe(true);
    expect(files.has(old[6])).toBe(false);
    expect(files.has(old[5])).toBe(true);
  });

  it('prunes nothing when no new backup was due', async () => {
    const recent = seedAuto(new Date(NOW.getTime() - HOUR));
    const older = Array.from({ length: 8 }, (_, i) =>
      seedAuto(new Date(NOW.getTime() - (30 + i * 24) * HOUR))
    );

    await runAutoBackupIfDue(NOW);

    expect(files.has(recent)).toBe(true);
    for (const uri of older) expect(files.has(uri)).toBe(true);
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('removes leftover temporary files and never lists them', async () => {
    const tmp = `${AUTO_DIR}${autoName(new Date(NOW.getTime() - HOUR))}.tmp`;
    files.set(tmp, { content: 'half', mtime: 1 });

    await runAutoBackupIfDue(NOW);

    expect(files.has(tmp)).toBe(false);
    expect(autoFiles()).toEqual([`${AUTO_DIR}${autoName(NOW)}`]);
  });

  it('never deletes a name that is not a plain auto-backup name', async () => {
    const valid = Array.from({ length: 9 }, (_, i) =>
      autoName(new Date(NOW.getTime() - (25 + i * 24) * HOUR))
    );
    const hostile = [
      '../healthtracker-auto-20200101T000000Z.json',
      '..',
      'sub/healthtracker-auto-20200101T000000Z.json',
      'healthtracker-auto-20200101T000000Z.json/../../SQLite/healthtracker.db',
      'healthtracker-auto-20201341T250000Z.json',
    ];
    readDirMock.mockResolvedValue([...hostile, ...valid]);

    await runAutoBackupIfDue(NOW);

    const deleted = deletedUris();
    expect(deleted.length).toBeGreaterThan(0);
    for (const uri of deleted) {
      expect(uri.startsWith(AUTO_DIR)).toBe(true);
      expect(valid).toContain(uri.slice(AUTO_DIR.length));
    }
  });

  it('rejects, removes the temp file and deletes nothing else when the write fails', async () => {
    const existing = seedAuto(new Date(NOW.getTime() - 25 * HOUR));
    writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));

    await expect(runAutoBackupIfDue(NOW)).rejects.toThrow('disk full');

    expect(autoFiles()).toEqual([existing]);
    expect(deletedUris()).toEqual([`${AUTO_DIR}${autoName(NOW)}.tmp`]);
  });

  it('rejects and removes the temp file when moving it into place fails', async () => {
    const existing = seedAuto(new Date(NOW.getTime() - 25 * HOUR));
    moveAsyncMock.mockRejectedValueOnce(new Error('move failed'));

    await expect(runAutoBackupIfDue(NOW)).rejects.toThrow('move failed');

    expect(autoFiles()).toEqual([existing]);
    expect(deletedUris()).toEqual([`${AUTO_DIR}${autoName(NOW)}.tmp`]);
  });

  it('writes under a temporary name first and only then moves it into place', async () => {
    await runAutoBackupIfDue(NOW);

    const finalUri = `${AUTO_DIR}${autoName(NOW)}`;
    const written = writeAsyncMock.mock.calls.map(([uri]) => uri);
    expect(written).toContain(`${finalUri}.tmp`);
    expect(written).not.toContain(finalUri);
    expect(moveAsyncMock).toHaveBeenCalledWith({ from: `${finalUri}.tmp`, to: finalUri });
  });

  it('still succeeds and deletes the others when one prune delete fails', async () => {
    const old = Array.from({ length: 9 }, (_, i) =>
      seedAuto(new Date(NOW.getTime() - (25 + i * 24) * HOUR))
    );
    deleteAsync.mockRejectedValueOnce(new Error('locked'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runAutoBackupIfDue(NOW)).resolves.toBeUndefined();

    expect(files.has(`${AUTO_DIR}${autoName(NOW)}`)).toBe(true);
    // 10 valid files after the write, so 3 are over the limit. One delete fails,
    // the other two still go.
    expect(old.slice(0, 6).every((uri) => files.has(uri))).toBe(true);
    expect(old.slice(6).filter((uri) => files.has(uri))).toHaveLength(1);
    expect(deleteAsync).toHaveBeenCalledTimes(3);
  });

  it('runs once for two concurrent calls', async () => {
    const first = runAutoBackupIfDue(NOW);
    const second = runAutoBackupIfDue(NOW);

    await Promise.all([first, second]);

    expect(second).toBe(first);
    const writes = writeAsyncMock.mock.calls.filter(([uri]) => uri.startsWith(AUTO_DIR));
    expect(writes).toHaveLength(1);
  });

  it('can run again after a run has finished', async () => {
    await runAutoBackupIfDue(NOW);
    await runAutoBackupIfDue(new Date(NOW.getTime() + 25 * HOUR));

    expect(autoFiles()).toHaveLength(2);
  });
});

describe('listAutoBackups', () => {
  beforeEach(() => {
    if (defaultReadDir) readDirMock.mockImplementation(defaultReadDir);
  });

  it('is empty when the folder does not exist yet', async () => {
    await expect(listAutoBackups()).resolves.toEqual([]);
  });

  it('lists valid backups newest first with date and size, ignoring other files', async () => {
    const older = seedAuto(new Date(NOW.getTime() - 48 * HOUR), 'a'.repeat(10));
    const newer = seedAuto(new Date(NOW.getTime() - 2 * HOUR), 'b'.repeat(2048));
    files.set(`${AUTO_DIR}notes.txt`, { content: 'x', mtime: 9_999_999 });
    files.set(`${AUTO_DIR}${autoName(NOW)}.tmp`, { content: 'x', mtime: 9_999_999 });
    const newerFile = files.get(newer);
    if (newerFile) newerFile.mtime = 1;

    const list = await listAutoBackups();

    expect(list.map((entry) => entry.uri)).toEqual([newer, older]);
    expect(list[0]).toEqual({
      name: autoName(new Date(NOW.getTime() - 2 * HOUR)),
      uri: newer,
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
      sizeBytes: 2048,
    });
    expect(list[1].sizeBytes).toBe(10);
  });

  it('lists a future-dated backup as it is', async () => {
    const ahead = seedAuto(new Date(NOW.getTime() + 10 * 24 * HOUR));

    const list = await listAutoBackups();

    expect(list.map((entry) => entry.uri)).toEqual([ahead]);
  });

  it('drops an entry whose file has gone missing', async () => {
    const kept = seedAuto(new Date(NOW.getTime() - 2 * HOUR));
    const missing = autoName(new Date(NOW.getTime() - 50 * HOUR));
    readDirMock.mockResolvedValue([autoName(new Date(NOW.getTime() - 2 * HOUR)), missing]);

    const list = await listAutoBackups();

    expect(list.map((entry) => entry.uri)).toEqual([kept]);
  });
});

describe('shareFile', () => {
  it('keeps the safety backup dialog title by default', async () => {
    await shareFile('file:///a.json');

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///a.json', {
      mimeType: 'application/json',
      dialogTitle: 'Save your safety backup',
      UTI: 'public.json',
    });
  });

  it('uses the dialog title it is given', async () => {
    await shareFile('file:///a.json', 'Save your HealthTracker backup');

    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///a.json', {
      mimeType: 'application/json',
      dialogTitle: 'Save your HealthTracker backup',
      UTI: 'public.json',
    });
  });

  it('returns false and shares nothing when sharing is unavailable', async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);

    await expect(shareFile('file:///a.json', 'Title')).resolves.toBe(false);

    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('restoreBackupFromUri', () => {
  const SOURCE = 'file:///cache/picked.json';
  const tables = { daily_log: [{ date: '2026-10-01' }], settings: [{ key: 'a', value: '1' }] };
  const restoreFromPayload = jest.mocked(db.restoreFromPayload);

  function payloadJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      format: 'healthtracker-backup',
      version: 1,
      appVersion: '1.0.0',
      schemaVersion: 5,
      createdAt: '2026-10-01T00:00:00.000Z',
      tables,
      ...overrides,
    });
  }

  beforeEach(() => {
    if (defaultReadDir) readDirMock.mockImplementation(defaultReadDir);
    restoreFromPayload.mockReset();
    restoreFromPayload.mockResolvedValue({ tablesRestored: 2, rowsRestored: 2 });
    files.set(SOURCE, { content: payloadJson(), mtime: 1 });
  });

  it('validates, writes a safety snapshot, then restores the file tables', async () => {
    let snapshotExistedAtRestore = false;
    restoreFromPayload.mockImplementation(async () => {
      snapshotExistedAtRestore = [...files.keys()].some((uri) => uri.startsWith(SAFETY_DIR));
      return { tablesRestored: 2, rowsRestored: 2 };
    });

    const result = await restoreBackupFromUri(SOURCE);

    expect(restoreFromPayload).toHaveBeenCalledWith(tables, 5);
    expect(snapshotExistedAtRestore).toBe(true);
    expect(result).toEqual({
      tablesRestored: 2,
      rowsRestored: 2,
      safetySnapshotUri: expect.stringMatching(/^file:\/\/\/document\/safety-snapshots\//),
    });
  });

  it('rejects an invalid file before writing a snapshot or touching data', async () => {
    files.set(SOURCE, { content: payloadJson({ format: 'other' }), mtime: 1 });

    await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow('not created by HealthTracker');

    expect(restoreFromPayload).not.toHaveBeenCalled();
    expect([...files.keys()].some((uri) => uri.startsWith(SAFETY_DIR))).toBe(false);
  });

  it('rejects a file that is not JSON', async () => {
    files.set(SOURCE, { content: 'not json', mtime: 1 });

    await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow('could not parse JSON');

    expect(restoreFromPayload).not.toHaveBeenCalled();
  });

  it('aborts when the safety snapshot fails and the caller declines to continue', async () => {
    writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));
    const onSnapshotFailed = jest.fn(async () => false);

    await expect(restoreBackupFromUri(SOURCE, { onSnapshotFailed })).rejects.toThrow(
      'Restore aborted'
    );

    expect(onSnapshotFailed).toHaveBeenCalledWith('disk full');
    expect(restoreFromPayload).not.toHaveBeenCalled();
  });

  it('restores without a snapshot uri when the caller chooses to continue', async () => {
    writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));

    const result = await restoreBackupFromUri(SOURCE, { onSnapshotFailed: async () => true });

    expect(result?.safetySnapshotUri).toBe('');
    expect(restoreFromPayload).toHaveBeenCalledTimes(1);
  });

  it('reports a failed restore as leaving the data unchanged', async () => {
    restoreFromPayload.mockRejectedValue(new Error('constraint'));

    await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow(
      'Restore failed — your existing data was not changed'
    );
  });

  it('never modifies or deletes the file it restores from', async () => {
    const autoUri = seedAuto(new Date(NOW.getTime() - 5 * HOUR), payloadJson());

    await restoreBackupFromUri(autoUri);

    expect(files.get(autoUri)?.content).toBe(payloadJson());
    expect(deletedUris()).not.toContain(autoUri);
    expect(writeAsyncMock.mock.calls.map(([uri]) => uri)).not.toContain(autoUri);
    expect(moveAsyncMock).not.toHaveBeenCalled();
  });

  it('keeps automatic backups from running while a restore is in progress', async () => {
    let release: () => void = () => undefined;
    restoreFromPayload.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ tablesRestored: 2, rowsRestored: 2 });
        })
    );

    const restoring = restoreBackupFromUri(SOURCE);
    await new Promise((resolve) => setImmediate(resolve));
    await runAutoBackupIfDue(NOW);
    expect(autoFiles()).toEqual([]);

    release();
    await restoring;
    await runAutoBackupIfDue(NOW);
    expect(autoFiles()).toEqual([`${AUTO_DIR}${autoName(NOW)}`]);
  });

  it('allows automatic backups again after a restore fails', async () => {
    restoreFromPayload.mockRejectedValue(new Error('constraint'));
    await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow();

    await runAutoBackupIfDue(NOW);

    expect(autoFiles()).toEqual([`${AUTO_DIR}${autoName(NOW)}`]);
  });
});
