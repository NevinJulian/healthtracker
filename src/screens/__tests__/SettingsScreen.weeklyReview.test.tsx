import React from 'react';
import { Alert, AppState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn().mockResolvedValue(false),
  getWorkoutReminderTime: jest.fn().mockResolvedValue('08:00'),
  setWorkoutReminderEnabled: jest.fn().mockResolvedValue(undefined),
  setWorkoutReminderTime: jest.fn().mockResolvedValue(undefined),
  getCookWhenEmptyEnabled: jest.fn().mockResolvedValue(false),
  setCookWhenEmptyEnabled: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDayEnabled: jest.fn().mockResolvedValue(false),
  setWeeklyCookDayEnabled: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDay: jest.fn().mockResolvedValue(0),
  setWeeklyCookDay: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDayTime: jest.fn().mockResolvedValue('10:00'),
  setWeeklyCookDayTime: jest.fn().mockResolvedValue(undefined),
  getMealReminderEnabled: jest.fn().mockResolvedValue(false),
  getMealReminderTime: jest.fn().mockResolvedValue('08:00'),
  setMealReminderEnabled: jest.fn().mockResolvedValue(undefined),
  setMealReminderTime: jest.fn().mockResolvedValue(undefined),
  getBackupReminderEnabled: jest.fn().mockResolvedValue(false),
  setBackupReminderEnabled: jest.fn().mockResolvedValue(undefined),
  getBackupReminderDay: jest.fn().mockResolvedValue(0),
  setBackupReminderDay: jest.fn().mockResolvedValue(undefined),
  getBackupReminderTime: jest.fn().mockResolvedValue('18:00'),
  setBackupReminderTime: jest.fn().mockResolvedValue(undefined),
  getWeeklyReviewEnabled: jest.fn().mockResolvedValue(true),
  setWeeklyReviewEnabled: jest.fn().mockResolvedValue(undefined),
  getWeeklyReviewDay: jest.fn().mockResolvedValue(0),
  setWeeklyReviewDay: jest.fn().mockResolvedValue(undefined),
  getWeeklyReviewTime: jest.fn().mockResolvedValue('19:00'),
  setWeeklyReviewTime: jest.fn().mockResolvedValue(undefined),
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 1800, protein: 150 }),
  setNutritionGoalCalories: jest.fn().mockResolvedValue(undefined),
  setNutritionGoalProtein: jest.fn().mockResolvedValue(undefined),
  setNutritionGoals: jest.fn().mockResolvedValue(undefined),
  getUserProfile: jest.fn().mockResolvedValue({
    heightCm: null,
    age: null,
    sex: null,
    activityLevel: null,
    goalType: null,
  }),
  setProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  setProfileAge: jest.fn().mockResolvedValue(undefined),
  clearProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  clearProfileAge: jest.fn().mockResolvedValue(undefined),
  setProfileSex: jest.fn().mockResolvedValue(undefined),
  setProfileActivityLevel: jest.fn().mockResolvedValue(undefined),
  setProfileGoalType: jest.fn().mockResolvedValue(undefined),
  getLatestBodyWeight: jest.fn().mockResolvedValue(null),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  setHydrationGoal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notifications', () => ({
  ...jest.requireActual('../../services/notifications'),
  ensurePermissions: jest.fn().mockResolvedValue(true),
  reconcileScheduledNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleMealReminder: jest.fn().mockResolvedValue(undefined),
  cancelMealReminder: jest.fn().mockResolvedValue(undefined),
  scheduleBackupReminder: jest.fn().mockResolvedValue(undefined),
  cancelBackupReminder: jest.fn().mockResolvedValue(undefined),
  scheduleWeeklyReview: jest.fn().mockResolvedValue(undefined),
  cancelWeeklyReview: jest.fn().mockResolvedValue(undefined),
}));

import SettingsScreen from '../SettingsScreen';
import * as db from '../../db/database';
import { ensurePermissions, reconcileScheduledNotifications } from '../../services/notifications';

const mockReconcile = jest.mocked(reconcileScheduledNotifications);
const mockEnsure = jest.mocked(ensurePermissions);
const mockAddEventListener = jest.mocked(AppState.addEventListener);

const TOGGLE = 'Enable weekly review';

async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function mount() {
  const utils = render(<SettingsScreen />);
  await flushMicrotasks();
  return utils;
}

async function toggle(utils: ReturnType<typeof render>, value: boolean) {
  await act(async () => {
    fireEvent(utils.getByLabelText(TOGGLE), 'valueChange', value);
  });
  await flushMicrotasks();
}

