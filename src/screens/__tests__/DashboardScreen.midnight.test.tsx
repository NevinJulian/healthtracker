// @testing-library/react-native 13.3.3 refuses to import unless the
// installed react-test-renderer version matches its expected peer exactly.
// This repo currently has react@19.1.0 / react-test-renderer@19.2.5 (a
// pre-existing devDependency mismatch, out of this lane's scope to fix).
// Setting this env var before RNTL's own module body runs skips that check;
// RNTL's actual rendering works fine with this combination. It must be set
// before the (non-hoisted) `require` below, so it cannot be a hoisted
// `import`.
process.env.RNTL_SKIP_DEPS_CHECK = '1';

import React from 'react';
import { AppState } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, act, fireEvent } = require('@testing-library/react-native');

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// This file exists ONLY to prove #304: DashboardScreen had no
// `useFocusEffect` and no `AppState` listener, so a screen left mounted
// across a navigation return or an overnight foregrounding never re-read
// the DB and never re-derived `today` -- writers kept closing over
// yesterday's date string.
//
// It captures the latest `useFocusEffect` callback (and, once invoked, its
// cleanup) in module-scope variables, the same pattern used by
// SettingsScreen.profileRehydration.test.tsx and MealPrepScreen.focus.test.tsx,
// so a "focus" and a "blur" can be driven directly instead of needing a real
// NavigationContainer. These captured-callback variables are referenced
// inside the jest.mock factory below, which babel-plugin-jest-hoist hoists
// above this file's imports -- the "must be mock-prefixed" rule is what
// allows that reference to be considered in-scope.
let mockFocusCallback: (() => void | (() => void)) | null = null;
let mockFocusCleanup: (() => void) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockFocusCallback = callback;
  },
}));

const mockToday = '2026-09-19';

const mockEntry = {
  date: mockToday,
  walking_task: 'Walk 30 min',
  hammer_task: 'Upper body',
  walk_completed: false,
  hammer_completed: false,
  fasting_completed: false,
  is_rest_day: false,
  is_meal_prep_day: false,
  exercises: [],
  body_weight: null as number | null,
  additional_workouts: [],
};

// db mock list copied from DashboardScreen.test.tsx / DashboardScreen.mealToggle.test.tsx
// (#325 / #330). Lazy factories (`jest.fn(() => Promise.resolve(x))`, not
// `jest.fn().mockResolvedValue(x)`) so per-test `mockReturnValueOnce`
// overrides below take effect cleanly after `jest.clearAllMocks()`.
//
// `toISODate` is the one deliberate departure from those files' mocks: it is
// computed from the CURRENT (possibly fake, via `jest.setSystemTime`) system
// clock using local calendar getters, mirroring the real
// `toISODate`/`localDateKey` (src/utils/dates.ts) that DashboardScreen's
// `today = toISODate()` calls on every render. A hard-coded return value
// (as the other Dashboard test files use) can never observe a midnight
// crossing.
jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  upsertAdditionalWorkouts: jest.fn(() => Promise.resolve(undefined)),
  syncRollingSchedule: jest.fn(() => Promise.resolve(undefined)),
  toISODate: jest.fn(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }),
  getTodaysMealsWithRecipe: jest.fn(() => Promise.resolve([])),
  toggleMealConsumed: jest.fn(() => Promise.resolve(undefined)),
  getWaterForDay: jest.fn(() => Promise.resolve(0)),
  addWater: jest.fn(() => Promise.resolve(undefined)),
  getHydrationGoal: jest.fn(() => Promise.resolve(2000)),
  logBodyMeasurement: jest.fn(() => Promise.resolve(undefined)),
  getLatestMeasurements: jest.fn(() => Promise.resolve(null)),
  logWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
  getWorkoutSetsForDay: jest.fn(() => Promise.resolve([])),
  deleteWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
}));

import DashboardScreen from '../DashboardScreen';
import { getLogByDate, upsertBodyWeight } from '../../db/database';
import type { DailyLogEntry } from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockUpsertBodyWeight = jest.mocked(upsertBodyWeight);
const mockAddEventListener = jest.mocked(AppState.addEventListener);

