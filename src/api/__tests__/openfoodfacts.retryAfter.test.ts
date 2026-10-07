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

describe('openfoodfacts — 429 pause', () => {
  const originalFetch = global.fetch;
  let now: number;
  let fetchMock: jest.Mock;
  let putOFFCache: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function load(retryAfter: string | null | undefined) {
    fetchMock = jest.fn().mockImplementation(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => retryAfter },
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, json: async () => body };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    putOFFCache = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../db/database', () => ({
      getDatabase: () => {
        throw new Error('not initialised');
      },
      putOFFCache,
    }));
    return require('../openfoodfacts') as typeof import('../openfoodfacts');
  }

  async function pauseLengthMs(retryAfter: string | null | undefined): Promise<number> {
    const { lookupNutrition } = load(retryAfter);
    expect(await lookupNutrition('a')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let low = 0;
    let high = 400_000;
    const start = now;
    while (high - low > 500) {
      const mid = Math.floor((low + high) / 2);
      now = start + mid;
      const before = fetchMock.mock.calls.length;
      await lookupNutrition(`probe${mid}`);
      if (fetchMock.mock.calls.length > before) high = mid;
      else low = mid;
    }
    return Math.round((low + high) / 2 / 1000) * 1000;
  }

  it('sends nothing for Retry-After seconds, then resumes', async () => {
    const { lookupNutrition } = load('30');
    expect(await lookupNutrition('a')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 29_000;
    expect(await lookupNutrition('b')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1_000;
    expect(await lookupNutrition('b')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('spends no budget slot and writes no cache entry while paused', async () => {
    const { lookupNutrition } = load('30');
    await lookupNutrition('a');
    for (let i = 0; i < 20; i++) await lookupNutrition(`p${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putOFFCache).not.toHaveBeenCalled();

    now += 30_000;
    for (let i = 0; i < 9; i++) {
      expect(await lookupNutrition(`q${i}`)).not.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('pauses about 45 s for an HTTP-date 45 s ahead', async () => {
    const date = new Date(1_000_000 + 45_000).toUTCString();
    const ms = await pauseLengthMs(date);
    expect(ms).toBeGreaterThanOrEqual(44_000);
    expect(ms).toBeLessThanOrEqual(46_000);
  });

  it.each([[undefined], [null], ['abc'], ['-5']])('pauses 60 s for %p', async (raw) => {
    expect(await pauseLengthMs(raw)).toBe(60_000);
  });

  it('clamps 86400 to 300 s and "0" to 1 s', async () => {
    expect(await pauseLengthMs('86400')).toBe(300_000);
  });

  it('clamps "0" to 1 s', async () => {
    expect(await pauseLengthMs('0')).toBe(1_000);
  });
});

describe('parseRetryAfterMs', () => {
  const NOW = 1_700_000_000_000;
  let parseRetryAfterMs: (raw: string | null | undefined) => number;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(Date, 'now').mockImplementation(() => NOW);
    jest.doMock('../../db/database', () => ({
      getDatabase: () => {
        throw new Error('not initialised');
      },
      putOFFCache: jest.fn(),
    }));
    parseRetryAfterMs = (require('../openfoodfacts') as typeof import('../openfoodfacts'))
      .parseRetryAfterMs;
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads digits as seconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
  });

  it('reads an HTTP-date as the distance from now', () => {
    expect(parseRetryAfterMs(new Date(NOW + 45_000).toUTCString())).toBe(45_000);
  });

  it('falls back to 60 s for missing, empty, garbage, negative and decimal values', () => {
    for (const raw of [undefined, null, '', '   ', 'abc', '-5', '1.5']) {
      expect(parseRetryAfterMs(raw)).toBe(60_000);
    }
  });

  it('clamps "0" and a past HTTP-date up to 1 s', () => {
    expect(parseRetryAfterMs('0')).toBe(1_000);
    expect(parseRetryAfterMs(new Date(NOW - 3_600_000).toUTCString())).toBe(1_000);
  });

  it('clamps large values down to 300 s', () => {
    expect(parseRetryAfterMs('86400')).toBe(300_000);
    expect(parseRetryAfterMs('99999999999')).toBe(300_000);
    expect(parseRetryAfterMs('9'.repeat(400))).toBe(300_000);
  });

  it('trims surrounding whitespace', () => {
    expect(parseRetryAfterMs('  30  ')).toBe(30_000);
  });

  it('never throws on non-string input', () => {
    expect(() => parseRetryAfterMs({} as unknown as string)).not.toThrow();
    expect(parseRetryAfterMs({} as unknown as string)).toBe(60_000);
  });
});
