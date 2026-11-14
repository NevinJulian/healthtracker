import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
  useRoute: () => ({ params: { recipeId: 'r1' } }),
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../db/database', () => ({
  getRecipeById: jest.fn(),
  addRecipeToShoppingList: jest.fn().mockResolvedValue(undefined),
  deleteRecipe: jest.fn().mockResolvedValue(undefined),
  isSeededRecipe: jest.fn().mockReturnValue(false),
}));

import RecipeDetailScreen from '../RecipeDetailScreen';
import { getRecipeById, addRecipeToShoppingList, Recipe } from '../../db/database';

const recipe: Recipe = {
  id: 'r1',
  title: 'Test stew',
  category: 'Dinner',
  calories: 400,
  protein: 20,
  carbs: 30,
  fat: 10,
  prepTimeMinutes: 0,
  defaultServings: 1,
  ingredients: [
    { name: 'Salt', baseQuantity: 0, unit: 'g' },
    { name: 'Rice', baseQuantity: 200, unit: 'g' },
  ],
  instructions: '',
  freezerTips: '',
};

describe('RecipeDetailScreen name-only ingredients', () => {
  beforeEach(() => {
    jest.mocked(getRecipeById).mockResolvedValue(recipe);
    jest.mocked(addRecipeToShoppingList).mockClear();
  });

  it('shows a quantity-0 ingredient by name only, at 1 and 4 servings', async () => {
    const view = render(<RecipeDetailScreen />);
    await waitFor(() => expect(view.getByText('Salt')).toBeTruthy());

    expect(view.queryByText(/^0/)).toBeNull();
    expect(view.getByText('200 g')).toBeTruthy();

    fireEvent.press(view.getByLabelText('Increase servings'));
    fireEvent.press(view.getByLabelText('Increase servings'));
    fireEvent.press(view.getByLabelText('Increase servings'));

    expect(view.queryByText(/^0/)).toBeNull();
    expect(view.getByText('800 g')).toBeTruthy();
  });

  it('passes quantity 0 for the name-only ingredient when adding to the shopping list', async () => {
    const view = render(<RecipeDetailScreen />);
    await waitFor(() => expect(view.getByText('Salt')).toBeTruthy());

    fireEvent.press(view.getByLabelText('Add to Shopping List'));

    await waitFor(() => expect(addRecipeToShoppingList).toHaveBeenCalled());
    expect(jest.mocked(addRecipeToShoppingList).mock.calls[0][0]).toEqual([
      { name: 'Salt', quantity: 0, unit: 'g' },
      { name: 'Rice', quantity: 200, unit: 'g' },
    ]);
  });
});
