import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
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
jest.mock('../services/rescueExport', () => ({
  exportRawDatabase: jest.fn(),
  hasRescueWal: jest.fn(() => Promise.resolve(false)),
  clearRescueCopies: jest.fn(() => Promise.resolve()),
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
import { exportRawDatabase } from '../services/rescueExport';
import App from '../../App';

const rescue = exportRawDatabase as jest.Mock;

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
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('re-runs init on Retry and renders the navigator once it succeeds', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('NAVIGATOR')).toBeTruthy();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('keeps the failure screen when Retry fails again', async () => {
    init.mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/second/)).toBeTruthy();
  });

  it('exports the raw database when Save data is pressed', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    rescue.mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }));
    await waitFor(() => expect(rescue).toHaveBeenCalledTimes(1));
  });

  it('starts one init for two Retry presses in the same tick', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValue(undefined);
    render(<App />);
    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    await act(async () => {
      fireEvent.press(retryButton);
      fireEvent.press(retryButton);
    });
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('waits for a pending init before exporting on a font error', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('font failed')]);
    let finishInit: () => void = () => {};
    init.mockReturnValue(new Promise<void>((resolve) => { finishInit = resolve; }));
    rescue.mockResolvedValue(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }));
    await act(async () => {});
    expect(rescue).not.toHaveBeenCalled();
    await act(async () => { finishInit(); });
    await waitFor(() => expect(rescue).toHaveBeenCalledTimes(1));
  });

  it('shows a message when Save data fails', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    rescue.mockRejectedValueOnce(new Error('The database file was not found on this device.'));
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }));
    expect(await screen.findByText(/database file was not found/)).toBeTruthy();
  });

  it('states there is no reset and offers no reset, delete or clear action', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.getByText(
        "Clearing the app's storage in Android settings deletes all your data, so there is no reset button here.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /reset|delete|clear/i })).toBeNull();
  });

  it('hides Retry but keeps Save data on a font load error', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('font failed')]);
    init.mockResolvedValue(undefined);
    render(<App />);
    expect(await screen.findByText(/font failed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save data' })).toBeTruthy();
  });
});
