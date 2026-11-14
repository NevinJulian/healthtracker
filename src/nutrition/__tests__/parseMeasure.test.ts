/**
 * parseMeasure.test.ts
 *
 * Unit tests for the TheMealDB measure parser.
 * Runs in the existing jest node environment — no native modules, no network.
 */

import { parseMeasure, parseMealIngredients } from '../parseMeasure';

// ─── Basic number parsing ─────────────────────────────────────────────────────

describe('parseMeasure — plain numbers + weight units', () => {
  it('parses plain integer grams', () => {
    const r = parseMeasure('Chicken Breast', '200g');
    expect(r.baseQuantity).toBeCloseTo(200);
    expect(r.unit).toBe('g');
    expect(r.isVague).toBe(false);
  });

  it('parses integer with space before unit', () => {
    const r = parseMeasure('Flour', '100 g');
    expect(r.baseQuantity).toBeCloseTo(100);
    expect(r.unit).toBe('g');
  });

  it('parses kg and converts to grams', () => {
    const r = parseMeasure('Beef', '1kg');
    expect(r.baseQuantity).toBeCloseTo(1000);
    expect(r.unit).toBe('g');
  });

  it('parses ml as liquid', () => {
    const r = parseMeasure('Olive Oil', '30ml');
    expect(r.baseQuantity).toBeCloseTo(30);
    expect(r.unit).toBe('ml');
  });

  it('parses litre and converts to ml', () => {
    const r = parseMeasure('Water', '1l');
    expect(r.baseQuantity).toBeCloseTo(1000);
    expect(r.unit).toBe('ml');
  });

  it('parses oz and converts to grams', () => {
    const r = parseMeasure('Butter', '4 oz');
    expect(r.baseQuantity).toBeCloseTo(4 * 28.35);
    expect(r.unit).toBe('g');
  });

  it('parses lb and converts to grams', () => {
    const r = parseMeasure('Ground Beef', '1 lb');
    expect(r.baseQuantity).toBeCloseTo(453.592);
    expect(r.unit).toBe('g');
  });
});

// ─── Tablespoon / teaspoon / cup ──────────────────────────────────────────────

describe('parseMeasure — spoon and cup units', () => {
  it('parses tsp', () => {
    const r = parseMeasure('Salt', '1 tsp');
    expect(r.baseQuantity).toBeCloseTo(5);
    expect(r.unit).toBe('g');
  });

  it('parses teaspoon (full word)', () => {
    const r = parseMeasure('Cumin', '2 teaspoons');
    expect(r.baseQuantity).toBeCloseTo(10);
  });

  it('parses tbsp', () => {
    const r = parseMeasure('Soy Sauce', '2 tbsp');
    expect(r.baseQuantity).toBeCloseTo(30);
    // tbsp is a volume measure but density=1; parser returns 'g' (water-density assumption)
    expect(r.unit).toBe('g');
  });

  it('parses tablespoon (full word)', () => {
    const r = parseMeasure('Olive Oil', '1 tablespoon');
    expect(r.baseQuantity).toBeCloseTo(15);
  });

  it('parses cup', () => {
    const r = parseMeasure('Flour', '2 cup');
    expect(r.baseQuantity).toBeCloseTo(480);
  });

  it('parses cups (plural)', () => {
    const r = parseMeasure('Rice', '2 cups');
    expect(r.baseQuantity).toBeCloseTo(480);
  });
});

// ─── Unicode fractions ────────────────────────────────────────────────────────

describe('parseMeasure — unicode fractions', () => {
  it('handles ½ tsp', () => {
    const r = parseMeasure('Salt', '½ tsp');
    expect(r.baseQuantity).toBeCloseTo(2.5);
    expect(r.isVague).toBe(false);
  });

  it('handles ¼ cup', () => {
    const r = parseMeasure('Sugar', '¼ cup');
    expect(r.baseQuantity).toBeCloseTo(60);
  });

  it('handles ¾ cup', () => {
    const r = parseMeasure('Milk', '¾ cup');
    expect(r.baseQuantity).toBeCloseTo(180);
  });

  it('handles ⅓ cup', () => {
    const r = parseMeasure('Cream', '⅓ cup');
    expect(r.baseQuantity).toBeCloseTo(80);
  });

  it('handles ⅔ cup', () => {
    const r = parseMeasure('Yogurt', '⅔ cup');
    expect(r.baseQuantity).toBeCloseTo(160);
  });

  it('handles ⅛ tsp', () => {
    const r = parseMeasure('Nutmeg', '⅛ tsp');
    expect(r.baseQuantity).toBeCloseTo(0.625);
  });
});

