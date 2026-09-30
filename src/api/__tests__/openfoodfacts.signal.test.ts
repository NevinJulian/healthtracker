const mockPutOFFCache = jest.fn().mockResolvedValue(undefined);

jest.mock('../../db/database', () => ({
  getDatabase: () => {
    throw new Error('not initialised');
  },
  putOFFCache: (...args: unknown[]) => mockPutOFFCache(...args),
}));

import { lookupNutrition, batchLookupNutrition } from '../openfoodfacts';

const validBody = {
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
};

describe('openfoodfacts — abort signal', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockPutOFFCache.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('lookupNutrition forwards an abort to the in-flight request', async () => {
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
    const controller = new AbortController();

    const pending = lookupNutrition('apple', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('does not fetch for an already-aborted signal', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    await expect(lookupNutrition('apple', controller.signal)).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not cache a result that arrived after the signal aborted', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async () => {
      controller.abort();
      return { ok: true, status: 200, json: async () => validBody };
    }) as unknown as typeof fetch;

    await expect(lookupNutrition('pear', controller.signal)).resolves.toBeNull();
    expect(mockPutOFFCache).not.toHaveBeenCalled();
  });

  it('caches a result when the signal stays live', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validBody,
    })) as unknown as typeof fetch;

    await expect(lookupNutrition('plum', controller.signal)).resolves.toEqual({
      kcal: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
    });
    expect(mockPutOFFCache).toHaveBeenCalledTimes(1);
  });

  it('batchLookupNutrition stops fetching once the signal aborts', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(async () => {
      controller.abort();
      return { ok: true, status: 200, json: async () => validBody };
    }) as unknown as typeof fetch;

    const out = await batchLookupNutrition(['a', 'b', 'c'], controller.signal);

    expect(out).toEqual({});
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});
