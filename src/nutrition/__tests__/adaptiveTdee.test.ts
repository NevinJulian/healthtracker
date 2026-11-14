import {
  computeAdaptiveTdee,
  suggestGoalCalories,
  canApply,
  type AdaptiveTdeeInput,
} from '../adaptiveTdee';
import { addDays } from '../../utils/dates';
import { formulaTdee } from '../tdee';

const TODAY = '2024-06-30';
const START = addDays(TODAY, -28);
const END = addDays(TODAY, -1);

const PROFILE: AdaptiveTdeeInput['profile'] = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  activityLevel: 'moderate',
  goalType: 'maintain',
};

// 80 kg, 180 cm, 30 y, moderate: (800 + 1125 - 150 + 5) * 1.55 = 2759
const F80 = formulaTdee(
  { sex: 'male', age: 30, heightCm: 180, activityLevel: 'moderate', goalType: 'maintain' },
  80
);

function intakeDays(offsets: number[], kcal: number) {
  return offsets.map((o) => ({ date: addDays(START, o), calories: kcal }));
}

function allDays(): number[] {
  return Array.from({ length: 28 }, (_, i) => i);
}

function trendLine(offsets: number[], endWeight: number, kgPerDay: number) {
  const last = 27;
  return offsets.map((o) => ({
    date: addDays(START, o),
    trend: endWeight + (o - last) * kgPerDay,
  }));
}

function run(over: Partial<AdaptiveTdeeInput>) {
  return computeAdaptiveTdee({
    todayISO: TODAY,
    intake: intakeDays(allDays(), 2500),
    trend: trendLine(allDays(), 80, 0),
    profile: PROFILE,
    ...over,
  });
}

function estimateOf(r: ReturnType<typeof run>): number {
  if (r.status !== 'estimate') throw new Error(`expected estimate, got ${r.reason}`);
  return r.estimate;
}

describe('computeAdaptiveTdee series', () => {
  it('steady weight gives the mean intake', () => {
    const r = run({});
    expect(Math.abs(estimateOf(r) - 2500)).toBeLessThanOrEqual(10);
    expect(r.meanIntake).toBe(2500);
  });

  it('linear loss of 0.1 kg/day on 2500 kcal gives 3270', () => {
    const r = run({ trend: trendLine(allDays(), 80, -0.1) });
    expect(estimateOf(r)).toBe(3270);
    expect(r.weightChangeKg).toBeCloseTo(-2.8, 6);
  });

  it('linear gain of 0.05 kg/day on 3000 kcal gives 2620', () => {
    const r = run({
      intake: intakeDays(allDays(), 3000),
      trend: trendLine(allDays(), 80, 0.05),
    });
    expect(estimateOf(r)).toBe(2620);
  });

  it('averages over logged days only and slopes over calendar days', () => {
    const offsets = [0, 1, 2, 3, 10, 11, 12, 20, 21, 27];
    const intake = [
      ...intakeDays([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26], 2800),
      { date: addDays(START, 1), calories: 0 },
    ];
    const r = run({ intake, trend: trendLine(offsets, 80, -0.1) });
    expect(r.loggedDays).toBe(14);
    expect(r.leftOutDays).toBe(1);
    expect(r.meanIntake).toBe(2800);
    expect(estimateOf(r)).toBe(3570);
  });

  it('uses trend values rather than raw weights', () => {
    const trend = allDays().map((o) => ({
      date: addDays(START, o),
      trend: 80,
      weight: 80 + (o % 2 ? 3 : -3),
    }));
    const r = run({ trend });
    expect(Math.abs(estimateOf(r) - 2500)).toBeLessThanOrEqual(10);
  });

  it('leaves out days under 1000 kcal and counts them', () => {
    const intake = [
      ...intakeDays(allDays().slice(0, 20), 2500),
      ...intakeDays(allDays().slice(20), 400),
    ];
    const r = run({ intake });
    expect(r.loggedDays).toBe(20);
    expect(r.leftOutDays).toBe(8);
    expect(r.meanIntake).toBe(2500);
  });

  it('ignores today and anything outside the window', () => {
    const base = run({});
    const noisy = run({
      intake: [
        ...intakeDays(allDays(), 2500),
        { date: TODAY, calories: 9000 },
        { date: addDays(START, -1), calories: 9000 },
      ],
      trend: [
        { date: addDays(START, -1), trend: 50 },
        ...trendLine(allDays(), 80, 0),
        { date: TODAY, trend: 120 },
      ],
    });
    expect(noisy).toEqual(base);
    expect(noisy.windowStart).toBe(START);
    expect(noisy.windowEnd).toBe(END);
  });

  it('takes the latest trend weight on or before yesterday, even from before the window', () => {
    const before = run({ trend: [{ date: addDays(START, -3), trend: 77 }] });
    expect(before.latestTrendWeight).toBe(77);
    expect(before.weighIns).toBe(0);
    const withToday = run({
      trend: [
        { date: addDays(START, -3), trend: 77 },
        { date: TODAY, trend: 90 },
      ],
    });
    expect(withToday.latestTrendWeight).toBe(77);
  });
});

