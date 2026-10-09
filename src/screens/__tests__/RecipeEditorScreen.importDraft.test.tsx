import React from 'react';
import { Alert } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, replace: mockReplace, navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

jest.mock('../../db/database', () => ({
  createRecipe: jest.fn().mockResolvedValue(undefined),
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
import { createRecipe, getRecipeById, updateRecipe } from '../../db/database';

const mockLookup = lookupNutrition as jest.Mock;
const mockCreateRecipe = createRecipe as jest.Mock;
const mockUpdateRecipe = updateRecipe as jest.Mock;
const mockGetRecipeById = getRecipeById as jest.Mock;

const DRAFT = {
  title: 'Hackbraten',
  servings: 6,
  prepMinutes: 75,
  ingredients: [
    { name: 'zzz unknown one', quantity: 500, unit: 'g' },
    { name: '1 Prise Salz', quantity: 0, unit: 'g' },
    { name: 'etwas Pfeffer', quantity: 0, unit: 'g' },
  ],
  instructions: 'Mischen.\nBacken.',
};

async function openEditor() {
  const utils = render(<RecipeEditorScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  return utils;
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(700);
  });
}

describe('RecipeEditorScreen with an imported draft', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockParams = {};
    mockLookup.mockReset();
    mockLookup.mockResolvedValue(null);
    mockCreateRecipe.mockClear();
    mockUpdateRecipe.mockClear();
    mockGetRecipeById.mockReset();
    mockReplace.mockClear();
    mockGoBack.mockClear();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.useRealTimers();
  });

  it('prefills every field from the draft and saves nothing', async () => {
    mockParams = { draft: DRAFT };
    const utils = await openEditor();
    await settle();

    expect(utils.getByPlaceholderText('Recipe name').props.value).toBe('Hackbraten');
    expect(utils.getByPlaceholderText('4').props.value).toBe('6');
    expect(utils.getByPlaceholderText('30').props.value).toBe('75');
    expect(utils.getAllByPlaceholderText('Ingredient name').map((i) => i.props.value)).toEqual([
      'zzz unknown one',
      '1 Prise Salz',
      'etwas Pfeffer',
    ]);
    expect(utils.getAllByPlaceholderText('Qty').map((i) => i.props.value)).toEqual(['500', '', '']);
    expect(utils.getByPlaceholderText(/Describe the cooking steps/).props.value).toBe('Mischen.\nBacken.');
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(mockUpdateRecipe).not.toHaveBeenCalled();
  });

  it('keeps the default servings and prep time when the draft has none', async () => {
    mockParams = { draft: { ...DRAFT, servings: null, prepMinutes: null } };
    const utils = await openEditor();
    expect(utils.getByPlaceholderText('4').props.value).toBe('4');
    expect(utils.getByPlaceholderText('30').props.value).toBe('30');
  });

  it('ignores the draft when a recipe id is given', async () => {
    mockParams = { recipeId: 'r1', draft: DRAFT };
    mockGetRecipeById.mockResolvedValue({
      id: 'r1',
      title: 'Stored recipe',
      category: 'Quick Cook',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      prepTimeMinutes: 10,
      defaultServings: 2,
      ingredients: [{ name: 'zzz stored', baseQuantity: 50, unit: 'g' }],
      instructions: 'Stored steps',
      freezerTips: '',
    });
    const utils = await openEditor();
    expect(utils.getByPlaceholderText('Recipe name').props.value).toBe('Stored recipe');
    expect(utils.getAllByPlaceholderText('Ingredient name').map((i) => i.props.value)).toEqual(['zzz stored']);
  });

  it('saves the draft in Fresh & Fridge with its quantity-0 rows kept at 0', async () => {
    mockParams = { draft: DRAFT };
    const utils = await openEditor();
    await settle();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockCreateRecipe).toHaveBeenCalledTimes(1);
    const saved = mockCreateRecipe.mock.calls[0][0];
    expect(saved.category).toBe('Fresh & Fridge');
    expect(saved.title).toBe('Hackbraten');
    expect(saved.defaultServings).toBe(6);
    expect(saved.prepTimeMinutes).toBe(75);
    expect(saved.ingredients).toEqual([
      { name: 'zzz unknown one', baseQuantity: 500, unit: 'g' },
      { name: '1 Prise Salz', baseQuantity: 0, unit: 'g' },
      { name: 'etwas Pfeffer', baseQuantity: 0, unit: 'g' },
    ]);
  });

  it('looks up only the ingredients that have a quantity', async () => {
    mockParams = { draft: DRAFT };
    await openEditor();
    await settle();
    expect(mockLookup.mock.calls.map((c) => c[0])).toEqual(['zzz unknown one']);
  });

  it('counts and names only quantity rows in the saved alert and the banner', async () => {
    mockParams = { draft: DRAFT };
    mockLookup.mockResolvedValue('not-looked-up');
    const utils = await openEditor();
    await settle();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Saved');
    expect(alertSpy.mock.calls[0][1]).toMatch(/^1 ingredient couldn't be looked up/);
    expect(utils.queryByText(/Prise Salz/)).toBeNull();
    expect(utils.queryByText(/Pfeffer/)).toBeNull();
    expect(utils.getByText(/zzz unknown one/)).toBeTruthy();
  });

  it('refuses to save when every ingredient has quantity 0', async () => {
    mockParams = {
      draft: { ...DRAFT, ingredients: DRAFT.ingredients.slice(1) },
    };
    const utils = await openEditor();
    await settle();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Create Recipe'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(alertSpy).toHaveBeenCalledWith('Validation', 'Please add at least one ingredient with a quantity.');
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('keeps a stored quantity-0 ingredient when an existing recipe is saved', async () => {
    mockParams = { recipeId: 'r1' };
    mockGetRecipeById.mockResolvedValue({
      id: 'r1',
      title: 'Imported soup',
      category: 'Imported',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      prepTimeMinutes: 20,
      defaultServings: 2,
      ingredients: [
        { name: 'zzz broth', baseQuantity: 300, unit: 'ml' },
        { name: 'Salt', baseQuantity: 0, unit: 'g' },
      ],
      instructions: 'Heat.',
      freezerTips: '',
    });
    const utils = await openEditor();
    await settle();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save Changes'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(mockUpdateRecipe).toHaveBeenCalledTimes(1);
    expect(mockUpdateRecipe.mock.calls[0][0].ingredients).toEqual([
      { name: 'zzz broth', baseQuantity: 300, unit: 'ml' },
      { name: 'Salt', baseQuantity: 0, unit: 'g' },
    ]);
  });
});
