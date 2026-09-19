/**
 * Regression test for #336 (gap 2/3): meal inventory debit/credit
 * invariants under an arbitrary sequence of the real mutating functions.
 *
 * assignMealToPlan / toggleMealConsumed / finishCooking (database.ts) are
 * the only three functions that ever move meal_inventory.portions_available
 * (#302 recorded which batch a tick debited from, via
 * consumed_from_inventory_id, so an untick can credit back the exact batch
 * instead of guessing; #303 made reassigning a consumed slot credit that
 * batch back too). No function in database.ts ever DELETEs a meal_inventory
 * row (grepped — the only DELETE FROM meal_inventory... hit is a comment).
 * That means invariant (d) below — every non-null consumed_from_inventory_id
 * points at a row that still exists — is guaranteed by construction for any
 * sequence of these three functions, not something that could fail; it's
 * asserted anyway as a cheap, direct check of that guarantee.
 *
 * No new dependencies (no fast-check): an inline mulberry32(seed) PRNG at a
 * fixed seed drives a weighted sequence of {tick, untick, assign, reassign,
 * finishCooking}, each op's target chosen from the CURRENT DB state (e.g.
 * tick only ever targets a currently-unconsumed plan row). Ticks and unticks
 * are weighted well above cooking so consumption reliably outpaces
 * production — stock actually runs out (reaching the null-pointer-tick
 * path, i.e. "the code found no stock to debit"), and a recipe reliably
 * accumulates a second meal_inventory batch once its first is drained and
 * cooked again. Both are asserted at the end so a future change can't make
 * either path silently vacuous.
 *
 * Two independent kinds of invariant are checked after EVERY step:
 *
 *   Per-recipe (aggregate, cheap, catches gross violations):
 *     (a) no portions_available is negative
 *     (b) no fabrication: per recipe, portions available never exceed the
 *         total ever cooked (tracked in JS, incremented only by this
 *         test's own finishCooking() calls)
 *     (c) conservation: per recipe, SUM(portions_available) + count of
 *         currently-consumed plan rows whose consumed_from_inventory_id
 *         points at a batch of that recipe == total cooked
 *     (d) every non-null consumed_from_inventory_id resolves to an
 *         existing meal_inventory row (see guarantee note above)
 *
 *   Per-batch (exact, catches #336's literal target — "the credit returns
 *   to the debited batch", not just to *some* batch of the right recipe):
 *   before and after every mutating call, every meal_inventory row's
 *   portions_available is snapshotted. The op's ground truth is read
 *   directly from the DB around the call (e.g. a tick's actual
 *   consumed_from_inventory_id, read back immediately after
 *   toggleMealConsumed — not guessed), producing an *expected* per-batch
 *   delta map. That is compared, batch id by batch id, against the
 *   *actual* delta map. A bug that credits the wrong batch of the same
 *   recipe (main's pre-#302 "ORDER BY date_cooked DESC LIMIT 1" behaviour)
 *   leaves every per-recipe SUM invariant above untouched — the recipe
 *   total is identical either way — which is exactly why this second,
 *   per-batch layer exists.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * syncRollingSchedule.test.ts. Recipes are the real, seeded recipe_library
 * rows (initDatabase() → seedRecipeLibrary()), not fabricated ones.
 *
 * Issue #336
 */

import { addDays, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type RawDb = ReturnType<DatabaseModule['getDatabase']>;

function loadFreshDatabaseModule(): DatabaseModule {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../database') as DatabaseModule;
}

function travelTo(dateKey: string): void {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'queueMicrotask',
      'nextTick', 'hrtime', 'performance',
    ],
  });
  const [y, m, d] = dateKey.split('-').map(Number);
  jest.setSystemTime(new Date(y, m - 1, d));
}

/** Deterministic PRNG — no new dependency (no fast-check). */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function random(): number {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const N_STEPS = 200;

const OPS = ['tick', 'untick', 'assign', 'reassign', 'finishCooking'] as const;
type Op = (typeof OPS)[number];

// Ticks/unticks weighted well above cooking so consumption reliably
// outpaces production — see file header. finishCooking's servings are also
// deliberately small (1-2, not 1-3) for the same reason: smaller batches
// drain faster.
const OP_WEIGHTS: { op: Op; weight: number }[] = [
  { op: 'tick', weight: 6 },
  { op: 'untick', weight: 3 },
  { op: 'assign', weight: 1 },
  { op: 'reassign', weight: 1 },
  { op: 'finishCooking', weight: 1 },
];

function weightedPick(rand: () => number): Op {
  const total = OP_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = rand() * total;
  for (const { op, weight } of OP_WEIGHTS) {
    if (r < weight) return op;
    r -= weight;
  }
  return OP_WEIGHTS[OP_WEIGHTS.length - 1].op;
}

interface StepLogEntry {
  step: number;
  op: Op | `${Op}(skipped: no target)`;
  args: Record<string, unknown>;
  expectedDeltas: Record<string, number>;
  actualDeltas: Record<string, number>;
  totals: Record<string, { available: number; totalCooked: number }>;
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)];
}

