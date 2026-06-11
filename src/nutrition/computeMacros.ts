/**
 * computeMacros.ts
 *
 * Pure, keyless, offline macro computation engine.
 *
 * `computeRecipeMacros(ingredients, defaultServings)` → per-serving macros.
 *
 * Algorithm:
 *   For each ingredient:
 *     1. normalise the name → canonical key
 *     2. look up per-100 g values in NUTRITION_TABLE
 *     3. convert baseQuantity to grams via convertToGrams()
 *     4. scale: macros_contributed = per100g_value * (grams / 100)
 *   Sum across all ingredients → total-recipe macros.
 *   Divide by defaultServings → per-serving macros.
 *   Recompute calories via Atwater (4·P + 4·C + 9·F) for internal consistency.
 *   Round: calories to nearest integer, P/C/F to 1 decimal place (callers round further if desired).
 *
 * Returns both the computed macros AND a list of ingredient names that had
 * NO match in NUTRITION_TABLE — these recipes are "low confidence" and are
 * flagged in the report.
 */

import { NUTRITION_TABLE } from './nutritionTable';
import { convertToGrams, normaliseIngredientName } from './units';

/** Minimal subset of the RecipeIngredient type we depend on */
export interface ComputeIngredient {
  name: string;
  baseQuantity: number;
  unit: string;
}

export interface ComputedMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ComputeResult {
  macros: ComputedMacros;
  /** Ingredient names (raw) for which no table entry was found */
  unmatchedIngredients: string[];
}

/**
 * Compute per-serving macros for a recipe from its ingredient list.
 *
 * @param ingredients     - Array of recipe ingredients with name/baseQuantity/unit
 * @param defaultServings - Number of servings the baseQuantity totals produce
 */
export function computeRecipeMacros(
  ingredients: ComputeIngredient[],
  defaultServings: number,
): ComputeResult {
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  const unmatchedIngredients: string[] = [];

  const servings = defaultServings > 0 ? defaultServings : 1;

  for (const ing of ingredients) {
    const key = normaliseIngredientName(ing.name);
    const entry = NUTRITION_TABLE[key];

    if (!entry) {
      unmatchedIngredients.push(ing.name);
      // Contribute 0 macros for unmatched — still tracked for reporting
      continue;
    }

    const grams = convertToGrams(ing.baseQuantity, ing.unit, entry.gramsPerUnit);
    const factor = grams / 100;

    totalProtein += entry.protein * factor;
    totalCarbs   += entry.carbs   * factor;
    totalFat     += entry.fat     * factor;
  }

  // Per-serving
  const servingProtein = totalProtein / servings;
  const servingCarbs   = totalCarbs   / servings;
  const servingFat     = totalFat     / servings;

  // Atwater kcal: 4·P + 4·C + 9·F  (internally consistent)
  const servingCalories = 4 * servingProtein + 4 * servingCarbs + 9 * servingFat;

  return {
    macros: {
      calories: Math.round(servingCalories),
      protein:  Math.round(servingProtein),
      carbs:    Math.round(servingCarbs),
      fat:      Math.round(servingFat),
    },
    unmatchedIngredients,
  };
}
