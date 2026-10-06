import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

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
  getRecipesIncludingArchived: jest.fn().mockResolvedValue([]),
  toISODate: jest.fn(() => '2026-09-19'),
  resetCookEmptyNotified: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notifications', () => ({
  checkAndNotifyEmptyInventory: jest.fn().mockResolvedValue(undefined),
}));

import MealPrepScreen from '../MealPrepScreen';
import {
  getRecipes,
  getRecipesIncludingArchived,
  getMealInventory,
  getWeeklyMealPlan,
  logCookedMeal,
  assignMealToPlan,
  toggleMealConsumed,
  resetCookEmptyNotified,
  Recipe,
  MealInventoryWithRecipe,
  WeeklyMealPlanItem,
} from '../../db/database';
import { checkAndNotifyEmptyInventory } from '../../services/notifications';

const mockGetRecipes = jest.mocked(getRecipes);
const mockGetRecipesIncludingArchived = jest.mocked(getRecipesIncludingArchived);
const mockGetMealInventory = jest.mocked(getMealInventory);
const mockGetWeeklyMealPlan = jest.mocked(getWeeklyMealPlan);
const mockLogCookedMeal = jest.mocked(logCookedMeal);
const mockResetCookEmptyNotified = jest.mocked(resetCookEmptyNotified);
const mockAssignMealToPlan = jest.mocked(assignMealToPlan);
const mockToggleMealConsumed = jest.mocked(toggleMealConsumed);
const mockCheckAndNotifyEmptyInventory = jest.mocked(checkAndNotifyEmptyInventory);

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
    mockGetRecipesIncludingArchived.mockResolvedValue(mockRecipes);
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

