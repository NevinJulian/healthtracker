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

const TODAY = '2026-10-09';

function row(recipe_id: string, cook_events: number, last_date: string, title = recipe_id) {
  return { recipe_id, title, cook_events, last_date };
}

describe('rankOftenCooked', () => {
  const { rankOftenCooked } = loadFreshDatabaseModule();

  it('returns an empty list for no rows', () => {
    expect(rankOftenCooked([], TODAY)).toEqual([]);
  });

  it('ranks four events cooked today above ten events cooked twenty days ago', () => {
    const ranked = rankOftenCooked([row('old', 10, '2026-09-19'), row('fresh', 4, TODAY)], TODAY);

    expect(ranked.map((r) => r.recipe_id)).toEqual(['fresh', 'old']);
    expect(ranked[0].score).toBeCloseTo(4, 5);
    expect(ranked[1].score).toBeCloseTo(10 * Math.pow(0.95, 20), 5);
  });

  it('keeps the best five of seven', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(`r${n}`, n, TODAY));

    const ranked = rankOftenCooked(rows, TODAY);

    expect(ranked.map((r) => r.recipe_id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3']);
  });

  it('honours an explicit limit', () => {
    const rows = [1, 2, 3].map((n) => row(`r${n}`, n, TODAY));

    expect(rankOftenCooked(rows, TODAY, 2).map((r) => r.recipe_id)).toEqual(['r3', 'r2']);
    expect(rankOftenCooked(rows, TODAY, 0)).toEqual([]);
  });

  it('breaks a tie by later last date, then title, then id', () => {
    const ranked = rankOftenCooked(
      [
        row('c', 2, TODAY, 'Pasta'),
        row('b', 2, TODAY, 'Curry'),
        row('a', 2, TODAY, 'Curry'),
        row('d', 2, '2026-10-12', 'Zucchini'),
      ],
      TODAY
    );

    expect(ranked.map((r) => r.recipe_id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('clamps a future last date so the score is the event count', () => {
    const [only] = rankOftenCooked([row('f', 3, '2027-01-01')], TODAY);

    expect(only.score).toBe(3);
  });

  it('gives a malformed last date a finite score that ranks last', () => {
    const ranked = rankOftenCooked([row('bad', 9, 'not-a-date'), row('ok', 1, '2026-09-09')], TODAY);

    expect(ranked.map((r) => r.recipe_id)).toEqual(['ok', 'bad']);
    for (const r of ranked) expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('getOftenCookedRecipes', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  async function logCook(db: DatabaseModule, recipe_id: string, portions: number, date: string) {
    await db
      .getDatabase()
      .runAsync('INSERT INTO cook_log (recipe_id, portions, date) VALUES (?, ?, ?)', [recipe_id, portions, date]);
  }

  it('counts cook events, not portions', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await logCook(db, 'r001', 50, TODAY);
    await logCook(db, 'r002', 1, TODAY);
    await logCook(db, 'r002', 1, TODAY);

    const result = await db.getOftenCookedRecipes(5, TODAY);

    expect(result.map((r) => r.recipe_id)).toEqual(['r002', 'r001']);
    expect(result[0].title).toBeTruthy();
  });

  it('leaves out archived recipes', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await logCook(db, 'r001', 4, TODAY);
    await logCook(db, 'r002', 4, TODAY);
    await db
      .getDatabase()
      .runAsync("UPDATE recipe_library SET archived_at = '2026-10-01' WHERE id = 'r001'");

    const result = await db.getOftenCookedRecipes(5, TODAY);

    expect(result.map((r) => r.recipe_id)).toEqual(['r002']);
  });

  it('returns an empty list when nothing was cooked', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.getOftenCookedRecipes(5, TODAY)).toEqual([]);
  });

  it('uses the most recent cook date of each recipe', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    await logCook(db, 'r001', 4, '2026-06-01');
    await logCook(db, 'r001', 4, TODAY);
    await logCook(db, 'r002', 4, '2026-09-29');
    await logCook(db, 'r002', 4, '2026-09-29');

    const result = await db.getOftenCookedRecipes(5, TODAY);

    expect(result.map((r) => r.recipe_id)).toEqual(['r001', 'r002']);
  });
});
