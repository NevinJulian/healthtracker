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

  it('keeps the lookups that resolved when one of five hangs past the deadline', async () => {
    const names = ['zzz one', 'zzz two', 'zzz three', 'zzz four', 'zzz five'];
    const nutrition = { kcal: 40, protein: 10, carbs: 0, fat: 0 };
    mockLookup.mockImplementation((name: string) =>
      name === 'zzz five' ? new Promise(() => {}) : Promise.resolve(nutrition),
    );

    const utils = render(<RecipeEditorScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    fireEvent.changeText(utils.getByPlaceholderText('Recipe name'), 'Mystery stew');
    for (let i = 1; i < names.length; i++) {
      fireEvent.press(utils.getByLabelText('Add ingredient'));
    }
    const nameInputs = utils.getAllByPlaceholderText('Ingredient name');
    const qtyInputs = utils.getAllByPlaceholderText('Qty');
    names.forEach((name, i) => {
      fireEvent.changeText(nameInputs[i], name);
      fireEvent.changeText(qtyInputs[i], '100');
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(mockLookup).toHaveBeenCalledTimes(5);

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(SAVE_DEADLINE_MS);
    });

    const overrides: Record<string, typeof nutrition> = {};
    for (const name of names.slice(0, 4)) overrides[name] = nutrition;
    const expected = computeRecipeMacros(
      names.map((name) => ({ name, baseQuantity: 100, unit: 'g' })),
      4,
      overrides,
    ).macros;
    expect(expected.calories).toBeGreaterThan(0);
    expect(mockCreateRecipe).toHaveBeenCalledTimes(1);
    expect(mockCreateRecipe.mock.calls[0][0]).toMatchObject({
      calories: expected.calories,
      protein: expected.protein,
      carbs: expected.carbs,
      fat: expected.fat,
    });
  });

  async function fillIngredients(utils: ReturnType<typeof render>, names: string[]) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    fireEvent.changeText(utils.getByPlaceholderText('Recipe name'), 'Mystery stew');
    for (let i = 1; i < names.length; i++) {
      fireEvent.press(utils.getByLabelText('Add ingredient'));
    }
    const nameInputs = utils.getAllByPlaceholderText('Ingredient name');
    const qtyInputs = utils.getAllByPlaceholderText('Qty');
    names.forEach((name, i) => {
      fireEvent.changeText(nameInputs[i], name);
      fireEvent.changeText(qtyInputs[i], '100');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
  }

  it('lists refused lookups apart from ones with no data', async () => {
    mockLookup.mockImplementation(async (name: string) =>
      name === 'zzz refused' ? 'not-looked-up' : null,
    );
    const utils = render(<RecipeEditorScreen />);
    await fillIngredients(utils, ['zzz empty', 'zzz refused']);

    expect(utils.getByText('Estimated (no data): zzz empty')).toBeTruthy();
    expect(utils.getByText('Not looked up (try Recompute in a minute): zzz refused')).toBeTruthy();
  });

  it('shows the ingredient cut off by the save deadline as not looked up', async () => {
    mockLookup.mockImplementation((name: string) =>
      name === 'zzz hanging'
        ? new Promise(() => {})
        : Promise.resolve(name === 'zzz empty' ? null : { kcal: 40, protein: 10, carbs: 0, fat: 0 }),
    );
    const utils = render(<RecipeEditorScreen />);
    await fillIngredients(utils, ['zzz fine', 'zzz empty', 'zzz hanging']);

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(SAVE_DEADLINE_MS);
    });

    expect(utils.getByText('Not looked up (try Recompute in a minute): zzz hanging')).toBeTruthy();
    expect(utils.getByText('Estimated (no data): zzz empty')).toBeTruthy();
  });
});
