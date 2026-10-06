import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  exercises: [],
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
import { getLogByDate, getLatestMeasurements, logBodyMeasurement } from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockGetLatestMeasurements = jest.mocked(getLatestMeasurements);
const mockLogBodyMeasurement = jest.mocked(logBodyMeasurement);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderWithModalOpen() {
  const utils = render(<DashboardScreen />);
  await flushMicrotasks();
  fireEvent.press(utils.getByLabelText('Log measurements'));
  return utils;
}

async function pressSave(utils: Awaited<ReturnType<typeof renderWithModalOpen>>) {
  await act(async () => {
    fireEvent.press(utils.getByLabelText('Save'));
  });
}

describe('DashboardScreen measurements modal only submits edited fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockLogBodyMeasurement.mockResolvedValue(undefined);
    mockGetLatestMeasurements.mockImplementation(() =>
      Promise.resolve({
        waist_cm: { value: 80, date: '2026-09-10' },
        chest_cm: null,
        hips_cm: null,
        thigh_cm: null,
        arm_cm: null,
      })
    );
  });

  it('skips the untouched waist when only chest is edited', async () => {
    const utils = await renderWithModalOpen();
    expect(utils.getByTestId('measurement-waist-input').props.value).toBe('');

    fireEvent.changeText(utils.getByTestId('measurement-chest-input'), '90');
    await pressSave(utils);

    expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
    const fields = mockLogBodyMeasurement.mock.calls[0][1];
    expect(fields.waist_cm).toBeUndefined();
    expect(fields.chest_cm).toBe(90);
  });

  it('writes nothing when a field the user typed in is blanked again', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');
    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '');
    await pressSave(utils);

    expect(mockLogBodyMeasurement).not.toHaveBeenCalled();
  });

  it('sends the parsed number for a typed field', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '78,5');
    await pressSave(utils);

    expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
    expect(mockLogBodyMeasurement.mock.calls[0][1].waist_cm).toBe(78.5);
  });

  it('writes nothing when saved without edits', async () => {
    const utils = await renderWithModalOpen();

    await pressSave(utils);

    expect(mockLogBodyMeasurement).not.toHaveBeenCalled();
  });
});
