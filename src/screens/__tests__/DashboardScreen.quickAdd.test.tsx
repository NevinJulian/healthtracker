import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, within } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

const mockEntry = {
  date: '2026-09-19',
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
  getLogByDate: jest.fn(() => Promise.resolve(null)),
  upsertLogField: jest.fn(() => Promise.resolve(undefined)),
  upsertExerciseCompleted: jest.fn(() => Promise.resolve(undefined)),
  upsertBodyWeight: jest.fn(() => Promise.resolve(undefined)),
  addAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  toggleAdditionalWorkout: jest.fn(() => Promise.resolve(undefined)),
  syncRollingSchedule: jest.fn(() => Promise.resolve(undefined)),
  toISODate: jest.fn(() => '2026-09-19'),
  getTodaysMealsWithRecipe: jest.fn(() => Promise.resolve([])),
  getFoodLogForDate: jest.fn(() => Promise.resolve([])),
  addFoodLogEntry: jest.fn(() => Promise.resolve(1)),
  updateFoodLogEntry: jest.fn(() => Promise.resolve(undefined)),
  deleteFoodLogEntry: jest.fn(() => Promise.resolve(undefined)),
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
  getTodaysMealsWithRecipe,
  getFoodLogForDate,
  addFoodLogEntry,
  updateFoodLogEntry,
  deleteFoodLogEntry,
  type FoodLogEntry,
  type MealPlanWithRecipe,
} from '../../db/database';

const mockGetLogByDate = jest.mocked(getLogByDate);
const mockGetMeals = jest.mocked(getTodaysMealsWithRecipe);
const mockGetFoodLog = jest.mocked(getFoodLogForDate);
const mockAdd = jest.mocked(addFoodLogEntry);
const mockUpdate = jest.mocked(updateFoodLogEntry);
const mockDelete = jest.mocked(deleteFoodLogEntry);

const TODAY = '2026-09-19';
const YESTERDAY = '2026-09-18';

function makeEntry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 1,
    date: TODAY,
    label: 'Snack',
    calories: 250,
    protein: 10,
    carbs: 20,
    fat: 5,
    created_at: `${TODAY}T08:00:00.000Z`,
    ...overrides,
  };
}

let store: FoodLogEntry[] = [];

