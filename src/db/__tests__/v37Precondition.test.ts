/**
 * Regression tests for v37's load-bearing ordering invariant (#317, raised
 * by a cold review of PR #376).
 *
 * v37 renumbers every workout_set_log row and then creates
 * idx_workout_set_log_date_exercise_set_index. Its renumber UPDATE must
 * only ever run while that unique index does NOT exist: applied row by row
 * over gapped data, an intermediate row can transiently collide with a
 * row that has not been updated yet, even though the finished result is
 * unique. Both callers uphold that structurally (the migration creates the
 * index itself, afterwards; restoreFromPayload DROPs it first), but until
 * now the invariant was defended only by a prose comment. A future caller
 * getting it wrong would surface as a bare UNIQUE constraint error from
 * inside a migration transaction — on a device, App.tsx's dead-end screen
 * with no explanation.
 *
 * It is now a `precondition` on the migration itself, run by every caller
 * that executes migration SQL, failing with a message that names the
 * invariant.
 *
 * Issue #317
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';
import { MIGRATIONS } from '../schema';

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

const V37_INDEX = 'idx_workout_set_log_date_exercise_set_index';

describe("v37's renumber-before-index invariant (#317)", () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('is declared as a precondition on the migration, so every caller checks it', () => {
    const v37 = MIGRATIONS.find((m) => m.version === 37);
    expect(v37).toBeDefined();
    expect(typeof v37!.precondition).toBe('function');
  });

  it('fails with a message naming the invariant when the index already exists', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase(); // applies v37, so the index exists now
    const raw = db.getDatabase();

    const index = await raw.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${V37_INDEX}'`
    );
    expect(index).not.toBeNull();

    const v37 = MIGRATIONS.find((m) => m.version === 37)!;
    await expect(v37.precondition!(raw)).rejects.toThrow(/Migration v37 precondition failed/);
    await expect(v37.precondition!(raw)).rejects.toThrow(new RegExp(V37_INDEX));
  });

  it('passes once the index has been dropped, which is what restore does', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();
    const raw = db.getDatabase();

    await raw.execAsync(`DROP INDEX IF EXISTS ${V37_INDEX}`);

    const v37 = MIGRATIONS.find((m) => m.version === 37)!;
    await expect(v37.precondition!(raw)).resolves.toBeUndefined();
  });

  it('does not break the restore path, which drops the index before replaying v37', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    // Two sets for the same (date, exercise) with colliding set_index, the
    // shape a pre-v37 backup can legitimately contain.
    const result = await db.restoreFromPayload({
      workout_set_log: [
        { id: 1, date: '2024-06-01', exercise: 'Squat', set_index: 0, reps: 5, weight_kg: 100, created_at: '2024-06-01T10:00:00.000Z' },
        { id: 2, date: '2024-06-01', exercise: 'Squat', set_index: 0, reps: 5, weight_kg: 102.5, created_at: '2024-06-01T10:05:00.000Z' },
      ],
    });

    expect(result.rowsRestored).toBe(2);

    const raw = db.getDatabase();
    const rows = await raw.getAllAsync<{ id: number; set_index: number }>(
      'SELECT id, set_index FROM workout_set_log ORDER BY created_at ASC, id ASC'
    );
    expect(rows.map((r) => r.set_index)).toEqual([0, 1]);

    const index = await raw.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${V37_INDEX}'`
    );
    expect(index).not.toBeNull();
  });
});
