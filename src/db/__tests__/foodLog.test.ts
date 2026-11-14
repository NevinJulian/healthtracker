import { addDays, todayKey } from '../../utils/dates';
import { MIGRATIONS } from '../schema';
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
  await raw.execAsync('DELETE FROM weekly_meal_plan; DELETE FROM recipe_library;');
  return { mod, raw };
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

const TODAY = todayKey();
const YESTERDAY = addDays(TODAY, -1);

// Raw inserts create the table first, so the totals and restore tests assert
// on behaviour rather than on a missing table.
async function insertEntry(
  raw: SqljsExpoDb,
  date: string,
  label: string | null,
  calories: number,
  protein = 0,
  carbs = 0,
  fat = 0
): Promise<void> {
  await raw.execAsync(
    `CREATE TABLE IF NOT EXISTS food_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       date TEXT NOT NULL,
       label TEXT,
       calories REAL NOT NULL,
       protein REAL NOT NULL DEFAULT 0,
       carbs REAL NOT NULL DEFAULT 0,
       fat REAL NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL
     )`
  );
  await raw.runAsync(
    'INSERT INTO food_log (date, label, calories, protein, carbs, fat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [date, label, calories, protein, carbs, fat, `${date}T08:00:00.000Z`]
  );
}

async function insertRecipe(
  raw: SqljsExpoDb,
  id: string,
  calories: number,
  protein: number,
  carbs: number,
  fat: number
) {
  await raw.runAsync(
    `INSERT INTO recipe_library
       (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions)
     VALUES (?, ?, 'Dinner', ?, ?, ?, ?, 20, 4, '[]', '[]')`,
    [id, `Recipe ${id}`, calories, protein, carbs, fat]
  );
}

async function insertMeal(raw: SqljsExpoDb, date: string, mealType: string, recipeId: string, consumed: number) {
  await raw.runAsync(
    'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, ?)',
    [date, mealType, recipeId, consumed]
  );
}

const V40_SQL = `CREATE TABLE IF NOT EXISTS food_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  label TEXT,
  calories REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date);`;

function normalise(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('migration v40', () => {
  it('is the last entry and creates food_log with its date index', () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1];
    expect(last.version).toBe(40);
    expect(normalise(last.sql)).toBe(normalise(V40_SQL));
  });

  it('creates the table and index on a v39 database and records version 40', async () => {
    const raw = await createSqljsDb();
    await raw.execAsync('CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL);');
    for (const m of MIGRATIONS.filter((x) => x.version <= 39)) {
      await raw.execAsync(m.sql);
      await raw.runAsync('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
    }
    jest.resetModules();
    jest.doMock('expo-sqlite', () => ({
      openDatabaseAsync: async () => raw,
      deleteDatabaseAsync: async () => {},
      SQLiteDatabase: class {},
    }));
    const mod = require('../database') as DatabaseModule;
    await mod.initDatabase();

    const objects = await raw.getAllAsync<{ name: string; type: string }>(
      "SELECT name, type FROM sqlite_master WHERE name IN ('food_log', 'idx_food_log_date')"
    );
    expect(objects.map((o) => `${o.type}:${o.name}`).sort()).toEqual([
      'index:idx_food_log_date',
      'table:food_log',
    ]);
    const version = await raw.getFirstAsync<{ v: number }>('SELECT MAX(version) AS v FROM schema_version');
    expect(version?.v).toBe(40);
  });
});

