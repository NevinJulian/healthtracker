import * as fs from 'fs';
import * as path from 'path';
import {
  buildWeeklyReview,
  formatChange,
  formatDateRange,
  formatNumber,
  newBests,
  reviewWindows,
  type ReviewIntakeDay,
  type ReviewLogDay,
  type ReviewSection,
  type WeeklyReview,
  type WeeklyReviewInput,
} from '../weeklyReviewHelpers';
import type { WorkoutSetSlice } from '../analyticsHelpers';

const TODAY = '2026-11-14';
const GOALS = { calories: 2400, protein: 160 };

function day(date: string, over: Partial<Omit<ReviewLogDay, 'date'>> = {}): ReviewLogDay {
  return {
    date,
    is_rest_day: false,
    hammer_completed: false,
    walk_completed: false,
    body_weight: null,
    ...over,
  };
}

let nextId = 1;
function set(
  date: string,
  exercise: string,
  weight_kg: number,
  reps: number,
  set_type: string | null = null
): WorkoutSetSlice {
  return { id: nextId++, date, exercise, weight_kg, reps, set_type };
}

function input(over: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput {
  return {
    today: TODAY,
    logs: [],
    sets: [],
    intake: [],
    goals: GOALS,
    weightRatePerWeek: null,
    ...over,
  };
}

function section(review: WeeklyReview, title: string): ReviewSection {
  const found = review.sections.find((s) => s.title === title);
  if (!found) throw new Error(`no section ${title}`);
  return found;
}

const LOGS: ReviewLogDay[] = [
  day('2026-11-08', { hammer_completed: true, walk_completed: true }),
  day('2026-11-09', { hammer_completed: true }),
  day('2026-11-10', { walk_completed: true }),
  day('2026-11-11', { is_rest_day: true, hammer_completed: true, walk_completed: true }),
  day('2026-11-12', { hammer_completed: true, walk_completed: true }),
  day('2026-11-13'),
  day('2026-11-14', { is_rest_day: true }),
  day('2026-11-01', { hammer_completed: true, walk_completed: true }),
  day('2026-11-02', { hammer_completed: true }),
  day('2026-11-03', { walk_completed: true }),
  day('2026-11-04'),
  day('2026-11-05', { is_rest_day: true, walk_completed: true }),
  day('2026-11-06', { is_rest_day: true }),
  day('2026-11-07', { is_rest_day: true }),
];

const SETS: WorkoutSetSlice[] = [
  set('2026-10-20', 'Squat', 95, 5),
  set('2026-10-20', 'Bench Press', 80, 5),
  set('2026-11-03', 'Deadlift', 120, 10),
  set('2026-11-03', 'Deadlift', 120, 10),
  set('2026-11-03', 'Deadlift', 115, 10),
  set('2026-11-10', 'Squat', 60, 10, 'warmup'),
  set('2026-11-10', 'Squat', 100, 5),
  set('2026-11-10', 'Squat', 100, 5),
  set('2026-11-10', 'Squat', 100, 5),
  set('2026-11-10', 'Bench Press', 80, 5),
  set('2026-11-10', 'Bench Press', 80, 5),
];

const INTAKE: ReviewIntakeDay[] = [
  { date: '2026-11-08', calories: 2000, protein: 140 },
  { date: '2026-11-09', calories: 2200, protein: 150 },
  { date: '2026-11-10', calories: 2400, protein: 160 },
  { date: '2026-11-02', calories: 1800, protein: 120 },
  { date: '2026-11-03', calories: 2000, protein: 130 },
  { date: '2026-10-31', calories: 9999, protein: 999 },
  { date: '2026-11-15', calories: 9999, protein: 999 },
];

describe('reviewWindows', () => {
  it('gives the last 7 days and the 7 before for 2026-11-14', () => {
    expect(reviewWindows('2026-11-14')).toEqual({
      current: { from: '2026-11-08', to: '2026-11-14' },
      previous: { from: '2026-11-01', to: '2026-11-07' },
    });
  });

  it('holds across a month and year boundary', () => {
    expect(reviewWindows('2027-01-03')).toEqual({
      current: { from: '2026-12-28', to: '2027-01-03' },
      previous: { from: '2026-12-21', to: '2026-12-27' },
    });
  });

  it('holds across the DST change on 2026-11-01', () => {
    expect(reviewWindows('2026-11-03')).toEqual({
      current: { from: '2026-10-28', to: '2026-11-03' },
      previous: { from: '2026-10-21', to: '2026-10-27' },
    });
    expect(reviewWindows('2026-11-07')).toEqual({
      current: { from: '2026-11-01', to: '2026-11-07' },
      previous: { from: '2026-10-25', to: '2026-10-31' },
    });
  });
});

describe('formatting', () => {
  it('formats a date range with fixed English month abbreviations', () => {
    expect(formatDateRange('2026-11-08', '2026-11-14')).toBe('8 Nov – 14 Nov');
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec – 3 Jan');
  });

  it('adds thousands separators', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(5300)).toBe('5,300');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formats a change as +n, U+2212 n or no change', () => {
    expect(formatChange(2, 'set', 'sets')).toBe('+2 sets');
    expect(formatChange(1, 'set', 'sets')).toBe('+1 set');
    expect(formatChange(-1250, 'kg')).toBe('−1250 kg');
    expect(formatChange(0, 'kg')).toBe('no change');
  });
});

