jest.mock('../../api/openfoodfacts', () => ({
  lookupNutrition: jest.fn(),
}));

import { buildImportResult } from '../importRecipe';
import { lookupNutrition } from '../../api/openfoodfacts';
import type { MealDetail } from '../../api/mealdb';

const mockLookup = lookupNutrition as jest.Mock;

const NUTRITION = { kcal: 40, protein: 10, carbs: 0, fat: 0 };
const NAMES = ['zzz unknown a', 'zzz unknown b', 'zzz unknown c', 'zzz unknown d', 'zzz unknown e'];

function meal(names: string[]): MealDetail {
  return {
    id: '1',
    name: 'Test meal',
    category: 'Misc',
    area: 'Nowhere',
    thumb: null,
    instructions: '',
    tags: [],
    youtube: null,
    ingredients: names.map((ingredient) => ({ ingredient, measure: '100g' })),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('buildImportResult nutrition lookups', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('runs up to three lookups at once and keeps results in ingredient order', async () => {
    const pending = new Map<string, (v: typeof NUTRITION | null) => void>();
    let inFlight = 0;
    let maxInFlight = 0;
    mockLookup.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.set(name, (v) => {
            inFlight--;
            resolve(v);
          });
        }),
    );

    const done = buildImportResult(meal(NAMES));
    await flush();
    expect(mockLookup).toHaveBeenCalledTimes(3);

    for (const name of ['zzz unknown c', 'zzz unknown a', 'zzz unknown b']) {
      pending.get(name)!(name === 'zzz unknown b' ? null : NUTRITION);
      await flush();
    }
    expect(mockLookup).toHaveBeenCalledTimes(5);

    pending.get('zzz unknown e')!(NUTRITION);
    pending.get('zzz unknown d')!(NUTRITION);
    const result = await done;

    expect(maxInFlight).toBe(3);
    expect(result.offResolvedIngredients).toEqual([
      'zzz unknown a',
      'zzz unknown c',
      'zzz unknown d',
      'zzz unknown e',
    ]);
    expect(result.estimatedIngredients).toEqual(['zzz unknown b']);
  });

  it('treats a lookup that throws as unresolved without failing the import', async () => {
    mockLookup.mockImplementation(async (name: string) => {
      if (name === 'zzz unknown b') throw new Error('offline');
      return NUTRITION;
    });

    const result = await buildImportResult(meal(NAMES.slice(0, 3)));

    expect(result.offResolvedIngredients).toEqual(['zzz unknown a', 'zzz unknown c']);
    expect(result.estimatedIngredients).toEqual(['zzz unknown b']);
  });
});

describe('buildImportResult refused lookups', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('reports refused lookups apart from ones with no data and counts them as 0', async () => {
    const answers: Record<string, unknown> = {
      'zzz unknown a': NUTRITION,
      'zzz unknown b': null,
      'zzz unknown c': 'not-looked-up',
      'zzz unknown d': 'not-looked-up',
    };
    mockLookup.mockImplementation(async (name: string) => answers[name]);

    const result = await buildImportResult(meal(NAMES.slice(0, 4)));

    expect(result.offResolvedIngredients).toEqual(['zzz unknown a']);
    expect(result.estimatedIngredients).toEqual(['zzz unknown b']);
    expect(result.notLookedUpIngredients).toEqual(['zzz unknown c', 'zzz unknown d']);

    mockLookup.mockImplementation(async (name: string) =>
      name === 'zzz unknown a' ? NUTRITION : null,
    );
    const baseline = await buildImportResult(meal(NAMES.slice(0, 4)));
    expect(result.recipe.calories).toBe(baseline.recipe.calories);
    expect(baseline.notLookedUpIngredients).toEqual([]);
  });
});

describe('buildImportResult abort signal', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('forwards the signal to each lookup', async () => {
    mockLookup.mockResolvedValue(NUTRITION);
    const controller = new AbortController();

    await buildImportResult(meal(NAMES.slice(0, 2)), 4, controller.signal);

    expect(mockLookup).toHaveBeenCalledTimes(2);
    for (const call of mockLookup.mock.calls) expect(call[1]).toBe(controller.signal);
  });

  it('starts no further lookups once aborted', async () => {
    const controller = new AbortController();
    mockLookup.mockImplementation(async () => {
      controller.abort();
      return null;
    });

    await buildImportResult(meal(NAMES), 4, controller.signal);

    expect(mockLookup.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
