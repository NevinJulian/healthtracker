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
 *   - Before any restore, a safety snapshot of the current data is written
 *     to safety-snapshots/ in documentDirectory. Once a restore has
 *     succeeded, snapshots older than SAFETY_KEEP_DAYS are pruned, always
 *     keeping the newest SAFETY_KEEP. Snapshots are lost on uninstall.
 *   - After a successful restore, scheduled OS notifications are resynced to
 *     the restored settings (#310): cancelAllScheduledNotificationsAsync()
 *     runs first, then reconcileScheduledNotifications(). cancelAll (rather
 *     than reconcile alone) is required because a restored reminder that is
 *     disabled can carry an empty/stale *_ID_KEY in app_state — the cancel*
 *     helpers in notifications.ts still cancel by that stored id, not by the
 *     #309 stable identifier, so reconcile alone could leave a
 *     currently-scheduled-but-now-disabled reminder firing forever. This
 *     resync is best-effort: it only runs once restoreFromPayload has
 *     resolved successfully, and a failure in it is logged, never thrown —
 *     the data restore itself already succeeded by that point.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import Notifications from './expoNotifications';
import {
  cacheDirectory,
  documentDirectory,
  writeAsStringAsync,
  readAsStringAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  deleteAsync,
  moveAsync,
  getInfoAsync,
} from 'expo-file-system/legacy';
import {
  getCurrentSchemaVersion,
  listUserTables,
  dumpTable,
  restoreFromPayload,
} from '../db/database';
import { reconcileScheduledNotifications } from './notifications';
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
  /** URI of the pre-restore safety snapshot, empty when the caller restored without one. */
  safetySnapshotUri: string;
  /**
   * Per-table report of rows/columns dropped by restoreFromPayload's column
   * whitelist (#315) — unknown columns in a row are silently ignored rather
   * than inserted, and a row left with no known columns isn't inserted at
   * all. Present only when something was actually skipped.
   */
  skipped?: { table: string; columns: string[]; rows: number }[];
  /**
   * Consumed weekly_meal_plan rows restored from a backup taken before the
   * consumed_from_inventory_id column existed (pre-v34, #302). They restore
   * with a NULL pointer, so unticking one returns no portion to inventory.
   * Present only when such rows were actually restored (#310).
   */
  consumedMealsWithoutRefund?: number;
}

export interface RestoreOptions {
  /**
   * Called when the safety-snapshot write fails. Receives the error message.
   * Should return true to proceed with the restore anyway, false to abort.
   * Defaults to always aborting (returns false) when omitted.
   */
  onSnapshotFailed?: (errorMessage: string) => Promise<boolean>;
}

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

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

  if (obj['version'] !== 1) {
    throw new Error(
      'Invalid backup file: unsupported backup format version.'
    );
  }

  if (typeof obj['tables'] !== 'object' || obj['tables'] === null) {
    throw new Error('Invalid backup file: missing tables data.');
  }

  if (Array.isArray(obj['tables'])) {
    throw new Error(
      'Invalid backup file: tables must be an object, not a list.'
    );
  }

  const tables = obj['tables'] as Record<string, unknown>;
  for (const [tableName, body] of Object.entries(tables)) {
    if (!Array.isArray(body)) {
      throw new Error(
        `Invalid backup file: table "${tableName}" data must be a list of rows.`
      );
    }
    for (const row of body) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error(
          `Invalid backup file: table "${tableName}" contains a row that is not an object.`
        );
      }
    }
  }

  const rawSchemaVersion = obj['schemaVersion'];
  if (
    typeof rawSchemaVersion !== 'number' ||
    !Number.isFinite(rawSchemaVersion) ||
    !Number.isInteger(rawSchemaVersion)
  ) {
    throw new Error('Invalid backup file: missing schema version.');
  }
  const payloadSchema = rawSchemaVersion;

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
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

// ─── ISO date helper ─────────────────────────────────────────────────────────
// Delegated to the canonical utility (issue #279).
const isoDateString = localDateKey;

// ─── Shared payload builder (exported for unit tests) ────────────────────────

/**
 * Dump all user tables from the database and assemble a BackupPayload object.
 *
 * This is the single source-of-truth for the serialization format — both
 * exportBackup (user-initiated) and the pre-restore safety snapshot (#293)
 * call this to avoid duplicating the dump/serialize logic.
 *
 * @returns A fully-populated BackupPayload ready for JSON serialization.
 */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const schemaVersion = await getCurrentSchemaVersion();
  const tableNames = await listUserTables();
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const name of tableNames) {
    tables[name] = await dumpTable(name);
  }

  return {
    format: 'healthtracker-backup',
    version: 1,
    appVersion: getAppVersion(),
    schemaVersion,
    createdAt: new Date().toISOString(),
    tables,
  };
}

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

  const payload = await buildBackupPayload();

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

