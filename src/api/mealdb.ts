/**
 * TheMealDB — keyless public API client.
 *
 * Uses the free "test key" (`1`) in the URL path. No API key, no
 * environment variable, no new npm dependency — just built-in fetch,
 * wrapped by `fetchJson` for a timeout, one retry, and a readable error.
 *
 * Docs: https://www.themealdb.com/api.php
 */

import { fetchJson } from './fetchJson';

const BASE = 'https://www.themealdb.com/api/json/v1/1';

// ─── API shape ────────────────────────────────────────────────────────────────

/**
 * Raw meal object returned by TheMealDB.
 * Ingredient/measure pairs are named `strIngredient1`…`strIngredient20`
 * and `strMeasure1`…`strMeasure20`. Many trailing entries are empty / null.
 */
export interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strCategory: string | null;
  strArea: string | null;
  strInstructions: string | null;
  strMealThumb: string | null;
  strTags: string | null;
  strYoutube: string | null;
  [key: string]: string | null; // strIngredient1..20, strMeasure1..20
}

interface MealDbResponse {
  meals: MealDbMeal[] | null;
}

// ─── Derived types ────────────────────────────────────────────────────────────

/** A single ingredient + measure pair, blanks already filtered out. */
export interface MealIngredient {
  ingredient: string;
  measure: string;
}

/** Cleaned-up meal summary for the search results list. */
export interface MealSummary {
  id: string;
  name: string;
  category: string;
  area: string;
  thumb: string | null;
}

/** Full meal detail for the detail screen. */
export interface MealDetail extends MealSummary {
  instructions: string;
  tags: string[];
  youtube: string | null;
  ingredients: MealIngredient[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the 20 ingredient/measure pairs; filter out blank entries. */
function extractIngredients(meal: MealDbMeal): MealIngredient[] {
  const result: MealIngredient[] = [];
  for (let i = 1; i <= 20; i++) {
    const ingredient = (meal[`strIngredient${i}`] ?? '').trim();
    const measure = (meal[`strMeasure${i}`] ?? '').trim();
    if (ingredient) {
      result.push({ ingredient, measure });
    }
  }
  return result;
}

function toSummary(meal: MealDbMeal): MealSummary {
  return {
    id: meal.idMeal,
    name: meal.strMeal,
    category: meal.strCategory ?? '',
    area: meal.strArea ?? '',
    thumb: meal.strMealThumb,
  };
}

function toDetail(meal: MealDbMeal): MealDetail {
  return {
    ...toSummary(meal),
    instructions: meal.strInstructions ?? '',
    tags: meal.strTags ? meal.strTags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    youtube: meal.strYoutube ?? null,
    ingredients: extractIngredients(meal),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search meals by name.
 *
 * Returns an empty array when no results match (`meals: null` from the API).
 * Throws (`FetchJsonError`) on a non-2xx response, a timeout, or a network
 * error so callers can show a retry state.
 */
export async function searchMeals(query: string): Promise<MealSummary[]> {
  const encoded = encodeURIComponent(query.trim());
  const data = await fetchJson<MealDbResponse>(`${BASE}/search.php?s=${encoded}`);
  return data.meals ? data.meals.map(toSummary) : [];
}

/**
 * In-memory cache of resolved lookups, keyed by TheMealDB id. A `null`
 * value means "looked up, confirmed not found" — that's cached too, so a
 * bad id doesn't get re-fetched either. Only successful lookups are
 * cached; a thrown error (network/timeout) is not, so the next call
 * retries the network. Process-lifetime only — no persistence, no schema
 * change.
 */
const mealByIdCache = new Map<string, MealDetail | null>();

/**
 * Fetch full meal detail by TheMealDB id.
 *
 * Returns `null` when the id is not found.
 * Throws (`FetchJsonError`) on a non-2xx response, a timeout, or a network
 * error.
 *
 * Repeated calls for the same id are served from an in-memory cache after
 * the first successful lookup — no second network call.
 */
export async function fetchMealById(id: string): Promise<MealDetail | null> {
  if (mealByIdCache.has(id)) {
    return mealByIdCache.get(id) ?? null;
  }
  const data = await fetchJson<MealDbResponse>(`${BASE}/lookup.php?i=${encodeURIComponent(id)}`);
  const result = !data.meals || data.meals.length === 0 ? null : toDetail(data.meals[0]);
  mealByIdCache.set(id, result);
  return result;
}
