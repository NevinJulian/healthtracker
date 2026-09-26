/**
 * Notification service — thin wrapper around expo-notifications.
 *
 * Screens and App.tsx never call expo-notifications directly; they use
 * the functions exported from this module. All native calls are wrapped
 * in try/catch so a notification failure never crashes the app.
 *
 * Unit 3a scope:
 *   - ensurePermissions()
 *   - scheduleWorkoutReminder(time)
 *   - cancelWorkoutReminder()
 *   - reconcileScheduledNotifications()
 *
 * Unit 3b additions:
 *   - scheduleWeeklyCookDay(day, time)
 *   - cancelWeeklyCookDay()
 *   - checkAndNotifyEmptyInventory()
 *   - mapWeekdayToExpo(day) — maps 0–6 (JS, Sun=0) to 1–7 (expo, Sun=1)
 *   - reconcileScheduledNotifications() extended to sync weekly cook-day
 *
 * #287 additions:
 *   - scheduleMealReminder(meal, hour, minute)
 *   - cancelMealReminder(meal)
 *   - reconcileScheduledNotifications() extended to sync meal reminders
 *
 * #293 additions:
 *   - scheduleBackupReminder(day, time)
 *   - cancelBackupReminder()
 *   - getBackupReminderIdentifier()
 *   - reconcileScheduledNotifications() extended to sync backup reminder
 *
 * #309 additions:
 *   - All 4 recurring scheduleNotificationAsync calls (workout, cook-day,
 *     meal, backup) now pass a stable `identifier` instead of letting
 *     expo-notifications assign a random UUID, so rescheduling the same
 *     reminder replaces the OS entry instead of duplicating it.
 *   - reconcileScheduledNotifications() runs a one-shot
 *     cancelAllScheduledNotificationsAsync() sweep on the first call after
 *     upgrade (gated by the notificationIdSweepV1Done app_state flag),
 *     before any per-reminder rescheduling in that same pass, to clear out
 *     notifications scheduled under the old random-UUID scheme.
 */

import Notifications from './expoNotifications';
import { Platform } from 'react-native';
import {
  getSetting,
  setSetting,
  getWorkoutReminderEnabled,
  getWorkoutReminderTime,
  getWeeklyCookDayEnabled,
  getWeeklyCookDay,
  getWeeklyCookDayTime,
  getMealInventory,
  getCookEmptyNotified,
  setCookEmptyNotified,
  getMealReminderEnabled,
  getMealReminderTime,
  getBackupReminderEnabled,
  getBackupReminderDay,
  getBackupReminderTime,
  type MealType,
} from '../db/database';

// ─── Internal constants ────────────────────────────────────────────────────

const ANDROID_CHANNEL_ID = 'reminders';
const WORKOUT_REMINDER_ID_KEY = 'workoutReminderNotificationId';
const WEEKLY_COOK_DAY_ID_KEY = 'weeklyCookDayNotificationId';

/** Stable notification identifier for the workout reminder (#309). */
const WORKOUT_REMINDER_IDENTIFIER = 'workout-reminder';
/** Stable notification identifier for the weekly cook-day reminder (#309). */
const COOKDAY_REMINDER_IDENTIFIER = 'cookday-reminder';

/** Stable notification identifier for the backup reminder. */
const BACKUP_REMINDER_IDENTIFIER = 'backup-reminder';
/** app_state key for the OS-scheduled notification id. */
const BACKUP_REMINDER_ID_KEY = 'backupReminderNotificationId';

/**
 * app_state flag gating the one-shot post-upgrade sweep in
 * reconcileScheduledNotifications() — see #309.
 */
const NOTIFICATION_ID_SWEEP_V1_KEY = 'notificationIdSweepV1Done';

// ─── Foreground display handler ────────────────────────────────────────────

/**
 * Configure expo-notifications to show banners even while the app is open.
 * Call once at startup (before any scheduling).
 */
export function configureNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (err) {
    console.warn('[Notifications] setNotificationHandler failed:', err);
  }
}

// ─── Android channel ────────────────────────────────────────────────────────

