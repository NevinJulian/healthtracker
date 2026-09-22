/**
 * sql.js-backed fake of the expo-sqlite ASYNC surface, for tests that want
 * a real (in-memory, WASM) SQLite engine behind `database.ts` instead of the
 * jest-mocked no-op `__mocks__/expo-sqlite.js`.
 *
 * Reuses the same `initSqlJs`/`locateFile` loading pattern as
 * `src/db/__tests__/migrations.integration.test.ts` (~:68-76).
 *
 * Location note: this file is intentionally NOT under `src/db/__tests__/`.
 * Jest's default `testMatch` is `**\/__tests__/**\/*.[jt]s?(x)`, which matches
 * *any* JS/TS file anywhere under a directory literally named `__tests__`
 * — including subdirectories like `__tests__/helpers/`. Verified empirically
 * with `npx jest --listTests`: a probe file placed at
 * `src/db/__tests__/helpers/_probe.ts` WAS picked up as a test suite (and,
 * having no `it()`/`describe()`, would fail every run with "must contain at
 * least one test"). Moving it one level up to `src/db/testHelpers/` (not
 * named `__tests__`) is not matched. This keeps the file inside
 * `src/db/**`, still Lane A's territory, without adding a phantom failing
 * suite to `npm test`.
 *
 * Covers every `db.<method>Async` that `src/db/database.ts` actually calls
 * (grepped, not guessed): `execAsync`, `runAsync`, `getFirstAsync`,
 * `getAllAsync`, `prepareAsync` (→ `executeAsync`/`finalizeAsync`),
 * `withTransactionAsync`, `closeAsync`.
 *
 * ── Getting a FRESH database per test ──────────────────────────────────
 * `database.ts` holds a module-level singleton (`_db`) set by
 * `initDatabase()` and reused by `getDatabase()`/every other export. To get
 * an isolated in-memory DB per test:
 *
 *   1. `jest.resetModules()` before each test, so `database.ts` (and its
 *      `_db` singleton) is re-evaluated from scratch on the next `require`.
 *   2. `jest.doMock('expo-sqlite', () => ({
 *        openDatabaseAsync: async () => createSqljsDb(),
 *        deleteDatabaseAsync: async () => {},
 *        SQLiteDatabase: class {},
 *      }))` so the freshly-loaded `database.ts` opens a brand-new sql.js
 *      `Database` instead of the real native module (which jest's regular
 *      `__mocks__/expo-sqlite.js` stubs to no-ops).
 *   3. `require('../database')` AFTER the resetModules + doMock, so the
 *      re-evaluated module picks up the mock.
 *
 * See `src/db/__tests__/syncRollingSchedule.test.ts` for a complete,
 * working example of this pattern.
 */

import path from 'path';
import initSqlJs, { BindParams, Database, SqlJsStatic } from 'sql.js';

// The wasm binary only needs to be loaded once per test process; each
// createSqljsDb() call still gets its own brand-new, independent Database.
let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) =>
        path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), file),
    });
  }
  return sqlJsPromise;
}

export interface SqljsRunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface SqljsPreparedStatement {
  executeAsync(params?: BindParams): Promise<SqljsRunResult>;
  finalizeAsync(): Promise<void>;
}

/** The subset of the expo-sqlite `SQLiteDatabase` async surface database.ts uses. */
export interface SqljsExpoDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: BindParams): Promise<SqljsRunResult>;
  getFirstAsync<T>(sql: string, params?: BindParams): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: BindParams): Promise<T[]>;
  prepareAsync(sql: string): Promise<SqljsPreparedStatement>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

function readLastInsertRowId(db: Database): number {
  const res = db.exec('SELECT last_insert_rowid() AS id');
  if (res.length === 0 || res[0].values.length === 0) return 0;
  const value = res[0].values[0][0];
  return typeof value === 'number' ? value : 0;
}

/**
 * Creates a fresh, independent in-memory sql.js database wrapped with the
 * async expo-sqlite method surface `database.ts` relies on. Call once per
 * test (see header comment above) — every call is a brand-new DB, never
 * shared state between tests.
 */
export async function createSqljsDb(): Promise<SqljsExpoDb> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();

  return {
    async execAsync(sql: string): Promise<void> {
      // No params — safe to run a multi-statement string in one call, same
      // as migrations.integration.test.ts does for full migration SQL blocks.
      db.run(sql);
    },

    async runAsync(sql: string, params?: BindParams): Promise<SqljsRunResult> {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params ?? []);
        stmt.step();
      } finally {
        stmt.free();
      }
      return { changes: db.getRowsModified(), lastInsertRowId: readLastInsertRowId(db) };
    },

    async getFirstAsync<T>(sql: string, params?: BindParams): Promise<T | null> {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params ?? []);
        const hasRow = stmt.step();
        if (!hasRow) return null;
        return stmt.getAsObject() as unknown as T;
      } finally {
        stmt.free();
      }
    },

    async getAllAsync<T>(sql: string, params?: BindParams): Promise<T[]> {
      const stmt = db.prepare(sql);
      const rows: T[] = [];
      try {
        stmt.bind(params ?? []);
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as unknown as T);
        }
      } finally {
        stmt.free();
      }
      return rows;
    },

    async prepareAsync(sql: string): Promise<SqljsPreparedStatement> {
      const stmt = db.prepare(sql);
      return {
        async executeAsync(params?: BindParams): Promise<SqljsRunResult> {
          // Reset between executes (per-call bind), matching expo-sqlite's
          // reusable prepared-statement semantics (seedBioForceLibrary /
          // seedRecipeLibrary loop-executeAsync-per-row on one statement).
          stmt.bind(params ?? []);
          stmt.step();
          const result: SqljsRunResult = {
            changes: db.getRowsModified(),
            lastInsertRowId: readLastInsertRowId(db),
          };
          stmt.reset();
          return result;
        },
        async finalizeAsync(): Promise<void> {
          stmt.free();
        },
      };
    },

    // Mirrors expo-sqlite's withTransactionAsync statement for statement
    // (#369), pinned by expoSqliteTransactionCanary.test.ts. BEGIN sits
    // INSIDE the try on purpose: when a second transaction's BEGIN fails
    // because one is already open, its catch runs ROLLBACK — which rolls
    // back the OTHER, still-running transaction. That is the real #369
    // mechanism. An earlier version had BEGIN outside the try, so a failed
    // BEGIN never rolled anything back and the harness could not reproduce
    // the bug at all. Don't "fix" this with a mutex: the adapter must not
    // queue, because production doesn't.
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      try {
        db.run('BEGIN');
        await fn();
        db.run('COMMIT');
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    },

    async closeAsync(): Promise<void> {
      db.close();
    },
  };
}
