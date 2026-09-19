// @testing-library/react-native 13.3.3 refuses to import unless the
// installed react-test-renderer version matches its expected peer exactly.
// This repo currently has react@19.1.0 / react-test-renderer@19.2.5 (a
// pre-existing devDependency mismatch, out of this lane's scope to fix).
// Setting this env var before RNTL's own module body runs skips that check;
// RNTL's actual rendering works fine with this combination. It must be set
// before the (non-hoisted) `require` below, so it cannot be a hoisted
// `import`. Same pattern as SettingsScreen.test.tsx.
process.env.RNTL_SKIP_DEPS_CHECK = '1';

import React from 'react';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, fireEvent, act } = require('@testing-library/react-native');

/**
 * Regression tests for #323 part 2: blank + blur on the profile height/age
 * fields must persist a clear (via the new clearProfileHeightCm /
 * clearProfileAge db wrappers), not silently do nothing as part 1 left it.
 *
 * This is a separate file rather than an addition to
 * SettingsScreen.test.tsx's "profile height/age validation (#323)" suite so
 * the shared `../../db/database` mock there (which has no
 * clearProfileHeightCm/clearProfileAge keys, matching what SettingsScreen.tsx
 * imported before this fix) doesn't need touching for this change alone.
 *
 * At the pre-fix commit (01e21c2), SettingsScreen.tsx's blank+blur branch
 * returns early after resetting the error/ref — it never calls any db
 * function. Since this file mocks the whole `../../db/database` module
 * (jest.mock intercepts the import regardless of what the real module
 * exports), `clearProfileHeightCm`/`clearProfileAge` exist as jest.fn()s
 * here even before database.ts gains the real exports — so the pre-fix
 * failure is a genuine "expected 1 call, received 0" assertion mismatch,
 * not a "not a function" crash.
 */

jest.mock('@react-navigation/native', () => ({
  // SettingsScreen's hydration effect only needs to run once on mount for
  // these tests, so the focus effect is modeled as a plain mount effect —
  // same simplification as SettingsScreen.test.tsx.
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
    heightCm: 175,
    age: 30,
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
}));

import SettingsScreen from '../SettingsScreen';
import {
  getUserProfile,
  setProfileHeightCm,
  setProfileAge,
  clearProfileHeightCm,
  clearProfileAge,
} from '../../db/database';

const mockGetUserProfile = jest.mocked(getUserProfile);
const mockSetProfileHeightCm = jest.mocked(setProfileHeightCm);
const mockSetProfileAge = jest.mocked(setProfileAge);
const mockClearProfileHeightCm = jest.mocked(clearProfileHeightCm);
const mockClearProfileAge = jest.mocked(clearProfileAge);

// Flush pending microtasks (the mocked DB promises) without relying on any
// macrotask/timer. Same helper as SettingsScreen.test.tsx.
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SettingsScreen profile field clearing (#323 part 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserProfile.mockResolvedValue({
      heightCm: 175,
      age: 30,
      sex: null,
      activityLevel: null,
      goalType: null,
    });
  });

  it('blank height + blur calls clearProfileHeightCm and not setProfileHeightCm', async () => {
    const { getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Height in centimetres');
    expect(input.props.value).toBe('175');

    fireEvent.changeText(input, '');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(mockClearProfileHeightCm).toHaveBeenCalledTimes(1);
    expect(mockSetProfileHeightCm).not.toHaveBeenCalled();
  });

  it('blank age + blur calls clearProfileAge and not setProfileAge', async () => {
    const { getByLabelText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Age in years');
    expect(input.props.value).toBe('30');

    fireEvent.changeText(input, '');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(mockClearProfileAge).toHaveBeenCalledTimes(1);
    expect(mockSetProfileAge).not.toHaveBeenCalled();
  });

  it('invalid height + blur calls neither clearProfileHeightCm nor setProfileHeightCm', async () => {
    const { getByLabelText, getByText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '18o');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(getByText('Enter a height between 50 and 250 cm')).toBeTruthy();
    expect(mockClearProfileHeightCm).not.toHaveBeenCalled();
    expect(mockSetProfileHeightCm).not.toHaveBeenCalled();
  });

  it('invalid age + blur calls neither clearProfileAge nor setProfileAge', async () => {
    const { getByLabelText, getByText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Age in years');
    fireEvent.changeText(input, '5');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(getByText('Enter an age between 10 and 120 years')).toBeTruthy();
    expect(mockClearProfileAge).not.toHaveBeenCalled();
    expect(mockSetProfileAge).not.toHaveBeenCalled();
  });

  it('blank height + blur when nothing was ever saved stays harmless (no error, clear is still called)', async () => {
    mockGetUserProfile.mockResolvedValue({
      heightCm: null,
      age: null,
      sex: null,
      activityLevel: null,
      goalType: null,
    });
    const { getByLabelText, queryByText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Height in centimetres');
    expect(input.props.value).toBe('');

    fireEvent.changeText(input, '');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(queryByText('Enter a height between 50 and 250 cm')).toBeNull();
    expect(mockSetProfileHeightCm).not.toHaveBeenCalled();
    // deleteSetting on an absent key is itself a no-op (covered at the db
    // level in clearProfileFields.test.ts) — the screen has no way to know
    // in advance that nothing was saved, so it still calls the wrapper.
    expect(mockClearProfileHeightCm).toHaveBeenCalledTimes(1);
  });

  it('blank age + blur when nothing was ever saved stays harmless (no error, clear is still called)', async () => {
    mockGetUserProfile.mockResolvedValue({
      heightCm: null,
      age: null,
      sex: null,
      activityLevel: null,
      goalType: null,
    });
    const { getByLabelText, queryByText } = render(<SettingsScreen />);
    await flushMicrotasks();

    const input = getByLabelText('Age in years');
    expect(input.props.value).toBe('');

    fireEvent.changeText(input, '');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(queryByText('Enter an age between 10 and 120 years')).toBeNull();
    expect(mockSetProfileAge).not.toHaveBeenCalled();
    expect(mockClearProfileAge).toHaveBeenCalledTimes(1);
  });
});