// ─── Date helpers ───────────────────────────────────────────────────────────
//
// Build the "before"/"after" instants as explicit UTC timestamps and derive
// their expected date-key strings with the SAME local-getter method the real
// `toISODate` uses -- never a hard-coded UTC string. January is outside DST
// for both `TZ=UTC` (no DST) and Europe/Zurich (CET, UTC+1 -- CEST/UTC+2
// only applies late-March to late-October), so the offset below is stable
// regardless of when this suite actually runs.
//
// Zurich's local midnight (into the 15th) lands at 2026-01-14T23:00:00Z
// (1h ahead of UTC); UTC's own midnight lands an hour later, at
// 2026-01-15T00:00:00Z. BEFORE_MIDNIGHT sits before both instants and
// AFTER_MIDNIGHT sits after both, so this pair crosses local midnight under
// both `TZ=UTC` (what `npm test` sets) and an unset TZ on a Europe/Zurich
// dev box.
function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const BEFORE_MIDNIGHT = new Date(Date.UTC(2026, 0, 14, 22, 0, 0));
const AFTER_MIDNIGHT = new Date(Date.UTC(2026, 0, 15, 0, 30, 0));

const DAY_BEFORE = localISO(BEFORE_MIDNIGHT);
const DAY_AFTER = localISO(AFTER_MIDNIGHT);

function makeEntry(overrides: Partial<DailyLogEntry> = {}): DailyLogEntry {
  return {
    ...mockEntry,
    ...overrides,
  } as DailyLogEntry;
}

/** A promise plus its externally-callable resolve, for controlling exactly
 *  when a mocked DB call settles (needed to build overlapping loads).
 *  Pattern copied from DashboardScreen.mealToggle.test.tsx / MealPrepScreen.focus.test.tsx (#329/#330). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Flush pending microtasks (the mocked DB promises resolving). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Simulates react-navigation re-focusing this screen: runs the outgoing
 * focus's cleanup (a no-op the first time -- there isn't one yet) and then
 * re-invokes the latest captured `useFocusEffect` callback, capturing
 * whatever cleanup it returns for next time. The first call simulates the
 * screen's initial focus on mount.
 */
async function triggerFocus() {
  await act(async () => {
    mockFocusCleanup?.();
    const cleanup = mockFocusCallback?.();
    mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
  });
  await flushMicrotasks();
}

/** The `'change'` listener DashboardScreen most recently registered with
 *  AppState, or undefined if it never registered one (the pre-fix state).
 *  Returning undefined here -- rather than throwing -- is what lets the
 *  caller fail on a clean `expect(...).toHaveBeenCalledWith(...)` assertion
 *  instead of a `TypeError: handler is not a function`. */
function getAppStateHandler(): ((state: string) => void) | undefined {
  const calls = mockAddEventListener.mock.calls;
  const last = calls[calls.length - 1];
  return last?.[1] as ((state: string) => void) | undefined;
}

