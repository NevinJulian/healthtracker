import React from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(callback, [callback]);
  },
}));

jest.mock('../../utils/dates', () => ({
  ...jest.requireActual('../../utils/dates'),
  todayKey: () => '2026-11-14',
}));

jest.mock('../../db/database', () => ({
  getDailyLogsBetween: jest.fn(),
  getWorkoutSetsBetween: jest.fn(),
  getConsumedMacrosByDay: jest.fn(),
  getNutritionGoals: jest.fn(),
  getWeightHistory: jest.fn(),
}));

import WeeklyReviewScreen from '../WeeklyReviewScreen';
import {
  getConsumedMacrosByDay,
  getDailyLogsBetween,
  getNutritionGoals,
  getWeightHistory,
  getWorkoutSetsBetween,
  type DailyLogEntry,
  type DailyMacroTotals,
  type WorkoutSet,
} from '../../db/database';
import { Colors } from '../../theme/tokens';

const mockLogs = jest.mocked(getDailyLogsBetween);
const mockSets = jest.mocked(getWorkoutSetsBetween);
const mockIntake = jest.mocked(getConsumedMacrosByDay);
const mockGoals = jest.mocked(getNutritionGoals);
const mockWeights = jest.mocked(getWeightHistory);

function log(date: string, over: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    date,
    walking_task: '',
    hammer_task: '',
    walk_completed: false,
    hammer_completed: false,
    fasting_completed: false,
    is_rest_day: false,
    is_meal_prep_day: false,
    exercises: [],
    body_weight: null,
    additional_workouts: [],
    ...over,
  };
}

let nextId = 1;
function workoutSet(
  date: string,
  exercise: string,
  weight_kg: number,
  reps: number,
  set_type: string | null = null
): WorkoutSet {
  return { id: nextId++, date, exercise, set_index: 0, reps, weight_kg, set_type, created_at: '' };
}

function intake(date: string, calories: number, protein: number): DailyMacroTotals {
  return { date, calories, protein, carbs: 0, fat: 0, mealCount: 1 };
}

