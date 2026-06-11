/**
 * Unit tests for analyticsHelpers.ts — pure functions, no DB required.
 * Issue #265 — Analytics · strength progression + longer trends & streaks
 */

import {
  computeStreaks,
  computeStrengthProgression,
  progressionSteps,
  KG_PER_CYCLE,
  CYCLE_DAYS,
} from '../analyticsHelpers';

// ─── computeStreaks ───────────────────────────────────────────────────────────

describe('computeStreaks', () => {
  const TODAY = '2024-03-15';

  it('returns zeros for empty logs', () => {
    const result = computeStreaks([], TODAY);
    expect(result.gym).toEqual({ current: 0, longest: 0 });
    expect(result.walk).toEqual({ current: 0, longest: 0 });
    expect(result.fasting).toEqual({ current: 0, longest: 0 });
  });

  it('counts a current gym streak of 3 consecutive days ending today', () => {
    const logs = [
      { date: '2024-03-13', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-14', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-15', walk_completed: false, hammer_completed: true, fasting_completed: false },
    ];
    const { gym } = computeStreaks(logs, TODAY);
    expect(gym.current).toBe(3);
    expect(gym.longest).toBe(3);
  });

  it('breaks current streak if today is missed', () => {
    const logs = [
      { date: '2024-03-13', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-14', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-15', walk_completed: false, hammer_completed: false, fasting_completed: false },
    ];
    const { gym } = computeStreaks(logs, TODAY);
    expect(gym.current).toBe(0);
    expect(gym.longest).toBe(2);
  });

  it('breaks current streak if yesterday is missing from logs', () => {
    const logs = [
      { date: '2024-03-13', walk_completed: false, hammer_completed: true, fasting_completed: false },
      // 2024-03-14 absent
      { date: '2024-03-15', walk_completed: false, hammer_completed: true, fasting_completed: false },
    ];
    const { gym } = computeStreaks(logs, TODAY);
    // Only today counts because yesterday has no log entry
    expect(gym.current).toBe(1);
  });

  it('computes longest walk streak across a gap', () => {
    const logs = [
      { date: '2024-03-01', walk_completed: true, hammer_completed: false, fasting_completed: false },
      { date: '2024-03-02', walk_completed: true, hammer_completed: false, fasting_completed: false },
      { date: '2024-03-03', walk_completed: true, hammer_completed: false, fasting_completed: false },
      { date: '2024-03-04', walk_completed: false, hammer_completed: false, fasting_completed: false },
      { date: '2024-03-05', walk_completed: true, hammer_completed: false, fasting_completed: false },
      { date: '2024-03-06', walk_completed: true, hammer_completed: false, fasting_completed: false },
    ];
    const { walk } = computeStreaks(logs, TODAY);
    expect(walk.longest).toBe(3);
    expect(walk.current).toBe(0); // streak ended before today
  });

  it('computes fasting longest streak', () => {
    const logs = [
      { date: '2024-03-10', walk_completed: false, hammer_completed: false, fasting_completed: true },
      { date: '2024-03-11', walk_completed: false, hammer_completed: false, fasting_completed: true },
      { date: '2024-03-12', walk_completed: false, hammer_completed: false, fasting_completed: true },
      { date: '2024-03-13', walk_completed: false, hammer_completed: false, fasting_completed: true },
      { date: '2024-03-14', walk_completed: false, hammer_completed: false, fasting_completed: true },
      { date: '2024-03-15', walk_completed: false, hammer_completed: false, fasting_completed: true },
    ];
    const { fasting } = computeStreaks(logs, TODAY);
    expect(fasting.current).toBe(6);
    expect(fasting.longest).toBe(6);
  });

  it('handles longest streak being longer than current', () => {
    const logs = [
      // old 5-day gym streak
      { date: '2024-03-01', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-02', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-03', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-04', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-05', walk_completed: false, hammer_completed: true, fasting_completed: false },
      // gap
      { date: '2024-03-10', walk_completed: false, hammer_completed: false, fasting_completed: false },
      // recent 2-day gym streak
      { date: '2024-03-14', walk_completed: false, hammer_completed: true, fasting_completed: false },
      { date: '2024-03-15', walk_completed: false, hammer_completed: true, fasting_completed: false },
    ];
    const { gym } = computeStreaks(logs, TODAY);
    expect(gym.current).toBe(2);
    expect(gym.longest).toBe(5);
  });
});