describe('computeAdaptiveTdee thresholds', () => {
  it('999 kcal is left out, 1000 is logged', () => {
    const base = intakeDays(allDays().slice(0, 13), 2500);
    const at999 = run({ intake: [...base, { date: addDays(START, 20), calories: 999 }] });
    expect(at999.loggedDays).toBe(13);
    expect(at999.leftOutDays).toBe(1);
    const at1000 = run({ intake: [...base, { date: addDays(START, 20), calories: 1000 }] });
    expect(at1000.loggedDays).toBe(14);
    expect(at1000.leftOutDays).toBe(0);
  });

  it('13 logged days is insufficient 13 of 14, 14 gives an estimate', () => {
    const r13 = run({ intake: intakeDays(allDays().slice(0, 13), 2500) });
    expect(r13).toMatchObject({
      status: 'insufficient',
      reason: 'logged_days',
      progress: { have: 13, need: 14 },
    });
    const r14 = run({ intake: intakeDays(allDays().slice(0, 14), 2500) });
    expect(r14.status).toBe('estimate');
  });

  it('9 weigh-ins is insufficient 9 of 10, 10 gives an estimate', () => {
    const r9 = run({ trend: trendLine(allDays().slice(0, 9), 80, 0) });
    expect(r9).toMatchObject({
      status: 'insufficient',
      reason: 'weigh_ins',
      progress: { have: 9, need: 10 },
    });
    const r10 = run({ trend: trendLine(allDays().slice(0, 10), 80, 0) });
    expect(r10.status).toBe('estimate');
  });

  it('reports logged days before weigh-ins when both are short', () => {
    const r = run({ intake: [], trend: [] });
    expect(r).toMatchObject({
      status: 'insufficient',
      reason: 'logged_days',
      progress: { have: 0, need: 14 },
    });
  });

  it.each([
    ['sex', { sex: null }],
    ['age', { age: null }],
    ['heightCm', { heightCm: null }],
    ['activityLevel', { activityLevel: null }],
    ['goalType', { goalType: null }],
  ])('an incomplete profile (%s) is insufficient on profile', (_name, patch) => {
    const r = run({ profile: { ...PROFILE, ...patch } });
    expect(r).toMatchObject({ status: 'insufficient', reason: 'profile', progress: null });
    expect(r.formulaTdee).toBeNull();
  });

  it('accepts an estimate exactly at 70 % and 130 % and rejects one kcal outside', () => {
    // 80 kg, 180 cm, 66 y, light: 1600 * 1.375 = 2200
    const profile = { ...PROFILE, age: 66, activityLevel: 'light' as const };
    const at = (mean: number) => run({ profile, intake: intakeDays(allDays(), mean) });
    expect(at(1540).status).toBe('estimate');
    expect(at(1539)).toMatchObject({ status: 'insufficient', reason: 'out_of_range' });
    expect(at(2860).status).toBe('estimate');
    expect(at(2861)).toMatchObject({ status: 'insufficient', reason: 'out_of_range' });
  });

  it('applies the band to the unrounded estimate', () => {
    expect(Number.isInteger(F80 * 0.7)).toBe(false);
    const low = Math.ceil(F80 * 0.7);
    const high = Math.floor(F80 * 1.3);
    const at = (mean: number) => run({ intake: intakeDays(allDays(), mean) });
    expect(at(low).status).toBe('estimate');
    expect(at(low - 1)).toMatchObject({ status: 'insufficient', reason: 'out_of_range' });
    expect(at(high).status).toBe('estimate');
    expect(at(high + 1)).toMatchObject({ status: 'insufficient', reason: 'out_of_range' });
  });

  it('carries the raw estimate and formula TDEE when out of range', () => {
    const r = run({ intake: intakeDays(allDays(), 6000) });
    expect(r).toMatchObject({
      status: 'insufficient',
      reason: 'out_of_range',
      rawEstimate: 6000,
      progress: null,
    });
    expect(r.formulaTdee).toBeCloseTo(F80, 6);
  });
});

