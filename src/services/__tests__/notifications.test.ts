/**
 * Unit tests for pure helper functions in the notification service.
 *
 * parseTimeString, formatTimeString, mapWeekdayToExpo, shouldNotifyEmpty,
 * getMealReminderIdentifier, and getBackupReminderIdentifier are all stateless
 * and have no native dependencies, so they can be tested directly in Jest's
 * node environment.
 *
 * #309: also covers the stable-identifier scheduling behaviour and the
 * one-shot post-upgrade notification-id sweep in reconcileScheduledNotifications.
 * Those need `../../db/database` mocked out so the flag/settings reads used by
 * reconcile are controllable without a real SQLite connection.
 */

import * as Notifications from 'expo-notifications';
import * as db from '../../db/database';
import {
  parseTimeString,
  formatTimeString,
  mapWeekdayToExpo,
  shouldNotifyEmpty,
  getMealReminderIdentifier,
  getBackupReminderIdentifier,
  scheduleBackupReminder,
  cancelBackupReminder,
  scheduleWorkoutReminder,
  scheduleWeeklyCookDay,
  scheduleMealReminder,
  reconcileScheduledNotifications,
} from '../notifications';
import type { MealType } from '../../db/database';

jest.mock('../../db/database', () => ({
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

// Fresh, known-good default behaviour before every test — nothing enabled,
// nothing scheduled, sweep flag unset. Individual tests override what they
// need. Resetting here (rather than relying on jest.clearAllMocks() alone)
// guarantees no mockImplementation set by one test leaks into the next.
beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(Notifications.scheduleNotificationAsync).mockResolvedValue('stub-notification-id');
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockResolvedValue(undefined);
  jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockResolvedValue(undefined);

  jest.mocked(db.getSetting).mockResolvedValue(null);
  jest.mocked(db.setSetting).mockResolvedValue(undefined);
  jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(false);
  jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('08:00');
  jest.mocked(db.getWeeklyCookDayEnabled).mockResolvedValue(false);
  jest.mocked(db.getWeeklyCookDay).mockResolvedValue(0);
  jest.mocked(db.getWeeklyCookDayTime).mockResolvedValue('10:00');
  jest.mocked(db.getMealInventory).mockResolvedValue([]);
  jest.mocked(db.getCookEmptyNotified).mockResolvedValue(false);
  jest.mocked(db.setCookEmptyNotified).mockResolvedValue(undefined);
  jest.mocked(db.getMealReminderEnabled).mockResolvedValue(false);
  jest.mocked(db.getMealReminderTime).mockResolvedValue('08:00');
  jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(false);
  jest.mocked(db.getBackupReminderDay).mockResolvedValue(0);
  jest.mocked(db.getBackupReminderTime).mockResolvedValue('18:00');
});

describe('parseTimeString', () => {
  it('parses a standard HH:MM string', () => {
    expect(parseTimeString('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(parseTimeString('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('parses zero-padded values', () => {
    expect(parseTimeString('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeString('07:05')).toEqual({ hour: 7, minute: 5 });
  });

  it('returns the safe fallback for malformed input', () => {
    expect(parseTimeString('')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('abc')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('25:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('12:99')).toEqual({ hour: 8, minute: 0 });
  });
});

describe('formatTimeString', () => {
  it('formats single-digit values with zero-padding', () => {
    expect(formatTimeString(8, 0)).toBe('08:00');
    expect(formatTimeString(7, 5)).toBe('07:05');
  });

  it('formats two-digit values correctly', () => {
    expect(formatTimeString(14, 30)).toBe('14:30');
    expect(formatTimeString(23, 59)).toBe('23:59');
  });

  it('round-trips with parseTimeString', () => {
    const cases = ['00:00', '08:00', '12:15', '18:45', '23:59'];
    for (const t of cases) {
      const { hour, minute } = parseTimeString(t);
      expect(formatTimeString(hour, minute)).toBe(t);
    }
  });
});

describe('mapWeekdayToExpo', () => {
  it('maps Sunday (JS 0) to expo 1', () => {
    expect(mapWeekdayToExpo(0)).toBe(1);
  });

  it('maps Saturday (JS 6) to expo 7', () => {
    expect(mapWeekdayToExpo(6)).toBe(7);
  });

  it('maps all JS weekdays to expo weekdays (offset by 1)', () => {
    for (let day = 0; day <= 6; day++) {
      expect(mapWeekdayToExpo(day)).toBe(day + 1);
    }
  });

  it('produces values in the expo range 1–7', () => {
    for (let day = 0; day <= 6; day++) {
      const expo = mapWeekdayToExpo(day);
      expect(expo).toBeGreaterThanOrEqual(1);
      expect(expo).toBeLessThanOrEqual(7);
    }
  });
});

describe('shouldNotifyEmpty', () => {
  it('returns true when portions are 0 and not yet notified', () => {
    expect(shouldNotifyEmpty(0, false)).toBe(true);
  });

  it('returns false when portions are 0 but already notified (debounce)', () => {
    expect(shouldNotifyEmpty(0, true)).toBe(false);
  });

  it('returns false when portions are positive (inventory not empty)', () => {
    expect(shouldNotifyEmpty(1, false)).toBe(false);
    expect(shouldNotifyEmpty(5, false)).toBe(false);
    expect(shouldNotifyEmpty(100, false)).toBe(false);
  });

  it('returns false when portions are positive even if notified flag is false', () => {
    expect(shouldNotifyEmpty(3, false)).toBe(false);
  });
});

describe('getMealReminderIdentifier', () => {
  const meals: MealType[] = ['breakfast', 'lunch', 'dinner'];

  it('returns a stable string identifier for each meal', () => {
    for (const meal of meals) {
      const id = getMealReminderIdentifier(meal);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('returns distinct identifiers for each meal', () => {
    const ids = meals.map(getMealReminderIdentifier);
    const unique = new Set(ids);
    expect(unique.size).toBe(meals.length);
  });

  it('includes the meal name in the identifier', () => {
    expect(getMealReminderIdentifier('breakfast')).toContain('breakfast');
    expect(getMealReminderIdentifier('lunch')).toContain('lunch');
    expect(getMealReminderIdentifier('dinner')).toContain('dinner');
  });

  it('identifiers are stable across calls (same value each time)', () => {
    for (const meal of meals) {
      expect(getMealReminderIdentifier(meal)).toBe(getMealReminderIdentifier(meal));
    }
  });
});

describe('meal reminder default times (via parseTimeString)', () => {
  it('breakfast default 08:00 parses to hour 8, minute 0', () => {
    expect(parseTimeString('08:00')).toEqual({ hour: 8, minute: 0 });
  });

  it('lunch default 12:30 parses to hour 12, minute 30', () => {
    expect(parseTimeString('12:30')).toEqual({ hour: 12, minute: 30 });
  });

  it('dinner default 18:30 parses to hour 18, minute 30', () => {
    expect(parseTimeString('18:30')).toEqual({ hour: 18, minute: 30 });
  });
});

describe('getBackupReminderIdentifier', () => {
  it('returns a non-empty string', () => {
    const id = getBackupReminderIdentifier();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('contains "backup" in the identifier', () => {
    expect(getBackupReminderIdentifier()).toContain('backup');
  });

  it('is stable across calls (same value each time)', () => {
    expect(getBackupReminderIdentifier()).toBe(getBackupReminderIdentifier());
  });

  it('is distinct from all meal reminder identifiers', () => {
    const meals: MealType[] = ['breakfast', 'lunch', 'dinner'];
    const mealIds = meals.map(getMealReminderIdentifier);
    const backupId = getBackupReminderIdentifier();
    for (const mealId of mealIds) {
      expect(backupId).not.toBe(mealId);
    }
  });

  it('default backup reminder time parses correctly', () => {
    // Default is 18:00 (Sunday evening)
    expect(parseTimeString('18:00')).toEqual({ hour: 18, minute: 0 });
  });
});

describe('backup reminder service (smoke)', () => {
  it('exports scheduleBackupReminder as a function', () => {
    expect(typeof scheduleBackupReminder).toBe('function');
  });

  it('exports cancelBackupReminder as a function', () => {
    expect(typeof cancelBackupReminder).toBe('function');
  });
});

// ─── #309: stable notification identifiers ─────────────────────────────────
//
// Before #309 the four recurring scheduleNotificationAsync calls never passed
// an `identifier`, so expo-notifications assigned a random UUID each time —
// rescheduling the same reminder (e.g. after a settings change) produced a
// second, orphaned OS notification instead of replacing the first. These
// tests assert directly on the `identifier` field of the scheduling call.

describe('stable notification identifiers (#309)', () => {
  it('scheduleWorkoutReminder passes the stable workout identifier', async () => {
    await scheduleWorkoutReminder('07:00');

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'workout-reminder' })
    );
  });

  it('scheduleWeeklyCookDay passes the stable cook-day identifier', async () => {
    await scheduleWeeklyCookDay(0, '10:00');

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'cookday-reminder' })
    );
  });

  it('scheduleMealReminder passes the stable meal identifier for breakfast', async () => {
    await scheduleMealReminder('breakfast', 8, 0);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'meal-reminder-breakfast' })
    );
  });

  it('scheduleMealReminder passes the stable meal identifier for lunch and dinner too', async () => {
    await scheduleMealReminder('lunch', 12, 30);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'meal-reminder-lunch' })
    );

    await scheduleMealReminder('dinner', 18, 30);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'meal-reminder-dinner' })
    );
  });

  it('scheduleBackupReminder passes the stable backup identifier', async () => {
    await scheduleBackupReminder(0, '18:00');

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'backup-reminder' })
    );
  });

  it('the scheduled identifier for meal reminders matches getMealReminderIdentifier (the real source, not a test-only shim)', async () => {
    await scheduleMealReminder('lunch', 12, 30);

    const [request] = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0];
    expect(request.identifier).toBe(getMealReminderIdentifier('lunch'));
  });

  it('the scheduled identifier for the backup reminder matches getBackupReminderIdentifier (the real source, not a test-only shim)', async () => {
    await scheduleBackupReminder(0, '18:00');

    const [request] = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0];
    expect(request.identifier).toBe(getBackupReminderIdentifier());
  });

  it('scheduling the same reminder twice results in exactly one entry for that identifier', async () => {
    // Simulate the real native module's upsert-by-identifier semantics: a
    // second scheduleNotificationAsync call with the same identifier
    // replaces the first entry rather than adding a new one.
    const entries = new Map<string, unknown>();
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request) => {
      const id = request.identifier ?? `random-${entries.size}`;
      entries.set(id, request);
      return id;
    });

    await scheduleBackupReminder(0, '18:00');
    await scheduleBackupReminder(3, '09:15'); // same reminder, different day/time

    expect(entries.size).toBe(1);
    expect(entries.has('backup-reminder')).toBe(true);
  });

  // Note: checkAndNotifyEmptyInventory itself is not exercised end-to-end
  // here. It resolves `getCookWhenEmptyEnabled` via a dynamic `import('../db/database')`
  // (pre-existing, unrelated to #309), which Jest 30's node testEnvironment
  // cannot evaluate without --experimental-vm-modules (see jest.config.js's
  // winter-runtime notes) — the call throws and is swallowed by the
  // function's own try/catch. That's a pre-existing limitation, not
  // something #309 touches; source-reading confirms the TIME_INTERVAL
  // request built in checkAndNotifyEmptyInventory (src/services/notifications.ts)
  // has no `identifier` field, which is what the work order asks to preserve.
});

