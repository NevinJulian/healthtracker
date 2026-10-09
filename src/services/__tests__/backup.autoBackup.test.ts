jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, { content: string; mtime: number }>();
  const dirs = new Set<string>();
  let clock = 1_000_000;

  const isUnder = (dir: string, uri: string) =>
    uri.startsWith(dir) && !uri.slice(dir.length).includes('/');
  const withSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);
  const dirExists = (uri: string) => {
    const dir = withSlash(uri);
    return dirs.has(dir) || [...files.keys()].some((key) => key.startsWith(dir));
  };

  return {
    __files: files,
    __dirs: dirs,
    documentDirectory: 'file:///document/',
    cacheDirectory: 'file:///cache/',
    makeDirectoryAsync: jest.fn(async (uri: string) => {
      dirs.add(withSlash(uri));
    }),
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
    readDirectoryAsync: jest.fn(async (dir: string) => {
      if (!dirExists(dir)) throw new Error(`Location '${dir}' isn't readable or doesn't exist`);
      return [...files.keys()].filter((uri) => isUnder(dir, uri)).map((uri) => uri.slice(dir.length));
    }),
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
      const isDir = dirExists(uri);
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
  listSafetySnapshots,
  restoreBackupFromUri,
} from '../backup';

const fsMock = FileSystem as unknown as typeof FileSystem & {
  __files: Map<string, { content: string; mtime: number }>;
  __dirs: Set<string>;
};
const files = fsMock.__files;
const dirs = fsMock.__dirs;
const deleteAsync = jest.mocked(FileSystem.deleteAsync);
const writeAsyncMock = jest.mocked(FileSystem.writeAsStringAsync);
const moveAsyncMock = jest.mocked(FileSystem.moveAsync);

const SAFETY_DIR = 'file:///document/safety-snapshots/';
const NOW = new Date(Date.UTC(2026, 9, 8, 14, 3, 0));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function snapshotName(date: Date): string {
  const stamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
  return `healthtracker-pre-restore-${stamp}.json`;
}

function safetyFiles(): string[] {
  return [...files.keys()].filter((uri) => uri.startsWith(SAFETY_DIR)).sort();
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function seedSnapshot(date: Date): string {
  const uri = `${SAFETY_DIR}${snapshotName(date)}`;
  files.set(uri, { content: 'old', mtime: 1 });
  return uri;
}

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  dirs.clear();
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

  it('writes under a temporary name first and only then moves it into place', async () => {
    const uri = await writeSafetySnapshot();

    expect(writeAsyncMock.mock.calls.map(([written]) => written)).toEqual([`${uri}.tmp`]);
    expect(moveAsyncMock).toHaveBeenCalledWith({ from: `${uri}.tmp`, to: uri });
    expect(safetyFiles()).toEqual([uri]);
  });

  it('rejects and leaves no file behind when the write stops halfway', async () => {
    writeAsyncMock.mockImplementationOnce(async (uri: string) => {
      files.set(uri, { content: '{"format": "healthtracker-ba', mtime: 1 });
      throw new Error('disk full');
    });

    await expect(writeSafetySnapshot()).rejects.toThrow('disk full');

    expect(safetyFiles()).toEqual([]);
  });

  it('rejects and leaves no file behind when moving it into place fails', async () => {
    moveAsyncMock.mockRejectedValueOnce(new Error('move failed'));

    await expect(writeSafetySnapshot()).rejects.toThrow('move failed');

    expect(safetyFiles()).toEqual([]);
  });

  it('still rejects with the write error when the temporary file cannot be removed', async () => {
    writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));
    deleteAsync.mockRejectedValueOnce(new Error('locked'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(writeSafetySnapshot()).rejects.toThrow('disk full');
  });

  it('removes a temporary file left behind by an interrupted write', async () => {
    const leftover = `${SAFETY_DIR}${snapshotName(new Date(Date.UTC(2026, 9, 1, 8, 0, 0)))}.tmp`;
    files.set(leftover, { content: '{"format":', mtime: 1 });

    const uri = await writeSafetySnapshot();

    expect(safetyFiles()).toEqual([uri]);
  });

  it('deletes no other snapshot, however many and however old they are', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(NOW);
    const old = [10, 20, 30, 40, 50].map((days) => seedSnapshot(daysAgo(days)));

    const uri = await writeSafetySnapshot();

    expect(safetyFiles()).toEqual([uri, ...old].sort());
    expect(deleteAsync).not.toHaveBeenCalled();
  });

  it('does not delete the snapshot of the same second when written twice', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(Date.UTC(2026, 9, 8, 12, 0, 0));

    const first = await writeSafetySnapshot();
    const second = await writeSafetySnapshot();

    expect(second).toBe(first);
    expect(files.has(second)).toBe(true);
    expect(deleteAsync).not.toHaveBeenCalled();
  });
});

