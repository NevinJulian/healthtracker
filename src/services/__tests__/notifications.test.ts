/**
 * Unit tests for pure helper functions in the notification service.
 *
 * parseTimeString, formatTimeString, mapWeekdayToExpo, shouldNotifyEmpty, and
 * getMealReminderIdentifier are all stateless and have no native dependencies,
 * so they can be tested directly in Jest's node environment.
 */

import { parseTimeString, formatTimeString, mapWeekdayToExpo, shouldNotifyEmpty, getMealReminderIdentifier } from '../notifications';
import type { MealType } from '../../db/database';

describe('parseTimeString', () => {
  it('parses a standard HH:MM string', () => {
    expect(parseTimeString('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(parseTimeString('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('parses zero-padded values', () => {
    expect(parseTimeString('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeString('07:05')).toEqual({ hour: 7, minute: 5 });
  });

  it('returns the safe fallback for malformed input', () => {
    expect(parseTimeString('')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('abc')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('25:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTimeString('12:99')).toEqual({ hour: 8, minute: 0 });
  });
});

describe('formatTimeString', () => {
  it('formats single-digit values with zero-padding', () => {
    expect(formatTimeString(8, 0)).toBe('08:00');
    expect(formatTimeString(7, 5)).toBe('07:05');
  });

  it('formats two-digit values correctly', () => {
    expect(formatTimeString(14, 30)).toBe('14:30');
    expect(formatTimeString(23, 59)).toBe('23:59');
  });

  it('round-trips with parseTimeString', () => {
    const cases = ['00:00', '08:00', '12:15', '18:45', '23:59'];
    for (const t of cases) {
      const { hour, minute } = parseTimeString(t);
      expect(formatTimeString(hour, minute)).toBe(t);
    }
  });
});

describe('mapWeekdayToExpo', () => {
  it('maps Sunday (JS 0) to expo 1', () => {
    expect(mapWeekdayToExpo(0)).toBe(1);
  });

  it('maps Saturday (JS 6) to expo 7', () => {
    expect(mapWeekdayToExpo(6)).toBe(7);
  });

  it('maps all JS weekdays to expo weekdays (offset by 1)', () => {
    for (let day = 0; day <= 6; day++) {
      expect(mapWeekdayToExpo(day)).toBe(day + 1);
    }
  });

  it('produces values in the expo range 1–7', () => {
    for (let day = 0; day <= 6; day++) {
      const expo = mapWeekdayToExpo(day);
      expect(expo).toBeGreaterThanOrEqual(1);
      expect(expo).toBeLessThanOrEqual(7);
    }
  });
});

describe('shouldNotifyEmpty', () => {
  it('returns true when portions are 0 and not yet notified', () => {
    expect(shouldNotifyEmpty(0, false)).toBe(true);
  });

  it('returns false when portions are 0 but already notified (debounce)', () => {
    expect(shouldNotifyEmpty(0, true)).toBe(false);
  });

  it('returns false when portions are positive (inventory not empty)', () => {
    expect(shouldNotifyEmpty(1, false)).toBe(false);
    expect(shouldNotifyEmpty(5, false)).toBe(false);
    expect(shouldNotifyEmpty(100, false)).toBe(false);
  });

  it('returns false when portions are positive even if notified flag is false', () => {
    expect(shouldNotifyEmpty(3, false)).toBe(false);
  });
});

describe('getMealReminderIdentifier', () => {
  const meals: MealType[] = ['breakfast', 'lunch', 'dinner'];

  it('returns a stable string identifier for each meal', () => {
    for (const meal of meals) {
      const id = getMealReminderIdentifier(meal);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('returns distinct identifiers for each meal', () => {
    const ids = meals.map(getMealReminderIdentifier);
    const unique = new Set(ids);
    expect(unique.size).toBe(meals.length);
  });

  it('includes the meal name in the identifier', () => {
    expect(getMealReminderIdentifier('breakfast')).toContain('breakfast');
    expect(getMealReminderIdentifier('lunch')).toContain('lunch');
    expect(getMealReminderIdentifier('dinner')).toContain('dinner');
  });

  it('identifiers are stable across calls (same value each time)', () => {
    for (const meal of meals) {
      expect(getMealReminderIdentifier(meal)).toBe(getMealReminderIdentifier(meal));
    }
  });
});

describe('meal reminder default times (via parseTimeString)', () => {
  it('breakfast default 08:00 parses to hour 8, minute 0', () => {
    expect(parseTimeString('08:00')).toEqual({ hour: 8, minute: 0 });
  });

  it('lunch default 12:30 parses to hour 12, minute 30', () => {
    expect(parseTimeString('12:30')).toEqual({ hour: 12, minute: 30 });
  });

  it('dinner default 18:30 parses to hour 18, minute 30', () => {
    expect(parseTimeString('18:30')).toEqual({ hour: 18, minute: 30 });
  });
});
