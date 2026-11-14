import { parseIngredientLine } from '../parseIngredientLine';
import { parseMeasure } from '../parseMeasure';

describe('parseIngredientLine', () => {
  it.each([
    ['500 g Hackfleisch', 500, 'g', 'Hackfleisch'],
    ['500g Hackfleisch', 500, 'g', 'Hackfleisch'],
    ['1 EL Olivenöl', 15, 'g', 'Olivenöl'],
    ['2 Essl. Honig', 30, 'g', 'Honig'],
    ['3 TL Zucker', 12.5, 'g', 'Zucker'],
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
    ['1 Tasse Reis', 185, 'g', 'Reis'],
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

describe('parseIngredientLine unsure lines', () => {
  it.each([
    '1.000 g Mehl',
    '2.500 kg Kartoffeln',
    '12.000 g Zucker',
    '1.000.000 g Salz',
  ])('keeps dot-grouped %s as a name without a quantity', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: line, quantity: 0, unit: 'g' });
  });

  it.each([
    ['0.125 l Milch', 125, 'ml', 'Milch'],
    ['1.5 kg Mehl', 1500, 'g', 'Mehl'],
    ['2.25 cups sugar', 450, 'g', 'sugar'],
    ['1.0005 kg Mehl', 1000.5, 'g', 'Mehl'],
  ])('reads %s as a decimal', (line, quantity, unit, name) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity, unit });
  });

  it.each([
    ["1'000 g Mehl"],
    ['1’000 g Mehl'],
  ])('reads the apostrophe-grouped %s as 1000', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: 'Mehl', quantity: 1000, unit: 'g' });
  });

  it.each([
    ['99999999999999999999 g Mehl'],
    [`${'9'.repeat(190)} g Mehl`],
    ['100001 g Mehl'],
  ])('keeps an absurd quantity as a name without a quantity', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: line, quantity: 0, unit: 'g' });
  });

  it('accepts a quantity at the limit', () => {
    expect(parseIngredientLine('100000 g Mehl')).toEqual({ name: 'Mehl', quantity: 100000, unit: 'g' });
  });

  it.each([
    '2 x 400 g Dose Tomaten',
    '2x400g Tomaten',
    '3 × 125 g Mozzarella',
  ])('keeps the multiplier form %s as a name without a quantity', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: line, quantity: 0, unit: 'g' });
  });

  it('removes leading punctuation from the name', () => {
    expect(parseIngredientLine('1 TL, gestr. Backpulver')).toEqual({
      name: 'gestr. Backpulver',
      quantity: 5,
      unit: 'g',
    });
    expect(parseIngredientLine('2 EL: - Öl')).toEqual({ name: 'Öl', quantity: 30, unit: 'g' });
  });

  it('keeps the whole line when only punctuation is left', () => {
    expect(parseIngredientLine('1 TL,')).toEqual({ name: '1 TL,', quantity: 0, unit: 'g' });
    expect(parseIngredientLine('200 g -')).toEqual({ name: '200 g -', quantity: 0, unit: 'g' });
  });
});

const expectNameOnly = (line: string) =>
  expect(parseIngredientLine(line)).toEqual({ name: line, quantity: 0, unit: 'g' });

