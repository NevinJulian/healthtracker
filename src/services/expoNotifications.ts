/**
 * The only place the app loads expo-notifications.
 *
 * expo-notifications 57 cannot even be imported in Expo Go on Android. Its
 * module body registers a push-token listener that throws there
 * (expo/expo#39459), and it requires native modules Expo Go no longer ships,
 * such as ExpoTopicSubscriptionModule. Either one kills the app before its
 * first render.
 *
 * So in Expo Go on Android the package is never loaded, and the app gets the
 * no-op stub below instead. Reminders do nothing there, everything else works.
 * Development and release builds always load the real package.
 *
 * Import notifications through this module only. notificationsImport.test.ts
 * fails if anything else in src/ imports expo-notifications directly.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

type NotificationsModule = typeof ExpoNotifications;

/**
 * Same check as isRunningInExpoGo() from 'expo': the ExpoGo native module
 * only exists inside Expo Go. Importing the 'expo' root here would pull its
 * runtime polyfills into every jest suite that touches notifications, which
 * Jest 30 rejects.
 */
const runningInExpoGo = requireOptionalNativeModule('ExpoGo') != null;

/** False only in Expo Go on Android, where expo-notifications must not load. */
export const notificationsAvailable = !(Platform.OS === 'android' && runningInExpoGo);

const GRANTED = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };

/**
 * Covers exactly the API surface notifications.ts and backup.ts use. Values
 * mirror the real enums. Permission reports granted so the Settings toggles
 * can still be exercised in Expo Go. Scheduling just does nothing.
 */
const expoGoStub = {
  setNotificationHandler: (): void => undefined,
  setNotificationChannelAsync: async (): Promise<null> => null,
  getPermissionsAsync: async () => GRANTED,
  requestPermissionsAsync: async () => GRANTED,
  scheduleNotificationAsync: async (request: { identifier?: string }): Promise<string> =>
    request.identifier ?? 'expo-go-stub',
  cancelScheduledNotificationAsync: async (): Promise<void> => undefined,
  cancelAllScheduledNotificationsAsync: async (): Promise<void> => undefined,
  AndroidImportance: { DEFAULT: 5 },
  SchedulableTriggerInputTypes: {
    CALENDAR: 'calendar',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
    DATE: 'date',
    TIME_INTERVAL: 'timeInterval',
  },
};

function loadNotifications(): NotificationsModule {
  if (notificationsAvailable) {
    // require, not a top-level import, so the package's module body only
    // ever runs where it is safe to.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-notifications') as NotificationsModule;
  }
  console.warn(
    '[Notifications] Expo Go on Android: expo-notifications is not loaded, reminders are disabled.'
  );
  return expoGoStub as unknown as NotificationsModule;
}

const Notifications: NotificationsModule = loadNotifications();

export default Notifications;
