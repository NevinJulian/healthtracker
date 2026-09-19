/**
 * Regression test for issue #306 (missed acceptance criterion, round 1 of 3).
 *
 * Bug: `initDatabase()` always creates today's `daily_log` row (`water_ml`
 * defaults to 0), so `getWaterHistory(since7Days)` never actually returns an
 * empty array for a user who has never logged water — it returns at least
 * one row with `water_ml: 0`. The hydration card in
 * AnalyticsDashboardScreen.tsx gated its empty state on `days.length === 0`,
 * which is therefore dead code: a user with no logged water sees
 * "0 ml avg / day, 0%" instead of "No hydration data logged yet."
 *
 * Fix (this file does NOT change): the empty-state condition becomes
 * `days.length === 0 || days.every(d => d.water_ml === 0)`. getWaterHistory's
 * rows themselves are untouched — filtering out zero days there would change
 * the 7-day average's meaning for a user who legitimately drank 0 ml on some
 * (but not all) days.
 *
 * Uses the full-screen render + `../../db/database` mock pattern from
 * AnalyticsDashboardScreen.weightResilience.test.tsx (#322).
 *
 * Issue #306
 */
import React from 'react';

// See AnalyticsDashboardScreen.liftingSelection.test.tsx (#308 / #360) for why
// this escape hatch is needed: the lockfile pins `react` at 19.1.0 while
// `react-test-renderer` resolved to 19.2.5, and RNTL's module-load side
// effect throws on that mismatch unless this env var is set first.
process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, act } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

// ─── Mock @react-navigation/native's useFocusEffect ─────────────────────────
let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

// ─── Mock ../../db/database ─────────────────────────────────────────────────
// getWaterHistory's resolved value is swapped per-test via this mutable
// binding (read lazily by the jest.fn() implementation at call time, not at
// factory-definition time — matching mockWeightRows in
// AnalyticsDashboardScreen.weightResilience.test.tsx).
let mockWaterRows: { date: string; water_ml: number }[] = [];

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
  getInventorySnapshot: jest
    .fn()
    .mockResolvedValue({ recipesInStock: 0, totalPortions: 0, items: [] }),
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 1800, protein: 150 }),
  getWaterHistory: jest.fn(() => Promise.resolve(mockWaterRows)),
  getBodyMeasurements: jest.fn().mockResolvedValue([]),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  getLoggedExercises: jest.fn().mockResolvedValue([]),
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
}));

import AnalyticsDashboardScreen from '../AnalyticsDashboardScreen';

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

describe('AnalyticsDashboardScreen — hydration card empty state (#306)', () => {
  beforeEach(() => {
    latestFocusEffect = null;
  });

  it('renders the empty state when the only row is a zero-water day (no water ever logged)', async () => {
    mockWaterRows = [{ date: '2024-06-15', water_ml: 0 }];

    const { getByText, queryByText } = render(<AnalyticsDashboardScreen />);

    expect(latestFocusEffect).not.toBeNull();
    act(() => {
      latestFocusEffect!();
    });
    await flush();
    await flush();

    expect(getByText('No hydration data logged yet.')).toBeTruthy();
    expect(queryByText('ml avg / day')).toBeNull();
  });

  it('renders the average (not the empty state) when at least one day has logged water', async () => {
    mockWaterRows = [{ date: '2024-06-15', water_ml: 500 }];

    const { getByText, queryByText } = render(<AnalyticsDashboardScreen />);

    expect(latestFocusEffect).not.toBeNull();
    act(() => {
      latestFocusEffect!();
    });
    await flush();
    await flush();

    expect(queryByText('No hydration data logged yet.')).toBeNull();
    expect(getByText('500')).toBeTruthy();
    expect(getByText('ml avg / day')).toBeTruthy();
  });
});