describe('parseIngredientLine allow-list', () => {
  it('reads a hyphenated mixed number as a sum, not a range', () => {
    expect(parseMeasure('flour', '1.5 cup').baseQuantity).toBe(187.5);
    expect(parseIngredientLine('1-1/2 cups flour')).toEqual({ name: 'flour', quantity: 187.5, unit: 'g' });
    expect(parseIngredientLine('2-1/4 cups flour')).toEqual({ name: 'flour', quantity: 281.25, unit: 'g' });
  });

  it.each([
    ['1 ½ cups sugar', 'sugar', 300],
    ['1½ cups sugar', 'sugar', 300],
    ['1 1/2 cups sugar', 'sugar', 300],
    ['1,5 kg Mehl', 'Mehl', 1500],
    ['2-3 EL Öl', 'Öl', 37.5],
    ['500 gramm Mehl', 'Mehl', 500],
    ['1 Kilo Kartoffeln', 'Kartoffeln', 1000],
    ['2 Esslöffel Öl', 'Öl', 30],
    ['3 Teelöffel Zucker', 'Zucker', 12.5],
    ['3 tbs sugar', 'sugar', 37.5],
    ['2 Liter Wasser', 'Wasser', 2000],
    ['200 Milliliter Milch', 'Milch', 200],
    ['1 can (14.5 oz) diced tomatoes', '(14.5 oz) diced tomatoes', 1],
    ['2 cups of flour', 'flour', 250],
    ['2 Tassen von Reis', 'Reis', 370],
    ['2 extra large eggs', 'extra large eggs', 2],
    ['1 xl egg', 'xl egg', 1],
    ['3 Eier (Größe M)', 'Eier (Größe M)', 3],
    ['1 jar pasta sauce', 'jar pasta sauce', 1],
    ['0,125 l Milch', 'Milch', 125],
    ['0.500 kg Mehl', 'Mehl', 500],
  ])('parses %s', (line, name, quantity) => {
    const result = parseIngredientLine(line);
    expect(result.name).toBe(name);
    expect(result.quantity).toBeCloseTo(quantity, 2);
  });

  it.each([
    '1,000 g flour',
    '2,500 g sugar',
    '1,000 ml milk',
    '12,000 g Zucker',
    '1/0 cup flour',
    '3-2 cups flour',
    '2-2 cups flour',
    '1-2-3 cups flour',
    '1 3/2 cups flour',
    '1-1.000 g flour',
    '8 fl oz milk',
    '1 pint cream',
    '1 quart stock',
    '1 gallon water',
    '1 qt water',
    '2 pt cream',
    '2 T butter',
    '1 t salt',
    '1 c flour',
    '2 c sugar',
    '1 stick butter',
    '2 inches ginger',
    '1 inch piece ginger',
    '1 pkg yeast',
    '1 package yeast',
    '1 mug flour',
    '1 gr. Zwiebel',
    '1 Becher Sahne',
    '1 Würfel Hefe',
    '1 cup/240 ml milk',
  ])('keeps %s as a name without a quantity', (line) => {
    expectNameOnly(line);
  });
});

describe('parseIngredientLine invariants', () => {
  const MEASURE_WORDS = [
    'g', 'gram', 'grams', 'gramm', 'kg', 'kilo', 'kilogramm', 'kilogram', 'ml', 'milliliter', 'millilitre',
    'l', 'L', 'liter', 'litre', 'dl', 'cl', 'cc', 'tsp', 'tsp.', 'TSP', 'teaspoon', 'teaspoons', 'tbsp',
    'Tbsp.', 'TBSP', 'tablespoon', 'tablespoons', 'tb', 'tbs', 'Tbs', 'TBS', 'tbl', 'cup', 'cups', 'oz',
    'oz.', 'ounce', 'ounces', 'lb', 'lbs', 'lbs.', 'pound', 'pounds', 'EL', 'EL.', 'Essl.', 'Esslöffel',
    'TL', 'TL.', 'Teelöffel', 'Tasse', 'Tassen', 'clove', 'cloves', 'Zehe', 'Zehen', 'Dose', 'Päckchen',
    'Bund', 'Scheibe', 'Stück', 'Stk.', 'head', 'bunch', 'sprig', 'slice', 'piece', 'can', 'tin', 'bag',
    'pack', 'packet',
    't', 'T', 't.', 'c', 'C', 'c.', 'fl', 'fl.', 'FL', 'floz', 'fluid', 'pt', 'pts', 'qt', 'qts', 'gal',
    'gallon', 'gallons', 'pint', 'pints', 'quart', 'quarts', 'in', 'in.', 'inch', 'inches', 'stick',
    'sticks', 'pkg', 'pkg.', 'pkt', 'package', 'packages', 'mug', 'glass', 'shot', 'drop', 'drops',
    'splash', 'dash', 'drizzle', 'glug', 'knob', 'handful', 'gr', 'Gr', 'gr.', 'cube', 'bowl', 'spoon',
    'spoonful', 'scoop', 'dollop', 'sheet', 'strip', 'mg', 'cm', 'mm', 'meter', 'ft', 'yard', 'Glas',
    'Becher', 'Schuss', 'Spritzer', 'Tropfen', 'Würfel', 'Tafel', 'Riegel', 'Kugel', 'Löffel', 'Schale',
    'Tüte', 'Beutel', 'Pfund', 'Pfd.', 'Unze', 'Zentimeter', 'Deziliter', 'Zentiliter', 'Pk.', 'Pr.', 'Pk', 'Pr',
  ];
  const QUANTITIES = ['1', '2', '1/2', '1 1/2'];

  it('covers at least 80 words', () => {
    expect(MEASURE_WORDS.length).toBeGreaterThanOrEqual(80);
  });

  it.each(MEASURE_WORDS)('never leaves the measure word %s in a counted name', (word) => {
    for (const quantity of QUANTITIES) {
      const line = `${quantity} ${word} flour`;
      const result = parseIngredientLine(line);
      const unitTaken = result.name === 'flour' && result.quantity > 0;
      const unsure = result.quantity === 0 && result.name === line;
      expect({ line, ok: unitTaken || unsure }).toEqual({ line, ok: true });
    }
  });

  it.each([
    '1 to 2 tablespoons oil',
    '3 to 4 cups flour',
    '1 and 1/2 cups flour',
    '1 or 2 eggs',
    '2 or 3 cloves garlic',
    '1/2 cup plus 2 tablespoons sugar',
    '1 tablespoon plus 1 teaspoon oil',
    '1 cup + 2 tbsp flour',
    '1 cup/240 ml milk',
    '2 x 400 g Dose Tomaten',
    '2x400g Tomaten',
    '3 × 125 g Mozzarella',
    '2 bis 3 EL Öl',
    '1 EL plus 1 TL Zucker',
    '1 EL und 1 TL Zucker',
    '2 oder 3 Zwiebeln',
    '1 cup & 2 tbsp flour',
    '1 EL + 1 TL Honig',
    '1 cup / 240 ml milk',
    '1 1/2 cups plus 1 tbsp flour',
    '2 tbsp + 1 tsp sugar',
    '1/2 cup and 2 tbsp sugar',
    '1 kg or 2 lb potatoes',
    '500 g oder 1 Pfund Mehl',
    '3 to 4 Zwiebeln',
    '1 x 400 g can tomatoes',
    '1 plus 2 eggs',
    '1 cup to 2 cups water',
    '1 TL bis 2 TL Salz',
    '2 tbsp plus extra for the dish',
    '4 - 5 to 6 cups flour',
    '1 cup 240 ml milk',
  ])('keeps %s as the whole line', (line) => {
    expectNameOnly(line);
  });
});

