import {
  cacheDirectory,
  copyAsync,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const DB_FILE = 'healthtracker.db';
const WAL_FILE = `${DB_FILE}-wal`;
const MIME_TYPE = 'application/octet-stream';

async function copyAndShare(name: string): Promise<void> {
  const target = `${cacheDirectory}${name}`;
  await copyAsync({ from: `${documentDirectory}SQLite/${name}`, to: target });
  await Sharing.shareAsync(target, {
    mimeType: MIME_TYPE,
    dialogTitle: `Save ${name}`,
  });
}

export async function hasRescueWal(): Promise<boolean> {
  const wal = await getInfoAsync(`${documentDirectory}SQLite/${WAL_FILE}`);
  return wal.exists;
}

export async function clearRescueCopies(): Promise<void> {
  await Promise.all(
    [DB_FILE, WAL_FILE].map((name) =>
      deleteAsync(`${cacheDirectory}${name}`, { idempotent: true }),
    ),
  );
}

export async function exportRawDatabase(): Promise<void> {
  const db = await getInfoAsync(`${documentDirectory}SQLite/${DB_FILE}`);
  if (!db.exists) {
    throw new Error('The database file was not found on this device.');
  }
  const wal = await getInfoAsync(`${documentDirectory}SQLite/${WAL_FILE}`);

  await copyAndShare(DB_FILE);
  if (wal.exists) await copyAndShare(WAL_FILE);
}