// ─── Slash fractions ─────────────────────────────────────────────────────────

describe('parseMeasure — slash fractions', () => {
  it('handles 1/2 tsp', () => {
    const r = parseMeasure('Pepper', '1/2 tsp');
    expect(r.baseQuantity).toBeCloseTo(2.5);
  });

  it('handles 3/4 cup', () => {
    const r = parseMeasure('Broth', '3/4 cup');
    expect(r.baseQuantity).toBeCloseTo(180);
  });

  it('handles 1/4 cup', () => {
    const r = parseMeasure('Honey', '1/4 cup');
    expect(r.baseQuantity).toBeCloseTo(60);
  });
});

// ─── Mixed numbers ────────────────────────────────────────────────────────────

describe('parseMeasure — mixed numbers', () => {
  it('handles "1 1/2 lbs"', () => {
    const r = parseMeasure('Pork', '1 1/2 lbs');
    expect(r.baseQuantity).toBeCloseTo(1.5 * 453.592);
    expect(r.unit).toBe('g');
  });

  it('handles "1 ½ cups"', () => {
    const r = parseMeasure('Stock', '1 ½ cups');
    expect(r.baseQuantity).toBeCloseTo(360);
  });

  it('handles "2 1/2 tsp"', () => {
    const r = parseMeasure('Paprika', '2 1/2 tsp');
    expect(r.baseQuantity).toBeCloseTo(12.5);
  });
});

// ─── Ranges ──────────────────────────────────────────────────────────────────

describe('parseMeasure — ranges', () => {
  it('handles "2-3 tbsp" → midpoint 2.5', () => {
    const r = parseMeasure('Oil', '2-3 tbsp');
    expect(r.baseQuantity).toBeCloseTo(2.5 * 15);
  });

  it('handles "100-150g" → midpoint 125g', () => {
    const r = parseMeasure('Protein', '100-150g');
    expect(r.baseQuantity).toBeCloseTo(125);
  });
});

// ─── Count / whole units ──────────────────────────────────────────────────────

describe('parseMeasure — count/whole units', () => {
  it('bare number with no unit → whole', () => {
    const r = parseMeasure('Eggs', '3');
    expect(r.baseQuantity).toBe(3);
    expect(r.unit).toBe('whole');
    expect(r.isVague).toBe(false);
  });

  it('"2 cloves" → whole', () => {
    const r = parseMeasure('Garlic', '2 cloves');
    expect(r.baseQuantity).toBe(2);
    expect(r.unit).toBe('whole');
  });

  it('"1 large onion" → whole (large is not a unit token)', () => {
    const r = parseMeasure('Onion', '1 large onion');
    expect(r.baseQuantity).toBe(1);
    expect(r.unit).toBe('whole');
  });

  it('"4 slices" → whole', () => {
    const r = parseMeasure('Bread', '4 slices');
    expect(r.baseQuantity).toBe(4);
    expect(r.unit).toBe('whole');
  });

  it('"1 can" → whole', () => {
    const r = parseMeasure('Tomatoes', '1 can');
    expect(r.baseQuantity).toBe(1);
    expect(r.unit).toBe('whole');
  });
});

// ─── Vague measures ───────────────────────────────────────────────────────────

