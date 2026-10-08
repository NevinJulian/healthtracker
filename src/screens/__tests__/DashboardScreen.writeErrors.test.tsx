import React from 'react';
import { Alert, TextInput } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

const mockToday = '2026-09-19';

const mockEntry = {
  date: mockToday,
  walking_task: 'Walk 30 min',
  hammer_task: 'Upper body',
  walk_completed: false,
  hammer_completed: false,
  fasting_completed: false,
  is_rest_day: false,
  is_meal_prep_day: false,
  exercises: [
    { id: 'ex1', name: 'Squat', sets: '3', reps: '10', videoUrl: '', completed: false },
  ],
  body_weight: null,
  additional_workouts: [],
};

jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  upsertAdditionalWorkouts: jest.fn(() => Promise.resolve(undefined)),
  addAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  toggleAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  syncRollingSchedule: jest.fn(() => Promise.resolve(undefined)),
  toISODate: jest.fn(() => '2026-09-19'),
  getTodaysMealsWithRecipe: jest.fn(() => Promise.resolve([])),
  toggleMealConsumed: jest.fn(() => Promise.resolve(undefined)),
  getWaterForDay: jest.fn(() => Promise.resolve(0)),
  addWater: jest.fn(() => Promise.resolve(undefined)),
  getHydrationGoal: jest.fn(() => Promise.resolve(2000)),
  logBodyMeasurement: jest.fn(() => Promise.resolve(undefined)),
  getLatestMeasurements: jest.fn(() => Promise.resolve(null)),
  logWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
  getWorkoutSetsForDay: jest.fn(() => Promise.resolve([])),
  deleteWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
}));

import DashboardScreen from '../DashboardScreen';
import {
  getLogByDate,
  getLatestMeasurements,
  logBodyMeasurement,
  logWorkoutSet,
} from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockGetLatestMeasurements = jest.mocked(getLatestMeasurements);
const mockLogBodyMeasurement = jest.mocked(logBodyMeasurement);
const mockLogWorkoutSet = jest.mocked(logWorkoutSet);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const MEASUREMENTS_ALERT: [string, string] = [
  'Error',
  'Failed to save your measurements. Please try again.',
];

describe('DashboardScreen write failures', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockLogBodyMeasurement.mockResolvedValue(undefined);
    mockGetLatestMeasurements.mockResolvedValue(null);
    mockLogWorkoutSet.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('measurements modal', () => {
    async function openModal() {
      const utils = render(<DashboardScreen />);
      await flushMicrotasks();
      fireEvent.press(utils.getByLabelText('Log measurements'));
      return utils;
    }

    async function pressSave(utils: ReturnType<typeof render>) {
      await act(async () => {
        fireEvent.press(utils.getByLabelText('Save'));
      });
    }

    it('alerts, logs and keeps the modal open with the typed text when the write rejects', async () => {
      mockLogBodyMeasurement.mockRejectedValue(new Error('disk full'));
      const utils = await openModal();
      fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');

      await pressSave(utils);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(...MEASUREMENTS_ALERT);
      expect(errorSpy).toHaveBeenCalled();
      expect(utils.getByLabelText('Save')).toBeTruthy();
      expect(utils.getByTestId('measurement-waist-input').props.value).toBe('81');
    });

    it('keeps all five typed values when the write rejects', async () => {
      mockLogBodyMeasurement.mockRejectedValue(new Error('disk full'));
      const utils = await openModal();
      const typed = {
        'measurement-waist-input': '81',
        'measurement-chest-input': '95',
        'measurement-hips-input': '99',
        'measurement-thigh-input': '58',
        'measurement-arm-input': '32',
      };
      for (const [id, text] of Object.entries(typed)) {
        fireEvent.changeText(utils.getByTestId(id), text);
      }

      await pressSave(utils);

      for (const [id, text] of Object.entries(typed)) {
        expect(utils.getByTestId(id).props.value).toBe(text);
      }
    });

    it('closes without an alert when the write succeeds but the refresh rejects', async () => {
      mockGetLatestMeasurements.mockResolvedValueOnce(null);
      const utils = await openModal();
      fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');
      mockGetLatestMeasurements.mockRejectedValueOnce(new Error('read failed'));

      await pressSave(utils);

      expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(utils.queryByLabelText('Save')).toBeNull();
    });

    it('ignores a second Save press while the first save is pending', async () => {
      let resolveWrite: () => void = () => {};
      mockLogBodyMeasurement.mockImplementation(
        () => new Promise<void>((resolve) => { resolveWrite = resolve; })
      );
      const utils = await openModal();
      fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');

      await pressSave(utils);
      await pressSave(utils);
      expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);

      await act(async () => { resolveWrite(); });
      expect(utils.queryByLabelText('Save')).toBeNull();
    });

    it('retries with the same values after a failure and closes when the retry succeeds', async () => {
      mockLogBodyMeasurement.mockRejectedValueOnce(new Error('disk full'));
      const utils = await openModal();
      fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');

      await pressSave(utils);
      expect(utils.getByLabelText('Save')).toBeTruthy();

      await pressSave(utils);

      expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(2);
      expect(mockLogBodyMeasurement.mock.calls[1]).toEqual(mockLogBodyMeasurement.mock.calls[0]);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(utils.queryByLabelText('Save')).toBeNull();
    });

    it('accepts a second Save in the same open modal after a write whose refresh rejected', async () => {
      const utils = await openModal();
      fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');
      fireEvent.changeText(utils.getByTestId('measurement-chest-input'), '5');
      mockGetLatestMeasurements.mockRejectedValueOnce(new Error('read failed'));

      await pressSave(utils);

      expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(utils.getByLabelText('Save')).toBeTruthy();

      fireEvent.changeText(utils.getByTestId('measurement-chest-input'), '95');
      await pressSave(utils);

      expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(2);
      expect(utils.queryByLabelText('Save')).toBeNull();
    });
  });

  describe('set logger', () => {
    async function openLogger() {
      const utils = render(<DashboardScreen />);
      await flushMicrotasks();
      fireEvent.press(utils.getByLabelText('Log sets for Squat'));
      const [reps, weight] = utils.UNSAFE_getAllByType(TextInput).slice(-2);
      fireEvent.changeText(reps, '10');
      fireEvent.changeText(weight, '60');
      await act(async () => {
        fireEvent.press(utils.getByLabelText('Add set'));
      });
      return utils;
    }

    function inputs(utils: ReturnType<typeof render>) {
      return utils.UNSAFE_getAllByType(TextInput).slice(-2);
    }

    it('alerts and keeps the typed reps and weight when the write rejects', async () => {
      mockLogWorkoutSet.mockRejectedValue(new Error('disk full'));

      const utils = await openLogger();

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to save your set. Please try again.');
      const [reps, weight] = inputs(utils);
      expect(reps.props.value).toBe('10');
      expect(weight.props.value).toBe('60');
    });

    it('clears reps without an alert when the write succeeds', async () => {
      const utils = await openLogger();

      expect(alertSpy).not.toHaveBeenCalled();
      const [reps, weight] = inputs(utils);
      expect(reps.props.value).toBe('');
      expect(weight.props.value).toBe('60');
    });
  });
});