// ─── #309: post-upgrade notification-id sweep ──────────────────────────────
//
// Notifications scheduled before #309 carry random UUIDs, not the new stable
// identifiers, so rescheduling under the stable id would leave the old
// random-UUID entry orphaned in the OS. reconcileScheduledNotifications()
// runs a one-shot cancelAllScheduledNotificationsAsync() sweep, gated by the
// `notificationIdSweepV1Done` app_state flag, before it reschedules anything
// in that same pass.

describe('reconcileScheduledNotifications — post-upgrade sweep (#309)', () => {
  /** In-memory stand-in for the app_state row backing the sweep flag. */
  function mockSweepFlagStorage() {
    let sweepDone: string | null = null;
    jest.mocked(db.getSetting).mockImplementation(async (key: string) =>
      key === 'notificationIdSweepV1Done' ? sweepDone : null
    );
    jest.mocked(db.setSetting).mockImplementation(async (key: string, value: string) => {
      if (key === 'notificationIdSweepV1Done') sweepDone = value;
    });
  }

  it('calls cancelAllScheduledNotificationsAsync exactly once on the first reconcile after upgrade', async () => {
    mockSweepFlagStorage();

    await reconcileScheduledNotifications();

    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not call cancelAllScheduledNotificationsAsync again on a second reconcile', async () => {
    mockSweepFlagStorage();

    await reconcileScheduledNotifications();
    await reconcileScheduledNotifications();

    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('runs the sweep before rescheduling any reminder in the same pass', async () => {
    mockSweepFlagStorage();
    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');

    const callOrder: string[] = [];
    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockImplementation(async () => {
      callOrder.push('sweep');
    });
    jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async () => {
      callOrder.push('schedule:workout-reminder');
      return 'workout-reminder';
    });

    await reconcileScheduledNotifications();

    expect(callOrder[0]).toBe('sweep');
    expect(callOrder).toContain('schedule:workout-reminder');
    expect(callOrder.indexOf('sweep')).toBeLessThan(callOrder.indexOf('schedule:workout-reminder'));
  });

  it('does not immediately cancel the reminder it just rescheduled in the same pass (sweep does not undo its own reschedule)', async () => {
    mockSweepFlagStorage();
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getBackupReminderDay).mockResolvedValue(0);
    jest.mocked(db.getBackupReminderTime).mockResolvedValue('18:00');

    await reconcileScheduledNotifications();

    // The sweep fired once, and the backup reminder was (re)scheduled once
    // after it — not cancelled again afterwards.
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'backup-reminder' })
    );
  });
});

