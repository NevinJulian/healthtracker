/**
 * parseMeasure.ts
 *
 * Converts a TheMealDB free-text ingredient + measure pair into the app's
 * structured RecipeIngredient shape `{ name, baseQuantity, unit }`.
 *
 * Design goals:
 *  - Always succeeds (never throws). Unresolvable inputs return baseQuantity 0.
 *  - Reuses `convertToGrams` and `normaliseIngredientName` from units.ts.
 *  - Handles:
 *      • plain integers / decimals           "200", "1.5"
 *      • unicode fractions                   ½ ¼ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞
 *      • slash fractions                     "1/2", "3/4"
 *      • mixed numbers                       "1 1/2", "2 ½"
 *      • ranges                              "2-3" → midpoint 2.5
 *      • known weight / volume units         g kg ml l tbsp tsp cup oz lb
 *      • count-based units                   "2 cloves", "1 large onion",
 *                                            bare number with no unit
 *      • vague / empty measures              "to taste", "a pinch", "",
 *                                            "garnish", "as needed", "dash"
 *
 * Output unit is always one of: 'g' | 'ml' | 'whole'
 * (these three are what computeRecipeMacros + convertToGrams understand)
 *
 * baseQuantity is the TOTAL quantity for all servings.  Callers divide by
 * defaultServings themselves (or pass it to computeRecipeMacros directly).
 */

import { convertToGrams } from './units';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ParsedIngredient {
  /** Cleaned ingredient name (as given by TheMealDB, normalisation is done
   *  inside computeRecipeMacros via normaliseIngredientName) */
  name: string;
  /** Total grams or ml for the whole recipe (all servings).
   *  0 when the measure is vague / unresolvable — ingredient still appears in
   *  the shopping list but contributes 0 to macros. */
  baseQuantity: number;
  /** 'g' for solid weight, 'ml' for liquid volume, 'whole' for counts. */
  unit: 'g' | 'ml' | 'whole';
  /**
   * true when the measure was vague ("to taste", empty, etc.)
   * These ingredients appear in the ingredient list but contribute 0 macros.
   */
  isVague: boolean;
}

// ─── Unicode fraction map ─────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

// ─── Vague measure detection ──────────────────────────────────────────────────

const VAGUE_PATTERNS = [
  /^to\s+taste/i,
  /^a?\s*pinch/i,
  /^dash(es)?/i,
  /^garnish/i,
  /^as\s+needed/i,
  /^as\s+required/i,
  /^optional/i,
  /^some\b/i,
  /^handful/i,
  /^few\b/i,
  /^spray/i,
  /^drizzle/i,
];

function isVagueMeasure(measure: string): boolean {
  const t = measure.trim();
  if (t === '') return true;
  return VAGUE_PATTERNS.some((re) => re.test(t));
}

// ─── Number / fraction parser ─────────────────────────────────────────────────

/**
 * Replace unicode fraction characters with their decimal equivalents,
 * then evaluate any slash fractions and mixed numbers.
 * Returns NaN if the string is not a recognisable number.
 */
function parseNumber(raw: string): number {
  let s = raw.trim();

  // Replace unicode fractions with their decimal string
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(ch, ` ${val}`);
  }

  s = s.trim();

  // Range: "2-3" → midpoint
  const rangeMatch = s.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    if (!isNaN(lo) && !isNaN(hi)) return (lo + hi) / 2;
  }

  // Slash fraction: "1/2"
  const slashFrac = s.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
  if (slashFrac) {
    const num = parseFloat(slashFrac[1]);
    const den = parseFloat(slashFrac[2]);
    if (!isNaN(num) && !isNaN(den) && den !== 0) return num / den;
  }

  // Mixed number: "1 1/2" or "2 0.5"
  const mixedMatch = s.match(/^([\d.]+)\s+([\d.]+(?:\s*\/\s*[\d.]+)?)$/);
  if (mixedMatch) {
    const whole = parseFloat(mixedMatch[1]);
    const fracPart = parseNumber(mixedMatch[2]);
    if (!isNaN(whole) && !isNaN(fracPart)) return whole + fracPart;
  }

  return parseFloat(s);
}

