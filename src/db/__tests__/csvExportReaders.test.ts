import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

async function loadDb(): Promise<{ mod: DatabaseModule; raw: SqljsExpoDb }> {
  const raw = await createSqljsDb();
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => raw,
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  const mod = require('../database') as DatabaseModule;
  await mod.initDatabase();
  await raw.execAsync(
    'DELETE FROM workout_set_log; DELETE FROM weekly_meal_plan; DELETE FROM daily_log; DELETE FROM recipe_library;'
  );
  return { mod, raw };
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

async function insertSet(
  raw: SqljsExpoDb,
  date: string,
  exercise: string,
  setIndex: number,
  setType: string | null
) {
  await raw.runAsync(
    'INSERT INTO workout_set_log (date, exercise, set_index, reps, weight_kg, created_at, set_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [date, exercise, setIndex, 5, 60, `${date}T08:00:00.000Z`, setType]
  );
}

async function insertRecipe(raw: SqljsExpoDb, id: string, title: string, archivedAt: string | null) {
  await raw.runAsync(
    `INSERT INTO recipe_library
       (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, archived_at)
     VALUES (?, ?, 'Dinner', 500, 40, 50, 15, 20, 4, '[]', '[]', ?)`,
    [id, title, archivedAt]
  );
}

async function insertMeal(raw: SqljsExpoDb, date: string, mealType: string, recipeId: string, consumed: number) {
  await raw.runAsync(
    'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, ?)',
    [date, mealType, recipeId, consumed]
  );
}

describe('getAllWorkoutSetsForExport', () => {
  it('returns every set ordered by date, exercise and set index', async () => {
    const { mod, raw } = await loadDb();
    await insertSet(raw, '2026-03-02', 'Squat', 0, null);
    await insertSet(raw, '2026-03-01', 'Squat', 1, 'warmup');
    await insertSet(raw, '2026-03-01', 'Bench', 0, null);
    await insertSet(raw, '2026-03-01', 'Squat', 0, null);

    const rows = await mod.getAllWorkoutSetsForExport();

    expect(rows.map((r) => [r.date, r.exercise, r.set_index])).toEqual([
      ['2026-03-01', 'Bench', 0],
      ['2026-03-01', 'Squat', 0],
      ['2026-03-01', 'Squat', 1],
      ['2026-03-02', 'Squat', 0],
    ]);
  });

  it('returns the stored set_type, weight and created_at', async () => {
    const { mod, raw } = await loadDb();
    await insertSet(raw, '2026-03-01', 'Squat', 0, 'warmup');

    const [row] = await mod.getAllWorkoutSetsForExport();

    expect(row).toEqual({
      date: '2026-03-01',
      exercise: 'Squat',
      set_index: 0,
      set_type: 'warmup',
      reps: 5,
      weight_kg: 60,
      created_at: '2026-03-01T08:00:00.000Z',
    });
  });

  it('returns an empty list for an empty table', async () => {
    const { mod } = await loadDb();
    expect(await mod.getAllWorkoutSetsForExport()).toEqual([]);
  });
});

describe('getAllDailyLogForExport', () => {
  it('returns every row ordered by date with only the exported columns', async () => {
    const { mod, raw } = await loadDb();
    await raw.runAsync(
      "INSERT INTO daily_log (date, walking_task, hammer_task, walk_completed, hammer_completed, fasting_completed, body_weight, water_ml) VALUES (?, 'Walk', 'Hammer', 1, 0, 1, 80.5, 1200)",
      ['2026-03-02']
    );
    await raw.runAsync(
      "INSERT INTO daily_log (date, walking_task, hammer_task) VALUES (?, 'Walk', 'Hammer')",
      ['2026-03-01']
    );

    const rows = await mod.getAllDailyLogForExport();

    expect(rows).toEqual([
      {
        date: '2026-03-01',
        body_weight: null,
        water_ml: 0,
        walk_completed: 0,
        hammer_completed: 0,
        fasting_completed: 0,
      },
      {
        date: '2026-03-02',
        body_weight: 80.5,
        water_ml: 1200,
        walk_completed: 1,
        hammer_completed: 0,
        fasting_completed: 1,
      },
    ]);
  });

  it('returns an empty list for an empty table', async () => {
    const { mod } = await loadDb();
    expect(await mod.getAllDailyLogForExport()).toEqual([]);
  });
});

describe('getAllMealsForExport', () => {
  it('orders by date, then breakfast, lunch, dinner, then id', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 'Oats', null);
    await insertMeal(raw, '2026-03-02', 'breakfast', 'r1', 0);
    await insertMeal(raw, '2026-03-01', 'dinner', 'r1', 0);
    await insertMeal(raw, '2026-03-01', 'snack', 'r1', 0);
    await insertMeal(raw, '2026-03-01', 'breakfast', 'r1', 0);
    await insertMeal(raw, '2026-03-01', 'lunch', 'r1', 0);

    const rows = await mod.getAllMealsForExport();

    expect(rows.map((r) => [r.date, r.meal_type])).toEqual([
      ['2026-03-01', 'breakfast'],
      ['2026-03-01', 'lunch'],
      ['2026-03-01', 'dinner'],
      ['2026-03-01', 'snack'],
      ['2026-03-02', 'breakfast'],
    ]);
  });

  it('joins the per-portion macros and title from the recipe', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 'Oats', null);
    await insertMeal(raw, '2026-03-01', 'breakfast', 'r1', 1);

    expect(await mod.getAllMealsForExport()).toEqual([
      {
        date: '2026-03-01',
        meal_type: 'breakfast',
        recipe_title: 'Oats',
        calories: 500,
        protein: 40,
        carbs: 50,
        fat: 15,
        is_consumed: 1,
      },
    ]);
  });

  it('still joins an archived recipe', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 'Old soup', '2026-01-01T00:00:00.000Z');
    await insertMeal(raw, '2026-03-01', 'lunch', 'r1', 0);

    const [row] = await mod.getAllMealsForExport();

    expect(row.recipe_title).toBe('Old soup');
    expect(row.calories).toBe(500);
  });

  it('returns NULL title and macros for a dangling recipe id and keeps the rest', async () => {
    const { mod, raw } = await loadDb();
    await raw.execAsync('PRAGMA foreign_keys = OFF;');
    await insertMeal(raw, '2026-03-01', 'lunch', 'gone', 1);

    const [row] = await mod.getAllMealsForExport();

    expect(row).toEqual({
      date: '2026-03-01',
      meal_type: 'lunch',
      recipe_title: null,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      is_consumed: 1,
    });
  });

  it('returns an empty list for an empty table', async () => {
    const { mod } = await loadDb();
    expect(await mod.getAllMealsForExport()).toEqual([]);
  });
});
