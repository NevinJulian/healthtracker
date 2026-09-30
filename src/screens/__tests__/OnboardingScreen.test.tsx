/**
 * OnboardingScreen.test.tsx
 *
 * Smoke-level tests for the OnboardingScreen component and database profile
 * accessor shapes. Consistent with the repo's existing jest style (no rendering,
 * no DB, static imports only — dynamic import() is blocked in this Jest config).
 *
 * Issue #281 — Personalized nutrition goals + onboarding flow.
 */

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
import {
  upsertBodyWeight,
  getUserProfile,
  setProfileHeightCm,
  setProfileAge,
  setProfileSex,
  setProfileActivityLevel,
  setProfileGoalType,
  getOnboardingComplete,
  setOnboardingComplete,
  getLatestBodyWeight,
} from '../../db/database';

// ─── Component export ─────────────────────────────────────────────────────────

describe('OnboardingScreen', () => {
  it('is a valid React component (function)', () => {
    expect(typeof OnboardingScreen).toBe('function');
  });
});

// ─── Profile accessor exports from database.ts ────────────────────────────────

describe('database profile accessors', () => {
  it('getUserProfile is exported as a function', () => {
    expect(typeof getUserProfile).toBe('function');
  });

  it('setProfileHeightCm is exported as a function', () => {
    expect(typeof setProfileHeightCm).toBe('function');
  });

  it('setProfileAge is exported as a function', () => {
    expect(typeof setProfileAge).toBe('function');
  });

  it('setProfileSex is exported as a function', () => {
    expect(typeof setProfileSex).toBe('function');
  });

  it('setProfileActivityLevel is exported as a function', () => {
    expect(typeof setProfileActivityLevel).toBe('function');
  });

  it('setProfileGoalType is exported as a function', () => {
    expect(typeof setProfileGoalType).toBe('function');
  });

  it('getOnboardingComplete is exported as a function', () => {
    expect(typeof getOnboardingComplete).toBe('function');
  });

  it('setOnboardingComplete is exported as a function', () => {
    expect(typeof setOnboardingComplete).toBe('function');
  });

  it('getLatestBodyWeight is exported as a function', () => {
    expect(typeof getLatestBodyWeight).toBe('function');
  });
});

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
    mockUpsertBodyWeight.mockRejectedValue(new Error('disk full'));
    const onComplete = jest.fn();
    const utils = renderAtStep3(onComplete);

    await pressGetStarted(utils);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Error');
    expect(mockSetOnboardingComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      utils.getByLabelText('Confirm and get started').props.accessibilityState?.disabled
    ).toBeFalsy();
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
