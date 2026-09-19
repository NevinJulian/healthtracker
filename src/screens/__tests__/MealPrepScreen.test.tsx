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

jest.mock('@react-navigation/native', () => ({
  // MealPrepScreen's load-on-focus effect only needs to run once on mount
  // for these tests, so the focus effect is modeled as a plain mount effect.
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getMealInventory: jest.fn().mockResolvedValue([]),
  getWeeklyMealPlan: jest.fn().mockResolvedValue([]),
  logCookedMeal: jest.fn().mockResolvedValue(undefined),
  assignMealToPlan: jest.fn().mockResolvedValue(undefined),
  toggleMealConsumed: jest.fn().mockResolvedValue(undefined),
  getRecipes: jest.fn().mockResolvedValue([]),
  toISODate: jest.fn(() => '2026-09-19'),
  resetCookEmptyNotified: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notifications', () => ({
  checkAndNotifyEmptyInventory: jest.fn().mockResolvedValue(undefined),
}));

import MealPrepScreen from '../MealPrepScreen';
import {
  getRecipes,
  getMealInventory,
  getWeeklyMealPlan,
  logCookedMeal,
  resetCookEmptyNotified,
  Recipe,
} from '../../db/database';

const mockGetRecipes = jest.mocked(getRecipes);
const mockGetMealInventory = jest.mocked(getMealInventory);
const mockGetWeeklyMealPlan = jest.mocked(getWeeklyMealPlan);
const mockLogCookedMeal = jest.mocked(logCookedMeal);
const mockResetCookEmptyNotified = jest.mocked(resetCookEmptyNotified);

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Chicken Bowl',
    category: 'lunch',
    calories: 450,
    protein: 35,
    carbs: 40,
    fat: 12,
    prepTimeMinutes: 20,
    defaultServings: 2,
    ingredients: [],
    instructions: '',
    freezerTips: '',
    ...overrides,
  };
}

const mockRecipes: Recipe[] = [
  makeRecipe({ id: 'r1', title: 'Chicken Bowl' }),
  makeRecipe({ id: 'r2', title: 'Veggie Stew' }),
];

/** Flush pending microtasks (the mocked DB promises resolving on mount). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Render the screen, flush its initial load, and open the Log Meal modal. */
async function renderWithModalOpen() {
  const utils = render(<MealPrepScreen />);
  await flushMicrotasks();

  fireEvent.press(utils.getByLabelText('My Inventory'));
  fireEvent.press(utils.getByLabelText('+ Log Cooked Meal'));

  return utils;
}

describe('MealPrepScreen', () => {
  it('is a valid React Component', () => {
    expect(typeof MealPrepScreen).toBe('function');
  });
});

describe('MealPrepScreen log meal modal (#324)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecipes.mockResolvedValue(mockRecipes);
    mockGetMealInventory.mockResolvedValue([]);
    mockGetWeeklyMealPlan.mockResolvedValue([]);
    mockLogCookedMeal.mockResolvedValue(undefined);
    mockResetCookEmptyNotified.mockResolvedValue(undefined);
  });

  it('disables Save with no recipe selected, even with the default portions', async () => {
    const { getByLabelText } = await renderWithModalOpen();

    const saveBtn = getByLabelText('Save');
    expect(saveBtn.props.accessibilityState.disabled).toBe(true);
  });

  it('disables Save once portions is cleared after selecting a recipe', async () => {
    const { getByText, getByLabelText } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '');

    const saveBtn = getByLabelText('Save');
    expect(saveBtn.props.accessibilityState.disabled).toBe(true);
    // Empty text shows no inline error — it just disables Save.
    expect(() => getByText('Enter 1–50 portions')).toThrow();
  });

  it('shows "Enter 1–50 portions" and disables Save for a non-integer value ("2,5")', async () => {
    const { getByText, getByLabelText } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '2,5');

    expect(getByText('Enter 1–50 portions')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the error and disables Save for out-of-range values (0 and 51)', async () => {
    const { getByText, getByLabelText, queryByText } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));

    fireEvent.changeText(getByLabelText('Portions cooked'), '0');
    expect(getByText('Enter 1–50 portions')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(getByLabelText('Portions cooked'), '51');
    expect(getByText('Enter 1–50 portions')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(true);

    // Sanity: the error only shows up while the text is actually invalid.
    fireEvent.changeText(getByLabelText('Portions cooked'), '12');
    expect(queryByText('Enter 1–50 portions')).toBeNull();
  });

  it('enables Save for a valid integer ("12") once a recipe is selected', async () => {
    const { getByText, getByLabelText, queryByText } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '12');

    expect(queryByText('Enter 1–50 portions')).toBeNull();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(false);
  });

  it('resets to portions "4" and no recipe selected on Cancel + reopen', async () => {
    const { getByText, getByLabelText, queryByLabelText, getByDisplayValue } =
      await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '6');

    fireEvent.press(getByLabelText('Cancel'));

    // Conditionally mounted — closed means it's gone from the tree.
    expect(queryByLabelText('Portions cooked')).toBeNull();

    fireEvent.press(getByLabelText('+ Log Cooked Meal'));

    expect(getByDisplayValue('4')).toBeTruthy();
    // No recipe selected on the fresh open — Save is disabled again.
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(true);
  });

  it('saves the parsed integer, closes the modal, and the next open is clean', async () => {
    const { getByText, getByLabelText, queryByLabelText, getByDisplayValue } =
      await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '6');

    await act(async () => {
      fireEvent.press(getByLabelText('Save'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLogCookedMeal).toHaveBeenCalledTimes(1);
    expect(mockLogCookedMeal).toHaveBeenCalledWith('r1', 6);

    // Modal closed itself after a successful save.
    expect(queryByLabelText('Portions cooked')).toBeNull();

    fireEvent.press(getByLabelText('+ Log Cooked Meal'));

    expect(getByDisplayValue('4')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(true);
  });
});
