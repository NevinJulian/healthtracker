import React from 'react';
import { Alert, Text } from 'react-native';
import { render, act, fireEvent } from '@testing-library/react-native';

let latestFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    latestFocusEffect = cb;
  },
}));

jest.mock('../../db/database', () => ({
  toISODate: jest.fn(() => '2024-06-30'),
  getDailyLogsBetween: jest.fn().mockResolvedValue([]),
  getWeightHistory: jest.fn().mockResolvedValue([]),
  getStartDate: jest.fn().mockResolvedValue('2020-01-01'),
  getConsumedMacrosByDay: jest.fn().mockResolvedValue([]),
  getMealAdherence: jest
    .fn()
    .mockResolvedValue({ planned: 0, consumed: 0, adherenceRatio: 0 }),
  getMostEatenRecipes: jest.fn().mockResolvedValue([]),
  getAverageConsumedMacros: jest
    .fn()
    .mockResolvedValue({ calories: 0, protein: 0, carbs: 0, fat: 0, sampleSize: 0 }),
  getMostCookedRecipes: jest.fn().mockResolvedValue([]),
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 2000, protein: 150 }),
  getWaterHistory: jest.fn().mockResolvedValue([]),
  getBodyMeasurements: jest.fn().mockResolvedValue([]),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
  getInventorySnapshot: jest
    .fn()
    .mockResolvedValue({ recipesInStock: 0, totalPortions: 0, items: [] }),
  getLoggedExercises: jest.fn().mockResolvedValue([]),
  getUserProfile: jest.fn(),
  getAdaptiveTdeeAppliedOn: jest.fn(),
  applyAdaptiveCalorieGoal: jest.fn(),
}));

import AnalyticsDashboardScreen, { EnergyExpenditureCard } from '../AnalyticsDashboardScreen';
import {
  getConsumedMacrosByDay,
  getWeightHistory,
  getUserProfile,
  getAdaptiveTdeeAppliedOn,
  applyAdaptiveCalorieGoal,
} from '../../db/database';
import type { AdaptiveTdeeResult } from '../../nutrition/adaptiveTdee';

const TODAY = '2024-06-30';

const STATS = {
  windowStart: '2024-06-02',
  windowEnd: '2024-06-29',
  loggedDays: 24,
  leftOutDays: 2,
  meanIntake: 2500,
  weighIns: 20,
  slopeKgPerDay: -0.045,
  weightChangeKg: -1.26,
  latestTrendWeight: 80,
  formulaTdee: 2759.2,
};

const ESTIMATE: AdaptiveTdeeResult = { status: 'estimate', estimate: 2200, ...STATS };

function insufficient(
  reason: 'logged_days' | 'weigh_ins' | 'profile' | 'out_of_range',
  progress: { have: number; need: number } | null,
  rawEstimate: number | null = null
): AdaptiveTdeeResult {
  return { status: 'insufficient', reason, progress, rawEstimate, ...STATS };
}

type CardProps = React.ComponentProps<typeof EnergyExpenditureCard>;

function card(over: Partial<CardProps> = {}) {
  const onApply = jest.fn().mockResolvedValue(undefined);
  const utils = render(
    <EnergyExpenditureCard
      result={ESTIMATE}
      currentGoal={2000}
      goalType="maintain"
      appliedOn={null}
      todayISO={TODAY}
      onApply={onApply}
      {...over}
    />
  );
  return { ...utils, onApply };
}

