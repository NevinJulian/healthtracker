/**
 * __DEV__-only device stress hook for #369. Not used by the app.
 *
 * Measures how often, on a real device with the real expo-sqlite native
 * module, a meal tick that overlaps a rolling-schedule sync leaves the
 * inventory torn. The MECHANISM needs no device to prove: it is read
 * straight from expo-sqlite's withTransactionAsync (a failed BEGIN's catch
 * runs ROLLBACK, which rolls back the OTHER open transaction), and the sql.js
 * regression test in toggleMealConsumedInventory.test.ts forces it
 * deterministically. What this run establishes is the RATE: given two calls
 * started within a few ms of each other, how often the native thread pool's
 * real timing lets the damage happen.
 *
 * That is a conditional rate ("given an overlap within the stagger"), not how
 * often users hit it; real overlaps are rarer than back-to-back calls. If it
 * doesn't reproduce in a few hundred iterations, that is a real result
 * meaning the tearing is rarer than feared. It does NOT mean #369 is
 * unfixed-safe: the mechanism stands either way.
 *
 * It only uses exports that exist both before and after the #369 fix
 * (getDatabase, toggleMealConsumed, syncRollingSchedule). Copy this file
 * onto main unchanged to measure the pre-fix rate, then run it on the fix
 * branch for the post-fix result.
 *
 * It works only on its own synthetic rows: recipe '__stress369__', one
 * inventory batch, and one plan slot on 2099-12-31. They are reset before
 * every iteration and deleted in a finally, so the user's real inventory
 * and plan are never touched. The sync itself only does what it always does
 * on focus: INSERT OR IGNORE window rows and backfill empty exercises.
 *
 * Usage (dev build only): open React Native DevTools (press `j` in the
 * Metro terminal), and in its console run
 *
 *     await globalThis.stress369(300)
 *
 * It logs and returns a summary.
 */

import { getDatabase, syncRollingSchedule, toggleMealConsumed } from './database';

const RECIPE_ID = '__stress369__';
const PLAN_DATE = '2099-12-31';
const PLAN_MEAL_TYPE = 'stress369';
/** Delay in ms between starting the tick and starting the sync, cycled per iteration. */
const STAGGERS_MS = [0, 1, 2, 4, 8];

type Outcome = 'ok' | 'torn' | 'error-only';

interface StaggerStats {
  iterations: number;
  ok: number;
  /** Invariant broken: stock + portions attributed to consumed meals != 1. */
  torn: number;
  /**
   * The overlap happened (the sync's BEGIN failed and its ROLLBACK rolled
   * back the tick's open transaction), but the invariant still held. B's
   * BEGIN landed before the tick's debit, so the rollback only undid reads
   * and the rest autocommitted consistently. Atomicity was still lost; the
   * data just happened to survive. In the sql.js harness every overlap lands
   * here (statements are microtask-fast); only real native timing can land
   * it after the debit, which is what `torn` counts.
   */
  errorOnly: number;
}

export interface Stress369Summary {
  iterations: number;
  torn: number;
  errorOnly: number;
  tornRate: string;
  byStaggerMs: Record<number, StaggerStats>;
  /** Distinct error messages seen, with counts. */
  errors: Record<string, number>;
  elapsedMs: number;
}

async function stress369(iterations = 300): Promise<Stress369Summary> {
  const db = getDatabase();
  const started = Date.now();
  const byStaggerMs: Record<number, StaggerStats> = {};
  for (const s of STAGGERS_MS) byStaggerMs[s] = { iterations: 0, ok: 0, torn: 0, errorOnly: 0 };
  const errors: Record<string, number> = {};
  let torn = 0;
  let errorOnly = 0;

  const note = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    errors[msg] = (errors[msg] ?? 0) + 1;
  };

  await cleanup();
  try {
    await db.runAsync(
      `INSERT INTO recipe_library
         (id, title, category, calories, protein, carbs, fat, prepTimeMinutes, defaultServings, ingredients, instructions, freezerTips)
       VALUES (?, '#369 stress (dev only)', 'dev', 0, 0, 0, 0, 0, 1, '[]', '', '')`,
      [RECIPE_ID]
    );
    const inv = await db.runAsync(
      'INSERT INTO meal_inventory (recipe_id, portions_available, date_cooked) VALUES (?, 1, ?)',
      [RECIPE_ID, PLAN_DATE]
    );
    const plan = await db.runAsync(
      'INSERT INTO weekly_meal_plan (date, meal_type, recipe_id, is_consumed) VALUES (?, ?, ?, 0)',
      [PLAN_DATE, PLAN_MEAL_TYPE, RECIPE_ID]
    );
    const invId = inv.lastInsertRowId;
    const planId = plan.lastInsertRowId;

    for (let i = 0; i < iterations; i++) {
      const stagger = STAGGERS_MS[i % STAGGERS_MS.length];

      // Reset: exactly one portion ever cooked, meal not consumed.
      await db.runAsync('UPDATE meal_inventory SET portions_available = 1 WHERE id = ?', [invId]);
      await db.runAsync(
        'UPDATE weekly_meal_plan SET is_consumed = 0, consumed_from_inventory_id = NULL WHERE id = ?',
        [planId]
      );

      const tick = toggleMealConsumed(planId, true);
      if (stagger > 0) await new Promise((r) => setTimeout(r, stagger));
      const sync = syncRollingSchedule();
      const results = await Promise.allSettled([tick, sync]);
      let sawError = false;
      for (const r of results) {
        if (r.status === 'rejected') {
          sawError = true;
          note(r.reason);
        }
      }

      const stock = await db.getFirstAsync<{ n: number }>(
        'SELECT portions_available AS n FROM meal_inventory WHERE id = ?',
        [invId]
      );
      const attributed = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM weekly_meal_plan
          WHERE id = ? AND is_consumed = 1 AND consumed_from_inventory_id IS NOT NULL`,
        [planId]
      );
      const outcome: Outcome =
        (stock?.n ?? 0) + (attributed?.n ?? 0) !== 1 ? 'torn' : sawError ? 'error-only' : 'ok';

      const bucket = byStaggerMs[stagger];
      bucket.iterations++;
      if (outcome === 'torn') {
        bucket.torn++;
        torn++;
      } else if (outcome === 'error-only') {
        bucket.errorOnly++;
        errorOnly++;
      } else {
        bucket.ok++;
      }
    }
  } finally {
    await cleanup();
  }

  const summary: Stress369Summary = {
    iterations,
    torn,
    errorOnly,
    tornRate: `${((torn / Math.max(iterations, 1)) * 100).toFixed(1)}%`,
    byStaggerMs,
    errors,
    elapsedMs: Date.now() - started,
  };
  console.log('[stress369]', JSON.stringify(summary, null, 2));
  return summary;

  async function cleanup(): Promise<void> {
    await db.runAsync('DELETE FROM weekly_meal_plan WHERE recipe_id = ?', [RECIPE_ID]);
    await db.runAsync('DELETE FROM meal_inventory WHERE recipe_id = ?', [RECIPE_ID]);
    await db.runAsync('DELETE FROM recipe_library WHERE id = ?', [RECIPE_ID]);
  }
}

/** Exposes stress369() on globalThis in dev builds only. A no-op otherwise. */
export function installStress369(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  (globalThis as unknown as { stress369: typeof stress369 }).stress369 = stress369;
}
