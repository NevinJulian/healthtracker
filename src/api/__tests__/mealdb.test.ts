/**
 * Regression tests for issue #318: bare `fetch` calls in src/api/** have no
 * timeout/signal, so a stalled request hangs the caller forever, and
 * `fetchMealById` re-fetches the same id on every call.
 *
 * Both tests fail against the pre-fix `mealdb.ts` (bare `fetch`, no cache):
 *   - "times out" never settles `searchMeals`, so `settled` stays false
 *     after the fake-timer window advances.
 *   - "caches" calls `fetch` twice for the same id.
 */

describe('mealdb — fetch timeout + retry + cache (#318)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.resetModules();
  });

  it('rejects (does not hang) a search whose request never settles', async () => {
    jest.useFakeTimers();

    // A fetch that never resolves on its own, but honours the abort signal
    // the way real fetch does — rejecting with an AbortError once aborted.
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const { searchMeals } = require('../mealdb');

    let settled = false;
    let rejected = false;
    searchMeals('x').then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
        rejected = true;
      },
    );

    // Timeout (default 8000ms) + 1000ms retry delay + timeout again (8000ms)
    // = ~17000ms worst case before the caller gets a rejection.
    await jest.advanceTimersByTimeAsync(18000);

    expect(settled).toBe(true);
    expect(rejected).toBe(true);
  });

  it('does not call fetch again for a second lookup of the same meal id', async () => {
    const meal = {
      idMeal: '52772',
      strMeal: 'Teriyaki Chicken Casserole',
      strCategory: 'Chicken',
      strArea: 'Japanese',
      strInstructions: 'Preheat oven...',
      strMealThumb: 'https://example.com/thumb.jpg',
      strTags: 'Meat,Casserole',
      strYoutube: 'https://youtube.com/watch?v=abc',
    };

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ meals: [meal] }),
    })) as unknown as typeof fetch;

    const { fetchMealById } = require('../mealdb');

    const first = await fetchMealById('52772');
    const second = await fetchMealById('52772');

    expect(first?.name).toBe('Teriyaki Chicken Casserole');
    expect(second?.name).toBe('Teriyaki Chicken Casserole');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});
