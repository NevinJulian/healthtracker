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
import { Alert } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { render, fireEvent, act } = require('@testing-library/react-native');

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
  body_weight: null,
  additional_workouts: [],
};

jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn().mockResolvedValue(null),
  upsertLogField: jest.fn().mockResolvedValue(undefined),
  upsertExerciseCompleted: jest.fn().mockResolvedValue(undefined),
  upsertBodyWeight: jest.fn().mockResolvedValue(undefined),
  upsertAdditionalWorkouts: jest.fn().mockResolvedValue(undefined),
  syncRollingSchedule: jest.fn().mockResolvedValue(undefined),
  toISODate: jest.fn(() => '2026-09-19'),
  getTodaysMealsWithRecipe: jest.fn().mockResolvedValue([]),
  toggleMealConsumed: jest.fn().mockResolvedValue(undefined),
  getWaterForDay: jest.fn().mockResolvedValue(0),
  addWater: jest.fn().mockResolvedValue(undefined),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  logBodyMeasurement: jest.fn().mockResolvedValue(undefined),
  getLatestMeasurements: jest.fn().mockResolvedValue(null),
  logWorkoutSet: jest.fn().mockResolvedValue(undefined),
  getWorkoutSetsForDay: jest.fn().mockResolvedValue([]),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

import DashboardScreen from '../DashboardScreen';
import { getLogByDate, upsertBodyWeight } from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockUpsertBodyWeight = jest.mocked(upsertBodyWeight);

/** Flush pending microtasks (the mocked DB promises resolving on mount). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DashboardScreen', () => {
  it('is a valid React Component', () => {
    expect(typeof DashboardScreen).toBe('function');
  });
});

describe('DashboardScreen body weight input (#322)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
  });

  it('does not save when "12abc" is submitted via Log — rejects with a specific alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '12abc');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Please enter a valid number'
    );

    alertSpy.mockRestore();
  });

  it('does not save when "-50" is submitted via Log — rejects as out of range', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '-50');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Enter a weight between 20 and 400 kg'
    );

    alertSpy.mockRestore();
  });

  it('does not save when "9999" is submitted via Log — rejects as out of range', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '9999');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Enter a weight between 20 and 400 kg'
    );

    alertSpy.mockRestore();
  });

  it('does not save when "" (empty) is submitted via Log — rejects as empty', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Enter a weight before saving'
    );

    alertSpy.mockRestore();
  });

  it('typing "7" and blurring the field does not save', async () => {
    const { getByPlaceholderText } = render(<DashboardScreen />);
    await flushMicrotasks();

    const input = getByPlaceholderText('0.0');
    fireEvent.changeText(input, '7');
    await act(async () => {
      fireEvent(input, 'blur');
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
  });

  it('saves "78.4" via the Log press', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '78.4');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledTimes(1);
    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 78.4);
  });

  it('saves "78.4" via onSubmitEditing', async () => {
    const { getByPlaceholderText } = render(<DashboardScreen />);
    await flushMicrotasks();

    const input = getByPlaceholderText('0.0');
    fireEvent.changeText(input, '78.4');
    await act(async () => {
      fireEvent(input, 'submitEditing');
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledTimes(1);
    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 78.4);
  });

  it('accepts a comma decimal separator ("78,4")', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '78,4');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledTimes(1);
    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 78.4);
  });

  it('correcting after a rejection: "9999" rejected, then "78.4" saved once', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    const input = getByPlaceholderText('0.0');
    const logBtn = getByLabelText('Log body weight');

    fireEvent.changeText(input, '9999');
    await act(async () => {
      fireEvent.press(logBtn);
    });
    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();

    // Invalid text is never cleared or reverted — the user edits it in place.
    fireEvent.changeText(input, '78.4');
    await act(async () => {
      fireEvent.press(logBtn);
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledTimes(1);
    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 78.4);

    alertSpy.mockRestore();
  });

  it('accepts the "20" lower boundary', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '20');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 20);
  });

  it('accepts the "400" upper boundary', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '400');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).toHaveBeenCalledWith(mockToday, 400);
  });

  it('rejects "19.9" — just under the lower boundary', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '19.9');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Enter a weight between 20 and 400 kg'
    );

    alertSpy.mockRestore();
  });

  it('rejects "400.1" — just over the upper boundary', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByPlaceholderText, getByLabelText } = render(<DashboardScreen />);
    await flushMicrotasks();

    fireEvent.changeText(getByPlaceholderText('0.0'), '400.1');
    await act(async () => {
      fireEvent.press(getByLabelText('Log body weight'));
    });

    expect(mockUpsertBodyWeight).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      expect.any(String),
      'Enter a weight between 20 and 400 kg'
    );

    alertSpy.mockRestore();
  });
});
