import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../api/mealdb', () => ({
  searchMeals: jest.fn(),
}));

import DiscoverScreen from '../DiscoverScreen';
import DiscoverDetailScreen from '../DiscoverDetailScreen';
import { searchMeals, MealSummary } from '../../api/mealdb';

const mockSearch = searchMeals as jest.Mock;

function meal(id: string, name: string): MealSummary {
  return { id, name, category: '', area: '', thumb: '' };
}

interface Deferred {
  resolve: (v: MealSummary[]) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
}

function deferSearches(): Deferred[] {
  const pending: Deferred[] = [];
  mockSearch.mockImplementation((_q: string, signal?: AbortSignal) => {
    return new Promise<MealSummary[]>((resolve, reject) => {
      pending.push({ resolve, reject, signal });
    });
  });
  return pending;
}

function submit(utils: ReturnType<typeof render>, text: string) {
  const input = utils.getByPlaceholderText(/Search recipes/);
  fireEvent.changeText(input, text);
  fireEvent(input, 'submitEditing');
}

describe('DiscoverScreen', () => {
  beforeEach(() => {
    mockSearch.mockReset();
  });

  it('is a valid React component', () => {
    expect(typeof DiscoverScreen).toBe('function');
  });

  it('shows the newer query results when an older search resolves last', async () => {
    const pending = deferSearches();
    const utils = render(<DiscoverScreen />);

    submit(utils, 'a');
    submit(utils, 'b');

    await act(async () => {
      pending[1].resolve([meal('2', 'Beef stew')]);
    });
    await act(async () => {
      pending[0].resolve([meal('1', 'Apple pie')]);
    });

    expect(utils.queryByText('Beef stew')).toBeTruthy();
    expect(utils.queryByText('Apple pie')).toBeNull();
  });

  it('does not show the error state when a superseded search rejects', async () => {
    const pending = deferSearches();
    const utils = render(<DiscoverScreen />);

    submit(utils, 'a');
    submit(utils, 'b');

    await act(async () => {
      pending[1].resolve([meal('2', 'Beef stew')]);
    });
    await act(async () => {
      pending[0].reject(new Error('Request aborted'));
    });

    expect(utils.queryByText('Beef stew')).toBeTruthy();
    expect(utils.queryByText(/Couldn.t reach the recipe service/)).toBeNull();
  });

  it('aborts the previous search when a new one starts', () => {
    const pending = deferSearches();
    const utils = render(<DiscoverScreen />);

    submit(utils, 'a');
    submit(utils, 'b');

    expect(pending[0].signal?.aborted).toBe(true);
    expect(pending[1].signal?.aborted).toBe(false);
  });

  it('aborts the in-flight search on unmount', () => {
    const pending = deferSearches();
    const utils = render(<DiscoverScreen />);

    submit(utils, 'a');
    expect(pending[0].signal?.aborted).toBe(false);

    utils.unmount();
    expect(pending[0].signal?.aborted).toBe(true);
  });

  it('does not set state when an aborted search settles after unmount', async () => {
    const pending = deferSearches();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const utils = render(<DiscoverScreen />);

    submit(utils, 'a');
    utils.unmount();
    await act(async () => {
      pending[0].reject(new Error('Request aborted'));
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('DiscoverDetailScreen', () => {
  it('is a valid React component', () => {
    expect(typeof DiscoverDetailScreen).toBe('function');
  });
});
