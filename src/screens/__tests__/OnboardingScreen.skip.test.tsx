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
import { setOnboardingComplete } from '../../db/database';

describe('OnboardingScreen skip', () => {
  const mockSetOnboardingComplete = jest.mocked(setOnboardingComplete);
  let alertSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSetOnboardingComplete.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  async function press(utils: ReturnType<typeof render>, label: string) {
    await act(async () => {
      fireEvent.press(utils.getByLabelText(label));
    });
  }

  function goToStep3(utils: ReturnType<typeof render>) {
    fireEvent.press(utils.getByLabelText('Male'));
    fireEvent.changeText(utils.getByLabelText('Height in centimetres'), '180');
    fireEvent.changeText(utils.getByLabelText('Age in years'), '30');
    fireEvent.press(utils.getByLabelText('Continue to step 2'));
    fireEvent.press(utils.getByLabelText('Moderate: Exercise 3–5 days/week'));
    fireEvent.press(utils.getByLabelText('Maintain: Eat at your TDEE'));
    fireEvent.press(utils.getByLabelText('Continue to step 3'));
  }

  const cases: Array<[string, string, (utils: ReturnType<typeof render>) => void]> = [
    ['step 1', 'Skip onboarding', () => undefined],
    ['step 3', 'Skip and use default goals', goToStep3],
  ];

  it.each(cases)('alerts and stays open when skipping fails on %s', async (_name, label, advance) => {
    let rejectSkip: (reason: Error) => void = () => undefined;
    mockSetOnboardingComplete.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectSkip = reject;
      })
    );
    const onComplete = jest.fn();
    const utils = render(<OnboardingScreen onComplete={onComplete} />);
    advance(utils);
    const isDisabled = () => utils.getByLabelText(label).props.accessibilityState?.disabled;

    await press(utils, label);
    expect(isDisabled()).toBe(true);

    await act(async () => {
      rejectSkip(new Error('disk full'));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(isDisabled()).toBeFalsy();
  });

  it.each(cases)('completes onboarding without an alert when skipping succeeds on %s', async (_name, label, advance) => {
    const onComplete = jest.fn();
    const utils = render(<OnboardingScreen onComplete={onComplete} />);
    advance(utils);

    await press(utils, label);

    expect(mockSetOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
