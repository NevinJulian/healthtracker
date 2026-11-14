import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getMealInventory: jest.fn(() => Promise.resolve([])),
  getWeeklyMealPlan: jest.fn(() => Promise.resolve([])),
  logCookedMeal: jest.fn(() => Promise.resolve(undefined)),
  assignMealToPlan: jest.fn(() => Promise.resolve(undefined)),
  toggleMealConsumed: jest.fn(() => Promise.resolve(undefined)),
  removeMealFromPlan: jest.fn(() => Promise.resolve(undefined)),
  getRecipes: jest.fn(() => Promise.resolve([])),
  getRecipesIncludingArchived: jest.fn(() => Promise.resolve([])),
  getOftenCookedRecipes: jest.fn(() => Promise.resolve([])),
  getFoodLogTotalsByDate: jest.fn(() => Promise.resolve({})),
  toISODate: jest.fn(() => '2026-09-19'),
  resetCookEmptyNotified: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock('../../services/notifications', () => ({
  checkAndNotifyEmptyInventory: jest.fn(() => Promise.resolve(undefined)),
}));

import MealPrepScreen from '../MealPrepScreen';
import {
  getFoodLogTotalsByDate,
  getRecipes,
  getRecipesIncludingArchived,
  getWeeklyMealPlan,
  type Recipe,
  type WeeklyMealPlanItem,
} from '../../db/database';

const mockTotals = jest.mocked(getFoodLogTotalsByDate);
const mockGetRecipes = jest.mocked(getRecipes);
const mockGetAllRecipes = jest.mocked(getRecipesIncludingArchived);
const mockGetPlan = jest.mocked(getWeeklyMealPlan);

const TODAY = '2026-09-19';
const TOMORROW = '2026-09-20';

const recipe: Recipe = {
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
};

const consumedLunch: WeeklyMealPlanItem = {
  id: 7,
  date: TODAY,
  meal_type: 'Lunch',
  recipe_id: 'r1',
  is_consumed: true,
  consumed_from_inventory_id: null,
};

async function renderScreen() {
  const utils = render(<MealPrepScreen />);
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
  return utils;
}

describe('MealPrepScreen quick add totals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecipes.mockResolvedValue([recipe]);
    mockGetAllRecipes.mockResolvedValue([recipe]);
    mockGetPlan.mockResolvedValue([]);
    mockTotals.mockResolvedValue({});
  });

  it('reads the entry totals for today through today plus six', async () => {
    await renderScreen();

    expect(mockTotals).toHaveBeenCalledWith(TODAY, '2026-09-25');
  });

  it('shows the pill and the consumed footer for a day with only an entry', async () => {
    mockTotals.mockResolvedValue({ [TODAY]: { calories: 250, protein: 10 } });

    const { getByText } = await renderScreen();

    expect(getByText('250 kcal')).toBeTruthy();
    expect(getByText('CONSUMED TODAY')).toBeTruthy();
    expect(getByText('250 kcal · 10g protein')).toBeTruthy();
  });

  it('adds the entries to the consumed meals of the same day', async () => {
    mockGetPlan.mockResolvedValue([consumedLunch]);
    mockTotals.mockResolvedValue({ [TODAY]: { calories: 250, protein: 10 } });

    const { getByText } = await renderScreen();

    expect(getByText('700 kcal')).toBeTruthy();
    expect(getByText('700 kcal · 45g protein')).toBeTruthy();
  });

  it('puts an entry on its own day card only', async () => {
    mockTotals.mockResolvedValue({ [TOMORROW]: { calories: 120, protein: 3 } });

    const { getAllByText, getByText } = await renderScreen();

    expect(getAllByText('120 kcal')).toHaveLength(1);
    expect(getByText('120 kcal · 3g protein')).toBeTruthy();
  });

  it('rounds fractional totals', async () => {
    mockTotals.mockResolvedValue({ [TODAY]: { calories: 250.4, protein: 9.6 } });

    const { getByText } = await renderScreen();

    expect(getByText('250 kcal')).toBeTruthy();
    expect(getByText('250 kcal · 10g protein')).toBeTruthy();
  });

  it('shows neither pill nor footer for a day with no consumed meal and no entry', async () => {
    mockGetPlan.mockResolvedValue([{ ...consumedLunch, is_consumed: false }]);

    const { queryByText } = await renderScreen();

    expect(queryByText('CONSUMED TODAY')).toBeNull();
    expect(queryByText(/kcal$/)).toBeNull();
  });

  it('shows the load error view when reading the totals fails', async () => {
    mockTotals.mockRejectedValue(new Error('db down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getAllByLabelText } = await renderScreen();

    expect(getAllByLabelText('Retry').length).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });
});