describe('suggestGoalCalories', () => {
  it('adds the goal delta and rounds to 10', () => {
    expect(suggestGoalCalories({ estimate: 2500, goalType: 'cut', currentGoal: 2000 })).toBe(2000);
    expect(suggestGoalCalories({ estimate: 2000, goalType: 'gain', currentGoal: 2200 })).toBe(2200);
    expect(suggestGoalCalories({ estimate: 2010, goalType: 'maintain', currentGoal: 2000 })).toBe(2010);
  });

  it('passes the 10 % bound and clamps one kcal beyond it', () => {
    expect(suggestGoalCalories({ estimate: 2200, goalType: 'maintain', currentGoal: 2000 })).toBe(2200);
    expect(suggestGoalCalories({ estimate: 2210, goalType: 'maintain', currentGoal: 2000 })).toBe(2200);
    expect(suggestGoalCalories({ estimate: 1800, goalType: 'maintain', currentGoal: 2000 })).toBe(1800);
    expect(suggestGoalCalories({ estimate: 1790, goalType: 'maintain', currentGoal: 2000 })).toBe(1800);
  });

  it('rounds the bounds inward to a multiple of 10', () => {
    expect(suggestGoalCalories({ estimate: 5000, goalType: 'maintain', currentGoal: 2005 })).toBe(2200);
    expect(suggestGoalCalories({ estimate: 1000, goalType: 'maintain', currentGoal: 2005 })).toBe(1810);
  });

  it('never goes below 1000', () => {
    expect(suggestGoalCalories({ estimate: 1200, goalType: 'cut', currentGoal: 1100 })).toBe(1000);
    expect(suggestGoalCalories({ estimate: 500, goalType: 'maintain', currentGoal: 1000 })).toBe(1000);
  });
});

describe('canApply', () => {
  const base = { currentGoal: 2000, todayISO: TODAY, appliedOn: null };

  it('hides the button within 10 kcal and shows it from 11', () => {
    expect(canApply({ ...base, suggestion: 2010 }).show).toBe(false);
    expect(canApply({ ...base, suggestion: 1990 }).show).toBe(false);
    expect(canApply({ ...base, suggestion: 2011 }).show).toBe(true);
    expect(canApply({ ...base, suggestion: 1989 }).show).toBe(true);
    expect(canApply({ ...base, suggestion: 2010 }).returnsOn).toBeNull();
  });

  it('waits 7 days after an apply: hidden on day 6, shown on day 7', () => {
    const appliedOn = addDays(TODAY, -6);
    expect(canApply({ ...base, suggestion: 2100, appliedOn })).toEqual({
      show: false,
      returnsOn: addDays(appliedOn, 7),
    });
    expect(canApply({ ...base, suggestion: 2100, appliedOn: addDays(TODAY, -7) })).toEqual({
      show: true,
      returnsOn: null,
    });
  });

  it('hides it on the day of the apply', () => {
    expect(canApply({ ...base, suggestion: 2100, appliedOn: TODAY })).toEqual({
      show: false,
      returnsOn: addDays(TODAY, 7),
    });
  });
});
