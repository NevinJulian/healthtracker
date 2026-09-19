/**
 * Regression test for issue #322 (chart half).
 *
 * Bug: `WeightTrendCard` (AnalyticsDashboardScreen.tsx) computes `minW`/`maxW`
 * from raw `history.map(w => w.weight)`, and `loadData`'s `weightDelta` is
 * last-minus-first of the same raw `weightData30`. `getWeightHistory()` only
 * filters `IS NOT NULL`, so a mis-typed entry (e.g. 9999 kg instead of 99.9)
 * dominates the chart's Min/Max/current-weight label and can skew the
 * weight-delta metric tile.
 *
 * The fix routes both the card and `loadData` through a new
 * `plausibleWeights()` helper (WEIGHT_MIN_KG..WEIGHT_MAX_KG, 20-400 kg
 * inclusive) and surfaces a small "N entries hidden — out of range" note
 * when points are excluded.
 *
 * Card-level tests render `WeightTrendCard` directly (now exported for
 * testing) with no DB involved. The full-screen test uses the DB-mocking
 * pattern from AnalyticsDashboardScreen.cancellationGuard.test.tsx (#312).
 */
import React from 'react';

// See AnalyticsDashboardScreen.liftingSelection.test.tsx (#308 / #360) for
// why this escape hatch is needed: the lockfile pins `react` at 19.1.0 while
// `react-test-renderer` resolved to 19.2.5, and RNTL's module-load side
// effect throws on that mismatch unless this env var is set first.
process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, act } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

// ─── Mock @react-navigation/native's useFocusEffect (needed for the
// full-screen describe block below; harmless for the card-only tests) ──────
let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

// ─── Mock ../../db/database ─────────────────────────────────────────────────
// getWeightHistory(30) and getWeightHistory(90) both return the same series
// here: an implausible 9999 kg row at the FRONT (so a naive first-vs-last
// delta is corrupted) plus two plausible rows.
const mockWeightRows = [
  { date: '2024-06-01', weight: 9999 },
  { date: '2024-06-05', weight: 70 },
  { date: '2024-06-10', weight: 75 },
];

jest.mock('../../db/database', () => ({
  toISODate: jest.fn(() => '2024-06-15'),
  getRollingWindow: jest.fn().mockResolvedValue([]),
  // loadData now sources `logs` from getDailyLogsBetween instead of
  // getRollingWindow (#300 deferred step); this suite only exercises the
  // weight-delta path (getWeightHistory), so an empty resolved array is
  // enough to keep loadData from throwing.
  getDailyLogsBetween: jest.fn().mockResolvedValue([]),
  // Lazily reads mockWeightRows (evaluated at call time, not at factory-
  // definition time) — the hoisted import of AnalyticsDashboardScreen
  // otherwise requires this module before the module-scope `const
  // mockWeightRows` below has run.
  getWeightHistory: jest.fn(() => Promise.resolve(mockWeightRows)),
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
  getWaterHistory: jest.fn().mockResolvedValue([]),
  getBodyMeasurements: jest.fn().mockResolvedValue([]),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  getLoggedExercises: jest.fn().mockResolvedValue([]),
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
}));

import AnalyticsDashboardScreen, { WeightTrendCard } from '../AnalyticsDashboardScreen';

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

// ─── WeightTrendCard (card-level, no DB) ────────────────────────────────────

describe('WeightTrendCard — implausible weight resilience (#322)', () => {
  it('excludes a 9999 kg outlier from Min/Max/current and shows the hidden-count note', () => {
    const history: { date: string; weight: number }[] = [
      { date: '2024-01-01', weight: 70 },
      { date: '2024-01-02', weight: 9999 },
    ];
    const { getByText, queryByText } = render(
      <WeightTrendCard history30={history} history90={history} />
    );

    // Current-weight label and Min/Max must reflect the valid point (70),
    // not the 9999 kg outlier.
    expect(getByText('70.0 kg')).toBeTruthy();
    expect(getByText('Min 70.0 kg')).toBeTruthy();
    expect(getByText('Max 70.0 kg')).toBeTruthy();
    expect(queryByText(/9999/)).toBeNull();

    expect(getByText('1 entry hidden — out of range')).toBeTruthy();
  });

  it('shows no hidden-count note when nothing is excluded', () => {
    const history: { date: string; weight: number }[] = [
      { date: '2024-01-01', weight: 70 },
      { date: '2024-01-02', weight: 72 },
    ];
    const { queryByText } = render(
      <WeightTrendCard history30={history} history90={history} />
    );
    expect(queryByText(/hidden/)).toBeNull();
  });

  it('pluralises the hidden-count note for more than one excluded point', () => {
    const history: { date: string; weight: number }[] = [
      { date: '2024-01-01', weight: 9999 },
      { date: '2024-01-02', weight: 70 },
      { date: '2024-01-03', weight: 5 },
    ];
    const { getByText } = render(
      <WeightTrendCard history30={history} history90={history} />
    );
    expect(getByText('2 entries hidden — out of range')).toBeTruthy();
  });

  it('falls back to the empty state (not NaN/Infinity from Math.min over []) when every point is implausible, and still shows the hidden count', () => {
    const history: { date: string; weight: number }[] = [
      { date: '2024-01-01', weight: 9999 },
      { date: '2024-01-02', weight: 1 },
    ];
    const { getByText, queryByText } = render(
      <WeightTrendCard history30={history} history90={history} />
    );
    expect(getByText('No data for this period.')).toBeTruthy();
    expect(getByText('2 entries hidden — out of range')).toBeTruthy();
    expect(queryByText(/NaN/)).toBeNull();
    expect(queryByText(/Infinity/)).toBeNull();
  });
});

// ─── Full-screen render ──────────────────────────────────────────────────────

describe('AnalyticsDashboardScreen — weight delta ignores implausible points (#322)', () => {
  beforeEach(() => {
    latestFocusEffect = null;
  });

  it('the weight-delta metric tile is computed from valid points only', async () => {
    const { getByText, queryByText } = render(<AnalyticsDashboardScreen />);

    expect(latestFocusEffect).not.toBeNull();
    act(() => {
      latestFocusEffect!();
    });
    await flush();
    await flush();

    // mockWeightRows (used for both the 30- and 90-day window) is
    // [9999, 70, 75]. A naive last-minus-first delta over the raw array
    // would be 75 - 9999 = -9924.0. Filtered through plausibleWeights, the
    // valid points are [70, 75], so the delta must be +5.0.
    expect(getByText('+5.0')).toBeTruthy();
    expect(queryByText('-9924.0')).toBeNull();
  });
});
