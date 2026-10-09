import { AISLES, AISLE_KEYWORDS, Aisle, aisleFor, groupByAisle } from '../aisles';
import { shoppingKey } from '../shoppingMerge';
import { recipes } from '../recipes';
import type { ShoppingListItem } from '../../db/database';

type KeywordAisle = Exclude<Aisle, 'Other'>;
const KEYWORD_AISLES = AISLES.filter((a): a is KeywordAisle => a !== 'Other');

function item(id: number, name: string, is_checked = false): ShoppingListItem {
  return { id, ingredient_name: name, total_quantity: 1, unit: 'g', is_checked };
}

describe('AISLES', () => {
  it('lists the ten sections in order', () => {
    expect([...AISLES]).toEqual([
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
    ]);
  });
});

describe('AISLE_KEYWORDS', () => {
  it('has a real list for every section', () => {
    for (const aisle of KEYWORD_AISLES) {
      expect(AISLE_KEYWORDS[aisle].length).toBeGreaterThanOrEqual(15);
    }
  });

  it('has a substantial list in total, in lowercase', () => {
    const all = KEYWORD_AISLES.flatMap((a) => AISLE_KEYWORDS[a]);
    expect(all.length).toBeGreaterThanOrEqual(250);
    for (const kw of all) expect(kw).toBe(kw.toLowerCase());
  });

  it('covers both English and German', () => {
    const all = KEYWORD_AISLES.flatMap((a) => AISLE_KEYWORDS[a]);
    expect(all).toEqual(expect.arrayContaining(['onion', 'zwiebel', 'milk', 'milch', 'butter']));
  });

  it('keeps umlauts intact', () => {
    const all = KEYWORD_AISLES.flatMap((a) => AISLE_KEYWORDS[a]);
    expect(all.some((kw) => kw.includes('ü'))).toBe(true);
    expect(all.some((kw) => /Ã|â€|�/.test(kw))).toBe(false);
  });
});

