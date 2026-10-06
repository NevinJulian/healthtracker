import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

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
import { importRecipe } from '../../db/database';

const mockFetchMeal = fetchMealById as jest.Mock;
const mockLookup = lookupNutrition as jest.Mock;
const mockImport = importRecipe as jest.Mock;

const MEAL = {
  id: '1',
  name: 'Test meal',
  category: 'Misc',
  area: 'Nowhere',
  thumb: null,
  instructions: '',
  tags: [],
  youtube: null,
  ingredients: [{ ingredient: 'zzz unknown a', measure: '100g' }],
};

async function startImport(utils: ReturnType<typeof render>) {
  await waitFor(() => utils.getByLabelText('Import to my recipes'));
  fireEvent.press(utils.getByLabelText('Import to my recipes'));
  await waitFor(() => utils.getByLabelText('Cancel import'));
}

describe('DiscoverDetailScreen cancelling an import', () => {
  let alertSpy: jest.SpyInstance;
  let lookupSignal: AbortSignal | undefined;

  beforeEach(() => {
    mockFetchMeal.mockReset().mockResolvedValue(MEAL);
    mockImport.mockClear();
    lookupSignal = undefined;
    mockLookup.mockReset().mockImplementation((_name: string, signal?: AbortSignal) => {
      lookupSignal = signal;
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve(null));
      });
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('saves nothing, shows no alert and offers the import again after Cancel', async () => {
    const utils = render(<DiscoverDetailScreen />);
    await startImport(utils);

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Cancel import'));
    });

    expect(lookupSignal?.aborted).toBe(true);
    expect(mockImport).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(utils.queryByLabelText('Cancel import')).toBeNull();
    expect(utils.getByLabelText('Import to my recipes')).toBeTruthy();
  });

  it('aborts the lookups when the screen unmounts mid-import', async () => {
    const utils = render(<DiscoverDetailScreen />);
    await startImport(utils);

    utils.unmount();

    expect(lookupSignal?.aborted).toBe(true);
    await act(async () => {});
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('passes an abortable signal to the meal load and aborts it on unmount', async () => {
    let loadSignal: AbortSignal | undefined;
    mockFetchMeal.mockImplementation((_id: string, signal?: AbortSignal) => {
      loadSignal = signal;
      return new Promise(() => {});
    });
    const utils = render(<DiscoverDetailScreen />);
    expect(loadSignal).toBeDefined();
    expect(loadSignal?.aborted).toBe(false);

    utils.unmount();
    expect(loadSignal?.aborted).toBe(true);
  });
});
