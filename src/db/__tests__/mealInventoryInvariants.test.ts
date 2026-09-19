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
 * fixed seed drives 200 steps drawn from {tick, untick, assign, reassign,
 * finishCooking}, each op's target chosen from the CURRENT DB state (e.g.
 * tick only ever targets a currently-unconsumed plan row). After every step,
 * four invariants are checked against the real DB:
 *   (a) no portions_available is negative
 *   (b) no fabrication: per recipe, portions available never exceed the
 *       total ever cooked (tracked in JS, incremented only by this test's
 *       own finishCooking() calls)
 *   (c) conservation: per recipe, SUM(portions_available) + count of
 *       currently-consumed plan rows whose consumed_from_inventory_id
 *       points at a batch of that recipe == total cooked. (A ticked row
 *       with a NULL pointer — toggleMealConsumed found no stock to debit —
 *       is deliberately excluded from the "debited" count, matching the
 *       documented "never pretend a portion was consumed from inventory
 *       that doesn't exist" behaviour; see toggleMealConsumed's comment.)
 *   (d) every non-null consumed_from_inventory_id resolves to an existing
 *       meal_inventory row (see guarantee note above)
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

interface StepLogEntry {
  step: number;
  op: Op | `${Op}(skipped: no target)`;
  args: Record<string, unknown>;
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

describe('meal inventory debit/credit invariants under a random tick/untick/assign/reassign/finishCooking sequence (#336)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it(`holds portions_available >= 0, no fabrication, and conservation for every recipe after each of ${N_STEPS} steps (seed=0xC0FFEE)`, async () => {
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
    for (const r of recipeIds) totalCooked[r] = 0;

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

    async function assertInvariants(step: number): Promise<void> {
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

    for (let step = 0; step < N_STEPS; step++) {
      const op = pick([...OPS], rand);
      let args: Record<string, unknown> = {};
      let performed: Op | `${Op}(skipped: no target)` = op;

      if (op === 'tick') {
        const candidates = await rawDb.getAllAsync<{ id: number }>(
          'SELECT id FROM weekly_meal_plan WHERE is_consumed = 0'
        );
        if (candidates.length === 0) {
          performed = 'tick(skipped: no target)';
        } else {
          const target = pick(candidates, rand);
          args = { id: target.id };
          await db.toggleMealConsumed(target.id, true);
        }
      } else if (op === 'untick') {
        const candidates = await rawDb.getAllAsync<{ id: number }>(
          'SELECT id FROM weekly_meal_plan WHERE is_consumed = 1'
        );
        if (candidates.length === 0) {
          performed = 'untick(skipped: no target)';
        } else {
          const target = pick(candidates, rand);
          args = { id: target.id };
          await db.toggleMealConsumed(target.id, false);
        }
      } else if (op === 'assign') {
        const date = pick(dates, rand);
        const mealType = pick(mealTypes, rand);
        const recipeId = pick(recipeIds, rand);
        args = { date, mealType, recipeId };
        await db.assignMealToPlan(date, mealType, recipeId);
      } else if (op === 'reassign') {
        const candidates = await rawDb.getAllAsync<{ id: number; date: string; meal_type: string }>(
          'SELECT id, date, meal_type FROM weekly_meal_plan'
        );
        if (candidates.length === 0) {
          performed = 'reassign(skipped: no target)';
        } else {
          const target = pick(candidates, rand);
          const recipeId = pick(recipeIds, rand);
          args = { id: target.id, date: target.date, mealType: target.meal_type, recipeId };
          await db.assignMealToPlan(target.date, target.meal_type, recipeId);
        }
      } else {
        // finishCooking — always valid: a fresh cooking_tasks row every time.
        const recipeId = pick(recipeIds, rand);
        const servings = 1 + Math.floor(rand() * 3); // 1-3
        const insertResult = await rawDb.runAsync(
          'INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)',
          [recipeId, servings]
        );
        const taskId = insertResult.lastInsertRowId;
        args = { taskId, recipeId, servings };
        await db.finishCooking(taskId, recipeId, servings);
        totalCooked[recipeId] += servings;
      }

      log.push({ step, op: performed, args, totals: await currentTotals() });
      await assertInvariants(step);
    }

    // Sanity: the run actually exercised state, not 200 no-ops.
    const performedSteps = log.filter((e) => !e.op.toString().includes('skipped'));
    expect(performedSteps.length).toBeGreaterThan(0);
    const totalEverCooked = Object.values(totalCooked).reduce((a, b) => a + b, 0);
    expect(totalEverCooked).toBeGreaterThan(0);
  });
});
