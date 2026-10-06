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
