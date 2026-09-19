/**
 * Unit tests for the backup service.
 *
 * Most of this file tests pure, stateless helpers — DB-transactional paths
 * (the real restoreFromPayload, exportBackup) require a real SQLite
 * connection and are not unit-testable in Jest's node environment
 * (expo-sqlite is mocked).
 *
 * Coverage:
 *   - buildInsertColumns: pure column/placeholder/values builder
 *   - validatePayload: format check, schema version compatibility gate
 *   - exportBackup / importBackup / buildBackupPayload / writeSafetySnapshot
 *     smoke: confirm the service exports the expected functions (consistent
 *     with the repo's existing test style)
 *   - importBackup — notification resync (#310): with `../../db/database`
 *     mocked out (no real SQLite needed), exercises the real importBackup
 *     end-to-end against mocked expo-document-picker / expo-file-system /
 *     expo-notifications, following the same mocking pattern as #309's
 *     notifications.test.ts.
 */

import * as Notifications from 'expo-notifications';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as db from '../../db/database';
import * as notificationsModule from '../notifications';
import {
  buildInsertColumns,
  validatePayload,
  exportBackup,
  importBackup,
  buildBackupPayload,
  writeSafetySnapshot,
  shareFile,
  type BackupPayload,
} from '../backup';

jest.mock('../../db/database', () => ({
  // Read by backup.ts directly
  getCurrentSchemaVersion: jest.fn(),
  listUserTables: jest.fn(),
  dumpTable: jest.fn(),
  restoreFromPayload: jest.fn(),
  // Read (transitively) by the real reconcileScheduledNotifications in
  // ../notifications, which importBackup calls after a successful restore.
  getSetting: jest.fn(),
  setSetting: jest.fn(),
  getWorkoutReminderEnabled: jest.fn(),
  getWorkoutReminderTime: jest.fn(),
  getWeeklyCookDayEnabled: jest.fn(),
  getWeeklyCookDay: jest.fn(),
  getWeeklyCookDayTime: jest.fn(),
  getMealInventory: jest.fn(),
  getCookEmptyNotified: jest.fn(),
  setCookEmptyNotified: jest.fn(),
  getMealReminderEnabled: jest.fn(),
  getMealReminderTime: jest.fn(),
  getBackupReminderEnabled: jest.fn(),
  getBackupReminderDay: jest.fn(),
  getBackupReminderTime: jest.fn(),
  getCookWhenEmptyEnabled: jest.fn(),
}));

// ─── buildInsertColumns ───────────────────────────────────────────────────────

describe('buildInsertColumns', () => {
  it('builds columns, placeholders, and values for a single-key row', () => {
    const result = buildInsertColumns({ name: 'Alice' });
    expect(result.columns).toBe('name');
    expect(result.placeholders).toBe('?');
    expect(result.values).toEqual(['Alice']);
  });

  it('builds columns, placeholders, and values for a multi-key row', () => {
    const row = { id: 1, date: '2024-01-01', value: 42.5 };
    const result = buildInsertColumns(row);
    expect(result.columns).toBe('id, date, value');
    expect(result.placeholders).toBe('?, ?, ?');
    expect(result.values).toEqual([1, '2024-01-01', 42.5]);
  });

  it('handles null values', () => {
    const row = { id: 1, weight: null };
    const result = buildInsertColumns(row);
    expect(result.columns).toBe('id, weight');
    expect(result.placeholders).toBe('?, ?');
    expect(result.values).toEqual([1, null]);
  });

  it('returns the same number of columns, placeholders, and values', () => {
    const row = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const result = buildInsertColumns(row);
    const colCount = result.columns.split(',').length;
    const phCount = result.placeholders.split(',').length;
    expect(colCount).toBe(5);
    expect(phCount).toBe(5);
    expect(result.values).toHaveLength(5);
  });
});

// ─── validatePayload ─────────────────────────────────────────────────────────

