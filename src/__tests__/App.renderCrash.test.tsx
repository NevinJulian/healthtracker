import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

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
jest.mock('../services/backup', () => ({
  runAutoBackupIfDue: jest.fn(() => Promise.resolve()),
  listAutoBackups: jest.fn(() => Promise.resolve([])),
  shareFile: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../db/devStress369', () => ({ installStress369: jest.fn() }));
jest.mock('../services/notifications', () => ({
  configureNotificationHandler: jest.fn(),
  ensureAndroidChannel: jest.fn(() => Promise.resolve()),
  reconcileScheduledNotifications: jest.fn(() => Promise.resolve()),
}));

const mockNavigator = { crash: true, mounts: 0 };
jest.mock('../navigation/AppNavigator', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    default: () => {
      if (mockNavigator.crash) throw new Error('screen exploded');
      R.useEffect(() => {
        mockNavigator.mounts += 1;
      }, []);
      return <T>NAVIGATOR</T>;
    },
  };
});
jest.mock('../screens/OnboardingScreen', () => {
  const { Text: T } = require('react-native');
  return { __esModule: true, default: () => <T>ONBOARDING</T> };
});

import { useFonts } from 'expo-font';
import { initDatabase, getOnboardingComplete, getLatestBodyWeight } from '../db/database';
import { exportRawDatabase, hasRescueWal } from '../services/rescueExport';
import { listAutoBackups, shareFile } from '../services/backup';
import App from '../../App';
import { COLD_RENDER_WAIT } from '../testUtils/coldRenderWait';

const rescue = exportRawDatabase as jest.Mock;
const walPresent = hasRescueWal as jest.Mock;
const listBackups = listAutoBackups as jest.Mock;
const share = shareFile as jest.Mock;

const NEWEST_BACKUP = {
  name: 'healthtracker-auto-20261008T140300Z.json',
  uri: 'file:///document/auto-backups/healthtracker-auto-20261008T140300Z.json',
  createdAt: new Date('2026-10-08T14:03:00.000Z'),
  sizeBytes: 2048,
};
const OLDER_BACKUP = {
  name: 'healthtracker-auto-20261007T090500Z.json',
  uri: 'file:///document/auto-backups/healthtracker-auto-20261007T090500Z.json',
  createdAt: new Date('2026-10-07T09:05:00.000Z'),
  sizeBytes: 500,
};

let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigator.crash = true;
  mockNavigator.mounts = 0;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  (useFonts as jest.Mock).mockReturnValue([true, null]);
  (initDatabase as jest.Mock).mockReset().mockResolvedValue(undefined);
  walPresent.mockResolvedValue(false);
  listBackups.mockReset().mockResolvedValue([]);
  share.mockReset().mockResolvedValue(true);
  (getOnboardingComplete as jest.Mock).mockResolvedValue(true);
  (getLatestBodyWeight as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('App render crash screen', () => {
  it('shows the error, Retry and Save data when the navigator throws while rendering', async () => {
    render(<App />);
    expect(await screen.findByText(/screen exploded/, undefined, COLD_RENDER_WAIT)).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save data' })).toBeTruthy();
  });

  it('states there is no reset and offers exactly two actions', async () => {
    render(<App />);
    await screen.findByText(/screen exploded/, undefined, COLD_RENDER_WAIT);
    expect(
      screen.getByText(
        "Clearing the app's storage in Android settings deletes all your data, so there is no reset button here.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /reset|delete|clear/i })).toBeNull();
  });

  it('mounts the navigator afresh on Retry once it no longer throws', async () => {
    render(<App />);
    const retryButton = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    mockNavigator.crash = false;
    expect(mockNavigator.mounts).toBe(0);
    fireEvent.press(retryButton);
    expect(await screen.findByText('NAVIGATOR')).toBeTruthy();
    expect(mockNavigator.mounts).toBe(1);
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('shows the recovery screen again when Retry throws again', async () => {
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT));
    expect(await screen.findByText(/screen exploded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('exports the raw database once when Save data is pressed', async () => {
    rescue.mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }, COLD_RENDER_WAIT));
    await waitFor(() => expect(rescue).toHaveBeenCalledTimes(1));
  });

  it('shows the message when Save data fails', async () => {
    rescue.mockRejectedValueOnce(new Error('The database file was not found on this device.'));
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }, COLD_RENDER_WAIT));
    expect(await screen.findByText(/database file was not found/)).toBeTruthy();
  });

  it('tells the user to keep both files when a wal exists', async () => {
    walPresent.mockResolvedValue(true);
    render(<App />);
    expect(
      await screen.findByText('Saving shares two files. Keep both.', undefined, COLD_RENDER_WAIT),
    ).toBeTruthy();
  });

  it('offers Share latest backup when an automatic backup exists, and shares the newest one', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP, OLDER_BACKUP]);
    render(<App />);

    fireEvent.press(
      await screen.findByRole('button', { name: 'Share latest backup' }, COLD_RENDER_WAIT),
    );

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(NEWEST_BACKUP.uri, 'Save your HealthTracker backup');
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(rescue).not.toHaveBeenCalled();
  });

  it('offers no Share latest backup when there is no automatic backup', async () => {
    render(<App />);
    await screen.findByText(/screen exploded/, undefined, COLD_RENDER_WAIT);
    await waitFor(() => expect(listBackups).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: 'Share latest backup' })).toBeNull();
  });

  it('shows the message when sharing the latest backup fails', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP]);
    share.mockRejectedValue(new Error('file vanished'));
    render(<App />);

    fireEvent.press(
      await screen.findByRole('button', { name: 'Share latest backup' }, COLD_RENDER_WAIT),
    );

    expect(await screen.findByText('file vanished')).toBeTruthy();
  });
});
