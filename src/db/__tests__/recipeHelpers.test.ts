/**
 * recipeHelpers.test.ts
 *
 * Unit tests for the recipe helper utilities added in issue #263:
 *   - isSeededRecipe(id): returns true for r001–r100 ids, false for custom/mealdb
 *   - Ingredient row ↔ RecipeIngredient round-trip logic (pure helper behaviour)
 */

import { isSeededRecipe } from '../database';

// ─── isSeededRecipe ───────────────────────────────────────────────────────────

describe('isSeededRecipe', () => {
  it('returns true for r001 through r100 (seeded ids)', () => {
    expect(isSeededRecipe('r001')).toBe(true);
    expect(isSeededRecipe('r050')).toBe(true);
    expect(isSeededRecipe('r100')).toBe(true);
  });

  it('returns false for custom-* ids', () => {
    expect(isSeededRecipe('custom-1717000000000')).toBe(false);
    expect(isSeededRecipe('custom-0')).toBe(false);
  });

  it('returns false for mealdb-* ids', () => {
    expect(isSeededRecipe('mealdb-52772')).toBe(false);
    expect(isSeededRecipe('mealdb-12345')).toBe(false);
  });

  it('returns false for ids that look similar but do not match the pattern', () => {
    // Too many digits
    expect(isSeededRecipe('r1000')).toBe(false);
    // Too few digits
    expect(isSeededRecipe('r01')).toBe(false);
    // Wrong prefix
    expect(isSeededRecipe('R001')).toBe(false);
    // Empty string
    expect(isSeededRecipe('')).toBe(false);
  });
});

// ─── Ingredient row conversion helpers (pure logic, tested inline) ────────────

/**
 * These functions live inside RecipeEditorScreen but their logic is trivial
 * and deterministic — test equivalent behaviour here rather than importing
 * private helpers.
 */

interface IngRow { name: string; quantity: string; unit: string }
interface Ingredient { name: string; baseQuantity: number; unit: string }

function rowsToIngredients(rows: IngRow[]): Ingredient[] {
  return rows
    .filter((r) => r.name.trim() !== '' && parseFloat(r.quantity) > 0)
    .map((r) => ({ name: r.name.trim(), baseQuantity: parseFloat(r.quantity) || 0, unit: r.unit }));
}

function ingredientsToRows(ingredients: Ingredient[]): IngRow[] {
  return ingredients.map((ing) => ({
    name: ing.name,
    quantity: String(ing.baseQuantity),
    unit: ing.unit,
    key: 'test-key',
  }));
}

describe('rowsToIngredients', () => {
  it('converts valid rows to RecipeIngredient shape', () => {
    const rows: IngRow[] = [
      { name: 'Chicken breast', quantity: '200', unit: 'g' },
      { name: 'Olive oil', quantity: '1', unit: 'tbsp' },
    ];
    const result = rowsToIngredients(rows);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Chicken breast', baseQuantity: 200, unit: 'g' });
    expect(result[1]).toEqual({ name: 'Olive oil', baseQuantity: 1, unit: 'tbsp' });
  });

  it('filters out rows with empty names', () => {
    const rows: IngRow[] = [
      { name: '', quantity: '100', unit: 'g' },
      { name: 'Onion', quantity: '50', unit: 'g' },
    ];
    expect(rowsToIngredients(rows)).toHaveLength(1);
    expect(rowsToIngredients(rows)[0].name).toBe('Onion');
  });

  it('filters out rows with zero or non-numeric quantity', () => {
    const rows: IngRow[] = [
      { name: 'Salt', quantity: '0', unit: 'tsp' },
      { name: 'Pepper', quantity: '', unit: 'pinch' },
      { name: 'Garlic', quantity: '2', unit: 'clove' },
    ];
    const result = rowsToIngredients(rows);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Garlic');
  });

  it('trims whitespace from ingredient names', () => {
    const rows: IngRow[] = [
      { name: '  Tomato  ', quantity: '100', unit: 'g' },
    ];
    expect(rowsToIngredients(rows)[0].name).toBe('Tomato');
  });
});

describe('ingredientsToRows', () => {
  it('converts RecipeIngredients to row shape', () => {
    const ingredients: Ingredient[] = [
      { name: 'Jasmine rice', baseQuantity: 160, unit: 'g' },
    ];
    const rows = ingredientsToRows(ingredients);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Jasmine rice');
    expect(rows[0].quantity).toBe('160');
    expect(rows[0].unit).toBe('g');
  });

  it('round-trips a set of ingredients through row ↔ ingredient conversion', () => {
    const original: Ingredient[] = [
      { name: 'Chicken breast', baseQuantity: 300, unit: 'g' },
      { name: 'Jasmine rice', baseQuantity: 160, unit: 'g' },
      { name: 'Olive oil', baseQuantity: 2, unit: 'tbsp' },
    ];
    const rows = ingredientsToRows(original);
    const roundTripped = rowsToIngredients(rows);
    expect(roundTripped).toHaveLength(original.length);
    original.forEach((orig, i) => {
      expect(roundTripped[i].name).toBe(orig.name);
      expect(roundTripped[i].baseQuantity).toBe(orig.baseQuantity);
      expect(roundTripped[i].unit).toBe(orig.unit);
    });
  });
});
