import { createSqljsDb } from '../testHelpers/sqljsExpoAdapter';

type DatabaseModule = typeof import('../database');
type Meal = 'breakfast' | 'lunch' | 'dinner';

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

async function freshDb(): Promise<DatabaseModule> {
  const db = loadFreshDatabaseModule();
  await db.initDatabase();
  return db;
}

interface TimeCase {
  name: string;
  key: string;
  fallback: string;
  get: (db: DatabaseModule) => Promise<string>;
  set: (db: DatabaseModule, value: string) => Promise<void>;
}

const meal = (m: Meal, key: string, fallback: string): TimeCase => ({
  name: `meal ${m}`,
  key,
  fallback,
  get: (db) => db.getMealReminderTime(m),
  set: (db, v) => db.setMealReminderTime(m, v),
});

const TIME_CASES: TimeCase[] = [
  {
    name: 'workout',
    key: 'workoutReminderTime',
    fallback: '08:00',
    get: (db) => db.getWorkoutReminderTime(),
    set: (db, v) => db.setWorkoutReminderTime(v),
  },
  {
    name: 'cook',
    key: 'weeklyCookDayTime',
    fallback: '10:00',
    get: (db) => db.getWeeklyCookDayTime(),
    set: (db, v) => db.setWeeklyCookDayTime(v),
  },
  {
    name: 'backup',
    key: 'backupReminderTime',
    fallback: '18:00',
    get: (db) => db.getBackupReminderTime(),
    set: (db, v) => db.setBackupReminderTime(v),
  },
  meal('breakfast', 'mealReminderBreakfastTime', '08:00'),
  meal('lunch', 'mealReminderLunchTime', '12:30'),
  meal('dinner', 'mealReminderDinnerTime', '18:30'),
];

interface DayCase {
  name: string;
  key: string;
  get: (db: DatabaseModule) => Promise<number>;
  set: (db: DatabaseModule, value: number) => Promise<void>;
}

const DAY_CASES: DayCase[] = [
  {
    name: 'cook day',
    key: 'weeklyCookDay',
    get: (db) => db.getWeeklyCookDay(),
    set: (db, v) => db.setWeeklyCookDay(v),
  },
  {
    name: 'backup day',
    key: 'backupReminderDay',
    get: (db) => db.getBackupReminderDay(),
    set: (db, v) => db.setBackupReminderDay(v),
  },
];

describe('reminder settings validation', () => {
  afterEach(() => {
    jest.dontMock('expo-sqlite');
  });

  describe.each(DAY_CASES)('$name', (c) => {
    it.each(['3abc', '1.5', '7', '-1', '', 'abc'])(
      'getter returns 0 for stored %j',
      async (stored) => {
        const db = await freshDb();
        await db.setSetting(c.key, stored);
        expect(await c.get(db)).toBe(0);
      }
    );

    it('getter trims a valid stored value', async () => {
      const db = await freshDb();
      await db.setSetting(c.key, ' 3 ');
      expect(await c.get(db)).toBe(3);
    });

    it.each([-1, 7, 1.5, NaN])('setter rejects %p and writes nothing', async (value) => {
      const db = await freshDb();
      await db.setSetting(c.key, '2');
      await expect(c.set(db, value)).rejects.toThrow(RangeError);
      expect(await db.getSetting(c.key)).toBe('2');
    });

    it.each([0, 6])('setter accepts %p', async (value) => {
      const db = await freshDb();
      await c.set(db, value);
      expect(await c.get(db)).toBe(value);
    });
  });

  describe.each(TIME_CASES)('$name time', (c) => {
    it.each(['8:00', '25:00', '12:99', 'abc', '08:00:00', '08:00abc', ''])(
      'getter returns the default for stored %j',
      async (stored) => {
        const db = await freshDb();
        await db.setSetting(c.key, stored);
        expect(await c.get(db)).toBe(c.fallback);
      }
    );

    it('getter trims a valid stored value', async () => {
      const db = await freshDb();
      await db.setSetting(c.key, ' 14:30 ');
      expect(await c.get(db)).toBe('14:30');
    });

    it.each(['24:00', '8:00', 'abc', ' 08:00'])(
      'setter rejects %j and writes nothing',
      async (value) => {
        const db = await freshDb();
        await db.setSetting(c.key, '09:15');
        await expect(c.set(db, value)).rejects.toThrow(RangeError);
        expect(await db.getSetting(c.key)).toBe('09:15');
      }
    );

    it.each(['00:00', '23:59'])('setter accepts %j', async (value) => {
      const db = await freshDb();
      await c.set(db, value);
      expect(await c.get(db)).toBe(value);
    });
  });
});
