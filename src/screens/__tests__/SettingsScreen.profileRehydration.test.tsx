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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, fireEvent, act } = require('@testing-library/react-native');

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// This file exists ONLY to drive multiple focus cycles through
// SettingsScreen's hydration effect (#323's rehydration-vs-unsaved-invalid-
// edit interaction). The shared `@react-navigation/native` mock in
// SettingsScreen.test.tsx deliberately runs the effect once, as a plain
// mount-only useEffect — the tests there don't need focus-cycle behaviour,
// and changing that shared mock would risk that file's other assertions.
// So this is a separate mock, in a separate file, that captures the latest
// `useFocusEffect` callback (and, once invoked, its cleanup) in module
// variables the tests can re-invoke directly to simulate a re-focus.
//
// These captured-callback variables are referenced inside the jest.mock
// factory below, which babel-plugin-jest-hoist hoists above this file's
// imports — the "must be mock-prefixed" rule is what allows that reference
// to be considered in-scope.
let mockFocusCallback: (() => void | (() => void)) | null = null;
let mockFocusCleanup: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
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
  ...jest.requireActual('../../services/notifications'),
  ensurePermissions: jest.fn().mockResolvedValue(true),
  reconcileScheduledNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleMealReminder: jest.fn().mockResolvedValue(undefined),
  cancelMealReminder: jest.fn().mockResolvedValue(undefined),
  scheduleBackupReminder: jest.fn().mockResolvedValue(undefined),
  cancelBackupReminder: jest.fn().mockResolvedValue(undefined),
}));

import SettingsScreen from '../SettingsScreen';
import { getUserProfile, setProfileHeightCm } from '../../db/database';

const mockGetUserProfile = jest.mocked(getUserProfile);
const mockSetProfileHeightCm = jest.mocked(setProfileHeightCm);

/** Flush pending microtasks (the mocked DB promises) without relying on any
 *  macrotask/timer. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Simulates react-navigation re-focusing this screen: runs the outgoing
 * focus's cleanup (a no-op the first time — there isn't one yet) and then
 * re-invokes the latest captured `useFocusEffect` callback, capturing
 * whatever cleanup it returns for next time. SettingsScreen wraps that
 * callback in `useCallback(fn, [])`, so this re-invokes the exact same
 * stable closure react-navigation would call on every real focus — which
 * is also why a ref, not state, is required for the invalid-edit guard the
 * effect reads: the closure is fixed at mount and never sees later state.
 */
async function triggerFocus() {
  await act(async () => {
    mockFocusCleanup?.();
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
  });
  await flushMicrotasks();
}

const baseProfile = {
  heightCm: null,
  age: null,
  sex: null,
  activityLevel: null,
  goalType: null,
};

describe('SettingsScreen profile field rehydration across focus cycles (#323)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockFocusCleanup = null;
    mockGetUserProfile.mockResolvedValue({ ...baseProfile });
  });

  it('keeps an unsaved invalid height and its error across a re-focus', async () => {
    const { getByLabelText, getByText } = render(<SettingsScreen />);
    await triggerFocus();

    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '18o');
    await act(async () => {
      fireEvent(input, 'blur');
    });
    expect(getByText('Enter a height between 50 and 250 cm')).toBeTruthy();
    expect(mockSetProfileHeightCm).not.toHaveBeenCalled();

    // Simulate the user navigating away and back — the hydration effect
    // reruns from the mocked DB, which still has no height saved.
    await triggerFocus();

    expect(getByLabelText('Height in centimetres').props.value).toBe('18o');
    expect(getByText('Enter a height between 50 and 250 cm')).toBeTruthy();
  });

  it('releases the invalid-edit guard on a blank blur, so the next focus rehydrates normally (stuck-ref guard)', async () => {
    const { getByLabelText, queryByText } = render(<SettingsScreen />);
    await triggerFocus();

    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '18o');
    await act(async () => {
      fireEvent(input, 'blur');
    });
    expect(queryByText('Enter a height between 50 and 250 cm')).toBeTruthy();

    // Clearing the field and blurring it blank must release the guard —
    // otherwise this field would never rehydrate again on any future
    // focus, silently staying blank forever with nothing reporting it.
    fireEvent.changeText(input, '');
    await act(async () => {
      fireEvent(input, 'blur');
    });
    expect(queryByText('Enter a height between 50 and 250 cm')).toBeNull();

    mockGetUserProfile.mockResolvedValue({ ...baseProfile, heightCm: 175 });
    await triggerFocus();

    expect(getByLabelText('Height in centimetres').props.value).toBe('175');
  });

  it('rehydrates to a changed DB value on the next focus after a valid save', async () => {
    const { getByLabelText } = render(<SettingsScreen />);
    await triggerFocus();

    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '180');
    await act(async () => {
      fireEvent(input, 'blur');
    });
    expect(mockSetProfileHeightCm).toHaveBeenCalledWith(180);

    mockGetUserProfile.mockResolvedValue({ ...baseProfile, heightCm: 190 });
    await triggerFocus();

    expect(getByLabelText('Height in centimetres').props.value).toBe('190');
  });
});