// ─── computeStrengthProgression ──────────────────────────────────────────────

describe('computeStrengthProgression', () => {
  it('returns empty array when start > end', () => {
    const result = computeStrengthProgression('2024-03-10', '2024-03-01');
    expect(result).toHaveLength(0);
  });

  it('returns a single point when start === end', () => {
    const result = computeStrengthProgression('2024-03-01', '2024-03-01');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: '2024-03-01', weightKg: 0, cycle: 0 });
  });

  it('stays at cycle 0 for the first 21 days (CYCLE_DAYS)', () => {
    const start = '2024-01-01';
    // Day 0 to day 20 (21 days total) are all cycle 0
    const end = '2024-01-21'; // day 20 (0-indexed)
    const result = computeStrengthProgression(start, end);
    expect(result).toHaveLength(21);
    expect(result[0]).toEqual({ date: '2024-01-01', weightKg: 0, cycle: 0 });
    expect(result[20]).toEqual({ date: '2024-01-21', weightKg: 0, cycle: 0 });
  });

  it('advances to cycle 1 on day 21', () => {
    const start = '2024-01-01';
    const end = '2024-01-22'; // day 21 = cycle 1
    const result = computeStrengthProgression(start, end);
    expect(result[21]).toEqual({
      date: '2024-01-22',
      weightKg: KG_PER_CYCLE,
      cycle: 1,
    });
  });

  it('computes correct weight at cycle 3', () => {
    const start = '2024-01-01';
    // Day 63 = 3 full cycles (63 / 21 = 3)
    const day63 = new Date(2024, 0, 1);
    day63.setDate(day63.getDate() + 63);
    const endISO = formatDate(day63);
    const result = computeStrengthProgression(start, endISO, 0);
    const last = result[result.length - 1];
    expect(last.cycle).toBe(3);
    expect(last.weightKg).toBe(3 * KG_PER_CYCLE);
  });

  it('respects baselineKg offset', () => {
    const result = computeStrengthProgression('2024-01-01', '2024-01-01', 100);
    expect(result[0].weightKg).toBe(100);
  });

  it(`produces ${CYCLE_DAYS} days per cycle as expected`, () => {
    expect(CYCLE_DAYS).toBe(21);
    expect(KG_PER_CYCLE).toBe(5);
  });
});

// ─── progressionSteps ────────────────────────────────────────────────────────

describe('progressionSteps', () => {
  it('returns empty array for empty input', () => {
    expect(progressionSteps([])).toHaveLength(0);
  });

  it('returns just the single point for a single-item input', () => {
    const pts = [{ date: '2024-01-01', weightKg: 0, cycle: 0 }];
    expect(progressionSteps(pts)).toEqual(pts);
  });

  it('deduplicates consecutive same-weight points', () => {
    // 21 days at 0kg, then moves to 5kg
    const start = '2024-01-01';
    const end = '2024-01-23'; // 22 days: days 0-21 at 0kg, day 22 at 5kg
    const full = computeStrengthProgression(start, end);
    const steps = progressionSteps(full);
    // Expect: first point (0kg), step point (5kg on day 21), last point (same 5kg on day 22)
    // Since last point == step point here (day 22), just 2 entries
    expect(steps.length).toBeLessThan(full.length);
    // First step = 0 kg
    expect(steps[0].weightKg).toBe(0);
    // Last step = 5 kg
    expect(steps[steps.length - 1].weightKg).toBe(KG_PER_CYCLE);
  });

  it('always includes first and last points', () => {
    const pts = [
      { date: '2024-01-01', weightKg: 0, cycle: 0 },
      { date: '2024-01-02', weightKg: 0, cycle: 0 },
      { date: '2024-01-03', weightKg: 5, cycle: 1 },
    ];
    const steps = progressionSteps(pts);
    expect(steps[0]).toEqual(pts[0]);
    expect(steps[steps.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
