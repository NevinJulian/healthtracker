import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('../../db/database', () => ({
  getRecipes: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../api/fetchRecipePage', () => ({
  ...jest.requireActual('../../api/fetchRecipePage'),
  fetchRecipePage: jest.fn(),
}));

import RecipesScreen from '../RecipesScreen';
import { fetchRecipePage, RecipePageError } from '../../api/fetchRecipePage';
import type { RecipeDraft } from '../../api/recipeHtml';

const mockFetch = fetchRecipePage as jest.Mock;

const DRAFT: RecipeDraft = {
  title: 'Pasta',
  servings: 4,
  prepMinutes: 30,
  ingredients: [{ name: 'Nudeln', quantity: 200, unit: 'g' }],
  instructions: 'Kochen.',
};

interface Pending {
  url: string;
  signal?: AbortSignal;
  resolve: (draft: RecipeDraft) => void;
  reject: (err: Error) => void;
}

function deferFetches(): Pending[] {
  const pending: Pending[] = [];
  mockFetch.mockImplementation(
    (url: string, signal?: AbortSignal) =>
      new Promise<RecipeDraft>((resolve, reject) => {
        pending.push({ url, signal, resolve, reject });
      }),
  );
  return pending;
}

async function renderScreen() {
  const utils = render(<RecipesScreen />);
  await act(async () => {});
  return utils;
}

async function openDialog(utils: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(utils.getByLabelText('Import recipe from URL'));
  });
}

async function typeUrl(utils: ReturnType<typeof render>, text: string) {
  await act(async () => {
    fireEvent.changeText(utils.getByPlaceholderText('https://...'), text);
  });
}

describe('RecipesScreen import from URL', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockNavigate.mockClear();
  });

  it('shows the import action next to the new-recipe button and keeps the dialog closed', async () => {
    const utils = await renderScreen();
    expect(utils.getByLabelText('Import recipe from URL')).toBeTruthy();
    expect(utils.getByLabelText('Create new recipe')).toBeTruthy();
    expect(utils.queryByPlaceholderText('https://...')).toBeNull();
  });

  it('opens the dialog from the action', async () => {
    const utils = await renderScreen();
    await openDialog(utils);
    expect(utils.getByText('Import from URL')).toBeTruthy();
    expect(utils.getByPlaceholderText('https://...')).toBeTruthy();
  });

  it('does not import while the field is empty', async () => {
    const utils = await renderScreen();
    await openDialog(utils);
    expect(utils.getByLabelText('Import').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    expect(mockFetch).not.toHaveBeenCalled();

    await typeUrl(utils, '   ');
    expect(utils.getByLabelText('Import').props.accessibilityState.disabled).toBe(true);
  });

  it('is busy while the request runs and cannot be started twice', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].url).toBe('https://example.com/r');
    expect(pending[0].signal).toBeDefined();
    const busy = utils.getByLabelText('Importing...');
    expect(busy.props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(busy);
    });
    expect(pending).toHaveLength(1);
  });

  it('starts one request when submitted twice in the same tick', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      const input = utils.getByPlaceholderText('https://...');
      fireEvent(input, 'submitEditing');
      fireEvent(input, 'submitEditing');
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].signal?.aborted).toBe(false);
    await act(async () => {
      pending[0].resolve(DRAFT);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('closes and opens the editor with the draft on success', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    await act(async () => {
      pending[0].resolve(DRAFT);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('RecipeEditor', { draft: DRAFT });
    expect(utils.queryByPlaceholderText('https://...')).toBeNull();
  });

  it('shows the error text in the dialog and lets the user try again', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    await act(async () => {
      pending[0].reject(new RecipePageError('no-recipe'));
    });

    expect(utils.getByText('This page has no recipe data the app can read.')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(utils.getByLabelText('Import').props.accessibilityState.disabled).toBe(false);
  });

  it('shows a network message for an unexpected error', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    expect(utils.getByText("Couldn't reach that page. Check the address and your connection.")).toBeTruthy();
  });

  it('cancel aborts the request and a late result does not navigate', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Cancel'));
    });

    expect(pending[0].signal?.aborted).toBe(true);
    expect(utils.queryByPlaceholderText('https://...')).toBeNull();
    await act(async () => {
      pending[0].resolve(DRAFT);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('a late error after cancel shows nothing when the dialog is opened again', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Cancel'));
    });
    await act(async () => {
      pending[0].reject(new RecipePageError('timeout'));
    });
    await openDialog(utils);
    expect(utils.queryByText('The page took too long to respond.')).toBeNull();
    expect(utils.getByLabelText('Import').props.accessibilityState.disabled).toBe(true);
  });

  it('the system back action closes the dialog and aborts', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    await act(async () => {
      utils.UNSAFE_getByType(require('react-native').Modal).props.onRequestClose();
    });
    expect(pending[0].signal?.aborted).toBe(true);
    expect(utils.queryByPlaceholderText('https://...')).toBeNull();
  });

  it('aborts the request when the screen unmounts', async () => {
    const pending = deferFetches();
    const utils = await renderScreen();
    await openDialog(utils);
    await typeUrl(utils, 'https://example.com/r');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Import'));
    });
    utils.unmount();
    expect(pending[0].signal?.aborted).toBe(true);
  });
});
