import * as Notifications from 'expo-notifications';
import * as db from '../../db/database';
import {
  cancelWeeklyReview,
  getWeeklyReviewIdentifier,
  reconcileScheduledNotifications,
  resetReconcileStateForTests,
  scheduleWeeklyReview,
  subscribeToWeeklyReviewTaps,
  takeLaunchWeeklyReviewTap,
} from '../notifications';

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
  getWeeklyReviewEnabled: jest.fn(),
  getWeeklyReviewDay: jest.fn(),
  getWeeklyReviewTime: jest.fn(),
}));

const schedule = jest.mocked(Notifications.scheduleNotificationAsync);
const cancel = jest.mocked(Notifications.cancelScheduledNotificationAsync);

function reviewScheduleCalls() {
  return schedule.mock.calls.filter(([request]) => request.identifier === 'weekly-review');
}

function reviewCancelCalls() {
  return cancel.mock.calls.filter(([identifier]) => identifier === 'weekly-review');
}

function mockStores() {
  const settings = new Map<string, string>([['notificationIdSweepV1Done', 'true']]);
  jest.mocked(db.getSetting).mockImplementation(async (key: string) => settings.get(key) ?? null);
  jest.mocked(db.setSetting).mockImplementation(async (key: string, value: string) => {
    settings.set(key, value);
  });
  const os = new Map<string, unknown>();
  schedule.mockImplementation(async (request) => {
    os.set(request.identifier as string, request);
    return request.identifier as string;
  });
  cancel.mockImplementation(async (identifier) => {
    os.delete(identifier);
  });
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(async () =>
    [...os.keys()].map((identifier) => ({ identifier })) as never
  );
  return { settings, os };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetReconcileStateForTests();
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
  jest.mocked(db.getWeeklyReviewEnabled).mockResolvedValue(true);
  jest.mocked(db.getWeeklyReviewDay).mockResolvedValue(0);
  jest.mocked(db.getWeeklyReviewTime).mockResolvedValue('19:00');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('weekly review scheduling', () => {
  it('uses the stable identifier weekly-review', () => {
    expect(getWeeklyReviewIdentifier()).toBe('weekly-review');
  });

  it('schedules a weekly notification with the title, body and trigger', async () => {
    mockStores();
    await scheduleWeeklyReview(0, '19:00');

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'weekly-review',
        content: expect.objectContaining({
          title: 'Your week in review',
          body: 'Tap to see the last 7 days.',
        }),
        trigger: expect.objectContaining({ type: 'weekly', weekday: 1, hour: 19, minute: 0 }),
      })
    );
  });

  it('maps the chosen day and time into the trigger', async () => {
    mockStores();
    await scheduleWeeklyReview(6, '07:45');

    expect(schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({ weekday: 7, hour: 7, minute: 45 }),
      })
    );
  });

  it('stores the OS id under weeklyReviewNotificationId', async () => {
    const { settings } = mockStores();
    await scheduleWeeklyReview(0, '19:00');
    expect(settings.get('weeklyReviewNotificationId')).toBe('weekly-review');
  });

  it('cancels by identifier', async () => {
    mockStores();
    await cancelWeeklyReview();
    expect(cancel).toHaveBeenCalledWith('weekly-review');
  });
});

describe('weekly review reconcile', () => {
  it('schedules once with the defaults Sunday 19:00', async () => {
    mockStores();
    await reconcileScheduledNotifications();

    expect(reviewScheduleCalls()).toHaveLength(1);
    expect(reviewScheduleCalls()[0][0]).toEqual(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Your week in review',
          body: 'Tap to see the last 7 days.',
        }),
        trigger: expect.objectContaining({ type: 'weekly', weekday: 1, hour: 19, minute: 0 }),
      })
    );
  });

  it('cancels and does not schedule when disabled', async () => {
    mockStores();
    jest.mocked(db.getWeeklyReviewEnabled).mockResolvedValue(false);
    await reconcileScheduledNotifications();

    expect(reviewScheduleCalls()).toHaveLength(0);
    expect(reviewCancelCalls().length).toBeGreaterThan(0);
  });

  it('makes no schedule or cancel call for it on a second pass with no change', async () => {
    mockStores();
    await reconcileScheduledNotifications();
    schedule.mockClear();
    cancel.mockClear();

    await reconcileScheduledNotifications();

    expect(reviewScheduleCalls()).toHaveLength(0);
    expect(reviewCancelCalls()).toHaveLength(0);
  });

  it('reschedules when the day changes', async () => {
    mockStores();
    await reconcileScheduledNotifications();
    schedule.mockClear();
    jest.mocked(db.getWeeklyReviewDay).mockResolvedValue(3);

    await reconcileScheduledNotifications();

    expect(reviewScheduleCalls()).toHaveLength(1);
    expect(reviewScheduleCalls()[0][0]).toEqual(
      expect.objectContaining({ trigger: expect.objectContaining({ weekday: 4 }) })
    );
  });

  it('still reconciles the other reminders when the weekly review getter throws', async () => {
    mockStores();
    jest.mocked(db.getWeeklyReviewEnabled).mockRejectedValue(new Error('boom'));
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true);

    await expect(reconcileScheduledNotifications()).resolves.toBeUndefined();

    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'backup-reminder' }));
  });
});

describe('weekly review taps', () => {
  const response = (identifier: string) =>
    ({ notification: { request: { identifier } } }) as never;

  function captureListener() {
    const remove = jest.fn();
    let listener: (event: never) => void = () => {};
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation(((
      fn: (event: never) => void
    ) => {
      listener = fn;
      return { remove };
    }) as never);
    return { remove, fire: (event: never) => listener(event) };
  }

  it('calls back only for a weekly-review tap', () => {
    const { fire } = captureListener();
    const onTap = jest.fn();
    subscribeToWeeklyReviewTaps(onTap);

    fire(response('backup-reminder'));
    expect(onTap).not.toHaveBeenCalled();
    fire(response('weekly-review'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('removes the subscription when the returned function is called', () => {
    const { remove } = captureListener();
    const unsubscribe = subscribeToWeeklyReviewTaps(jest.fn());
    expect(remove).not.toHaveBeenCalled();
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op when the listener cannot be registered', () => {
    jest.mocked(Notifications.addNotificationResponseReceivedListener).mockImplementation(() => {
      throw new Error('no native module');
    });
    const unsubscribe = subscribeToWeeklyReviewTaps(jest.fn());
    expect(() => unsubscribe()).not.toThrow();
  });

  it('reports a launch tap for weekly-review and clears it', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('weekly-review'));
    expect(takeLaunchWeeklyReviewTap()).toBe(true);
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('clears but does not report a launch tap for another reminder', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(response('backup-reminder'));
    expect(takeLaunchWeeklyReviewTap()).toBe(false);
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when the app was not opened from a notification', () => {
    expect(takeLaunchWeeklyReviewTap()).toBe(false);
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  it('reports nothing when reading the launch response throws', () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockImplementation(() => {
      throw new Error('no native module');
    });
    expect(takeLaunchWeeklyReviewTap()).toBe(false);
  });
});
