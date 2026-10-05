/**
 * Deleting a recipe archives it: it disappears from the recipe getters but
 * every join that resolves recipe_id keeps working, and importing it again
 * restores it. The v38 migration leaves orphans from earlier hard deletes alone.
 *
 * Issue #316
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS } from '../schema';

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

const CUSTOM_ID = 'custom-archive-1';

function customRecipe(): Parameters<DatabaseModule['importRecipe']>[0] {
  return {
    id: CUSTOM_ID,
    title: 'Archive Me',
    category: 'Archive Category',
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

async function seedRecipeWithHistory(db: DatabaseModule, today: string): Promise<void> {
  await db.importRecipe(customRecipe());
  const raw = db.getDatabase();
  await raw.runAsync(
    'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, ?, ?)',
    [CUSTOM_ID, 3, today]
  );
  await raw.runAsync('INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)', [
    CUSTOM_ID,
    2,
  ]);
  await raw.runAsync(
    'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 1)',
    [today, 'dinner', CUSTOM_ID]
  );
  await raw.runAsync('INSERT INTO cook_log (recipe_id, portions, date) VALUES (?, ?, ?)', [
    CUSTOM_ID,
    4,
    today,
  ]);
}

describe('deleteRecipe archives instead of deleting (#316)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('hides the recipe from the getters but leaves every joined read unchanged', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const today = db.toISODate();
    await seedRecipeWithHistory(db, today);

    const snapshot = async () => ({
      macros: await db.getConsumedMacrosByDay(30),
      eaten: await db.getMostEatenRecipes(50),
      cooked: await db.getMostCookedRecipes(50),
      inventory: await db.getMealInventory(),
      tasks: await db.getCookingTasks(),
      today: await db.getTodaysMealsWithRecipe(today),
    });

    const before = await snapshot();
    expect(before.inventory.some((i) => i.recipe_id === CUSTOM_ID)).toBe(true);
    expect(before.tasks.some((t) => t.recipe_id === CUSTOM_ID)).toBe(true);
    expect(before.cooked.some((c) => c.recipe_id === CUSTOM_ID)).toBe(true);
    expect(before.eaten.some((e) => e.recipe_id === CUSTOM_ID)).toBe(true);
    expect(before.macros.length).toBeGreaterThan(0);

    await db.deleteRecipe(CUSTOM_ID);

    expect((await db.getRecipes()).some((r) => r.id === CUSTOM_ID)).toBe(false);
    expect((await db.getRecipes('Archive Category')).length).toBe(0);
    expect(await db.getRecipeCategories()).not.toContain('Archive Category');
    expect(await db.getRecipeById(CUSTOM_ID)).toBeNull();

    expect(await snapshot()).toEqual(before);
  });

  it('importRecipe on an archived id restores it and returns true', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.importRecipe(customRecipe());
    await db.deleteRecipe(CUSTOM_ID);

    expect(await db.importRecipe(customRecipe())).toBe(true);
    expect((await db.getRecipes()).some((r) => r.id === CUSTOM_ID)).toBe(true);
    expect(await db.getRecipeById(CUSTOM_ID)).not.toBeNull();
  });

  it('importRecipe on an active id still returns false', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await db.importRecipe(customRecipe());
    expect(await db.importRecipe(customRecipe())).toBe(false);
  });

  it('deleteRecipe on an unknown id does not throw', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await expect(db.deleteRecipe('nope')).resolves.toBeUndefined();
  });
});

describe('v38 orphaned rows (#316)', () => {
  it('keeps orphaned rows in all four tables', async () => {
    const raw = await createSqljsDb();
    await raw.execAsync('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY NOT NULL);');
    for (const m of MIGRATIONS.filter((x) => x.version <= 37)) {
      await raw.execAsync(m.sql);
    }
    await raw.runAsync(
      `INSERT INTO recipe_library (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, freezerTips)
       VALUES ('keep', 'Keep', 'c', 1, 1, 1, 1, 1, 1, '[]', '', '')`
    );
    for (const id of ['keep', 'gone']) {
      await raw.runAsync('INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, 1, ?)', [id, '2024-01-01']);
      await raw.runAsync('INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, 1)', [id]);
      await raw.runAsync("INSERT INTO weekly_meal_plan (date, meal_type, recipe_id) VALUES ('2024-01-01', ?, ?)", ['m-' + id, id]);
      await raw.runAsync("INSERT INTO cook_log (recipe_id, portions, date) VALUES (?, 1, '2024-01-01')", [id]);
    }

    const v38 = MIGRATIONS.find((m) => m.version === 38);
    expect(v38).toBeDefined();
    expect(v38!.sql).not.toMatch(/\b(BEGIN|COMMIT)\b/i);
    await raw.execAsync(v38!.sql);

    for (const table of ['meal_inventory', 'cooking_tasks', 'weekly_meal_plan', 'cook_log']) {
      const rows = await raw.getAllAsync<{ recipe_id: string }>(`SELECT recipe_id FROM ${table} ORDER BY rowid`);
      expect(rows.map((r) => r.recipe_id)).toEqual(['keep', 'gone']);
    }
  });
});
