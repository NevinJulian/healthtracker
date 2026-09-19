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
//
// MealPrepScreen.test.tsx's own `@react-navigation/native` mock deliberately
// models `useFocusEffect` as a plain mount-once `useEffect` — fine for that
// file's assertions, which never need a second focus. This file exists to
// drive multiple focus/blur cycles through MealPrepScreen's load-on-focus
// effect (#329: spinner gating, parallel queries, overlapping-load guard),
// so it needs a separate mock, in a separate file, that captures the latest
// `useFocusEffect` callback (and, once invoked, its cleanup) in module
// variables the tests can re-invoke directly to simulate a re-focus or a
// blur — the same harness shape as
// SettingsScreen.profileRehydration.test.tsx (#323).
//
// These captured-callback variables are referenced inside the jest.mock
// factory below, which babel-plugin-jest-hoist hoists above this file's
// imports — the "must be mock-prefixed" rule is what allows that reference
// to be considered in-scope.
let mockFocusCallback: (() => void | (() => void)) | null = null;
let mockFocusCleanup: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
  },
}));

jest.mock('../../db/database', () => ({
  getMealInventory: jest.fn(() => Promise.resolve([])),
  getWeeklyMealPlan: jest.fn(() => Promise.resolve([])),
  logCookedMeal: jest.fn(() => Promise.resolve(undefined)),
  assignMealToPlan: jest.fn(() => Promise.resolve(undefined)),
  toggleMealConsumed: jest.fn(() => Promise.resolve(undefined)),
  getRecipes: jest.fn(() => Promise.resolve([])),
  toISODate: jest.fn(() => '2026-09-19'),
  resetCookEmptyNotified: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock('../../services/notifications', () => ({
  checkAndNotifyEmptyInventory: jest.fn(() => Promise.resolve(undefined)),
}));

import MealPrepScreen from '../MealPrepScreen';
import {
  getMealInventory,
  getWeeklyMealPlan,
  getRecipes,
  MealInventoryWithRecipe,
  WeeklyMealPlanItem,
  Recipe,
} from '../../db/database';

const mockGetMealInventory = jest.mocked(getMealInventory);
const mockGetWeeklyMealPlan = jest.mocked(getWeeklyMealPlan);
const mockGetRecipes = jest.mocked(getRecipes);

/** A promise plus its externally-callable resolve, for controlling exactly
 *  when a mocked DB call settles (needed to build overlapping loads). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeInventoryItem(overrides: Partial<{ id: number; title: string }> = {}): MealInventoryWithRecipe {
  const id = overrides.id ?? 1;
  const title = overrides.title ?? `Item ${id}`;
  return {
    id,
    recipe_id: `r${id}`,
    portions_available: 2,
    date_cooked: '2026-09-18',
    recipe: {
      id: `r${id}`,
      title,
      category: 'lunch',
      calories: 400,
      protein: 30,
      carbs: 40,
      fat: 10,
      prepTimeMinutes: 15,
      defaultServings: 2,
      ingredients: [],
      instructions: '',
      freezerTips: '',
    } as Recipe,
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

/** Simulates react-navigation focusing the screen: invokes the latest
 *  captured `useFocusEffect` callback and captures whatever cleanup it
 *  returns, for a later `triggerBlur()`. Does NOT run any outgoing
 *  cleanup first — that is `triggerBlur()`'s job, kept separate so tests
 *  can trigger two overlapping loads (no blur in between) as well as a
 *  genuine blur-then-refocus cycle. */
async function triggerFocus() {
  await act(async () => {
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
  });
  await flushMicrotasks();
}

/** Simulates react-navigation blurring the screen: runs the focus effect's
 *  cleanup (which bumps runIdRef, per #329 / the #312 pattern). */
async function triggerBlur() {
  await act(async () => {
    mockFocusCleanup?.();
  });
}

describe('MealPrepScreen focus/load behaviour (#329)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockFocusCleanup = null;
    mockGetMealInventory.mockResolvedValue([]);
    mockGetWeeklyMealPlan.mockResolvedValue([]);
    mockGetRecipes.mockResolvedValue([]);
  });

  // Guard: may pass on both the pre-fix and post-fix code — it documents
  // that the very first load is still expected to show the spinner.
  it('shows the loading state on the very first load', async () => {
    const invD = deferred<MealInventoryWithRecipe[]>();
    mockGetMealInventory.mockReturnValue(invD.promise);

    const { getByText, queryByText } = render(<MealPrepScreen />);
    await act(async () => {
      mockFocusCallback?.();
    });

    expect(getByText('Loading meals…')).toBeTruthy();

    await act(async () => {
      invD.resolve([]);
    });
    await flushMicrotasks();

    expect(queryByText('Loading meals…')).toBeNull();
  });

  // Must fail on 0d44ecf: pre-fix `loadData` calls setLoading(true) on
  // every single call, so a second focus-triggered load blanks the screen
  // back to "Loading meals…" even though content is already showing.
  it('does not show the loading state again on a re-focus while content is already displayed', async () => {
    const { queryByText } = render(<MealPrepScreen />);
    await triggerFocus();

    // Leave a second, focus-triggered load in flight.
    const invD = deferred<MealInventoryWithRecipe[]>();
    mockGetMealInventory.mockReturnValue(invD.promise);

    await act(async () => {
      mockFocusCallback?.();
    });

    expect(queryByText('Loading meals…')).toBeNull();

    // Clean up the still-pending promise so it doesn't leak into another test.
    await act(async () => {
      invD.resolve([]);
    });
    await flushMicrotasks();
  });

  // Must fail on 0d44ecf: pre-fix `loadData` awaits getMealInventory, then
  // getWeeklyMealPlan, then getRecipes sequentially — only the first call
  // has fired by the time this assertion runs.
  it('issues all three meal-prep queries before any of them resolves', async () => {
    const invD = deferred<MealInventoryWithRecipe[]>();
    const planD = deferred<WeeklyMealPlanItem[]>();
    const recipesD = deferred<Recipe[]>();
    mockGetMealInventory.mockReturnValue(invD.promise);
    mockGetWeeklyMealPlan.mockReturnValue(planD.promise);
    mockGetRecipes.mockReturnValue(recipesD.promise);

    render(<MealPrepScreen />);
    await act(async () => {
      mockFocusCallback?.();
    });

    expect(mockGetMealInventory).toHaveBeenCalledTimes(1);
    expect(mockGetWeeklyMealPlan).toHaveBeenCalledTimes(1);
    expect(mockGetRecipes).toHaveBeenCalledTimes(1);

    // Clean up the still-pending promises.
    await act(async () => {
      invD.resolve([]);
      planD.resolve([]);
      recipesD.resolve([]);
    });
    await flushMicrotasks();
  });

  // Must fail on 0d44ecf: pre-fix `loadData` has no run-currency guard, so
  // whichever call resolves LAST wins the setState race — here that would
  // be the earlier-issued (stale) load, clobbering the later one.
  it('applies only the later-issued load\'s data when the earlier one resolves last', async () => {
    const utils = render(<MealPrepScreen />);

    const olderD = deferred<MealInventoryWithRecipe[]>();
    const newerD = deferred<MealInventoryWithRecipe[]>();
    mockGetMealInventory
      .mockReturnValueOnce(olderD.promise)
      .mockReturnValueOnce(newerD.promise);

    // First (older) load starts and is left in flight...
    await act(async () => {
      mockFocusCallback?.();
    });
    // ...then a second (later-issued) load starts before the first resolves.
    await act(async () => {
      mockFocusCallback?.();
    });

    // The later-issued load resolves first...
    await act(async () => {
      newerD.resolve([makeInventoryItem({ id: 2, title: 'Newer Item' })]);
    });
    await flushMicrotasks();
    // ...and the older, earlier-issued one resolves after it.
    await act(async () => {
      olderD.resolve([makeInventoryItem({ id: 1, title: 'Older Item' })]);
    });
    await flushMicrotasks();

    fireEvent.press(utils.getByLabelText('My Inventory'));

    expect(utils.queryByText('Newer Item')).toBeTruthy();
    expect(utils.queryByText('Older Item')).toBeNull();
  });

  // Guard: may pass on both the pre-fix and post-fix code from a black-box
  // view (no overlap is involved), but it documents the #312 lesson —
  // the focus effect's cleanup fires on blur, and a fresh load issued on
  // the subsequent re-focus must still land, not be silently dropped by
  // whatever guard the cleanup drives.
  it('applies the new load\'s results after a blur and re-focus', async () => {
    mockGetMealInventory.mockResolvedValue([makeInventoryItem({ id: 1, title: 'First Item' })]);
    const utils = render(<MealPrepScreen />);
    await triggerFocus();

    await triggerBlur();

    mockGetMealInventory.mockResolvedValue([makeInventoryItem({ id: 2, title: 'Second Item' })]);
    await triggerFocus();

    fireEvent.press(utils.getByLabelText('My Inventory'));

    expect(utils.queryByText('Second Item')).toBeTruthy();
    expect(utils.queryByText('First Item')).toBeNull();
  });
});
