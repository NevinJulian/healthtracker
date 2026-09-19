/**
 * Regression tests for #323 part 2: clearing a profile height/age field.
 *
 * Part 1 (#323, landed on this branch already) added inline validation to
 * the Settings height/age blur handlers but deliberately left "blank + blur"
 * a no-op: there was no db function that could clear a saved app_state
 * value. `setSetting(key, '')` was ruled out as the workaround because
 * `getUserProfile()` reads it back with `!isNaN(Number(hRaw))`, and
 * `Number('')` is `0`, not `NaN` — so a "cleared" height would read back as
 * a height of 0 cm, not as "unset". See the documentation test at the
 * bottom of this file for a live demonstration of that quirk.
 *
 * This file exercises the fix: a real `deleteSetting()` (DELETE FROM
 * app_state WHERE key = ?) plus `clearProfileHeightCm()` /
 * `clearProfileAge()` wrappers around it, so a cleared field reads back as
 * `null` via the existing, unmodified `getUserProfile()`.
 *
 * `deleteSetting`/`clearProfileHeightCm`/`clearProfileAge` do not exist yet
 * at the pre-fix commit (01e21c2). Calling them directly there would throw
 * a TypeError ("... is not a function"), which is not a meaningful
 * regression proof — it would fail identically for any typo or unrelated
 * mistake. Every test below instead opens with an explicit
 * `expect(typeof db.<fn>).toBe('function')` assertion, so the pre-fix
 * failure is a real, informative assertion failure ("expected 'function',
 * received 'undefined'") rather than an uncaught exception.
 *
 * Uses the same sql.js-backed adapter and fresh-module-per-test pattern as
 * getHydrationGoal.test.ts / dailyLogUpserts.test.ts.
 *
 * Issue #323
 */

import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');

// Mirrors database.ts's unexported SETTING_PROFILE_HEIGHT_CM /
// SETTING_PROFILE_AGE keys — keep in sync if they ever change.
const PROFILE_HEIGHT_KEY = 'profileHeightCm';
const PROFILE_AGE_KEY = 'profileAge';

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

describe('clearProfileHeightCm / clearProfileAge (#323 part 2)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('clears a saved height and age so getUserProfile() returns null, not 0', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setProfileHeightCm(180);
    await db.setProfileAge(30);
    expect(await db.getUserProfile()).toMatchObject({ heightCm: 180, age: 30 });

    expect(typeof db.clearProfileHeightCm).toBe('function');
    expect(typeof db.clearProfileAge).toBe('function');

    await db.clearProfileHeightCm();
    await db.clearProfileAge();

    const profile = await db.getUserProfile();
    expect(profile.heightCm).toBeNull();
    expect(profile.age).toBeNull();
  });

  it('clearing a field that was never saved does not throw', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(typeof db.clearProfileHeightCm).toBe('function');
    expect(typeof db.clearProfileAge).toBe('function');

    await expect(db.clearProfileHeightCm()).resolves.toBeUndefined();
    await expect(db.clearProfileAge()).resolves.toBeUndefined();

    const profile = await db.getUserProfile();
    expect(profile.heightCm).toBeNull();
    expect(profile.age).toBeNull();
  });

  it('clearing height/age leaves the other profile fields untouched', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setProfileHeightCm(165);
    await db.setProfileAge(45);
    await db.setProfileSex('female');
    await db.setProfileActivityLevel('active');
    await db.setProfileGoalType('cut');

    expect(typeof db.clearProfileHeightCm).toBe('function');
    expect(typeof db.clearProfileAge).toBe('function');

    await db.clearProfileHeightCm();
    await db.clearProfileAge();

    const profile = await db.getUserProfile();
    expect(profile.heightCm).toBeNull();
    expect(profile.age).toBeNull();
    expect(profile.sex).toBe('female');
    expect(profile.activityLevel).toBe('active');
    expect(profile.goalType).toBe('cut');
  });
});

describe('deleteSetting (#323 part 2)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('removes a previously-set key so getSetting() returns null', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(PROFILE_HEIGHT_KEY, '180');
    expect(await db.getSetting(PROFILE_HEIGHT_KEY)).toBe('180');

    expect(typeof db.deleteSetting).toBe('function');
    await db.deleteSetting(PROFILE_HEIGHT_KEY);

    expect(await db.getSetting(PROFILE_HEIGHT_KEY)).toBeNull();
  });

  it('deleting a key that was never set is a harmless no-op', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(typeof db.deleteSetting).toBe('function');
    await expect(db.deleteSetting(PROFILE_AGE_KEY)).resolves.toBeUndefined();
    expect(await db.getSetting(PROFILE_AGE_KEY)).toBeNull();
  });

  it('deleting one key leaves other keys in app_state untouched', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setSetting(PROFILE_HEIGHT_KEY, '180');
    await db.setSetting(PROFILE_AGE_KEY, '30');

    expect(typeof db.deleteSetting).toBe('function');
    await db.deleteSetting(PROFILE_HEIGHT_KEY);

    expect(await db.getSetting(PROFILE_HEIGHT_KEY)).toBeNull();
    expect(await db.getSetting(PROFILE_AGE_KEY)).toBe('30');
  });
});

describe('documentation: why setSetting(key, "") could not be the fix (#323)', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('setSetting(key, "") makes getUserProfile() read height/age as 0, not null', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.setProfileHeightCm(180);
    await db.setProfileAge(30);

    // The workaround part 1 explicitly avoided: writing an empty string
    // instead of deleting the row.
    await db.setSetting(PROFILE_HEIGHT_KEY, '');
    await db.setSetting(PROFILE_AGE_KEY, '');

    const profile = await db.getUserProfile();
    // Number('') === 0 and !isNaN(0) === true, so this is 0 — not the null
    // a "cleared" field should read back as. This is the bug that makes a
    // real DELETE (deleteSetting) necessary instead.
    expect(profile.heightCm).toBe(0);
    expect(profile.age).toBe(0);
  });
});