describe('buildWeeklyReview', () => {
  it('reports the two ranges', () => {
    const review = buildWeeklyReview(input());
    expect(review.ranges).toEqual({ current: '8 Nov – 14 Nov', previous: '1 Nov – 7 Nov' });
  });

  it('reports nothing logged for empty input and lists no sections', () => {
    const review = buildWeeklyReview(input());
    expect(review.nothingLogged).toBe(true);
    expect(review.sections).toEqual([]);
  });

  it('treats daily_log rows without activity as nothing logged', () => {
    const review = buildWeeklyReview(input({ logs: [day('2026-11-10'), day('2026-11-11')] }));
    expect(review.nothingLogged).toBe(true);
  });

  it('counts warm-up-only sets as logged and shows no sets in Lifting', () => {
    const review = buildWeeklyReview(
      input({ sets: [set('2026-11-10', 'Squat', 60, 10, 'warmup')] })
    );
    expect(review.nothingLogged).toBe(false);
    expect(section(review, 'Lifting').emptyText).toBe('No sets logged.');
    expect(section(review, 'Lifting').rows).toEqual([]);
  });

  it('counts a weigh-in or an intake day alone as logged', () => {
    expect(
      buildWeeklyReview(input({ logs: [day('2026-11-12', { body_weight: 80 })] })).nothingLogged
    ).toBe(false);
    expect(
      buildWeeklyReview(input({ intake: [{ date: '2026-11-12', calories: 1, protein: 1 }] }))
        .nothingLogged
    ).toBe(false);
  });

  it('ignores activity that falls only in the previous window when deciding nothing logged', () => {
    const review = buildWeeklyReview(
      input({ logs: [day('2026-11-03', { hammer_completed: true })] })
    );
    expect(review.nothingLogged).toBe(true);
  });

  it('lists the sections in order for a logged window', () => {
    const review = buildWeeklyReview(input({ logs: LOGS, sets: SETS, intake: INTAKE }));
    expect(review.sections.map((s) => s.title)).toEqual([
      'Training',
      'Lifting',
      'New bests',
      'Nutrition',
      'Weight',
    ]);
  });

  describe('a partly filled window', () => {
    const review = buildWeeklyReview(
      input({ logs: LOGS, sets: SETS, intake: INTAKE, weightRatePerWeek: 0.4 })
    );

    it('counts 3 of 5 gym sessions and 4 walks of 7, with rest days out of the gym count', () => {
      expect(section(review, 'Training').rows).toEqual([
        { label: 'Gym sessions', value: '3 of 5', previous: '2 of 4', change: '+1 session' },
        { label: 'Walks', value: '4 of 7', previous: '3 of 7', change: '+1 walk' },
      ]);
    });

    it('counts exact working sets and tonnage with the changes +2 sets and −1250 kg', () => {
      expect(section(review, 'Lifting').rows).toEqual([
        { label: 'Working sets', value: '5', previous: '3', change: '+2 sets' },
        { label: 'Tonnage', value: '2,300 kg', previous: '3,550 kg', change: '−1250 kg' },
      ]);
    });

    it('lists the new best with its weight', () => {
      expect(section(review, 'New bests').rows).toEqual([
        { label: 'Squat', value: '100 kg', previous: null, change: null },
      ]);
    });

    it('averages intake over the logged days only and ignores rows outside both windows', () => {
      expect(section(review, 'Nutrition').rows).toEqual([
        { label: 'Mean calories', value: '2,200 kcal', previous: '1,900 kcal', change: '+300 kcal' },
        { label: 'Mean protein', value: '150 g', previous: '125 g', change: '+25 g' },
        { label: 'Days logged', value: '3', previous: '2', change: '+1 day' },
        { label: 'Goal', value: '2,400 kcal · 160 g', previous: null, change: null },
      ]);
    });

    it('shows the weight rate with no comparison', () => {
      expect(section(review, 'Weight').rows).toEqual([
        { label: 'Trend', value: '+0.4 kg/week', previous: null, change: null },
      ]);
    });
  });

  it('shows the weight line as not enough weigh-ins when the rate is null', () => {
    const review = buildWeeklyReview(input({ logs: LOGS }));
    expect(section(review, 'Weight').emptyText).toBe('Not enough weigh-ins yet.');
    expect(section(review, 'Weight').rows).toEqual([]);
  });

  it('shows the per-section empty lines', () => {
    const review = buildWeeklyReview(input({ logs: [day('2026-11-12', { body_weight: 80 })] }));
    expect(section(review, 'Training').emptyText).toBe('No sessions or walks logged.');
    expect(section(review, 'Lifting').emptyText).toBe('No sets logged.');
    expect(section(review, 'New bests').emptyText).toBe('No new bests.');
    expect(section(review, 'Nutrition').emptyText).toBe('No meals or entries logged.');
  });

  it('omits the change and shows a dash when the previous window has no data', () => {
    const review = buildWeeklyReview(
      input({
        logs: [day('2026-11-12', { hammer_completed: true })],
        sets: [set('2026-11-12', 'Squat', 100, 5)],
        intake: [{ date: '2026-11-12', calories: 2000, protein: 100 }],
      })
    );
    expect(section(review, 'Training').rows[0]).toEqual({
      label: 'Gym sessions',
      value: '1 of 1',
      previous: '—',
      change: null,
    });
    expect(section(review, 'Lifting').rows[0]).toEqual({
      label: 'Working sets',
      value: '1',
      previous: '—',
      change: null,
    });
    expect(section(review, 'Nutrition').rows[0]).toEqual({
      label: 'Mean calories',
      value: '2,000 kcal',
      previous: '—',
      change: null,
    });
  });

  it('keeps a rest-day row with hammer_completed out of the gym count and the denominator', () => {
    const review = buildWeeklyReview(
      input({
        logs: [
          day('2026-11-12', { hammer_completed: true }),
          day('2026-11-13'),
          day('2026-11-14', { is_rest_day: true, hammer_completed: true }),
        ],
      })
    );
    expect(section(review, 'Training').rows[0].value).toBe('1 of 2');
  });

  it('counts a day without a daily_log row as neither planned nor done', () => {
    const review = buildWeeklyReview(
      input({ logs: [day('2026-11-12', { hammer_completed: true })] })
    );
    expect(section(review, 'Training').rows[0].value).toBe('1 of 1');
  });

  it('counts an entries-only intake day', () => {
    const entriesOnly = {
      date: '2026-11-12',
      calories: 500,
      protein: 20,
      carbs: 0,
      fat: 0,
      mealCount: 0,
    };
    const review = buildWeeklyReview(input({ intake: [entriesOnly] }));
    expect(section(review, 'Nutrition').rows[2]).toMatchObject({ label: 'Days logged', value: '1' });
  });

  it('excludes warm-ups from sets and tonnage', () => {
    const review = buildWeeklyReview(
      input({
        sets: [set('2026-11-10', 'Squat', 60, 10, 'warmup'), set('2026-11-10', 'Squat', 100, 5)],
      })
    );
    expect(section(review, 'Lifting').rows[0].value).toBe('1');
    expect(section(review, 'Lifting').rows[1].value).toBe('500 kg');
  });

  it('rounds tonnage to whole kg', () => {
    const review = buildWeeklyReview(
      input({ sets: [set('2026-11-10', 'Squat', 62.5, 5), set('2026-11-10', 'Squat', 62.5, 6)] })
    );
    expect(section(review, 'Lifting').rows[1].value).toBe('688 kg');
  });
});

