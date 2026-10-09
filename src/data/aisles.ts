import type { ShoppingListItem } from '../db/database';

export const AISLES = [
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
] as const;

export type Aisle = (typeof AISLES)[number];

export const AISLE_KEYWORDS: Record<Exclude<Aisle, 'Other'>, string[]> = {
  Produce: [],
  'Meat and fish': [],
  'Dairy and eggs': [],
  Bakery: [],
  Pantry: [],
  'Tins and jars': [],
  Frozen: [],
  'Spices and oils': [],
  Drinks: [],
};

export interface AisleGroup {
  aisle: Aisle;
  items: ShoppingListItem[];
}

export function aisleFor(_name: string): Aisle {
  return 'Other';
}

export function groupByAisle(_items: ShoppingListItem[]): AisleGroup[] {
  return [];
}