describe('validatePayload', () => {
  const currentSchemaVersion = 30;

  function makePayload(overrides: Record<string, unknown> = {}) {
    return {
      format: 'healthtracker-backup',
      version: 1,
      appVersion: '1.0.0',
      schemaVersion: 20,
      createdAt: new Date().toISOString(),
      tables: { daily_log: [] },
      ...overrides,
    };
  }

  it('accepts a valid payload', () => {
    const payload = makePayload();
    const result = validatePayload(payload, currentSchemaVersion);
    expect(result.format).toBe('healthtracker-backup');
    expect(result.tables).toEqual({ daily_log: [] });
  });

  it('accepts a payload whose schemaVersion equals currentSchemaVersion', () => {
    const payload = makePayload({ schemaVersion: currentSchemaVersion });
    expect(() => validatePayload(payload, currentSchemaVersion)).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validatePayload(null, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects an array', () => {
    expect(() => validatePayload([], currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a wrong format string', () => {
    const payload = makePayload({ format: 'other-app-backup' });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'not created by HealthTracker'
    );
  });

  it('rejects when tables is missing', () => {
    const payload = makePayload({ tables: undefined });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'missing tables data'
    );
  });

  it('rejects when schemaVersion is not a number', () => {
    const payload = makePayload({ schemaVersion: 'NaN' });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'missing schema version'
    );
  });

  it('rejects a backup made by a newer app version', () => {
    const payload = makePayload({ schemaVersion: currentSchemaVersion + 1 });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'newer version of the app'
    );
  });

  it('round-trips: stringify → parse → validate returns same structure', () => {
    const original = makePayload({ schemaVersion: 10 });
    const json = JSON.stringify(original);
    const parsed = JSON.parse(json);
    const result = validatePayload(parsed, currentSchemaVersion);
    expect(result.format).toBe('healthtracker-backup');
    expect(result.schemaVersion).toBe(10);
    expect(result.tables).toEqual({ daily_log: [] });
  });

  // ── #315: tightened validation ──────────────────────────────────────────
  // The pre-#315 checks were: `typeof tables === 'object'` (which accepts
  // both arrays and per-table string bodies), `Number(payload.schemaVersion)`
  // (which coerces null/[]/''  to 0, silently passing), and `payload.version`
  // was never read at all. Each of the below must be rejected with a
  // distinct, readable "Invalid backup file: ..." message, matching the
  // existing style, so SettingsScreen (which shows err.message verbatim)
  // gives the user something specific.

  it('rejects tables that is an array, not an object', () => {
    const payload = makePayload({ tables: [1, 2, 3] });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a table body that is not an array (a string)', () => {
    const payload = makePayload({ tables: { daily_log: 'hello' } });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a row that is a string', () => {
    const payload = makePayload({ tables: { daily_log: ['not a row'] } });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a row that is a number', () => {
    const payload = makePayload({ tables: { daily_log: [42] } });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a row that is an array', () => {
    const payload = makePayload({ tables: { daily_log: [[1, 2, 3]] } });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a row that is null', () => {
    const payload = makePayload({ tables: { daily_log: [null] } });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects schemaVersion: null (Number(null) === 0 previously slipped through)', () => {
    const payload = makePayload({ schemaVersion: null });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects schemaVersion: [] (Number([]) === 0 previously slipped through)', () => {
    const payload = makePayload({ schemaVersion: [] });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it("rejects schemaVersion: '' (Number('') === 0 previously slipped through)", () => {
    const payload = makePayload({ schemaVersion: '' });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects schemaVersion: 1.5 (not an integer)', () => {
    const payload = makePayload({ schemaVersion: 1.5 });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects version: 2 (payload.version was never read before #315)', () => {
    const payload = makePayload({ version: 2 });
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('rejects a missing version field', () => {
    const payload = makePayload() as Record<string, unknown>;
    delete payload['version'];
    expect(() => validatePayload(payload, currentSchemaVersion)).toThrow(
      'Invalid backup file'
    );
  });

  it('accepts a current-format payload shaped exactly like buildBackupPayload()’s output', () => {
    const payload = {
      format: 'healthtracker-backup',
      version: 1,
      appVersion: '1.1.0',
      schemaVersion: 20,
      createdAt: new Date().toISOString(),
      tables: {
        daily_log: [
          { date: '2024-06-01', walking_task: 'walk', hammer_task: 'hammer' },
        ],
        app_state: [{ key: 'app_start_date', value: '2024-01-01' }],
      },
    };
    expect(() => validatePayload(payload, currentSchemaVersion)).not.toThrow();
  });

  it('accepts a legacy-format payload (envelope shape unchanged since be5b235, pre-v35 duplicate weekly_meal_plan rows)', () => {
    // Same envelope shape as today (format/version/appVersion/schemaVersion/
    // createdAt/tables) — the analyst confirmed via `git log -p` that this
    // hasn't changed since the first backup commit. "Legacy" here is an old
    // schemaVersion plus the kind of duplicate weekly_meal_plan rows a
    // pre-#303 app version could produce (see restoreLegacyDuplicates.test.ts).
    const legacyPayload = {
      format: 'healthtracker-backup',
      version: 1,
      appVersion: '0.9.0',
      schemaVersion: 5,
      createdAt: '2024-01-01T00:00:00.000Z',
      tables: {
        weekly_meal_plan: [
          { id: 10, date: '2024-06-01', meal_type: 'dinner', recipe_id: 'r001', is_consumed: 0, consumed_from_inventory_id: null },
          { id: 11, date: '2024-06-01', meal_type: 'dinner', recipe_id: 'r001', is_consumed: 1, consumed_from_inventory_id: 1 },
        ],
      },
    };
    expect(() =>
      validatePayload(legacyPayload, currentSchemaVersion)
    ).not.toThrow();
  });
});

// ─── Service exports smoke test ───────────────────────────────────────────────

describe('backup service', () => {
  it('exports exportBackup as a function', () => {
    expect(typeof exportBackup).toBe('function');
  });

  it('exports importBackup as a function', () => {
    expect(typeof importBackup).toBe('function');
  });

  it('exports buildBackupPayload as a function (#293)', () => {
    expect(typeof buildBackupPayload).toBe('function');
  });

  it('exports writeSafetySnapshot as a function (#293)', () => {
    expect(typeof writeSafetySnapshot).toBe('function');
  });

  it('exports shareFile as a function (#293)', () => {
    expect(typeof shareFile).toBe('function');
  });
});

// ─── importBackup — notification resync (#310) ────────────────────────────
//
// After a successful restore, importBackup must resync scheduled OS
// notifications to the restored settings: cancelAllScheduledNotificationsAsync()
// then reconcileScheduledNotifications(), in that order, exactly once, only
// once restoreFromPayload has resolved.
//
// cancelAll (not reconcile alone) is required: a restored reminder that's
// disabled can carry an empty/stale *_ID_KEY, and the cancel* helpers in
// notifications.ts still cancel by that stored id, not by the #309 stable
// identifier (see cancelWorkoutReminder etc.) — so reconcile alone could
// leave a currently-scheduled-but-now-disabled reminder firing forever.

function makeValidPayload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    format: 'healthtracker-backup',
    version: 1,
    appVersion: '1.0.0',
    schemaVersion: 5,
    createdAt: new Date().toISOString(),
    tables: { daily_log: [] },
    ...overrides,
  };
}

function mockValidPickerFlow(payload: BackupPayload = makeValidPayload()) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file:///picked-backup.json',
        name: 'backup.json',
        mimeType: 'application/json',
        size: 100,
      },
    ],
  } as any);
  jest.mocked(readAsStringAsync).mockResolvedValue(JSON.stringify(payload));
}