/**
 * Create (or update) the Android notification channel required on API 26+.
 * Safe to call on iOS — the call is a no-op on non-Android platforms.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance
        ? Notifications.AndroidImportance.DEFAULT
        : (3 as any),
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C9A85', // sage — intentional: channel config, not UI style
    });
  } catch (err) {
    console.warn('[Notifications] setNotificationChannelAsync failed:', err);
  }
}

// ─── Permission ─────────────────────────────────────────────────────────────

/**
 * Check current permission status and request if not yet granted.
 * Returns true when the app has (or is granted) notification permission,
 * false when the user denies or has permanently blocked it.
 */
export async function ensurePermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('[Notifications] permission check failed:', err);
    return false;
  }
}

// ─── Workout reminder ────────────────────────────────────────────────────────

/**
 * Parse a "HH:MM" time string into { hour, minute }.
 * Returns { hour: 8, minute: 0 } as a safe fallback on any parse error.
 */
export function parseTimeString(time: string): { hour: number; minute: number } {
  const [hStr, mStr] = time.split(':');
  const hour = parseInt(hStr ?? '8', 10);
  const minute = parseInt(mStr ?? '0', 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 8, minute: 0 };
  }
  return { hour, minute };
}

/**
 * Format { hour, minute } back to "HH:MM".
 */
export function formatTimeString(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Schedule a daily repeating workout reminder at the given "HH:MM" time.
 * Cancels any previously scheduled reminder first, then persists the new ID.
 */
export async function scheduleWorkoutReminder(time: string): Promise<void> {
  try {
    // Cancel the existing one if present
    await cancelWorkoutReminder();

    const { hour, minute } = parseTimeString(time);

    const id = await Notifications.scheduleNotificationAsync({
      identifier: WORKOUT_REMINDER_IDENTIFIER,
      content: {
        title: 'Time to train',
        body: "Your workout is waiting. Let's do this.",
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      } as any,
    });

    await setSetting(WORKOUT_REMINDER_ID_KEY, id);
    console.log(`[Notifications] Workout reminder scheduled at ${time} (id: ${id})`);
  } catch (err) {
    console.warn('[Notifications] scheduleWorkoutReminder failed:', err);
  }
}

/**
 * Cancel the previously scheduled workout reminder (if any).
 * Silently succeeds when no reminder was previously scheduled.
 */
export async function cancelWorkoutReminder(): Promise<void> {
  try {
    const id = await getSetting(WORKOUT_REMINDER_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await setSetting(WORKOUT_REMINDER_ID_KEY, '');
      console.log(`[Notifications] Workout reminder cancelled (id: ${id})`);
    }
  } catch (err) {
    console.warn('[Notifications] cancelWorkoutReminder failed:', err);
  }
}

// ─── Weekly cook-day reminder ────────────────────────────────────────────────

/**
 * Map a JS weekday (0–6, 0 = Sunday) to expo-notifications weekday (1–7, 1 = Sunday).
 * Exported so it can be unit-tested without any native dependencies.
 */
export function mapWeekdayToExpo(day: number): number {
  // JS: 0=Sun,1=Mon,...,6=Sat → expo: 1=Sun,2=Mon,...,7=Sat
  return day + 1;
}

/**
 * Schedule a weekly repeating cook-day reminder on the given weekday + time.
 * Cancels any previously scheduled cook-day notification first.
 *
 * @param day  0–6 (0 = Sunday)
 * @param time "HH:MM"
 */
export async function scheduleWeeklyCookDay(day: number, time: string): Promise<void> {
  try {
    await cancelWeeklyCookDay();

    const { hour, minute } = parseTimeString(time);
    const weekday = mapWeekdayToExpo(day);

    const id = await Notifications.scheduleNotificationAsync({
      identifier: COOKDAY_REMINDER_IDENTIFIER,
      content: {
        title: 'Cook day',
        body: 'Time to restock your meals for the week.',
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
      } as any,
    });

    await setSetting(WEEKLY_COOK_DAY_ID_KEY, id);
    console.log(`[Notifications] Weekly cook-day scheduled (weekday ${weekday}, ${time}, id: ${id})`);
  } catch (err) {
    console.warn('[Notifications] scheduleWeeklyCookDay failed:', err);
  }
}

/**
 * Cancel the previously scheduled weekly cook-day reminder (if any).
 */
export async function cancelWeeklyCookDay(): Promise<void> {
  try {
    const id = await getSetting(WEEKLY_COOK_DAY_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await setSetting(WEEKLY_COOK_DAY_ID_KEY, '');
      console.log(`[Notifications] Weekly cook-day reminder cancelled (id: ${id})`);
    }
  } catch (err) {
    console.warn('[Notifications] cancelWeeklyCookDay failed:', err);
  }
}

// ─── Meal-time reminders (#287) ─────────────────────────────────────────────

/** Stable identifier for each meal's daily notification. */
const MEAL_REMINDER_IDS: Record<MealType, string> = {
  breakfast: 'meal-reminder-breakfast',
  lunch:     'meal-reminder-lunch',
  dinner:    'meal-reminder-dinner',
};

/** Key under which we persist the scheduled notification ID for each meal. */
const MEAL_REMINDER_ID_KEYS: Record<MealType, string> = {
  breakfast: 'mealReminderBreakfastNotificationId',
  lunch:     'mealReminderLunchNotificationId',
  dinner:    'mealReminderDinnerNotificationId',
};

const MEAL_REMINDER_CONTENT: Record<MealType, { title: string; body: string }> = {
  breakfast: { title: 'Breakfast time',  body: 'Time to log your breakfast.' },
  lunch:     { title: 'Lunch time',      body: 'Time to log your lunch.' },
  dinner:    { title: 'Dinner time',     body: 'Time to log your dinner.' },
};

/**
 * Schedule a daily repeating meal reminder at the given hour and minute.
 * Uses the same DAILY trigger pattern as the workout reminder.
 * The stable identifier is `meal-reminder-<meal>`.
 */
export async function scheduleMealReminder(meal: MealType, hour: number, minute: number): Promise<void> {
  try {
    await cancelMealReminder(meal);

    const { title, body } = MEAL_REMINDER_CONTENT[meal];

    const id = await Notifications.scheduleNotificationAsync({
      identifier: getMealReminderIdentifier(meal),
      content: {
        title,
        body,
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      } as any,
    });

    await setSetting(MEAL_REMINDER_ID_KEYS[meal], id);
    console.log(`[Notifications] Meal reminder (${meal}) scheduled at ${formatTimeString(hour, minute)} (id: ${id})`);
  } catch (err) {
    console.warn(`[Notifications] scheduleMealReminder(${meal}) failed:`, err);
  }
}

/**
 * Cancel the previously scheduled daily reminder for the given meal (if any).
 * Silently succeeds when no reminder was previously scheduled.
 */
export async function cancelMealReminder(meal: MealType): Promise<void> {
  try {
    const id = await getSetting(MEAL_REMINDER_ID_KEYS[meal]);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await setSetting(MEAL_REMINDER_ID_KEYS[meal], '');
      console.log(`[Notifications] Meal reminder (${meal}) cancelled (id: ${id})`);
    }
  } catch (err) {
    console.warn(`[Notifications] cancelMealReminder(${meal}) failed:`, err);
  }
}

