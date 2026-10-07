import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
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

type Utils = ReturnType<typeof render>;

interface WriteErrorCase {
  name: string;
  write: jest.Mock;
  hydrate?: () => void;
  prepare?: (utils: Utils) => void;
  trigger: (utils: Utils) => void;
  assertUnsaved: (utils: Utils) => void | Promise<void>;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

function toggle(utils: Utils, label: string, value: boolean) {
  fireEvent(utils.getByLabelText(label), 'valueChange', value);
}

function runWriteErrorCases(cases: WriteErrorCase[]) {
  describe.each(cases)('$name', (testCase) => {
    let alertSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    beforeEach(() => {
      jest.clearAllMocks();
      unhandled.length = 0;
      process.on('unhandledRejection', onUnhandled);
      alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      process.off('unhandledRejection', onUnhandled);
      alertSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('alerts and logs on a rejected write without saving the new value locally', async () => {
      testCase.hydrate?.();
      const utils = render(<SettingsScreen />);
      await flush();

      if (testCase.prepare) {
        await act(async () => {
          testCase.prepare?.(utils);
        });
      }

      let rejectWrite: (reason: Error) => void = () => undefined;
      testCase.write.mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          rejectWrite = reject;
        })
      );
      await act(async () => {
        testCase.trigger(utils);
      });
      expect(alertSpy).not.toHaveBeenCalled();

      await act(async () => {
        rejectWrite(new Error('disk full'));
      });
      await flush();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toBe('Error');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      await testCase.assertUnsaved(utils);
      expect(unhandled).toEqual([]);
    });
  });
}

describe('SettingsScreen reminder write failures', () => {
  runWriteErrorCases([
    {
      name: 'workout reminder toggle',
      write: jest.mocked(db.setWorkoutReminderEnabled),
      trigger: (u) => toggle(u, 'Enable daily workout reminder', true),
      assertUnsaved: (u) =>
        expect(u.getByLabelText('Enable daily workout reminder').props.value).toBe(false),
    },
    {
      name: 'cook-when-empty toggle',
      write: jest.mocked(db.setCookWhenEmptyEnabled),
      trigger: (u) => toggle(u, 'Enable cook-when-empty reminder', true),
      assertUnsaved: (u) =>
        expect(u.getByLabelText('Enable cook-when-empty reminder').props.value).toBe(false),
    },
    {
      name: 'weekly cook-day toggle',
      write: jest.mocked(db.setWeeklyCookDayEnabled),
      trigger: (u) => toggle(u, 'Enable weekly cook-day reminder', true),
      assertUnsaved: (u) =>
        expect(u.getByLabelText('Enable weekly cook-day reminder').props.value).toBe(false),
    },
    {
      name: 'weekday select',
      write: jest.mocked(db.setWeeklyCookDay),
      hydrate: () => jest.mocked(db.getWeeklyCookDayEnabled).mockResolvedValueOnce(true),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Select Tue'));
      },
      assertUnsaved: (u) => expect(u.getByText(/Reminder every Sun at/)).toBeTruthy(),
    },
    {
      name: 'meal reminder toggle',
      write: jest.mocked(db.setMealReminderEnabled),
      trigger: (u) => toggle(u, 'Enable Lunch reminder', true),
      assertUnsaved: (u) => expect(u.getByLabelText('Enable Lunch reminder').props.value).toBe(false),
    },
  ]);
});

type Profile = Awaited<ReturnType<typeof db.getUserProfile>>;

const completeProfile: Profile = {
  heightCm: 180,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  goalType: 'maintain',
};

function hydrateProfile(profile: Profile) {
  return () => jest.mocked(db.getUserProfile).mockResolvedValueOnce(profile);
}

function chipBackground(utils: Utils, label: string) {
  return StyleSheet.flatten(utils.getByLabelText(label).props.style)?.backgroundColor;
}

function expectProfileStillIncomplete(utils: Utils) {
  const alertMock = jest.mocked(Alert.alert);
  fireEvent.press(utils.getByLabelText('Recalculate nutrition goals from profile'));
  expect(alertMock).toHaveBeenCalledTimes(2);
  expect(alertMock.mock.calls[1][0]).toBe('Profile incomplete');
}

