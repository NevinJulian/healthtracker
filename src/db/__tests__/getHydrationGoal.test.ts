/**
 * Regression test for #326: getHydrationGoal() did
 *   `if (raw !== null && !isNaN(Number(raw))) return Number(raw);`
 * `Number('')` and `Number('  ')` are `0`, which passes `!isNaN`, so an
 * empty or whitespace-only stored value silently returned 0 instead of the
 * 2000 ml default — and the Dashboard showed "goal met" at 0 ml logged.
 * The same guard also let through any numeric string at all: negative,
 * zero, or absurdly large goals (e.g. '999999').
 *
 * Fix: getHydrationGoal() now returns the stored value only when
 * Number(raw) is finite AND within the Settings hydration stepper's own
 * bounds (HYDRATION_MIN=250 / HYDRATION_MAX=6000 in SettingsScreen.tsx,
 * clamped by #313). Anything else — including empty/whitespace strings,
 * which are rejected explicitly rather than via Number() — falls back to
 * DEFAULT_HYDRATION_GOAL_ML (2000).
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * dailyLogUpserts.test.ts. The raw setting is written via the exported
 * setSetting() (not the numeric setHydrationGoal()) so we can exercise
 * invalid stored strings ('', '  ', 'abc') that the real setter could never
 * produce. The literal key 'hydrationGoalMl' mirrors database.ts's
 * (unexported) SETTING_HYDRATION_GOAL_ML constant — keep this in sync if
 * that key ever changes.
 *
 * Issue #326
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

const HYDRATION_GOAL_KEY = 'hydrationGoalMl';
const DEFAULT_HYDRATION_GOAL_ML = 2000;

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

describe('getHydrationGoal falls back to the default for invalid/out-of-range stored values (#326)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it.each(['', '  ', 'abc', '0', '-5', '999999'])(
    'returns the 2000 ml default for stored %j',
    async (stored) => {
      const db = loadFreshDatabaseModule();
      await db.initDatabase();

      await db.setSetting(HYDRATION_GOAL_KEY, stored);

      expect(await db.getHydrationGoal()).toBe(DEFAULT_HYDRATION_GOAL_ML);
    }
  );

  it('returns the stored value when it is a valid number within bounds (2500)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(HYDRATION_GOAL_KEY, '2500');

    expect(await db.getHydrationGoal()).toBe(2500);
  });

  it('accepts the lower boundary (250)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(HYDRATION_GOAL_KEY, '250');

    expect(await db.getHydrationGoal()).toBe(250);
  });

  it('accepts the upper boundary (6000)', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(HYDRATION_GOAL_KEY, '6000');

    expect(await db.getHydrationGoal()).toBe(6000);
  });

  it('rejects one below the lower boundary (249) and falls back to the default', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(HYDRATION_GOAL_KEY, '249');

    expect(await db.getHydrationGoal()).toBe(DEFAULT_HYDRATION_GOAL_ML);
  });

  it('rejects one above the upper boundary (6001) and falls back to the default', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(HYDRATION_GOAL_KEY, '6001');

    expect(await db.getHydrationGoal()).toBe(DEFAULT_HYDRATION_GOAL_ML);
  });

  it('returns the default when no setting row exists at all', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.getHydrationGoal()).toBe(DEFAULT_HYDRATION_GOAL_ML);
  });
});
