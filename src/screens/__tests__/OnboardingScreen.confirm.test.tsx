import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../db/database', () => ({
  getUserProfile: jest.fn().mockResolvedValue({}),
  setProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  setProfileAge: jest.fn().mockResolvedValue(undefined),
  setProfileSex: jest.fn().mockResolvedValue(undefined),
  setProfileActivityLevel: jest.fn().mockResolvedValue(undefined),
  setProfileGoalType: jest.fn().mockResolvedValue(undefined),
  getOnboardingComplete: jest.fn().mockResolvedValue(false),
  setOnboardingComplete: jest.fn().mockResolvedValue(undefined),
  getLatestBodyWeight: jest.fn().mockResolvedValue(null),
  setNutritionGoalCalories: jest.fn().mockResolvedValue(undefined),
  setNutritionGoalProtein: jest.fn().mockResolvedValue(undefined),
  upsertBodyWeight: jest.fn().mockResolvedValue(undefined),
  toISODate: jest.fn(() => '2026-01-15'),
}));

import OnboardingScreen from '../OnboardingScreen';
import { upsertBodyWeight, setOnboardingComplete } from '../../db/database';

describe('OnboardingScreen confirm', () => {
  const mockUpsertBodyWeight = jest.mocked(upsertBodyWeight);
  const mockSetOnboardingComplete = jest.mocked(setOnboardingComplete);
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertBodyWeight.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function renderAtStep3(onComplete: () => void) {
    const utils = render(<OnboardingScreen onComplete={onComplete} />);
    fireEvent.press(utils.getByLabelText('Male'));
    fireEvent.changeText(utils.getByLabelText('Height in centimetres'), '180');
    fireEvent.changeText(utils.getByLabelText('Age in years'), '30');
    fireEvent.press(utils.getByLabelText('Continue to step 2'));
    fireEvent.press(utils.getByLabelText('Moderate: Exercise 3–5 days/week'));
    fireEvent.press(utils.getByLabelText('Maintain: Eat at your TDEE'));
    fireEvent.press(utils.getByLabelText('Continue to step 3'));
    fireEvent.changeText(utils.getByLabelText('Body weight in kilograms'), '80');
    return utils;
  }

  async function pressGetStarted(utils: ReturnType<typeof render>) {
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Confirm and get started'));
    });
  }

  it('alerts and stays open when saving the body weight fails', async () => {
    let rejectUpsert: (reason: Error) => void = () => undefined;
    mockUpsertBodyWeight.mockReturnValue(
      new Promise<void>((_, reject) => {
        rejectUpsert = reject;
      })
    );
    const onComplete = jest.fn();
    const utils = renderAtStep3(onComplete);
    const isDisabled = () =>
      utils.getByLabelText('Confirm and get started').props.accessibilityState?.disabled;

    await pressGetStarted(utils);
    expect(isDisabled()).toBe(true);

    await act(async () => {
      rejectUpsert(new Error('disk full'));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(mockSetOnboardingComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(isDisabled()).toBeFalsy();
    expect(utils.getByText('Get started')).toBeTruthy();
  });

  it('completes onboarding without an alert on success', async () => {
    const onComplete = jest.fn();
    const utils = renderAtStep3(onComplete);

    await pressGetStarted(utils);

    expect(mockSetOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
