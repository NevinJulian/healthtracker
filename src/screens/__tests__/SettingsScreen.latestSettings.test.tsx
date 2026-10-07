import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn(),
  getWorkoutReminderTime: jest.fn(),
  setWorkoutReminderEnabled: jest.fn(),
  setWorkoutReminderTime: jest.fn(),
  getCookWhenEmptyEnabled: jest.fn(),
  setCookWhenEmptyEnabled: jest.fn(),
  getWeeklyCookDayEnabled: jest.fn(),
  setWeeklyCookDayEnabled: jest.fn(),
  getWeeklyCookDay: jest.fn(),
  setWeeklyCookDay: jest.fn(),
  getWeeklyCookDayTime: jest.fn(),
  setWeeklyCookDayTime: jest.fn(),
  getMealReminderEnabled: jest.fn(),
  getMealReminderTime: jest.fn(),
  setMealReminderEnabled: jest.fn(),
  setMealReminderTime: jest.fn(),
  getBackupReminderEnabled: jest.fn(),
  setBackupReminderEnabled: jest.fn(),
  getBackupReminderDay: jest.fn(),
  setBackupReminderDay: jest.fn(),
  getBackupReminderTime: jest.fn(),
  setBackupReminderTime: jest.fn(),
  getNutritionGoals: jest.fn(),
  setNutritionGoalCalories: jest.fn(),
  setNutritionGoalProtein: jest.fn(),
  getUserProfile: jest.fn(),
  setProfileHeightCm: jest.fn(),
  setProfileAge: jest.fn(),
  clearProfileHeightCm: jest.fn(),
  clearProfileAge: jest.fn(),
  setProfileSex: jest.fn(),
  setProfileActivityLevel: jest.fn(),
  setProfileGoalType: jest.fn(),
  getLatestBodyWeight: jest.fn(),
  getHydrationGoal: jest.fn(),
  setHydrationGoal: jest.fn(),
}));

jest.mock('../../services/notifications', () => ({
  ...jest.requireActual('../../services/notifications'),
  ensurePermissions: jest.fn(),
  reconcileScheduledNotifications: jest.fn(),
  scheduleMealReminder: jest.fn(),
  cancelMealReminder: jest.fn(),
  scheduleBackupReminder: jest.fn(),
  cancelBackupReminder: jest.fn(),
}));

jest.mock('../../nutrition/tdee', () => {
  const actual = jest.requireActual('../../nutrition/tdee');
  return { ...actual, suggestGoals: jest.fn(actual.suggestGoals) };
});

import SettingsScreen from '../SettingsScreen';
import * as db from '../../db/database';
import * as notifications from '../../services/notifications';
import { suggestGoals } from '../../nutrition/tdee';

type Profile = Awaited<ReturnType<typeof db.getUserProfile>>;
type Utils = ReturnType<typeof render>;

const emptyProfile: Profile = { heightCm: null, age: null, sex: null, activityLevel: null, goalType: null };
const fullProfile: Profile = { heightCm: 180, age: 30, sex: 'male', activityLevel: 'light', goalType: 'maintain' };

const mockReconcile = jest.mocked(notifications.reconcileScheduledNotifications);
const mockScheduleMeal = jest.mocked(notifications.scheduleMealReminder);
const mockScheduleBackup = jest.mocked(notifications.scheduleBackupReminder);

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

async function waitForDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

async function mount() {
  const utils = render(<SettingsScreen />);
  await act(async () => {
    mockFocusCallback?.();
  });
  await settle();
  return utils;
}

async function press(utils: Utils, label: string, index = 0) {
  await act(async () => {
    fireEvent.press(utils.getAllByLabelText(label)[index]);
  });
  await settle();
}

async function toggle(utils: Utils, label: string, value: boolean) {
  await act(async () => {
    fireEvent(utils.getByLabelText(label), 'valueChange', value);
  });
  await settle();
}

async function release(held: { resolve: (v: undefined) => void }) {
  await act(async () => {
    held.resolve(undefined);
  });
  await settle();
}

function hold(fn: jest.Mock) {
  const held = deferred<undefined>();
  fn.mockReturnValueOnce(held.promise);
  return held;
}

type PressNode = { props: { onPress?: () => Promise<void> }; parent: PressNode | null };

