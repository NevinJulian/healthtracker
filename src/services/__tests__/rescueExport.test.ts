import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { exportRawDatabase } from '../rescueExport';

const getInfo = FileSystem.getInfoAsync as jest.Mock;
const copy = FileSystem.copyAsync as jest.Mock;
const share = Sharing.shareAsync as jest.Mock;

const DB = 'file:///document/SQLite/healthtracker.db';
const WAL = `${DB}-wal`;

function present(...uris: string[]) {
  getInfo.mockImplementation((uri: string) =>
    Promise.resolve({ exists: uris.includes(uri), isDirectory: false }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  copy.mockResolvedValue(undefined);
  share.mockResolvedValue(undefined);
});

describe('exportRawDatabase', () => {
  it('shares the db then the wal when both exist', async () => {
    present(DB, WAL);
    await exportRawDatabase();
    expect(copy).toHaveBeenCalledWith({ from: DB, to: 'file:///cache/healthtracker.db' });
    expect(copy).toHaveBeenCalledWith({ from: WAL, to: 'file:///cache/healthtracker.db-wal' });
    expect(share).toHaveBeenCalledTimes(2);
    expect(share.mock.calls[0][0]).toBe('file:///cache/healthtracker.db');
    expect(share.mock.calls[1][0]).toBe('file:///cache/healthtracker.db-wal');
  });

  it('shares only the db when there is no wal', async () => {
    present(DB);
    await exportRawDatabase();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toBe('file:///cache/healthtracker.db');
  });

  it('rejects when the db file is missing', async () => {
    present();
    await expect(exportRawDatabase()).rejects.toThrow(/database file/i);
    expect(share).not.toHaveBeenCalled();
  });

  it('rejects when copying fails', async () => {
    present(DB);
    copy.mockRejectedValueOnce(new Error('disk full'));
    await expect(exportRawDatabase()).rejects.toThrow('disk full');
    expect(share).not.toHaveBeenCalled();
  });

  it('rejects when sharing fails', async () => {
    present(DB, WAL);
    share.mockRejectedValueOnce(new Error('no share target'));
    await expect(exportRawDatabase()).rejects.toThrow('no share target');
  });
});
