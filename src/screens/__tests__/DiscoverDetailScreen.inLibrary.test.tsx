import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { mealId: '1' } }),
}));

jest.mock('../../api/mealdb', () => ({
  fetchMealById: jest.fn(),
}));

jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

jest.mock('../../db/database', () => ({
  importRecipe: jest.fn(),
  getRecipeById: jest.fn(),
}));

import DiscoverDetailScreen from '../DiscoverDetailScreen';
import { fetchMealById } from '../../api/mealdb';
import { lookupNutrition } from '../../api/openfoodfacts';
import { importRecipe, getRecipeById } from '../../db/database';

const mockFetchMeal = fetchMealById as jest.Mock;
const mockLookup = lookupNutrition as jest.Mock;
const mockImport = importRecipe as jest.Mock;
const mockGetRecipe = getRecipeById as jest.Mock;

const MEAL = {
  id: '1',
  name: 'Test meal',
  category: 'Misc',
  area: 'Nowhere',
  thumb: null,
  instructions: '',
  tags: [],
  youtube: null,
  ingredients: [{ ingredient: 'zzz found', measure: '100g' }],
};

describe('DiscoverDetailScreen card text for a recipe already in the library', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockFetchMeal.mockReset().mockResolvedValue(MEAL);
    mockLookup.mockReset().mockResolvedValue({ kcal: 40, protein: 10, carbs: 0, fat: 0 });
    mockImport.mockReset().mockResolvedValue(true);
    mockGetRecipe.mockReset().mockResolvedValue(null);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shows "In your library" when the recipe is found on load', async () => {
    mockGetRecipe.mockResolvedValue({ id: 'mealdb-1' });
    const utils = render(<DiscoverDetailScreen />);
    await waitFor(() => utils.getByText('Added to your library'));

    expect(utils.getByText('In your library')).toBeTruthy();
    expect(utils.queryByText('Macros computed from local data')).toBeNull();
    expect(utils.queryByLabelText('Import to my recipes')).toBeNull();
  });

  it('shows "In your library" when the import finds the recipe already there', async () => {
    mockImport.mockResolvedValue(false);
    const utils = render(<DiscoverDetailScreen />);
    await waitFor(() => utils.getByLabelText('Import to my recipes'));
    fireEvent.press(utils.getByLabelText('Import to my recipes'));
    await waitFor(() => utils.getByText('Added to your library'));

    expect(alertSpy.mock.calls[0][0]).toBe('Already in your library');
    expect(utils.getByText('In your library')).toBeTruthy();
    expect(utils.queryByText('Macros computed from local data')).toBeNull();
    expect(utils.queryByLabelText('Import to my recipes')).toBeNull();
  });

  it('keeps "Macros computed from local data" after a fresh clean import', async () => {
    const utils = render(<DiscoverDetailScreen />);
    await waitFor(() => utils.getByLabelText('Import to my recipes'));
    fireEvent.press(utils.getByLabelText('Import to my recipes'));
    await waitFor(() => utils.getByText('Added to your library'));

    expect(utils.getByText('Macros computed from local data')).toBeTruthy();
    expect(utils.queryByText('In your library')).toBeNull();
  });
});
