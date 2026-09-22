/**
 * Canary for the sql.js adapter's withTransactionAsync (#369).
 *
 * src/db/testHelpers/sqljsExpoAdapter.ts copies expo-sqlite's
 * withTransactionAsync statement for statement, so the sql.js suites
 * reproduce the real overlap behaviour: a second transaction's failed BEGIN
 * runs ROLLBACK, which rolls back the first transaction mid-flight. The
 * database.ts write queue exists because of exactly that behaviour.
 *
 * If an expo-sqlite upgrade changes that method (e.g. starts queueing, or
 * moves BEGIN out of the try), the adapter silently stops being faithful and
 * every #369 regression test stops meaning anything. This test pins the
 * method body in BOTH the build output Metro actually bundles (package.json
 * "main": build/index.js) and the TypeScript source, and fails loudly on any
 * change. If it fails: re-read the new implementation, update the adapter to
 * match it, and only then update the expected body here.
 *
 * Pure file read, no sql.js/WASM, so it adds nothing to #377's worker load.
 */

import fs from 'fs';
import path from 'path';

// Not require.resolve('expo-sqlite/...'): jest.config.js's moduleNameMapper
// sends every 'expo-sqlite(/.*)?' request to __mocks__/expo-sqlite.js.
const EXPO_SQLITE_DIR = path.join(__dirname, '..', '..', '..', 'node_modules', 'expo-sqlite');

/** Extracts `withTransactionAsync(task...) { ... }` and collapses whitespace. */
function extractMethodBody(source: string): string {
  const start = source.search(/async withTransactionAsync\(task[^)]*\)[^{]*\{/);
  if (start < 0) throw new Error('withTransactionAsync not found');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1).replace(/\s+/g, ' ');
    }
  }
  throw new Error('unbalanced braces in withTransactionAsync');
}

const EXPECTED_BODY =
  "{ try { await this.execAsync('BEGIN'); await task(); await this.execAsync('COMMIT'); } " +
  "catch (e) { await this.execAsync('ROLLBACK'); throw e; } }";

describe('expo-sqlite withTransactionAsync canary (#369)', () => {
  it.each([['build/SQLiteDatabase.js'], ['src/SQLiteDatabase.ts']])(
    '%s still has the bare BEGIN-inside-try / ROLLBACK-in-catch body the adapter mirrors',
    (relPath) => {
      const source = fs.readFileSync(path.join(EXPO_SQLITE_DIR, relPath), 'utf8');
      expect(extractMethodBody(source)).toBe(EXPECTED_BODY);
    }
  );
});
