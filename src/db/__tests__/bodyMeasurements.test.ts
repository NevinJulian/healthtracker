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

describe('getLatestMeasurements carries each field forward from its newest non-null value', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('returns an earlier waist when the newest row only has chest, and preserves the history gap', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-02', { chest_cm: 90 });

    const latest = await db.getLatestMeasurements();
    expect(latest).not.toBeNull();
    expect(latest?.date).toBe('2026-01-02');
    expect(latest?.waist_cm).toBe(80);
    expect(latest?.chest_cm).toBe(90);

    const history = await db.getBodyMeasurements();
    const day2 = history.find((r) => r.date === '2026-01-02');
    expect(day2?.waist_cm).toBeNull();
    expect(latest?.id).toBe(day2?.id);
  });

  it('returns null when no rows exist', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    expect(await db.getLatestMeasurements()).toBeNull();
  });

  it('takes each field from its own newest non-null row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80, arm_cm: 30 });
    await db.logBodyMeasurement('2026-01-02', { chest_cm: 90 });
    await db.logBodyMeasurement('2026-01-03', { hips_cm: 100 });

    const latest = await db.getLatestMeasurements();
    expect(latest).toMatchObject({
      date: '2026-01-03',
      waist_cm: 80,
      chest_cm: 90,
      hips_cm: 100,
      thigh_cm: null,
      arm_cm: 30,
    });
  });

  it('does not return an older waist when a newer row has one', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-02', { waist_cm: 78 });
    await db.logBodyMeasurement('2026-01-03', { chest_cm: 90 });

    expect((await db.getLatestMeasurements())?.waist_cm).toBe(78);
  });
});
