// @testing-library/react-native 13.3.3 refuses to import unless the
// installed react-test-renderer version matches its expected peer exactly.
// This repo currently has react@19.1.0 / react-test-renderer@19.2.5 (a
// pre-existing devDependency mismatch, out of this lane's scope to fix).
// Setting this env var before RNTL's own module body runs skips that check;
// RNTL's actual rendering works fine with this combination. It must be set
// before the (non-hoisted) `require` below, so it cannot be a hoisted
// `import`.
process.env.RNTL_SKIP_DEPS_CHECK = '1';

import React from 'react';
import { AppState } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, fireEvent, act } = require('@testing-library/react-native');

// ─── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@react-navigation/native', () => ({
  // SettingsScreen's hydration effect only needs to run once on mount for
  // these tests, so the focus effect is modeled as a plain mount effect.
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn().mockResolvedValue(true),
  getWorkoutReminderTime: jest.fn().mockResolvedValue('09:15'),
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
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 1800, protein: 150 }),
  setNutritionGoalCalories: jest.fn().mockResolvedValue(undefined),
  setNutritionGoalProtein: jest.fn().mockResolvedValue(undefined),
  getUserProfile: jest.fn().mockResolvedValue({
    heightCm: null,
    age: null,
    sex: null,
    activityLevel: null,
    goalType: null,
  }),
  setProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  setProfileAge: jest.fn().mockResolvedValue(undefined),
  setProfileSex: jest.fn().mockResolvedValue(undefined),
  setProfileActivityLevel: jest.fn().mockResolvedValue(undefined),
  setProfileGoalType: jest.fn().mockResolvedValue(undefined),
  getLatestBodyWeight: jest.fn().mockResolvedValue(null),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  setHydrationGoal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notifications', () => ({
  // Keep the real formatTimeString/parseTimeString — they're pure and the
  // screen (and this test) depend on their real behaviour. Everything else
  // touches expo-notifications or the DB, so it's stubbed.
  ...jest.requireActual('../../services/notifications'),
  ensurePermissions: jest.fn().mockResolvedValue(true),
  reconcileScheduledNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleMealReminder: jest.fn().mockResolvedValue(undefined),
  cancelMealReminder: jest.fn().mockResolvedValue(undefined),
  scheduleBackupReminder: jest.fn().mockResolvedValue(undefined),
  cancelBackupReminder: jest.fn().mockResolvedValue(undefined),
}));

import SettingsScreen from '../SettingsScreen';
import {
  setNutritionGoalCalories,
  setNutritionGoalProtein,
  setWorkoutReminderTime,
  getNutritionGoals,
} from '../../db/database';
import { reconcileScheduledNotifications } from '../../services/notifications';

const mockSetNutritionGoalCalories = jest.mocked(setNutritionGoalCalories);
const mockSetNutritionGoalProtein = jest.mocked(setNutritionGoalProtein);
const mockSetWorkoutReminderTime = jest.mocked(setWorkoutReminderTime);
const mockGetNutritionGoals = jest.mocked(getNutritionGoals);
const mockReconcileScheduledNotifications = jest.mocked(reconcileScheduledNotifications);
const mockAddEventListener = jest.mocked(AppState.addEventListener);

/** The `'change'` listener SettingsScreen most recently registered with AppState. */
function getAppStateListener(): (state: string) => void {
  const call = mockAddEventListener.mock.calls[mockAddEventListener.mock.calls.length - 1];
  return call[1] as (state: string) => void;
}

// Flush pending microtasks (the mocked DB promises) without relying on any
// macrotask/timer, so it works the same whether fake timers are active.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SettingsScreen', () => {
  it('is a valid React component', () => {
    expect(typeof SettingsScreen).toBe('function');
  });
});