const AUTO_DIR = 'file:///document/auto-backups/';
const AUTO_NAME = /^healthtracker-auto-\d{8}T\d{6}Z\.json$/;

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

  it('logs no warning or error on the first run, when no folder exists yet', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await runAutoBackupIfDue(NOW);
    await writeSafetySnapshot();

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
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

describe('listSafetySnapshots', () => {
  beforeEach(() => {
    if (defaultReadDir) readDirMock.mockImplementation(defaultReadDir);
  });

  it('is empty when the folder does not exist yet', async () => {
    await expect(listSafetySnapshots()).resolves.toEqual([]);
  });

  it('lists valid snapshots newest first with date and size, ignoring other files', async () => {
    const older = seedSnapshot(daysAgo(3));
    const newer = seedSnapshot(daysAgo(1));
    files.set(older, { content: 'a'.repeat(10), mtime: 9_999_999 });
    files.set(newer, { content: 'b'.repeat(2048), mtime: 1 });
    files.set(`${SAFETY_DIR}notes.txt`, { content: 'x', mtime: 1 });
    files.set(`${SAFETY_DIR}${snapshotName(NOW)}.tmp`, { content: 'half', mtime: 1 });
    files.set(`${SAFETY_DIR}healthtracker-pre-restore-2026-13-41T25-00-00.json`, {
      content: 'x',
      mtime: 1,
    });
    seedAuto(daysAgo(2));

    const list = await listSafetySnapshots();

    expect(list).toEqual([
      { name: snapshotName(daysAgo(1)), uri: newer, createdAt: daysAgo(1), sizeBytes: 2048 },
      { name: snapshotName(daysAgo(3)), uri: older, createdAt: daysAgo(3), sizeBytes: 10 },
    ]);
  });

  it('lists the snapshot a restore has just written', async () => {
    files.set('file:///cache/picked.json', {
      content: JSON.stringify({
        format: 'healthtracker-backup',
        version: 1,
        appVersion: '1.0.0',
        schemaVersion: 5,
        createdAt: '2026-10-01T00:00:00.000Z',
        tables: {},
      }),
      mtime: 1,
    });
    jest.mocked(db.restoreFromPayload).mockResolvedValue({ tablesRestored: 0, rowsRestored: 0 });

    const { safetySnapshotUri } = await restoreBackupFromUri('file:///cache/picked.json');

    expect((await listSafetySnapshots()).map((entry) => entry.uri)).toEqual([safetySnapshotUri]);
  });

  it('drops an entry whose file has gone missing', async () => {
    const kept = seedSnapshot(daysAgo(1));
    readDirMock.mockResolvedValue([snapshotName(daysAgo(1)), snapshotName(daysAgo(2))]);

    const list = await listSafetySnapshots();

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
    expect(moveAsyncMock.mock.calls.flatMap(([{ from, to }]) => [from, to])).not.toContain(autoUri);
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

  describe('pruning safety snapshots', () => {
    const fresh = `${SAFETY_DIR}${snapshotName(NOW)}`;

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(NOW);
    });

    it('keeps every snapshot from the last 7 days, however many there are', async () => {
      const recent = [1, 2, 3, 4, 5, 6].map((days) => seedSnapshot(daysAgo(days)));

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh, ...recent].sort());
      expect(deleteAsync).not.toHaveBeenCalled();
    });

    it('deletes snapshots older than 7 days once three newer ones exist', async () => {
      const recent = [1, 2].map((days) => seedSnapshot(daysAgo(days)));
      [8, 9, 30].forEach((days) => seedSnapshot(daysAgo(days)));

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh, ...recent].sort());
    });

    it('keeps a snapshot exactly 7 days old and deletes one a second older', async () => {
      const recent = [1, 2].map((days) => seedSnapshot(daysAgo(days)));
      const onTheLine = seedSnapshot(daysAgo(7));
      seedSnapshot(new Date(daysAgo(7).getTime() - 1000));

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh, ...recent, onTheLine].sort());
    });

    it('always keeps the newest 3, even when they are older than 7 days', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh, old[0], old[1]].sort());
    });

    it('keeps the newest 3 when no snapshot could be written and the caller continues', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));
      writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));

      await restoreBackupFromUri(SOURCE, { onSnapshotFailed: async () => true });

      expect(safetyFiles()).toEqual(old.slice(0, 3).sort());
    });

    it('deletes nothing until the restore has succeeded', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));
      let presentDuringRestore: string[] = [];
      restoreFromPayload.mockImplementation(async () => {
        presentDuringRestore = safetyFiles();
        return { tablesRestored: 2, rowsRestored: 2 };
      });

      await restoreBackupFromUri(SOURCE);

      expect(presentDuringRestore).toEqual([fresh, ...old].sort());
    });

    it('deletes nothing when the restore fails', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));
      restoreFromPayload.mockRejectedValue(new Error('constraint'));

      await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow('Restore failed');

      expect(safetyFiles()).toEqual([fresh, ...old].sort());
      expect(deleteAsync).not.toHaveBeenCalled();
    });

    it('deletes nothing when the restore is aborted because the snapshot failed', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));
      writeAsyncMock.mockRejectedValueOnce(new Error('disk full'));

      await expect(restoreBackupFromUri(SOURCE)).rejects.toThrow('Restore aborted');

      expect(safetyFiles()).toEqual([...old].sort());
    });

    it('never deletes a snapshot dated ahead of the clock, and does not count it toward the 3', async () => {
      const ahead = [1, 2, 365].map((days) => seedSnapshot(daysAgo(-days)));
      const old = [10, 20, 30].map((days) => seedSnapshot(daysAgo(days)));

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh, ...ahead, old[0], old[1]].sort());
    });

    it('leaves files that are not snapshots, and files outside the folder, alone', async () => {
      const others = [
        'file:///cache/healthtracker-pre-restore-2026-01-01T00-00-00.json',
        `${SAFETY_DIR}notes.txt`,
        `${SAFETY_DIR}healthtracker-pre-restore-2026-01-01T00-00-00.json.bak`,
        `${SAFETY_DIR}healthtracker-pre-restore-2026-13-41T25-00-00.json`,
        `${AUTO_DIR}${autoName(daysAgo(40))}`,
      ];
      for (const uri of others) files.set(uri, { content: 'keep', mtime: 1 });
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));

      await restoreBackupFromUri(SOURCE);

      expect(deletedUris().sort()).toEqual([old[2], old[3]].sort());
      for (const uri of others) expect(files.has(uri)).toBe(true);
    });

    it('never deletes a name that is not a plain snapshot name', async () => {
      const valid = [10, 20, 30, 40, 50].map((days) => snapshotName(daysAgo(days)));
      const hostile = [
        '../healthtracker-pre-restore-2020-01-01T00-00-00.json',
        '..',
        'sub/healthtracker-pre-restore-2020-01-01T00-00-00.json',
        'healthtracker-pre-restore-2020-01-01T00-00-00.json/../../SQLite/healthtracker.db',
        'healthtracker-pre-restore-2020-13-41T25-00-00.json',
      ];
      readDirMock.mockResolvedValue([...hostile, ...valid]);

      await restoreBackupFromUri(SOURCE);

      const deleted = deletedUris();
      expect(deleted.length).toBeGreaterThan(0);
      for (const uri of deleted) {
        expect(uri.startsWith(SAFETY_DIR)).toBe(true);
        expect(valid).toContain(uri.slice(SAFETY_DIR.length));
      }
    });

    it('still reports the restore as done and deletes the others when one delete fails', async () => {
      const old = [10, 20, 30, 40, 50].map((days) => seedSnapshot(daysAgo(days)));
      deleteAsync.mockRejectedValueOnce(new Error('locked'));
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await restoreBackupFromUri(SOURCE);

      expect(result.safetySnapshotUri).toBe(fresh);
      expect(old.slice(2).filter((uri) => files.has(uri))).toHaveLength(1);
      expect(deleteAsync).toHaveBeenCalledTimes(3);
    });

    it('still reports the restore as done when the folder cannot be read', async () => {
      const old = [10, 20, 30, 40].map((days) => seedSnapshot(daysAgo(days)));
      restoreFromPayload.mockImplementation(async () => {
        readDirMock.mockRejectedValueOnce(new Error('unreadable'));
        return { tablesRestored: 2, rowsRestored: 2 };
      });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await restoreBackupFromUri(SOURCE);

      expect(result.tablesRestored).toBe(2);
      expect(safetyFiles()).toEqual([fresh, ...old].sort());
      expect(warn).toHaveBeenCalledWith(
        '[Backup] Failed to prune safety snapshots:',
        expect.any(Error)
      );
    });

    it('logs no warning on a first restore, when no snapshot folder exists yet', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await restoreBackupFromUri(SOURCE);

      expect(safetyFiles()).toEqual([fresh]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