describe('newBests', () => {
  const WINDOW = { from: '2026-11-08', to: '2026-11-14' };

  it('does not count a tied best', () => {
    expect(
      newBests([set('2026-10-20', 'Squat', 100, 5), set('2026-11-10', 'Squat', 100, 5)], WINDOW)
    ).toEqual([]);
  });

  it('counts a best that is 0.5 kg higher', () => {
    expect(
      newBests([set('2026-10-20', 'Squat', 100, 5), set('2026-11-10', 'Squat', 100.5, 5)], WINDOW)
    ).toEqual([{ exercise: 'Squat', weightKg: 100.5 }]);
  });

  it('does not count a first session', () => {
    expect(newBests([set('2026-11-10', 'Squat', 100, 5)], WINDOW)).toEqual([]);
  });

  it('does not count a first session whose only prior sets are warm-ups', () => {
    expect(
      newBests(
        [set('2026-10-20', 'Squat', 140, 3, 'warmup'), set('2026-11-10', 'Squat', 100, 5)],
        WINDOW
      )
    ).toEqual([]);
  });

  it('ignores warm-ups inside the window', () => {
    expect(
      newBests(
        [
          set('2026-10-20', 'Squat', 100, 5),
          set('2026-11-10', 'Squat', 120, 3, 'warmup'),
          set('2026-11-10', 'Squat', 100, 5),
        ],
        WINDOW
      )
    ).toEqual([]);
  });

  it('measures against every working set before the window, including the previous week', () => {
    expect(
      newBests([set('2026-11-03', 'Squat', 105, 5), set('2026-11-10', 'Squat', 100, 5)], WINDOW)
    ).toEqual([]);
  });

  it('ignores sets after the window', () => {
    expect(
      newBests([set('2026-10-20', 'Squat', 100, 5), set('2026-11-15', 'Squat', 140, 5)], WINDOW)
    ).toEqual([]);
  });

  it('lists exercises alphabetically', () => {
    expect(
      newBests(
        [
          set('2026-10-20', 'Squat', 100, 5),
          set('2026-10-20', 'Bench Press', 80, 5),
          set('2026-11-10', 'Squat', 110, 5),
          set('2026-11-10', 'Bench Press', 85, 5),
        ],
        WINDOW
      )
    ).toEqual([
      { exercise: 'Bench Press', weightKg: 85 },
      { exercise: 'Squat', weightKg: 110 },
    ]);
  });
});

describe('module purity', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'weeklyReviewHelpers.ts'), 'utf8');

  it('does not import the database and does not read the clock', () => {
    expect(source).not.toMatch(/db\/database/);
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/new Date\(/);
    expect(source).not.toMatch(/todayKey/);
    expect(source).not.toMatch(/toLocaleString/);
  });
});