/**
 * Returns the stable notification identifier string for a given meal.
 * Exported for use in tests.
 */
export function getMealReminderIdentifier(meal: MealType): string {
  return MEAL_REMINDER_IDS[meal];
}

// ─── Cook-when-empty nudge ───────────────────────────────────────────────────

/**
 * Determine whether an immediate "inventory empty" notification should fire.
 *
 * Exported as a pure decision helper so it can be unit-tested without
 * any DB or native calls.
 *
 * @param totalPortions   Sum of portions_available across all inventory rows.
 * @param alreadyNotified Whether the debounce flag is already set.
 * @returns true when the notification should be presented.
 */
export function shouldNotifyEmpty(totalPortions: number, alreadyNotified: boolean): boolean {
  return totalPortions === 0 && !alreadyNotified;
}

/**
 * Check inventory and, when empty and not yet notified in this episode,
 * present an immediate local notification and set the debounce flag.
 *
 * This is an in-app triggered check — there is no background OS scheduling
 * for this notification type. The caller is responsible for invoking this
 * at appropriate moments (after consuming a meal, on relevant screen focus).
 *
 * The debounce flag (cookEmptyNotified in app_state) is cleared by
 * resetCookEmptyNotified() when cooking finishes and inventory is replenished,
 * so each new empty episode produces exactly one notification.
 */