describe('importBackup — notification resync (#310)', () => {
  let reconcileSpy: jest.SpiedFunction<typeof notificationsModule.reconcileScheduledNotifications>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Document-picker + file-read happy path: a valid, current-schema backup.
    mockValidPickerFlow();

    // DB happy path: schema check passes, restore succeeds.
    jest.mocked(db.getCurrentSchemaVersion).mockResolvedValue(5);
    jest.mocked(db.listUserTables).mockResolvedValue(['daily_log']);
    jest.mocked(db.dumpTable).mockResolvedValue([]);
    jest.mocked(db.restoreFromPayload).mockResolvedValue({ tablesRestored: 1, rowsRestored: 0 });

    // Settings read by the real reconcileScheduledNotifications: sweep
    // already done (so its own one-shot sweep doesn't add a second cancelAll
    // call in these tests), every reminder disabled/empty by default —
    // individual tests override what they need.
    jest.mocked(db.getSetting).mockImplementation(async (key: string) =>
      key === 'notificationIdSweepV1Done' ? 'true' : null
    );
    jest.mocked(db.setSetting).mockResolvedValue(undefined);
    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(false);
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('08:00');
    jest.mocked(db.getWeeklyCookDayEnabled).mockResolvedValue(false);
    jest.mocked(db.getWeeklyCookDay).mockResolvedValue(0);
    jest.mocked(db.getWeeklyCookDayTime).mockResolvedValue('10:00');
    jest.mocked(db.getMealReminderEnabled).mockResolvedValue(false);
    jest.mocked(db.getMealReminderTime).mockResolvedValue('08:00');
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(false);
    jest.mocked(db.getBackupReminderDay).mockResolvedValue(0);
    jest.mocked(db.getBackupReminderTime).mockResolvedValue('18:00');
    jest.mocked(db.getMealInventory).mockResolvedValue([]);
    jest.mocked(db.getCookEmptyNotified).mockResolvedValue(false);

    // expo-notifications: default no-op behaviour.
    jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('stub-id');
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValue(undefined);
    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockResolvedValue(undefined);

    // Spy on the REAL reconcileScheduledNotifications so calls/order can be
    // asserted while still exercising its real logic — jest.spyOn calls
    // through to the original implementation by default (only a test that
    // explicitly sets a mock implementation below overrides that).
    reconcileSpy = jest.spyOn(notificationsModule, 'reconcileScheduledNotifications');
  });

  afterEach(() => {
    reconcileSpy.mockRestore();
  });

  it('calls cancelAllScheduledNotificationsAsync then reconcileScheduledNotifications, each exactly once, before returning', async () => {
    const result = await importBackup();

    expect(result).not.toBeNull();
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);

    const cancelOrder = jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mock
      .invocationCallOrder[0];
    const reconcileOrder = reconcileSpy.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(reconcileOrder);
  });

  it('when restoreFromPayload throws, neither cancelAll nor reconcile is called and the error still propagates', async () => {
    const err = new Error('restore transaction failed');
    jest.mocked(db.restoreFromPayload).mockRejectedValue(err);

    await expect(importBackup()).rejects.toThrow('restore transaction failed');

    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('two successive successful imports trigger exactly one cancelAll+reconcile pair each (no accumulation)', async () => {
    await importBackup();
    await importBackup();

    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
    expect(reconcileSpy).toHaveBeenCalledTimes(2);
  });

  it('edge case: a reminder scheduled under its stable id but restored as disabled with a stale/empty ID key is not scheduled after import', async () => {
    // Simulate the OS notification schedule as a Map keyed by identifier,
    // the way the #309 tests did, and let the real reconcileScheduledNotifications
    // run against these mocked expo-notifications + settings calls.
    const osSchedule = new Map<string, unknown>();
    osSchedule.set('workout-reminder', { identifier: 'workout-reminder' });

    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockImplementation(async () => {
      osSchedule.clear();
    });
    jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (id: string) => {
      osSchedule.delete(id);
    });
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: any) => {
      const id = request.identifier ?? `random-${osSchedule.size}`;
      osSchedule.set(id, request);
      return id;
    });

    // Restored settings: workout reminder disabled. getSetting already
    // defaults to null (falsy) for every non-sweep key above, simulating the
    // stale/empty WORKOUT_REMINDER_ID_KEY a disabled reminder carries in a
    // restored backup.
    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(false);

    expect(osSchedule.has('workout-reminder')).toBe(true); // sanity: pre-restore OS state

    await importBackup();

    expect(osSchedule.has('workout-reminder')).toBe(false);
  });

  it('when reconcileScheduledNotifications throws after a successful restore, importBackup still reports success and logs the error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const reconcileErr = new Error('reconcile blew up');
    reconcileSpy.mockRejectedValueOnce(reconcileErr);

    const result = await importBackup();

    expect(result).toEqual({
      tablesRestored: 1,
      rowsRestored: 0,
      safetySnapshotUri: expect.any(String),
    });
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('resync'),
      reconcileErr
    );

    warnSpy.mockRestore();
  });
});
