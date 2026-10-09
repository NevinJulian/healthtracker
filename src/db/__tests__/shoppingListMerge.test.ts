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

async function freshDb(): Promise<DatabaseModule> {
  const db = loadFreshDatabaseModule();
  await db.initDatabase();
  return db;
}

describe('shopping list merge on add', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('merges the same ingredient with a different qualifier into the first line', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Onion, diced', 1, 'whole');
    await db.addShoppingListItem('onion, chopped', 2, 'whole');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].ingredient_name).toBe('Onion, diced');
    expect(rows[0].total_quantity).toBe(3);
    expect(rows[0].unit).toBe('whole');
  });

  it('merges g and kg into the unit of the existing line', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Flour', 500, 'g');
    await db.addShoppingListItem('Flour', 0.5, 'kg');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].total_quantity).toBe(1000);
    expect(rows[0].unit).toBe('g');
  });

  it('merges l and ml into the unit of the existing line', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Milk', 1, 'l');
    await db.addShoppingListItem('Milk', 250, 'ml');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].total_quantity).toBe(1.25);
    expect(rows[0].unit).toBe('l');
  });

  it('keeps incompatible units on separate lines', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Stock', 200, 'g');
    await db.addShoppingListItem('Stock', 100, 'ml');
    await db.addShoppingListItem('Onion', 2, 'whole');
    await db.addShoppingListItem('Onion', 150, 'g');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(4);
  });

  it('never merges into a checked line', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Butter', 100, 'g');
    const [first] = await db.getShoppingListItems();
    await db.toggleShoppingListItem(first.id, true);
    await db.addShoppingListItem('Butter', 50, 'g');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(2);
    const checked = rows.find((r) => r.is_checked);
    const open = rows.find((r) => !r.is_checked);
    expect(checked?.total_quantity).toBe(100);
    expect(open?.total_quantity).toBe(50);
  });

  it('adds to the lowest-id unchecked line when pre-existing duplicates exist', async () => {
    const db = await freshDb();
    const raw = db.getDatabase();
    await raw.runAsync(
      'INSERT INTO shopping_list (ingredient_name, total_quantity, unit, is_checked) VALUES (?, ?, ?, 0)',
      ['Rice', 100, 'g']
    );
    await raw.runAsync(
      'INSERT INTO shopping_list (ingredient_name, total_quantity, unit, is_checked) VALUES (?, ?, ?, 0)',
      ['Rice', 200, 'g']
    );
    await db.addShoppingListItem('Rice', 10, 'g');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(2);
    const byQty = rows.map((r) => r.total_quantity).sort((a, b) => a - b);
    expect(byQty).toEqual([110, 200]);
  });

  it('does not merge singular and plural names', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Onion', 1, 'whole');
    await db.addShoppingListItem('Onions', 1, 'whole');

    expect(await db.getShoppingListItems()).toHaveLength(2);
  });

  it('merges items of one recipe that share a key', async () => {
    const db = await freshDb();
    await db.addRecipeToShoppingList(
      [
        { name: 'Olive oil', quantity: 10, unit: 'ml' },
        { name: 'Garlic cloves, minced', quantity: 3, unit: 'whole' },
        { name: 'Olive oil (for roasting garlic)', quantity: 5, unit: 'ml' },
        { name: 'olive oil', quantity: 5, unit: 'ml' },
      ],
      'r001',
      2
    );

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(3);
    const oil = rows.find((r) => r.ingredient_name === 'Olive oil');
    expect(oil?.total_quantity).toBe(15);
  });

  it('merges a recipe ingredient into a line added earlier', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Garlic cloves, minced', 3, 'whole');
    await db.addRecipeToShoppingList(
      [{ name: 'Garlic cloves, whole', quantity: 2, unit: 'whole' }],
      'r001',
      1
    );

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].total_quantity).toBe(5);
  });

  it('rounds merged quantities to three decimals', async () => {
    const db = await freshDb();
    await db.addShoppingListItem('Cumin', 0.1, 'tsp');
    await db.addShoppingListItem('Cumin', 0.2, 'tsp');

    const rows = await db.getShoppingListItems();
    expect(rows).toHaveLength(1);
    expect(rows[0].total_quantity).toBe(0.3);
  });
});