describe('SettingsScreen steppers (#313 — debounced writes)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetNutritionGoals.mockResolvedValue({ calories: 1800, protein: 150 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('collapses 5 rapid calorie taps into a single debounced write of the final value', async () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    expect(getByText('1800')).toBeTruthy();

    const increment = getByLabelText('Increase calorie goal');
    for (let i = 0; i < 5; i++) {
      fireEvent.press(increment);
    }

    // Not yet committed — still debouncing.
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(getByText('2050')).toBeTruthy();
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledWith(2050);
  });

  it('collapses 5 rapid protein taps into a single debounced write of the final value', async () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    expect(getByText('150')).toBeTruthy();

    const increment = getByLabelText('Increase protein goal');
    for (let i = 0; i < 5; i++) {
      fireEvent.press(increment);
    }

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    // PROTEIN_STEP is 5, so 5 taps move 150 -> 175.
    expect(getByText('175')).toBeTruthy();
    expect(mockSetNutritionGoalProtein).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalProtein).toHaveBeenCalledWith(175);
  });

  it('collapses 5 rapid workout-hour taps into a single debounced write and a single reconcile call', async () => {
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    // Hydrated from the mocked DB value ('09:15'), not the component default.
    expect(getByText('09')).toBeTruthy();

    const incrementHour = getByLabelText('Increase Hour');
    for (let i = 0; i < 5; i++) {
      fireEvent.press(incrementHour);
    }

    expect(mockSetWorkoutReminderTime).not.toHaveBeenCalled();
    expect(mockReconcileScheduledNotifications).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(getByText('14')).toBeTruthy();
    expect(mockSetWorkoutReminderTime).toHaveBeenCalledTimes(1);
    expect(mockSetWorkoutReminderTime).toHaveBeenCalledWith('14:15');
    expect(mockReconcileScheduledNotifications).toHaveBeenCalledTimes(1);
  });

  it('clamps at the minimum under rapid tapping past the bound', async () => {
    mockGetNutritionGoals.mockResolvedValue({ calories: 520, protein: 150 });
    const { getByText, getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    expect(getByText('520')).toBeTruthy();

    // CALORIES_STEP is 50, CALORIES_MIN is 500: taps go 520 -> 500 -> clamp
    // -> clamp -> clamp -> clamp.
    const decrement = getByLabelText('Decrease calorie goal');
    for (let i = 0; i < 5; i++) {
      fireEvent.press(decrement);
    }

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(getByText('500')).toBeTruthy();
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledWith(500);
  });

  it('flushes a pending debounced write immediately when the screen unmounts', async () => {
    const { getByText, getByLabelText, unmount } = render(<SettingsScreen />);
    await flushMicrotasks();

    expect(getByText('1800')).toBeTruthy();

    fireEvent.press(getByLabelText('Increase calorie goal'));

    // Unmount before the 400ms debounce has any chance to fire.
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
    });

    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledWith(1850);
  });

  it('does not write or reschedule notifications when hydrating state from the DB', async () => {
    // '09:15' differs from the component's '08:00' default, so hydration
    // genuinely changes state here (not a no-op that would pass trivially).
    render(<SettingsScreen />);
    await flushMicrotasks();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSetWorkoutReminderTime).not.toHaveBeenCalled();
    expect(mockReconcileScheduledNotifications).not.toHaveBeenCalled();
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();
    expect(mockSetNutritionGoalProtein).not.toHaveBeenCalled();
  });

  it('flushes a pending debounced write immediately when AppState goes background', async () => {
    const { getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    fireEvent.press(getByLabelText('Increase calorie goal'));
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();

    const listener = getAppStateListener();
    await act(async () => {
      listener('background');
    });

    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledWith(1850);

    // The debounce timer for the same edit must not still be armed —
    // advancing past it must not produce a second write.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending debounced write immediately when AppState goes inactive', async () => {
    const { getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    fireEvent.press(getByLabelText('Increase calorie goal'));
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();

    const listener = getAppStateListener();
    await act(async () => {
      listener('inactive');
    });

    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledWith(1850);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
  });

  it('removes the AppState subscription on unmount, so a later change does nothing', async () => {
    const { getByLabelText, unmount } = render(<SettingsScreen />);
    await flushMicrotasks();

    const subscription = mockAddEventListener.mock.results[mockAddEventListener.mock.results.length - 1]
      .value as { remove: jest.Mock };
    const listener = getAppStateListener();

    fireEvent.press(getByLabelText('Increase calorie goal'));

    await act(async () => {
      unmount();
    });

    // Unmounting flushes the pending write itself (covered elsewhere) and
    // must also tear down the AppState subscription.
    expect(subscription.remove).toHaveBeenCalledTimes(1);
    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);

    mockSetNutritionGoalCalories.mockClear();
    listener('background');
    expect(mockSetNutritionGoalCalories).not.toHaveBeenCalled();
  });

  it('logs and does not throw when a debounced commit rejects', async () => {
    mockSetNutritionGoalCalories.mockRejectedValueOnce(new Error('boom'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    fireEvent.press(getByLabelText('Increase calorie goal'));

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    // Let the rejected promise's .catch handler run.
    await flushMicrotasks();

    expect(mockSetNutritionGoalCalories).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
