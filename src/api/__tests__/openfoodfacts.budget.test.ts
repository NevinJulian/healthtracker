import { expo } from '../../../app.json';

jest.mock('../../db/database', () => ({
  getDatabase: () => {
    throw new Error('not initialised');
  },
  putOFFCache: jest.fn().mockResolvedValue(undefined),
}));

import { lookupNutrition } from '../openfoodfacts';

const body = {
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

describe('openfoodfacts — request headers', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the HealthTracker User-Agent with the app.json version', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;

    await lookupNutrition('apple');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      'User-Agent': `HealthTracker/${expo.version} (https://github.com/NevinJulian/healthtracker)`,
    });
  });
});

describe('openfoodfacts — search budget', () => {
  const originalFetch = global.fetch;
  let now: number;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function load(getDatabase: () => unknown = () => { throw new Error('not initialised'); }) {
    jest.doMock('../../db/database', () => ({
      getDatabase,
      putOFFCache: jest.fn().mockResolvedValue(undefined),
    }));
    return require('../openfoodfacts') as typeof import('../openfoodfacts');
  }

  it('sends no request for the 11th search inside a minute and resolves not-looked-up', async () => {
    const { lookupNutrition: lookup } = load();
    for (let i = 0; i < 10; i++) {
      expect(await lookup(`item${i}`)).not.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);

    expect(await lookup('item11')).toBe('not-looked-up');
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('does not cache an over-budget lookup and sends again after 60 s', async () => {
    const putOFFCache = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../db/database', () => ({
      getDatabase: () => { throw new Error('not initialised'); },
      putOFFCache,
    }));
    const { lookupNutrition: lookup } = require('../openfoodfacts') as typeof import('../openfoodfacts');
    for (let i = 0; i < 10; i++) await lookup(`item${i}`);
    putOFFCache.mockClear();

    expect(await lookup('over')).toBe('not-looked-up');
    expect(putOFFCache).not.toHaveBeenCalled();

    now += 60_000;
    expect(await lookup('over')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it('counts each retry attempt against the budget', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const { lookupNutrition: lookup } = load();
    for (let i = 0; i < 5; i++) {
      const p = lookup(`item${i}`);
      await jest.advanceTimersByTimeAsync(1000);
      await p;
    }
    jest.useRealTimers();
    expect(fetchMock).toHaveBeenCalledTimes(10);

    expect(await lookup('item5')).toBe('not-looked-up');
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('sends again after the clock steps back, and still enforces the budget', async () => {
    const { lookupNutrition: lookup } = load();
    for (let i = 0; i < 10; i++) await lookup(`item${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(10);

    now -= 300_000;
    expect(await lookup('after-step')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(11);

    for (let i = 0; i < 9; i++) await lookup(`more${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(20);
    await lookup('over');
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("resolves 'not-looked-up' for a refused search and null for an empty or failed one", async () => {
    const { lookupNutrition: lookup } = load();
    for (let i = 0; i < 10; i++) await lookup(`item${i}`);

    expect(await lookup('over')).toBe('not-looked-up');
    expect(fetchMock).toHaveBeenCalledTimes(10);

    now += 60_000;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ products: [] }) });
    expect(await lookup('empty')).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    jest.useFakeTimers({ doNotFake: ['Date'] });
    const failed = lookup('failed');
    await jest.advanceTimersByTimeAsync(1000);
    expect(await failed).toBeNull();
    jest.useRealTimers();
  });

  it('does not spend budget on a cache hit', async () => {
    const hit = { kcal: 1, protein: 2, carbs: 3, fat: 4 };
    const { lookupNutrition: lookup } = load(() => ({ getFirstAsync: async () => hit }));
    for (let i = 0; i < 12; i++) {
      expect(await lookup(`cached${i}`)).toEqual(hit);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