// ─── #311: coalescing in-flight guard + per-reminder isolation ─────────────
//
// #309 gave every recurring reminder a stable OS identifier, so overlapping
// reconcile passes no longer create duplicate entries — but they still
// interleave at `await` points, and whichever pass *writes* last wins, not
// whichever *read* the freshest settings. These helpers give the guard
// tests a controllable app_state store (so a later pass's cancel/schedule
// calls see whatever an earlier pass in the same test actually persisted)
// and a Map-simulated OS schedule (upsert-by-identifier, delete-on-cancel)
// so the tests can assert on the OS's *final* state rather than on call
// counts alone.

/** In-memory stand-in for every app_state key reconcile touches. */
function mockAppStateStore() {
  const store = new Map<string, string>();
  jest.mocked(db.getSetting).mockImplementation(async (key: string) =>
    store.has(key) ? store.get(key)! : null
  );
  jest.mocked(db.setSetting).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  // Pre-seed the #309 sweep flag as already-done: these tests are about the
  // #311 guard/isolation behaviour, not the sweep, so keep it out of the way.
  store.set('notificationIdSweepV1Done', 'true');
  return store;
}

/**
 * In-memory stand-in for the OS's scheduled-notification table, keyed by
 * identifier the way expo-notifications' real upsert-by-identifier
 * semantics work (see the #309 "scheduling the same reminder twice" test
 * above) — extended here to also delete on cancel, so a full
 * schedule-then-cancel round trip is observable.
 */