export async function checkAndNotifyEmptyInventory(): Promise<void> {
  try {
    const enabled = await (await import('../db/database')).getCookWhenEmptyEnabled();
    if (!enabled) return;

    const inventory = await getMealInventory();
    const totalPortions = inventory.reduce((sum, item) => sum + item.portions_available, 0);
    const alreadyNotified = await getCookEmptyNotified();

    if (!shouldNotifyEmpty(totalPortions, alreadyNotified)) return;

    // Use a 1-second interval trigger to present an immediate notification.
    // expo-notifications does not expose a "present now" API directly; the
    // shortest repeatable trigger is TIME_INTERVAL with seconds >= 1 and
    // repeats: false.
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Meal stock empty',
        body: "You're out of prepped meals — time to cook a batch.",
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        repeats: false,
      },
    });

    await setCookEmptyNotified(true);
    console.log('[Notifications] Cook-when-empty notification presented.');
  } catch (err) {
    console.warn('[Notifications] checkAndNotifyEmptyInventory failed:', err);
  }
}

// ─── Backup reminder (#293) ──────────────────────────────────────────────────

/**
 * Returns the stable notification identifier string for the backup reminder.
 * Exported for use in tests.
 */
export function getBackupReminderIdentifier(): string {
  return BACKUP_REMINDER_IDENTIFIER;
}

/**
 * Schedule a weekly repeating backup reminder on the given weekday + time.
 * Cancels any previously scheduled backup reminder first.
 *
 * Uses the same WEEKLY trigger pattern as scheduleWeeklyCookDay.
 *
 * @param day  0–6 (0 = Sunday)
 * @param time "HH:MM"
 */
export async function scheduleBackupReminder(day: number, time: string): Promise<void> {
  try {
    await cancelBackupReminder();

    const { hour, minute } = parseTimeString(time);
    const weekday = mapWeekdayToExpo(day);

    const id = await Notifications.scheduleNotificationAsync({
      identifier: getBackupReminderIdentifier(),
      content: {
        title: 'Back up your data',
        body: "It's been a while — save a backup so you don't lose your history.",
        sound: false,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour,
        minute,
      } as any,
    });

    await setSetting(BACKUP_REMINDER_ID_KEY, id);
    console.log(`[Notifications] Backup reminder scheduled (weekday ${weekday}, ${time}, id: ${id})`);
  } catch (err) {
    console.warn('[Notifications] scheduleBackupReminder failed:', err);
  }
}

/**
 * Cancel the previously scheduled backup reminder (if any).
 * Silently succeeds when no reminder was previously scheduled.
 */
export async function cancelBackupReminder(): Promise<void> {
  try {
    const id = await getSetting(BACKUP_REMINDER_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await setSetting(BACKUP_REMINDER_ID_KEY, '');
      console.log(`[Notifications] Backup reminder cancelled (id: ${id})`);
    }
  } catch (err) {
    console.warn('[Notifications] cancelBackupReminder failed:', err);
  }
}

// ─── Reconcile ───────────────────────────────────────────────────────────────

/** The `_reconcile()` pass currently in flight, if any (#311). */
let inFlightPass: Promise<void> | null = null;
/** A single trailing pass queued to start once `inFlightPass` finishes (#311). */
let queuedPass: Promise<void> | null = null;
/** Resolver for the promise handed out to every caller sharing `queuedPass`. */
let queuedResolve: (() => void) | null = null;

/**
 * Read persisted settings and bring the OS scheduled notifications into sync.
 *
 * Call this:
 *   1. From App.tsx after initDatabase() resolves (startup reconcile).
 *   2. From SettingsScreen after any toggle or time change.
 *   3. From importBackup() after a successful restore (#310).
 *
 * This is intentionally defensive — any failure is logged, never thrown.
 *
 * Coalescing in-flight guard (#311): at most one `_reconcile()` pass runs at
 * a time. A call made while a pass is already running does not start a
 * second, overlapping pass — every such call joins a single trailing pass
 * (shared by all of them), which starts only once the current pass finishes
 * and re-reads live settings at that point.
 *
 * CONTRACT: the promise returned to a caller resolves only once a pass that
 * STARTED AFTER that call has completed — never the promise of a pass that
 * was already running when the call was made. This matters because
 * importBackup() (#310) awaits this immediately after restoring settings and
 * must observe a pass that actually read the restored values, not a stale
 * one that may have already read the old ones before the restore happened.
 */
export function reconcileScheduledNotifications(): Promise<void> {
  if (!inFlightPass) {
    inFlightPass = runPass();
    return inFlightPass;
  }
  if (!queuedPass) {
    queuedPass = new Promise<void>((resolve) => {
      queuedResolve = resolve;
    });
  }
  return queuedPass;
}

