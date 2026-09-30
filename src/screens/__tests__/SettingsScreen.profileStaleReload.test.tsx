import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// The shared navigation mock cannot hold a focus load open, so this file
// captures the useFocusEffect callback and invokes it by hand once.
let mockFocusCallback: (() => void | (() => void)) | null = null;

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

type Profile = Awaited<ReturnType<typeof getUserProfile>>;

const mockGetUserProfile = jest.mocked(getUserProfile);
const mockSetProfileHeightCm = jest.mocked(setProfileHeightCm);
const mockSetProfileAge = jest.mocked(setProfileAge);
const mockClearProfileHeightCm = jest.mocked(clearProfileHeightCm);
const mockClearProfileAge = jest.mocked(clearProfileAge);

const baseProfile: Profile = { heightCm: 180, age: 30, sex: null, activityLevel: null, goalType: null };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function blur(input: Parameters<typeof fireEvent>[0]) {
  await act(async () => {
    fireEvent(input, 'blur');
  });
}

async function mountWithHeldReload() {
  const reload = deferred<Profile>();
  mockGetUserProfile.mockReturnValueOnce(reload.promise);
  const utils = render(<SettingsScreen />);
  await act(async () => {
    mockFocusCallback?.();
  });
  return { ...utils, reload };
}

describe('SettingsScreen profile reload racing a blur write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
  });

  it('keeps a height saved while the reload was in flight', async () => {
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '190');
    await blur(input);
    expect(mockSetProfileHeightCm).toHaveBeenCalledWith(190);

    await act(async () => {
      reload.resolve({ ...baseProfile, heightCm: 180 });
    });
    await settle();

    expect(getByLabelText('Height in centimetres').props.value).toBe('190');
  });

  it('keeps a height cleared while the reload was in flight', async () => {
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '');
    await blur(input);
    expect(mockClearProfileHeightCm).toHaveBeenCalled();

    await act(async () => {
      reload.resolve({ ...baseProfile, heightCm: 180 });
    });
    await settle();

    expect(getByLabelText('Height in centimetres').props.value).toBe('');
  });

  it('keeps an age saved while the reload was in flight', async () => {
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Age in years');
    fireEvent.changeText(input, '41');
    await blur(input);
    expect(mockSetProfileAge).toHaveBeenCalledWith(41);

    await act(async () => {
      reload.resolve({ ...baseProfile, age: 30 });
    });
    await settle();

    expect(getByLabelText('Age in years').props.value).toBe('41');
  });

  it('keeps an age cleared while the reload was in flight', async () => {
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Age in years');
    fireEvent.changeText(input, '');
    await blur(input);
    expect(mockClearProfileAge).toHaveBeenCalled();

    await act(async () => {
      reload.resolve({ ...baseProfile, age: 30 });
    });
    await settle();

    expect(getByLabelText('Age in years').props.value).toBe('');
  });

  it('keeps a height whose write is still pending when the reload resolves', async () => {
    const write = deferred<void>();
    mockSetProfileHeightCm.mockReturnValueOnce(write.promise);
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '190');
    await blur(input);

    await act(async () => {
      reload.resolve({ ...baseProfile, heightCm: 180 });
    });
    await settle();
    await act(async () => {
      write.resolve();
    });
    await settle();

    expect(getByLabelText('Height in centimetres').props.value).toBe('190');
  });

  it('still hydrates fields that were not edited', async () => {
    const { getByLabelText, reload } = await mountWithHeldReload();
    const input = getByLabelText('Height in centimetres');
    fireEvent.changeText(input, '190');
    await blur(input);

    await act(async () => {
      reload.resolve({ ...baseProfile, heightCm: 180, age: 33 });
    });
    await settle();

    expect(getByLabelText('Height in centimetres').props.value).toBe('190');
    expect(getByLabelText('Age in years').props.value).toBe('33');
  });
});