function failWithLog(log: StepLogEntry[], message: string): never {
  throw new Error(
    `mealInventoryInvariants (#336) failed — seed=0x${SEED.toString(16)}: ${message}\n` +
      `step log (${log.length} entries):\n${JSON.stringify(log, null, 2)}`
  );
}

type BatchSnapshot = Map<number, { recipe_id: string; portions_available: number }>;

async function snapshotBatches(rawDb: RawDb): Promise<BatchSnapshot> {
  const rows = await rawDb.getAllAsync<{ id: number; recipe_id: string; portions_available: number }>(
    'SELECT id, recipe_id, portions_available FROM meal_inventory'
  );
  return new Map(rows.map((r) => [r.id, { recipe_id: r.recipe_id, portions_available: r.portions_available }]));
}

function computeActualDeltas(before: BatchSnapshot, after: BatchSnapshot): Record<string, number> {
  const ids = new Set<number>([...before.keys(), ...after.keys()]);
  const deltas: Record<string, number> = {};
  for (const id of ids) {
    const b = before.get(id)?.portions_available ?? 0;
    const a = after.get(id)?.portions_available ?? 0;
    if (a !== b) deltas[String(id)] = a - b;
  }
  return deltas;
}

function deltasEqual(expected: Record<string, number>, actual: Record<string, number>): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.length !== actualKeys.length) return false;
  return expectedKeys.every((k, i) => k === actualKeys[i] && expected[k] === actual[k]);
}

