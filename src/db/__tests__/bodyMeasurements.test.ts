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
    expect(latest?.waist_cm?.value).toBe(80);
    expect(latest?.chest_cm?.value).toBe(90);

    const history = await db.getBodyMeasurements();
    const day2 = history.find((r) => r.date === '2026-01-02');
    expect(day2?.waist_cm).toBeNull();
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
    expect(latest).toEqual({
      waist_cm: { value: 80, date: '2026-01-01' },
      chest_cm: { value: 90, date: '2026-01-02' },
      hips_cm: { value: 100, date: '2026-01-03' },
      thigh_cm: null,
      arm_cm: { value: 30, date: '2026-01-01' },
    });
  });

  it('does not return an older waist when a newer row has one', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-02', { waist_cm: 78 });
    await db.logBodyMeasurement('2026-01-03', { chest_cm: 90 });

    expect((await db.getLatestMeasurements())?.waist_cm?.value).toBe(78);
  });
});

describe('getLatestMeasurements reports the date each value was measured', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('gives waist its own day and chest its own day', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-02', { chest_cm: 90 });

    const latest = await db.getLatestMeasurements();
    expect(latest?.waist_cm).toEqual({ value: 80, date: '2026-01-01' });
    expect(latest?.chest_cm).toEqual({ value: 90, date: '2026-01-02' });
    expect(latest?.hips_cm).toBeNull();
    expect(latest?.thigh_cm).toBeNull();
    expect(latest?.arm_cm).toBeNull();
  });

  it('reports the older row date for a field the newest row leaves NULL', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80, arm_cm: 30 });
    await db.logBodyMeasurement('2026-01-05', { waist_cm: 78 });
    await db.logBodyMeasurement('2026-01-09', { chest_cm: 90 });

    const latest = await db.getLatestMeasurements();
    expect(latest?.waist_cm).toEqual({ value: 78, date: '2026-01-05' });
    expect(latest?.arm_cm).toEqual({ value: 30, date: '2026-01-01' });
    expect(latest?.chest_cm).toEqual({ value: 90, date: '2026-01-09' });
  });

  it('returns null when every stored row is a legacy all-NULL row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.getDatabase().runAsync('INSERT INTO body_measurements (date) VALUES (?)', ['2026-01-01']);
    await db.getDatabase().runAsync('INSERT INTO body_measurements (date) VALUES (?)', ['2026-01-02']);

    expect(await db.getLatestMeasurements()).toBeNull();
  });

  it('carries values forward past a newer legacy all-NULL row', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80, arm_cm: 30 });
    await db.getDatabase().runAsync('INSERT INTO body_measurements (date) VALUES (?)', ['2026-01-05']);

    expect(await db.getLatestMeasurements()).toEqual({
      waist_cm: { value: 80, date: '2026-01-01' },
      chest_cm: null,
      hips_cm: null,
      thigh_cm: null,
      arm_cm: { value: 30, date: '2026-01-01' },
    });
  });

  it('still returns a legacy all-NULL row from getBodyMeasurements', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.getDatabase().runAsync('INSERT INTO body_measurements (date) VALUES (?)', ['2026-01-05']);

    const rows = await db.getBodyMeasurements();
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-01-05');
    expect(rows[0].waist_cm).toBeNull();
  });
});

describe('logBodyMeasurement never writes NULL', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  it('inserts no row for an empty or all-null input', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-05', {});
    await db.logBodyMeasurement('2026-01-05', { waist_cm: null });

    expect(await db.getBodyMeasurements()).toHaveLength(1);
    expect((await db.getLatestMeasurements())?.waist_cm).toEqual({ value: 80, date: '2026-01-01' });
  });

  it('leaves a stored value unchanged when null is passed for it on the same date', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: 80, chest_cm: 90 });
    await db.logBodyMeasurement('2026-01-01', { waist_cm: null, chest_cm: 91 });

    const [row] = await db.getBodyMeasurements();
    expect(row.waist_cm).toBe(80);
    expect(row.chest_cm).toBe(91);
  });

  it('treats NaN and Infinity like null', async () => {
    const db = loadFreshDatabaseModule();
    await db.initDatabase();

    await db.logBodyMeasurement('2026-01-01', { waist_cm: NaN });
    await db.logBodyMeasurement('2026-01-02', { chest_cm: Infinity, hips_cm: -Infinity });
    expect(await db.getBodyMeasurements()).toHaveLength(0);

    await db.logBodyMeasurement('2026-01-03', { waist_cm: 80 });
    await db.logBodyMeasurement('2026-01-03', { waist_cm: NaN, chest_cm: 90 });
    const [row] = await db.getBodyMeasurements();
    expect(row.waist_cm).toBe(80);
    expect(row.chest_cm).toBe(90);
  });
});
