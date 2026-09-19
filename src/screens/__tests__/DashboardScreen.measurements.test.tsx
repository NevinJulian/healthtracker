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

function makeMeasurements(
  overrides: Partial<{
    waist_cm: number | null;
    chest_cm: number | null;
    hips_cm: number | null;
    thigh_cm: number | null;
    arm_cm: number | null;
  }> = {}
) {
  return {
    id: 1,
    date: mockToday,
    waist_cm: 80,
    chest_cm: 90,
    hips_cm: 95,
    thigh_cm: 55,
    arm_cm: 30,
    ...overrides,
  };
}

// db mock list copied from DashboardScreen.test.tsx (#325).
jest.mock('../../db/database', () => ({
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  upsertAdditionalWorkouts: jest.fn(() => Promise.resolve(undefined)),
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

describe('DashboardScreen measurements modal (#325)', () => {
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

  it('shows fresh DB values on reopen after close', async () => {
    const utils = await renderWithModalOpen();
    expect(utils.getByTestId('measurement-waist-input').props.value).toBe('80');

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

    expect(utils.getByTestId('measurement-waist-input').props.value).toBe('82');
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

    expect(mockLogBodyMeasurement).toHaveBeenCalled();
    const [, fields] = mockLogBodyMeasurement.mock.calls[0];
    expect(fields.waist_cm).toBeUndefined();
    expect(fields).not.toHaveProperty('waist_cm', null);
    expect(fields).not.toHaveProperty('waist_cm', -5);
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

  it('sends null for a field cleared to blank', async () => {
    const utils = await renderWithModalOpen();

    fireEvent.changeText(utils.getByTestId('measurement-waist-input'), '');
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Save'));
    });

    expect(mockLogBodyMeasurement).toHaveBeenCalledTimes(1);
    const [, fields] = mockLogBodyMeasurement.mock.calls[0];
    expect(fields.waist_cm).toBeNull();
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
