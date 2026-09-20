/**
 * Regression tests for #321.
 *
 * `seedBioForceLibrary` and `seedRecipeLibrary` (database.ts) each
 * `prepareAsync` an INSERT statement, run the insert loop inside
 * `withTransactionAsync`, and only THEN `finalizeAsync` the statement — with
 * no try/finally between the transaction and the finalize call. If any
 * `executeAsync` inside the loop throws, `withTransactionAsync` rolls back
 * and rethrows, which skips the `finalizeAsync` call entirely and leaks the
 * prepared statement.
 *
 * Fix: wrap the transaction in try/finally so `finalizeAsync` always runs,
 * whether the transaction succeeded or threw. A `finalizeAsync` rejection is
 * caught and logged, never replacing/masking the original error.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * `migrationAtomicity.test.ts`.
 *
 * Issue #321
 */

import type { BindParams } from 'sql.js';
import {
  createSqljsDb,
  SqljsExpoDb,
  SqljsPreparedStatement,
} from '../testHelpers/sqljsExpoAdapter';
import { bioForceExercises } from '../../../bioForceExercises';
import { recipes } from '../../data/recipes';

type DatabaseModule = typeof import('../database');

function keepAlive(raw: SqljsExpoDb): SqljsExpoDb {
  return { ...raw, closeAsync: async () => {} };
}

/** Mirrors migrationAtomicity.test.ts's loadFreshDatabaseModule. */
function loadFreshDatabaseModule(raw: SqljsExpoDb): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => raw,
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

afterEach(() => {
  jest.dontMock('expo-sqlite');
});

/**
 * Wraps `raw.prepareAsync` so that the FIRST statement whose SQL matches
 * `matchSql` is intercepted: its `executeAsync` throws `inducedError` on the
 * `throwOnCall`-th invocation (1-indexed) instead of delegating to the real
 * statement, and its `finalizeAsync` is a `jest.fn` that — unless
 * `finalizeRejects` is given — delegates to the real `finalizeAsync`.
 *
 * Every other `prepareAsync` call (there are none elsewhere in database.ts
 * today, but this keeps the helper honest) passes straight through to the
 * real adapter.
 */
function wrapPrepareToThrow(
  raw: SqljsExpoDb,
  matchSql: (sql: string) => boolean,
  inducedError: Error,
  throwOnCall: number,
  finalizeRejects?: Error
): { db: SqljsExpoDb; finalizeSpy: jest.Mock<Promise<void>, []> } {
  const finalizeSpy: jest.Mock<Promise<void>, []> = jest.fn();

  const db: SqljsExpoDb = {
    ...raw,
    prepareAsync: async (sql: string): Promise<SqljsPreparedStatement> => {
      const real = await raw.prepareAsync(sql);
      if (!matchSql(sql)) return real;

      let callCount = 0;
      return {
        executeAsync: async (params?: BindParams) => {
          callCount++;
          if (callCount === throwOnCall) {
            throw inducedError;
          }
          return real.executeAsync(params);
        },
        finalizeAsync: finalizeSpy.mockImplementation(async () => {
          if (finalizeRejects) {
            // Still free the real underlying statement so sql.js doesn't
            // warn about a leaked handle, then surface the induced rejection.
            await real.finalizeAsync().catch(() => {});
            throw finalizeRejects;
          }
          return real.finalizeAsync();
        }),
      };
    },
  };

  return { db, finalizeSpy };
}

describe('seedBioForceLibrary finalizes on throw (#321)', () => {
  it('an induced executeAsync throw mid-seed: finalizeAsync is called exactly once, and initDatabase() rejects with the ORIGINAL error object', async () => {
    const raw = keepAlive(await createSqljsDb());
    const inducedError = new Error('simulated bio_force_library insert failure');
    const { db: wrapped, finalizeSpy } = wrapPrepareToThrow(
      raw,
      (sql) => sql.includes('bio_force_library'),
      inducedError,
      2 // succeed on row 1, throw on row 2
    );

    const db = loadFreshDatabaseModule(wrapped);

    await expect(db.initDatabase()).rejects.toBe(inducedError);

    expect(finalizeSpy).toHaveBeenCalledTimes(1);

    // The failed transaction rolled back — no rows persisted.
    const count = await raw.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM bio_force_library'
    );
    expect(count?.count).toBe(0);
  });

  it('a finalizeAsync rejection is caught and logged, and never masks the original induced error', async () => {
    const raw = keepAlive(await createSqljsDb());
    const inducedError = new Error('simulated bio_force_library insert failure');
    const finalizeError = new Error('simulated finalizeAsync failure');
    const { db: wrapped, finalizeSpy } = wrapPrepareToThrow(
      raw,
      (sql) => sql.includes('bio_force_library'),
      inducedError,
      2,
      finalizeError
    );

    const db = loadFreshDatabaseModule(wrapped);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(db.initDatabase()).rejects.toBe(inducedError);

    expect(finalizeSpy).toHaveBeenCalledTimes(1);
    // The finalize failure was logged, not swallowed silently...
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('finalize failed'),
      finalizeError
    );

    warnSpy.mockRestore();
  });
});

describe('seedRecipeLibrary finalizes on throw (#321)', () => {
  it('an induced executeAsync throw mid-seed: finalizeAsync is called exactly once, and initDatabase() rejects with the ORIGINAL error object', async () => {
    const raw = keepAlive(await createSqljsDb());
    const inducedError = new Error('simulated recipe_library insert failure');
    const { db: wrapped, finalizeSpy } = wrapPrepareToThrow(
      raw,
      (sql) => sql.includes('recipe_library'),
      inducedError,
      2
    );

    const db = loadFreshDatabaseModule(wrapped);

    await expect(db.initDatabase()).rejects.toBe(inducedError);

    expect(finalizeSpy).toHaveBeenCalledTimes(1);

    const count = await raw.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM recipe_library'
    );
    expect(count?.count).toBe(0);
  });
});

describe('normal seeding is unaffected (#321)', () => {
  it('a fresh DB seeds both libraries with their full row counts, unchanged', async () => {
    const raw = keepAlive(await createSqljsDb());
    const db = loadFreshDatabaseModule(raw);

    await db.initDatabase();

    const bioCount = await raw.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM bio_force_library'
    );
    expect(bioCount?.count).toBe(bioForceExercises.length);

    const recipeCount = await raw.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM recipe_library'
    );
    expect(recipeCount?.count).toBe(recipes.length);
  });
});
