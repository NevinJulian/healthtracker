// Stub for expo-notifications — the native notification module is unavailable
// in Jest's node testEnvironment. All functions resolve as no-ops so tests
// that import notification-aware modules don't crash.

const SchedulableTriggerInputTypes = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  CALENDAR: 'calendar',
  TIME_INTERVAL: 'timeInterval',
  DATE: 'date',
};

module.exports = {
  // Permission
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true })
  ),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true })
  ),

  // Scheduling
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('stub-notification-id')),
  presentNotificationAsync: jest.fn(() => Promise.resolve('stub-present-id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),

  // Android channel
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),

  // Foreground handler
  setNotificationHandler: jest.fn(),

  // Trigger type enum (used in scheduleWorkoutReminder)
  SchedulableTriggerInputTypes,
};
