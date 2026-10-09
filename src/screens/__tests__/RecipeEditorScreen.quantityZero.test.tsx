import React from 'react';
import { Alert } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, replace: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'r1' } }),
}));

jest.mock('../../db/database', () => ({
  createRecipe: jest.fn(),
  updateRecipe: jest.fn().mockResolvedValue(undefined),
  isSeededRecipe: jest.fn().mockResolvedValue(false),
  getRecipeCategories: jest.fn().mockResolvedValue([]),
  getRecipeById: jest.fn(),
}));

jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

import RecipeEditorScreen from '../RecipeEditorScreen';
import { lookupNutrition } from '../../api/openfoodfacts';
import { getRecipeById, updateRecipe } from '../../db/database';
import type { Recipe, RecipeIngredient } from '../../db/database';

const mockLookup = lookupNutrition as jest.Mock;
const mockUpdateRecipe = updateRecipe as jest.Mock;
const mockGetRecipeById = getRecipeById as jest.Mock;

function storedRecipe(ingredients: RecipeIngredient[]): Recipe {
  return {
    id: 'r1',
    title: 'Stored recipe',
    category: 'Quick Cook',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    prepTimeMinutes: 10,
    defaultServings: 2,
    ingredients,
    instructions: 'Stored steps',
    freezerTips: '',
  };
}

async function openAndSave(ingredients: RecipeIngredient[]) {
  mockGetRecipeById.mockResolvedValue(storedRecipe(ingredients));
  const utils = render(<RecipeEditorScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(700);
  });
  await act(async () => {
    fireEvent.press(utils.getByLabelText('Save Changes'));
    await jest.advanceTimersByTimeAsync(0);
  });
  return utils;
}

describe('RecipeEditorScreen quantity-0 ingredients', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue(null);
    mockUpdateRecipe.mockClear();
    mockGetRecipeById.mockReset();
    mockGoBack.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  it('keeps a quantity-0 ingredient when a stored recipe is saved', async () => {
    const ingredients = [
      { name: 'zzz salt', baseQuantity: 0, unit: 'pinch' },
      { name: 'zzz flour', baseQuantity: 200, unit: 'g' },
    ];

    await openAndSave(ingredients);

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
    expect(mockUpdateRecipe.mock.calls[0][0].ingredients).toEqual(ingredients);
  });

  it('refuses to save when every ingredient has quantity 0', async () => {
    await openAndSave([
      { name: 'zzz salt', baseQuantity: 0, unit: 'pinch' },
      { name: 'zzz pepper', baseQuantity: 0, unit: 'pinch' },
    ]);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      'Validation',
      'Please add at least one ingredient with a quantity.',
    );
    expect(mockUpdateRecipe).not.toHaveBeenCalled();
  });
});