async function expectProfileStillComplete(utils: Utils) {
  const alertMock = jest.mocked(Alert.alert);
  await act(async () => {
    fireEvent.press(utils.getByLabelText('Recalculate nutrition goals from profile'));
    await flush();
  });
  expect(alertMock).toHaveBeenCalledTimes(2);
  expect(alertMock.mock.calls[1][0]).toBe('Goals updated');
}

function blurField(utils: Utils, label: string) {
  fireEvent(utils.getByLabelText(label), 'blur');
}

describe('SettingsScreen profile write failures', () => {
  runWriteErrorCases([
    {
      name: 'height save',
      write: jest.mocked(db.setProfileHeightCm),
      hydrate: hydrateProfile({ ...completeProfile, heightCm: null }),
      prepare: (u) => fireEvent.changeText(u.getByLabelText('Height in centimetres'), '180'),
      trigger: (u) => {
        blurField(u, 'Height in centimetres');
      },
      assertUnsaved: expectProfileStillIncomplete,
    },
    {
      name: 'height clear',
      write: jest.mocked(db.clearProfileHeightCm),
      hydrate: hydrateProfile(completeProfile),
      prepare: (u) => fireEvent.changeText(u.getByLabelText('Height in centimetres'), ''),
      trigger: (u) => {
        blurField(u, 'Height in centimetres');
      },
      assertUnsaved: expectProfileStillComplete,
    },
    {
      name: 'age save',
      write: jest.mocked(db.setProfileAge),
      hydrate: hydrateProfile({ ...completeProfile, age: null }),
      prepare: (u) => fireEvent.changeText(u.getByLabelText('Age in years'), '30'),
      trigger: (u) => {
        blurField(u, 'Age in years');
      },
      assertUnsaved: expectProfileStillIncomplete,
    },
    {
      name: 'age clear',
      write: jest.mocked(db.clearProfileAge),
      hydrate: hydrateProfile(completeProfile),
      prepare: (u) => fireEvent.changeText(u.getByLabelText('Age in years'), ''),
      trigger: (u) => {
        blurField(u, 'Age in years');
      },
      assertUnsaved: expectProfileStillComplete,
    },
    {
      name: 'sex chip',
      write: jest.mocked(db.setProfileSex),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Female'));
      },
      assertUnsaved: (u) => expect(chipBackground(u, 'Female')).toBe(chipBackground(u, 'Male')),
    },
    {
      name: 'activity chip',
      write: jest.mocked(db.setProfileActivityLevel),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Active'));
      },
      assertUnsaved: (u) => expect(chipBackground(u, 'Active')).toBe(chipBackground(u, 'Light')),
    },
    {
      name: 'goal chip',
      write: jest.mocked(db.setProfileGoalType),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Build muscle'));
      },
      assertUnsaved: (u) => expect(chipBackground(u, 'Build muscle')).toBe(chipBackground(u, 'Maintain')),
    },
    {
      name: 'recalculate goals',
      write: jest.mocked(db.setNutritionGoalCalories),
      hydrate: hydrateProfile(completeProfile),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Recalculate nutrition goals from profile'));
      },
      assertUnsaved: (u) => {
        expect(u.getByText('1800')).toBeTruthy();
        expect(u.getByLabelText('Recalculate nutrition goals from profile').props.accessibilityState?.disabled).toBeFalsy();
      },
    },
  ]);
});

describe('SettingsScreen backup reminder write failures', () => {
  runWriteErrorCases([
    {
      name: 'backup reminder toggle',
      write: jest.mocked(db.setBackupReminderEnabled),
      trigger: (u) => toggle(u, 'Enable weekly backup reminder', true),
      assertUnsaved: (u) =>
        expect(u.getByLabelText('Enable weekly backup reminder').props.value).toBe(false),
    },
    {
      name: 'backup reminder day select',
      write: jest.mocked(db.setBackupReminderDay),
      hydrate: () => jest.mocked(db.getBackupReminderEnabled).mockResolvedValueOnce(true),
      trigger: (u) => {
        fireEvent.press(u.getByLabelText('Select Tue'));
      },
      assertUnsaved: (u) => expect(u.getByText(/Reminder every Sun at/)).toBeTruthy(),
    },
  ]);
});
