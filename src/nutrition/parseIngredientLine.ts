import { parseMeasure } from './parseMeasure';

export interface ParsedIngredientLine {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'whole';
}

const MAX_LINE_LENGTH = 500;
const MAX_QUANTITY = 100000;
const DOT_GROUPED = /(?:^|[^\d.,])[1-9]\d{0,2}(?:\.\d{3})+(?!\d)/;
const APOSTROPHE_GROUPED = /^\d{1,3}(?:['’]\d{3})+(?!\d)/;
const MULTIPLIER = /^\s*[x×]\s*\d/i;
const LEADING_FILLER = /^[\s,.:\-–—]+/;
const FRACTIONS = '½¼¾⅓⅔⅛⅜⅝⅞';

const SINGLE = String.raw`(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s+\d+\s*\/\s*\d+|\s*[${FRACTIONS}])?|[${FRACTIONS}])`;
const LEADING_QUANTITY = new RegExp(String.raw`^(${SINGLE}(?:\s*[-–]\s*${SINGLE})?)`);
const LEADING_APPROX = /^(?:ca\.?|circa|~)\s*/i;
const UNIT_WORD = /^\s*([A-Za-zÄÖÜäöüß]+)\.?(?![A-Za-zÄÖÜäöüß])/;
const VAGUE =
  /(?:^|[^a-zäöüß])(?:prisen?|msp|messerspitze|schuss|handvoll|etwas|nach\s+geschmack|evtl|pinch(?:es)?|to\s+taste|for\s+serving|as\s+needed)(?![a-zäöüß])/i;

const ENGLISH_UNITS: ReadonlyMap<string, string> = new Map(
  [
    'g', 'gram', 'gr', 'kg', 'kilogram', 'ml', 'milliliter', 'millilitre', 'cc',
    'l', 'liter', 'litre', 'tsp', 'teaspoon', 'tbsp', 'tablespoon', 'tbl', 'cup',
    'oz', 'ounce', 'lb', 'pound', 'floz', 'clove', 'head', 'bulb', 'bunch', 'sprig',
    'stalk', 'piece', 'slice', 'can', 'tin', 'packet', 'pack', 'bag',
  ].map((word) => [word, word] as const),
);

function englishUnit(word: string): string | undefined {
  const lower = word.toLowerCase();
  const exact = ENGLISH_UNITS.get(lower);
  if (exact !== undefined) return exact;
  return lower.length > 2 && lower.endsWith('s') ? ENGLISH_UNITS.get(lower.slice(0, -1)) : undefined;
}

const UNIT_WORDS: Record<string, { unit: string; factor: number }> = {
  el: { unit: 'tbsp', factor: 1 },
  essl: { unit: 'tbsp', factor: 1 },
  tl: { unit: 'tsp', factor: 1 },
  dl: { unit: 'ml', factor: 100 },
  cl: { unit: 'ml', factor: 10 },
  kg: { unit: 'kg', factor: 1 },
  g: { unit: 'g', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'l', factor: 1 },
  zehe: { unit: 'clove', factor: 1 },
  zehen: { unit: 'clove', factor: 1 },
  stk: { unit: 'piece', factor: 1 },
  stück: { unit: 'piece', factor: 1 },
  stueck: { unit: 'piece', factor: 1 },
  dose: { unit: 'can', factor: 1 },
  dosen: { unit: 'can', factor: 1 },
  päckchen: { unit: 'packet', factor: 1 },
  paeckchen: { unit: 'packet', factor: 1 },
  pck: { unit: 'packet', factor: 1 },
  packung: { unit: 'packet', factor: 1 },
  bund: { unit: 'bunch', factor: 1 },
  scheibe: { unit: 'slice', factor: 1 },
  scheiben: { unit: 'slice', factor: 1 },
  tasse: { unit: 'cup', factor: 1 },
  tassen: { unit: 'cup', factor: 1 },
};

function nameOnly(name: string): ParsedIngredientLine {
  return { name, quantity: 0, unit: 'g' };
}

export function parseIngredientLine(line: string): ParsedIngredientLine {
  const whole = typeof line === 'string' ? line.trim() : '';
  try {
    if (whole === '' || whole.length > MAX_LINE_LENGTH || VAGUE.test(whole)) {
      return nameOnly(whole);
    }

    const rest = whole
      .replace(LEADING_APPROX, '')
      .replace(APOSTROPHE_GROUPED, (grouped) => grouped.replace(/['’]/g, ''));
    const qty = LEADING_QUANTITY.exec(rest);
    if (!qty || DOT_GROUPED.test(qty[1])) return nameOnly(whole);

    const quantityText = qty[1].replace(/(\d),(\d)/g, '$1.$2');
    let afterQuantity = rest.slice(qty[0].length);
    if (MULTIPLIER.test(afterQuantity)) return nameOnly(whole);

    let unit = '';
    let factor = 1;
    const word = UNIT_WORD.exec(afterQuantity);
    if (word) {
      const known = Object.prototype.hasOwnProperty.call(UNIT_WORDS, word[1].toLowerCase())
        ? UNIT_WORDS[word[1].toLowerCase()]
        : undefined;
      const english = known ? undefined : englishUnit(word[1]);
      if (known) {
        unit = known.unit;
        factor = known.factor;
        afterQuantity = afterQuantity.slice(word[0].length);
      } else if (english !== undefined) {
        unit = english;
        afterQuantity = afterQuantity.slice(word[0].length);
      }
    }

    const name = afterQuantity.replace(LEADING_FILLER, '').trim();
    if (name === '') return nameOnly(whole);

    const parsed = parseMeasure(name, `${quantityText} ${unit}`.trim());
    const quantity = Math.round(parsed.baseQuantity * factor * 100) / 100;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return nameOnly(whole);
    }

    return { name, quantity, unit: parsed.unit };
  } catch {
    return nameOnly(whole);
  }
}