function pressHandler(utils: Utils, label: string): () => Promise<void> {
  let node: PressNode | null = utils.getByLabelText(label) as unknown as PressNode;
  while (node && !node.props.onPress) {
    node = node.parent;
  }
  if (!node?.props.onPress) throw new Error(`no press handler for ${label}`);
  return node.props.onPress;
}

function resetMock(fn: unknown, value: unknown) {
  jest.mocked(fn as jest.Mock).mockReset().mockResolvedValue(value);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  resetMock(db.getWorkoutReminderEnabled, false);
  resetMock(db.getWorkoutReminderTime, '09:15');
  resetMock(db.setWorkoutReminderEnabled, undefined);
  resetMock(db.setWorkoutReminderTime, undefined);
  resetMock(db.getCookWhenEmptyEnabled, false);
  resetMock(db.setCookWhenEmptyEnabled, undefined);
  resetMock(db.getWeeklyCookDayEnabled, false);
  resetMock(db.setWeeklyCookDayEnabled, undefined);
  resetMock(db.getWeeklyCookDay, 0);
  resetMock(db.setWeeklyCookDay, undefined);
  resetMock(db.getWeeklyCookDayTime, '10:00');
  resetMock(db.setWeeklyCookDayTime, undefined);
  resetMock(db.getMealReminderEnabled, false);
  resetMock(db.getMealReminderTime, '08:00');
  resetMock(db.setMealReminderEnabled, undefined);
  resetMock(db.setMealReminderTime, undefined);
  resetMock(db.getBackupReminderEnabled, false);
  resetMock(db.setBackupReminderEnabled, undefined);
  resetMock(db.getBackupReminderDay, 0);
  resetMock(db.setBackupReminderDay, undefined);
  resetMock(db.getBackupReminderTime, '18:00');
  resetMock(db.setBackupReminderTime, undefined);
  resetMock(db.getNutritionGoals, { calories: 1800, protein: 150 });
  resetMock(db.setNutritionGoalCalories, undefined);
  resetMock(db.setNutritionGoalProtein, undefined);
  resetMock(db.getUserProfile, emptyProfile);
  resetMock(db.setProfileHeightCm, undefined);
  resetMock(db.setProfileAge, undefined);
  resetMock(db.clearProfileHeightCm, undefined);
  resetMock(db.clearProfileAge, undefined);
  resetMock(db.setProfileSex, undefined);
  resetMock(db.setProfileActivityLevel, undefined);
  resetMock(db.setProfileGoalType, undefined);
  resetMock(db.getLatestBodyWeight, null);
  resetMock(db.getHydrationGoal, 2000);
  resetMock(db.setHydrationGoal, undefined);
  resetMock(notifications.ensurePermissions, true);
  resetMock(mockReconcile, undefined);
  resetMock(mockScheduleMeal, undefined);
  resetMock(notifications.cancelMealReminder, undefined);
  resetMock(mockScheduleBackup, undefined);
  resetMock(notifications.cancelBackupReminder, undefined);
});

