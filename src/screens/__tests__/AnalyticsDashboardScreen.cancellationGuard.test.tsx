/**
 * Regression test for issue #312.
 *
 * Bug: `loadData` in AnalyticsDashboardScreen has no cancellation guard.
 * `useFocusEffect(useCallback(() => { loadData(); }, [loadData]))` fires on
 * every focus with no cleanup and no liveness flag, and pull-to-refresh
 * calls `loadData` directly too. When an older run's awaits resolve after a
 * newer run has already started (e.g. focus fires again, or the user pulls
 * to refresh while the first load is still in flight), the older run's
 * setters fire *last* and silently stomp the newer run's state — at every
 * one of `loadData`'s four setter boundaries: the sequential awaits, the
 * big nutrition Promise.all, `setLoggedExercises`, and the conditional
 * lift-history Promise.all → `setLiftHistoryByExercise`.
 *
 * This test starts one run on (simulated) focus and a second via
 * pull-to-refresh while the first is still pending on `getInventorySnapshot`
 * / `getLoggedExercises`, resolves the *newer* run first and the *older*
 * run second, and asserts the rendered output reflects only the newer run.
 */
import React from 'react';
import { RefreshControl } from 'react-native';

// See AnalyticsDashboardScreen.liftingSelection.test.tsx (#308 / #360) for
// why this escape hatch is needed: the lockfile pins `react` at 19.1.0 while
// `react-test-renderer` resolved to 19.2.5, and RNTL's module-load side
// effect throws on that mismatch unless this env var is set first.
process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, act } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

// ─── Mock @react-navigation/native's useFocusEffect ────────────────────────
// A plain `useEffect(cb, [])` can't simulate blur + re-focus. This mock just
// captures the latest effect callback so the test can invoke it (to
// simulate focus) and the cleanup it returns (to simulate blur).
let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

// ─── Deferred promises, keyed by call order ────────────────────────────────
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const inventoryDeferreds: Array<Deferred<any>> = [];
const exercisesDeferreds: Array<Deferred<string[]>> = [];

function nextDeferred<T>(store: Array<Deferred<T>>): Promise<T> {
  const d = createDeferred<T>();
  store.push(d);
  return d.promise;
}

// ─── Mock ../../db/database ─────────────────────────────────────────────────
jest.mock('../../db/database', () => ({
  toISODate: jest.fn(() => '2024-06-15'),
  getRollingWindow: jest.fn().mockResolvedValue([]),
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
  // Varies by exercise argument, but each call still resolves immediately —
  // only getInventorySnapshot/getLoggedExercises are manually controlled.
  getWorkoutHistory: jest.fn((exercise: string) =>
    Promise.resolve(
      exercise === 'squat'
        ? [
            {
              id: 1,
              date: '2024-06-01',
              exercise: 'squat',
              set_index: 0,
              reps: 5,
              weight_kg: 100,
              created_at: '2024-06-01',
            },
          ]
        : [
            {
              id: 2,
              date: '2024-06-02',
              exercise: 'bench',
              set_index: 0,
              reps: 5,
              weight_kg: 60,
              created_at: '2024-06-02',
            },
          ]
    )
  ),
  // Manually controlled, keyed by call order: 1st call = run A, 2nd = run B.
  getInventorySnapshot: jest.fn(() => nextDeferred(inventoryDeferreds)),
  getLoggedExercises: jest.fn(() => nextDeferred(exercisesDeferreds)),
}));

import AnalyticsDashboardScreen from '../AnalyticsDashboardScreen';

const flush = () => act(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});

