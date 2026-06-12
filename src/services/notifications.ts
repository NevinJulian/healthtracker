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
 */

import * as Notifications from 'expo-notifications';
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
  type MealType,
} from '../db/database';

// ─── Internal constants ────────────────────────────────────────────────────

const ANDROID_CHANNEL_ID = 'reminders';
const WORKOUT_REMINDER_ID_KEY = 'workoutReminderNotificationId';
const WEEKLY_COOK_DAY_ID_KEY = 'weeklyCookDayNotificationId';

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

// ─── Reconcile ───────────────────────────────────────────────────────────────

/**
 * Read persisted settings and bring the OS scheduled notifications into sync.
 *
 * Call this:
 *   1. From App.tsx after initDatabase() resolves (startup reconcile).
 *   2. From SettingsScreen after any toggle or time change.
 *
 * This is intentionally defensive — any failure is logged, never thrown.
 */
export async function reconcileScheduledNotifications(): Promise<void> {
  try {
    // Workout reminder
    const workoutEnabled = await getWorkoutReminderEnabled();
    const workoutTime = await getWorkoutReminderTime();

    if (workoutEnabled) {
      await scheduleWorkoutReminder(workoutTime);
    } else {
      await cancelWorkoutReminder();
    }

    // Weekly cook-day reminder
    const cookDayEnabled = await getWeeklyCookDayEnabled();
    const cookDay = await getWeeklyCookDay();
    const cookDayTime = await getWeeklyCookDayTime();

    if (cookDayEnabled) {
      await scheduleWeeklyCookDay(cookDay, cookDayTime);
    } else {
      await cancelWeeklyCookDay();
    }

    // Meal-time reminders (#287)
    const meals: MealType[] = ['breakfast', 'lunch', 'dinner'];
    for (const meal of meals) {
      const enabled = await getMealReminderEnabled(meal);
      const time = await getMealReminderTime(meal);
      const { hour, minute } = parseTimeString(time);
      if (enabled) {
        await scheduleMealReminder(meal, hour, minute);
      } else {
        await cancelMealReminder(meal);
      }
    }
  } catch (err) {
    console.warn('[Notifications] reconcileScheduledNotifications failed:', err);
  }
}
