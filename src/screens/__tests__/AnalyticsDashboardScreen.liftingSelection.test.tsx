/**
 * Component-level regression test for issue #308.
 *
 * Bug: LiftingSectionCard seeded its `selectedExercise` state from the
 * `loggedExercises` prop via a useState initializer. `loggedExercises`
 * starts as `[]` on AnalyticsDashboardScreen's first render (populated
 * asynchronously by loadData()), so the initializer always ran with an
 * empty array and the selection stayed `null` forever — even after
 * `loggedExercises` became non-empty — because there is no `key` on
 * <LiftingSectionCard /> to force a remount and useState initializers only
 * run once. Net effect: the Progression card permanently showed
 * "No data for this exercise yet." instead of auto-selecting the first
 * logged exercise.
 */
import React from 'react';
import { LiftingSectionCard } from '../AnalyticsDashboardScreen';
import type { WorkoutSetSlice } from '../analyticsHelpers';

// This repo's lockfile pins `react` at 19.1.0 while `react-test-renderer`
// (a devDependency owned outside Lane C's scope) resolved to 19.2.5.
// @testing-library/react-native's own module-load side effect does a strict
// equality check between the two and throws on import if they differ, even
// though both are React 19 and RNTL itself works fine across this gap.
// RNTL_SKIP_DEPS_CHECK is the library's own documented escape hatch for
// exactly this situation — set it before requiring the module (using
// `require` rather than a hoisted `import` so ordering is preserved).
process.env.RNTL_SKIP_DEPS_CHECK = '1';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render } = require('@testing-library/react-native') as typeof import('@testing-library/react-native');

const squatHistory: WorkoutSetSlice[] = [
  { id: 1, date: '2024-01-01', exercise: 'squat', reps: 5, weight_kg: 80 },
  { id: 2, date: '2024-01-08', exercise: 'squat', reps: 5, weight_kg: 85 },
];

describe('LiftingSectionCard — selection tracks loggedExercises as it loads (#308)', () => {
  it('auto-selects the first exercise and shows its chart once loggedExercises becomes non-empty, without a tap', () => {
    const { rerender, queryByText, getByLabelText } = render(
      <LiftingSectionCard loggedExercises={[]} historyByExercise={{}} />
    );

    // Simulate loadData() resolving: loggedExercises + historyByExercise arrive together.
    rerender(
      <LiftingSectionCard
        loggedExercises={['squat', 'bench']}
        historyByExercise={{ squat: squatHistory, bench: [] }}
      />
    );

    // The squat pill should be selected automatically (no tap performed).
    const squatPill = getByLabelText('View progression for squat');
    expect(squatPill.props.accessibilityState?.selected).toBe(true);

    // The chart for squat should be populated — the empty state must be gone.
    expect(queryByText('No data for this exercise yet.')).toBeNull();
  });
});