/**
 * Runs one `_reconcile()` pass and, once it settles, atomically either
 * clears the in-flight guard or hands off to the queued trailing pass (if
 * any caller joined one while this pass was running). The hand-off happens
 * synchronously inside a single `.finally()` callback so there is no window
 * where another caller could observe an inconsistent guard state.
 */
function runPass(): Promise<void> {
  return _reconcile()
    .catch((err) => {
      // _reconcile() isolates every reminder behind its own try/catch (see
      // below), so this should never actually fire — but it's the backstop
      // that guarantees the guard can't get stuck on `inFlightPass` if
      // something unexpected still slips through (#311).
      console.warn('[Notifications] reconcileScheduledNotifications failed:', err);
    })
    .finally(() => {
      if (queuedResolve) {
        const resolve = queuedResolve;
        queuedPass = null;
        queuedResolve = null;
        inFlightPass = runPass();
        inFlightPass.then(resolve, resolve);
      } else {
        inFlightPass = null;
      }
    });
}

/**
 * Runs the actual reconcile pass. Each reminder is isolated behind its own
 * try/catch (#311) so one throwing getter only skips that reminder instead
 * of aborting every reminder after it in the same pass — stable identifiers
 * (#309) make (re)scheduling idempotent, so it's safe for the rest of the
 * pass to keep going regardless of which step failed.
 */
async function _reconcile(): Promise<void> {
  // One-shot post-upgrade sweep (#309): notifications scheduled before
  // stable identifiers existed carry Expo-random UUIDs, so rescheduling
  // under the new stable ids would leave those old entries orphaned in
  // the OS. Clear everything exactly once, gated by an app_state flag,
  // BEFORE any of the per-reminder (re)scheduling below in this same pass.
  // If the sweep itself throws, the flag is deliberately left unset (so a
  // later pass retries it) rather than being set in the catch block.
  try {
    const sweepDone = await getSetting(NOTIFICATION_ID_SWEEP_V1_KEY);
    if (sweepDone !== 'true') {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await setSetting(NOTIFICATION_ID_SWEEP_V1_KEY, 'true');
      console.log('[Notifications] One-time notification-id sweep complete.');
    }
  } catch (err) {
    console.warn('[Notifications] reconcile: notification-id sweep failed:', err);
  }

  // Workout reminder
  try {
    const workoutEnabled = await getWorkoutReminderEnabled();
    const workoutTime = await getWorkoutReminderTime();

    if (workoutEnabled) {
      await scheduleWorkoutReminder(workoutTime);
    } else {
      await cancelWorkoutReminder();
    }
  } catch (err) {
    console.warn('[Notifications] reconcile: workout reminder failed:', err);
  }

  // Weekly cook-day reminder
  try {
    const cookDayEnabled = await getWeeklyCookDayEnabled();
    const cookDay = await getWeeklyCookDay();
    const cookDayTime = await getWeeklyCookDayTime();

    if (cookDayEnabled) {
      await scheduleWeeklyCookDay(cookDay, cookDayTime);
    } else {
      await cancelWeeklyCookDay();
    }
  } catch (err) {
    console.warn('[Notifications] reconcile: weekly cook-day reminder failed:', err);
  }

  // Meal-time reminders (#287) — isolated per meal so one bad getter only
  // skips that meal, not the other two.
  const meals: MealType[] = ['breakfast', 'lunch', 'dinner'];
  for (const meal of meals) {
    try {
      const enabled = await getMealReminderEnabled(meal);
      const time = await getMealReminderTime(meal);
      const { hour, minute } = parseTimeString(time);
      if (enabled) {
        await scheduleMealReminder(meal, hour, minute);
      } else {
        await cancelMealReminder(meal);
      }
    } catch (err) {
      console.warn(`[Notifications] reconcile: meal reminder (${meal}) failed:`, err);
    }
  }

  // Backup reminder (#293)
  try {
    const backupEnabled = await getBackupReminderEnabled();
    const backupDay = await getBackupReminderDay();
    const backupTime = await getBackupReminderTime();

    if (backupEnabled) {
      await scheduleBackupReminder(backupDay, backupTime);
    } else {
      await cancelBackupReminder();
    }
  } catch (err) {
    console.warn('[Notifications] reconcile: backup reminder failed:', err);
  }
}
