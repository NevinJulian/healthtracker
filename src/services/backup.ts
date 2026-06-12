/**
 * Backup service — export to file + share, and restore from file.
 *
 * Architecture:
 *   - Raw DB queries live in src/db/database.ts (getCurrentSchemaVersion,
 *     listUserTables, dumpTable, restoreFromPayload).
 *   - This file owns file I/O (expo-file-system), the share sheet
 *     (expo-sharing), and the document picker (expo-document-picker).
 *
 * Design decisions:
 *   - Uses the legacy expo-file-system API (expo-file-system/legacy) for
 *     writing/reading because it handles both file:// and content:// URIs
 *     reliably on both iOS and Android; the new File/Paths API cannot read
 *     arbitrary content:// URIs returned by the document picker.
 *   - schema_version is NEVER included in the backup tables or overwritten
 *     on restore — that table is managed exclusively by runMigrations().
 *   - Restore is all-or-nothing via db.withTransactionAsync().
 */

import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  cacheDirectory,
  writeAsStringAsync,
  readAsStringAsync,
} from 'expo-file-system/legacy';
import {
  getCurrentSchemaVersion,
  listUserTables,
  dumpTable,
  restoreFromPayload,
} from '../db/database';
import { localDateKey } from '../utils/dates';

// ─── Public types ────────────────────────────────────────────────────────────

export interface BackupPayload {
  format: 'healthtracker-backup';
  version: 1;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface RestoreResult {
  tablesRestored: number;
  rowsRestored: number;
}

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

/**
 * Build the (col1, col2, ...) list and VALUES (?, ?, ...) placeholders for a
 * single row's keys. This is a pure function with no side-effects.
 */
export function buildInsertColumns(row: Record<string, unknown>): {
  columns: string;
  placeholders: string;
  values: unknown[];
} {
  const keys = Object.keys(row);
  return {
    columns: keys.join(', '),
    placeholders: keys.map(() => '?').join(', '),
    values: keys.map((k) => row[k]),
  };
}

/**
 * Validate a parsed object as a BackupPayload. Returns the typed payload or
 * throws an Error with a user-facing message.
 *
 * @param parsed   - The result of JSON.parse on the raw file content.
 * @param currentSchemaVersion - The live DB schema version; used for the
 *                               compatibility gate.
 */
export function validatePayload(
  parsed: unknown,
  currentSchemaVersion: number
): BackupPayload {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error('Invalid backup file: not a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj['format'] !== 'healthtracker-backup') {
    throw new Error(
      'Invalid backup file: this file was not created by HealthTracker.'
    );
  }

  if (typeof obj['tables'] !== 'object' || obj['tables'] === null) {
    throw new Error('Invalid backup file: missing tables data.');
  }

  const payloadSchema = Number(obj['schemaVersion']);
  if (isNaN(payloadSchema)) {
    throw new Error('Invalid backup file: missing schema version.');
  }

  if (payloadSchema > currentSchemaVersion) {
    throw new Error(
      'This backup was made by a newer version of the app — please update the app first.'
    );
  }

  return parsed as BackupPayload;
}

// ─── App version helper ───────────────────────────────────────────────────────

/** Returns the version string from package.json (bundled at build time). */
function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// ─── ISO date helper ─────────────────────────────────────────────────────────
// Delegated to the canonical utility (issue #279).
const isoDateString = localDateKey;

// ─── Export (backup) ─────────────────────────────────────────────────────────

/**
 * Build a JSON backup of all user tables, write it to the cache directory,
 * and present the OS share sheet so the user can save it wherever they like.
 *
 * @returns The URI of the temporary file that was shared, for testing.
 * @throws  When sharing is unavailable or the DB dump fails.
 */
export async function exportBackup(): Promise<string> {
  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    throw new Error(
      'Sharing is not available on this device. Cannot export backup.'
    );
  }

  // Dump all user tables
  const schemaVersion = await getCurrentSchemaVersion();
  const tableNames = await listUserTables();
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const name of tableNames) {
    tables[name] = await dumpTable(name);
  }

  const payload: BackupPayload = {
    format: 'healthtracker-backup',
    version: 1,
    appVersion: getAppVersion(),
    schemaVersion,
    createdAt: new Date().toISOString(),
    tables,
  };

  const json = JSON.stringify(payload, null, 2);
  const fileName = `healthtracker-backup-${isoDateString()}.json`;
  const fileUri = `${cacheDirectory ?? ''}${fileName}`;

  await writeAsStringAsync(fileUri, json);

  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Save your HealthTracker backup',
    UTI: 'public.json',
  });

  return fileUri;
}

// ─── Import (restore) ────────────────────────────────────────────────────────

/**
 * Open the document picker, validate the chosen file as a HealthTracker
 * backup, then restore all tables transactionally.
 *
 * @returns A RestoreResult summary, or null when the user cancelled.
 * @throws  When the file is invalid, the schema is incompatible, or the
 *          DB restore transaction fails.
 */
export async function importBackup(): Promise<RestoreResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  // User cancelled
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const rawJson = await readAsStringAsync(asset.uri);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid backup file: could not parse JSON.');
  }

  const currentSchemaVersion = await getCurrentSchemaVersion();
  const payload = validatePayload(parsed, currentSchemaVersion);

  return restoreFromPayload(payload.tables);
}