const TITLE = "Couldn't load your weekly review";
const BANNER = "Couldn't refresh. Showing the last loaded data.";
const SECTION_TITLES = ['Training', 'Lifting', 'New bests', 'Nutrition', 'Weight'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

async function renderScreen() {
  render(<WeeklyReviewScreen />);
  await flush();
}

function allText(): string[] {
  return screen.UNSAFE_getAllByType(Text).map((node) => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockLogs.mockResolvedValue([]);
  mockSets.mockResolvedValue([]);
  mockIntake.mockResolvedValue([]);
  mockGoals.mockResolvedValue({ calories: 2400, protein: 160 });
  mockWeights.mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WeeklyReviewScreen', () => {
  it('reads the two windows from the database', async () => {
    await renderScreen();
    expect(mockLogs).toHaveBeenCalledWith('2026-11-01', '2026-11-14');
    expect(mockIntake).toHaveBeenCalledWith(14);
    expect(mockWeights).toHaveBeenCalledWith(90);
  });

  it('shows both date ranges in the header', async () => {
    await renderScreen();
    expect(screen.getByText('Weekly review')).toBeTruthy();
    expect(screen.getByText('Last 7 days · 8 Nov – 14 Nov')).toBeTruthy();
    expect(screen.getByText('Previous 7 days · 1 Nov – 7 Nov')).toBeTruthy();
  });

  it('shows only the empty state when nothing was logged', async () => {
    await renderScreen();
    expect(screen.getByText('Nothing logged in these 7 days.')).toBeTruthy();
    for (const title of SECTION_TITLES) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });

  it('shows a one-line empty message in each section without data', async () => {
    mockLogs.mockResolvedValue([log('2026-11-12', { body_weight: 80 })]);
    await renderScreen();

    for (const title of SECTION_TITLES) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText('No sessions or walks logged.')).toBeTruthy();
    expect(screen.getByText('No sets logged.')).toBeTruthy();
    expect(screen.getByText('No new bests.')).toBeTruthy();
    expect(screen.getByText('No meals or entries logged.')).toBeTruthy();
    expect(screen.getByText('Not enough weigh-ins yet.')).toBeTruthy();
    expect(screen.queryByText('Nothing logged in these 7 days.')).toBeNull();
  });

  describe('with a filled window', () => {
    beforeEach(() => {
      mockLogs.mockResolvedValue([
        log('2026-11-08', { hammer_completed: true, walk_completed: true }),
        log('2026-11-09', { hammer_completed: true }),
        log('2026-11-10', { walk_completed: true }),
        log('2026-11-11', { is_rest_day: true, walk_completed: true }),
        log('2026-11-12', { hammer_completed: true, walk_completed: true }),
        log('2026-11-13'),
        log('2026-11-14', { is_rest_day: true }),
        log('2026-11-01', { hammer_completed: true, walk_completed: true }),
        log('2026-11-02', { hammer_completed: true }),
        log('2026-11-03', { walk_completed: true }),
        log('2026-11-04'),
        log('2026-11-05', { is_rest_day: true, walk_completed: true }),
        log('2026-11-06', { is_rest_day: true }),
        log('2026-11-07', { is_rest_day: true }),
      ]);
      mockSets.mockResolvedValue([
        workoutSet('2026-10-20', 'Squat', 95, 5),
        workoutSet('2026-11-03', 'Deadlift', 120, 10),
        workoutSet('2026-11-03', 'Deadlift', 120, 10),
        workoutSet('2026-11-03', 'Deadlift', 115, 10),
        workoutSet('2026-11-10', 'Squat', 100, 5),
        workoutSet('2026-11-10', 'Squat', 100, 5),
        workoutSet('2026-11-10', 'Squat', 100, 5),
        workoutSet('2026-11-10', 'Bench Press', 80, 5),
        workoutSet('2026-11-10', 'Bench Press', 80, 5),
      ]);
      mockIntake.mockResolvedValue([
        intake('2026-11-08', 2000, 140),
        intake('2026-11-09', 2200, 150),
        intake('2026-11-10', 2400, 160),
        intake('2026-11-02', 1800, 120),
        intake('2026-11-03', 2000, 130),
      ]);
    });

    it('shows the figures with the previous value and the change', async () => {
      await renderScreen();

      expect(screen.getByText('Gym sessions')).toBeTruthy();
      expect(screen.getByText('3 of 5')).toBeTruthy();
      expect(screen.getByText('Previous: 2 of 4')).toBeTruthy();
      expect(screen.getByText('+1 session')).toBeTruthy();
      expect(screen.getByText('4 of 7')).toBeTruthy();
      expect(screen.getByText('Working sets')).toBeTruthy();
      expect(screen.getByText('Previous: 3')).toBeTruthy();
      expect(screen.getByText('+2 sets')).toBeTruthy();
      expect(screen.getByText('2,300 kg')).toBeTruthy();
      expect(screen.getByText('−1250 kg')).toBeTruthy();
      expect(screen.getByText('Squat')).toBeTruthy();
      expect(screen.getByText('100 kg')).toBeTruthy();
      expect(screen.getByText('2,200 kcal')).toBeTruthy();
      expect(screen.getByText('2,400 kcal · 160 g')).toBeTruthy();
    });

    it('shows the change in the primary text colour and the previous value in the secondary one', async () => {
      await renderScreen();
      const change = StyleSheet.flatten(screen.getByText('+2 sets').props.style);
      const previous = StyleSheet.flatten(screen.getByText('Previous: 3').props.style);
      expect(change.color).toBe(Colors.textPrimary);
      expect(previous.color).toBe(Colors.textSecondary);
    });

    it('uses no judgement wording', async () => {
      await renderScreen();
      const text = allText().join(' ');
      expect(text).not.toMatch(
        /slack|good|bad|great|behind|ahead|well done|keep it up|missed|worse|better|improv|decline|on track|off track/i
      );
    });
  });

  describe('when loading fails', () => {
    it('shows the error view with Retry, then the review once Retry succeeds', async () => {
      mockLogs.mockRejectedValueOnce(new Error('disk'));
      await renderScreen();

      expect(screen.getByText(TITLE)).toBeTruthy();
      expect(screen.getByText('Your data is safe. Try again.')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
      });
      await flush();

      expect(screen.queryByText(TITLE)).toBeNull();
      expect(screen.getByText('Nothing logged in these 7 days.')).toBeTruthy();
    });

    it('keeps the last loaded data under a banner when a refresh fails', async () => {
      mockLogs.mockResolvedValue([log('2026-11-12', { hammer_completed: true })]);
      await renderScreen();
      expect(screen.getByText('1 of 1')).toBeTruthy();

      mockLogs.mockRejectedValueOnce(new Error('disk'));
      await act(async () => {
        screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
      });
      await flush();

      expect(screen.getByText(BANNER)).toBeTruthy();
      expect(screen.getByText('1 of 1')).toBeTruthy();
      expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('ignores a result that arrives after a newer load has started', async () => {
      const first = deferred<DailyLogEntry[]>();
      mockLogs.mockReturnValueOnce(first.promise);
      render(<WeeklyReviewScreen />);
      await flush();

      mockLogs.mockResolvedValueOnce([log('2026-11-12', { hammer_completed: true })]);
      await act(async () => {
        screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
      });
      await flush();
      expect(screen.getByText('1 of 1')).toBeTruthy();

      await act(async () => {
        first.resolve([]);
      });
      await flush();
      expect(screen.getByText('1 of 1')).toBeTruthy();
    });
  });
});
