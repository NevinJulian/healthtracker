/**
 * Regression test for #336 (gap 3/3): backup export/restore round-trip.
 *
 * Seeds real data across 5+ tables through the actual writers (not raw
 * INSERTs — a raw INSERT can't prove the writer paths that produce real
 * backups are themselves round-trippable), builds a snapshot exactly the
 * way the real export does (buildBackupPayload() in src/services/backup.ts,
 * which is buildBackupPayload's whole reason to exist — both exportBackup()
 * and the pre-restore safety snapshot call it, so this test calls the same
 * single source of truth rather than reimplementing the dump), restores
 * that snapshot back into the same live DB via restoreFromPayload(), and
 * asserts a fresh dump is identical table-by-table.
 *
 * dumpTable() (database.ts) has no ORDER BY, so rows are sorted by each
 * table's real primary key (read via PRAGMA table_info) before comparing —
 * per the work order, since restoreFromPayload() always does
 * DELETE-then-reinsert per table, row order is not guaranteed to survive
 * a round trip even when content does.
 *
 * expo-file-system/legacy, expo-sharing, expo-document-picker, and
 * expo-notifications (all imported at the top of backup.ts) are already
 * stubbed via jest.config.js's moduleNameMapper (__mocks__/), same as every
 * other test that touches backup.ts — not modified here.
 *
 * Issue #336
 */

import { addDays, todayKey } from '../../utils/dates';
import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type BackupModule = typeof import('../../services/backup');

function loadFreshModules(): { db: DatabaseModule; backup: BackupModule } {
  jest.resetModules();
  jest.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async () => createSqljsDb(),
    deleteDatabaseAsync: async () => {},
    SQLiteDatabase: class {},
  }));
  const db = require('../database') as DatabaseModule;
  const backup = require('../../services/backup') as BackupModule;
  return { db, backup };
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

async function getPkColumns(
  rawDb: ReturnType<DatabaseModule['getDatabase']>,
  table: string
): Promise<string[]> {
  const cols = await rawDb.getAllAsync<{ name: string; pk: number }>(
    `PRAGMA table_info(${table})`
  );
  return cols
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function sortRowsByPk(
  rows: Record<string, unknown>[],
  pkCols: string[]
): Record<string, unknown>[] {
  if (pkCols.length === 0) {
    // No declared PK (shouldn't happen for any table in this schema) —
    // fall back to a stable, content-based sort so comparison is still
    // order-independent rather than silently order-dependent.
    return [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return [...rows].sort((a, b) => {
    for (const col of pkCols) {
      const av = String(a[col]);
      const bv = String(b[col]);
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });
}

describe('backup export → restore round trip reproduces the DB exactly (#336)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
    jest.useRealTimers();
  });

  it('restores every table to byte-identical content, sorted by primary key, after a round trip', async () => {
    const { db, backup } = loadFreshModules();
    await db.initDatabase(); // real time

    const pinnedDate = addDays(todayKey(), 5);
    travelTo(pinnedDate);

    const rawDb = db.getDatabase();

    // ── Seed real data across 5+ tables via the real writers ────────────

    // 1. daily_log: upsertBodyWeight + a completion.
    await db.upsertBodyWeight(pinnedDate, 73.6);
    await db.upsertLogField(pinnedDate, 'walk_completed', true);

    // 2. weekly_meal_plan + meal_inventory: cook via finishCooking, assign,
    //    then toggle consumed.
    const recipeRow = await rawDb.getFirstAsync<{ id: string }>(
      'SELECT id FROM recipe_library ORDER BY id ASC LIMIT 1'
    );
    expect(recipeRow).not.toBeNull();
    const recipeId = recipeRow!.id;

    const taskInsert = await rawDb.runAsync(
      'INSERT INTO cooking_tasks (recipe_id, servings_to_cook) VALUES (?, ?)',
      [recipeId, 3]
    );
    await db.finishCooking(taskInsert.lastInsertRowId, recipeId, 3);

    await db.assignMealToPlan(pinnedDate, 'dinner', recipeId);
    const planRow = await rawDb.getFirstAsync<{ id: number }>(
      'SELECT id FROM weekly_meal_plan WHERE date = ? AND meal_type = ?',
      [pinnedDate, 'dinner']
    );
    expect(planRow).not.toBeNull();
    await db.toggleMealConsumed(planRow!.id, true);

    // 3. workout_set_log: a clean, densely-numbered set_index must survive
    //    restore unchanged.
    await db.logWorkoutSet(pinnedDate, 'Bench Press', { reps: 8, weightKg: 60 });
    await db.logWorkoutSet(pinnedDate, 'Bench Press', { reps: 7, weightKg: 62.5 });

    // 4. app_state: setSetting.
    await db.setSetting('backupRoundTripTestKey', 'backupRoundTripTestValue');

    // 5. weekly_template: an edit.
    await db.updateTemplateDay(1, 'Custom Walk Task', 'Custom Hammer Task');

    // ── Snapshot exactly the way the real export does ────────────────────
    const before = await backup.buildBackupPayload();
    const schemaVersionBefore = await db.getCurrentSchemaVersion();
    const tableNames = Object.keys(before.tables).sort();
    // Sanity: at least the 5 tables above, really seeded (non-empty).
    for (const t of ['daily_log', 'weekly_meal_plan', 'meal_inventory', 'workout_set_log', 'app_state', 'weekly_template']) {
      expect(tableNames).toContain(t);
    }

    // ── Restore the snapshot back into the same live DB ──────────────────
    await db.restoreFromPayload(before.tables, 38);

    // ── Re-dump and compare table by table ────────────────────────────────
    const after = await backup.buildBackupPayload();
    const schemaVersionAfter = await db.getCurrentSchemaVersion();

    expect(Object.keys(after.tables).sort()).toEqual(tableNames);
    expect(schemaVersionAfter).toBe(schemaVersionBefore);

    for (const table of tableNames) {
      const pkCols = await getPkColumns(rawDb, table);
      const beforeRows = sortRowsByPk(before.tables[table], pkCols);
      const afterRows = sortRowsByPk(after.tables[table], pkCols);
      expect({ table, rows: afterRows }).toEqual({ table, rows: beforeRows });
    }
  });

  it('keeps set_type through a round trip', async () => {
    const { db, backup } = loadFreshModules();
    await db.initDatabase();

    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 10, weightKg: 40, setType: 'warmup' });
    await db.logWorkoutSet('2024-03-01', 'Bench Press', { reps: 5, weightKg: 80 });

    const before = await backup.buildBackupPayload();
    expect(before.tables.workout_set_log.map((r) => r.set_type)).toEqual(['warmup', null]);

    await db.restoreFromPayload(before.tables, 39);

    const sets = await db.getWorkoutSetsForDay('2024-03-01');
    expect(sets.map((s) => s.set_type)).toEqual(['warmup', null]);
  });

  it('restores a backup without set_type as NULL (guard)', async () => {
    const { db } = loadFreshModules();
    await db.initDatabase();

    await db.restoreFromPayload(
      {
        workout_set_log: [
          {
            id: 1,
            date: '2024-03-01',
            exercise: 'Bench Press',
            set_index: 0,
            reps: 5,
            weight_kg: 80,
            created_at: '2024-03-01T10:00:00.000Z',
          },
        ],
      },
      38
    );

    const sets = await db.getWorkoutSetsForDay('2024-03-01');
    expect(sets).toHaveLength(1);
    expect(sets[0].set_type).toBeNull();
  });
});
