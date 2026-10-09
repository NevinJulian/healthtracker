import { parseIngredientLine } from '../parseIngredientLine';
import { parseMeasure } from '../parseMeasure';

describe('parseIngredientLine', () => {
  it.each([
    ['500 g Hackfleisch', 500, 'g', 'Hackfleisch'],
    ['500g Hackfleisch', 500, 'g', 'Hackfleisch'],
    ['1 EL Olivenöl', 15, 'g', 'Olivenöl'],
    ['2 Essl. Honig', 30, 'g', 'Honig'],
    ['3 TL Zucker', 15, 'g', 'Zucker'],
    ['1,5 kg Mehl', 1500, 'g', 'Mehl'],
    ['2-3 EL Öl', 37.5, 'g', 'Öl'],
    ['2–3 EL Öl', 37.5, 'g', 'Öl'],
    ['½ TL Salz', 2.5, 'g', 'Salz'],
    ['1/2 TL Salz', 2.5, 'g', 'Salz'],
    ['ca. 200 g Mehl', 200, 'g', 'Mehl'],
    ['circa 200 g Mehl', 200, 'g', 'Mehl'],
    ['~200 g Mehl', 200, 'g', 'Mehl'],
    ['2 Zwiebeln', 2, 'whole', 'Zwiebeln'],
    ['2 Zehen Knoblauch', 2, 'whole', 'Knoblauch'],
    ['1 Dose Tomaten', 1, 'whole', 'Tomaten'],
    ['2 Stk. Eier', 2, 'whole', 'Eier'],
    ['1 Bund Petersilie', 1, 'whole', 'Petersilie'],
    ['3 dl Milch', 300, 'ml', 'Milch'],
    ['5 cl Rum', 50, 'ml', 'Rum'],
    ['250 ml Wasser', 250, 'ml', 'Wasser'],
    ['1 l Milch', 1000, 'ml', 'Milch'],
    ['1 Tasse Reis', 240, 'g', 'Reis'],
  ])('%s', (line, quantity, unit, name) => {
    expect(parseIngredientLine(line as string)).toEqual({ name, quantity, unit });
  });

  it.each([
    ['1 Prise Salz', '1 Prise Salz'],
    ['etwas Pfeffer', 'etwas Pfeffer'],
    ['Salz nach Geschmack', 'Salz nach Geschmack'],
    ['200 g', '200 g'],
    ['Basilikum', 'Basilikum'],
  ])('keeps %s as a name without a quantity', (line, name) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity: 0, unit: 'g' });
  });

  it('never throws on empty or odd input', () => {
    expect(parseIngredientLine('').quantity).toBe(0);
    expect(parseIngredientLine('   ').quantity).toBe(0);
    expect(() => parseIngredientLine('9'.repeat(5000))).not.toThrow();
    expect(() => parseIngredientLine('\u0000 1/0 g x')).not.toThrow();
    expect(Number.isFinite(parseIngredientLine('1/0 g Mehl').quantity)).toBe(true);
  });
});

describe('parseIngredientLine English units', () => {
  it.each([
    ['1 1/2 cups flour', 'flour', '1 1/2 cup'],
    ['1 tablespoon olive oil', 'olive oil', '1 tbsp'],
    ['8 ounces cream cheese', 'cream cheese', '8 oz'],
    ['1 lb ground beef', 'ground beef', '1 lb'],
    ['3/4 cup warm water', 'warm water', '3/4 cup'],
    ['1/4 teaspoon salt', 'salt', '1/4 tsp'],
    ['2 tsp active dry yeast', 'active dry yeast', '2 tsp'],
    ['½ cup sugar', 'sugar', '½ cup'],
    ['2 cloves garlic, minced', 'garlic, minced', '2 clove'],
    ['3 tablespoons minced red onion', 'minced red onion', '3 tbsp'],
    ['2 tbsp olive oil, plus extra for the dish', 'olive oil, plus extra for the dish', '2 tbsp'],
    ['2 lbs. potatoes', 'potatoes', '2 lb'],
    ['1 Tbsp. butter', 'butter', '1 tbsp'],
  ])('%s', (line, name, measure) => {
    const expected = parseMeasure(name, measure);
    const result = parseIngredientLine(line);
    expect(result.name).toBe(name);
    expect(result.unit).toBe(expected.unit);
    expect(result.quantity).toBeCloseTo(expected.baseQuantity, 2);
    expect(result.quantity).toBeGreaterThan(0);
  });

  it('keeps a count without a unit word as a whole count', () => {
    expect(parseIngredientLine('3 eggs')).toEqual({ name: 'eggs', quantity: 3, unit: 'whole' });
  });

  it('does not take a hyphenated word for a unit', () => {
    expect(parseIngredientLine('2 t-bone steaks')).toEqual({
      name: 't-bone steaks',
      quantity: 2,
      unit: 'whole',
    });
  });

  it.each([
    'salt and pepper to taste',
    'a pinch of salt',
    '1 pinch salt',
    'pinch of nutmeg',
    'to taste',
    'parsley for serving',
    'water as needed',
  ])('keeps %s as a name without a quantity', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: line, quantity: 0, unit: 'g' });
  });
});