function makeMeal(): MealPlanWithRecipe {
  return {
    id: 1,
    date: TODAY,
    meal_type: 'lunch',
    recipe_id: 'r1',
    is_consumed: false,
    consumed_from_inventory_id: null,
    recipe: {
      id: 'r1',
      title: 'Chicken Bowl',
      category: 'lunch',
      calories: 500,
      protein: 40,
      carbs: 50,
      fat: 10,
      prepTimeMinutes: 15,
      defaultServings: 2,
      ingredients: [],
      instructions: '',
      freezerTips: '',
    },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function renderDashboard() {
  const utils = render(<DashboardScreen />);
  await flush();
  return utils;
}

async function openSheet(utils: ReturnType<typeof render>) {
  await act(async () => {
    fireEvent.press(utils.getByLabelText('+ Quick add'));
  });
  await flush();
  return within(utils.getByTestId('quick-add-sheet'));
}

describe('DashboardScreen quick add', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    store = [];
    mockGetLogByDate.mockResolvedValue({ ...mockEntry });
    mockGetMeals.mockResolvedValue([]);
    mockGetFoodLog.mockImplementation(async (date: string) => store.filter((e) => e.date === date));
    mockAdd.mockImplementation(async (input) => {
      const id = store.length + 1;
      store.push({ ...makeEntry(), ...input, id });
      return id;
    });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  describe('today list', () => {
    it('shows the quick add button and the empty hint when nothing is planned', async () => {
      const { getByText, getByLabelText } = await renderDashboard();

      expect(getByText('No meals planned for today.')).toBeTruthy();
      expect(getByLabelText('+ Quick add')).toBeTruthy();
    });

    it('shows the quick add button when meals are planned too', async () => {
      mockGetMeals.mockResolvedValue([makeMeal()]);

      const { getByText, getByLabelText, queryByText } = await renderDashboard();

      expect(getByText('lunch: Chicken Bowl')).toBeTruthy();
      expect(queryByText('No meals planned for today.')).toBeNull();
      expect(getByLabelText('+ Quick add')).toBeTruthy();
    });

    it('lists today\'s entries with label and rounded kcal and protein', async () => {
      store = [makeEntry({ calories: 250.4, protein: 9.6 })];

      const { getByText } = await renderDashboard();

      expect(getByText('Snack')).toBeTruthy();
      expect(getByText('250 kcal · 10 g protein')).toBeTruthy();
    });

    it('titles an entry without a label "Quick add"', async () => {
      store = [makeEntry({ label: null })];

      const { getByLabelText } = await renderDashboard();

      expect(getByLabelText('Edit Quick add')).toBeTruthy();
    });

    it('lists entries below the planned meals', async () => {
      mockGetMeals.mockResolvedValue([makeMeal()]);
      store = [makeEntry()];

      const { toJSON } = await renderDashboard();

      const text = JSON.stringify(toJSON());
      expect(text.indexOf('lunch: Chicken Bowl')).toBeGreaterThan(-1);
      expect(text.indexOf('Snack')).toBeGreaterThan(text.indexOf('lunch: Chicken Bowl'));
      expect(text.indexOf('+ Quick add')).toBeGreaterThan(text.indexOf('Snack'));
    });

    it('does not list a yesterday entry', async () => {
      store = [makeEntry({ date: YESTERDAY, label: 'Old snack' })];

      const { queryByText } = await renderDashboard();

      expect(queryByText('Old snack')).toBeNull();
    });

    it('reads only today\'s entries on load', async () => {
      await renderDashboard();

      expect(mockGetFoodLog).toHaveBeenCalledWith(TODAY);
    });
  });

  describe('sheet', () => {
    it('opens with 7 day chips, the form fields and an empty list', async () => {
      const utils = await renderDashboard();

      const sheet = await openSheet(utils);

      for (const chip of ['Today', 'Yesterday', 'Thu 17', 'Wed 16', 'Tue 15', 'Mon 14', 'Sun 13']) {
        expect(sheet.getByText(chip)).toBeTruthy();
      }
      expect(sheet.queryByText('Sat 12')).toBeNull();
      for (const label of ['Label (optional)', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)']) {
        expect(sheet.getByLabelText(label)).toBeTruthy();
      }
      expect(sheet.getByText('No entries for this day.')).toBeTruthy();
    });

    it('keeps Save disabled until the input is valid', async () => {
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);

      expect(sheet.getByLabelText('Save').props.accessibilityState.disabled).toBe(true);

      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '0');
      expect(sheet.getByLabelText('Save').props.accessibilityState.disabled).toBe(true);

      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '250');
      expect(sheet.getByLabelText('Save').props.accessibilityState.disabled).toBe(false);

      fireEvent.changeText(sheet.getByLabelText('Protein (g)'), 'abc');
      expect(sheet.getByLabelText('Save').props.accessibilityState.disabled).toBe(true);
    });

    it('saves an entry on today with comma decimals and reloads today\'s list', async () => {
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);
      const readsBefore = mockGetFoodLog.mock.calls.filter((c) => c[0] === TODAY).length;

      fireEvent.changeText(sheet.getByLabelText('Label (optional)'), 'Snack');
      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '250');
      fireEvent.changeText(sheet.getByLabelText('Protein (g)'), '10,5');
      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Save'));
      });
      await flush();

      expect(mockAdd).toHaveBeenCalledWith({
        date: TODAY,
        label: 'Snack',
        calories: 250,
        protein: 10.5,
        carbs: 0,
        fat: 0,
      });
      expect(mockGetFoodLog.mock.calls.filter((c) => c[0] === TODAY).length).toBeGreaterThan(readsBefore);
      expect(utils.getByLabelText('Edit Snack')).toBeTruthy();
      expect(sheet.getByLabelText('Calories (kcal)').props.value).toBe('');
    });

    it('saves on the chosen day and keeps it out of today\'s list', async () => {
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);

      await act(async () => {
        fireEvent.press(sheet.getByText('Yesterday'));
      });
      await flush();
      fireEvent.changeText(sheet.getByLabelText('Label (optional)'), 'Late snack');
      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '180');
      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Save'));
      });
      await flush();

      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ date: YESTERDAY, calories: 180 }));
      expect(sheet.getByText('Late snack — 180 kcal · 0 g protein')).toBeTruthy();
      expect(utils.queryByLabelText('Edit Late snack')).toBeNull();
    });

    it('lists the selected day\'s entries only', async () => {
      store = [
        makeEntry({ id: 1, label: 'Today one' }),
        makeEntry({ id: 2, date: YESTERDAY, label: 'Yesterday one' }),
      ];
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);

      expect(sheet.getByText('Today one — 250 kcal · 10 g protein')).toBeTruthy();
      expect(sheet.queryByText('Yesterday one — 250 kcal · 10 g protein')).toBeNull();

      await act(async () => {
        fireEvent.press(sheet.getByText('Yesterday'));
      });
      await flush();

      expect(sheet.getByText('Yesterday one — 250 kcal · 10 g protein')).toBeTruthy();
      expect(sheet.queryByText('Today one — 250 kcal · 10 g protein')).toBeNull();
    });

    it('loads a tapped entry and updates it on save', async () => {
      store = [makeEntry()];
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);

      await act(async () => {
        fireEvent.press(sheet.getByText('Snack — 250 kcal · 10 g protein'));
      });

      expect(sheet.getByLabelText('Label (optional)').props.value).toBe('Snack');
      expect(sheet.getByLabelText('Calories (kcal)').props.value).toBe('250');
      expect(sheet.getByLabelText('Update')).toBeTruthy();

      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '300');
      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Update'));
      });
      await flush();

      expect(mockUpdate).toHaveBeenCalledWith(1, {
        label: 'Snack',
        calories: 300,
        protein: 10,
        carbs: 20,
        fat: 5,
      });
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('opens with the entry loaded when its row on Today is tapped', async () => {
      store = [makeEntry()];
      const utils = await renderDashboard();

      await act(async () => {
        fireEvent.press(utils.getByLabelText('Edit Snack'));
      });
      await flush();

      const sheet = within(utils.getByTestId('quick-add-sheet'));
      expect(sheet.getByLabelText('Calories (kcal)').props.value).toBe('250');
      expect(sheet.getByLabelText('Update')).toBeTruthy();
      expect(sheet.getByLabelText('Delete')).toBeTruthy();
    });

    it('clears the loaded entry and the form when another day chip is chosen', async () => {
      store = [makeEntry()];
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);
      await act(async () => {
        fireEvent.press(sheet.getByText('Snack — 250 kcal · 10 g protein'));
      });

      await act(async () => {
        fireEvent.press(sheet.getByText('Yesterday'));
      });
      await flush();

      expect(sheet.getByLabelText('Calories (kcal)').props.value).toBe('');
      expect(sheet.getByLabelText('Save')).toBeTruthy();
      expect(sheet.queryByLabelText('Update')).toBeNull();
      expect(sheet.queryByLabelText('Delete')).toBeNull();
    });

    it('shows Delete only for a loaded entry', async () => {
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);

      expect(sheet.queryByLabelText('Delete')).toBeNull();
    });

    it('deletes only after the confirm alert is accepted', async () => {
      store = [makeEntry()];
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);
      await act(async () => {
        fireEvent.press(sheet.getByText('Snack — 250 kcal · 10 g protein'));
      });

      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Delete'));
      });

      expect(alertSpy).toHaveBeenCalledTimes(1);
      const [title, body, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe('Delete entry?');
      expect(body).toBe('Snack will be removed.');
      expect(mockDelete).not.toHaveBeenCalled();

      const cancel = buttons.find((b: { text: string }) => b.text === 'Cancel');
      expect(cancel.style).toBe('cancel');
      const confirm = buttons.find((b: { text: string }) => b.text === 'Delete');
      expect(confirm.style).toBe('destructive');

      store = [];
      await act(async () => {
        await confirm.onPress();
      });
      await flush();

      expect(mockDelete).toHaveBeenCalledWith(1);
      expect(utils.queryByLabelText('Edit Snack')).toBeNull();
    });

    it('names an entry without a label "Quick add" in the delete alert', async () => {
      store = [makeEntry({ label: null })];
      const utils = await renderDashboard();

      await act(async () => {
        fireEvent.press(utils.getByLabelText('Edit Quick add'));
      });
      await flush();
      const sheet = within(utils.getByTestId('quick-add-sheet'));
      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Delete'));
      });

      expect(alertSpy.mock.calls[0][1]).toBe('Quick add will be removed.');
    });

    it('alerts and keeps the form when saving fails', async () => {
      mockAdd.mockRejectedValueOnce(new Error('disk full'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const utils = await renderDashboard();
      const sheet = await openSheet(utils);
      fireEvent.changeText(sheet.getByLabelText('Calories (kcal)'), '250');

      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Save'));
      });
      await flush();

      expect(alertSpy).toHaveBeenCalledWith('Could not save', expect.any(String));
      expect(sheet.getByLabelText('Calories (kcal)').props.value).toBe('250');
      errorSpy.mockRestore();
    });

    it('alerts when deleting fails', async () => {
      store = [makeEntry()];
      mockDelete.mockRejectedValueOnce(new Error('disk full'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const utils = await renderDashboard();
      await act(async () => {
        fireEvent.press(utils.getByLabelText('Edit Snack'));
      });
      await flush();
      const sheet = within(utils.getByTestId('quick-add-sheet'));
      await act(async () => {
        fireEvent.press(sheet.getByLabelText('Delete'));
      });

      const confirm = alertSpy.mock.calls[0][2].find((b: { text: string }) => b.text === 'Delete');
      await act(async () => {
        await confirm.onPress();
      });
      await flush();

      expect(alertSpy).toHaveBeenLastCalledWith('Could not delete', expect.any(String));
      errorSpy.mockRestore();
    });
  });

  describe('load failure', () => {
    it('shows the load error view when reading today\'s entries fails', async () => {
      mockGetFoodLog.mockRejectedValue(new Error('db down'));
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const { getByLabelText } = await renderDashboard();

      expect(getByLabelText('Retry')).toBeTruthy();
      errorSpy.mockRestore();
    });
  });
});
