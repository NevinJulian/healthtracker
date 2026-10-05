import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'r1' } }),
}));

jest.mock('../../db/database', () => ({
  createRecipe: jest.fn(),
  updateRecipe: jest.fn(),
  isSeededRecipe: jest.fn().mockResolvedValue(false),
  getRecipeCategories: jest.fn().mockResolvedValue([]),
  getRecipeById: jest.fn().mockResolvedValue({
    id: 'r1',
    title: 'Mystery stew',
    category: 'Quick Cook',
    defaultServings: 2,
    prepTimeMinutes: 10,
    instructions: '',
    freezerTips: '',
    ingredients: [
      { name: 'zzz unknown one', baseQuantity: 100, unit: 'g' },
      { name: 'zzz unknown two', baseQuantity: 50, unit: 'g' },
    ],
  }),
}));

jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

import RecipeEditorScreen from '../RecipeEditorScreen';
import { lookupNutrition } from '../../api/openfoodfacts';

const mockLookup = lookupNutrition as jest.Mock;

describe('RecipeEditorScreen nutrition lookup abort', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts the in-flight lookup on unmount and starts no further lookups', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const resolvers: Array<(v: null) => void> = [];
    mockLookup.mockImplementation((_name: string, signal?: AbortSignal) => {
      signals.push(signal);
      return new Promise<null>((resolve) => resolvers.push(resolve));
    });

    const utils = render(<RecipeEditorScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });

    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(signals[0]).toBeDefined();
    expect(signals[0]?.aborted).toBe(false);

    utils.unmount();
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      resolvers[0](null);
      await jest.advanceTimersByTimeAsync(700);
    });

    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});
