/**
 * Unit tests for analyticsHelpers.ts — pure functions, no DB required.
 * Issue #265 — Analytics · strength progression + longer trends & streaks
 * Issue #267 — Analytics · nutrition adherence + meal & recipe insights
 */

import {
  computeStreaks,
  computeStrengthProgression,
  progressionSteps,
  KG_PER_CYCLE,
  CYCLE_DAYS,
  computeGoalAdherenceDays,
  normaliseMacroSeries,
  macroChartDateLabel,
  rollingAverage,
  hydrationAverage,
  hydrationGoalAdherence,
  measurementDelta,
  latestMeasurementValue,
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

// ─── computeGoalAdherenceDays ─────────────────────────────────────────────────

describe('computeGoalAdherenceDays', () => {
  it('returns zeros for empty input', () => {
    const result = computeGoalAdherenceDays([], 1800, 150);
    expect(result.calorieAdherence).toBe(0);
    expect(result.proteinAdherence).toBe(0);
  });

  it('returns 1 when all days meet both goals', () => {
    const days = [
      { date: '2024-01-01', calories: 1900, protein: 160 },
      { date: '2024-01-02', calories: 2000, protein: 155 },
    ];
    const result = computeGoalAdherenceDays(days, 1800, 150);
    expect(result.calorieAdherence).toBe(1);
    expect(result.proteinAdherence).toBe(1);
  });

  it('correctly handles partial adherence', () => {
    const days = [
      { date: '2024-01-01', calories: 1900, protein: 160 }, // meets both
      { date: '2024-01-02', calories: 1500, protein: 160 }, // fails calorie
      { date: '2024-01-03', calories: 1900, protein: 100 }, // fails protein
      { date: '2024-01-04', calories: 1500, protein: 100 }, // fails both
    ];
    const result = computeGoalAdherenceDays(days, 1800, 150);
    // 2 out of 4 days meet calorie goal
    expect(result.calorieAdherence).toBeCloseTo(0.5);
    // 2 out of 4 days meet protein goal
    expect(result.proteinAdherence).toBeCloseTo(0.5);
  });

  it('treats exact goal value as meeting the goal', () => {
    const days = [{ date: '2024-01-01', calories: 1800, protein: 150 }];
    const result = computeGoalAdherenceDays(days, 1800, 150);
    expect(result.calorieAdherence).toBe(1);
    expect(result.proteinAdherence).toBe(1);
  });

  it('respects custom goal values (user-configured goals, #274)', () => {
    const days = [
      { date: '2024-01-01', calories: 2200, protein: 180 }, // meets custom 2000/160
      { date: '2024-01-02', calories: 1900, protein: 155 }, // fails calories (< 2000), meets protein
      { date: '2024-01-03', calories: 2100, protein: 140 }, // meets calories, fails protein (< 160)
    ];
    const result = computeGoalAdherenceDays(days, 2000, 160);
    // Days meeting calorie goal 2000: day1 (2200) + day3 (2100) = 2/3
    expect(result.calorieAdherence).toBeCloseTo(2 / 3);
    // Days meeting protein goal 160: day1 (180) + day2 (155 fails, wait: 155 < 160 so fails)
    // day1 (180 >= 160) + day3 (140 < 160) = 1/3
    expect(result.proteinAdherence).toBeCloseTo(1 / 3);
  });

  it('returns 0 adherence when goal is very high and nothing meets it', () => {
    const days = [
      { date: '2024-01-01', calories: 1500, protein: 100 },
      { date: '2024-01-02', calories: 1600, protein: 110 },
    ];
    const result = computeGoalAdherenceDays(days, 5000, 500);
    expect(result.calorieAdherence).toBe(0);
    expect(result.proteinAdherence).toBe(0);
  });
});

// ─── normaliseMacroSeries ─────────────────────────────────────────────────────

describe('normaliseMacroSeries', () => {
  const days = [
    { date: '2024-01-01', calories: 900, protein: 75 },
    { date: '2024-01-02', calories: 1800, protein: 150 },
    { date: '2024-01-03', calories: 2700, protein: 225 }, // exceeds goal
  ];

  it('normalises calories to [0, 1] relative to goal', () => {
    const result = normaliseMacroSeries(days, 'calories', 1800);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(1.0);
    expect(result[2]).toBeCloseTo(1.0); // capped at 1
  });

  it('normalises protein to [0, 1] relative to goal', () => {
    const result = normaliseMacroSeries(days, 'protein', 150);
    expect(result[0]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(1.0);
    expect(result[2]).toBeCloseTo(1.0); // capped at 1
  });

  it('returns all zeros for goalValue = 0', () => {
    const result = normaliseMacroSeries(days, 'calories', 0);
    expect(result).toEqual([0, 0, 0]);
  });

  it('returns empty array for empty input', () => {
    expect(normaliseMacroSeries([], 'calories', 1800)).toEqual([]);
  });
});

// ─── macroChartDateLabel ──────────────────────────────────────────────────────

describe('macroChartDateLabel', () => {
  it('returns label for first item (index 0)', () => {
    expect(macroChartDateLabel(0, 10, '2024-01-15')).toBe('15/01');
  });

  it('returns label for last item', () => {
    expect(macroChartDateLabel(9, 10, '2024-03-31')).toBe('31/03');
  });

  it('returns empty string for middle items', () => {
    expect(macroChartDateLabel(5, 10, '2024-02-14')).toBe('');
  });

  it('returns label for single-item series', () => {
    expect(macroChartDateLabel(0, 1, '2024-06-01')).toBe('01/06');
  });
});

// ─── rollingAverage ───────────────────────────────────────────────────────────

describe('rollingAverage', () => {
  it('returns empty for empty input', () => {
    expect(rollingAverage([], 7)).toEqual([]);
  });

  it('single value is its own average', () => {
    expect(rollingAverage([42], 7)).toEqual([42]);
  });

  it('first window uses shorter window', () => {
    // For a 7-day window, the first value has only 1 element (itself)
    const result = rollingAverage([10, 20, 30], 7);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(15);   // (10+20)/2
    expect(result[2]).toBeCloseTo(20);   // (10+20+30)/3
  });

  it('full window average is computed correctly', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = rollingAverage(values, 7);
    // Index 6: average of values[0..6] = (1+2+3+4+5+6+7)/7 = 4
    expect(result[6]).toBeCloseTo(4);
    // Index 7: average of values[1..7] = (2+3+4+5+6+7+8)/7 ≈ 5
    expect(result[7]).toBeCloseTo(5);
  });
});

// ─── hydrationAverage ────────────────────────────────────────────────────────

describe('hydrationAverage', () => {
  it('returns 0 for empty input', () => {
    expect(hydrationAverage([])).toBe(0);
  });

  it('returns the single value for a one-day series', () => {
    expect(hydrationAverage([{ date: '2024-01-01', water_ml: 1800 }])).toBe(1800);
  });

  it('correctly averages multiple days', () => {
    const days = [
      { date: '2024-01-01', water_ml: 1000 },
      { date: '2024-01-02', water_ml: 2000 },
      { date: '2024-01-03', water_ml: 3000 },
    ];
    expect(hydrationAverage(days)).toBe(2000);
  });

  it('rounds the result to the nearest integer', () => {
    const days = [
      { date: '2024-01-01', water_ml: 1000 },
      { date: '2024-01-02', water_ml: 1001 },
    ];
    // Average = 1000.5, rounds to 1001
    expect(hydrationAverage(days)).toBe(1001);
  });
});

// ─── hydrationGoalAdherence ───────────────────────────────────────────────────

describe('hydrationGoalAdherence', () => {
  it('returns 0 for empty input', () => {
    expect(hydrationGoalAdherence([], 2000)).toBe(0);
  });

  it('returns 0 when goalMl is 0', () => {
    const days = [{ date: '2024-01-01', water_ml: 1500 }];
    expect(hydrationGoalAdherence(days, 0)).toBe(0);
  });

  it('returns 1 when all days meet the goal', () => {
    const days = [
      { date: '2024-01-01', water_ml: 2000 },
      { date: '2024-01-02', water_ml: 2500 },
    ];
    expect(hydrationGoalAdherence(days, 2000)).toBe(1);
  });

  it('treats exact goal value as meeting the goal', () => {
    const days = [{ date: '2024-01-01', water_ml: 2000 }];
    expect(hydrationGoalAdherence(days, 2000)).toBe(1);
  });

  it('returns 0 when no days meet the goal', () => {
    const days = [
      { date: '2024-01-01', water_ml: 500 },
      { date: '2024-01-02', water_ml: 750 },
    ];
    expect(hydrationGoalAdherence(days, 2000)).toBe(0);
  });

  it('returns 0.5 when half the days meet the goal', () => {
    const days = [
      { date: '2024-01-01', water_ml: 2500 }, // meets
      { date: '2024-01-02', water_ml: 1000 }, // misses
    ];
    expect(hydrationGoalAdherence(days, 2000)).toBeCloseTo(0.5);
  });
});

// ─── measurementDelta ────────────────────────────────────────────────────────

describe('measurementDelta', () => {
  it('returns null for empty input', () => {
    expect(measurementDelta([], 'waist_cm')).toBeNull();
  });

  it('returns null when only one non-null value exists', () => {
    const records = [
      { waist_cm: 80, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(measurementDelta(records, 'waist_cm')).toBeNull();
  });

  it('returns null when all values for the field are null', () => {
    const records = [
      { waist_cm: null, chest_cm: 90, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: null, chest_cm: 88, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(measurementDelta(records, 'waist_cm')).toBeNull();
  });

  it('computes a negative delta (measurement decreased)', () => {
    const records = [
      { waist_cm: 90, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: 85, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(measurementDelta(records, 'waist_cm')).toBeCloseTo(-5);
  });

  it('computes a positive delta (measurement increased)', () => {
    const records = [
      { waist_cm: null, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: 32 },
      { waist_cm: null, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: 34 },
    ];
    expect(measurementDelta(records, 'arm_cm')).toBeCloseTo(2);
  });

  it('skips null values when computing first and last', () => {
    // First non-null is 80, last non-null is 75 (the null in the middle is ignored)
    const records = [
      { waist_cm: 80, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: null, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: 75, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(measurementDelta(records, 'waist_cm')).toBeCloseTo(-5);
  });
});

// ─── latestMeasurementValue ───────────────────────────────────────────────────

describe('latestMeasurementValue', () => {
  it('returns null for empty input', () => {
    expect(latestMeasurementValue([], 'waist_cm')).toBeNull();
  });

  it('returns null when all values for the field are null', () => {
    const records = [
      { waist_cm: null, chest_cm: 90, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(latestMeasurementValue(records, 'waist_cm')).toBeNull();
  });

  it('returns the latest non-null value', () => {
    const records = [
      { waist_cm: 85, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: null, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: 82, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(latestMeasurementValue(records, 'waist_cm')).toBe(82);
  });

  it('skips trailing nulls and returns the last non-null value', () => {
    const records = [
      { waist_cm: 88, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
      { waist_cm: null, chest_cm: null, hips_cm: null, thigh_cm: null, arm_cm: null },
    ];
    expect(latestMeasurementValue(records, 'waist_cm')).toBe(88);
  });
});

// ─── estimated1RM ─────────────────────────────────────────────────────────────

import { estimated1RM, computePRs, bestSetPerDay } from '../analyticsHelpers';

describe('estimated1RM', () => {
  it('returns weight unchanged for reps === 1', () => {
    expect(estimated1RM(100, 1)).toBe(100);
  });

  it('returns weight unchanged for reps <= 0 (treated as 1)', () => {
    expect(estimated1RM(80, 0)).toBe(80);
  });

  it('applies Epley formula for reps > 1', () => {
    // weight * (1 + reps / 30) = 100 * (1 + 10/30) = 133.333...
    expect(estimated1RM(100, 10)).toBeCloseTo(133.333);
  });

  it('computes correctly for common rep ranges', () => {
    // 60kg × 5 reps: 60 * (1 + 5/30) = 60 * 1.1667 = 70
    expect(estimated1RM(60, 5)).toBeCloseTo(70);
    // 80kg × 8 reps: 80 * (1 + 8/30) = 80 * 1.2667 ≈ 101.33
    expect(estimated1RM(80, 8)).toBeCloseTo(101.333);
  });

  it('scales linearly with weight', () => {
    const r1 = estimated1RM(50, 6);
    const r2 = estimated1RM(100, 6);
    expect(r2).toBeCloseTo(r1 * 2);
  });

  it('handles fractional weights', () => {
    expect(estimated1RM(67.5, 3)).toBeCloseTo(67.5 * (1 + 3 / 30));
  });
});

// ─── computePRs ──────────────────────────────────────────────────────────────

describe('computePRs', () => {
  it('returns nulls for empty history', () => {
    const result = computePRs([]);
    expect(result.bestWeight).toBeNull();
    expect(result.best1RM).toBeNull();
    expect(result.bestVolume).toBeNull();
  });

  it('returns correct PRs for a single set', () => {
    const history = [
      { id: 1, date: '2024-01-10', exercise: 'Squat', reps: 5, weight_kg: 80 },
    ];
    const result = computePRs(history);
    expect(result.bestWeight).toEqual({ value: 80, date: '2024-01-10' });
    expect(result.best1RM?.value).toBeCloseTo(estimated1RM(80, 5));
    expect(result.best1RM?.date).toBe('2024-01-10');
    expect(result.bestVolume).toEqual({ value: 80 * 5, date: '2024-01-10' });
  });

  it('reps === 1: best1RM equals weight (Epley identity)', () => {
    const history = [
      { id: 1, date: '2024-02-01', exercise: 'Deadlift', reps: 1, weight_kg: 120 },
    ];
    const result = computePRs(history);
    expect(result.best1RM?.value).toBe(120);
  });

  it('identifies best weight from multiple sets', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Bench', reps: 8, weight_kg: 60 },
      { id: 2, date: '2024-01-08', exercise: 'Bench', reps: 8, weight_kg: 65 },
      { id: 3, date: '2024-01-15', exercise: 'Bench', reps: 5, weight_kg: 70 },
    ];
    const result = computePRs(history);
    expect(result.bestWeight?.value).toBe(70);
    expect(result.bestWeight?.date).toBe('2024-01-15');
  });

  it('identifies best 1RM which may differ from best weight set', () => {
    // High reps at lower weight can yield higher 1RM than heavier weight at low reps
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Curl', reps: 1, weight_kg: 40 }, // 1RM = 40
      { id: 2, date: '2024-01-02', exercise: 'Curl', reps: 15, weight_kg: 30 }, // 1RM = 30*(1+15/30) = 45
    ];
    const result = computePRs(history);
    // Best weight set = 40kg (set 1)
    expect(result.bestWeight?.value).toBe(40);
    // Best 1RM = 45 (set 2 with 15 reps at 30kg)
    expect(result.best1RM?.value).toBeCloseTo(45);
    expect(result.best1RM?.date).toBe('2024-01-02');
  });

  it('identifies best volume (weight * reps)', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Row', reps: 5, weight_kg: 100 }, // vol = 500
      { id: 2, date: '2024-01-02', exercise: 'Row', reps: 10, weight_kg: 60 }, // vol = 600
      { id: 3, date: '2024-01-03', exercise: 'Row', reps: 3, weight_kg: 110 }, // vol = 330
    ];
    const result = computePRs(history);
    expect(result.bestVolume?.value).toBe(600);
    expect(result.bestVolume?.date).toBe('2024-01-02');
  });

  it('first-achieved wins on weight tie', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Press', reps: 5, weight_kg: 80 },
      { id: 2, date: '2024-01-08', exercise: 'Press', reps: 5, weight_kg: 80 }, // same weight
    ];
    const result = computePRs(history);
    expect(result.bestWeight?.date).toBe('2024-01-01');
  });

  it('first-achieved wins on 1RM tie', () => {
    // Two sets with identical 1RM
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Lunge', reps: 10, weight_kg: 30 }, // 1RM = 40
      { id: 2, date: '2024-01-02', exercise: 'Lunge', reps: 10, weight_kg: 30 }, // 1RM = 40
    ];
    const result = computePRs(history);
    expect(result.best1RM?.date).toBe('2024-01-01');
  });
});

// ─── bestSetPerDay ────────────────────────────────────────────────────────────

describe('bestSetPerDay', () => {
  it('returns empty array for empty input', () => {
    expect(bestSetPerDay([])).toEqual([]);
  });

  it('returns one entry per day', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Squat', reps: 5, weight_kg: 80 },
      { id: 2, date: '2024-01-01', exercise: 'Squat', reps: 3, weight_kg: 90 },
      { id: 3, date: '2024-01-02', exercise: 'Squat', reps: 5, weight_kg: 85 },
    ];
    const result = bestSetPerDay(history);
    expect(result).toHaveLength(2);
  });

  it('selects the heaviest set on a given day', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Squat', reps: 10, weight_kg: 60 },
      { id: 2, date: '2024-01-01', exercise: 'Squat', reps: 3,  weight_kg: 90 },
      { id: 3, date: '2024-01-01', exercise: 'Squat', reps: 8,  weight_kg: 70 },
    ];
    const result = bestSetPerDay(history);
    expect(result[0].weight_kg).toBe(90);
    expect(result[0].reps).toBe(3);
  });

  it('breaks weight ties by most reps', () => {
    const history = [
      { id: 1, date: '2024-01-01', exercise: 'Deadlift', reps: 3, weight_kg: 100 },
      { id: 2, date: '2024-01-01', exercise: 'Deadlift', reps: 5, weight_kg: 100 },
    ];
    const result = bestSetPerDay(history);
    expect(result[0].reps).toBe(5);
  });

  it('attaches correct estimated1RM to each best set', () => {
    const history = [
      { id: 1, date: '2024-01-05', exercise: 'Press', reps: 8, weight_kg: 50 },
    ];
    const result = bestSetPerDay(history);
    expect(result[0].estimated1RM).toBeCloseTo(estimated1RM(50, 8));
  });

  it('returns results sorted ascending by date', () => {
    const history = [
      { id: 3, date: '2024-01-15', exercise: 'Curl', reps: 10, weight_kg: 20 },
      { id: 1, date: '2024-01-05', exercise: 'Curl', reps: 10, weight_kg: 18 },
      { id: 2, date: '2024-01-10', exercise: 'Curl', reps: 10, weight_kg: 19 },
    ];
    const result = bestSetPerDay(history);
    expect(result.map((r) => r.date)).toEqual([
      '2024-01-05', '2024-01-10', '2024-01-15',
    ]);
  });

  it('single entry returns exactly one row', () => {
    const history = [
      { id: 1, date: '2024-03-01', exercise: 'RDL', reps: 12, weight_kg: 40 },
    ];
    const result = bestSetPerDay(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: '2024-03-01', weight_kg: 40, reps: 12 });
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