describe('getConsumedMacrosByDay with food_log entries', () => {
  it('adds a day of entries to its consumed recipe totals and counts meals only', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 500, 40, 50, 15);
    await insertMeal(raw, TODAY, 'lunch', 'r1', 1);
    await insertEntry(raw, TODAY, 'Snack', 250, 10, 30, 5);
    await insertEntry(raw, TODAY, null, 100, 1, 2, 3);

    const days = await mod.getConsumedMacrosByDay(7);

    expect(days).toEqual([{ date: TODAY, calories: 850, protein: 51, carbs: 82, fat: 23, mealCount: 1 }]);
  });

  it('lists a day with only entries, with mealCount 0', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, YESTERDAY, 'Breakfast', 300, 12, 40, 8);

    expect(await mod.getConsumedMacrosByDay(7)).toEqual([
      { date: YESTERDAY, calories: 300, protein: 12, carbs: 40, fat: 8, mealCount: 0 },
    ]);
  });

  it('leaves a meal-only day unchanged', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 500, 40, 50, 15);
    await insertMeal(raw, TODAY, 'dinner', 'r1', 1);
    await insertEntry(raw, YESTERDAY, 'Other day', 100);

    const days = await mod.getConsumedMacrosByDay(7);

    expect(days.find((d) => d.date === TODAY)).toEqual({
      date: TODAY,
      calories: 500,
      protein: 40,
      carbs: 50,
      fat: 15,
      mealCount: 1,
    });
    expect(days.find((d) => d.date === YESTERDAY)?.calories).toBe(100);
  });

  it('adds nothing for an unconsumed meal', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 500, 40, 50, 15);
    await insertMeal(raw, TODAY, 'lunch', 'r1', 0);
    await insertEntry(raw, TODAY, 'Snack', 200, 5);

    expect(await mod.getConsumedMacrosByDay(7)).toEqual([
      { date: TODAY, calories: 200, protein: 5, carbs: 0, fat: 0, mealCount: 0 },
    ]);
  });

  it('excludes an entry older than the window and sorts days ascending', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, addDays(TODAY, -8), 'Too old', 999);
    await insertEntry(raw, TODAY, 'Today', 100);
    await insertEntry(raw, addDays(TODAY, -7), 'Edge', 200);

    const days = await mod.getConsumedMacrosByDay(7);

    expect(days.map((d) => [d.date, d.calories])).toEqual([
      [addDays(TODAY, -7), 200],
      [TODAY, 100],
    ]);
  });
});

describe('averages and adherence ignore food_log', () => {
  it('returns the same getAverageConsumedMacros and getMealAdherence with and without entries', async () => {
    const { mod, raw } = await loadDb();
    await insertRecipe(raw, 'r1', 500, 40, 50, 15);
    await insertMeal(raw, TODAY, 'lunch', 'r1', 1);
    await insertMeal(raw, TODAY, 'dinner', 'r1', 0);

    const averageBefore = await mod.getAverageConsumedMacros();
    const adherenceBefore = await mod.getMealAdherence(30);
    await insertEntry(raw, TODAY, 'Snack', 900, 90, 90, 90);

    expect(await mod.getAverageConsumedMacros()).toEqual(averageBefore);
    expect(await mod.getMealAdherence(30)).toEqual(adherenceBefore);
    expect(averageBefore.calories).toBe(500);
  });
});

describe('food_log writers', () => {
  const base = { date: TODAY, label: 'Snack', calories: 250, protein: 10, carbs: 20, fat: 5 };

  it('adds an entry and reads it back for its date only', async () => {
    const { mod } = await loadDb();
    const id = await mod.addFoodLogEntry(base);
    await mod.addFoodLogEntry({ ...base, date: YESTERDAY, label: 'Old' });

    const entries = await mod.getFoodLogForDate(TODAY);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id, date: TODAY, label: 'Snack', calories: 250, protein: 10, carbs: 20, fat: 5 });
    expect(entries[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stores the numbers as entered, trims the label and stores a blank label as NULL', async () => {
    const { mod } = await loadDb();
    await mod.addFoodLogEntry({ ...base, label: '  Yoghurt  ', calories: 250.5 });
    await mod.addFoodLogEntry({ ...base, label: '   ' });

    const entries = await mod.getFoodLogForDate(TODAY);

    expect(entries.map((e) => e.label)).toEqual(['Yoghurt', null]);
    expect(entries[0].calories).toBe(250.5);
  });

  it('returns entries ordered by id', async () => {
    const { mod } = await loadDb();
    const a = await mod.addFoodLogEntry({ ...base, label: 'A' });
    const b = await mod.addFoodLogEntry({ ...base, label: 'B' });

    expect((await mod.getFoodLogForDate(TODAY)).map((e) => e.id)).toEqual([a, b]);
  });

  it('updates the row and keeps its date and created_at', async () => {
    const { mod } = await loadDb();
    const id = await mod.addFoodLogEntry(base);
    const other = await mod.addFoodLogEntry({ ...base, label: 'Other' });
    const [before] = await mod.getFoodLogForDate(TODAY);

    await mod.updateFoodLogEntry(id, { label: 'Snack 2', calories: 300, protein: 12, carbs: 0, fat: 1 });

    const entries = await mod.getFoodLogForDate(TODAY);
    expect(entries[0]).toEqual({ ...before, label: 'Snack 2', calories: 300, protein: 12, carbs: 0, fat: 1 });
    expect(entries.find((e) => e.id === other)?.label).toBe('Other');
  });

  it('throws when updating a missing id', async () => {
    const { mod } = await loadDb();
    await expect(
      mod.updateFoodLogEntry(999, { label: null, calories: 100, protein: 0, carbs: 0, fat: 0 })
    ).rejects.toThrow('Food log entry not found');
  });

  it('deletes only that row', async () => {
    const { mod } = await loadDb();
    const a = await mod.addFoodLogEntry(base);
    const b = await mod.addFoodLogEntry({ ...base, label: 'B' });

    await mod.deleteFoodLogEntry(a);

    expect((await mod.getFoodLogForDate(TODAY)).map((e) => e.id)).toEqual([b]);
  });

  it.each([
    ['zero calories', { calories: 0 }],
    ['calories above 5000', { calories: 5000.01 }],
    ['negative protein', { protein: -1 }],
    ['carbs above 500', { carbs: 500.01 }],
    ['fat above 500', { fat: 501 }],
    ['NaN calories', { calories: Number.NaN }],
    ['a 61 character label', { label: 'a'.repeat(61) }],
  ])('rejects %s on add and on update', async (_name, patch) => {
    const { mod } = await loadDb();
    const id = await mod.addFoodLogEntry(base);
    const { date: _date, ...fields } = { ...base, ...patch };

    await expect(mod.addFoodLogEntry({ ...base, ...patch })).rejects.toThrow();
    await expect(mod.updateFoodLogEntry(id, fields)).rejects.toThrow();
    expect(await mod.getFoodLogForDate(TODAY)).toHaveLength(1);
  });

  it('rejects a malformed date on add', async () => {
    const { mod } = await loadDb();
    await expect(mod.addFoodLogEntry({ ...base, date: '2026-3-1' })).rejects.toThrow();
  });

  it('accepts the boundary values', async () => {
    const { mod } = await loadDb();
    await mod.addFoodLogEntry({ ...base, calories: 5000, protein: 500, carbs: 0, fat: 500, label: 'a'.repeat(60) });
    expect(await mod.getFoodLogForDate(TODAY)).toHaveLength(1);
  });
});

