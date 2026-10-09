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
  getLastSetForExercise: jest.fn(() => Promise.resolve(null)),
  deleteWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
}));

import DashboardScreen from '../DashboardScreen';
import {
  getLogByDate,
  logWorkoutSet,
  getWorkoutSetsForDay,
  getLastSetForExercise,
  type WorkoutSet,
} from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockGetLastSet = jest.mocked(getLastSetForExercise);
const mockLogWorkoutSet = jest.mocked(logWorkoutSet);

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const REPS_ALERT: [string, string] = [
  'Invalid reps',
  'Enter a whole number of reps between 1 and 100.',
];
const WEIGHT_ALERT: [string, string] = [
  'Invalid weight',
  'Enter a weight between 0.5 and 500 kg.',
];

describe('DashboardScreen set logger validation (#364)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockLogWorkoutSet.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  async function attempt(reps: string, weight: string) {
    const utils = render(<DashboardScreen />);
    await flushMicrotasks();
    fireEvent.press(utils.getByLabelText('Log sets for Squat'));
    const [repsInput, weightInput] = loggerInputs(utils);
    fireEvent.changeText(repsInput, reps);
    fireEvent.changeText(weightInput, weight);
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add set'));
    });
    return utils;
  }

  it('saves weight "78,4" as 78.4', async () => {
    await attempt('10', '78,4');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockLogWorkoutSet).toHaveBeenCalledWith(mockToday, 'Squat', {
      reps: 10,
      weightKg: 78.4,
    });
  });

  it('clears reps and keeps weight after a valid add', async () => {
    const utils = await attempt('10', '60');
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.value).toBe('');
    expect(weight.props.value).toBe('60');
  });

  it.each(['12abc', '12.5', '', '0', '101'])('rejects reps "%s"', async (reps) => {
    const utils = await attempt(reps, '50');
    expect(alertSpy).toHaveBeenCalledWith(...REPS_ALERT);
    expect(mockLogWorkoutSet).not.toHaveBeenCalled();
    const [r, w] = loggerInputs(utils);
    expect(r.props.value).toBe(reps);
    expect(w.props.value).toBe('50');
  });

  it.each(['12abc', '', '0', '0.4', '501'])('rejects weight "%s"', async (weight) => {
    const utils = await attempt('10', weight);
    expect(alertSpy).toHaveBeenCalledWith(...WEIGHT_ALERT);
    expect(mockLogWorkoutSet).not.toHaveBeenCalled();
    const [r, w] = loggerInputs(utils);
    expect(r.props.value).toBe('10');
    expect(w.props.value).toBe(weight);
  });

  it('accepts the boundary values', async () => {
    await attempt('100', '500');
    expect(mockLogWorkoutSet).toHaveBeenCalledWith(mockToday, 'Squat', {
      reps: 100,
      weightKg: 500,
    });
  });
});