describe('AnalyticsDashboardScreen — cancellation guard (#312)', () => {
  beforeEach(() => {
    latestFocusEffect = null;
    inventoryDeferreds.length = 0;
    exercisesDeferreds.length = 0;
  });

  it('applies only the newer run\'s values when an older run resolves later, across all four setter boundaries', async () => {
    const utils = render(<AnalyticsDashboardScreen />);
    const { getByText, queryByText, getByLabelText, UNSAFE_getByType } = utils;

    // Simulate the screen gaining focus for the first time: run A starts.
    expect(latestFocusEffect).not.toBeNull();
    act(() => {
      latestFocusEffect!();
    });
    await flush();

    // Run A is now parked awaiting getInventorySnapshot()/getLoggedExercises()
    // (1st call each). Start run B via pull-to-refresh before A resolves.
    expect(inventoryDeferreds.length).toBe(1);
    expect(exercisesDeferreds.length).toBe(1);

    const refreshControl = UNSAFE_getByType(RefreshControl);
    act(() => {
      refreshControl.props.onRefresh();
    });
    await flush();

    // Run B has made its own 2nd calls and is parked too.
    expect(inventoryDeferreds.length).toBe(2);
    expect(exercisesDeferreds.length).toBe(2);

    // Resolve the NEWER run (B) first.
    await act(async () => {
      inventoryDeferreds[1].resolve({
        recipesInStock: 2,
        totalPortions: 9,
        items: [],
      });
      exercisesDeferreds[1].resolve(['bench']);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await flush();

    // Resolve the OLDER run (A) second — it must not overwrite B's state.
    await act(async () => {
      inventoryDeferreds[0].resolve({
        recipesInStock: 1,
        totalPortions: 3,
        items: [],
      });
      exercisesDeferreds[0].resolve(['squat']);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await flush();
    await flush();

    // ── Boundary: setLoggedExercises / lifting pills ────────────────────────
    // B's exercise ("bench") must be shown; A's ("squat") must not.
    expect(getByLabelText('View progression for bench')).toBeTruthy();
    expect(() => getByLabelText('View progression for squat')).toThrow();

    // ── Boundary: conditional getWorkoutHistory → setLiftHistoryByExercise ──
    // B's workout history (60 kg) must be reflected, not A's (100 kg).
    expect(getByText('Max 60.0 kg')).toBeTruthy();
    expect(queryByText('Max 100.0 kg')).toBeNull();

    // ── Boundary: big Promise.all → setInventorySnapshot ────────────────────
    // B's inventory snapshot (2 recipes / 9 portions) must be shown.
    expect(getByText('2')).toBeTruthy();
    expect(getByText('9')).toBeTruthy();
    expect(queryByText('3')).toBeNull();

    // ── loading must be false only via the newest run's `finally` ──────────
    expect(UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });

  it('calls no setter for a load that resolves after unmount', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const utils = render(<AnalyticsDashboardScreen />);

    act(() => {
      latestFocusEffect!();
    });
    await flush();

    expect(inventoryDeferreds.length).toBe(1);
    expect(exercisesDeferreds.length).toBe(1);

    utils.unmount();

    // Resolve the in-flight run after unmount — must not throw or warn.
    await act(async () => {
      inventoryDeferreds[0].resolve({ recipesInStock: 1, totalPortions: 3, items: [] });
      exercisesDeferreds[0].resolve(['squat']);
      await new Promise((resolve) => setImmediate(resolve));
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('applies a new load after blur → re-focus (screen keeps working after navigating away and back)', async () => {
    const utils = render(<AnalyticsDashboardScreen />);
    const { getByLabelText } = utils;

    // Focus: run A starts.
    let cleanupA: void | (() => void);
    act(() => {
      cleanupA = latestFocusEffect!();
    });
    await flush();
    expect(exercisesDeferreds.length).toBe(1);

    // Blur before run A resolves.
    act(() => {
      if (typeof cleanupA === 'function') cleanupA();
    });

    // Run A resolves after blur — must be ignored.
    await act(async () => {
      inventoryDeferreds[0].resolve({ recipesInStock: 1, totalPortions: 3, items: [] });
      exercisesDeferreds[0].resolve(['squat']);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await flush();

    // Re-focus: a fresh run (C) starts and must still apply its results.
    act(() => {
      latestFocusEffect!();
    });
    await flush();
    expect(exercisesDeferreds.length).toBe(2);

    await act(async () => {
      inventoryDeferreds[1].resolve({ recipesInStock: 4, totalPortions: 12, items: [] });
      exercisesDeferreds[1].resolve(['bench']);
      await new Promise((resolve) => setImmediate(resolve));
    });
    await flush();
    await flush();

    expect(getByLabelText('View progression for bench')).toBeTruthy();
  });
});
