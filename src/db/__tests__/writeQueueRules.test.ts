/**
 * Static rules for the database.ts write queue (#369).
 *
 * The queue (_enqueueWrite) serialises every unit of work that writes, so
 * no two ever overlap on expo-sqlite's one shared connection. It has two
 * ways to fail:
 *
 *   - Reentrancy: a queued unit that calls another queued function waits
 *     for itself forever and wedges every write in the app. That is worse
 *     than the bug the queue fixes.
 *   - Bypass: an exported writer that isn't queued can land a statement
 *     inside another unit's open transaction and share its fate.
 *
 * This is the exact, CI-time guard against both (the __DEV__ stall detector
 * in database.ts is the runtime backstop for reentrancy). It parses
 * database.ts with the TypeScript compiler and enforces:
 *
 *   R1  _enqueueWrite is called only directly inside an exported function
 *       (a public entry point) or initDatabase.
 *   R2  Nothing reachable from inside a queued unit calls a queued function.
 *       Each unit's call graph is followed through every module function.
 *       A delegating export such as setWorkoutReminderEnabled -> setSetting
 *       is fine: it runs outside any unit.
 *   R3  Every exported function that writes (runAsync / execAsync /
 *       withTransactionAsync / prepareAsync, directly or through
 *       non-exported helpers) does so inside the queue: it is queued itself,
 *       or it only writes by calling queued functions.
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
const WRITE_METHODS = new Set(['runAsync', 'execAsync', 'withTransactionAsync', 'prepareAsync']);

// Exported writers still serialised by something other than the write queue.
// Must shrink to empty; each entry needs a reason.
const R3_EXCEPTIONS: Record<string, string> = {
  upsertExerciseCompleted: "still on #319's own queue; folded into the write queue next",
};

interface FunctionInfo {
  name: string;
  exported: boolean;
  node: ts.FunctionDeclaration;
  /** Bare-identifier calls anywhere inside the function (incl. nested lambdas). */
  calls: { name: string; line: number }[];
  /** Whether the body calls db.<write method>(…) directly. */
  writesDirectly: boolean;
}

const sf = ts.createSourceFile(
  DATABASE_TS,
  fs.readFileSync(DATABASE_TS, 'utf8'),
  ts.ScriptTarget.Latest,
  true
);

function lineOf(n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
}

function calledIdentifiers(node: ts.Node): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      out.push({ name: n.expression.text, line: lineOf(n) });
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

function writesDirectly(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      WRITE_METHODS.has(n.expression.name.text)
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

const functions = new Map<string, FunctionInfo>();
for (const s of sf.statements) {
  if (!ts.isFunctionDeclaration(s) || !s.name) continue;
  functions.set(s.name.text, {
    name: s.name.text,
    exported: !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    node: s,
    calls: calledIdentifiers(s),
    writesDirectly: writesDirectly(s),
  });
}

const queued = new Set(
  [...functions.values()].filter((f) => f.calls.some((c) => c.name === '_enqueueWrite')).map((f) => f.name)
);

/** The unit (2nd argument) of every _enqueueWrite(name, unit) call. */
function enqueuedUnits(): { owner: string; label: string; unit: ts.Node }[] {
  const out: { owner: string; label: string; unit: ts.Node }[] = [];
  for (const f of functions.values()) {
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === '_enqueueWrite'
      ) {
        const [label, unit] = n.arguments;
        out.push({
          owner: f.name,
          label: label && ts.isStringLiteral(label) ? label.text : '?',
          unit,
        });
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(f.node, visit);
  }
  return out;
}

describe('database.ts write-queue rules (#369)', () => {
  it('finds the queue and its entry points (sanity check for the rules below)', () => {
    expect(functions.has('_enqueueWrite')).toBe(true);
    expect([...queued]).toEqual(
      expect.arrayContaining([
        'initDatabase',
        'syncRollingSchedule',
        'toggleMealConsumed',
        'restoreFromPayload',
        'setSetting',
        'upsertLogField',
      ])
    );
    expect(enqueuedUnits().length).toBeGreaterThanOrEqual(queued.size);
  });

  it('R1: _enqueueWrite is only called from exported entry points or initDatabase', () => {
    const offenders = [...queued].filter(
      (name) => !functions.get(name)!.exported && name !== 'initDatabase'
    );
    expect(offenders).toEqual([]);
  });

  it('R2: nothing reachable from inside a queued unit calls a queued function', () => {
    const offenders: string[] = [];
    for (const { owner, label, unit } of enqueuedUnits()) {
      // Breadth-first over the module call graph, starting from the unit.
      const seen = new Set<string>();
      const frontier = calledIdentifiers(unit).map((c) => ({ ...c, via: `${label} unit` }));
      while (frontier.length > 0) {
        const call = frontier.shift()!;
        if (queued.has(call.name)) {
          offenders.push(
            `${owner}(): the '${label}' unit reaches queued ${call.name}() (via ${call.via}, database.ts:${call.line})`
          );
          continue;
        }
        if (seen.has(call.name) || !functions.has(call.name)) continue;
        seen.add(call.name);
        for (const next of functions.get(call.name)!.calls) {
          frontier.push({ ...next, via: `${call.name}()` });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('R3: every exported function that writes does so inside the queue', () => {
    // reach(f): f can write to the DB outside the queue, via its own
    // statements or any non-queued function it calls.
    const memo = new Map<string, boolean>();
    const reach = (name: string, stack: Set<string>): boolean => {
      if (queued.has(name)) return false;
      if (memo.has(name)) return memo.get(name)!;
      if (stack.has(name)) return false;
      stack.add(name);
      const f = functions.get(name);
      const result =
        !!f &&
        (f.writesDirectly || f.calls.some((c) => functions.has(c.name) && reach(c.name, stack)));
      stack.delete(name);
      memo.set(name, result);
      return result;
    };

    const offenders = [...functions.values()]
      .filter((f) => f.exported && !(f.name in R3_EXCEPTIONS) && reach(f.name, new Set()))
      .map((f) => `${f.name}() writes outside the write queue`);
    expect(offenders).toEqual([]);

    // Exceptions must stay real: an entry that no longer needs it is removed.
    const stale = Object.keys(R3_EXCEPTIONS).filter((name) => !reach(name, new Set()));
    expect(stale).toEqual([]);
  });
});
