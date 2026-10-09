import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
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
  removeMealFromPlan: jest.fn().mockResolvedValue(undefined),
  getRecipes: jest.fn().mockResolvedValue([]),
  getRecipesIncludingArchived: jest.fn().mockResolvedValue([]),
  copyMealToDates: jest.fn().mockResolvedValue({ copied: 0, skipped: 0 }),
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
  getWeeklyMealPlan,
  copyMealToDates,
  Recipe,
  WeeklyMealPlanItem,
} from '../../db/database';

const mockGetRecipes = jest.mocked(getRecipes);
const mockGetRecipesIncludingArchived = jest.mocked(getRecipesIncludingArchived);
const mockGetWeeklyMealPlan = jest.mocked(getWeeklyMealPlan);
const mockCopyMealToDates = jest.mocked(copyMealToDates);

const TODAY = '2026-09-19';

function makeRecipe(id: string, title: string): Recipe {
  return {
    id,
    title,
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
  };
}

function plan(id: number, date: string, meal_type: string, recipe_id: string): WeeklyMealPlanItem {
  return { id, date, meal_type, recipe_id, is_consumed: false, consumed_from_inventory_id: null };
}

function chooserLabel(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return new Date(2026, 8, 19 + offset).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
  const utils = render(<MealPrepScreen />);
  await flush();
  return utils;
}

describe('MealPrepScreen copy a meal', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetRecipes.mockResolvedValue([makeRecipe('r1', 'Chicken Bowl')]);
    mockGetRecipesIncludingArchived.mockResolvedValue([makeRecipe('r1', 'Chicken Bowl')]);
    mockGetWeeklyMealPlan.mockResolvedValue([plan(7, TODAY, 'Lunch', 'r1')]);
    mockCopyMealToDates.mockResolvedValue({ copied: 0, skipped: 0 });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('offers a copy button only on planned slots', async () => {
    const { getAllByLabelText, queryAllByLabelText } = await renderScreen();

    expect(getAllByLabelText('Copy Chicken Bowl to…')).toHaveLength(1);
    expect(queryAllByLabelText(/^Copy .* to…$/)).toHaveLength(1);
  });

  it('offers the six other visible days and never the source day', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));

    expect(queryByLabelText(chooserLabel(0))).toBeNull();
    for (let i = 1; i <= 6; i++) {
      expect(getByLabelText(chooserLabel(i))).toBeTruthy();
    }
  });

  it('disables Copy until a day is chosen', async () => {
    const { getByLabelText } = await renderScreen();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));
    expect(getByLabelText('Copy').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByLabelText(chooserLabel(1)));
    expect(getByLabelText('Copy').props.accessibilityState.disabled).toBe(false);
  });

  it('copies to the chosen days, reports the result and reloads the plan', async () => {
    mockCopyMealToDates.mockResolvedValue({ copied: 2, skipped: 0 });
    const { getByLabelText, queryByLabelText } = await renderScreen();
    mockGetWeeklyMealPlan.mockClear();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));
    fireEvent.press(getByLabelText(chooserLabel(1)));
    fireEvent.press(getByLabelText(chooserLabel(3)));
    await act(async () => {
      fireEvent.press(getByLabelText('Copy'));
    });
    await flush();

    expect(mockCopyMealToDates).toHaveBeenCalledTimes(1);
    expect(mockCopyMealToDates).toHaveBeenCalledWith(7, ['2026-09-20', '2026-09-22']);
    expect(alertSpy).toHaveBeenCalledWith('Copied', 'Copied 2 meals.');
    expect(mockGetWeeklyMealPlan).toHaveBeenCalled();
    expect(queryByLabelText(chooserLabel(1))).toBeNull();
  });

  it.each([
    [{ copied: 1, skipped: 0 }, 'Copied', 'Copied 1 meal.'],
    [{ copied: 2, skipped: 1 }, 'Copied', 'Copied 2 meals. Skipped 1 already planned.'],
    [{ copied: 0, skipped: 1 }, 'Nothing copied', 'Nothing copied: that slot is already planned.'],
    [{ copied: 0, skipped: 3 }, 'Nothing copied', 'Nothing copied: all 3 slots are already planned.'],
    [{ copied: 0, skipped: 0 }, 'Nothing copied', 'Nothing to copy.'],
  ])('shows the result %j', async (result, title, message) => {
    mockCopyMealToDates.mockResolvedValue(result);
    const { getByLabelText } = await renderScreen();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));
    fireEvent.press(getByLabelText(chooserLabel(1)));
    await act(async () => {
      fireEvent.press(getByLabelText('Copy'));
    });
    await flush();

    expect(alertSpy).toHaveBeenCalledWith(title, message);
  });

  it('shows the error alert and never the success text when the copy fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCopyMealToDates.mockRejectedValue(new Error('boom'));
    const { getByLabelText } = await renderScreen();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));
    fireEvent.press(getByLabelText(chooserLabel(1)));
    await act(async () => {
      fireEvent.press(getByLabelText('Copy'));
    });
    await flush();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to copy. Please try again.');
    errSpy.mockRestore();
  });

  it('copies once when Copy is pressed twice while the first copy runs', async () => {
    let resolveCopy: (v: { copied: number; skipped: number }) => void = () => {};
    mockCopyMealToDates.mockReturnValue(
      new Promise((resolve) => {
        resolveCopy = resolve;
      })
    );
    const { getByLabelText } = await renderScreen();

    fireEvent.press(getByLabelText('Copy Chicken Bowl to…'));
    fireEvent.press(getByLabelText(chooserLabel(1)));
    fireEvent.press(getByLabelText('Copy'));
    fireEvent.press(getByLabelText('Copy'));
    await flush();

    expect(mockCopyMealToDates).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCopy({ copied: 1, skipped: 0 });
    });
  });
});
