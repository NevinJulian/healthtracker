import { parseMeasure } from './parseMeasure';

export interface ParsedIngredientLine {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'whole';
}

const MAX_LINE_LENGTH = 500;
const MAX_QUANTITY = 100000;
const MAX_NUMBER = 1e9;
const FRACTIONS = '½¼¾⅓⅔⅛⅜⅝⅞';

const UNICODE_FRACTION_VALUES: ReadonlyMap<string, number> = new Map([
  ['½', 0.5],
  ['¼', 0.25],
  ['¾', 0.75],
  ['⅓', 1 / 3],
  ['⅔', 2 / 3],
  ['⅛', 0.125],
  ['⅜', 0.375],
  ['⅝', 0.625],
  ['⅞', 0.875],
]);

const LEADING_APPROX = /^(?:ca\.?|circa|~)\s*/i;
const APOSTROPHE_GROUPED = /^\d{1,3}(?:['’]\d{3})+(?!\d)/;
const MIXED_SLASH = /^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)(?!\d)/;
const MIXED_UNICODE = new RegExp(String.raw`^(\d+)\s*([${FRACTIONS}])`);
const RANGE = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/;
const SLASH_FRACTION = /^(\d+)\s*\/\s*(\d+)(?!\d)/;
const UNICODE_FRACTION = new RegExp(String.raw`^[${FRACTIONS}]`);
const DECIMAL = /^\d+(?:[.,]\d+)?/;
const AMBIGUOUS_GROUPED = /^[1-9]\d{0,2}(?:[.,]\d{3})+$/;

const MULTIPLIER = /^\s*[x×]\s*\d/i;
const UNIT_WORD = /^\s*([A-Za-zÄÖÜäöüß]+)\.?(?![A-Za-zÄÖÜäöüß])/;
const FIRST_WORD = /^([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)/;
const LEADING_FILLER = /^[\s,.:\-–—]+/;
const LEADING_OF = /^(?:of|von)\s+/i;
const BRACKETED = /\([^()]*\)/g;
const NUMBER_CHARACTER = new RegExp(String.raw`[\d${FRACTIONS}]`);
const BAD_NAME_START = /^[+/&]/;
const CONNECTORS: ReadonlySet<string> = new Set(['to', 'or', 'and', 'plus', 'bis', 'oder', 'und', 'x', '×']);

const VAGUE =
  /(?:^|[^a-zäöüß])(?:prisen?|msp|messerspitze|schuss|handvoll|etwas|nach\s+geschmack|evtl|pinch(?:es)?|to\s+taste|for\s+serving|as\s+needed)(?![a-zäöüß])/i;

const ENGLISH_UNITS: ReadonlyMap<string, string> = new Map(
  [
    'g', 'gram', 'kg', 'kilogram', 'ml', 'milliliter', 'millilitre', 'cc',
    'l', 'liter', 'litre', 'tsp', 'teaspoon', 'tbsp', 'tablespoon', 'tb', 'tbs', 'tbl', 'cup',
    'oz', 'ounce', 'lb', 'pound', 'clove', 'head', 'bulb', 'bunch', 'sprig',
    'stalk', 'piece', 'slice', 'can', 'tin', 'packet', 'pack', 'bag',
  ].map((word) => [word, word] as const),
);

const UNSURE_WORDS: ReadonlySet<string> = new Set([
  't', 'c', 'fl', 'floz', 'fluid', 'pt', 'qt', 'gal', 'gallon', 'pint', 'quart', 'in', 'inch', 'inches',
  'stick', 'pkg', 'pkt', 'package', 'mug', 'glass', 'shot', 'drop', 'splash', 'dash', 'drizzle', 'glug',
  'knob', 'handful', 'gr', 'cube', 'bowl', 'cupful', 'spoon', 'spoonful', 'dessertspoon', 'dsp', 'scoop',
  'dollop', 'sheet', 'strip', 'mg', 'milligram', 'microgram', 'dl', 'deciliter', 'decilitre', 'centiliter',
  'centilitre', 'cm', 'mm', 'centimeter', 'centimetre', 'millimeter', 'millimetre', 'meter', 'metre', 'ft',
  'foot', 'feet', 'yard', 'ltr', 'lt', 'tablespoonful', 'teaspoonful',
  'glas', 'becher', 'schuss', 'spritzer', 'tropfen', 'würfel', 'wuerfel', 'tafel', 'riegel', 'kugel',
  'löffel', 'kaffeelöffel', 'schale', 'schälchen', 'tüte', 'beutel', 'kelle', 'pfund', 'pfd', 'unze',
  'zentiliter', 'deziliter', 'zentimeter', 'meter', 'milligramm', 'messerspitze', 'prise', 'finger',
]);

function englishUnit(word: string): string | undefined {
  const lower = word.toLowerCase();
  const exact = ENGLISH_UNITS.get(lower);
  if (exact !== undefined) return exact;
  return lower.length > 2 && lower.endsWith('s') ? ENGLISH_UNITS.get(lower.slice(0, -1)) : undefined;
}

function isUnsureWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (UNSURE_WORDS.has(lower)) return true;
  if (lower.endsWith('s') && UNSURE_WORDS.has(lower.slice(0, -1))) return true;
  return lower.endsWith('es') && UNSURE_WORDS.has(lower.slice(0, -2));
}

const UNIT_WORDS: Record<string, { unit: string; factor: number }> = {
  el: { unit: 'tbsp', factor: 1 },
  essl: { unit: 'tbsp', factor: 1 },
  esslöffel: { unit: 'tbsp', factor: 1 },
  tl: { unit: 'tsp', factor: 1 },
  teelöffel: { unit: 'tsp', factor: 1 },
  dl: { unit: 'ml', factor: 100 },
  cl: { unit: 'ml', factor: 10 },
  kg: { unit: 'kg', factor: 1 },
  kilo: { unit: 'kg', factor: 1 },
  kilogramm: { unit: 'kg', factor: 1 },
  g: { unit: 'g', factor: 1 },
  gramm: { unit: 'g', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  milliliter: { unit: 'ml', factor: 1 },
  l: { unit: 'l', factor: 1 },
  liter: { unit: 'l', factor: 1 },
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

interface LeadingQuantity {
  value: number;
  length: number;
}

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

function isAmbiguousGrouped(text: string): boolean {
  return AMBIGUOUS_GROUPED.test(text);
}

function readQuantity(rest: string): LeadingQuantity | null {
  const mixedSlash = MIXED_SLASH.exec(rest);
  if (mixedSlash) {
    const numerator = Number(mixedSlash[2]);
    const denominator = Number(mixedSlash[3]);
    if (denominator !== 0 && numerator < denominator) {
      return { value: Number(mixedSlash[1]) + numerator / denominator, length: mixedSlash[0].length };
    }
  }

  const mixedUnicode = MIXED_UNICODE.exec(rest);
  if (mixedUnicode) {
    const fraction = UNICODE_FRACTION_VALUES.get(mixedUnicode[2]);
    if (fraction !== undefined) {
      return { value: Number(mixedUnicode[1]) + fraction, length: mixedUnicode[0].length };
    }
  }

  const range = RANGE.exec(rest);
  if (range) {
    if (isAmbiguousGrouped(range[1]) || isAmbiguousGrouped(range[2])) return null;
    const low = toNumber(range[1]);
    const high = toNumber(range[2]);
    if (!(high > low)) return null;
    return { value: (low + high) / 2, length: range[0].length };
  }

  const slash = SLASH_FRACTION.exec(rest);
  if (slash) {
    const denominator = Number(slash[2]);
    if (denominator === 0) return null;
    return { value: Number(slash[1]) / denominator, length: slash[0].length };
  }

  const unicode = UNICODE_FRACTION.exec(rest);
  if (unicode) {
    const fraction = UNICODE_FRACTION_VALUES.get(unicode[0]);
    return fraction === undefined ? null : { value: fraction, length: unicode[0].length };
  }

  const decimal = DECIMAL.exec(rest);
  if (decimal) {
    if (isAmbiguousGrouped(decimal[0])) return null;
    return { value: toNumber(decimal[0]), length: decimal[0].length };
  }

  return null;
}

function tidyName(text: string): string {
  return text
    .replace(LEADING_FILLER, '')
    .replace(LEADING_OF, '')
    .trim();
}

function isAcceptableName(name: string): boolean {
  if (name === '' || BAD_NAME_START.test(name)) return false;
  if (NUMBER_CHARACTER.test(name.replace(BRACKETED, ''))) return false;
  const first = FIRST_WORD.exec(name);
  return !(first && CONNECTORS.has(first[1].toLowerCase()));
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
    const qty = readQuantity(rest);
    if (!qty || !Number.isFinite(qty.value) || qty.value <= 0 || qty.value > MAX_NUMBER) {
      return nameOnly(whole);
    }

    let afterQuantity = rest.slice(qty.length);
    if (MULTIPLIER.test(afterQuantity)) return nameOnly(whole);

    let unit = '';
    let factor = 1;
    let hasUnit = false;
    const word = UNIT_WORD.exec(afterQuantity);
    if (word) {
      const key = word[1].toLowerCase();
      const known = Object.prototype.hasOwnProperty.call(UNIT_WORDS, key) ? UNIT_WORDS[key] : undefined;
      const english = known ? undefined : englishUnit(word[1]);
      if (known) {
        unit = known.unit;
        factor = known.factor;
        hasUnit = true;
      } else if (english !== undefined) {
        unit = english;
        hasUnit = true;
      }
      if (hasUnit) afterQuantity = afterQuantity.slice(word[0].length);
    }

    const name = tidyName(afterQuantity);
    if (!isAcceptableName(name)) return nameOnly(whole);

    if (!hasUnit) {
      const first = FIRST_WORD.exec(name);
      if (first && isUnsureWord(first[1])) return nameOnly(whole);
    }

    const quantityText = String(Number(qty.value.toFixed(6)));
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