// ─── Safety snapshot (pre-restore) ───────────────────────────────────────────

export const SAFETY_KEEP = 3;
export const SAFETY_KEEP_DAYS = 7;

const SAFETY_DIR_NAME = 'safety-snapshots/';
const SAFETY_NAME_RE =
  /^healthtracker-pre-restore-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.json$/;
const SAFETY_TMP_RE = /^healthtracker-pre-restore-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json\.tmp$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Example: "healthtracker-pre-restore-2026-06-14T18-05-30.json", in UTC. */
function safetySnapshotName(date: Date): string {
  const stamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
  return `healthtracker-pre-restore-${stamp}.json`;
}

function parseSafetySnapshotName(name: string): Date | null {
  const match = SAFETY_NAME_RE.exec(name);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return safetySnapshotName(date) === name ? date : null;
}

function safetyDir(): string | null {
  return documentDirectory ? `${documentDirectory}${SAFETY_DIR_NAME}` : null;
}

function readSafetyFolder(dir: string): Promise<BackupFolder> {
  return readBackupFolder(dir, parseSafetySnapshotName, SAFETY_TMP_RE);
}

/** Pre-restore safety snapshots on this device, newest first. */
export function listSafetySnapshots(): Promise<SafetySnapshotEntry[]> {
  return listBackupFolder(safetyDir(), readSafetyFolder);
}

/**
 * Write a safety snapshot of the current DB state to safety-snapshots/ in
 * documentDirectory and return its URI.
 *
 * Called automatically before a restore wipes any data. The snapshot uses the
 * same payload format as a regular export, so it can be shared or imported as
 * a normal backup file. It survives the OS clearing the cache, not an
 * uninstall.
 *
 * The snapshot is written to a temporary name and moved into place, so a
 * failed write leaves no partial snapshot. A temporary file left behind by an
 * interrupted write is removed by the next call. Nothing is pruned here: that
 * happens once a restore has succeeded (pruneSafetySnapshots).
 *
 * @throws When the file write fails (caller decides whether to abort restore).
 */
export async function writeSafetySnapshot(): Promise<string> {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const dir = `${documentDirectory ?? ''}${SAFETY_DIR_NAME}`;
  const fileUri = `${dir}${safetySnapshotName(new Date())}`;
  await makeDirectoryAsync(dir, { intermediates: true });
  if (documentDirectory) await removeSafetyLeftovers(dir);
  await writeThenMove(fileUri, json);
  return fileUri;
}

async function removeSafetyLeftovers(dir: string): Promise<void> {
  try {
    const { leftovers } = await readSafetyFolder(dir);
    for (const name of leftovers) await deleteMatching(dir, name, SAFETY_TMP_RE);
  } catch (err) {
    console.warn('[Backup] Failed to remove temporary safety snapshots:', err);
  }
}

/**
 * Delete safety snapshots older than SAFETY_KEEP_DAYS, always keeping the
 * newest SAFETY_KEEP. Age and "newest" are read from the file name. Snapshots
 * dated more than an hour ahead of `now` are never deleted and do not count
 * toward SAFETY_KEEP, so a clock that was once set ahead cannot push out real
 * ones.
 */
async function pruneSafetySnapshots(now: Date): Promise<void> {
  const dir = safetyDir();
  if (!dir || !(await getInfoAsync(dir)).exists) return;

  const { valid } = await readSafetyFolder(dir);
  const horizon = now.getTime() + CLOCK_SKEW_MS;
  const cutoff = now.getTime() - SAFETY_KEEP_DAYS * DAY_MS;
  const counted = valid.filter((entry) => entry.time.getTime() <= horizon);
  for (const entry of counted.slice(SAFETY_KEEP)) {
    if (entry.time.getTime() < cutoff) await deleteMatching(dir, entry.name, SAFETY_NAME_RE);
  }
}

// ─── Backup folders ──────────────────────────────────────────────────────────

const CLOCK_SKEW_MS = 60 * 60 * 1000;

interface BackupFolder {
  /** Files whose name parses to a real timestamp, newest first. */
  valid: { name: string; time: Date }[];
  /** Temporary files left behind by an interrupted write. */
  leftovers: string[];
}

async function readBackupFolder(
  dir: string,
  parseName: (name: string) => Date | null,
  tmpPattern: RegExp
): Promise<BackupFolder> {
  const names = await readDirectoryAsync(dir);
  const valid: BackupFolder['valid'] = [];
  const leftovers: string[] = [];
  for (const name of names) {
    const time = parseName(name);
    if (time) valid.push({ name, time });
    else if (tmpPattern.test(name)) leftovers.push(name);
  }
  valid.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { valid, leftovers };
}

