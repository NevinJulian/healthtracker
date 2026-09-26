/**
 * expo-notifications 57 crashes as soon as it is imported in Expo Go on
 * Android, so expoNotifications.ts must never load it there (see that file).
 *
 * These tests make the package throw on load, the way it does in Expo Go,
 * and check that the app's notification and backup services still load and
 * run. Everywhere else the real package has to be the one that loads.
 */

type Environment = { os: 'android' | 'ios'; expoGo: boolean };

const mockSetSetting = jest.fn(() => Promise.resolve());

/**
 * Loads a fresh module registry for the given environment and hands it to
 * `body`. `crashOnLoad` replaces expo-notifications with a module that throws
 * when it is required, which is what the real one does in Expo Go on Android.
 */
function inEnvironment(
  env: Environment,
  crashOnLoad: boolean,
  body: (req: (id: string) => any) => void
): void {
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual('expo-modules-core'),
      requireOptionalNativeModule: (name: string) =>
        name === 'ExpoGo' && env.expoGo ? {} : null,
    }));
    if (crashOnLoad) {
      jest.doMock('expo-notifications', () => {
        throw new Error('expo-notifications was loaded in Expo Go on Android');
      });
    } else {
      // doMock factories outlive isolateModules, so drop the crashing one.
      jest.dontMock('expo-notifications');
    }
    jest.doMock('../../db/database', () => ({
      getSetting: jest.fn(() => Promise.resolve(null)),
      setSetting: mockSetSetting,
    }));
    const { Platform } = require('react-native');
    Platform.OS = env.os;
    body(require);
  });
}

describe('expoNotifications (Expo Go guard)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSetSetting.mockClear();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('Expo Go on Android: never loads expo-notifications, and the services still load and run', async () => {
    let expoNotifications: typeof import('../expoNotifications') | undefined;
    let notifications: typeof import('../notifications') | undefined;

    inEnvironment({ os: 'android', expoGo: true }, true, (req) => {
      expect(() => {
        expoNotifications = req('../expoNotifications');
        notifications = req('../notifications');
        req('../backup');
      }).not.toThrow();
    });

    expect(expoNotifications!.notificationsAvailable).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[Notifications] Expo Go on Android: expo-notifications is not loaded, reminders are disabled.'
    );

    expect(() => notifications!.configureNotificationHandler()).not.toThrow();
    await expect(notifications!.ensureAndroidChannel()).resolves.toBeUndefined();
    await expect(notifications!.ensurePermissions()).resolves.toBe(true);
    await expect(notifications!.scheduleWorkoutReminder('07:30')).resolves.toBeUndefined();
    expect(mockSetSetting).toHaveBeenCalledWith('workoutReminderNotificationId', 'workout-reminder');
  });

  it('Expo Go on iOS: loads the real package', () => {
    inEnvironment({ os: 'ios', expoGo: true }, false, (req) => {
      const mod = req('../expoNotifications');
      expect(mod.notificationsAvailable).toBe(true);
      expect(mod.default).toBe(req('expo-notifications'));
    });
  });

  it('development or release build on Android: loads the real package', () => {
    inEnvironment({ os: 'android', expoGo: false }, false, (req) => {
      const mod = req('../expoNotifications');
      expect(mod.notificationsAvailable).toBe(true);
      expect(mod.default).toBe(req('expo-notifications'));
    });
  });
});
