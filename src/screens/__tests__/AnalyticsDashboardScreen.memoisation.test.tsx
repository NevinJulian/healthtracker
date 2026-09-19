/**
 * Regression test for issue #327.
 *
 * Bug: `StrengthProgressionCard` calls `computeStrengthProgression` (a loop
 * over up to 90 days) and `LiftingSectionCard` calls `bestSetPerDay` (a Map
 * scan of the exercise history) plus `Math.min`/`Math.max` spreads over
 * `chartPoints` — all directly in the function body, on every render.
 * `loadData` in the parent screen commits state across ~4 renders, so both
 * card bodies re-run this work even when their own props are unchanged.
 *
 * This test renders each card directly, re-renders it with prop values that
 * are unchanged (same primitive values / same array identities a real
 * parent would keep), and asserts the underlying helper's call count does
 * NOT increase. It then re-renders with a genuinely changed relevant prop
 * and asserts the call count DOES increase — guarding against a
 * memoisation fix that is simply wrong (stale dependency array -> stale
 * chart).
 */
import React from 'react';
import * as analyticsHelpers from '../analyticsHelpers';
import type { WorkoutSetSlice } from '../analyticsHelpers';

// See AnalyticsDashboardScreen.liftingSelection.test.tsx (#308) for why this
// escape hatch is needed: the lockfile pins `react` at 19.1.0 while
// `react-test-renderer` resolved to 19.2.5, and RNTL's module-load side
// effect throws on that mismatch unless this env var is set first.
process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

// Imported after the RNTL_SKIP_DEPS_CHECK env var is set, same as the
// liftingSelection test.
import { StrengthProgressionCard, LiftingSectionCard } from '../AnalyticsDashboardScreen';

const squatHistory: WorkoutSetSlice[] = [
  { id: 1, date: '2024-01-01', exercise: 'squat', reps: 5, weight_kg: 80 },
  { id: 2, date: '2024-01-08', exercise: 'squat', reps: 5, weight_kg: 85 },
];

describe('StrengthProgressionCard memoisation (#327)', () => {
  const computeSpy = jest.spyOn(analyticsHelpers, 'computeStrengthProgression');

  beforeEach(() => {
    computeSpy.mockClear();
  });

  afterAll(() => {
    computeSpy.mockRestore();
  });

  it('does not re-invoke computeStrengthProgression on a re-render with identical props', () => {
    const { rerender } = render(
      <StrengthProgressionCard startDateISO="2024-01-01" todayISO="2024-03-01" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(1);

    // Same prop values (a real parent re-rendering with unchanged state
    // would pass the same primitive strings).
    rerender(
      <StrengthProgressionCard startDateISO="2024-01-01" todayISO="2024-03-01" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('re-invokes computeStrengthProgression when todayISO changes', () => {
    const { rerender } = render(
      <StrengthProgressionCard startDateISO="2024-01-01" todayISO="2024-03-01" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(1);

    rerender(
      <StrengthProgressionCard startDateISO="2024-01-01" todayISO="2024-03-02" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(2);
  });

  it('re-invokes computeStrengthProgression when startDateISO changes but todayISO does not', () => {
    const { rerender } = render(
      <StrengthProgressionCard startDateISO="2024-01-01" todayISO="2024-03-01" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(1);

    // windowStart = max(today-89, startDateISO), so it moves from
    // 2024-01-01 to 2024-01-15 even though todayISO is unchanged. A memo
    // dep array of just [todayISO] (dropping windowStart) would miss this
    // and serve a stale chart.
    rerender(
      <StrengthProgressionCard startDateISO="2024-01-15" todayISO="2024-03-01" />
    );
    expect(computeSpy).toHaveBeenCalledTimes(2);
  });
});

describe('LiftingSectionCard memoisation (#327)', () => {
  const bestSetSpy = jest.spyOn(analyticsHelpers, 'bestSetPerDay');

  beforeEach(() => {
    bestSetSpy.mockClear();
  });

  afterAll(() => {
    bestSetSpy.mockRestore();
  });

  it('does not re-invoke bestSetPerDay on a re-render with identical props', () => {
    const { rerender } = render(
      <LiftingSectionCard
        loggedExercises={['squat']}
        historyByExercise={{ squat: squatHistory }}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);

    // Same loggedExercises values and the SAME squatHistory array
    // reference — what a parent that hasn't reloaded data would pass.
    rerender(
      <LiftingSectionCard
        loggedExercises={['squat']}
        historyByExercise={{ squat: squatHistory }}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);
  });

  it('re-invokes bestSetPerDay when the selected exercise history changes', () => {
    const { rerender } = render(
      <LiftingSectionCard
        loggedExercises={['squat']}
        historyByExercise={{ squat: squatHistory }}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);

    const updatedHistory: WorkoutSetSlice[] = [
      ...squatHistory,
      { id: 3, date: '2024-01-15', exercise: 'squat', reps: 5, weight_kg: 90 },
    ];
    rerender(
      <LiftingSectionCard
        loggedExercises={['squat']}
        historyByExercise={{ squat: updatedHistory }}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(2);
  });

  it('re-invokes bestSetPerDay when loggedExercises changes the auto-selected exercise, even with the same historyByExercise reference', () => {
    const benchHistory: WorkoutSetSlice[] = [
      { id: 4, date: '2024-02-01', exercise: 'bench', reps: 5, weight_kg: 60 },
    ];
    // Same object reference passed on both renders below — only the order
    // of loggedExercises changes. No pill is tapped, so the active
    // exercise is entirely auto-resolved (resolveSelectedExercise) from
    // loggedExercises[0].
    const sharedHistoryByExercise: Record<string, WorkoutSetSlice[]> = {
      squat: squatHistory,
      bench: benchHistory,
    };

    const { rerender } = render(
      <LiftingSectionCard
        loggedExercises={['squat', 'bench']}
        historyByExercise={sharedHistoryByExercise}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);

    rerender(
      <LiftingSectionCard
        loggedExercises={['bench', 'squat']}
        historyByExercise={sharedHistoryByExercise}
      />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(2);
  });

  it('does not re-invoke bestSetPerDay across re-renders when there is no history for the active exercise', () => {
    // historyByExercise has no entry for 'bench' at all, so the fallback
    // (`?? []` / `: []`) path is exercised on every render. A fresh []
    // literal each render would defeat a useMemo keyed on that value even
    // though nothing meaningful changed.
    const { rerender } = render(
      <LiftingSectionCard loggedExercises={['bench']} historyByExercise={{}} />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);

    rerender(
      <LiftingSectionCard loggedExercises={['bench']} historyByExercise={{}} />
    );
    expect(bestSetSpy).toHaveBeenCalledTimes(1);
  });
});
