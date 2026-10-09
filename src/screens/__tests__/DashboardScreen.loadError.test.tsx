import React from 'react';
import { Alert } from 'react-native';

import { render, act, fireEvent } from '@testing-library/react-native';

let mockFocusCallback: (() => void | (() => void)) | null = null;
let mockFocusCleanup: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
  },
}));

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
import { getLogByDate, syncRollingSchedule } from '../../db/database';
import type { DailyLogEntry } from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockSync = jest.mocked(syncRollingSchedule);

const TITLE = "Couldn't load today";
const SUB = 'Your data is safe. Try again.';
const BANNER = "Couldn't refresh. Showing the last loaded data.";

function makeEntry(overrides: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    date: '2026-09-19',
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
    ...overrides,
  } as DailyLogEntry;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function triggerFocus() {
  await act(async () => {
    mockFocusCleanup?.();
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
  });
  await flush();
}

describe('DashboardScreen load errors', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockFocusCleanup = null;
    mockGetLogByDate.mockImplementation(() => Promise.resolve(makeEntry()));
    mockSync.mockImplementation(() => Promise.resolve(undefined));
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it.each([
    ['syncRollingSchedule', () => mockSync.mockRejectedValueOnce(new Error('boom'))],
    ['getLogByDate', () => mockGetLogByDate.mockRejectedValueOnce(new Error('boom'))],
  ])('a first load where %s rejects shows the error view', async (_name, arrange) => {
    arrange();
    const { getByText, getByLabelText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();

    expect(getByText(TITLE)).toBeTruthy();
    expect(getByText(SUB)).toBeTruthy();
    expect(getByLabelText('Retry')).toBeTruthy();
    expect(queryByText('No entry for today — try reopening the app.')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Retry after a first failure shows the data and removes the error', async () => {
    mockGetLogByDate.mockRejectedValueOnce(new Error('boom'));
    const { getByText, getByLabelText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();
    expect(getByText(TITLE)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText('Retry'));
    });
    await flush();

    expect(getByText('Walk 30 min')).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('a rejected reload after a good load keeps the data and shows the banner; Retry clears it', async () => {
    const { getByText, getByLabelText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();
    expect(getByText('Walk 30 min')).toBeTruthy();

    mockGetLogByDate.mockRejectedValueOnce(new Error('boom'));
    await triggerFocus();

    expect(getByText(BANNER)).toBeTruthy();
    expect(getByText('Walk 30 min')).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByLabelText('Retry'));
    });
    await flush();

    expect(queryByText(BANNER)).toBeNull();
    expect(getByText('Walk 30 min')).toBeTruthy();
  });

  it('a later successful load clears the banner', async () => {
    const { getByText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();
    mockGetLogByDate.mockRejectedValueOnce(new Error('boom'));
    await triggerFocus();
    expect(getByText(BANNER)).toBeTruthy();
    await triggerFocus();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('an empty but successful load shows the normal empty state, not the error', async () => {
    mockGetLogByDate.mockImplementation(() => Promise.resolve(null));
    const { getByText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();

    expect(getByText('No entry for today — try reopening the app.')).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(SUB)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('an older run rejecting after a newer one succeeded shows no error', async () => {
    const older = deferred<DailyLogEntry>();
    const newer = deferred<DailyLogEntry>();
    mockGetLogByDate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { getByText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();
    await triggerFocus();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve(makeEntry({ walking_task: 'NEWER TASK' }));
    });
    await flush();
    expect(getByText('NEWER TASK')).toBeTruthy();

    await act(async () => {
      older.reject(new Error('late failure'));
    });
    await flush();

    expect(getByText('NEWER TASK')).toBeTruthy();
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(BANNER)).toBeNull();
  });

  it('an older run resolving late does not overwrite the newer data', async () => {
    const older = deferred<DailyLogEntry>();
    const newer = deferred<DailyLogEntry>();
    mockGetLogByDate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { getByText, queryByText } = render(<DashboardScreen />);
    await triggerFocus();
    await triggerFocus();

    await act(async () => {
      newer.resolve(makeEntry({ walking_task: 'NEWER TASK' }));
    });
    await flush();
    await act(async () => {
      older.resolve(makeEntry({ walking_task: 'OLDER TASK' }));
    });
    await flush();

    expect(getByText('NEWER TASK')).toBeTruthy();
    expect(queryByText('OLDER TASK')).toBeNull();
  });

  describe('a failed reload with no entry on screen', () => {
    const NO_ENTRY = 'No entry for today — try reopening the app.';

    async function arrive() {
      mockGetLogByDate.mockResolvedValueOnce(null);
      const utils = render(<DashboardScreen />);
      await triggerFocus();
      expect(utils.getByText(NO_ENTRY)).toBeTruthy();
      mockGetLogByDate.mockRejectedValueOnce(new Error('boom'));
      await triggerFocus();
      return utils;
    }

    it('shows the error view, not the empty text or the banner', async () => {
      const { getByText, getByLabelText, queryByText } = await arrive();

      expect(getByText(TITLE)).toBeTruthy();
      expect(getByText(SUB)).toBeTruthy();
      expect(getByLabelText('Retry')).toBeTruthy();
      expect(queryByText(NO_ENTRY)).toBeNull();
      expect(queryByText(BANNER)).toBeNull();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('Retry that returns an entry shows the data and no error', async () => {
      const { getByText, getByLabelText, queryByText } = await arrive();

      await act(async () => {
        fireEvent.press(getByLabelText('Retry'));
      });
      await flush();

      expect(getByText('Walk 30 min')).toBeTruthy();
      expect(queryByText(TITLE)).toBeNull();
      expect(queryByText(BANNER)).toBeNull();
    });

    it('Retry that returns no row shows the empty text and no error', async () => {
      const { getByText, getByLabelText, queryByText } = await arrive();
      mockGetLogByDate.mockResolvedValueOnce(null);

      await act(async () => {
        fireEvent.press(getByLabelText('Retry'));
      });
      await flush();

      expect(getByText(NO_ENTRY)).toBeTruthy();
      expect(queryByText(TITLE)).toBeNull();
      expect(queryByText(SUB)).toBeNull();
      expect(queryByText(BANNER)).toBeNull();
    });
  });
});
