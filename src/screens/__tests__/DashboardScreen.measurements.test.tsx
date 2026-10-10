import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// DashboardScreen now reloads on focus (#304) via `useFocusEffect`, which
// needs a real `NavigationContainer` unless mocked. These tests only need
// the load to run once on mount, so the focus effect is modeled as a plain
// mount effect (same pattern as MealPrepScreen.test.tsx / SettingsScreen.test.tsx).
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
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
  body_weight: null,
  additional_workouts: [],
};

function makeMeasurements(
  overrides: Partial<{
    waist_cm: number | null;
    chest_cm: number | null;
    hips_cm: number | null;
    thigh_cm: number | null;
    arm_cm: number | null;
  }> = {}
) {
  const values = {
    waist_cm: 80,
    chest_cm: 90,
    hips_cm: 95,
    thigh_cm: 55,
    arm_cm: 30,
    ...overrides,
  };
  const dated = (value: number | null) => (value === null ? null : { value, date: mockToday });
  return {
    waist_cm: dated(values.waist_cm),
    chest_cm: dated(values.chest_cm),
    hips_cm: dated(values.hips_cm),
    thigh_cm: dated(values.thigh_cm),
    arm_cm: dated(values.arm_cm),
  };
}

// db mock list copied from DashboardScreen.test.tsx (#325).
jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  addAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  toggleAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  syncRollingSchedule: jest.fn(() => Promise.resolve(undefined)),
  toISODate: jest.fn(() => '2026-09-19'),
  getTodaysMealsWithRecipe: jest.fn(() => Promise.resolve([])),
  toggleMealConsumed: jest.fn(() => Promise.resolve(undefined)),
  getWaterForDay: jest.fn(() => Promise.resolve(0)),
  addWater: jest.fn(() => Promise.resolve(undefined)),
  getHydrationGoal: jest.fn(() => Promise.resolve(2000)),
  logBodyMeasurement: jest.fn(() => Promise.resolve(undefined)),
  getLatestMeasurements: jest.fn(() => Promise.resolve(null)),
  logWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
  getWorkoutSetsForDay: jest.fn(() => Promise.resolve([])),
  getLastSetForExercise: jest.fn(() => Promise.resolve(null)),
  deleteWorkoutSet: jest.fn(() => Promise.resolve(undefined)),
}));

import DashboardScreen from '../DashboardScreen';
import {
  getLogByDate,
  upsertLogField,
  getLatestMeasurements,
  logBodyMeasurement,
} from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockUpsertLogField = jest.mocked(upsertLogField);
const mockGetLatestMeasurements = jest.mocked(getLatestMeasurements);
const mockLogBodyMeasurement = jest.mocked(logBodyMeasurement);

/** Flush pending microtasks (the mocked DB promises resolving on mount). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Render the screen, flush its initial load, and open the Measurements modal. */
async function renderWithModalOpen() {
  const utils = render(<DashboardScreen />);
  await flushMicrotasks();
  fireEvent.press(utils.getByLabelText('Log measurements'));
  return utils;
}

describe('DashboardScreen measurements modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockUpsertLogField.mockResolvedValue(undefined);
    mockLogBodyMeasurement.mockResolvedValue(undefined);
    // A NEW object identity with the same values on every call -- this is
    // what exposed the clobber bug: the modal's old reset effect re-ran
    // whenever `latest`'s *identity* changed, even when nothing meaningful
    // about the data did.
    mockGetLatestMeasurements.mockImplementation(() => Promise.resolve(makeMeasurements()));
  });

  it('keeps typed "95" in the waist field across a loadToday() reload triggered by a failed toggle', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '95');

    // Force handleToggle's catch path, which calls loadToday() again --
    // getLatestMeasurements resolves to a *new* object with the same values.
    mockUpsertLogField.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Walk completed'));
    });
    await flushMicrotasks();

    expect(utils.getByTestId('measurement-waist-input').props.value).toBe('95');
  });

  it('shows fresh DB values as placeholders on reopen after close', async () => {
    const utils = await renderWithModalOpen();
    expect(utils.getByTestId('measurement-waist-input').props.placeholder).toBe('80');

    fireEvent.press(utils.getByLabelText('Cancel'));
    // Conditionally mounted -- closed means it's gone from the tree.
    expect(utils.queryByTestId('measurement-waist-input')).toBeNull();

    mockGetLatestMeasurements.mockImplementation(() =>
      Promise.resolve(makeMeasurements({ waist_cm: 82 }))
    );
    mockUpsertLogField.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Walk completed'));
    });
    await flushMicrotasks();

    fireEvent.press(utils.getByLabelText('Log measurements'));

    expect(utils.getByTestId('measurement-waist-input').props.placeholder).toBe('82');
  });

  it('"-5" in waist shows an inline error, keeps the modal open, and does not erase the stored waist value', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '-5');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(utils.getByText('Enter 40–200 cm')).toBeTruthy();
    expect(utils.getByTestId('measurement-waist-input').props.value).toBe('-5');
    // Modal stays open.
    expect(utils.getByLabelText('Save')).toBeTruthy();

    expect(mockLogBodyMeasurement).not.toHaveBeenCalled();
  });

  it('saves the valid fields and leaves the invalid key undefined when only one field is invalid', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '-5');
    fireEvent.changeText(utils.getByTestId('measurement-chest-input'), '92');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
    const [, fields] = mockLogBodyMeasurement.mock.calls[0];
    expect(fields.waist_cm).toBeUndefined();
    expect(fields.chest_cm).toBe(92);

    // Still open -- not every field was valid.
    expect(utils.getByLabelText('Save')).toBeTruthy();
  });

  it('closes the modal once all fields are valid', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '81');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(utils.queryByLabelText('Save')).toBeNull();
  });

  it('writes nothing for a field left blank', async () => {
    const utils = await renderWithModalOpen();

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(mockLogBodyMeasurement).not.toHaveBeenCalled();
  });

  it('parses a comma decimal separator ("78,4")', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-chest-input'), '78,4');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
    const [, fields] = mockLogBodyMeasurement.mock.calls[0];
    expect(fields.chest_cm).toBe(78.4);
  });
});

describe('DashboardScreen measurement pills show their own date', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
  });

  it('renders each pill with its own date and no shared "Last:" label', async () => {
    mockGetLatestMeasurements.mockResolvedValue({
      waist_cm: { value: 80, date: '2026-09-19' },
      chest_cm: { value: 90, date: '2026-08-30' },
      hips_cm: null,
      thigh_cm: null,
      arm_cm: null,
    });
    const utils = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(utils.getByText('80 cm')).toBeTruthy();
    expect(utils.getByText('2026-09-19')).toBeTruthy();
    expect(utils.getByText('90 cm')).toBeTruthy();
    expect(utils.getByText('2026-08-30')).toBeTruthy();
    expect(utils.queryByText(/^Last:/)).toBeNull();
    expect(utils.queryByText('Hips')).toBeNull();
    expect(utils.queryByText('Thigh')).toBeNull();
    expect(utils.queryByText('Arm')).toBeNull();
  });

  it('shows the empty-state subtitle only when nothing has been logged', async () => {
    mockGetLatestMeasurements.mockResolvedValue(null);
    const utils = render(<DashboardScreen />);
    await flushMicrotasks();

    expect(utils.getByText('No measurements logged yet')).toBeTruthy();
  });
});
