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

  it('searchMeals rejects and never fetches when given an already-aborted signal', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const { searchMeals } = require('../mealdb');
    const controller = new AbortController();
    controller.abort();

    await expect(searchMeals('x', controller.signal)).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('searchMeals rejects when the signal aborts mid-flight', async () => {
    let fetchSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const { searchMeals } = require('../mealdb');
    const controller = new AbortController();

    const pending = searchMeals('x', controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('fetchMealById rejects on an aborted signal and does not cache the aborted call', async () => {
    const meal = { idMeal: '1', strMeal: 'Soup' };
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ meals: [meal] }),
    })) as unknown as typeof fetch;
    const { fetchMealById } = require('../mealdb');
    const controller = new AbortController();
    controller.abort();

    await expect(fetchMealById('1', controller.signal)).rejects.toThrow();

    const result = await fetchMealById('1');
    expect(result?.name).toBe('Soup');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('fetchMealById does not cache a result that resolved after its signal aborted', async () => {
    const meal = { idMeal: '2', strMeal: 'Stew' };
    const controller = new AbortController();
    global.fetch = jest.fn(async () => {
      controller.abort();
      return { ok: true, status: 200, json: async () => ({ meals: [meal] }) };
    }) as unknown as typeof fetch;
    const { fetchMealById } = require('../mealdb');

    await fetchMealById('2', controller.signal).catch(() => undefined);
    await fetchMealById('2');

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
  });
});