async function listBackupFolder(
  dir: string | null,
  read: (dir: string) => Promise<BackupFolder>
): Promise<AutoBackupEntry[]> {
  if (!dir) return [];
  const folder = await getInfoAsync(dir);
  if (!folder.exists) return [];

  const { valid } = await read(dir);
  const entries: AutoBackupEntry[] = [];
  for (const { name, time } of valid) {
    const uri = `${dir}${name}`;
    const info = await getInfoAsync(uri);
    if (!info.exists) continue;
    entries.push({ name, uri, createdAt: time, sizeBytes: info.size });
  }
  return entries;
}

async function writeThenMove(finalUri: string, content: string): Promise<void> {
  const tmpUri = `${finalUri}.tmp`;
  try {
    await writeAsStringAsync(tmpUri, content);
    await moveAsync({ from: tmpUri, to: finalUri });
  } catch (err) {
    try {
      await deleteAsync(tmpUri, { idempotent: true });
    } catch (cleanupErr) {
      console.warn('[Backup] Failed to remove temporary backup file:', cleanupErr);
    }
    throw err;
  }
}

async function deleteMatching(dir: string, name: string, pattern: RegExp): Promise<void> {
  if (!pattern.test(name)) return;
  try {
    await deleteAsync(`${dir}${name}`, { idempotent: true });
  } catch (err) {
    console.warn(`[Backup] Failed to delete ${name}:`, err);
  }
}

// ─── Import (restore) ────────────────────────────────────────────────────────

/**
 * Open the document picker, validate the chosen file as a HealthTracker
 * backup, write a safety snapshot of the current data, then restore all
 * tables transactionally.
 *
 * Safety snapshot behaviour:
 *   - Written to documentDirectory before any data is modified.
 *   - If the write fails the user is asked whether to continue; the restore
 *     is aborted when they say no.
 *   - The returned RestoreResult includes the snapshot URI so the caller can
 *     offer to share it.
 *
 * On a successful restore, scheduled OS notifications are also resynced to
 * the restored settings — see the module docblock above for why that
 * needs a full cancelAllScheduledNotificationsAsync() rather than just
 * reconcileScheduledNotifications(). This resync is best-effort and never
 * turns a successful restore into a reported failure.
 *
 * @returns A RestoreResult summary (including safetySnapshotUri), or null
 *          when the user cancelled.
 * @throws  When the file is invalid, the schema is incompatible, or the
 *          DB restore transaction fails.
 */
export async function importBackup(
  options: RestoreOptions = {}
): Promise<RestoreResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  // User cancelled
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  return restoreBackupFromUri(result.assets[0].uri, options);
}

/**
 * Restore from a backup file already on the device: parse and validate it,
 * write a safety snapshot, restore all tables transactionally, then prune old
 * safety snapshots and resync notifications. The source file is only read.
 * Automatic backups do not run while this is in progress.
 *
 * @throws When the file is invalid, the schema is incompatible, the safety
 *         snapshot fails and the caller declines to continue, or the DB
 *         restore transaction fails.
 */
export async function restoreBackupFromUri(
  uri: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  restoreInProgress = true;
  try {
    return await performRestore(uri, options);
  } finally {
    restoreInProgress = false;
  }
}