describe('meal inventory debit/credit invariants under a weighted random tick/untick/assign/reassign/finishCooking sequence (#336)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it(`holds per-recipe conservation AND per-batch credit-goes-to-the-debited-batch for ${N_STEPS} steps (seed=0xC0FFEE)`, async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase(); // real time

    const anchor = addDays(todayKey(), 10);
    travelTo(anchor);

    const rawDb = db.getDatabase();

    // Real, seeded recipes (seedRecipeLibrary ran inside initDatabase()) —
    // not fabricated data.
    const recipeRows = await rawDb.getAllAsync<{ id: string }>(
      'SELECT id FROM recipe_library ORDER BY id ASC LIMIT 2'
    );
    expect(recipeRows.length).toBe(2);
    const recipeIds = recipeRows.map((r) => r.id);

    // A small slot grid: 5 dates x 3 meal types.
    const dates = [0, 1, 2, 3, 4].map((i) => addDays(anchor, i));
    const mealTypes = ['breakfast', 'lunch', 'dinner'];

    const totalCooked: Record<string, number> = {};
    const batchesEverSeenByRecipe: Record<string, Set<number>> = {};
    for (const r of recipeIds) {
      totalCooked[r] = 0;
      batchesEverSeenByRecipe[r] = new Set();
    }
    let nullPointerTickCount = 0;

    const rand = mulberry32(SEED);
    const log: StepLogEntry[] = [];

    async function currentTotals(): Promise<Record<string, { available: number; totalCooked: number }>> {
      const out: Record<string, { available: number; totalCooked: number }> = {};
      for (const r of recipeIds) {
        const row = await rawDb.getFirstAsync<{ total: number | null }>(
          'SELECT COALESCE(SUM(portions_available), 0) as total FROM meal_inventory WHERE recipe_id = ?',
          [r]
        );
        out[r] = { available: row?.total ?? 0, totalCooked: totalCooked[r] };
      }
      return out;
    }

    async function assertPerRecipeInvariants(step: number): Promise<void> {
      for (const r of recipeIds) {
        const availRow = await rawDb.getFirstAsync<{ total: number | null }>(
          'SELECT COALESCE(SUM(portions_available), 0) as total FROM meal_inventory WHERE recipe_id = ?',
          [r]
        );
        const available = availRow?.total ?? 0;

        // (a) never negative
        if (available < 0) {
          failWithLog(log, `step ${step}: recipe ${r} has negative portions_available=${available}`);
        }

        // (b) no fabrication
        if (available > totalCooked[r]) {
          failWithLog(
            log,
            `step ${step}: recipe ${r} has portions_available=${available} > totalCooked=${totalCooked[r]} (fabricated stock)`
          );
        }

        // (c) conservation: available + currently-consumed-and-debited == totalCooked
        const debitedRow = await rawDb.getFirstAsync<{ cnt: number | null }>(
          `SELECT COUNT(*) as cnt FROM weekly_meal_plan wmp
           JOIN meal_inventory mi ON wmp.consumed_from_inventory_id = mi.id
           WHERE wmp.is_consumed = 1 AND mi.recipe_id = ?`,
          [r]
        );
        const debited = debitedRow?.cnt ?? 0;
        if (available + debited !== totalCooked[r]) {
          failWithLog(
            log,
            `step ${step}: recipe ${r} conservation broken — available(${available}) + debited(${debited}) ` +
              `= ${available + debited} != totalCooked(${totalCooked[r]})`
          );
        }
      }

      // (d) every non-null consumed_from_inventory_id resolves to a real row
      const orphanRow = await rawDb.getFirstAsync<{ cnt: number | null }>(
        `SELECT COUNT(*) as cnt FROM weekly_meal_plan wmp
         WHERE wmp.consumed_from_inventory_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM meal_inventory mi WHERE mi.id = wmp.consumed_from_inventory_id)`
      );
      if ((orphanRow?.cnt ?? 0) !== 0) {
        failWithLog(log, `step ${step}: ${orphanRow?.cnt} weekly_meal_plan row(s) point at a deleted meal_inventory batch`);
      }
    }

    function assertPerBatchDeltas(
      step: number,
      op: string,
      expectedDeltas: Record<string, number>,
      actualDeltas: Record<string, number>
    ): void {
      if (!deltasEqual(expectedDeltas, actualDeltas)) {
        failWithLog(
          log,
          `step ${step} (${op}): per-batch delta mismatch — expected ${JSON.stringify(expectedDeltas)}, ` +
            `got ${JSON.stringify(actualDeltas)} (credit/debit landed on the wrong batch, or the wrong amount)`
        );
      }
    }

    function recordBatchSightings(snapshot: BatchSnapshot): void {
      for (const [id, { recipe_id }] of snapshot) {
        if (batchesEverSeenByRecipe[recipe_id]) batchesEverSeenByRecipe[recipe_id].add(id);
      }
    }

    for (let step = 0; step < N_STEPS; step++) {
      const op = weightedPick(rand);
      let args: Record<string, unknown> = {};
      let performed: Op | `${Op}(skipped: no target)` = op;
      let expectedDeltas: Record<string, number> = {};
      let actualDeltas: Record<string, number> = {};

      if (op === 'tick') {
        const candidates = await rawDb.getAllAsync<{ id: number }>(
          'SELECT id FROM weekly_meal_plan WHERE is_consumed = 0'
        );
        if (candidates.length === 0) {
          performed = 'tick(skipped: no target)';
        } else {
          const target = pick(candidates, rand);
          const before = await snapshotBatches(rawDb);
          await db.toggleMealConsumed(target.id, true);
          const after = await snapshotBatches(rawDb);

          // Ground truth: what the code actually recorded it debited from —
          // read back, never guessed.
          const planAfter = await rawDb.getFirstAsync<{ consumed_from_inventory_id: number | null }>(
            'SELECT consumed_from_inventory_id FROM weekly_meal_plan WHERE id = ?',
            [target.id]
          );
          const debitedBatchId = planAfter?.consumed_from_inventory_id ?? null;
          if (debitedBatchId == null) nullPointerTickCount += 1;

          expectedDeltas = debitedBatchId != null ? { [String(debitedBatchId)]: -1 } : {};
          actualDeltas = computeActualDeltas(before, after);
          args = { id: target.id, debitedBatchId };
          recordBatchSightings(after);
        }
      } else if (op === 'untick') {
        const candidates = await rawDb.getAllAsync<{ id: number }>(
          'SELECT id FROM weekly_meal_plan WHERE is_consumed = 1'
        );
        if (candidates.length === 0) {
          performed = 'untick(skipped: no target)';
        } else {
          const target = pick(candidates, rand);
          // Ground truth: the batch this row's OWN prior tick actually
          // debited from, read straight from its stored pointer before the
          // untick runs — this is exactly what a correct credit must return
          // to, and exactly what "ORDER BY date_cooked DESC LIMIT 1"-style
          // guessing (main's pre-#302 shape) would get wrong whenever it
          // isn't the same as the most-recently-cooked batch.
          const priorRow = await rawDb.getFirstAsync<{ consumed_from_inventory_id: number | null }>(
            'SELECT consumed_from_inventory_id FROM weekly_meal_plan WHERE id = ?',
            [target.id]
          );
          const expectedCreditBatchId = priorRow?.consumed_from_inventory_id ?? null;

          const before = await snapshotBatches(rawDb);
          await db.toggleMealConsumed(target.id, false);
          const after = await snapshotBatches(rawDb);

          expectedDeltas = expectedCreditBatchId != null ? { [String(expectedCreditBatchId)]: 1 } : {};
          actualDeltas = computeActualDeltas(before, after);
          args = { id: target.id, expectedCreditBatchId };
          recordBatchSightings(after);
        }
      } else if (op === 'assign' || op === 'reassign') {
        let date: string;
        let mealType: string;

        if (op === 'reassign') {
          const candidates = await rawDb.getAllAsync<{ date: string; meal_type: string }>(
            'SELECT date, meal_type FROM weekly_meal_plan'
          );
          if (candidates.length === 0) {
            performed = 'reassign(skipped: no target)';
            log.push({ step, op: performed, args, expectedDeltas, actualDeltas, totals: await currentTotals() });
            await assertPerRecipeInvariants(step);
            continue;
          }
          const target = pick(candidates, rand);
          date = target.date;
          mealType = target.meal_type;
        } else {
          date = pick(dates, rand);
          mealType = pick(mealTypes, rand);
        }

        const recipeId = pick(recipeIds, rand);

        // Ground truth: read the slot's CURRENT state before assigning —
        // assignMealToPlan credits back the batch a currently-consumed
        // slot was debited from (#302/#303), regardless of whether we
        // found this slot via the 'assign' or 'reassign' branch above.
        const existing = await rawDb.getFirstAsync<{
          is_consumed: number;
          consumed_from_inventory_id: number | null;
        }>('SELECT is_consumed, consumed_from_inventory_id FROM weekly_meal_plan WHERE date = ? AND meal_type = ?', [
          date,
          mealType,
        ]);
        const expectedCreditBatchId =
          existing && existing.is_consumed === 1 ? existing.consumed_from_inventory_id : null;

        const before = await snapshotBatches(rawDb);
        await db.assignMealToPlan(date, mealType, recipeId);
        const after = await snapshotBatches(rawDb);

        expectedDeltas = expectedCreditBatchId != null ? { [String(expectedCreditBatchId)]: 1 } : {};
        actualDeltas = computeActualDeltas(before, after);
        args = { date, mealType, recipeId, expectedCreditBatchId };
        recordBatchSightings(after);
      } else {
        // finishCooking — always valid: a fresh cooking_tasks row every
        // time. Servings kept small (1-2) so stock drains faster — see
        // file header.
        const recipeId = pick(recipeIds, rand);
        const servings = 1 + Math.floor(rand() * 2); // 1-2

        // Ground truth prediction using the SAME query finishCooking()
        // itself runs (database.ts) — mirrored, not reimplemented logic:
        // whichever batch is currently "active" (portions_available > 0)
        // for this recipe gets the increment; otherwise a fresh row.
        const activeBatch = await rawDb.getFirstAsync<{ id: number }>(
          'SELECT id FROM meal_inventory WHERE recipe_id = ? AND portions_available > 0',
          [recipeId]
        );
        const maxIdRow = await rawDb.getFirstAsync<{ maxId: number | null }>(
          'SELECT MAX(id) as maxId FROM meal_inventory'
        );
        const predictedNewId = (maxIdRow?.maxId ?? 0) + 1;

        const before = await snapshotBatches(rawDb);
        const insertResult = await rawDb.runAsync(
          'INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)',
          [recipeId, servings]
        );
        const taskId = insertResult.lastInsertRowId;
        await db.finishCooking(taskId, recipeId, servings);
        const after = await snapshotBatches(rawDb);

        const targetBatchId = activeBatch ? activeBatch.id : predictedNewId;
        expectedDeltas = { [String(targetBatchId)]: servings };
        actualDeltas = computeActualDeltas(before, after);
        args = { taskId, recipeId, servings, targetBatchId };
        totalCooked[recipeId] += servings;
        recordBatchSightings(after);
      }

      log.push({ step, op: performed, args, expectedDeltas, actualDeltas, totals: await currentTotals() });
      if (!performed.toString().includes('skipped')) {
        assertPerBatchDeltas(step, performed, expectedDeltas, actualDeltas);
      }
      await assertPerRecipeInvariants(step);
    }

    // Sanity: the run actually exercised state, not (mostly) no-ops.
    const performedSteps = log.filter((e) => !e.op.toString().includes('skipped'));
    expect(performedSteps.length).toBeGreaterThan(0);
    const totalEverCooked = Object.values(totalCooked).reduce((a, b) => a + b, 0);
    expect(totalEverCooked).toBeGreaterThan(0);

    // The two preconditions the strengthened invariants above depend on to
    // be meaningful, not vacuous — asserted explicitly so a future change
    // to the op mix or weights can't silently stop exercising either path.
    expect(nullPointerTickCount).toBeGreaterThanOrEqual(1);
    for (const r of recipeIds) {
      expect(batchesEverSeenByRecipe[r].size).toBeGreaterThanOrEqual(2);
    }
  });
});