describe('DashboardScreen set logger set types', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockLogWorkoutSet.mockResolvedValue(undefined);
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([]);
  });

  async function openLogger() {
    const utils = render(<DashboardScreen />);
    await flushMicrotasks();
    fireEvent.press(utils.getByLabelText('Log sets for Squat'));
    return utils;
  }

  async function add(utils: ReturnType<typeof render>, reps: string, weight: string) {
    const [repsInput, weightInput] = loggerInputs(utils);
    fireEvent.changeText(repsInput, reps);
    fireEvent.changeText(weightInput, weight);
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add set'));
    });
  }

  it('logs a warm-up and keeps the toggle on Warm-up until the logger is reopened', async () => {
    const utils = await openLogger();
    expect(utils.getByLabelText('Working').props.accessibilityState.selected).toBe(true);

    fireEvent.press(utils.getByLabelText('Warm-up'));
    await add(utils, '10', '40');
    expect(mockLogWorkoutSet).toHaveBeenLastCalledWith(mockToday, 'Squat', {
      reps: 10,
      weightKg: 40,
      setType: 'warmup',
    });
    expect(utils.getByLabelText('Warm-up').props.accessibilityState.selected).toBe(true);

    await add(utils, '8', '40');
    expect(mockLogWorkoutSet).toHaveBeenLastCalledWith(mockToday, 'Squat', {
      reps: 8,
      weightKg: 40,
      setType: 'warmup',
    });

    fireEvent.press(utils.getByLabelText('Close set logger'));
    fireEvent.press(utils.getByLabelText('Log sets for Squat'));
    expect(utils.getByLabelText('Working').props.accessibilityState.selected).toBe(true);
    expect(utils.getByLabelText('Warm-up').props.accessibilityState.selected).toBe(false);
  });

  it('logs a working set without a setType key', async () => {
    const utils = await openLogger();
    await add(utils, '5', '80');
    expect(mockLogWorkoutSet).toHaveBeenCalledWith(mockToday, 'Squat', {
      reps: 5,
      weightKg: 80,
    });
  });

  it('labels warm-up sets in today list and leaves working sets unlabelled', async () => {
    const base = {
      date: mockToday,
      exercise: 'Squat',
      reps: 5,
      weight_kg: 60,
      created_at: '2026-09-19T10:00:00.000Z',
    };
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([
      { ...base, id: 1, set_index: 0, set_type: 'warmup' },
      { ...base, id: 2, set_index: 1, set_type: null },
    ]);
    const utils = await openLogger();
    expect(utils.getAllByLabelText('Warm-up set')).toHaveLength(1);
  });

  it('shows no warm-up label when every set is a working set', async () => {
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([
      {
        id: 1,
        date: mockToday,
        exercise: 'Squat',
        set_index: 0,
        reps: 5,
        weight_kg: 60,
        set_type: null,
        created_at: '2026-09-19T10:00:00.000Z',
      },
    ]);
    const utils = await openLogger();
    expect(utils.getByText('5 reps @ 60 kg')).toBeTruthy();
    expect(utils.queryAllByLabelText('Warm-up set')).toHaveLength(0);
  });
});

function previousSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 90,
    date: '2026-09-18',
    exercise: 'Squat',
    set_index: 2,
    reps: 8,
    weight_kg: 80,
    set_type: null,
    created_at: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

