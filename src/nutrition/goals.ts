/**
 * goals.ts — Default daily nutrition targets for the HealthTracker app.
 *
 * These are sensible starting defaults for a moderate-activity adult on a
 * muscle-building / body-recomposition program. They are intentionally
 * exported as named constants so a future Settings screen can load user
 * overrides from the database and fall back to these values.
 *
 * Usage:
 *   import { NUTRITION_GOALS } from '../nutrition/goals';
 *   // goals.calories, goals.protein
 *
 * Future: replace the literals below with a DB-backed `getUserGoals()` that
 * returns stored overrides merged over NUTRITION_GOALS as the default.
 */

export interface NutritionGoals {
  /** Target daily caloric intake in kcal. */
  calories: number;
  /** Target daily protein intake in grams. */
  protein: number;
}

/**
 * Default daily nutrition goals.
 *
 * calories: 1800 kcal — moderate deficit / maintenance for a typical
 *   85–95 kg male in a meal-prep program.
 * protein:  150 g   — ~1.6–1.8 g / kg body weight for muscle retention.
 *
 * These defaults are NOT personalised. A future Settings screen will allow
 * the user to override them; store overrides in app_state under
 * 'nutrition_goal_calories' / 'nutrition_goal_protein' and merge here.
 */
export const NUTRITION_GOALS: NutritionGoals = {
  calories: 1800,
  protein: 150,
};
