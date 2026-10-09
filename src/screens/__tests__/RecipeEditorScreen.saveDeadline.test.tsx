import React from 'react';
import { Alert } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, replace: mockReplace, navigate: jest.fn() }),
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
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
    mockCreateRecipe.mockClear();
    mockReplace.mockClear();
    mockGoBack.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
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
    expect(utils.getByText('Not looked up yet. Tap Recompute later. (zzz refused)')).toBeTruthy();
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

    expect(utils.getByText('Not looked up yet. Tap Recompute later. (zzz hanging)')).toBeTruthy();
    expect(utils.getByText('Estimated (no data): zzz empty')).toBeTruthy();
  });

  describe('notice for lookups that were not finished', () => {
    const PLURAL =
      "2 ingredients couldn't be looked up and count as 0. Open and save the recipe again later to look them up.";
    const SINGULAR =
      "1 ingredient couldn't be looked up and counts as 0. Open and save the recipe again later to look it up.";

    const hangOn = (hanging: string[]) => {
      mockLookup.mockImplementation((name: string) =>
        hanging.includes(name)
          ? new Promise(() => {})
          : Promise.resolve(name === 'zzz empty' ? null : { kcal: 40, protein: 10, carbs: 0, fat: 0 }),
      );
    };

    const saveAndWaitForDeadline = async (utils: ReturnType<typeof render>) => {
      await act(async () => {
        fireEvent.press(utils.getByLabelText('Create Recipe'));
        await jest.advanceTimersByTimeAsync(SAVE_DEADLINE_MS);
      });
    };

    const buttons = () => alertSpy.mock.calls[0][2]!;
    const options = () => alertSpy.mock.calls[0][3]!;

    it('shows one Alert with the plural sentence and does not leave until it is answered', async () => {
      hangOn(['zzz hang one', 'zzz hang two']);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz hang one', 'zzz hang two']);

      await saveAndWaitForDeadline(utils);

      expect(mockCreateRecipe).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][0]).toBe('Saved');
      expect(alertSpy.mock.calls[0][1]).toBe(PLURAL);
      expect(mockReplace).not.toHaveBeenCalled();

      await act(async () => {
        buttons()[0].onPress!();
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('RecipeDetail', {
        recipeId: mockCreateRecipe.mock.calls[0][0].id,
      });
    });

    it('uses the singular sentence for one ingredient', async () => {
      hangOn(['zzz hanging']);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz hanging']);

      await saveAndWaitForDeadline(utils);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][1]).toBe(SINGULAR);
    });

    it('counts a refused lookup together with one cut off by the deadline', async () => {
      mockLookup.mockImplementation((name: string) =>
        name === 'zzz refused' ? Promise.resolve('not-looked-up') : new Promise(() => {}),
      );
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz refused', 'zzz hanging']);

      await saveAndWaitForDeadline(utils);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][1]).toBe(PLURAL);
    });

    it('counts a refused lookup when every lookup finished', async () => {
      mockLookup.mockImplementation(async (name: string) =>
        name === 'zzz refused' ? 'not-looked-up' : { kcal: 40, protein: 10, carbs: 0, fat: 0 },
      );
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz refused']);

      await act(async () => {
        fireEvent.press(utils.getByLabelText('Create Recipe'));
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0][1]).toBe(SINGULAR);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('navigates once when the Alert is dismissed after a button press and the reverse', async () => {
      hangOn(['zzz hanging']);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz hanging']);
      await saveAndWaitForDeadline(utils);

      await act(async () => {
        buttons()[0].onPress!();
        options().onDismiss!();
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);

      alertSpy.mockClear();
      mockReplace.mockClear();
      const second = render(<RecipeEditorScreen />);
      await fillIngredients(second, ['zzz fine', 'zzz hanging']);
      await saveAndWaitForDeadline(second);

      await act(async () => {
        options().onDismiss!();
        buttons()[0].onPress!();
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('shows no Alert and navigates at once when every lookup finished', async () => {
      hangOn([]);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz empty']);

      await act(async () => {
        fireEvent.press(utils.getByLabelText('Create Recipe'));
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(alertSpy).not.toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('keeps Save disabled while the Alert is up and frees it after the answer', async () => {
      hangOn(['zzz hanging']);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz hanging']);
      await saveAndWaitForDeadline(utils);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(utils.getByLabelText('Saving…')).toBeTruthy();

      await act(async () => {
        buttons()[0].onPress!();
      });
      expect(utils.queryByLabelText('Saving…')).toBeNull();
    });

    it('does not navigate when the screen was closed before the Alert was answered', async () => {
      hangOn(['zzz hanging']);
      const utils = render(<RecipeEditorScreen />);
      await fillIngredients(utils, ['zzz fine', 'zzz hanging']);
      await saveAndWaitForDeadline(utils);
      expect(alertSpy).toHaveBeenCalledTimes(1);

      utils.unmount();
      await act(async () => {
        buttons()[0].onPress!();
      });

      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockGoBack).not.toHaveBeenCalled();
    });
  });
});
