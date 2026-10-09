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

import * as FileSystem from 'expo-file-system/legacy';
import * as db from '../../db/database';
import { writeSafetySnapshot } from '../backup';

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
