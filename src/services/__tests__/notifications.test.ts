/**
 * Unit tests for pure helper functions in the notification service.
 *
 * parseTimeString and formatTimeString are stateless and have no native
 * dependencies, so they can be tested directly in Jest's node environment.
 */

import { parseTimeString, formatTimeString } from '../notifications';

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
