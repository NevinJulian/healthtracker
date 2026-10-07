import React from 'react';
import { Alert, AppState } from 'react-native';

import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

const mockToday = '2026-09-19';

const workoutA = { id: 'a', name: 'Curls', muscle_group: 'Arms', sets: '3', reps: '10', completed: false };
const workoutB = { id: 'b', name: 'Run', muscle_group: 'Legs', sets: '1', reps: '1', completed: false };
const squat = { id: 's', name: 'Squat', muscle_group: 'Legs', sets: '3', reps: '5', completed: false, videoUrl: '' };

const mockEntry = {
  date: mockToday,
  walking_task: 'Walk 30 min',
  hammer_task: 'Upper body',
  walk_completed: false,
  hammer_completed: false,
  fasting_completed: false,
  is_rest_day: false,
  is_meal_prep_day: false,
  exercises: [squat],
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
  resetCorruptDayColumn: jest.fn().mockResolvedValue(undefined),
  getLogByDate: jest.fn().mockResolvedValue(null),
  upsertLogField: jest.fn().mockResolvedValue(undefined),
  upsertExerciseCompleted: jest.fn().mockResolvedValue(undefined),
  upsertBodyWeight: jest.fn().mockResolvedValue(undefined),
  upsertAdditionalWorkouts: jest.fn().mockResolvedValue(undefined),
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
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

import DashboardScreen from '../DashboardScreen';
import {
  CorruptJsonError,
  getLogByDate,
  addAdditionalWorkout,
  toggleAdditionalWorkout,
  upsertExerciseCompleted,
  resetCorruptDayColumn,
  toISODate,
} from '../../db/database';

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function lastAlert(spy: jest.SpyInstance): { title: string; message: string; buttons: AlertButton[] } {
  const [title, message, buttons] = spy.mock.calls[spy.mock.calls.length - 1];
  return { title, message, buttons: buttons as AlertButton[] };
}

async function pressButton(buttons: AlertButton[], text: string) {
  const button = buttons.find((b) => b.text === text);
  expect(button).toBeDefined();
  await act(async () => {
    button?.onPress?.();
  });
}

describe('DashboardScreen offers to reset a day whose stored JSON is unreadable', () => {
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

  const cases = [
    {
      name: 'adding a workout',
      column: 'additional_workouts' as const,
      act: (q: ReturnType<typeof render>) => fireEvent.press(q.getByLabelText('Stub add workout')),
      arrange: () => jest.mocked(addAdditionalWorkout).mockRejectedValueOnce(new CorruptJsonError('t', 'additional_workouts', mockToday)),
    },
    {
      name: 'toggling a workout',
      column: 'additional_workouts' as const,
      act: (q: ReturnType<typeof render>) => fireEvent.press(q.getByLabelText('Mark Run complete')),
      arrange: () => jest.mocked(toggleAdditionalWorkout).mockRejectedValueOnce(new CorruptJsonError('t', 'additional_workouts', mockToday)),
    },
    {
      name: 'toggling an exercise',
      column: 'exercises' as const,
      act: (q: ReturnType<typeof render>) => fireEvent.press(q.getByLabelText('Mark Squat complete')),
      arrange: () => jest.mocked(upsertExerciseCompleted).mockRejectedValueOnce(new CorruptJsonError('t', 'exercises', mockToday)),
    },
  ];

  it.each(cases)('$name: shows the Alert with Cancel and Reset this day', async ({ arrange, act: press }) => {
    arrange();
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    await act(async () => {
      press(q);
    });
    await flushMicrotasks();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const { title, buttons } = lastAlert(alertSpy);
    expect(title).toBe('Cannot save: unreadable data');
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Reset this day']);
  });

  it.each(cases)('$name: Reset this day calls the reset with the refused date and column, then reloads', async ({ arrange, act: press, column }) => {
    arrange();
    const q = render(<DashboardScreen />);
    await flushMicrotasks();
    await act(async () => {
      press(q);
    });
    await flushMicrotasks();
    const loadsBefore = jest.mocked(getLogByDate).mock.calls.length;

    await pressButton(lastAlert(alertSpy).buttons, 'Reset this day');
    await flushMicrotasks();

    expect(resetCorruptDayColumn).toHaveBeenCalledTimes(1);
    expect(resetCorruptDayColumn).toHaveBeenCalledWith(mockToday, column);
    expect(jest.mocked(getLogByDate).mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it('Cancel resets nothing', async () => {
    jest.mocked(addAdditionalWorkout).mockRejectedValueOnce(new CorruptJsonError('t', 'additional_workouts', mockToday));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();
    await act(async () => {
      fireEvent.press(q.getByLabelText('Stub add workout'));
    });
    await flushMicrotasks();

    await pressButton(lastAlert(alertSpy).buttons, 'Cancel');
    await flushMicrotasks();

    expect(resetCorruptDayColumn).not.toHaveBeenCalled();
  });

  it('a failed reset is surfaced with a second Alert', async () => {
    jest.mocked(addAdditionalWorkout).mockRejectedValueOnce(new CorruptJsonError('t', 'additional_workouts', mockToday));
    jest.mocked(resetCorruptDayColumn).mockRejectedValueOnce(new Error('disk full'));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();
    await act(async () => {
      fireEvent.press(q.getByLabelText('Stub add workout'));
    });
    await flushMicrotasks();

    await pressButton(lastAlert(alertSpy).buttons, 'Reset this day');
    await flushMicrotasks();

    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(lastAlert(alertSpy).title).toBe('Reset failed');
  });

  it('other write errors show no Alert', async () => {
    jest.mocked(addAdditionalWorkout).mockRejectedValueOnce(new Error('boom'));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    await act(async () => {
      fireEvent.press(q.getByLabelText('Stub add workout'));
    });
    await flushMicrotasks();

    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('DashboardScreen shows a notice with a reset button when a day loads unreadable', () => {
  const NOTICE = "This day's data can't be read";
  const exercisesLabel = "Reset this day's exercises";
  const workoutsLabel = "Reset this day's extra workouts";
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const flagged = (unreadable: Array<'exercises' | 'additional_workouts'>) => ({
    ...mockEntry,
    exercises: unreadable.includes('exercises') ? [] : mockEntry.exercises,
    additional_workouts: unreadable.includes('additional_workouts') ? [] : mockEntry.additional_workouts,
    unreadable,
  });

  it('shows no notice for a readable day', async () => {
    jest.mocked(getLogByDate).mockResolvedValue({ ...mockEntry });
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(q.queryByText(NOTICE)).toBeNull();
    expect(q.queryByText('Reset this day', { includeHiddenElements: true })).toBeNull();
  });

  it.each([
    ['exercises' as const, exercisesLabel, workoutsLabel],
    ['additional_workouts' as const, workoutsLabel, exercisesLabel],
  ])('%s: notice and button appear in that card only, with no Alert', async (column, shown, hidden) => {
    jest.mocked(getLogByDate).mockResolvedValue(flagged([column]));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(q.getAllByText(NOTICE)).toHaveLength(1);
    expect(q.getAllByText('Reset this day', { includeHiddenElements: true })).toHaveLength(1);
    expect(q.getByLabelText(shown)).toBeTruthy();
    expect(q.queryByLabelText(hidden)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('exercises: the notice replaces the empty-list hint', async () => {
    jest.mocked(getLogByDate).mockResolvedValue(flagged(['exercises']));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(q.queryByText(/No individual exercises configured/)).toBeNull();
  });

  it('both columns unreadable: both cards show their own notice', async () => {
    jest.mocked(getLogByDate).mockResolvedValue(flagged(['exercises', 'additional_workouts']));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(q.getAllByText(NOTICE)).toHaveLength(2);
    expect(q.getByLabelText(exercisesLabel)).toBeTruthy();
    expect(q.getByLabelText(workoutsLabel)).toBeTruthy();
  });

  it.each([
    ['exercises' as const, exercisesLabel],
    ['additional_workouts' as const, workoutsLabel],
  ])('%s: pressing the button resets once, reloads, and the notice goes away', async (column, label) => {
    jest.mocked(getLogByDate).mockResolvedValueOnce(flagged([column])).mockResolvedValue({ ...mockEntry });
    const q = render(<DashboardScreen />);
    await flushMicrotasks();
    const loadsBefore = jest.mocked(getLogByDate).mock.calls.length;

    await act(async () => {
      fireEvent.press(q.getByLabelText(label));
    });
    await flushMicrotasks();

    expect(resetCorruptDayColumn).toHaveBeenCalledTimes(1);
    expect(resetCorruptDayColumn).toHaveBeenCalledWith(mockToday, column);
    expect(jest.mocked(getLogByDate).mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(q.queryByText(NOTICE)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('two rapid presses call the reset once', async () => {
    jest.mocked(getLogByDate).mockResolvedValue(flagged(['exercises']));
    let release: () => void = () => {};
    jest.mocked(resetCorruptDayColumn).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    await act(async () => {
      fireEvent.press(q.getByLabelText(exercisesLabel));
      fireEvent.press(q.getByLabelText(exercisesLabel));
    });
    await act(async () => {
      release();
    });
    await flushMicrotasks();

    expect(resetCorruptDayColumn).toHaveBeenCalledTimes(1);
  });

  it('a failed reset shows Reset failed and a later press works', async () => {
    jest.mocked(getLogByDate).mockResolvedValue(flagged(['exercises']));
    jest.mocked(resetCorruptDayColumn).mockRejectedValueOnce(new Error('disk full'));
    const q = render(<DashboardScreen />);
    await flushMicrotasks();

    await act(async () => {
      fireEvent.press(q.getByLabelText(exercisesLabel));
    });
    await flushMicrotasks();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(lastAlert(alertSpy).title).toBe('Reset failed');

    await act(async () => {
      fireEvent.press(q.getByLabelText(exercisesLabel));
    });
    await flushMicrotasks();

    expect(resetCorruptDayColumn).toHaveBeenCalledTimes(2);
  });
});

describe('DashboardScreen resets the day whose notice is shown after the date rolls over', () => {
  const LOADED_DAY = '2026-09-19';
  const NEXT_DAY = '2026-09-20';
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    jest.mocked(toISODate).mockImplementation(() => LOADED_DAY);
  });

  it.each([
    ['exercises' as const, "Reset this day's exercises"],
    ['additional_workouts' as const, "Reset this day's extra workouts"],
  ])('%s: resets the loaded entry date, not the new render-time date', async (column, label) => {
    jest.mocked(getLogByDate).mockResolvedValueOnce({
      ...mockEntry,
      date: LOADED_DAY,
      exercises: [],
      additional_workouts: [],
      unreadable: [column],
    });
    const q = render(<DashboardScreen />);
    await flushMicrotasks();
    expect(q.getByLabelText(label)).toBeTruthy();

    jest.mocked(toISODate).mockImplementation(() => NEXT_DAY);
    jest.mocked(getLogByDate).mockRejectedValue(new Error('reload failed'));
    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    const handler = calls[calls.length - 1][1] as (state: string) => void;
    await act(async () => {
      handler('active');
    });
    await flushMicrotasks();
    expect(q.getByLabelText(label)).toBeTruthy();

    await act(async () => {
      fireEvent.press(q.getByLabelText(label));
    });
    await flushMicrotasks();

    expect(resetCorruptDayColumn).toHaveBeenCalledTimes(1);
    expect(resetCorruptDayColumn).toHaveBeenCalledWith(LOADED_DAY, column);
  });
});
