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
  importRecipe: jest.fn().mockResolvedValue(true),
  getRecipeById: jest.fn().mockResolvedValue(null),
}));

import DiscoverDetailScreen from '../DiscoverDetailScreen';
import { fetchMealById } from '../../api/mealdb';
import { lookupNutrition } from '../../api/openfoodfacts';

const mockFetchMeal = fetchMealById as jest.Mock;
const mockLookup = lookupNutrition as jest.Mock;

const MEAL = {
  id: '1',
  name: 'Test meal',
  category: 'Misc',
  area: 'Nowhere',
  thumb: null,
  instructions: '',
  tags: [],
  youtube: null,
  ingredients: [
    { ingredient: 'zzz found', measure: '100g' },
    { ingredient: 'zzz no data', measure: '100g' },
    { ingredient: 'zzz refused one', measure: '100g' },
    { ingredient: 'zzz refused two', measure: '100g' },
  ],
};

const NOT_LOOKED_UP =
  "2 ingredients couldn't be looked up right now and count as 0. Open the recipe in the editor later and save it to look them up.";
const NOT_LOOKED_UP_ONE =
  "1 ingredient couldn't be looked up right now and counts as 0. Open the recipe in the editor later and save it to look it up.";

describe('DiscoverDetailScreen import with refused lookups', () => {
  let alertSpy: jest.SpyInstance;
  let answers: Record<string, unknown>;

  beforeEach(() => {
    mockFetchMeal.mockReset().mockResolvedValue(MEAL);
    answers = {
      'zzz found': { kcal: 40, protein: 10, carbs: 0, fat: 0 },
      'zzz no data': null,
      'zzz refused one': 'not-looked-up',
      'zzz refused two': 'not-looked-up',
    };
    mockLookup.mockReset().mockImplementation(async (name: string) => answers[name]);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('tells no-data and not-looked-up ingredients apart in the Alert and the card', async () => {
    const utils = render(<DiscoverDetailScreen />);
    await waitFor(() => utils.getByLabelText('Import to my recipes'));
    fireEvent.press(utils.getByLabelText('Import to my recipes'));
    await waitFor(() => utils.getByText('Added to your library'));

    const [title, message] = alertSpy.mock.calls[0];
    expect(title).toBe('Imported!');
    expect(message).toContain('1 ingredient(s) had no nutritional data.');
    expect(message).toContain(NOT_LOOKED_UP);
    expect(message).not.toContain('3 ingredient(s) had no nutritional data');

    expect(utils.getByText(/Macros estimated — 1 ingredient had no nutritional data/)).toBeTruthy();
    expect(utils.getByText(NOT_LOOKED_UP)).toBeTruthy();
    expect(message).not.toMatch(/minute/);
    expect(utils.queryByText(/minute/)).toBeNull();
  });

  it('uses the singular sentence for one not-looked-up ingredient', async () => {
    answers['zzz refused two'] = { kcal: 10, protein: 1, carbs: 1, fat: 1 };
    const utils = render(<DiscoverDetailScreen />);
    await waitFor(() => utils.getByLabelText('Import to my recipes'));
    fireEvent.press(utils.getByLabelText('Import to my recipes'));
    await waitFor(() => utils.getByText('Added to your library'));

    const [, message] = alertSpy.mock.calls[0];
    expect(message).toContain(NOT_LOOKED_UP_ONE);
    expect(message).toContain('1 ingredient(s) had no nutritional data.');
    expect(utils.getByText(NOT_LOOKED_UP_ONE)).toBeTruthy();
    expect(utils.queryByText(/minute/)).toBeNull();
  });
});
