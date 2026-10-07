import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
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

async function setup(corrupt: string) {
  const db = loadFreshDatabaseModule();
  await db.initDatabase();
  await db.importRecipe(recipe('good-1', 'Good One'));
  await db.importRecipe(recipe('bad-1', 'Bad One'));
  await db
    .getDatabase()
    .runAsync('UPDATE recipe_library SET ingredients = ? WHERE id = ?', [corrupt, 'bad-1']);
  return db;
}

describe('recipe readers with a malformed ingredients column', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    jest.dontMock('expo-sqlite');
  });

  it.each(['{not json', 'null', '{}', '"x"', ''])(
    'getRecipes returns every row with empty ingredients for %p',
    async (corrupt) => {
      const db = await setup(corrupt);
      const rows = await db.getRecipes();
      const bad = rows.find((r) => r.id === 'bad-1');
      const good = rows.find((r) => r.id === 'good-1');
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(bad?.ingredients).toEqual([]);
      expect(bad?.title).toBe('Bad One');
      expect(bad?.calories).toBe(500);
      expect(good?.ingredients).toEqual([{ name: 'Rice', baseQuantity: 100, unit: 'g' }]);
    },
  );

  it('getRecipes with a category filter keeps the corrupt row', async () => {
    const db = await setup('{not json');
    const rows = await db.getRecipes('Test Category');
    expect(rows.map((r) => r.id).sort()).toEqual(['bad-1', 'good-1']);
    expect(rows.find((r) => r.id === 'bad-1')?.ingredients).toEqual([]);
  });

  it('getRecipesIncludingArchived keeps an archived corrupt row', async () => {
    const db = await setup('{not json');
    await db.deleteRecipe('bad-1');
    const active = (await db.getRecipes()).map((r) => r.id);
    expect(active).not.toContain('bad-1');
    expect(active).toContain('good-1');
    expect(await db.getRecipeById('bad-1')).toBeNull();
    const bad = (await db.getRecipesIncludingArchived()).find((r) => r.id === 'bad-1');
    expect(bad?.ingredients).toEqual([]);
    expect(bad?.title).toBe('Bad One');
  });

  it('getRecipeById returns the recipe rather than null', async () => {
    const db = await setup('{not json');
    const bad = await db.getRecipeById('bad-1');
    expect(bad?.ingredients).toEqual([]);
    expect(bad?.title).toBe('Bad One');
  });

  it('logs once per bad row with the recipe id and never the raw text', async () => {
    const db = await setup('{not json');
    await db.getRecipeById('bad-1');
    expect(warn).toHaveBeenCalledTimes(1);
    const args = warn.mock.calls[0];
    expect(args).toContain('bad-1');
    expect(JSON.stringify(args)).not.toContain('{not json');
  });

  it('does not log for healthy rows', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.importRecipe(recipe('good-1', 'Good One'));
    await db.getRecipes();
    await db.getRecipeById('good-1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('getCookingTasks returns the task with empty ingredients', async () => {
    const db = await setup('{not json');
    await db
      .getDatabase()
      .runAsync('INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)', ['bad-1', 2]);
    await db
      .getDatabase()
      .runAsync('INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)', ['good-1', 3]);
    const tasks = await db.getCookingTasks();
    expect(tasks).toHaveLength(2);
    const bad = tasks.find((t) => t.recipe_id === 'bad-1');
    expect(bad?.servings_to_cook).toBe(2);
    expect(bad?.recipe.title).toBe('Bad One');
    expect(bad?.recipe.ingredients).toEqual([]);
    expect(tasks.find((t) => t.recipe_id === 'good-1')?.recipe.ingredients).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toContain('bad-1');
  });
});
