/**
 * Regression test for the #300 deferred step (analytics data-source switch).
 *
 * Bug: `loadData` in AnalyticsDashboardScreen sourced `logs` from
 * `getRollingWindow()`, which #300 bounded to [today-7, today+7]. Every
 * consumer of `logs` in `loadData` — `computeStats(7/30)`, the fasting
 * streak scan, `computeStreaks`, and the 30-day consistency grid — only
 * ever looks at dates <= today, so the 30-day stats/grid silently starved
 * on real devices: only the ~8 in-window days <= today had any row at all.
 *
 * The fix routes `loadData` through the date-bounded `getDailyLogsBetween`
 * (added by #300, not yet wired into any screen) instead.
 *
 * This test mocks `getRollingWindow` to return a 15-row window (today-7..
 * today+7) of INCOMPLETE logs, and `getDailyLogsBetween` to return a full
 * 30-row window (today-29..today) of COMPLETE logs. If `loadData` still
 * reads from `getRollingWindow`, the 30-day stats total is capped at the 8
 * in-window days that are <= today (none of them complete), so the
 * "Workouts" metric card's "of N days" subtitle reads "of 8 days", not
 * "of 30 days". Follows the full-screen DB-mocking pattern from
 * AnalyticsDashboardScreen.cancellationGuard.test.tsx (#312, #360).
 */
import React from 'react';

process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, act } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

import { addDays } from '../../utils/dates';

const TODAY = '2024-06-15';

// ─── Mock @react-navigation/native's useFocusEffect ────────────────────────
let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

// Function declarations are fully hoisted (unlike `const`), so referencing
// them from inside the jest.mock factory below never hits the TDZ that a
// module-scope `const` data array would (see
// AnalyticsDashboardScreen.weightResilience.test.tsx's note on
// `mockWeightRows` for the same concern with a lazily-read const). Both are
// "mock"-prefixed per Jest's out-of-scope-variable rule for factories.

/** getRollingWindow's real bound: today-7..today+7 (15 rows), all
 * incomplete — only the 8 rows <= today could ever count toward a stat. */
function mockBuildRollingWindowRows() {
  const rows = [];
  for (let i = -7; i <= 7; i++) {
    rows.push({
      date: addDays(TODAY, i),
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
    });
  }
  return rows;
}

/** getDailyLogsBetween's date-bounded result: the full 30-day window
 * (today-29..today), every day complete. */
function mockBuildDailyLogsBetweenRows() {
  const rows = [];
  for (let i = -29; i <= 0; i++) {
    rows.push({
      date: addDays(TODAY, i),
      walking_task: '',
      hammer_task: '',
      walk_completed: true,
      hammer_completed: true,
      fasting_completed: true,
      is_rest_day: false,
      is_meal_prep_day: false,
      exercises: [],
      body_weight: null,
      additional_workouts: [],
    });
  }
  return rows;
}

jest.mock('../../db/database', () => ({
  toISODate: jest.fn(() => '2024-06-15'),
  getRollingWindow: jest.fn(() => Promise.resolve(mockBuildRollingWindowRows())),
  getDailyLogsBetween: jest.fn((_from: string, _to: string) =>
    Promise.resolve(mockBuildDailyLogsBetweenRows())
  ),
  getWeightHistory: jest.fn(() => Promise.resolve([])),
  getStartDate: jest.fn(() => Promise.resolve('2020-01-01')),
  getConsumedMacrosByDay: jest.fn(() => Promise.resolve([])),
  getMealAdherence: jest.fn(() =>
    Promise.resolve({ planned: 0, consumed: 0, adherenceRatio: 0 })
  ),
  getMostEatenRecipes: jest.fn(() => Promise.resolve([])),
  getAverageConsumedMacros: jest.fn(() =>
    Promise.resolve({ calories: 0, protein: 0, carbs: 0, fat: 0, sampleSize: 0 })
  ),
  getMostCookedRecipes: jest.fn(() => Promise.resolve([])),
  getInventorySnapshot: jest.fn(() =>
    Promise.resolve({ recipesInStock: 0, totalPortions: 0, items: [] })
  ),
  getNutritionGoals: jest.fn(() => Promise.resolve({ calories: 1800, protein: 150 })),
  getWaterHistory: jest.fn(() => Promise.resolve([])),
  getBodyMeasurements: jest.fn(() => Promise.resolve([])),
  getHydrationGoal: jest.fn(() => Promise.resolve(2000)),
  getLoggedExercises: jest.fn(() => Promise.resolve([])),
  getWorkoutHistory: jest.fn(() => Promise.resolve([])),
}));

import AnalyticsDashboardScreen from '../AnalyticsDashboardScreen';
import { getRollingWindow, getDailyLogsBetween } from '../../db/database';

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

describe('AnalyticsDashboardScreen — history source for 30-day analytics (#300)', () => {
  beforeEach(() => {
    latestFocusEffect = null;
    (getRollingWindow as jest.Mock).mockClear();
    (getDailyLogsBetween as jest.Mock).mockClear();
  });

  it('sources `logs` from getDailyLogsBetween (date-bounded), not getRollingWindow', async () => {
    const { getByText, queryByText } = render(<AnalyticsDashboardScreen />);

    expect(latestFocusEffect).not.toBeNull();
    act(() => {
      latestFocusEffect!();
    });
    await flush();
    await flush();

    // loadData must call the new date-bounded query, with bounds wide
    // enough to cover the 30-day stats/grid, and must not call
    // getRollingWindow() at all (that stays reserved for OverviewScreen).
    expect(getDailyLogsBetween).toHaveBeenCalledWith(addDays(TODAY, -90), TODAY);
    expect(getRollingWindow).not.toHaveBeenCalled();

    // The 30-day stats total must reflect all 30 days from
    // getDailyLogsBetween, not the ~8 in-window days getRollingWindow()
    // would have produced.
    expect(getByText('of 30 days')).toBeTruthy();
    expect(queryByText('of 8 days')).toBeNull();
  });
});
