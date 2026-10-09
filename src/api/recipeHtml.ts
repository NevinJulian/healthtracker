export interface RecipeDraftIngredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface RecipeDraft {
  title: string;
  servings: number | null;
  prepMinutes: number | null;
  ingredients: RecipeDraftIngredient[];
  instructions: string;
}

export type RecipeHtmlResult =
  | { ok: true; draft: RecipeDraft }
  | { ok: false; reason: 'no-recipe' };

export function parseRecipeHtml(_html: string): RecipeHtmlResult {
  return { ok: false, reason: 'no-recipe' };
}