describe('SettingsScreen day chips reading a toggle made while their write was in flight', () => {
  it('does not reconcile for a cook day chip once the cook-day reminder was switched off', async () => {
    jest.mocked(db.getWeeklyCookDayEnabled).mockResolvedValue(true);
    const utils = await mount();
    const dayWrite = hold(jest.mocked(db.setWeeklyCookDay));

    await press(utils, 'Select Tue');
    await toggle(utils, 'Enable weekly cook-day reminder', false);
    await release(dayWrite);

    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile for a backup day chip once the backup reminder was switched off', async () => {
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true);
    const utils = await mount();
    const dayWrite = hold(jest.mocked(db.setBackupReminderDay));

    await press(utils, 'Select Tue');
    await toggle(utils, 'Enable weekly backup reminder', false);
    await release(dayWrite);

    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsScreen meal toggle reading a time stepped while its write was in flight', () => {
  it('schedules the meal reminder at the stepped time', async () => {
    jest.mocked(db.getMealReminderEnabled).mockImplementation(async (meal) => meal === 'breakfast');
    const utils = await mount();
    const enabledWrite = hold(jest.mocked(db.setMealReminderEnabled));

    await toggle(utils, 'Enable Breakfast reminder', true);
    await press(utils, 'Increase Hour');
    await release(enabledWrite);

    expect(mockScheduleMeal.mock.calls).toEqual([['breakfast', 9, 0]]);
  });
});

describe('SettingsScreen debounced time commits reading a toggle made while their write was in flight', () => {
  const rows: {
    name: string;
    hydrate: () => void;
    timeWrite: () => jest.Mock;
    toggleLabel: string;
    assertNothingScheduled: () => void;
  }[] = [
    {
      name: 'workout time',
      hydrate: () => jest.mocked(db.getWorkoutReminderEnabled).mockResolvedValue(true),
      timeWrite: () => jest.mocked(db.setWorkoutReminderTime),
      toggleLabel: 'Enable daily workout reminder',
      assertNothingScheduled: () => expect(mockReconcile).toHaveBeenCalledTimes(1),
    },
    {
      name: 'cook-day time',
      hydrate: () => jest.mocked(db.getWeeklyCookDayEnabled).mockResolvedValue(true),
      timeWrite: () => jest.mocked(db.setWeeklyCookDayTime),
      toggleLabel: 'Enable weekly cook-day reminder',
      assertNothingScheduled: () => expect(mockReconcile).toHaveBeenCalledTimes(1),
    },
    ...(['breakfast', 'lunch', 'dinner'] as const).map((meal) => ({
      name: `${meal} time`,
      hydrate: () => {
        jest.mocked(db.getMealReminderEnabled).mockImplementation(async (m) => m === meal);
      },
      timeWrite: () => jest.mocked(db.setMealReminderTime),
      toggleLabel: `Enable ${meal[0].toUpperCase()}${meal.slice(1)} reminder`,
      assertNothingScheduled: () => expect(mockScheduleMeal).not.toHaveBeenCalled(),
    })),
    {
      name: 'backup time',
      hydrate: () => jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true),
      timeWrite: () => jest.mocked(db.setBackupReminderTime),
      toggleLabel: 'Enable weekly backup reminder',
      assertNothingScheduled: () => expect(mockScheduleBackup).not.toHaveBeenCalled(),
    },
  ];

  it.each(rows)('does not schedule after $name once the reminder was switched off', async (row) => {
    row.hydrate();
    const utils = await mount();
    const timeWrite = hold(row.timeWrite());

    await press(utils, 'Increase Hour');
    await waitForDebounce();
    expect(row.timeWrite()).toHaveBeenCalledTimes(1);
    await toggle(utils, row.toggleLabel, false);
    await release(timeWrite);

    row.assertNothingScheduled();
  });

  it('schedules the backup reminder on the day chosen while the time write was in flight', async () => {
    jest.mocked(db.getBackupReminderEnabled).mockResolvedValue(true);
    const utils = await mount();
    const timeWrite = hold(jest.mocked(db.setBackupReminderTime));

    await press(utils, 'Increase Hour');
    await waitForDebounce();
    await press(utils, 'Select Tue');
    await release(timeWrite);

    expect(mockScheduleBackup.mock.calls).toEqual([[2, '19:00']]);
  });
});

describe('SettingsScreen recalculate reading profile values changed after its press was dispatched', () => {
  const recalcLabel = 'Recalculate nutrition goals from profile';

  it('uses the sex saved after the press handler was created', async () => {
    jest.mocked(db.getUserProfile).mockResolvedValue(fullProfile);
    const utils = await mount();
    const sexWrite = hold(jest.mocked(db.setProfileSex));

    await press(utils, 'Female');
    const staleRecalc = pressHandler(utils, recalcLabel);
    await release(sexWrite);
    await act(async () => {
      await staleRecalc();
    });

    expect(suggestGoals).toHaveBeenCalledTimes(1);
    expect(suggestGoals).toHaveBeenCalledWith(expect.objectContaining({ sex: 'female' }), 80);
  });

  it('uses the weight loaded after the press handler was created', async () => {
    jest.mocked(db.getUserProfile).mockResolvedValue(fullProfile);
    const utils = await mount();
    const staleRecalc = pressHandler(utils, recalcLabel);

    jest.mocked(db.getLatestBodyWeight).mockResolvedValue(70);
    await act(async () => {
      mockFocusCallback?.();
    });
    await settle();
    await act(async () => {
      await staleRecalc();
    });

    expect(suggestGoals).toHaveBeenCalledWith(expect.objectContaining({ sex: 'male' }), 70);
  });
});