describe('getFoodLogTotalsByDate', () => {
  it('sums calories and protein per date inside the range', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, TODAY, 'a', 100, 5);
    await insertEntry(raw, TODAY, 'b', 50, 2);
    await insertEntry(raw, addDays(TODAY, 1), 'c', 70, 1);
    await insertEntry(raw, addDays(TODAY, 9), 'outside', 999, 99);

    expect(await mod.getFoodLogTotalsByDate(TODAY, addDays(TODAY, 6))).toEqual({
      [TODAY]: { calories: 150, protein: 7 },
      [addDays(TODAY, 1)]: { calories: 70, protein: 1 },
    });
  });
});

describe('getAllFoodLogForExport', () => {
  it('returns the export columns ordered by date then id', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, '2026-03-02', 'Later', 100, 1, 2, 3);
    await insertEntry(raw, '2026-03-01', 'B', 200, 4, 5, 6);
    await insertEntry(raw, '2026-03-01', null, 300, 0, 0, 0);

    expect(await mod.getAllFoodLogForExport()).toEqual([
      { date: '2026-03-01', label: 'B', calories: 200, protein: 4, carbs: 5, fat: 6 },
      { date: '2026-03-01', label: null, calories: 300, protein: 0, carbs: 0, fat: 0 },
      { date: '2026-03-02', label: 'Later', calories: 100, protein: 1, carbs: 2, fat: 3 },
    ]);
  });
});

describe('backup and restore', () => {
  it('dumps food_log and restores it with its ids', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, TODAY, 'Snack', 250, 10, 20, 5);
    await insertEntry(raw, YESTERDAY, null, 100);
    await raw.runAsync('DELETE FROM food_log WHERE id = 1');
    await insertEntry(raw, YESTERDAY, 'Third', 120);

    const dump = await mod.dumpAllTables();
    expect(dump.tables.food_log.map((r) => r.id)).toEqual([2, 3]);

    await raw.runAsync('DELETE FROM food_log');
    await insertEntry(raw, TODAY, 'Stray', 1);
    await mod.restoreFromPayload(dump.tables, dump.schemaVersion);

    const after = await mod.dumpAllTables();
    expect(after.tables.food_log).toEqual(dump.tables.food_log);
  });

  it('empties food_log when the backup has no food_log key', async () => {
    const { mod, raw } = await loadDb();
    await insertEntry(raw, TODAY, 'Snack', 250);
    await insertEntry(raw, YESTERDAY, 'Other', 100);

    await mod.restoreFromPayload({ app_state: [] }, 39);

    expect(await raw.getAllAsync('SELECT * FROM food_log')).toEqual([]);
  });
});