describe('sprint 5 probe lines', () => {
  it.each([
    '1 heaped tsp sugar',
    '2 level tablespoons flour',
    '1 scant cup milk',
    '2 gestrichene TL Backpulver',
    '1 gehäufter EL Zucker',
    '2 level tsp salt',
    '1 rounded tablespoon honey',
    '1 large tsp sugar',
    '1 gestr. TL Salz',
    '2 large cloves garlic',
    '1 fresh bunch parsley',
    '1 Pk. Hefe',
    '1 Pr. Salz',
    '1 tsp each salt and pepper',
    '1 TL je Salz und Pfeffer',
    '1 EL je',
  ])('round 3: keeps %s as a name without a quantity', (line) => {
    expectNameOnly(line);
  });

  it.each([
    ['250 gr butter', 'butter', 250],
    ['100 gr. Butter', 'Butter', 100],
    ['250g/9oz plain flour', 'plain flour', 250],
    ['100 g/3.5 oz flour', 'flour', 100],
    ['200 g/7 oz butter', 'butter', 200],
    ['500 g Mehl Type 405', 'Mehl Type 405', 500],
    ['200 g Mehl 405', 'Mehl 405', 200],
  ])('reads %s', (line, name, quantity) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity, unit: 'g' });
  });

  it.each([
    '1 gr. Zwiebel',
    '1 Becher Schmand',
    '1 Glas Rotwein',
    '1/2 Würfel Hefe',
    '1.000 g Mehl',
    '1,000 g flour',
    '1,000 ml milk',
    '8 fl oz milk',
    '1 pint cream',
    '1 quart stock',
    '1 gallon water',
    '2 T butter',
    '1 t salt',
    '1 c flour',
    '1 to 2 tablespoons oil',
    '1/2 cup plus 2 tablespoons sugar',
    '1 cup/240 ml milk',
    '250 ml/9 fl oz milk',
    '1 cup 240 ml milk',
    '2 cups flour, plus 2 tablespoons',
    '1 g 250 flour',
  ])('guard: keeps %s as a name without a quantity', (line) => {
    expectNameOnly(line);
  });

  it('guard: keeps the count of 2 Stangen Lauch', () => {
    expect(parseIngredientLine('2 Stangen Lauch')).toEqual({ name: 'Stangen Lauch', quantity: 2, unit: 'whole' });
  });

  it.each([
    ['2 extra large eggs', 'extra large eggs', 2],
    ['1 xl egg', 'xl egg', 1],
    ['3 Eier (Größe M)', 'Eier (Größe M)', 3],
    ['1 jar pasta sauce', 'jar pasta sauce', 1],
    ['2 große Zwiebeln', 'große Zwiebeln', 2],
  ])('guard: keeps the count of %s', (line, name, quantity) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity, unit: 'whole' });
  });

  it.each([
    ['1-1/2 cups flour'],
    ['1 1/2 cups flour'],
  ])('guard: %s weighs flour at its own density', (line) => {
    expect(parseIngredientLine(line)).toEqual({ name: 'flour', quantity: 187.5, unit: 'g' });
  });

  it('reads gr as grams from 10 up only', () => {
    expect(parseIngredientLine('10 gr flour')).toEqual({ name: 'flour', quantity: 10, unit: 'g' });
    expectNameOnly('9 gr flour');
  });

  it('takes a second measure only after a mass unit and only when it is a unit', () => {
    expect(parseIngredientLine('1 kg/2.2 lb potatoes')).toEqual({ name: 'potatoes', quantity: 1000, unit: 'g' });
    expectNameOnly('250 g/2 Zwiebeln');
  });

  it('returns quickly on long hostile lines', () => {
    for (const line of ['1 '.repeat(250), '1/'.repeat(250), '123456789/'.repeat(50)]) {
      const started = Date.now();
      const result = parseIngredientLine(line);
      expect(Date.now() - started).toBeLessThan(50);
      expect(result.quantity).toBe(0);
    }
  });
});