describe('aisleFor', () => {
  it.each([
    ['Onion, diced', 'Produce'],
    ['Zwiebel', 'Produce'],
    ['Frühlingszwiebel', 'Produce'],
    ['Chicken breast', 'Meat and fish'],
    ['Rahm', 'Dairy and eggs'],
    ['Eggs', 'Dairy and eggs'],
    ['egg whites', 'Dairy and eggs'],
    ['Whole-wheat tortillas (medium)', 'Bakery'],
    ['Rolled oats', 'Pantry'],
    ['coconut milk', 'Tins and jars'],
    ['tomato paste', 'Tins and jars'],
    ['lemon juice', 'Tins and jars'],
    ['crushed tomato', 'Tins and jars'],
    ['diced tomato', 'Tins and jars'],
    ['frozen peas', 'Frozen'],
    ['olive oil', 'Spices and oils'],
    ['salt & pepper', 'Spices and oils'],
    ['Sparkling water', 'Drinks'],
    ['chicken broth (low sodium)', 'Tins and jars'],
    ['frozen peas & carrots', 'Frozen'],
    ['egg (for meatballs)', 'Dairy and eggs'],
    ['oat flour (for meatballs)', 'Pantry'],
    ['coriander (ground)', 'Spices and oils'],
    ['butter beans', 'Tins and jars'],
    ['beans', 'Tins and jars'],
    ['bean', 'Tins and jars'],
    ['olives', 'Tins and jars'],
    ['olive', 'Tins and jars'],
    ['garlic salt', 'Spices and oils'],
    ['celery salt', 'Spices and oils'],
    ['cornmeal', 'Pantry'],
    ['popcorn', 'Pantry'],
    ['pepperoni', 'Meat and fish'],
    ['ginger ale', 'Drinks'],
    ['peanut oil', 'Spices and oils'],
    ['Gemüse', 'Produce'],
    ['Obst', 'Produce'],
    ['fruit', 'Produce'],
    ['vegetables', 'Produce'],
    ['Gemüsebrühe', 'Tins and jars'],
    ['xyzzy', 'Other'],
  ] as const)('%s -> %s', (name, aisle) => {
    expect(aisleFor(name)).toBe(aisle);
  });

  it('matches short keywords only as whole words', () => {
    expect(aisleFor('oil')).toBe('Spices and oils');
    expect(aisleFor('boiled potatoes')).not.toBe('Spices and oils');
    expect(aisleFor('chamomile tea')).toBe('Drinks');
    expect(aisleFor('steak')).toBe('Meat and fish');
    expect(aisleFor('stea')).toBe('Other');
  });

  it('matches on the part before the first comma only', () => {
    expect(aisleFor('Xyzzy, with milk')).toBe('Other');
  });

  it('prefers the longest matching keyword across sections', () => {
    expect(aisleFor('coconut milk')).toBe('Tins and jars');
    expect(aisleFor('milk')).toBe('Dairy and eggs');
  });

  it('resolves equal-length matches to the earlier section', () => {
    const pool = KEYWORD_AISLES.flatMap((aisle, index) =>
      AISLE_KEYWORDS[aisle].filter((kw) => kw.length >= 4 && !kw.includes(' ')).map((kw) => ({ kw, index }))
    );
    let found = false;
    for (const early of pool) {
      const late = pool.find(
        (p) =>
          p.index > early.index &&
          p.kw.length === early.kw.length &&
          !p.kw.includes(early.kw) &&
          !early.kw.includes(p.kw)
      );
      if (!late) continue;
      found = true;
      expect(aisleFor(`${late.kw} ${early.kw}`)).toBe(KEYWORD_AISLES[early.index]);
      expect(aisleFor(`${early.kw} ${late.kw}`)).toBe(KEYWORD_AISLES[early.index]);
      break;
    }
    expect(found).toBe(true);
  });

  it('sends at most 10% of the distinct seeded ingredient names to Other', () => {
    const keys = new Set<string>();
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients) keys.add(shoppingKey(ing.name));
    }
    const names = [...keys];
    const other = names.filter((k) => aisleFor(k) === 'Other');
    expect(names.length).toBeGreaterThan(150);
    expect(other.length / names.length).toBeLessThanOrEqual(0.1);
  });
});

describe('groupByAisle', () => {
  it('orders sections as listed and omits empty ones', () => {
    const groups = groupByAisle([
      item(1, 'Sparkling water'),
      item(2, 'Onion'),
      item(3, 'Chicken breast'),
      item(4, 'xyzzy'),
    ]);
    expect(groups.map((g) => g.aisle)).toEqual(['Produce', 'Meat and fish', 'Drinks', 'Other']);
  });

  it('sorts items alphabetically by name key within a section', () => {
    const groups = groupByAisle([item(1, 'Spinach'), item(2, 'Carrot, grated'), item(3, 'Avocado')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.ingredient_name)).toEqual(['Avocado', 'Carrot, grated', 'Spinach']);
  });

  it('puts checked items after unchecked ones and breaks ties by id', () => {
    const groups = groupByAisle([
      item(5, 'Carrot', true),
      item(4, 'Avocado', true),
      item(3, 'Spinach'),
      item(2, 'Onion'),
      item(1, 'Onion'),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps a checked item in its section', () => {
    const groups = groupByAisle([item(1, 'Onion', true), item(2, 'Chicken breast')]);
    expect(groups.map((g) => g.aisle)).toEqual(['Produce', 'Meat and fish']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByAisle([])).toEqual([]);
  });
});

describe('aisle table invariants', () => {
  it('has no keyword in two sections', () => {
    const seen = new Map<string, string>();
    for (const aisle of KEYWORD_AISLES) {
      for (const kw of AISLE_KEYWORDS[aisle]) {
        expect({ kw, first: seen.get(kw) }).toEqual({ kw, first: undefined });
        seen.set(kw, aisle);
      }
    }
  });

  it('has no keyword twice in one section', () => {
    for (const aisle of KEYWORD_AISLES) {
      const list = AISLE_KEYWORDS[aisle];
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
