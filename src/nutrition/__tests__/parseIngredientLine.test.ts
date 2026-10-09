import { parseIngredientLine } from '../parseIngredientLine';

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