// ─── Unit detection ───────────────────────────────────────────────────────────

/**
 * Maps TheMealDB measure words to the unit strings understood by convertToGrams.
 * Returns null when the unit token is not recognised (treat as count/whole).
 */
function detectUnit(token: string): { unit: string; isLiquid: boolean } | null {
  const t = token.toLowerCase().replace(/s$/, ''); // strip trailing plural
  switch (t) {
    case 'g':
    case 'gram':
    case 'gr':
      return { unit: 'g', isLiquid: false };
    case 'kg':
    case 'kilogram':
      return { unit: 'kg', isLiquid: false };
    case 'ml':
    case 'milliliter':
    case 'millilitre':
    case 'cc':
      return { unit: 'ml', isLiquid: true };
    case 'l':
    case 'liter':
    case 'litre':
      return { unit: 'l', isLiquid: true };
    case 'tsp':
    case 'teaspoon':
    case 't':
      return { unit: 'tsp', isLiquid: false };
    case 'tbsp':
    case 'tablespoon':
    case 'tb':
    case 'tbl':
      return { unit: 'tbsp', isLiquid: false };
    case 'cup':
      return { unit: 'cup', isLiquid: false };
    case 'oz':
    case 'ounce':
      return { unit: 'oz', isLiquid: false };
    case 'lb':
    case 'pound':
      return { unit: 'lb', isLiquid: false };
    case 'fl':
    case 'floz':
      return { unit: 'ml', isLiquid: true }; // approx 30 ml per fl oz
    case 'clove':
    case 'cloves':
    case 'head':
    case 'bulb':
    case 'bunch':
    case 'sprig':
    case 'stalk':
    case 'piece':
    case 'slice':
    case 'can':
    case 'tin':
    case 'packet':
    case 'pack':
    case 'bag':
      return { unit: 'whole', isLiquid: false };
    default:
      return null;
  }
}

// ─── Unit conversion to grams / ml ───────────────────────────────────────────

/**
 * Extended unit-to-gram map covering units not in units.ts (kg, l, lb).
 */
const EXTENDED_UNIT_TO_GRAMS: Record<string, number> = {
  g:    1,
  ml:   1,
  kg:   1000,
  l:    1000,
  tsp:  5,
  tbsp: 15,
  cup:  240,
  oz:   28.35,
  lb:   453.592,
  pinch: 0.5,
};

