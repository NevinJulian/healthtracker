import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { recipeId: 'r1' } }),
}));

jest.mock('../../db/database', () => ({
  createRecipe: jest.fn(),
  updateRecipe: jest.fn().mockResolvedValue(undefined),
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
    ingredients: [{ name: 'zzz unknown one', baseQuantity: 100, unit: 'g' }],
  }),
}));

jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

import RecipeEditorScreen from '../RecipeEditorScreen';
import { lookupNutrition } from '../../api/openfoodfacts';
import { updateRecipe } from '../../db/database';

const mockLookup = lookupNutrition as jest.Mock;
const mockUpdateRecipe = updateRecipe as jest.Mock;

const NUTRITION = { kcal: 40, protein: 10, carbs: 0, fat: 0 };

describe('RecipeEditorScreen overlapping macro recomputes', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
    mockUpdateRecipe.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saves the macros of the edited ingredients when an older recompute finishes last', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const resolvers: Array<(v: typeof NUTRITION) => void> = [];
    mockLookup.mockImplementation((_name: string, signal?: AbortSignal) => {
      signals.push(signal);
      return new Promise((resolve) => resolvers.push(resolve));
    });

    const utils = render(<RecipeEditorScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);

    fireEvent.changeText(utils.getByDisplayValue('100'), '300');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(mockLookup).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers[1](NUTRITION);
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      resolvers[0](NUTRITION);
      await jest.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save Changes'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
    const saved = mockUpdateRecipe.mock.calls[0][0];
    expect(saved.ingredients).toEqual([{ name: 'zzz unknown one', baseQuantity: 300, unit: 'g' }]);
    expect(saved.protein).toBe(15);
    expect(saved.calories).toBe(60);
    expect(signals[0]?.aborted).toBe(true);
  });

  describe('Save before the latest recompute has finished', () => {
    let resolvers: Array<(v: typeof NUTRITION) => void>;
    let resolved: number;

    beforeEach(() => {
      resolvers = [];
      resolved = 0;
      mockLookup.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    });

    const resolvePending = async () => {
      await act(async () => {
        while (resolved < resolvers.length) resolvers[resolved++](NUTRITION);
        await jest.advanceTimersByTimeAsync(0);
      });
    };

    const renderWithSettledMacros = async () => {
      const utils = render(<RecipeEditorScreen />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(700);
      });
      await resolvePending();
      expect(utils.getByText('5g')).toBeTruthy();
      return utils;
    };

    const pressSave = async (utils: ReturnType<typeof render>) => {
      await act(async () => {
        fireEvent.press(utils.getByLabelText('Save Changes'));
        await jest.advanceTimersByTimeAsync(0);
      });
      await resolvePending();
    };

    it('waits for the debounced recompute when Save follows a quantity edit', async () => {
      const utils = await renderWithSettledMacros();

      fireEvent.changeText(utils.getByDisplayValue('100'), '300');
      await pressSave(utils);

      expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
      const saved = mockUpdateRecipe.mock.calls[0][0];
      expect(saved.ingredients).toEqual([{ name: 'zzz unknown one', baseQuantity: 300, unit: 'g' }]);
      expect(saved.protein).toBe(15);
      expect(saved.calories).toBe(60);
    });

    it('waits for the running lookup when Save follows a quantity edit', async () => {
      const utils = await renderWithSettledMacros();

      fireEvent.changeText(utils.getByDisplayValue('100'), '300');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(700);
      });
      expect(resolvers.length).toBe(resolved + 1);

      await pressSave(utils);

      expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
      const saved = mockUpdateRecipe.mock.calls[0][0];
      expect(saved.ingredients).toEqual([{ name: 'zzz unknown one', baseQuantity: 300, unit: 'g' }]);
      expect(saved.protein).toBe(15);
      expect(saved.calories).toBe(60);
    });

    it('waits for the debounced recompute when Save follows a servings edit', async () => {
      const utils = await renderWithSettledMacros();

      fireEvent.changeText(utils.getByDisplayValue('2'), '1');
      await pressSave(utils);

      expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
      const saved = mockUpdateRecipe.mock.calls[0][0];
      expect(saved.defaultServings).toBe(1);
      expect(saved.protein).toBe(10);
      expect(saved.calories).toBe(40);
    });
  });
});
