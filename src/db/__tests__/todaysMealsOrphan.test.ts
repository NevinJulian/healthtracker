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

const CUSTOM_ID = 'custom-today-1';

function customRecipe(): Parameters<DatabaseModule['importRecipe']>[0] {
  return {
    id: CUSTOM_ID,
    title: 'Today Recipe',
    category: 'Test Category',
    calories: 500,
    protein: 40,
    carbs: 50,
    fat: 10,
    prepTimeMinutes: 20,
    defaultServings: 4,
    ingredients: [],
    instructions: 'Cook it',
    freezerTips: '',
  };
}

describe('getTodaysMealsWithRecipe', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('returns an orphaned plan row with recipe undefined', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const today = db.toISODate();
    const raw = db.getDatabase();
    await raw.execAsync('PRAGMA foreign_keys = OFF');
    await raw.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 1)',
      [today, 'lunch', 'ghost']
    );

    const meals = await db.getTodaysMealsWithRecipe(today);

    expect(meals).toHaveLength(1);
    expect(meals[0].recipe).toBeUndefined();
    expect(meals[0].meal_type).toBe('lunch');
    expect(meals[0].is_consumed).toBe(true);
    expect(typeof meals[0].id).toBe('number');
  });

  it('resolves a live recipe', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const today = db.toISODate();
    await db.importRecipe(customRecipe());
    await db.getDatabase().runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 0)',
      [today, 'dinner', CUSTOM_ID]
    );

    const meals = await db.getTodaysMealsWithRecipe(today);

    expect(meals[0].recipe).toEqual({
      id: CUSTOM_ID,
      title: 'Today Recipe',
      calories: 500,
      protein: 40,
      carbs: 50,
      fat: 10,
    });
    expect(meals[0].is_consumed).toBe(false);
  });

  it('keeps an archived recipe populated', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const today = db.toISODate();
    await db.importRecipe(customRecipe());
    await db.getDatabase().runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 0)',
      [today, 'dinner', CUSTOM_ID]
    );
    await db.deleteRecipe(CUSTOM_ID);

    const meals = await db.getTodaysMealsWithRecipe(today);

    expect(meals[0].recipe?.title).toBe('Today Recipe');
  });
});
