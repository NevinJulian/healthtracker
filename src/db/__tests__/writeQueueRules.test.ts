/**
 * Static rules for the database.ts write queue (#369).
 *
 * The queue (_enqueueWrite) serialises every unit of work that writes, so
 * no two ever overlap on expo-sqlite's one shared connection. Its failure
 * mode is reentrancy: a queued unit that calls another queued function
 * waits for itself forever and wedges every write in the app. That is worse
 * than the bug the queue fixes.
 *
 * This is the exact, CI-time guard against it (the __DEV__ stall detector
 * in database.ts is the runtime backstop). It parses database.ts with the
 * TypeScript compiler and enforces:
 *
 *   R1  _enqueueWrite is called only directly inside an exported function
 *       (a public entry point) or initDatabase.
 *   R2  Nothing in database.ts calls a function that contains an
 *       _enqueueWrite call. Queued entry points are only ever entered from
 *       outside the module, so no unit can re-enter the queue.
 *
 * database.ts imports nothing that calls back into it (only schema, seed
 * data, and nutrition helpers), so a nested call can't sneak in through
 * another module either.
 *
 * Pure AST analysis: no sql.js, no load for #377.
 */

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const DATABASE_TS = path.join(__dirname, '..', 'database.ts');

interface FunctionInfo {
  name: string;
  exported: boolean;
  node: ts.FunctionDeclaration;
}

function loadSource(): ts.SourceFile {
  return ts.createSourceFile(
    DATABASE_TS,
    fs.readFileSync(DATABASE_TS, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}

function topLevelFunctions(sf: ts.SourceFile): FunctionInfo[] {
  return sf.statements
    .filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.name)
    .map((node) => ({
      name: node.name!.text,
      exported: !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      node,
    }));
}

/** Every call expression inside `node` whose callee is a bare identifier. */
function calledIdentifiers(node: ts.Node): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const sf = node.getSourceFile();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      out.push({
        name: n.expression.text,
        line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
      });
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

describe('database.ts write-queue rules (#369)', () => {
  const sf = loadSource();
  const functions = topLevelFunctions(sf);
  const queuing = functions.filter((f) =>
    calledIdentifiers(f.node).some((c) => c.name === '_enqueueWrite')
  );

  it('finds the queue and its entry points (sanity check for the rules below)', () => {
    expect(functions.some((f) => f.name === '_enqueueWrite')).toBe(true);
    expect(queuing.map((f) => f.name)).toEqual(
      expect.arrayContaining(['initDatabase', 'syncRollingSchedule', 'toggleMealConsumed', 'restoreFromPayload'])
    );
  });

  it('R1: _enqueueWrite is only called from exported entry points or initDatabase', () => {
    const offenders = queuing
      .filter((f) => !f.exported && f.name !== 'initDatabase')
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('R2: nothing in database.ts calls a queued function (a queued unit must never re-enter the queue)', () => {
    const queuedNames = new Set(queuing.map((f) => f.name));
    const offenders: string[] = [];
    for (const f of functions) {
      for (const call of calledIdentifiers(f.node)) {
        if (queuedNames.has(call.name)) {
          offenders.push(`${f.name}() calls queued ${call.name}() at database.ts:${call.line}`);
        }
      }
    }
    // Also top-level statements outside any function (e.g. a const
    // initialiser) must not call into the queue.
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s)) continue;
      for (const call of calledIdentifiers(s)) {
        if (queuedNames.has(call.name)) {
          offenders.push(`top-level code calls queued ${call.name}() at database.ts:${call.line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