describe('EnergyExpenditureCard', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shows the estimate, the formula TDEE and the inputs', () => {
    const { getByText } = card();
    expect(getByText('Energy expenditure')).toBeTruthy();
    expect(getByText('2200 kcal/day')).toBeTruthy();
    expect(getByText('Formula estimate: 2759 kcal/day')).toBeTruthy();
    expect(getByText('Mean intake: 2500 kcal/day')).toBeTruthy();
    expect(getByText('Logged days: 24 of 28 (2 left out, under 1000 kcal)')).toBeTruthy();
    expect(getByText('Trend weight change (28 days): -1.3 kg')).toBeTruthy();
    expect(getByText('Weigh-ins: 20')).toBeTruthy();
  });

  it('shows a gain with a plus sign', () => {
    const { getByText } = card({ result: { ...ESTIMATE, weightChangeKg: 0.44 } });
    expect(getByText('Trend weight change (28 days): +0.4 kg')).toBeTruthy();
  });

  it.each([
    ['logged_days', { have: 9, need: 14 }, 'Need 14 logged days. You have 9.'],
    ['weigh_ins', { have: 6, need: 10 }, 'Need 10 weigh-ins in the last 28 days. You have 6.'],
    ['profile', null, 'Fill in your profile in Settings to compare with the formula.'],
  ] as const)('explains the %s case and shows no estimate', (reason, progress, text) => {
    const { getByText, queryByText, queryByLabelText } = card({
      result: insufficient(reason, progress),
    });
    expect(getByText('Energy expenditure')).toBeTruthy();
    expect(getByText(text)).toBeTruthy();
    expect(queryByText(/^\d+ kcal\/day$/)).toBeNull();
    expect(queryByLabelText('Apply')).toBeNull();
  });

  it('explains an estimate far from the formula and offers no Apply', () => {
    const { getByText, queryByLabelText } = card({
      result: insufficient('out_of_range', null, 4000),
    });
    expect(
      getByText('Far from the formula estimate. Usually meals are missing from the log.')
    ).toBeTruthy();
    expect(getByText('Formula estimate: 2759 kcal/day')).toBeTruthy();
    expect(queryByLabelText('Apply')).toBeNull();
  });

  it('shows the suggestion next to the current goal', () => {
    const { getByText } = card();
    expect(getByText('Suggested goal 2200 kcal (now 2000)')).toBeTruthy();
  });

  it('asks for confirmation and writes nothing on Cancel', () => {
    const { getByLabelText, onApply } = card();
    fireEvent.press(getByLabelText('Apply'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Change calorie goal?');
    expect(message).toBe('Set your daily goal to 2200 kcal. Protein stays the same.');
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Cancel', 'Apply']);
    expect(onApply).not.toHaveBeenCalled();
    buttons[0].onPress?.();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('calls onApply with the suggestion on confirm', async () => {
    const { getByLabelText, onApply } = card();
    fireEvent.press(getByLabelText('Apply'));
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      await buttons[1].onPress();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(2200);
  });

  it('shows an alert when the apply fails', async () => {
    const onApply = jest.fn().mockRejectedValue(new Error('disk full'));
    const { getByLabelText } = card({ onApply });
    fireEvent.press(getByLabelText('Apply'));
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      await buttons[1].onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls[1][0]).toBe("Couldn't change goal");
  });

  it('keeps the suggestion within 10 % of the current goal', () => {
    const { getByText } = card({ result: { ...ESTIMATE, estimate: 3000 } });
    expect(getByText('Suggested goal 2200 kcal (now 2000)')).toBeTruthy();
  });

  it('hides the button and shows the return date during the wait', () => {
    const { getByText, queryByLabelText } = card({ appliedOn: '2024-06-27' });
    expect(queryByLabelText('Apply')).toBeNull();
    expect(getByText('Apply is available again on 4 Jul 2024')).toBeTruthy();
  });

  it('shows the button again on day 7', () => {
    const { getByLabelText, queryByText } = card({ appliedOn: '2024-06-23' });
    expect(getByLabelText('Apply')).toBeTruthy();
    expect(queryByText(/Apply is available again/)).toBeNull();
  });

  it('shows no button when the suggestion is within 10 kcal of the goal', () => {
    const { queryByLabelText, queryByText } = card({ result: { ...ESTIMATE, estimate: 2010 } });
    expect(queryByLabelText('Apply')).toBeNull();
    expect(queryByText(/Suggested goal/)).toBeNull();
  });

  it('shows the suggestion even when it equals the current goal', () => {
    const { getByText, queryByLabelText } = card({ result: { ...ESTIMATE, estimate: 2000 } });
    expect(getByText('Suggested goal 2000 kcal (now 2000)')).toBeTruthy();
    expect(queryByLabelText('Apply')).toBeNull();
  });

  it('shows the suggestion during the wait without the button', () => {
    const { getByText, queryByLabelText } = card({ appliedOn: '2024-06-27' });
    expect(getByText('Suggested goal 2200 kcal (now 2000)')).toBeTruthy();
    expect(queryByLabelText('Apply')).toBeNull();
  });

  it('shows no suggestion without a goal type', () => {
    const { queryByLabelText, queryByText } = card({ goalType: null });
    expect(queryByLabelText('Apply')).toBeNull();
    expect(queryByText(/Suggested goal/)).toBeNull();
  });

  it('changes nothing just by being viewed', () => {
    const { onApply } = card();
    expect(onApply).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

const addDay = (n: number) => new Date(Date.UTC(2024, 5, 2 + n)).toISOString().slice(0, 10);

describe('AnalyticsDashboardScreen energy expenditure', () => {
  let alertSpy: jest.SpyInstance;

  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });

  async function triggerFocus() {
    await act(async () => {
      latestFocusEffect!();
    });
    await flush();
  }

  beforeEach(() => {
    latestFocusEffect = null;
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const days = Array.from({ length: 28 }, (_, i) => i);
    jest.mocked(getConsumedMacrosByDay).mockReset().mockResolvedValue(
      days.map((i) => ({
        date: addDay(i),
        calories: 2500,
        protein: 150,
        carbs: 250,
        fat: 80,
        mealCount: 3,
      })) as never
    );
    jest.mocked(getWeightHistory).mockReset().mockResolvedValue(
      days.map((i) => ({ date: addDay(i), weight: 80 })) as never
    );
    jest.mocked(getUserProfile).mockReset().mockResolvedValue({
      heightCm: 180,
      age: 30,
      sex: 'male',
      activityLevel: 'moderate',
      goalType: 'maintain',
    });
    jest.mocked(getAdaptiveTdeeAppliedOn).mockReset().mockResolvedValue(null);
    jest.mocked(applyAdaptiveCalorieGoal).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shows the card first in the Nutrition section from the loaded data', async () => {
    const utils = render(<AnalyticsDashboardScreen />);
    await triggerFocus();

    expect(utils.getByText('Energy expenditure')).toBeTruthy();
    expect(utils.getByText('Mean intake: 2500 kcal/day')).toBeTruthy();
    expect(utils.getByText('Suggested goal 2200 kcal (now 2000)')).toBeTruthy();

    const texts = utils.UNSAFE_getAllByType(Text).map((n) => String(n.props.children));
    const divider = texts.indexOf('Nutrition');
    const energy = texts.indexOf('Energy expenditure');
    const adherence = texts.indexOf('Nutrition adherence');
    expect(divider).toBeGreaterThan(-1);
    expect(energy).toBeGreaterThan(divider);
    expect(adherence).toBeGreaterThan(energy);
  });

  it('applies through the database and reloads', async () => {
    const utils = render(<AnalyticsDashboardScreen />);
    await triggerFocus();

    fireEvent.press(utils.getByLabelText('Apply'));
    const buttons = alertSpy.mock.calls[0][2];
    jest.mocked(getAdaptiveTdeeAppliedOn).mockResolvedValue('2024-06-30');
    await act(async () => {
      await buttons[1].onPress();
    });
    await flush();

    expect(applyAdaptiveCalorieGoal).toHaveBeenCalledWith(2200, '2024-06-30');
    expect(utils.queryByLabelText('Apply')).toBeNull();
    expect(utils.getByText('Apply is available again on 7 Jul 2024')).toBeTruthy();
  });

  it('a failed refresh after a successful apply shows the load banner and not the failed-apply alert', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const utils = render(<AnalyticsDashboardScreen />);
    await triggerFocus();

    fireEvent.press(utils.getByLabelText('Apply'));
    const buttons = alertSpy.mock.calls[0][2];
    jest.mocked(getConsumedMacrosByDay).mockRejectedValue(new Error('boom'));
    await act(async () => {
      await buttons[1].onPress();
    });
    await flush();

    expect(applyAdaptiveCalorieGoal).toHaveBeenCalledWith(2200, '2024-06-30');
    expect(utils.getByText("Couldn't refresh. Showing the last loaded data.")).toBeTruthy();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('names the missing input when there is too little data', async () => {
    jest.mocked(getConsumedMacrosByDay).mockResolvedValue([] as never);
    const utils = render(<AnalyticsDashboardScreen />);
    await triggerFocus();
    expect(utils.getByText('Need 14 logged days. You have 0.')).toBeTruthy();
  });
});
