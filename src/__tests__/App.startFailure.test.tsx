import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('@expo-google-fonts/fraunces', () => ({ Fraunces_600SemiBold: 'Fraunces_600SemiBold' }));
jest.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  PlusJakartaSans_500Medium: 'a',
  PlusJakartaSans_600SemiBold: 'b',
  PlusJakartaSans_700Bold: 'c',
}));
jest.mock('../db/database', () => ({
  initDatabase: jest.fn(),
  getOnboardingComplete: jest.fn(),
  getLatestBodyWeight: jest.fn(),
}));
jest.mock('../db/devStress369', () => ({ installStress369: jest.fn() }));
jest.mock('../services/notifications', () => ({
  configureNotificationHandler: jest.fn(),
  ensureAndroidChannel: jest.fn(() => Promise.resolve()),
  reconcileScheduledNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('../navigation/AppNavigator', () => {
  const { Text: T } = require('react-native');
  return { __esModule: true, default: () => <T>NAVIGATOR</T> };
});
jest.mock('../screens/OnboardingScreen', () => {
  const { Text: T } = require('react-native');
  return { __esModule: true, default: () => <T>ONBOARDING</T> };
});

import { useFonts } from 'expo-font';
import { initDatabase, getOnboardingComplete, getLatestBodyWeight } from '../db/database';
import App from '../../App';

const init = initDatabase as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  init.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (useFonts as jest.Mock).mockReturnValue([true, null]);
  (getOnboardingComplete as jest.Mock).mockResolvedValue(true);
  (getLatestBodyWeight as jest.Mock).mockResolvedValue(null);
});

describe('App start failure screen', () => {
  it('shows the error and a Retry button when init rejects', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    expect(await screen.findByText(/disk exploded/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('re-runs init on Retry and renders the navigator once it succeeds', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByText('Retry'));
    expect(await screen.findByText('NAVIGATOR')).toBeTruthy();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('keeps the failure screen when Retry fails again', async () => {
    init.mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    render(<App />);
    fireEvent.press(await screen.findByText('Retry'));
    expect(await screen.findByText(/second/)).toBeTruthy();
  });
});
