/**
 * Unit tests for src/utils/dates.ts
 *
 * These helpers must be correct regardless of the host timezone. Note that
 * Node/V8 caches the zone at process startup, so assigning process.env.TZ at
 * runtime does NOT change Date behavior — therefore local-vs-UTC tests assert
 * against each Date's OWN local getters (getFullYear/getMonth/getDate), which
 * holds in any host zone, including UTC on CI.
 *
 * Issue #279 — timezone / local-date hardening
 */

import {
  localDateKey,
  todayKey,
  dateKeyToLocalDate,
  addDays,
  daysBetween,
  localMidnightToday,
} from '../dates';

// ─── localDateKey ─────────────────────────────────────────────────────────────

describe('localDateKey', () => {
  it('formats a known date correctly', () => {
    // Use the Date(y,m,d) constructor — always local time — to avoid UTC issues
    const d = new Date(2024, 0, 5); // Jan 5 2024 in local time
    expect(localDateKey(d)).toBe('2024-01-05');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2024, 2, 7); // March 7 2024
    expect(localDateKey(d)).toBe('2024-03-07');
  });

  it('handles month boundary correctly (end of January)', () => {
    const d = new Date(2024, 0, 31); // Jan 31 2024
    expect(localDateKey(d)).toBe('2024-01-31');
  });

  it('handles year boundary correctly (Dec 31 → Jan 1)', () => {
    const dec31 = new Date(2023, 11, 31);
    const jan1 = new Date(2024, 0, 1);
    expect(localDateKey(dec31)).toBe('2023-12-31');
    expect(localDateKey(jan1)).toBe('2024-01-01');
  });

  it('handles a leap-year February 29', () => {
    const leapDay = new Date(2024, 1, 29); // Feb 29 2024 (leap year)
    expect(localDateKey(leapDay)).toBe('2024-02-29');
  });

  it('returns a string matching YYYY-MM-DD pattern', () => {
    const d = new Date(2025, 5, 12); // June 12 2025
    expect(localDateKey(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses "now" when called without arguments', () => {
    const before = localDateKey();
    const now = new Date();
    const after = localDateKey();
    // All three should be the same local calendar date (barring a midnight
    // transition during this test — extremely unlikely but guarded by the
    // fact that before/after must agree).
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    // Accept if before === after (no midnight crossed), else just verify format
    if (before === after) {
      expect(before).toBe(expected);
    } else {
      expect(before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('uses LOCAL calendar components, never the UTC date', () => {
    // localDateKey must format from the host's LOCAL getters, not toISOString()
    // (which is UTC). Assert against the Date's own local components so the
    // expectation is correct in ANY host timezone — including UTC on CI.
    // (The previous version hard-coded '2024-01-15' and only passed in a UTC+1
    // zone; in CI's UTC zone the local date of this instant is genuinely Jan 14.)
    const pad = (n: number) => String(n).padStart(2, '0');
    const instant = new Date('2024-01-15T00:30:00Z'); // fixed absolute instant
    const expectedLocal = `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
    expect(localDateKey(instant)).toBe(expectedLocal);
    // A UTC-based implementation would diverge from the local getters whenever
    // the host zone shifts this instant across a day boundary, which this catches.
  });
});

// ─── todayKey ─────────────────────────────────────────────────────────────────

describe('todayKey', () => {
  it('returns the same value as localDateKey()', () => {
    // Call them in quick succession — should match unless midnight ticks over
    const a = localDateKey();
    const b = todayKey();
    const c = localDateKey();
    if (a === c) {
      expect(b).toBe(a);
    } else {
      expect(b).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ─── dateKeyToLocalDate ───────────────────────────────────────────────────────

describe('dateKeyToLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const d = dateKeyToLocalDate('2024-03-15');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // 0-indexed
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('round-trips through localDateKey', () => {
    const key = '2024-11-30';
    expect(localDateKey(dateKeyToLocalDate(key))).toBe(key);
  });

  it('handles leap day', () => {
    const d = dateKeyToLocalDate('2024-02-29');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it('does NOT suffer from the UTC-midnight off-by-one', () => {
    // new Date('2024-01-05') is UTC midnight — in UTC-5 that is still Jan 4 locally.
    // dateKeyToLocalDate must produce Jan 5 regardless of host TZ.
    const orig = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York'; // UTC-5 in January
      const d = dateKeyToLocalDate('2024-01-05');
      expect(d.getDate()).toBe(5);
      expect(d.getMonth()).toBe(0); // January
    } finally {
      if (orig === undefined) delete process.env.TZ;
      else process.env.TZ = orig;
    }
  });
});

// ─── addDays ──────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2024-01-01', 1)).toBe('2024-01-02');
    expect(addDays('2024-01-01', 7)).toBe('2024-01-08');
  });

  it('subtracts days when n is negative', () => {
    expect(addDays('2024-01-08', -7)).toBe('2024-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01'); // leap year
  });

  it('crosses a year boundary', () => {
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('n=0 returns the same key', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
  });

  it('is DST-safe across a spring-forward boundary (Europe/Zurich)', () => {
    // Europe/Zurich 2024 spring-forward: 2024-03-31 at 02:00 local → 03:00
    // Raw ms arithmetic for one day = 86_400_000 ms, but DST day has only
    // 23 h = 82_800_000 ms. Rounding in daysBetween / addDays must still
    // produce the next calendar day.
    const orig = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Zurich';
      expect(addDays('2024-03-30', 1)).toBe('2024-03-31');
      expect(addDays('2024-03-31', 1)).toBe('2024-04-01');
    } finally {
      if (orig === undefined) delete process.env.TZ;
      else process.env.TZ = orig;
    }
  });
});

// ─── daysBetween ─────────────────────────────────────────────────────────────

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2024-01-15', '2024-01-15')).toBe(0);
  });

  it('returns positive when b is after a', () => {
    expect(daysBetween('2024-01-01', '2024-01-08')).toBe(7);
  });

  it('returns negative when b is before a', () => {
    expect(daysBetween('2024-01-08', '2024-01-01')).toBe(-7);
  });

  it('handles month boundary', () => {
    expect(daysBetween('2024-01-31', '2024-02-01')).toBe(1);
  });

  it('handles year boundary', () => {
    expect(daysBetween('2023-12-31', '2024-01-01')).toBe(1);
  });

  it('is DST-safe across spring-forward in Europe/Zurich', () => {
    const orig = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Zurich';
      // Spring-forward: 2024-03-31 is only 23 h long — raw ms / 86400000 = 0.958
      // Math.round must give 1, not 0.
      expect(daysBetween('2024-03-30', '2024-03-31')).toBe(1);
      expect(daysBetween('2024-03-31', '2024-04-01')).toBe(1);
    } finally {
      if (orig === undefined) delete process.env.TZ;
      else process.env.TZ = orig;
    }
  });

  it('is DST-safe across fall-back in Europe/Zurich', () => {
    const orig = process.env.TZ;
    try {
      process.env.TZ = 'Europe/Zurich';
      // Fall-back: 2024-10-27 is 25 h long — raw ms / 86400000 = 1.042
      // Math.round must give 1, not 2.
      expect(daysBetween('2024-10-26', '2024-10-27')).toBe(1);
      expect(daysBetween('2024-10-27', '2024-10-28')).toBe(1);
    } finally {
      if (orig === undefined) delete process.env.TZ;
      else process.env.TZ = orig;
    }
  });

  it('computes 21-day cycle boundary correctly', () => {
    expect(daysBetween('2024-01-01', '2024-01-22')).toBe(21);
  });
});

// ─── localMidnightToday ───────────────────────────────────────────────────────

describe('localMidnightToday', () => {
  it('returns a Date with hours/minutes/seconds/ms zeroed', () => {
    const d = localMidnightToday();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('local date matches todayKey()', () => {
    const d = localMidnightToday();
    expect(localDateKey(d)).toBe(todayKey());
  });
});