describe('DashboardScreen reload on focus and app foreground (#304)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockFocusCleanup = null;
    mockGetLogByDate.mockResolvedValue(makeEntry({ date: DAY_BEFORE }));
    jest.useFakeTimers();
    jest.setSystemTime(BEFORE_MIDNIGHT);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sanity: the chosen before/after instants actually cross a local calendar day', () => {
    expect(DAY_BEFORE).not.toBe(DAY_AFTER);
  });

  it('a blur then a focus triggers a new loadToday DB round', async () => {
    render(<DashboardScreen />);

    await triggerFocus(); // initial focus (mount)
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);

    await triggerFocus(); // blur (cleanup) + refocus
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);
  });

  it("AppState turning 'active' triggers a reload; 'background'/'inactive' do not", async () => {
    render(<DashboardScreen />);
    await triggerFocus();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);

    // Assert the subscription exists as its own, clean assertion -- pre-fix,
    // DashboardScreen never calls AppState.addEventListener at all, so this
    // fails here (not with a TypeError further down).
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    const handler = getAppStateHandler()!;

    await act(async () => {
      handler('background');
    });
    await flushMicrotasks();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);

    await act(async () => {
      handler('inactive');
    });
    await flushMicrotasks();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);

    await act(async () => {
      handler('active');
    });
    await flushMicrotasks();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);
  });

  it('the AppState subscription is removed on unmount', async () => {
    const { unmount } = render(<DashboardScreen />);
    await triggerFocus();

    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    const calls = mockAddEventListener.mock.calls;
    const lastIndex = calls.length - 1;
    const subscription = mockAddEventListener.mock.results[lastIndex]?.value;
    expect(subscription?.remove).toEqual(expect.any(Function));

    unmount();
    expect(subscription.remove).toHaveBeenCalled();
  });

  it('an older loadToday run resolving after a newer one does not clobber the newer state', async () => {
    const older = deferred<DailyLogEntry>();
    const newer = deferred<DailyLogEntry>();
    mockGetLogByDate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { getByText, queryByText } = render(<DashboardScreen />);

    await triggerFocus(); // mount focus -> older run started, still pending
    await triggerFocus(); // blur + refocus -> newer run started, still pending
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);

    // Resolve the NEWER run first.
    await act(async () => {
      newer.resolve(makeEntry({ walking_task: 'NEWER TASK' }));
    });
    await flushMicrotasks();
    expect(getByText('NEWER TASK')).toBeTruthy();

    // Resolve the OLDER run after -- it must be discarded, not overwrite state.
    await act(async () => {
      older.resolve(makeEntry({ walking_task: 'OLDER TASK' }));
    });
    await flushMicrotasks();

    expect(queryByText('OLDER TASK')).toBeNull();
    expect(getByText('NEWER TASK')).toBeTruthy();
  });

  it('crossing local midnight then focusing makes a subsequent handleSaveWeight write the new date', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await triggerFocus(); // load for DAY_BEFORE
    expect(mockGetLogByDate).toHaveBeenCalledWith(DAY_BEFORE);

    // Real time passes: cross local midnight while the screen stays mounted.
    mockGetLogByDate.mockResolvedValue(makeEntry({ date: DAY_AFTER }));
    await act(async () => {
      jest.setSystemTime(AFTER_MIDNIGHT);
    });

    // App was backgrounded and comes back to the foreground. This kicks off
    // a reload -- its own DB read may still be racing the render that
    // re-derives `today` (nothing but a render can do that; see #304's
    // accepted residual-gap note), so the assertion that matters here is
    // the one below: the WRITE from a handler invoked *after* this settles
    // must land on the new day, not the read's date argument mid-flight.
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    const handler = getAppStateHandler()!;
    await act(async () => {
      handler('active');
    });
    await flushMicrotasks();
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);

    fireEvent.changeText(getByPlaceholderText('0.0'), '78.4');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(DAY_AFTER, 78.4);
  });

  it('the first mount loads exactly once and shows the spinner while it is pending', async () => {
    const first = deferred<DailyLogEntry>();
    mockGetLogByDate.mockReturnValueOnce(first.promise);

    const { getByText, queryByText } = render(<DashboardScreen />);
    // The initial `loading` state is `true` before any load has even
    // started, so the spinner is already up.
    expect(getByText('Syncing schedule…')).toBeTruthy();

    await act(async () => {
      mockFocusCallback?.();
    });
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);
    // Still pending -- spinner still shown.
    expect(getByText('Syncing schedule…')).toBeTruthy();

    await act(async () => {
      first.resolve(makeEntry());
    });
    await flushMicrotasks();

    expect(queryByText('Syncing schedule…')).toBeNull();
    // No double load on mount.
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);
  });

  it('a reload after the first load does not show the full-screen spinner again', async () => {
    const { queryByText } = render(<DashboardScreen />);
    await triggerFocus(); // completes the first load
    expect(mockGetLogByDate).toHaveBeenCalledTimes(1);
    expect(queryByText('Syncing schedule…')).toBeNull();

    const reload = deferred<DailyLogEntry>();
    mockGetLogByDate.mockReturnValueOnce(reload.promise);

    await act(async () => {
      mockFocusCleanup?.();
      const cleanup = mockFocusCallback?.();
      mockFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
    });
    expect(mockGetLogByDate).toHaveBeenCalledTimes(2);
    // Reload is in-flight (not yet resolved) -- must NOT show the full-screen
    // spinner (#325's hasLoadedOnceRef gate).
    expect(queryByText('Syncing schedule…')).toBeNull();

    await act(async () => {
      reload.resolve(makeEntry());
    });
    await flushMicrotasks();
    expect(queryByText('Syncing schedule…')).toBeNull();
  });
});