function appStateListener(): (state: string) => void {
  const calls = mockAddEventListener.mock.calls;
  return calls[calls.length - 1][1] as (state: string) => void;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(db.getWeeklyReviewEnabled).mockResolvedValue(true);
  jest.mocked(db.getWeeklyReviewDay).mockResolvedValue(0);
  jest.mocked(db.getWeeklyReviewTime).mockResolvedValue('19:00');
  mockEnsure.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SettingsScreen weekly review', () => {
  it('shows the toggle on by default with the day chips, steppers and preview', async () => {
    const utils = await mount();

    expect(utils.getAllByText('Weekly review')).toHaveLength(2);
    expect(utils.getByText('A summary of the last 7 days on your chosen day')).toBeTruthy();
    expect(utils.getByLabelText(TOGGLE).props.value).toBe(true);
    expect(utils.getByLabelText('Select Tue')).toBeTruthy();
    expect(utils.getByLabelText('Increase Hour')).toBeTruthy();
    expect(utils.getByLabelText('Increase Minute')).toBeTruthy();
    expect(utils.getByText('Review every Sun at 19:00')).toBeTruthy();
  });

  it('selecting a day writes it and reconciles', async () => {
    const utils = await mount();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Select Tue'));
    });
    await flushMicrotasks();

    expect(db.setWeeklyReviewDay).toHaveBeenCalledWith(2);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(utils.getByText('Review every Tue at 19:00')).toBeTruthy();
  });

  it('stepping the hour writes the time once after the debounce and reconciles', async () => {
    const utils = await mount();

    fireEvent.press(utils.getByLabelText('Increase Hour'));
    fireEvent.press(utils.getByLabelText('Increase Hour'));
    expect(db.setWeeklyReviewTime).not.toHaveBeenCalled();
    expect(utils.getByText('Review every Sun at 21:00')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flushMicrotasks();

    expect(db.setWeeklyReviewTime).toHaveBeenCalledTimes(1);
    expect(db.setWeeklyReviewTime).toHaveBeenCalledWith('21:00');
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending time write when the app goes to the background', async () => {
    const utils = await mount();

    fireEvent.press(utils.getByLabelText('Increase Minute'));
    expect(db.setWeeklyReviewTime).not.toHaveBeenCalled();

    await act(async () => {
      appStateListener()('background');
    });
    await flushMicrotasks();

    expect(db.setWeeklyReviewTime).toHaveBeenCalledWith('19:15');
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it('turning it off writes the setting, reconciles and hides the day and time controls', async () => {
    const utils = await mount();

    await toggle(utils, false);

    expect(db.setWeeklyReviewEnabled).toHaveBeenCalledWith(false);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(utils.queryByLabelText('Select Tue')).toBeNull();
    expect(utils.queryByText(/Review every/)).toBeNull();
  });

  it('turning it back on writes the setting and reconciles', async () => {
    jest.mocked(db.getWeeklyReviewEnabled).mockResolvedValue(false);
    const utils = await mount();
    expect(utils.getByLabelText(TOGGLE).props.value).toBe(false);

    await toggle(utils, true);

    expect(mockEnsure).toHaveBeenCalledTimes(1);
    expect(db.setWeeklyReviewEnabled).toHaveBeenCalledWith(true);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(utils.getByLabelText('Select Tue')).toBeTruthy();
  });

  it('does not turn it on when notification permission is refused', async () => {
    jest.mocked(db.getWeeklyReviewEnabled).mockResolvedValue(false);
    mockEnsure.mockResolvedValue(false);
    const utils = await mount();

    await toggle(utils, true);

    expect(db.setWeeklyReviewEnabled).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(utils.getByLabelText(TOGGLE).props.value).toBe(false);
  });

  it('reports a write failure and does not reconcile', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(db.setWeeklyReviewEnabled).mockRejectedValueOnce(new Error('disk full'));
    const utils = await mount();

    await toggle(utils, false);

    expect(alert).toHaveBeenCalledWith('Error', 'Failed to save your setting. Please try again.');
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(utils.getByLabelText(TOGGLE).props.value).toBe(true);
  });

  it('reports a day write failure', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(db.setWeeklyReviewDay).mockRejectedValueOnce(new Error('disk full'));
    const utils = await mount();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Select Tue'));
    });
    await flushMicrotasks();

    expect(alert).toHaveBeenCalledWith('Error', 'Failed to save your setting. Please try again.');
    expect(utils.getByText('Review every Sun at 19:00')).toBeTruthy();
  });

  it('shows the stored values from the database', async () => {
    jest.mocked(db.getWeeklyReviewDay).mockResolvedValue(5);
    jest.mocked(db.getWeeklyReviewTime).mockResolvedValue('07:45');
    const utils = await mount();

    expect(utils.getByText('Review every Fri at 07:45')).toBeTruthy();
  });
});
