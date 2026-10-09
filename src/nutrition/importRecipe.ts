/**
 * importRecipe.ts
 *
 * Orchestrates the full TheMealDB → recipe_library import pipeline:
 *   1. Parse free-text ingredient/measure pairs (parseMeasure)
 *   2. Resolve per-100g macros from the local NUTRITION_TABLE
 *   3. For unmatched ingredients, query Open Food Facts (with SQLite cache)
 *   4. Compute per-serving macros via computeRecipeMacros (with OFF overrides)
 *   5. Build and return a Recipe ready to pass to database.importRecipe()
 *
 * The import is "best-effort": ingredients with no local or OFF match
 * contribute 0 macros and are flagged in `estimatedIngredients`, or in
 * `notLookedUpIngredients` when the lookup was refused or rate limited.
 *
 * This module is pure orchestration — no UI state, no navigation.
 */

import { MealDetail } from '../api/mealdb';
import { lookupNutrition, OFFLookup } from '../api/openfoodfacts';
import { Recipe, RecipeIngredient } from '../db/database';
import { computeRecipeMacros, ComputeIngredient } from './computeMacros';
import { NUTRITION_TABLE } from './nutritionTable';
import { normaliseIngredientName } from './units';
import { parseMealIngredients, ParsedIngredient } from './parseMeasure';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ImportResult {
  recipe: Recipe;
  /** Ingredient names for which neither local table nor OFF had data. */
  estimatedIngredients: string[];
  /** Ingredient names whose lookup was refused before a request was sent. */
  notLookedUpIngredients: string[];
  /** Ingredient names that were resolved via Open Food Facts. */
  offResolvedIngredients: string[];
  /** Whether any ingredient had vague/zero quantity (still shows in shopping list). */
  hasVagueIngredients: boolean;
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

/**
 * Generates the stable recipe_library id for a TheMealDB meal.
 * Prefixed with "mealdb-" to avoid collisions with seeded "r001"…"r100" ids.
 */
export function mealDbRecipeId(mealDbId: string): string {
  return `mealdb-${mealDbId}`;
}

// ─── Instruction formatter ────────────────────────────────────────────────────

/**
 * TheMealDB returns instructions as a free-form string with \r\n or \n
 * paragraph breaks.  The Recipe.instructions field stores it as a single
 * string (same as the existing seeded recipes which use a plain string).
 * Normalise line endings and collapse excessive blank lines.
 */
function formatInstructions(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Main import builder ──────────────────────────────────────────────────────

const DEFAULT_SERVINGS = 4;
const DEFAULT_PREP_MINUTES = 30;
const OFF_LOOKUP_CONCURRENCY = 3;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Build an ImportResult from a TheMealDB MealDetail.
 *
 * Performs async OFF lookups for unmatched ingredients.
 * Never throws — any error is surfaced as 0-macro/estimated ingredients.
 *
 * @param meal           - Full MealDetail from fetchMealById
 * @param defaultServings - Servings to assume (default 4; TheMealDB doesn't provide)
 * @param signal         - Aborts in-flight lookups and stops new ones from starting
 */
export async function buildImportResult(
  meal: MealDetail,
  defaultServings: number = DEFAULT_SERVINGS,
  signal?: AbortSignal,
): Promise<ImportResult> {
  // ── 1. Parse free-text measure pairs ────────────────────────────────────────
  const parsed: ParsedIngredient[] = parseMealIngredients(meal.ingredients);

  // ── 2. Determine which parsed ingredients need an OFF lookup ────────────────
  const needsOFF: string[] = [];
  for (const p of parsed) {
    if (p.baseQuantity === 0) continue; // vague — skip OFF too
    const key = normaliseIngredientName(p.name);
    if (!NUTRITION_TABLE[key]) {
      needsOFF.push(p.name);
    }
  }

  // ── 3. Fetch OFF data for unmatched ingredients ──────────────────────────────
  const offOverrides: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {};
  const offResolvedIngredients: string[] = [];
  const notLookedUp = new Set<string>();

  const lookups = await mapWithConcurrency(
    needsOFF,
    OFF_LOOKUP_CONCURRENCY,
    async (name): Promise<OFFLookup> => {
      if (signal?.aborted) return null;
      try {
        return await lookupNutrition(name, signal);
      } catch {
        return null;
      }
    },
  );

  needsOFF.forEach((name, i) => {
    const nutrition = lookups[i];
    if (nutrition === 'not-looked-up') {
      notLookedUp.add(name);
    } else if (nutrition !== null && typeof nutrition === 'object') {
      const key = normaliseIngredientName(name);
      offOverrides[key] = nutrition;
      offOverrides[name.toLowerCase()] = nutrition;
      offResolvedIngredients.push(name);
    }
  });

  // ── 4. Build ComputeIngredient array ─────────────────────────────────────────
  const computeIngredients: ComputeIngredient[] = parsed.map((p) => ({
    name: p.name,
    baseQuantity: p.baseQuantity,
    unit: p.unit,
  }));

  // ── 5. Compute per-serving macros ────────────────────────────────────────────
  const computeResult = computeRecipeMacros(
    computeIngredients,
    defaultServings,
    Object.keys(offOverrides).length > 0 ? offOverrides : undefined,
  );

  // ── 6. Build RecipeIngredient array (shopping list shape) ───────────────────
  const recipeIngredients: RecipeIngredient[] = parsed.map((p) => ({
    name: p.name,
    baseQuantity: p.baseQuantity,
    unit: p.unit,
  }));

  // ── 7. Assemble the Recipe ───────────────────────────────────────────────────
  const recipe: Recipe = {
    id: mealDbRecipeId(meal.id),
    title: meal.name,
    category: 'Imported',
    calories: computeResult.macros.calories,
    protein: computeResult.macros.protein,
    carbs: computeResult.macros.carbs,
    fat: computeResult.macros.fat,
    prepTimeMinutes: DEFAULT_PREP_MINUTES,
    defaultServings,
    ingredients: recipeIngredients,
    instructions: formatInstructions(meal.instructions),
    freezerTips: '',
  };

  return {
    recipe,
    estimatedIngredients: computeResult.unmatchedIngredients.filter((n) => !notLookedUp.has(n)),
    notLookedUpIngredients: computeResult.unmatchedIngredients.filter((n) => notLookedUp.has(n)),
    offResolvedIngredients,
    hasVagueIngredients: parsed.some((p) => p.isVague),
  };
}