function convertQuantity(
  quantity: number,
  unitStr: string,
  isLiquid: boolean,
): { baseQuantity: number; unit: 'g' | 'ml' } {
  const factor = EXTENDED_UNIT_TO_GRAMS[unitStr.toLowerCase()];
  if (factor === undefined) {
    // Unknown unit — 0 contribution but keep the ingredient
    return { baseQuantity: 0, unit: isLiquid ? 'ml' : 'g' };
  }
  return {
    baseQuantity: quantity * factor,
    unit: isLiquid ? 'ml' : 'g',
  };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a single TheMealDB ingredient + measure pair.
 *
 * @param ingredient - Raw ingredient name from TheMealDB (e.g. "Chicken Breast")
 * @param measure    - Raw measure string from TheMealDB (e.g. "1 1/2 lbs")
 * @returns Structured ParsedIngredient, never throws.
 */
export function parseMeasure(ingredient: string, measure: string): ParsedIngredient {
  try {
    const cleanName = ingredient.trim();

    if (isVagueMeasure(measure)) {
      return { name: cleanName, baseQuantity: 0, unit: 'g', isVague: true };
    }

    const m = measure.trim();

    // ── Attempt to split the measure into (quantity) + (unit) ──────────────

    // Strip leading "a" / "an" / "some" which sometimes precede vague phrases
    // already handled above; if we reach here, strip them and attempt parsing.
    const stripped = m.replace(/^(a|an|some)\s+/i, '');

    // Handle range before tokenising: "2-3 tbsp", "100-150g"
    // The range must come at the start of the string, before any unit word.
    const rangeLeadMatch = stripped.match(
      /^([\d.½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s*\/\s*[\d.]+)?)\s*[-–]\s*([\d.½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s*\/\s*[\d.]+)?)\s*(.*)?$/,
    );
    if (rangeLeadMatch) {
      const lo = parseNumber(rangeLeadMatch[1]);
      const hi = parseNumber(rangeLeadMatch[2]);
      const rest = (rangeLeadMatch[3] ?? '').trim();
      if (!isNaN(lo) && !isNaN(hi) && lo > 0 && hi > 0) {
        const midpoint = (lo + hi) / 2;
        // Re-parse with midpoint + rest as "midpoint <unit>"
        return parseMeasure(ingredient, `${midpoint} ${rest}`);
      }
    }

    // Tokenise: numbers/fractions, unicode frac chars, and word tokens
    // e.g. "1 1/2 lbs"  → ["1", "1/2", "lbs"]
    //      "2 cloves"   → ["2", "cloves"]
    //      "½ cup"      → ["½", "cup"]
    const tokenRe = /([½¼¾⅓⅔⅛⅜⅝⅞]|[\d]+(?:[./][\d]+)?|[a-zA-Z]+(?:-[a-zA-Z]+)*)/g;
    const tokens = Array.from(stripped.matchAll(tokenRe)).map((t) => t[0]);

    if (tokens.length === 0) {
      return { name: cleanName, baseQuantity: 0, unit: 'g', isVague: true };
    }

    // Collect leading numeric tokens (handles "1 1/2", "1 ½", "2.5")
    let numericStr = '';
    let unitStartIdx = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const couldBeNumber =
        /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(tok) ||
        /^[\d]+$/.test(tok) ||
        tok.includes('/');
      if (couldBeNumber) {
        numericStr += (numericStr ? ' ' : '') + tok;
        unitStartIdx = i + 1;
      } else {
        // First non-numeric token — stop collecting
        unitStartIdx = i;
        break;
      }
    }

    const quantity = parseNumber(numericStr);
    const unitTokens = tokens.slice(unitStartIdx);

    // No recognisable number at all
    if (isNaN(quantity) || quantity <= 0) {
      // Could be "a pinch of..." handled above, or something like "to taste"
      return { name: cleanName, baseQuantity: 0, unit: 'g', isVague: true };
    }

    // Try to detect unit from the first remaining token
    let detectedUnit: { unit: string; isLiquid: boolean } | null = null;
    for (const tok of unitTokens) {
      detectedUnit = detectUnit(tok);
      if (detectedUnit) break;
    }

    if (!detectedUnit) {
      // No unit found — treat as a count (whole unit)
      return { name: cleanName, baseQuantity: quantity, unit: 'whole', isVague: false };
    }

    if (detectedUnit.unit === 'whole') {
      return { name: cleanName, baseQuantity: quantity, unit: 'whole', isVague: false };
    }

    // Weight / volume unit detected — convert to grams or ml
    const { baseQuantity, unit } = convertQuantity(
      quantity,
      detectedUnit.unit,
      detectedUnit.isLiquid,
    );

    return { name: cleanName, baseQuantity, unit, isVague: false };
  } catch {
    // Absolute safety net — never let parsing crash the import
    return { name: ingredient.trim(), baseQuantity: 0, unit: 'g', isVague: true };
  }
}

/**
 * Convert an array of TheMealDB MealIngredient pairs to ParsedIngredients.
 * Skips entries where the ingredient name is blank.
 */
export function parseMealIngredients(
  ingredients: { ingredient: string; measure: string }[],
): ParsedIngredient[] {
  return ingredients
    .filter((i) => i.ingredient.trim().length > 0)
    .map((i) => parseMeasure(i.ingredient, i.measure));
}
