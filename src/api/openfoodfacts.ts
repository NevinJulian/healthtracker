/**
 * openfoodfacts.ts
 *
 * Keyless Open Food Facts lookup for per-100g macro data.
 *
 * Used as a fallback when an ingredient name is not found in the local
 * NUTRITION_TABLE. Results are cached in the `off_cache` SQLite table
 * (migration v29) so the network is only hit once per unique ingredient name.
 *
 * License: Open Food Facts data is available under ODbL.
 * No API key required. No new npm dependencies — uses built-in fetch,
 * wrapped by `fetchJson` for a timeout, one retry, and a readable error.
 */

import { getDatabase, putOFFCache } from '../db/database';
import { expo } from '../../app.json';
import { fetchJson } from './fetchJson';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface OFFNutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// ─── OFF search response shape (we only need nutriments) ─────────────────────

interface OFFProduct {
  product_name?: string;
  nutriments?: {
    'energy-kcal_100g'?: number;
    'proteins_100g'?: number;
    'carbohydrates_100g'?: number;
    'fat_100g'?: number;
  };
}

interface OFFResponse {
  products?: OFFProduct[];
}

// ─── SQLite cache helpers ─────────────────────────────────────────────────────

/**
 * Look up a cached OFF result for the given normalised ingredient name.
 * Returns null on any error, DB not ready, or cache miss.
 */
async function getCached(name: string): Promise<OFFNutrition | null> {
  try {
    const db = getDatabase(); // may throw if DB not yet initialised
    const row = await db.getFirstAsync<{
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
    }>(
      'SELECT kcal, protein, carbs, fat FROM off_cache WHERE ingredient_name = ?',
      [name.toLowerCase()],
    );
    if (!row) return null;
    return { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat };
  } catch {
    // DB not initialised, table not yet created, or read error — treat as cache miss
    return null;
  }
}

/**
 * Store an OFF result in the cache. Silently ignores write errors and
 * DB-not-ready errors so the import is never blocked by cache failures.
 * Writes through database.ts's queued putOFFCache (#369), never a raw
 * statement on the shared connection.
 */
async function putCache(name: string, nutrition: OFFNutrition): Promise<void> {
  try {
    await putOFFCache(name, nutrition.kcal, nutrition.protein, nutrition.carbs, nutrition.fat);
  } catch {
    // Cache write failure is non-fatal — import proceeds without caching
  }
}

// ─── Network fetch ────────────────────────────────────────────────────────────

const OFF_SEARCH_URL =
  'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=5';

const OFF_HEADERS = {
  'User-Agent': `HealthTracker/${expo.version} (https://github.com/NevinJulian/healthtracker)`,
};

const OFF_BUDGET_MAX = 10;
const OFF_BUDGET_WINDOW_MS = 60_000;
const attemptTimes: number[] = [];

function takeSearchSlot(): void {
  const now = Date.now();
  while (attemptTimes.length > 0 && now - attemptTimes[0] >= OFF_BUDGET_WINDOW_MS) {
    attemptTimes.shift();
  }
  if (attemptTimes.length >= OFF_BUDGET_MAX) {
    throw new Error('Open Food Facts search budget exhausted');
  }
  attemptTimes.push(now);
}

/**
 * Fetch per-100g nutrition data from Open Food Facts for the given search term.
 * Returns null when: no products found, fields are missing, or network fails.
 * Never throws.
 */
async function fetchFromOFF(term: string, signal?: AbortSignal): Promise<OFFNutrition | null> {
  try {
    const url = `${OFF_SEARCH_URL}&search_terms=${encodeURIComponent(term)}`;
    const data = await fetchJson<OFFResponse>(url, {
      signal,
      headers: OFF_HEADERS,
      beforeAttempt: takeSearchSlot,
    });
    if (!data.products || data.products.length === 0) return null;

    // Pick the first product that has all four macro fields
    for (const product of data.products) {
      const n = product.nutriments;
      if (!n) continue;
      const kcal    = n['energy-kcal_100g'];
      const protein = n['proteins_100g'];
      const carbs   = n['carbohydrates_100g'];
      const fat     = n['fat_100g'];
      if (
        typeof kcal    === 'number' && kcal    >= 0 &&
        typeof protein === 'number' && protein >= 0 &&
        typeof carbs   === 'number' && carbs   >= 0 &&
        typeof fat     === 'number' && fat     >= 0
      ) {
        return { kcal, protein, carbs, fat };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up per-100g nutrition for the given ingredient name.
 *
 * Checks the SQLite cache first; falls back to an OFF network call when the
 * cache misses. Returns null when neither source has data (offline, not found).
 *
 * An aborted lookup resolves null and is never cached.
 *
 * @param ingredientName - Ingredient name (will be normalised to lowercase for cache key)
 * @param signal - Optional abort signal
 */
export async function lookupNutrition(
  ingredientName: string,
  signal?: AbortSignal,
): Promise<OFFNutrition | null> {
  if (signal?.aborted) return null;
  const cached = await getCached(ingredientName);
  if (cached) return cached;

  const result = await fetchFromOFF(ingredientName, signal);
  if (signal?.aborted) return null;
  if (result) {
    await putCache(ingredientName, result);
  }
  return result;
}

/**
 * Batch-resolve per-100g nutrition for a list of ingredient names.
 * Returns a map of lowercased name → OFFNutrition for names that resolved.
 * Names that could not be resolved (offline, not found) are absent from the map.
 *
 * Fetches sequentially to avoid hammering the OFF API.
 */
export async function batchLookupNutrition(
  names: string[],
  signal?: AbortSignal,
): Promise<Record<string, OFFNutrition>> {
  const result: Record<string, OFFNutrition> = {};
  for (const name of names) {
    if (signal?.aborted) break;
    const n = await lookupNutrition(name, signal);
    if (n) {
      result[name.toLowerCase()] = n;
    }
  }
  return result;
}
