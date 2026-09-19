/**
 * Contract-preservation test for issue #318: fetchFromOFF (used via
 * lookupNutrition) now goes through fetchJson, but must keep its existing
 * "never throws, returns null on failure" contract so callers
 * (RecipeEditorScreen / src/nutrition) are unaffected.
 *
 * The DB is never initialised in this Jest environment, so getCached /
 * putCache hit their own catch blocks and this exercises the network path.
 */

import { lookupNutrition } from '../openfoodfacts';

describe('openfoodfacts — fetchFromOFF null-on-failure contract (#318)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('resolves null (does not throw) when the network request fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    jest.useFakeTimers();
    const promise = lookupNutrition('an ingredient the network cannot resolve');
    const assertion = expect(promise).resolves.toBeNull();

    // One retry, 1s later — flush it under fake timers.
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('resolves null (does not throw) on a non-2xx response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    jest.useFakeTimers();
    const promise = lookupNutrition('another unresolved ingredient');
    const assertion = expect(promise).resolves.toBeNull();

    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('resolves the macros on a valid response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        products: [
          {
            nutriments: {
              'energy-kcal_100g': 52,
              proteins_100g: 0.3,
              carbohydrates_100g: 14,
              fat_100g: 0.2,
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await expect(lookupNutrition('apple')).resolves.toEqual({
      kcal: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
    });
  });
});