function mockOsSchedule() {
  const entries = new Map<string, unknown>();
  let counter = 0;
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation(async (request: any) => {
    const id = request.identifier ?? `random-${counter++}`;
    entries.set(id, request);
    return id;
  });
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation(async (id: string) => {
    entries.delete(id);
  });
  return entries;
}

/** A promise plus its resolve function, for controlling exactly when a mocked read settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Drains the entire microtask queue (via a macrotask boundary), so that
 * every promise chain which can make progress without external input has
 * done so before we continue. Needed because resolving a deferred promise
 * synchronously, right after kicking off two calls, resolves it *before*
 * either call has actually reached the `await` that consumes it — which
 * would make both calls observe it as already-settled instead of pending,
 * defeating the "A is still in flight / A's read resolves last" ordering
 * these tests depend on.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('reconcileScheduledNotifications — coalescing in-flight guard (#311)', () => {
  it('a call made while a pass is in flight does not start overlapping work: the OS ends up reflecting the settings the trailing pass read, not the in-flight one', async () => {
    // Reconcile A reads enabled=true (deferred); reconcile B is called while
    // A is still in flight and reads enabled=false; A's read resolves last.
    // The final OS state must reflect B's settings (disabled ⇒ not
    // scheduled) — not A's, and not some interleaved mix of both.
    mockAppStateStore();
    const entries = mockOsSchedule();
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');

    let calls = 0;
    const firstRead = deferred<boolean>();
    jest.mocked(db.getWorkoutReminderEnabled).mockImplementation(() => {
      calls++;
      return calls === 1 ? firstRead.promise : Promise.resolve(false);
    });

    const passA = reconcileScheduledNotifications();
    const passB = reconcileScheduledNotifications(); // called while A is in flight

    // Let B's read (and everything it can do without A) run to completion
    // before A's read resolves, so A really does resolve last.
    await flushMicrotasks();
    firstRead.resolve(true);

    await passA;
    await passB;

    expect(entries.has('workout-reminder')).toBe(false);
  });

  it('N calls that arrive while a pass is in flight collapse into at most 2 _reconcile passes total', async () => {
    mockAppStateStore();
    mockOsSchedule();

    let passStarts = 0;
    const firstRead = deferred<boolean>();
    jest.mocked(db.getWorkoutReminderEnabled).mockImplementation(() => {
      passStarts++;
      return passStarts === 1 ? firstRead.promise : Promise.resolve(false);
    });

    const calls = [
      reconcileScheduledNotifications(),
      reconcileScheduledNotifications(),
      reconcileScheduledNotifications(),
      reconcileScheduledNotifications(),
      reconcileScheduledNotifications(),
    ];

    firstRead.resolve(false);
    await Promise.all(calls);

    expect(passStarts).toBeLessThanOrEqual(2);
  });

  it("a caller's returned promise resolves only once a pass that STARTED AFTER its own call has finished — it must not resolve as soon as the already-running pass finishes", async () => {
    // This is the shape importBackup() (#310) depends on: write settings,
    // then await reconcile — the promise must reflect a pass that actually
    // read the just-written value, not a pass that started earlier and
    // happened to still be in flight.
    mockAppStateStore();
    const entries = mockOsSchedule();
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');

    let calls = 0;
    const firstRead = deferred<boolean>();
    jest.mocked(db.getWorkoutReminderEnabled).mockImplementation(() => {
      calls++;
      // Pass A (already running when the caller below calls in) eventually
      // reads disabled; every pass after it reads enabled.
      return calls === 1 ? firstRead.promise : Promise.resolve(true);
    });

    const passA = reconcileScheduledNotifications();
    const callerPromise = reconcileScheduledNotifications(); // called while A is in flight

    await flushMicrotasks();
    firstRead.resolve(false);
    await passA;
    await callerPromise;

    // The caller's own promise only resolved once a second pass — started
    // after its call, per the contract — had itself read and applied the
    // live (enabled=true) settings.
    expect(calls).toBe(2);
    expect(entries.has('workout-reminder')).toBe(true);
  });

  it('a pass that throws does not wedge the guard — the next call still runs a full pass', async () => {
    // #311's per-reminder isolation (below) means a single getter rejecting
    // is normally contained inside its own try/catch and never escapes
    // _reconcile(). To prove the guard itself is resilient even if
    // something does slip past that isolation, force the escape
    // synthetically: the getter rejects AND the warn-logging call the
    // catch block makes also throws (once), so the error propagates out of
    // that whole pass. The guard must still let the next call run.
    mockAppStateStore();
    const entries = mockOsSchedule();

    jest.mocked(db.getWorkoutReminderEnabled).mockRejectedValueOnce(new Error('boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementationOnce(() => {
      throw new Error('logging exploded');
    });

    await reconcileScheduledNotifications(); // must not hang or wedge the guard
    warnSpy.mockRestore();

    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');

    await reconcileScheduledNotifications();

    expect(entries.has('workout-reminder')).toBe(true);
  });
});

describe('reconcileScheduledNotifications — per-reminder isolation (#311)', () => {
  it('getWeeklyCookDayEnabled rejecting mid-pass does not stop the workout, meal, or backup reminders from being reconciled in the same pass', async () => {
    mockAppStateStore();
    const entries = mockOsSchedule();

    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');
    jest.mocked(db.getWeeklyCookDayEnabled).mockRejectedValue(new Error('cook-day getter exploded'));
    jest.mocked(db.getMealReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getMealReminderTime).mockResolvedValue('08:00');
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getBackupReminderDay).mockResolvedValue(0);
    jest.mocked(db.getBackupReminderTime).mockResolvedValue('18:00');

    await reconcileScheduledNotifications(); // must not throw, and must not skip everything after cook-day

    expect(entries.has('workout-reminder')).toBe(true);
    expect(entries.has('meal-reminder-breakfast')).toBe(true);
    expect(entries.has('meal-reminder-lunch')).toBe(true);
    expect(entries.has('meal-reminder-dinner')).toBe(true);
    expect(entries.has('backup-reminder')).toBe(true);
    // Cook-day itself was skipped — its getter threw — not left half-scheduled.
    expect(entries.has('cookday-reminder')).toBe(false);
  });

  it('one meal reminder getter rejecting does not stop the other two meals from being reconciled in the same pass', async () => {
    mockAppStateStore();
    const entries = mockOsSchedule();

    jest.mocked(db.getMealReminderEnabled).mockImplementation(async (meal: MealType) => {
      if (meal === 'lunch') throw new Error('lunch getter exploded');
      return true;
    });
    jest.mocked(db.getMealReminderTime).mockImplementation(async (meal: MealType) =>
      meal === 'breakfast' ? '08:00' : meal === 'dinner' ? '18:30' : '12:30'
    );

    await reconcileScheduledNotifications();

    expect(entries.has('meal-reminder-breakfast')).toBe(true);
    expect(entries.has('meal-reminder-dinner')).toBe(true);
    expect(entries.has('meal-reminder-lunch')).toBe(false);
  });

  it('does not set the sweep-done flag when the sweep itself throws, and the rest of the pass still runs in that same pass', async () => {
    const store = mockAppStateStore();
    store.delete('notificationIdSweepV1Done'); // undo the pre-seed — we want the sweep to actually run here

    jest.mocked(Notifications.cancelAllScheduledNotificationsAsync).mockRejectedValueOnce(
      new Error('sweep exploded')
    );
    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(true);
    jest.mocked(db.getWorkoutReminderTime).mockResolvedValue('07:00');

    await reconcileScheduledNotifications();

    expect(store.get('notificationIdSweepV1Done')).not.toBe('true');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'workout-reminder' })
    );
  });
});
