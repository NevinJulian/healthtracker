import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

function recipe(id: string, title: string): Parameters<DatabaseModule['importRecipe']>[0] {
  return {
    id,
    title,
    category: 'Test Category',
    calories: 500,
    protein: 40,
    carbs: 50,
    fat: 10,
    prepTimeMinutes: 20,
    defaultServings: 4,
    ingredients: [{ name: 'Rice', baseQuantity: 100, unit: 'g' }],
    instructions: 'Cook it',
    freezerTips: '',
  };
}

describe('getRecipesIncludingArchived', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('returns archived and active recipes while getRecipes omits the archived one', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.importRecipe(recipe('active-1', 'Active One'));
    await db.importRecipe(recipe('archived-1', 'Archived One'));
    await db.deleteRecipe('archived-1');

    const all = await db.getRecipesIncludingArchived();
    const archived = all.find((r) => r.id === 'archived-1');
    expect(all.some((r) => r.id === 'active-1')).toBe(true);
    expect(archived?.title).toBe('Archived One');
    expect(archived?.calories).toBe(500);
    expect(Array.isArray(archived?.ingredients)).toBe(true);

    expect((await db.getRecipes()).some((r) => r.id === 'archived-1')).toBe(false);
  });
});
