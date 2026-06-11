/**
 * nutrition.test.ts
 *
 * Unit tests for the keyless nutrition engine:
 *   - convertToGrams (unit converter)
 *   - normaliseIngredientName (key normaliser)
 *   - computeRecipeMacros (end-to-end, with hand-verified reference recipes)
 *
 * Tests run in the existing Jest 30 + node environment (no DB, no native modules).
 */

import { convertToGrams } from '../units';
import { normaliseIngredientName } from '../units';
import { computeRecipeMacros } from '../computeMacros';
import { NUTRITION_TABLE } from '../nutritionTable';

// ──────────────────────────────────────────────────────────────────────────────
// Unit converter tests
// ──────────────────────────────────────────────────────────────────────────────

describe('convertToGrams', () => {
  it('passes grams through unchanged', () => {
    expect(convertToGrams(100, 'g')).toBe(100);
    expect(convertToGrams(500, 'g')).toBe(500);
    expect(convertToGrams(17.5, 'g')).toBeCloseTo(17.5);
  });

  it('treats ml as 1:1 with grams (water-density assumption)', () => {
    expect(convertToGrams(30, 'ml')).toBe(30);
    expect(convertToGrams(250, 'ml')).toBe(250);
  });

  it('converts tsp (5 g each)', () => {
    expect(convertToGrams(1, 'tsp')).toBe(5);
    expect(convertToGrams(0.5, 'tsp')).toBeCloseTo(2.5);
    expect(convertToGrams(2, 'tsp')).toBe(10);
  });

  it('converts tbsp (15 g each)', () => {
    expect(convertToGrams(1, 'tbsp')).toBe(15);
    expect(convertToGrams(3, 'tbsp')).toBe(45);
  });

  it('converts cup (240 g)', () => {
    expect(convertToGrams(1, 'cup')).toBe(240);
    expect(convertToGrams(0.5, 'cup')).toBe(120);
  });

  it('converts oz (28.35 g)', () => {
    expect(convertToGrams(1, 'oz')).toBeCloseTo(28.35);
    expect(convertToGrams(4, 'oz')).toBeCloseTo(113.4);
  });

  it('pinch → ~0.5 g', () => {
    expect(convertToGrams(1, 'pinch')).toBe(0.5);
  });

  it('whole uses gramsPerUnit when provided', () => {
    // 1 egg (whole) = 50 g
    expect(convertToGrams(1, 'whole', 50)).toBe(50);
    // 3 eggs = 150 g
    expect(convertToGrams(3, 'whole', 50)).toBe(150);
    // 1 garlic clove = 3 g
    expect(convertToGrams(1, 'whole', 3)).toBe(3);
    // 4 garlic cloves = 12 g
    expect(convertToGrams(4, 'whole', 3)).toBe(12);
  });

  it('whole falls back to 100 g when no gramsPerUnit', () => {
    expect(convertToGrams(1, 'whole')).toBe(100);
    expect(convertToGrams(2, 'whole')).toBe(200);
  });

  it('returns 0 for unknown units', () => {
    expect(convertToGrams(5, 'handful')).toBe(0);
    expect(convertToGrams(3, 'bunch')).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Normaliser tests
// ──────────────────────────────────────────────────────────────────────────────

describe('normaliseIngredientName', () => {
  it('lowercases and strips parenthetical qualifiers', () => {
    expect(normaliseIngredientName('Lean ground beef (5% fat)')).toBe('lean ground beef');
    expect(normaliseIngredientName('High-protein quark (0.2% fat)')).toBe('quark');
    expect(normaliseIngredientName('Quark (0.2% fat)')).toBe('quark');
    expect(normaliseIngredientName('Canned tuna in water, drained')).toBe('canned tuna');
  });

  it('strips trailing comma-separated descriptors', () => {
    expect(normaliseIngredientName('Onion, diced')).toBe('onion');
    expect(normaliseIngredientName('Garlic cloves, minced')).toBe('garlic');
    expect(normaliseIngredientName('Cherry tomatoes, halved')).toBe('cherry tomatoes');
    expect(normaliseIngredientName('Chicken breast, sliced')).toBe('chicken breast');
  });

  it('strips adjective prefixes', () => {
    expect(normaliseIngredientName('Frozen broccoli florets')).toBe('frozen broccoli');
    expect(normaliseIngredientName('Low-fat Greek yogurt')).toBe('greek yogurt');
    expect(normaliseIngredientName('Fresh parsley, chopped')).toBe('fresh parsley');
    expect(normaliseIngredientName('Canned crushed tomatoes')).toBe('canned tomatoes');
  });

  it('returns a key that exists in NUTRITION_TABLE for common ingredients', () => {
    const testCases = [
      'Lean ground beef (5% fat)',
      'Chicken breast',
      'Jasmine rice (dry)',
      'Spelt pasta (Dinkel-Pasta)',
      'Eggs',
      'Quark (0.2% fat)',
      'Olive oil',
      'Garlic cloves, minced',
      'Onion, diced',
      'Low-fat Greek yogurt',
      'Canned crushed tomatoes',
      'Frozen broccoli florets',
    ];

    for (const tc of testCases) {
      const key = normaliseIngredientName(tc);
      expect(NUTRITION_TABLE[key]).toBeDefined();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// computeRecipeMacros — end-to-end hand-verified recipes
// ──────────────────────────────────────────────────────────────────────────────

describe('computeRecipeMacros', () => {
  it('reports unmatched ingredients for unknown names', () => {
    const result = computeRecipeMacros(
      [{ name: 'Unicorn dust', baseQuantity: 100, unit: 'g' }],
      1,
    );
    expect(result.unmatchedIngredients).toContain('Unicorn dust');
  });

  it('returns all-zero macros when all ingredients are unmatched', () => {
    const result = computeRecipeMacros(
      [{ name: 'Imaginary ingredient', baseQuantity: 100, unit: 'g' }],
      1,
    );
    expect(result.macros.calories).toBe(0);
    expect(result.macros.protein).toBe(0);
    expect(result.macros.carbs).toBe(0);
    expect(result.macros.fat).toBe(0);
  });

  it('handles defaultServings = 0 gracefully (treats as 1 serving)', () => {
    const result = computeRecipeMacros(
      [{ name: 'Lean ground beef (5% fat)', baseQuantity: 100, unit: 'g' }],
      0,
    );
    // 100 g lean beef: ~137 kcal, 21 P, 0 C, 5.5 F → Atwater: 4*21+4*0+9*5.5 = 84+49.5 = 133.5 → 134
    expect(result.macros.calories).toBeGreaterThan(100);
    expect(result.macros.protein).toBeGreaterThan(15);
  });

  // ── Hand-verified recipe: r003 Quark Bowl with Berries & Almonds ─────────────
  // defaultServings: 1
  // Ingredients:
  //   400 g quark 0.2% fat   → 400 * 0.01 = factor 4 → P:48, C:16, F:0.8
  //   120 g frozen berries   → factor 1.2             → P:0.84, C:14.4, F:0.36
  //    20 g almonds          → factor 0.2             → P:4.24, C:4.34, F:9.98
  //    10 g honey            → factor 0.1             → P:0.03, C:8.24, F:0
  //     2 ml vanilla extract → factor 0.02            → P:0.002, C:0.254, F:0.002
  //                                                    Totals≈P:53.1, C:43.2, F:11.1
  //                                                    Atwater: 4*53.1 + 4*43.2 + 9*11.1 = 212.4+172.8+99.9 = 485
  it('computes r003 Quark Bowl per-serving macros within expected range', () => {
    const result = computeRecipeMacros(
      [
        { name: 'High-protein quark (0.2% fat)', baseQuantity: 400, unit: 'g' },
        { name: 'Frozen mixed berries, thawed', baseQuantity: 120, unit: 'g' },
        { name: 'Almonds, roughly chopped', baseQuantity: 20, unit: 'g' },
        { name: 'Honey', baseQuantity: 10, unit: 'g' },
        { name: 'Vanilla extract', baseQuantity: 2, unit: 'ml' },
      ],
      1,
    );
    // Protein should be roughly 50–55 g (400 g quark drives it)
    expect(result.macros.protein).toBeGreaterThanOrEqual(48);
    expect(result.macros.protein).toBeLessThanOrEqual(58);
    // Calories should be ~450–520
    expect(result.macros.calories).toBeGreaterThanOrEqual(430);
    expect(result.macros.calories).toBeLessThanOrEqual(530);
    // No unmatched ingredients
    expect(result.unmatchedIngredients).toHaveLength(0);
  });

  // ── Hand-verified recipe: simple chicken + rice ───────────────────────────────
  // 400 g raw chicken breast (factor 4) → P:92, C:0, F:6
  // 160 g jasmine rice dry (factor 1.6)  → P:11.2, C:126.4, F:0.96
  //   Total: P:103.2, C:126.4, F:6.96  / 2 servings → P:51.6, C:63.2, F:3.48
  //   Atwater: 4*51.6 + 4*63.2 + 9*3.48 = 206.4+252.8+31.3 = 490
  it('computes chicken + jasmine rice per-serving macros within expected range', () => {
    const result = computeRecipeMacros(
      [
        { name: 'Chicken breast, diced', baseQuantity: 400, unit: 'g' },
        { name: 'Jasmine rice (dry)', baseQuantity: 160, unit: 'g' },
      ],
      2,
    );
    expect(result.macros.protein).toBeGreaterThanOrEqual(48);
    expect(result.macros.protein).toBeLessThanOrEqual(56);
    expect(result.macros.carbs).toBeGreaterThanOrEqual(58);
    expect(result.macros.carbs).toBeLessThanOrEqual(68);
    expect(result.macros.calories).toBeGreaterThanOrEqual(460);
    expect(result.macros.calories).toBeLessThanOrEqual(520);
    expect(result.unmatchedIngredients).toHaveLength(0);
  });

  // ── Atwater internal consistency ─────────────────────────────────────────────
  it('calories are internally consistent with Atwater (4·P + 4·C + 9·F)', () => {
    const result = computeRecipeMacros(
      [
        { name: 'Lean ground beef (5% fat)', baseQuantity: 300, unit: 'g' },
        { name: 'Jasmine rice (dry)', baseQuantity: 200, unit: 'g' },
        { name: 'Olive oil', baseQuantity: 10, unit: 'ml' },
      ],
      2,
    );
    const expected = Math.round(
      4 * result.macros.protein + 4 * result.macros.carbs + 9 * result.macros.fat,
    );
    // Should match within ±5 kcal (independent rounding of P, C, F each introduces error)
    expect(Math.abs(result.macros.calories - expected)).toBeLessThanOrEqual(5);
  });

  // ── Egg whole-unit count ──────────────────────────────────────────────────────
  it('handles whole-egg counting correctly (3 eggs = 150 g)', () => {
    const result = computeRecipeMacros(
      [{ name: 'Eggs', baseQuantity: 3, unit: 'whole' }],
      1,
    );
    // 150 g eggs: kcal = 147*1.5 = 220.5 ≈ 221; P = 12.6*1.5 = 18.9 ≈ 19
    expect(result.macros.protein).toBeGreaterThanOrEqual(17);
    expect(result.macros.protein).toBeLessThanOrEqual(22);
    expect(result.macros.calories).toBeGreaterThanOrEqual(200);
    expect(result.macros.calories).toBeLessThanOrEqual(240);
  });

  // ── Garlic whole-unit count (negligible macros) ───────────────────────────────
  it('resolves garlic cloves to correct gram weight (3 cloves = 9 g)', () => {
    const result = computeRecipeMacros(
      [{ name: 'Garlic cloves, minced', baseQuantity: 3, unit: 'whole' }],
      1,
    );
    // 9 g garlic: kcal = 149*0.09 ≈ 13; very low, confirms gram weight applied
    expect(result.macros.calories).toBeGreaterThan(5);
    expect(result.macros.calories).toBeLessThan(25);
  });

  // ── Sauce recipe (small per-serving portions) ─────────────────────────────────
  // r079: Quark Carbonara Sauce, 10 servings
  // 1000 g quark, 6 egg yolks, 80 g parmesan, 3 garlic cloves
  it('computes sauce recipe per-serving (10 servings) correctly', () => {
    const result = computeRecipeMacros(
      [
        { name: 'Quark (0.2% fat)', baseQuantity: 1000, unit: 'g' },
        { name: 'Egg yolks', baseQuantity: 6, unit: 'whole' },
        { name: 'Parmesan, grated', baseQuantity: 80, unit: 'g' },
        { name: 'Garlic cloves, minced', baseQuantity: 3, unit: 'whole' },
      ],
      10,
    );
    // Small sauce portions: calories should be ~100–180 per serving
    expect(result.macros.calories).toBeGreaterThanOrEqual(80);
    expect(result.macros.calories).toBeLessThanOrEqual(200);
    expect(result.macros.protein).toBeGreaterThanOrEqual(10);
    expect(result.unmatchedIngredients).toHaveLength(0);
  });
});
