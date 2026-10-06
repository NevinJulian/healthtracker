import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), replace: mockReplace, navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../../db/database', () => ({
  createRecipe: jest.fn().mockResolvedValue(undefined),
  updateRecipe: jest.fn(),
  isSeededRecipe: jest.fn().mockResolvedValue(false),
  getRecipeCategories: jest.fn().mockResolvedValue([]),
  getRecipeById: jest.fn(),
}));

jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

import RecipeEditorScreen from '../RecipeEditorScreen';
import { lookupNutrition } from '../../api/openfoodfacts';
import { createRecipe } from '../../db/database';
import { computeRecipeMacros } from '../../nutrition/computeMacros';

const mockLookup = lookupNutrition as jest.Mock;
const mockCreateRecipe = createRecipe as jest.Mock;

const SAVE_DEADLINE_MS = 10_000;

describe('RecipeEditorScreen save deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
    mockCreateRecipe.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves with the local-table macros when the lookup never resolves', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    mockLookup.mockImplementation((_name: string, signal?: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => {});
    });

    const utils = render(<RecipeEditorScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    fireEvent.changeText(utils.getByPlaceholderText('Recipe name'), 'Mystery stew');
    fireEvent.changeText(utils.getByPlaceholderText('Ingredient name'), 'zzz unknown one');
    fireEvent.changeText(utils.getByPlaceholderText('Qty'), '100');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(SAVE_DEADLINE_MS - 1);
    });
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(utils.getByLabelText('Saving…')).toBeTruthy();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });

    const expected = computeRecipeMacros(
      [{ name: 'zzz unknown one', baseQuantity: 100, unit: 'g' }],
      4,
    ).macros;
    expect(mockCreateRecipe).toHaveBeenCalledTimes(1);
    const saved = mockCreateRecipe.mock.calls[0][0];
    expect(saved).toMatchObject({
      calories: expected.calories,
      protein: expected.protein,
      carbs: expected.carbs,
      fat: expected.fat,
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(utils.queryByLabelText('Saving…')).toBeNull();
  });
});
