import React from 'react';
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
  copyMealToDates: jest.fn().mockResolvedValue({ copied: 0, skipped: 0 }),
  copyDayToDate: jest.fn().mockResolvedValue({ copied: 0, skipped: 0 }),
  getRecipes: jest.fn().mockResolvedValue([]),
  getRecipesIncludingArchived: jest.fn().mockResolvedValue([]),
  getOftenCookedRecipes: jest.fn().mockResolvedValue([]),
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
  getOftenCookedRecipes,
  logCookedMeal,
  Recipe,
} from '../../db/database';

const mockGetRecipes = jest.mocked(getRecipes);
const mockGetRecipesIncludingArchived = jest.mocked(getRecipesIncludingArchived);
const mockGetOftenCookedRecipes = jest.mocked(getOftenCookedRecipes);
const mockLogCookedMeal = jest.mocked(logCookedMeal);

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

const ALL = [makeRecipe('r1', 'Chicken Bowl'), makeRecipe('r2', 'Veggie Stew'), makeRecipe('r3', 'Oat Bowl')];

function often(recipe_id: string, title: string) {
  return { recipe_id, title, cookEvents: 3, score: 3 };
}

async function openPicker() {
  const utils = render(<MealPrepScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.press(utils.getByLabelText('My Inventory'));
  fireEvent.press(utils.getByLabelText('+ Log Cooked Meal'));
  return utils;
}

const LISTED = /^(Often cooked|All recipes|Chicken Bowl|Veggie Stew|Oat Bowl)$/;

describe('MealPrepScreen often cooked picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecipes.mockResolvedValue(ALL);
    mockGetRecipesIncludingArchived.mockResolvedValue(ALL);
    mockGetOftenCookedRecipes.mockResolvedValue([]);
    mockLogCookedMeal.mockResolvedValue(undefined);
  });

  it('shows the often-cooked recipes first, each title once, then the rest under All recipes', async () => {
    mockGetOftenCookedRecipes.mockResolvedValue([often('r2', 'Veggie Stew'), often('r1', 'Chicken Bowl')]);

    const { getAllByText } = await openPicker();

    expect(getAllByText(LISTED).map((n) => n.props.children)).toEqual([
      'Often cooked',
      'Veggie Stew',
      'Chicken Bowl',
      'All recipes',
      'Oat Bowl',
    ]);
  });

  it('logs the recipe chosen from the often-cooked section', async () => {
    mockGetOftenCookedRecipes.mockResolvedValue([often('r2', 'Veggie Stew')]);

    const { getByText, getByLabelText } = await openPicker();
    fireEvent.press(getByText('Veggie Stew'));
    await act(async () => {
      fireEvent.press(getByLabelText('Save'));
    });

    expect(mockLogCookedMeal).toHaveBeenCalledWith('r2', 4);
  });

  it('shows no headers when nothing was cooked yet', async () => {
    const { getAllByText } = await openPicker();

    expect(getAllByText(LISTED).map((n) => n.props.children)).toEqual([
      'Chicken Bowl',
      'Veggie Stew',
      'Oat Bowl',
    ]);
  });

  it('leaves out an often-cooked recipe that is no longer in the library', async () => {
    mockGetOftenCookedRecipes.mockResolvedValue([often('gone', 'Deleted Dish'), often('r1', 'Chicken Bowl')]);

    const { getAllByText, queryByText } = await openPicker();

    expect(queryByText('Deleted Dish')).toBeNull();
    expect(getAllByText(LISTED).map((n) => n.props.children)).toEqual([
      'Often cooked',
      'Chicken Bowl',
      'All recipes',
      'Veggie Stew',
      'Oat Bowl',
    ]);
  });

  it('still loads and shows the full list when the often-cooked read fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetOftenCookedRecipes.mockRejectedValue(new Error('cook_log unavailable'));

    const { getAllByText, queryByText } = await openPicker();

    expect(queryByText("Couldn't load your meals")).toBeNull();
    expect(getAllByText(LISTED).map((n) => n.props.children)).toEqual([
      'Chicken Bowl',
      'Veggie Stew',
      'Oat Bowl',
    ]);
    warnSpy.mockRestore();
  });
});
