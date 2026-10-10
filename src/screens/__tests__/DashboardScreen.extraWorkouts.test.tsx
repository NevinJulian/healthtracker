import React from 'react';
import { Alert } from 'react-native';

import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

const mockToday = '2026-09-19';

const workoutA = {
  id: 'a',
  name: 'Curls',
  muscle_group: 'Arms',
  sets: '3',
  reps: '10',
  completed: false,
};
const workoutB = {
  id: 'b',
  name: 'Run',
  muscle_group: 'Legs',
  sets: '1',
  reps: '1',
  completed: false,
};

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
  additional_workouts: [workoutB],
};

jest.mock('../../components/BioForceModal', () => {
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ onAddWorkout }: { onAddWorkout: (w: unknown) => void }) => (
      <TouchableOpacity accessibilityLabel="Stub add workout" onPress={() => onAddWorkout(workoutA)}>
        <Text>add</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../db/database', () => ({
  CorruptJsonError: jest.requireActual('../../db/database').CorruptJsonError,
  getLogByDate: jest.fn().mockResolvedValue(null),
  upsertLogField: jest.fn().mockResolvedValue(undefined),
  upsertExerciseCompleted: jest.fn().mockResolvedValue(undefined),
  upsertBodyWeight: jest.fn().mockResolvedValue(undefined),
  addAdditionalWorkout: jest.fn().mockResolvedValue(undefined),
  toggleAdditionalWorkout: jest.fn().mockResolvedValue(undefined),
  syncRollingSchedule: jest.fn().mockResolvedValue(undefined),
  toISODate: jest.fn(() => '2026-09-19'),
  getTodaysMealsWithRecipe: jest.fn().mockResolvedValue([]),
  toggleMealConsumed: jest.fn().mockResolvedValue(undefined),
  getWaterForDay: jest.fn().mockResolvedValue(0),
  addWater: jest.fn().mockResolvedValue(undefined),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  logBodyMeasurement: jest.fn().mockResolvedValue(undefined),
  getLatestMeasurements: jest.fn().mockResolvedValue(null),
  logWorkoutSet: jest.fn().mockResolvedValue(undefined),
  getWorkoutSetsForDay: jest.fn().mockResolvedValue([]),
  getLastSetForExercise: jest.fn(() => Promise.resolve(null)),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

import DashboardScreen from '../DashboardScreen';
import {
  getLogByDate,
  addAdditionalWorkout,
  toggleAdditionalWorkout,
} from '../../db/database';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DashboardScreen additional workouts pass only the change to the database', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getLogByDate).mockResolvedValue({ ...mockEntry });
  });

  it('add then toggle before the first write resolves call the new writers with the change only', async () => {
    let releaseAdd: () => void = () => {};
    jest.mocked(addAdditionalWorkout).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        releaseAdd = resolve;
      })
    );

    const { getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    await act(async () => {
      fireEvent.press(getByLabelText('Stub add workout'));
    });
    await act(async () => {
      fireEvent.press(getByLabelText('Mark Curls complete'));
    });

    expect(addAdditionalWorkout).toHaveBeenCalledWith(mockToday, workoutA);
    expect(toggleAdditionalWorkout).toHaveBeenCalledWith(mockToday, workoutA.id);

    await act(async () => {
      releaseAdd();
    });
  });
});

describe('DashboardScreen reverts an additional-workout tick the database rejects', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getLogByDate).mockResolvedValue({ ...mockEntry });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a plain Error reloads the day, restores the tick and offers no reset', async () => {
    jest.mocked(toggleAdditionalWorkout).mockRejectedValueOnce(new Error('x'));
    const { getByLabelText, queryByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();
    const loadsBefore = jest.mocked(getLogByDate).mock.calls.length;

    await act(async () => {
      fireEvent.press(getByLabelText('Mark Run complete'));
    });
    await flushMicrotasks();

    expect(jest.mocked(getLogByDate).mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(queryByLabelText('Mark Run complete')).not.toBeNull();
    expect(queryByLabelText('Mark Run incomplete')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
