import { createSqljsDb, SqljsExpoDb } from '../testHelpers/sqljsExpoAdapter';

describe('sql.js adapter cleanup', () => {
  const leaked: SqljsExpoDb[] = [];

  it('creates databases and leaves them open', async () => {
    leaked.push(await createSqljsDb(), await createSqljsDb());
    await expect(leaked[0].execAsync('SELECT 1')).resolves.toBeUndefined();
    await expect(leaked[1].execAsync('SELECT 1')).resolves.toBeUndefined();
  });

  it('has closed every database the previous test left open', async () => {
    expect(leaked).toHaveLength(2);
    for (const db of leaked) {
      await expect(db.execAsync('SELECT 1')).rejects.toThrow('Database closed');
    }
  });

  it('tolerates closing a database twice', async () => {
    const db = await createSqljsDb();
    await db.closeAsync();
    await expect(db.closeAsync()).resolves.toBeUndefined();
  });
});
