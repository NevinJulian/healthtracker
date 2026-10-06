import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn().mockResolvedValue(false),
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
import * as db from '../../db/database';

type Profile = Awaited<ReturnType<typeof db.getUserProfile>>;
type Utils = ReturnType<typeof render>;

const emptyProfile: Profile = { heightCm: null, age: null, sex: null, activityLevel: null, goalType: null };

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

async function mountWithHeldReload() {
  const reload = deferred<Profile>();
  jest.mocked(db.getUserProfile).mockReturnValueOnce(reload.promise);
  const utils = render(<SettingsScreen />);
  await act(async () => {
    mockFocusCallback?.();
  });
  const resolveReload = async () => {
    await act(async () => {
      reload.resolve(emptyProfile);
    });
    await settle();
  };
  return { ...utils, resolveReload };
}

async function toggle(utils: Utils, label: string, value: boolean) {
  await act(async () => {
    fireEvent(utils.getByLabelText(label), 'valueChange', value);
  });
  await settle();
}

async function press(utils: Utils, label: string) {
  await act(async () => {
    fireEvent.press(utils.getByLabelText(label));
  });
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
});

describe('SettingsScreen toggles and day chips racing a reload', () => {
  it('keeps the workout reminder toggle switched while the reload was in flight', async () => {
    const utils = await mountWithHeldReload();
    await toggle(utils, 'Enable daily workout reminder', true);
    expect(db.setWorkoutReminderEnabled).toHaveBeenCalledWith(true);

    await utils.resolveReload();

    expect(utils.getByLabelText('Enable daily workout reminder').props.value).toBe(true);
  });

  it('hydrates a toggle from a later reload after its write was rejected', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const utils = render(<SettingsScreen />);
    await act(async () => {
      mockFocusCallback?.();
    });
    await settle();

    jest.mocked(db.setWorkoutReminderEnabled).mockRejectedValueOnce(new Error('disk full'));
    await toggle(utils, 'Enable daily workout reminder', true);
    expect(utils.getByLabelText('Enable daily workout reminder').props.value).toBe(false);

    jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValueOnce(true);
    await act(async () => {
      mockFocusCallback?.();
    });
    await settle();

    expect(utils.getByLabelText('Enable daily workout reminder').props.value).toBe(true);
  });

  it('keeps the cooking toggles and cook day changed while the reload was in flight', async () => {
    const utils = await mountWithHeldReload();
    await toggle(utils, 'Enable cook-when-empty reminder', true);
    await toggle(utils, 'Enable weekly cook-day reminder', true);
    await press(utils, 'Select Wed');

    await utils.resolveReload();

    expect(utils.getByLabelText('Enable cook-when-empty reminder').props.value).toBe(true);
    expect(utils.getByLabelText('Enable weekly cook-day reminder').props.value).toBe(true);
    expect(utils.getByText(/Reminder every Wed at/)).toBeTruthy();
  });

  it('keeps a meal reminder toggle switched while the reload was in flight', async () => {
    const utils = await mountWithHeldReload();
    await toggle(utils, 'Enable Lunch reminder', true);
    expect(db.setMealReminderEnabled).toHaveBeenCalledWith('lunch', true);

    await utils.resolveReload();

    expect(utils.getByLabelText('Enable Lunch reminder').props.value).toBe(true);
    expect(utils.getByLabelText('Enable Breakfast reminder').props.value).toBe(false);
  });

  it('keeps the backup reminder toggle and day changed while the reload was in flight', async () => {
    const utils = await mountWithHeldReload();
    await toggle(utils, 'Enable weekly backup reminder', true);
    await press(utils, 'Select Fri');

    await utils.resolveReload();

    expect(utils.getByLabelText('Enable weekly backup reminder').props.value).toBe(true);
    expect(utils.getByText(/Reminder every Fri at/)).toBeTruthy();
  });
});
