// @testing-library/react-native 13.3.3 refuses to import unless the
// installed react-test-renderer version matches its expected peer exactly.
// This repo currently has react@19.1.0 / react-test-renderer@19.2.5 (a
// pre-existing devDependency mismatch, out of this lane's scope to fix).
// Setting this env var before RNTL's own module body runs skips that check;
// RNTL's actual rendering works fine with this combination. It must be set
// before the (non-hoisted) `require` below, so it cannot be a hoisted
// `import`.
process.env.RNTL_SKIP_DEPS_CHECK = '1';

import React from 'react';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, fireEvent, act } = require('@testing-library/react-native');

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
  exercises: [],
  body_weight: null,
  additional_workouts: [],
};

// db mock list copied from DashboardScreen.test.tsx (#330). Lazy factories
// (`jest.fn(() => Promise.resolve(x))`, not `jest.fn().mockResolvedValue(x)`)
// so per-test `mockReturnValue`/`mockResolvedValueOnce` overrides below take
// effect cleanly after `jest.clearAllMocks()`.
jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  upsertAdditionalWorkouts: jest.fn(() => Promise.resolve(undefined)),
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
  deleteWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
}));

import DashboardScreen from '../DashboardScreen';
import {
  getLogByDate,
  syncRollingSchedule,
  getTodaysMealsWithRecipe,
  toggleMealConsumed,
  getWaterForDay,
  getHydrationGoal,
  getLatestMeasurements,
  getWorkoutSetsForDay,
  type MealPlanWithRecipe,
} from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockSyncRollingSchedule = jest.mocked(syncRollingSchedule);
const mockGetTodaysMealsWithRecipe = jest.mocked(getTodaysMealsWithRecipe);
const mockToggleMealConsumed = jest.mocked(toggleMealConsumed);
const mockGetWaterForDay = jest.mocked(getWaterForDay);
const mockGetHydrationGoal = jest.mocked(getHydrationGoal);
const mockGetLatestMeasurements = jest.mocked(getLatestMeasurements);
const mockGetWorkoutSetsForDay = jest.mocked(getWorkoutSetsForDay);