describe('DashboardScreen set logger last time', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({
      ...mockEntry,
      exercises: [
        ...mockEntry.exercises,
        { id: 'ex2', name: 'Bench', sets: '3', reps: '10', videoUrl: '', completed: false },
      ],
    });
    mockLogWorkoutSet.mockResolvedValue(undefined);
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([]);
    mockGetLastSet.mockResolvedValue(null);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  async function openLogger(name = 'Squat') {
    const utils = render(<DashboardScreen />);
    await flushMicrotasks();
    fireEvent.press(utils.getByLabelText(`Log sets for ${name}`));
    await flushMicrotasks();
    return utils;
  }

  it('asks for the last set of the opened exercise before today', async () => {
    await openLogger();
    expect(mockGetLastSet).toHaveBeenCalledWith('Squat', mockToday);
  });

  it('shows yesterday for a set from the day before', async () => {
    mockGetLastSet.mockResolvedValue(previousSet({ date: '2026-09-18' }));
    const utils = await openLogger();
    expect(utils.getByText('Last time: 80 kg × 8 · yesterday')).toBeTruthy();
  });

  it('shows N days ago and keeps fractional weights', async () => {
    mockGetLastSet.mockResolvedValue(previousSet({ date: '2026-09-16', weight_kg: 82.5, reps: 6 }));
    const utils = await openLogger();
    expect(utils.getByText('Last time: 82.5 kg × 6 · 3 days ago')).toBeTruthy();
  });

  it('shows no line and leaves the inputs empty without history', async () => {
    const utils = await openLogger();
    expect(utils.queryByText(/Last time/)).toBeNull();
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.value).toBe('');
    expect(weight.props.value).toBe('');
  });

  it('keeps the weight prefilled from the last set logged today', async () => {
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([
      previousSet({ id: 5, date: mockToday, set_index: 0, weight_kg: 60, reps: 5 }),
    ]);
    mockGetLastSet.mockResolvedValue(previousSet());
    const utils = await openLogger();
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.value).toBe('');
    expect(weight.props.value).toBe('60');
  });

  it('fills reps and weight when the line is tapped, overwriting typed text, without logging', async () => {
    mockGetLastSet.mockResolvedValue(previousSet({ reps: 8, weight_kg: 82.5 }));
    const utils = await openLogger();
    const [repsInput, weightInput] = loggerInputs(utils);
    fireEvent.changeText(repsInput, '3');
    fireEvent.changeText(weightInput, '20');
    fireEvent.press(utils.getByLabelText('Use last time: 8 reps at 82.5 kg, yesterday'));
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.value).toBe('8');
    expect(weight.props.value).toBe('82.5');
    expect(mockLogWorkoutSet).not.toHaveBeenCalled();
  });

  it('fills the inputs with the Warm-up toggle selected and leaves the toggle alone', async () => {
    mockGetLastSet.mockResolvedValue(previousSet());
    const utils = await openLogger();
    fireEvent.press(utils.getByLabelText('Warm-up'));
    fireEvent.press(utils.getByLabelText('Use last time: 8 reps at 80 kg, yesterday'));
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.value).toBe('8');
    expect(weight.props.value).toBe('80');
    expect(utils.getByLabelText('Warm-up').props.accessibilityState.selected).toBe(true);
  });

  it('exposes the line as a button', async () => {
    mockGetLastSet.mockResolvedValue(previousSet({ date: '2026-09-16' }));
    const utils = await openLogger();
    const line = utils.getByLabelText('Use last time: 8 reps at 80 kg, 3 days ago');
    expect(line.props.accessibilityRole).toBe('button');
  });

  it('shows last time as placeholders while both inputs are empty', async () => {
    mockGetLastSet.mockResolvedValue(previousSet({ reps: 8, weight_kg: 82.5 }));
    const utils = await openLogger();
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.placeholder).toBe('8');
    expect(weight.props.placeholder).toBe('82.5');
    expect(reps.props.value).toBe('');
    expect(weight.props.value).toBe('');
  });

  it('keeps the dash placeholders without history', async () => {
    const utils = await openLogger();
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.placeholder).toBe('—');
    expect(weight.props.placeholder).toBe('—');
  });

  it('gives the reps placeholder only when today already has a set, until weight is cleared', async () => {
    jest.mocked(getWorkoutSetsForDay).mockResolvedValue([
      previousSet({ id: 5, date: mockToday, set_index: 0, weight_kg: 60, reps: 5 }),
    ]);
    mockGetLastSet.mockResolvedValue(previousSet({ reps: 8, weight_kg: 80 }));
    const utils = await openLogger();
    const [reps, weight] = loggerInputs(utils);
    expect(reps.props.placeholder).toBe('8');
    expect(weight.props.value).toBe('60');
    fireEvent.changeText(weight, '');
    expect(loggerInputs(utils)[1].props.placeholder).toBe('80');
  });

  it('shows no line, logs the error and stays usable when the read rejects', async () => {
    const failure = new Error('read failed');
    mockGetLastSet.mockRejectedValue(failure);
    const utils = await openLogger();
    expect(utils.queryByText(/Last time/)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('getLastSetForExercise error', failure);
    const [repsInput, weightInput] = loggerInputs(utils);
    fireEvent.changeText(repsInput, '5');
    fireEvent.changeText(weightInput, '70');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add set'));
    });
    expect(mockLogWorkoutSet).toHaveBeenCalledWith(mockToday, 'Squat', { reps: 5, weightKg: 70 });
  });

  it('drops a late result for an exercise that is no longer open', async () => {
    let resolveSquat: (set: WorkoutSet | null) => void = () => {};
    mockGetLastSet.mockImplementation((name) =>
      name === 'Squat'
        ? new Promise<WorkoutSet | null>((resolve) => {
            resolveSquat = resolve;
          })
        : Promise.resolve(null)
    );
    const utils = await openLogger('Squat');
    fireEvent.press(utils.getByLabelText('Close set logger'));
    fireEvent.press(utils.getByLabelText('Log sets for Bench'));
    await flushMicrotasks();
    await act(async () => {
      resolveSquat(previousSet());
    });
    expect(utils.queryByText(/Last time/)).toBeNull();
  });

  it('drops a late result after the logger closed', async () => {
    let resolveSquat: (set: WorkoutSet | null) => void = () => {};
    mockGetLastSet.mockImplementation(
      () =>
        new Promise<WorkoutSet | null>((resolve) => {
          resolveSquat = resolve;
        })
    );
    const utils = await openLogger('Squat');
    fireEvent.press(utils.getByLabelText('Close set logger'));
    await act(async () => {
      resolveSquat(previousSet());
    });
    expect(utils.queryByText(/Last time/)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

function loggerInputs(utils: ReturnType<typeof render>) {
  return utils.UNSAFE_getAllByType(TextInput).slice(-2);
}
