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
 * Unit 3b can add cooking-reminder equivalents here.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  getSetting,
  setSetting,
  getWorkoutReminderEnabled,
  getWorkoutReminderTime,
} from '../db/database';

// ─── Internal constants ────────────────────────────────────────────────────

const ANDROID_CHANNEL_ID = 'reminders';
const WORKOUT_REMINDER_ID_KEY = 'workoutReminderNotificationId';

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
    const enabled = await getWorkoutReminderEnabled();
    const time = await getWorkoutReminderTime();

    if (enabled) {
      await scheduleWorkoutReminder(time);
    } else {
      await cancelWorkoutReminder();
    }
  } catch (err) {
    console.warn('[Notifications] reconcileScheduledNotifications failed:', err);
  }
}