describe('sprint 6 round 1 probe lines', () => {
  it.each([
    '1 slightly heaped tsp salt',
    '1 very heaped tsp salt',
    '1 good heaped tbsp sugar',
    '1 generous heaped tbsp sugar',
    '1 slightly rounded tablespoon honey',
    '1 slightly scant cup flour',
    '1 not quite level tsp salt',
    '1 big heaped tsp salt',
    '1 gut gehäufter EL Zucker',
    '1 sehr gehäufter TL Zimt',
    '1 knapper gestrichener EL Mehl',
    '1 gut gestrichener TL Salz',
    '1 ganz kleiner TL Salz',
    '2 fast volle EL Mehl',
    '2 sehr große Tassen Mehl',
  ])('keeps %s as a name without a quantity (words before the unit)', (line) => {
    expectNameOnly(line);
  });

  it.each([
    '1 (heaped) tsp salt',
    '1 (gestr.) TL Salz',
    '1 (scant) cup milk',
    '1 (level) tbsp sugar',
    '1 (rounded) tablespoon honey',
    '1 level-tsp salt',
  ])('keeps %s as a name without a quantity (brackets and hyphens)', (line) => {
    expectNameOnly(line);
  });

  it.each([
    '1 each red and green pepper',
    '2 each red and yellow peppers',
    '1 of each: red and green pepper',
    '1 jede Paprika',
    '1 TL jeweils Salz und Pfeffer',
    '1 EL jeweils Salz',
    '1 TL von jedem',
    '1 each of red and green pepper',
  ])('keeps %s as a name without a quantity (each-words)', (line) => {
    expectNameOnly(line);
  });

  it.each(['1 Teel. Salz', '1 Pak. Hefe', '1 P. Backpulver'])(
    'keeps %s as a name without a quantity (abbreviations)',
    (line) => {
      expectNameOnly(line);
    },
  );

  it('keeps a count when only a part after the first comma is a measure word', () => {
    expect(parseIngredientLine('2 Zwiebeln, in Ringen')).toEqual({ name: 'Zwiebeln, in Ringen', quantity: 2, unit: 'whole' });
    expect(parseIngredientLine('2 t-bone steaks')).toEqual({ name: 't-bone steaks', quantity: 2, unit: 'whole' });
  });
});

describe('sprint 6 round 2 probe lines', () => {
  it.each(['1 level, tsp salt', '1 heaped, tsp salt', '1 good heaped, level tbsp sugar'])(
    'keeps %s as a name without a quantity (unit word after a comma)',
    (line) => {
      expectNameOnly(line);
    },
  );
});

describe('sprint 6 round 3 probe lines', () => {
  it.each([
    '1 cup flour plus a tablespoon',
    '1 cup flour, plus a tbsp for dusting',
    '1 cup flour and a tbsp',
    '1 EL Mehl plus ein TL',
    '1 EL Mehl und ein TL Zucker',
    '1 Tasse Mehl plus einen EL',
    '1 Tasse Mehl, dazu ein EL',
    '2 cloves garlic or a tsp of powder',
    '2 Zehen Knoblauch oder ein TL Knoblauchpulver',
    '200 g Butter oder ein EL Öl',
    '200 g flour or a cup',
  ])('keeps %s as a name without a quantity (second measure in the name)', (line) => {
    expectNameOnly(line);
  });

  it.each([
    ['1 can (14 oz) tomatoes', '(14 oz) tomatoes', 1],
    ['1 Dose Tomaten (400 g)', 'Tomaten (400 g)', 1],
  ])('keeps the count of %s', (line, name, quantity) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity, unit: 'whole' });
  });
});
