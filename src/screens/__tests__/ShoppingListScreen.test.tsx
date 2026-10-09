import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getShoppingListItems: jest.fn().mockResolvedValue([]),
  toggleShoppingListItem: jest.fn().mockResolvedValue(undefined),
  clearCompletedShoppingList: jest.fn().mockResolvedValue(undefined),
}));

import ShoppingListScreen from '../ShoppingListScreen';
import { getShoppingListItems, ShoppingListItem } from '../../db/database';

const mockGetItems = jest.mocked(getShoppingListItems);

function item(id: number, name: string, is_checked = false): ShoppingListItem {
  return { id, ingredient_name: name, total_quantity: 2, unit: 'g', is_checked };
}

const SECTION_TITLES = [
  'Produce',
  'Meat and fish',
  'Dairy and eggs',
  'Bakery',
  'Pantry',
  'Tins and jars',
  'Frozen',
  'Spices and oils',
  'Drinks',
  'Other',
];

function textsInOrder(root: ReturnType<typeof render>, wanted: string[]): string[] {
  return root
    .getAllByText(/./)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string' && wanted.includes(child));
}

describe('ShoppingListScreen', () => {
  beforeEach(() => {
    mockGetItems.mockReset();
  });

  it('shows section headers in aisle order with title-case text', async () => {
    mockGetItems.mockResolvedValue([
      item(1, 'xyzzy'),
      item(2, 'Sparkling water'),
      item(3, 'Chicken breast'),
      item(4, 'Onion'),
      item(5, 'Olive oil'),
    ]);
    const view = render(<ShoppingListScreen />);
    await waitFor(() => expect(view.getByText('Onion')).toBeTruthy());

    expect(textsInOrder(view, SECTION_TITLES)).toEqual([
      'Produce',
      'Meat and fish',
      'Spices and oils',
      'Drinks',
      'Other',
    ]);
  });

  it('omits sections with no items', async () => {
    mockGetItems.mockResolvedValue([item(1, 'Onion')]);
    const view = render(<ShoppingListScreen />);
    await waitFor(() => expect(view.getByText('Onion')).toBeTruthy());

    expect(textsInOrder(view, SECTION_TITLES)).toEqual(['Produce']);
  });

  it('sorts items alphabetically inside a section with checked items last', async () => {
    mockGetItems.mockResolvedValue([
      item(1, 'Spinach'),
      item(2, 'Avocado', true),
      item(3, 'Carrot, grated'),
      item(4, 'Onion'),
      item(5, 'Banana', true),
    ]);
    const view = render(<ShoppingListScreen />);
    await waitFor(() => expect(view.getByText('Onion')).toBeTruthy());

    expect(
      textsInOrder(view, ['Spinach', 'Avocado', 'Carrot, grated', 'Onion', 'Banana'])
    ).toEqual(['Carrot, grated', 'Onion', 'Spinach', 'Avocado', 'Banana']);
  });
});