/** A promise plus its externally-callable resolve/reject, for controlling
 *  exactly when a mocked DB call settles (needed to build overlapping
 *  double-tap writes). Pattern copied from MealPrepScreen.focus.test.tsx (#329). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMeal(
  overrides: Partial<{ id: number; is_consumed: boolean; title: string }> = {}
): MealPlanWithRecipe {
  const id = overrides.id ?? 1;
  return {
    id,
    date: mockToday,
    meal_type: 'lunch',
    recipe_id: 'r1',
    is_consumed: overrides.is_consumed ?? false,
    consumed_from_inventory_id: null,
    recipe: {
      id: 'r1',
      title: overrides.title ?? 'Chicken Bowl',
      category: 'lunch',
      calories: 500,
      protein: 40,
      carbs: 50,
      fat: 10,
      prepTimeMinutes: 15,
      defaultServings: 2,
      ingredients: [],
      instructions: '',
      freezerTips: '',
    },
  };
}

/** Flush pending microtasks (the mocked DB promises resolving). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DashboardScreen meal toggle (#330)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockSyncRollingSchedule.mockResolvedValue(undefined);
    mockGetTodaysMealsWithRecipe.mockResolvedValue([makeMeal({ is_consumed: false })]);
    mockToggleMealConsumed.mockResolvedValue(undefined);
    mockGetWaterForDay.mockResolvedValue(0);
    mockGetHydrationGoal.mockResolvedValue(2000);
    mockGetLatestMeasurements.mockResolvedValue(null);
    mockGetWorkoutSetsForDay.mockResolvedValue([]);
  });

  it('success tick: does not re-sync or re-query, and calls toggleMealConsumed once with (planId, true)', async () => {
    const { getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    // Mount baseline: loadToday's sync + 6 read queries each ran once.
    expect(mockSyncRollingSchedule).toHaveBeenCalledTimes(1);
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);
    expect(mockGetTodaysMealsWithRecipe).toHaveBeenCalledTimes(1);
    expect(mockGetWaterForDay).toHaveBeenCalledTimes(1);
    expect(mockGetHydrationGoal).toHaveBeenCalledTimes(1);
    expect(mockGetLatestMeasurements).toHaveBeenCalledTimes(1);
    expect(mockGetWorkoutSetsForDay).toHaveBeenCalledTimes(1);

    const checkbox = getByLabelText('Mark Chicken Bowl consumed');
    await act(async () => {
      fireEvent.press(checkbox);
    });
    await flushMicrotasks();

    expect(mockToggleMealConsumed).toHaveBeenCalledTimes(1);
    expect(mockToggleMealConsumed).toHaveBeenCalledWith(1, true);

    // A successful write does nothing more: no extra sync, no extra reads.
    expect(mockSyncRollingSchedule).toHaveBeenCalledTimes(1);
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);
    expect(mockGetTodaysMealsWithRecipe).toHaveBeenCalledTimes(1);
    expect(mockGetWaterForDay).toHaveBeenCalledTimes(1);
    expect(mockGetHydrationGoal).toHaveBeenCalledTimes(1);
    expect(mockGetLatestMeasurements).toHaveBeenCalledTimes(1);
    expect(mockGetWorkoutSetsForDay).toHaveBeenCalledTimes(1);
  });

  it('renders the meal as consumed immediately, before the write resolves', async () => {
    const writeD = deferred<void>();
    mockToggleMealConsumed.mockReturnValue(writeD.promise);

    const { getByLabelText, queryByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    const checkbox = getByLabelText('Mark Chicken Bowl consumed');
    await act(async () => {
      fireEvent.press(checkbox);
    });

    // Still unresolved -- the write has not settled yet.
    expect(queryByLabelText('Mark Chicken Bowl consumed')).toBeNull();
    expect(getByLabelText('Mark Chicken Bowl not consumed')).toBeTruthy();

    // Clean up the still-pending promise so it doesn't leak into another test.
    await act(async () => {
      writeD.resolve(undefined);
    });
    await flushMicrotasks();
  });

  it('a rejected write triggers loadToday (sync + queries), and the row shows the reloaded value', async () => {
    const writeD = deferred<void>();
    mockToggleMealConsumed.mockReturnValue(writeD.promise);

    const { getByLabelText, queryByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    // The reload that follows the rejection returns DB truth: still NOT
    // consumed (as if the write had never happened).
    mockGetTodaysMealsWithRecipe.mockResolvedValue([makeMeal({ is_consumed: false })]);

    const checkbox = getByLabelText('Mark Chicken Bowl consumed');
    await act(async () => {
      fireEvent.press(checkbox);
    });
    expect(getByLabelText('Mark Chicken Bowl not consumed')).toBeTruthy(); // optimistic

    await act(async () => {
      writeD.reject(new Error('write failed'));
    });
    await flushMicrotasks();

    // Recovery reload ran: sync + all six queries fired a second time.
    expect(mockSyncRollingSchedule).toHaveBeenCalledTimes(2);
    expect(mockGetTodaysMealsWithRecipe).toHaveBeenCalledTimes(2);
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);
    expect(mockGetWaterForDay).toHaveBeenCalledTimes(2);
    expect(mockGetHydrationGoal).toHaveBeenCalledTimes(2);
    expect(mockGetLatestMeasurements).toHaveBeenCalledTimes(2);
    expect(mockGetWorkoutSetsForDay).toHaveBeenCalledTimes(2);

    // DB truth (not consumed) wins over the optimistic (consumed) guess.
    expect(queryByLabelText('Mark Chicken Bowl not consumed')).toBeNull();
    expect(getByLabelText('Mark Chicken Bowl consumed')).toBeTruthy();
  });

  it('double tap: two presses before either write resolves call toggleMealConsumed with (planId, true) then (planId, false), and the final UI shows not consumed', async () => {
    const write1 = deferred<void>();
    const write2 = deferred<void>();
    mockToggleMealConsumed
      .mockReturnValueOnce(write1.promise)
      .mockReturnValueOnce(write2.promise);

    const { getByLabelText, queryByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    const checkbox = getByLabelText('Mark Chicken Bowl consumed');

    // Two rapid taps, neither write settled yet. Reusing the same node
    // reference for both presses (rather than re-querying by label) means
    // `fireEvent.press` always reads whatever `onPress` prop is live on that
    // instance at press time, regardless of whether a render happened
    // between the two calls.
    await act(async () => {
      fireEvent.press(checkbox);
      fireEvent.press(checkbox);
    });

    expect(mockToggleMealConsumed).toHaveBeenCalledTimes(2);
    expect(mockToggleMealConsumed).toHaveBeenNthCalledWith(1, 1, true);
    expect(mockToggleMealConsumed).toHaveBeenNthCalledWith(2, 1, false);

    // Final UI already shows "not consumed" from the second (optimistic) tap.
    expect(queryByLabelText('Mark Chicken Bowl not consumed')).toBeNull();
    expect(getByLabelText('Mark Chicken Bowl consumed')).toBeTruthy();

    // Both writes now settle successfully; UI must still read "not consumed".
    await act(async () => {
      write1.resolve(undefined);
      write2.resolve(undefined);
    });
    await flushMicrotasks();

    expect(queryByLabelText('Mark Chicken Bowl not consumed')).toBeNull();
    expect(getByLabelText('Mark Chicken Bowl consumed')).toBeTruthy();
  });
});