describe('parseMeasure — vague / empty measures', () => {
  it('empty string → isVague, baseQuantity 0', () => {
    const r = parseMeasure('Salt', '');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
    expect(r.name).toBe('Salt');
  });

  it('"to taste" → isVague', () => {
    const r = parseMeasure('Pepper', 'to taste');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('"a pinch" → isVague', () => {
    const r = parseMeasure('Nutmeg', 'a pinch');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('"pinch" → isVague', () => {
    const r = parseMeasure('Salt', 'pinch');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('"dash" → isVague', () => {
    const r = parseMeasure('Worcestershire', 'dash');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('"garnish" → isVague', () => {
    const r = parseMeasure('Parsley', 'garnish');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('"as needed" → isVague', () => {
    const r = parseMeasure('Oil', 'as needed');
    expect(r.isVague).toBe(true);
    expect(r.baseQuantity).toBe(0);
  });

  it('vague ingredient still gets a name', () => {
    const r = parseMeasure('  Fresh Parsley  ', 'to taste');
    expect(r.name).toBe('Fresh Parsley');
  });
});

// ─── Robustness / edge cases ──────────────────────────────────────────────────

describe('parseMeasure — robustness', () => {
  it('never throws on completely random input', () => {
    expect(() => parseMeasure('???', '!@#$%^&*()')).not.toThrow();
  });

  it('never throws on empty ingredient name', () => {
    expect(() => parseMeasure('', '')).not.toThrow();
  });

  it('trims whitespace from ingredient name', () => {
    const r = parseMeasure('  Chicken  ', '100g');
    expect(r.name).toBe('Chicken');
  });

  it('handles very large quantities without overflow', () => {
    const r = parseMeasure('Water', '10000 ml');
    expect(r.baseQuantity).toBeCloseTo(10000);
    expect(r.isVague).toBe(false);
  });
});

// ─── parseMealIngredients ─────────────────────────────────────────────────────

describe('parseMealIngredients', () => {
  it('filters out entries with blank ingredient names', () => {
    const result = parseMealIngredients([
      { ingredient: 'Chicken', measure: '200g' },
      { ingredient: '', measure: '1 tbsp' },
      { ingredient: '  ', measure: '2 cups' },
      { ingredient: 'Salt', measure: 'to taste' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Chicken');
    expect(result[1].name).toBe('Salt');
  });

  it('returns a ParsedIngredient for every non-blank ingredient', () => {
    const result = parseMealIngredients([
      { ingredient: 'Onion', measure: '1' },
      { ingredient: 'Garlic', measure: '2 cloves' },
      { ingredient: 'Olive Oil', measure: '2 tbsp' },
    ]);
    expect(result).toHaveLength(3);
    expect(result[2].unit).toBe('g');
  });
});

// ─── Density, units and decimal commas ────────────────────────────────────────

describe('parseMeasure — density', () => {
  const TABLE: [string, number][] = [
    ['flour', 125],
    ['sugar', 200],
    ['brown sugar', 210],
    ['powdered sugar', 120],
    ['icing sugar', 120],
    ['rice', 185],
    ['oats', 90],
    ['cocoa powder', 85],
    ['breadcrumbs', 110],
  ];

  it.each(TABLE)('%s: cup, tbsp and tsp use %d g per cup', (name, perCup) => {
    const cup = parseMeasure(name, '1 cup');
    expect(cup.baseQuantity).toBeCloseTo(perCup, 6);
    expect(cup.unit).toBe('g');
    expect(parseMeasure(name, '1 tbsp').baseQuantity).toBeCloseTo(perCup / 16, 6);
    expect(parseMeasure(name, '1 tsp').baseQuantity).toBeCloseTo(perCup / 48, 6);
  });

  it.each([
    ['Mehl', 125],
    ['Zucker', 200],
    ['brauner Zucker', 210],
    ['Puderzucker', 120],
    ['Reis', 185],
    ['Haferflocken', 90],
    ['Kakao', 85],
    ['Paniermehl', 110],
    ['Semmelbrösel', 110],
  ])('German name %s uses %d g per cup', (name, perCup) => {
    expect(parseMeasure(name, '1 cup').baseQuantity).toBeCloseTo(perCup, 6);
  });

  it.each([
    ['plain flour', 125],
    ['Weizenmehl', 125],
    ['caster sugar', 200],
    ['cornflour', 125],
  ])('compound %s uses %d g per cup', (name, perCup) => {
    expect(parseMeasure(name, '1 cup').baseQuantity).toBeCloseTo(perCup, 6);
  });

  it('lets the longest keyword win', () => {
    expect(parseMeasure('brown sugar', '1 cup').baseQuantity).toBe(210);
    expect(parseMeasure('Paniermehl', '1 cup').baseQuantity).toBe(110);
    expect(parseMeasure('Puderzucker', '1 cup').baseQuantity).toBe(120);
  });

  it('keeps water density for non-matches', () => {
    expect(parseMeasure('rice vinegar', '1 cup').baseQuantity).toBe(240);
    expect(parseMeasure('butter lettuce', '1 cup').baseQuantity).toBe(240);
  });

  it('keeps water density for liquids and other ingredients', () => {
    expect(parseMeasure('Milk', '1 cup').baseQuantity).toBe(240);
    expect(parseMeasure('Honey', '1 tbsp').baseQuantity).toBe(15);
    expect(parseMeasure('Olive Oil', '1 tsp').baseQuantity).toBe(5);
  });

  it('converts millilitres of a matched ingredient to grams', () => {
    const r = parseMeasure('Flour', '100 ml');
    expect(r.baseQuantity).toBeCloseTo(52.083, 3);
    expect(r.unit).toBe('g');
  });

  it('leaves litres and kilograms alone', () => {
    expect(parseMeasure('Flour', '1 l')).toMatchObject({ baseQuantity: 1000, unit: 'ml' });
    expect(parseMeasure('Flour', '1 kg')).toMatchObject({ baseQuantity: 1000, unit: 'g' });
  });

  it('keeps the name as given', () => {
    expect(parseMeasure('Flour, sifted', '1 cup').name).toBe('Flour, sifted');
    expect(parseMeasure('Flour, sifted', '1 cup').baseQuantity).toBe(125);
  });
});

describe('parseMeasure — fluid ounces', () => {
  it('reads 2 floz as 59.14 ml', () => {
    const r = parseMeasure('Milk', '2 floz');
    expect(r.baseQuantity).toBeCloseTo(59.14, 2);
    expect(r.unit).toBe('ml');
  });

  it('reads 2 fl oz of flour as grams', () => {
    const r = parseMeasure('Flour', '2 fl oz');
    expect(r.baseQuantity).toBeCloseTo(30.8, 2);
    expect(r.unit).toBe('g');
  });
});

describe('parseMeasure — decimal commas', () => {
  it.each([
    ['1,5 kg', 1500, 'g'],
    ['1,000 g', 1000, 'g'],
    ['1,5 EL', 22.5, 'g'],
    ['0,25 l', 250, 'ml'],
    ['0,125 l', 125, 'ml'],
    ['12,500 g', 12500, 'g'],
  ])('reads %s as %d %s', (measure, quantity, unit) => {
    const r = parseMeasure('Beef', measure);
    expect(r.baseQuantity).toBeCloseTo(quantity, 6);
    expect(r.unit).toBe(unit);
  });
});

describe('parseMeasure — pinch', () => {
  it('reads a counted pinch as 0.5 g', () => {
    expect(parseMeasure('Salt', '1 pinch')).toMatchObject({ baseQuantity: 0.5, unit: 'g', isVague: false });
  });

  it('reads pinches in the plural', () => {
    expect(parseMeasure('Salt', '2 pinches')).toMatchObject({ baseQuantity: 1, unit: 'g', isVague: false });
  });

  it('keeps a pinch without a count vague', () => {
    expect(parseMeasure('Salt', 'a pinch')).toMatchObject({ baseQuantity: 0, isVague: true });
  });
});

describe('parseMeasure — EL and TL', () => {
  it.each([
    ['1 EL', 15],
    ['1 el.', 15],
    ['2 TL', 10],
    ['1 tl', 5],
  ])('reads %s as %d g', (measure, grams) => {
    expect(parseMeasure('Butter', measure)).toMatchObject({ baseQuantity: grams, unit: 'g' });
  });
});
