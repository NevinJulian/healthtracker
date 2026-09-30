/**
 * OnboardingScreen.test.tsx
 *
 * Smoke-level tests for the OnboardingScreen component and database profile
 * accessor shapes. Consistent with the repo's existing jest style (no rendering,
 * no DB, static imports only — dynamic import() is blocked in this Jest config).
 *
 * Issue #281 — Personalized nutrition goals + onboarding flow.
 */

import OnboardingScreen from '../OnboardingScreen';
import {
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
