import React from 'react';
import { Alert, RefreshControl } from 'react-native';

import { render, act, fireEvent } from '@testing-library/react-native';

let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

jest.mock('../../db/database', () => ({
  toISODate: jest.fn(() => '2024-06-15'),
  getRollingWindow: jest.fn().mockResolvedValue([]),
  getDailyLogsBetween: jest.fn().mockResolvedValue([]),
  getWeightHistory: jest.fn().mockResolvedValue([]),
  getStartDate: jest.fn().mockResolvedValue('2020-01-01'),
  getConsumedMacrosByDay: jest.fn().mockResolvedValue([]),
  getMealAdherence: jest
    .fn()
    .mockResolvedValue({ planned: 0, consumed: 0, adherenceRatio: 0 }),
  getMostEatenRecipes: jest.fn().mockResolvedValue([]),
  getAverageConsumedMacros: jest
    .fn()
    .mockResolvedValue({ calories: 0, protein: 0, carbs: 0, fat: 0, sampleSize: 0 }),
  getMostCookedRecipes: jest.fn().mockResolvedValue([]),
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 1800, protein: 150 }),
  getWaterHistory: jest.fn().mockResolvedValue([]),
  getBodyMeasurements: jest.fn().mockResolvedValue([]),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
  getInventorySnapshot: jest
    .fn()
    .mockResolvedValue({ recipesInStock: 0, totalPortions: 0, items: [] }),
  getLoggedExercises: jest.fn().mockResolvedValue(['bench']),
}));

import AnalyticsDashboardScreen from '../AnalyticsDashboardScreen';
import {
  getDailyLogsBetween,
  getNutritionGoals,
  getLoggedExercises,
} from '../../db/database';

const mockLogs = jest.mocked(getDailyLogsBetween);
const mockGoals = jest.mocked(getNutritionGoals);
const mockLifts = jest.mocked(getLoggedExercises);

const TITLE = "Couldn't load your progress";
const SUB = 'Your data is safe. Try again.';
const BANNER = "Couldn't refresh. Showing the last loaded data.";
const BENCH = 'View progression for bench';

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

async function triggerFocus() {
  await act(async () => {
    latestFocusEffect!();
  });
  await flush();
}

describe('AnalyticsDashboardScreen load errors', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    latestFocusEffect = null;
    mockLogs.mockReset().mockResolvedValue([]);
    mockGoals.mockReset().mockResolvedValue({ calories: 1800, protein: 150 } as never);
    mockLifts.mockReset().mockResolvedValue(['bench']);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it.each([
    ['getDailyLogsBetween', () => mockLogs.mockRejectedValueOnce(new Error('boom'))],
    ['getNutritionGoals', () => mockGoals.mockRejectedValueOnce(new Error('boom'))],
  ])('a first load where %s rejects shows the error view instead of the cards', async (_n, arrange) => {
    arrange();
    const { getByText, getByLabelText, queryByLabelText, queryByText } = render(
      <AnalyticsDashboardScreen />
    );
    await triggerFocus();

    expect(getByText('Progress')).toBeTruthy();
    expect(getByText('Last 30 days')).toBeTruthy();
    expect(getByText(TITLE)).toBeTruthy();
    expect(getByText(SUB)).toBeTruthy();
    expect(getByLabelText('Retry')).toBeTruthy();
    expect(queryByLabelText(BENCH)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Retry after a first failure shows the data and removes the error', async () => {
    mockGoals.mockRejectedValueOnce(new Error('boom'));
    const { getByText, getByLabelText, queryByText } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();
    expect(getByText(TITLE)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText('Retry'));
    });
    await flush();

    expect(getByLabelText(BENCH)).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('a rejected reload after a good load keeps the cards and shows the banner; Retry clears it', async () => {
    const { getByText, getByLabelText, queryByText } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();
    expect(getByLabelText(BENCH)).toBeTruthy();

    mockGoals.mockRejectedValueOnce(new Error('boom'));
    await triggerFocus();

    expect(getByText(BANNER)).toBeTruthy();
    expect(getByText('Progress')).toBeTruthy();
    expect(getByLabelText(BENCH)).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByLabelText('Retry'));
    });
    await flush();

    expect(queryByText(BANNER)).toBeNull();
    expect(getByLabelText(BENCH)).toBeTruthy();
  });

  it('a failed pull-to-refresh after a good load shows the banner', async () => {
    const { getByText, UNSAFE_getByType } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();

    mockLogs.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await flush();

    expect(getByText(BANNER)).toBeTruthy();
  });

  it('an empty but successful load shows no error', async () => {
    mockLifts.mockResolvedValue([]);
    const { getByText, queryByText } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();

    expect(getByText('Progress')).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(SUB)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('an older run rejecting after a newer one succeeded shows no error', async () => {
    const older = deferred<never[]>();
    mockLogs.mockReturnValueOnce(older.promise);

    const { getByLabelText, queryByText } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();
    await triggerFocus();
    expect(getByLabelText(BENCH)).toBeTruthy();

    await act(async () => {
      older.reject(new Error('late failure'));
    });
    await flush();

    expect(getByLabelText(BENCH)).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('an older run resolving late does not overwrite the newer data', async () => {
    const older = deferred<never[]>();
    mockLogs.mockReturnValueOnce(older.promise);
    mockLifts.mockResolvedValueOnce(['newer']).mockResolvedValueOnce(['older']);

    const { getByLabelText, queryByLabelText } = render(<AnalyticsDashboardScreen />);
    await triggerFocus();
    await triggerFocus();
    expect(getByLabelText('View progression for newer')).toBeTruthy();

    await act(async () => {
      older.resolve([]);
    });
    await flush();

    expect(getByLabelText('View progression for newer')).toBeTruthy();
    expect(queryByLabelText('View progression for older')).toBeNull();
  });

  it('a superseded run finishing does not make a later failure a refresh failure', async () => {
    const runA = deferred<never[]>();
    const runB = deferred<never[]>();
    mockLogs.mockReturnValueOnce(runA.promise).mockReturnValueOnce(runB.promise);

    const { getByText, getByLabelText, queryByLabelText, queryByText } = render(
      <AnalyticsDashboardScreen />
    );
    await triggerFocus();
    await triggerFocus();

    await act(async () => {
      runA.resolve([]);
    });
    await flush();
    await act(async () => {
      runB.reject(new Error('boom'));
    });
    await flush();

    expect(getByText(TITLE)).toBeTruthy();
    expect(getByLabelText('Retry')).toBeTruthy();
    expect(queryByText(BANNER)).toBeNull();
    expect(queryByLabelText(BENCH)).toBeNull();
  });
});