/** Press a control inside act and let the resulting promise chain settle. */
async function pressAndFlush(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

describe('MealPrepScreen write failure feedback', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetRecipes.mockResolvedValue(mockRecipes);
    mockGetRecipesIncludingArchived.mockResolvedValue(mockRecipes);
    mockGetMealInventory.mockResolvedValue([]);
    mockGetWeeklyMealPlan.mockResolvedValue([]);
    mockLogCookedMeal.mockResolvedValue(undefined);
    mockAssignMealToPlan.mockResolvedValue(undefined);
    mockToggleMealConsumed.mockResolvedValue(undefined);
    mockResetCookEmptyNotified.mockResolvedValue(undefined);
    mockCheckAndNotifyEmptyInventory.mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('alerts once and keeps the modal and its inputs when logCookedMeal rejects', async () => {
    mockLogCookedMeal.mockRejectedValue(new Error('x'));
    const { getByText, getByLabelText, getByDisplayValue } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    fireEvent.changeText(getByLabelText('Portions cooked'), '6');
    await pressAndFlush(getByLabelText('Save'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(getByText('Log Cooked Meal')).toBeTruthy();
    expect(getByDisplayValue('6')).toBeTruthy();
    expect(getByLabelText('Save').props.accessibilityState.disabled).toBe(false);

    await pressAndFlush(getByLabelText('Save'));

    expect(mockLogCookedMeal).toHaveBeenCalledTimes(2);
    expect(mockLogCookedMeal).toHaveBeenLastCalledWith('r1', 6);
  });

  const inventoryItem: MealInventoryWithRecipe = {
    id: 1,
    recipe_id: 'r1',
    portions_available: 3,
    date_cooked: '2026-09-18',
    recipe: mockRecipes[0],
  };

  const todaysLunch: WeeklyMealPlanItem = {
    id: 7,
    date: '2026-09-19',
    meal_type: 'Lunch',
    recipe_id: 'r1',
    is_consumed: false,
    consumed_from_inventory_id: null,
  };

  it('alerts and keeps the assign modal open when assignMealToPlan rejects', async () => {
    mockGetMealInventory.mockResolvedValue([inventoryItem]);
    mockAssignMealToPlan.mockRejectedValue(new Error('x'));
    const utils = render(<MealPrepScreen />);
    await flushMicrotasks();

    fireEvent.press(utils.getAllByLabelText('Assign recipe to Lunch')[0]);
    await pressAndFlush(utils.getByText('Chicken Bowl'));

    expect(mockAssignMealToPlan).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(utils.getByText('Assign from Inventory')).toBeTruthy();
  });

  it('alerts when toggleMealConsumed rejects', async () => {
    mockGetWeeklyMealPlan.mockResolvedValue([todaysLunch]);
    mockToggleMealConsumed.mockRejectedValue(new Error('x'));
    const utils = render(<MealPrepScreen />);
    await flushMicrotasks();
    mockGetWeeklyMealPlan.mockClear();

    await pressAndFlush(utils.getByLabelText('Mark Chicken Bowl consumed'));

    expect(mockToggleMealConsumed).toHaveBeenCalledWith(7, true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(mockCheckAndNotifyEmptyInventory).toHaveBeenCalledTimes(1);
    expect(mockGetWeeklyMealPlan).not.toHaveBeenCalled();
  });

  it('closes the log modal without alerting when resetCookEmptyNotified rejects after a saved log', async () => {
    mockResetCookEmptyNotified.mockRejectedValue(new Error('x'));
    const { getByText, getByLabelText, queryByLabelText } = await renderWithModalOpen();

    fireEvent.press(getByText('Chicken Bowl'));
    await pressAndFlush(getByLabelText('Save'));

    expect(mockLogCookedMeal).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(queryByLabelText('Portions cooked')).toBeNull();
  });

  it('still reloads without alerting when checkAndNotifyEmptyInventory rejects after a saved toggle', async () => {
    mockGetWeeklyMealPlan.mockResolvedValue([todaysLunch]);
    const utils = render(<MealPrepScreen />);
    await flushMicrotasks();
    mockCheckAndNotifyEmptyInventory.mockRejectedValue(new Error('x'));
    mockGetWeeklyMealPlan.mockClear();

    await pressAndFlush(utils.getByLabelText('Mark Chicken Bowl consumed'));

    expect(mockToggleMealConsumed).toHaveBeenCalledWith(7, true);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(mockGetWeeklyMealPlan).toHaveBeenCalledTimes(1);
  });
});

describe('MealPrepScreen planned meal of an archived recipe', () => {
  const archivedRecipe = makeRecipe({
    id: 'r-archived',
    title: 'Archived Curry',
    calories: 777,
    protein: 55,
  });
  const archivedLunch: WeeklyMealPlanItem = {
    id: 9,
    date: '2026-09-19',
    meal_type: 'Lunch',
    recipe_id: 'r-archived',
    is_consumed: true,
    consumed_from_inventory_id: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecipes.mockResolvedValue([]);
    mockGetRecipesIncludingArchived.mockResolvedValue([archivedRecipe]);
    mockGetMealInventory.mockResolvedValue([]);
    mockGetWeeklyMealPlan.mockResolvedValue([archivedLunch]);
  });

  it('shows the real title and counts its macros in the consumed total', async () => {
    const { getByText, getAllByText, queryByText } = render(<MealPrepScreen />);
    await flushMicrotasks();

    expect(getByText('Archived Curry')).toBeTruthy();
    expect(queryByText('Unknown Recipe')).toBeNull();
    expect(getByText('CONSUMED TODAY')).toBeTruthy();
    expect(getAllByText('777 kcal · 55g protein')).toHaveLength(2);
  });

  it('keeps the archived recipe out of the Log Cooked Meal list', async () => {
    mockGetRecipes.mockResolvedValue([mockRecipes[0]]);
    const { getByText, queryByText } = await renderWithModalOpen();

    expect(getByText('Chicken Bowl')).toBeTruthy();
    expect(queryByText('Archived Curry')).toBeNull();
  });
});

describe('MealPrepScreen first-load failure', () => {
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetRecipes.mockResolvedValue([]);
    mockGetRecipesIncludingArchived.mockResolvedValue([]);
    mockGetMealInventory.mockResolvedValue([]);
    mockGetWeeklyMealPlan.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('shows an error view with Retry and keeps the tab switcher when the first load rejects', async () => {
    mockGetMealInventory.mockRejectedValue(new Error('db down'));
    const { getByText, getByLabelText, queryByText } = render(<MealPrepScreen />);
    await flushMicrotasks();

    expect(getByText("Couldn't load your meals")).toBeTruthy();
    expect(getByText('Your data is safe. Try again.')).toBeTruthy();
    expect(getByLabelText('Retry')).toBeTruthy();
    expect(getByLabelText('Weekly Plan')).toBeTruthy();
    expect(getByLabelText('My Inventory')).toBeTruthy();
    expect(queryByText('Your inventory is empty')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['getWeeklyMealPlan', mockGetWeeklyMealPlan],
    ['getRecipes', mockGetRecipes],
    ['getRecipesIncludingArchived', mockGetRecipesIncludingArchived],
  ])('shows the error view when %s rejects', async (_name, mock) => {
    mock.mockRejectedValue(new Error('db down'));
    const { getByText } = render(<MealPrepScreen />);
    await flushMicrotasks();

    expect(getByText("Couldn't load your meals")).toBeTruthy();
  });

  it('Retry reloads and replaces the error view with the data', async () => {
    mockGetMealInventory.mockRejectedValueOnce(new Error('db down'));
    mockGetRecipesIncludingArchived.mockResolvedValue(mockRecipes);
    mockGetWeeklyMealPlan.mockResolvedValue([
      {
        id: 3,
        date: '2026-09-19',
        meal_type: 'Lunch',
        recipe_id: 'r1',
        is_consumed: false,
        consumed_from_inventory_id: null,
      },
    ]);
    const { getByText, getByLabelText, queryByText } = render(<MealPrepScreen />);
    await flushMicrotasks();
    expect(getByText("Couldn't load your meals")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText('Retry'));
    });
    await flushMicrotasks();

    expect(queryByText("Couldn't load your meals")).toBeNull();
    expect(getByText('Chicken Bowl')).toBeTruthy();
  });
});