async function performRestore(uri: string, options: RestoreOptions): Promise<RestoreResult> {
  const rawJson = await readAsStringAsync(uri);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid backup file: could not parse JSON.');
  }

  const currentSchemaVersion = await getCurrentSchemaVersion();
  const payload = validatePayload(parsed, currentSchemaVersion);

  // ── Safety snapshot (written BEFORE any data is wiped) ──────────────────
  let safetySnapshotUri = '';
  try {
    safetySnapshotUri = await writeSafetySnapshot();
    console.log(`[Backup] Safety snapshot written to: ${safetySnapshotUri}`);
  } catch (snapshotErr) {
    const msg =
      snapshotErr instanceof Error
        ? snapshotErr.message
        : 'Unknown error writing safety snapshot.';

    const proceed = options.onSnapshotFailed
      ? await options.onSnapshotFailed(msg)
      : false;

    if (!proceed) {
      throw new Error(
        `Could not save a safety copy before restoring (${msg}). Restore aborted.`
      );
    }
    // Caller chose to proceed despite failed snapshot — continue without URI.
  }

  let restored: Awaited<ReturnType<typeof restoreFromPayload>>;
  try {
    restored = await restoreFromPayload(payload.tables, payload.schemaVersion);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Restore failed — your existing data was not changed. Details: ${detail}`,
      { cause: err }
    );
  }
  const { tablesRestored, rowsRestored, skipped, consumedMealsWithoutRefund } = restored;

  // Best-effort from here on: a failure must not turn a successful restore
  // into a reported failure.
  try {
    await pruneSafetySnapshots(new Date());
  } catch (err) {
    console.warn('[Backup] Failed to prune safety snapshots:', err);
  }

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await reconcileScheduledNotifications();
  } catch (err) {
    console.warn('[Backup] Failed to resync notifications after restore:', err);
  }

  return {
    tablesRestored,
    rowsRestored,
    safetySnapshotUri,
    ...(skipped ? { skipped } : {}),
    ...(consumedMealsWithoutRefund ? { consumedMealsWithoutRefund } : {}),
  };
}

/**
 * Share an existing file URI via the OS share sheet.
 * Used to let the user save the safety snapshot after a restore completes,
 * and to share an automatic backup or a listed safety snapshot.
 *
 * @param uri - A file:// URI returned by writeSafetySnapshot, exportBackup,
 *              listAutoBackups or listSafetySnapshots.
 * @param dialogTitle - Title of the share sheet.
 * @returns true when the share sheet was presented, false when sharing is unavailable.
 */
export async function shareFile(
  uri: string,
  dialogTitle = 'Save your safety backup'
): Promise<boolean> {
  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) return false;
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle,
    UTI: 'public.json',
  });
  return true;
}

// ─── Automatic backups ───────────────────────────────────────────────────────

export const AUTO_BACKUP_KEEP = 7;

export interface AutoBackupEntry {
  name: string;
  uri: string;
  createdAt: Date;
  sizeBytes: number;
}

export type SafetySnapshotEntry = AutoBackupEntry;

const AUTO_DIR_NAME = 'auto-backups/';
const AUTO_NAME_RE = /^healthtracker-auto-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.json$/;
const AUTO_TMP_RE = /^healthtracker-auto-\d{8}T\d{6}Z\.json\.tmp$/;

let autoBackupInFlight: Promise<void> | null = null;
let restoreInProgress = false;

function autoBackupDir(): string | null {
  return documentDirectory ? `${documentDirectory}${AUTO_DIR_NAME}` : null;
}

function autoBackupName(date: Date): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `healthtracker-auto-${stamp}.json`;
}

function parseAutoBackupName(name: string): Date | null {
  const match = AUTO_NAME_RE.exec(name);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return autoBackupName(date) === name ? date : null;
}

function readAutoBackupFolder(dir: string): Promise<BackupFolder> {
  return readBackupFolder(dir, parseAutoBackupName, AUTO_TMP_RE);
}

/**
 * Write an automatic backup into auto-backups/ in documentDirectory when none
 * exists from the local calendar date of `now`, then keep the newest
 * AUTO_BACKUP_KEEP. Concurrent calls share one run; nothing runs during a
 * restore.
 *
 * A backup is written to a temporary name and moved into place, so a partial
 * file is never listed or restored. A backup's date and "newest" are read
 * from the file name. Files dated more than an hour ahead of `now` are never
 * pruned and do not count toward AUTO_BACKUP_KEEP.
 *
 * @throws When the write fails; the caller logs it.
 */
export function runAutoBackupIfDue(now: Date = new Date()): Promise<void> {
  if (autoBackupInFlight) return autoBackupInFlight;
  const run = performAutoBackup(now).finally(() => {
    autoBackupInFlight = null;
  });
  autoBackupInFlight = run;
  return run;
}

async function performAutoBackup(now: Date): Promise<void> {
  if (restoreInProgress) return;
  const dir = autoBackupDir();
  if (!dir) throw new Error('No document directory available for automatic backups.');

  await makeDirectoryAsync(dir, { intermediates: true });
  const { valid, leftovers } = await readAutoBackupFolder(dir);
  for (const name of leftovers) await deleteMatching(dir, name, AUTO_TMP_RE);

  const today = localDateKey(now);
  if (valid.some((entry) => localDateKey(entry.time) === today)) return;

  const payload = await buildBackupPayload();
  if (restoreInProgress) return;

  await writeThenMove(`${dir}${autoBackupName(now)}`, JSON.stringify(payload, null, 2));

  try {
    const horizon = now.getTime() + CLOCK_SKEW_MS;
    const after = await readAutoBackupFolder(dir);
    const counted = after.valid.filter((entry) => entry.time.getTime() <= horizon);
    for (const entry of counted.slice(AUTO_BACKUP_KEEP)) {
      await deleteMatching(dir, entry.name, AUTO_NAME_RE);
    }
  } catch (err) {
    console.warn('[Backup] Failed to prune automatic backups:', err);
  }
}

/** Automatic backups on this device, newest first. */
export function listAutoBackups(): Promise<AutoBackupEntry[]> {
  return listBackupFolder(autoBackupDir(), readAutoBackupFolder);
}
