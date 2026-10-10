import React from 'react';
import { AppState, ScrollView } from 'react-native';
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
import { clearRescueCopies, exportRawDatabase, hasRescueWal } from '../services/rescueExport';
import { listAutoBackups, runAutoBackupIfDue, shareFile } from '../services/backup';
import App from '../../App';
import { COLD_RENDER_WAIT } from '../testUtils/coldRenderWait';

const autoBackup = runAutoBackupIfDue as jest.Mock;
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
const LATEST_BACKUP_NOTICE =
  'Share latest backup shares your newest automatic backup. It is the file that Restore from backup in Settings reads after a reinstall.';
const rescue = exportRawDatabase as jest.Mock;
const walPresent = hasRescueWal as jest.Mock;
const clearCopies = clearRescueCopies as jest.Mock;

const init = initDatabase as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  init.mockReset();
  autoBackup.mockReset().mockResolvedValue(undefined);
  listBackups.mockReset().mockResolvedValue([]);
  share.mockReset().mockResolvedValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (useFonts as jest.Mock).mockReturnValue([true, null]);
  walPresent.mockResolvedValue(false);
  (getOnboardingComplete as jest.Mock).mockResolvedValue(true);
  (getLatestBodyWeight as jest.Mock).mockResolvedValue(null);
});

describe('App start failure screen', () => {
  it('shows the error and a Retry button when init rejects', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    expect(await screen.findByText(/disk exploded/, undefined, COLD_RENDER_WAIT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('re-runs init on Retry and renders the navigator once it succeeds', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT));
    expect(await screen.findByText('NAVIGATOR')).toBeTruthy();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it('keeps the failure screen when Retry fails again', async () => {
    init.mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT));
    expect(await screen.findByText(/second/)).toBeTruthy();
  });

  it('exports the raw database when Save data is pressed', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    rescue.mockResolvedValueOnce(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }, COLD_RENDER_WAIT));
    await waitFor(() => expect(rescue).toHaveBeenCalledTimes(1));
  });

  it('starts one init for two Retry presses in the same tick', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValue(undefined);
    render(<App />);
    const retryButton = await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
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
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }, COLD_RENDER_WAIT));
    await act(async () => {});
    expect(rescue).not.toHaveBeenCalled();
    await act(async () => { finishInit(); });
    await waitFor(() => expect(rescue).toHaveBeenCalledTimes(1));
  });

  it('renders the failure screen inside a ScrollView', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    expect(screen.UNSAFE_getByType(ScrollView)).toBeTruthy();
  });

  it('clears rescue copies once on mount and not again on Retry', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValue(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT));
    await screen.findByText('NAVIGATOR');
    expect(clearCopies).toHaveBeenCalledTimes(1);
  });

  it('survives clearRescueCopies rejecting', async () => {
    clearCopies.mockRejectedValueOnce(new Error('cache gone'));
    init.mockResolvedValue(undefined);
    render(<App />);
    expect(await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT)).toBeTruthy();
  });

  it('tells the user to keep both files when a wal exists', async () => {
    walPresent.mockResolvedValue(true);
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    expect(await screen.findByText('Saving shares two files. Keep both.', undefined, COLD_RENDER_WAIT)).toBeTruthy();
  });

  it('omits the two-files sentence when there is no wal', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    await waitFor(() => expect(walPresent).toHaveBeenCalled());
    expect(screen.queryByText('Saving shares two files. Keep both.')).toBeNull();
  });

  it('shows a message when Save data fails', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    rescue.mockRejectedValueOnce(new Error('The database file was not found on this device.'));
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Save data' }, COLD_RENDER_WAIT));
    expect(await screen.findByText(/database file was not found/)).toBeTruthy();
  });

  it('states there is no reset and offers no reset, delete or clear action', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
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
    expect(await screen.findByText(/font failed/, undefined, COLD_RENDER_WAIT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save data' })).toBeTruthy();
  });
});

describe('App start failure screen latest backup', () => {
  const SHARE_LATEST = { name: 'Share latest backup' };

  async function renderFailed() {
    init.mockRejectedValueOnce(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    await waitFor(() => expect(listBackups).toHaveBeenCalled());
    await act(async () => {});
  }

  it('offers Share latest backup next to Retry and Save data when an automatic backup exists', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP, OLDER_BACKUP]);
    await renderFailed();

    expect(screen.getByRole('button', SHARE_LATEST)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByText(LATEST_BACKUP_NOTICE)).toBeTruthy();
  });

  it('shares the newest automatic backup as a backup file', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP, OLDER_BACKUP]);
    await renderFailed();

    fireEvent.press(screen.getByRole('button', SHARE_LATEST));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(NEWEST_BACKUP.uri, 'Save your HealthTracker backup');
    expect(rescue).not.toHaveBeenCalled();
  });

  it('shares a backup that was written after the screen appeared', async () => {
    listBackups.mockResolvedValue([OLDER_BACKUP]);
    await renderFailed();
    listBackups.mockResolvedValue([NEWEST_BACKUP, OLDER_BACKUP]);

    fireEvent.press(screen.getByRole('button', SHARE_LATEST));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith(NEWEST_BACKUP.uri, 'Save your HealthTracker backup');
  });

  it('offers no Share latest backup and no sentence about it when there is no automatic backup', async () => {
    await renderFailed();

    expect(screen.queryByRole('button', SHARE_LATEST)).toBeNull();
    expect(screen.queryByText(LATEST_BACKUP_NOTICE)).toBeNull();
  });

  it('offers no Share latest backup when the backups cannot be listed', async () => {
    listBackups.mockRejectedValue(new Error('unreadable'));
    await renderFailed();

    expect(screen.queryByRole('button', SHARE_LATEST)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save data' })).toBeTruthy();
  });

  it('shows a message when sharing is unavailable', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP]);
    share.mockResolvedValue(false);
    await renderFailed();

    fireEvent.press(screen.getByRole('button', SHARE_LATEST));

    expect(await screen.findByText('Sharing is not available on this device.')).toBeTruthy();
  });

  it('shows a message when sharing the backup fails', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP]);
    share.mockRejectedValue(new Error('file vanished'));
    await renderFailed();

    fireEvent.press(screen.getByRole('button', SHARE_LATEST));

    expect(await screen.findByText('file vanished')).toBeTruthy();
  });

  it('shows a message when the backup has gone by the time the button is pressed', async () => {
    listBackups.mockResolvedValue([NEWEST_BACKUP]);
    await renderFailed();
    listBackups.mockResolvedValue([]);

    fireEvent.press(screen.getByRole('button', SHARE_LATEST));

    expect(await screen.findByText('No automatic backup was found on this device.')).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
  });

  it('shares the backup on a font load error without waiting for a pending init', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('font failed')]);
    init.mockReturnValue(new Promise<void>(() => {}));
    listBackups.mockResolvedValue([NEWEST_BACKUP]);
    render(<App />);

    fireEvent.press(await screen.findByRole('button', SHARE_LATEST, COLD_RENDER_WAIT));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  });
});

describe('App automatic backup', () => {
  it('starts one automatic backup once the app has started', async () => {
    init.mockResolvedValue(undefined);
    render(<App />);
    expect(await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT)).toBeTruthy();
    await waitFor(() => expect(autoBackup).toHaveBeenCalledTimes(1));
  });

  it('shows the navigator while the automatic backup never finishes', async () => {
    init.mockResolvedValue(undefined);
    autoBackup.mockReturnValue(new Promise<void>(() => {}));
    render(<App />);
    expect(await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT)).toBeTruthy();
    await waitFor(() => expect(autoBackup).toHaveBeenCalledTimes(1));
  });

  it('shows no recovery screen and logs when the automatic backup rejects', async () => {
    init.mockResolvedValue(undefined);
    autoBackup.mockRejectedValue(new Error('disk full'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(<App />);
    expect(await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT)).toBeTruthy();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save data' })).toBeNull();
  });

  it('does not start one when the database fails to initialise', async () => {
    init.mockRejectedValue(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);
    await act(async () => {});
    expect(autoBackup).not.toHaveBeenCalled();
  });

  it('does not start one on a font load error', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('font failed')]);
    init.mockResolvedValue(undefined);
    render(<App />);
    await screen.findByText(/font failed/, undefined, COLD_RENDER_WAIT);
    await act(async () => {});
    expect(autoBackup).not.toHaveBeenCalled();
  });

  it('starts one only after a failed start is retried successfully', async () => {
    init.mockRejectedValueOnce(new Error('disk exploded')).mockResolvedValue(undefined);
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT));
    await screen.findByText('NAVIGATOR');
    await waitFor(() => expect(autoBackup).toHaveBeenCalledTimes(1));
  });
});

describe('App automatic backup when the app returns to the foreground', () => {
  const addListener = jest.mocked(AppState.addEventListener);

  // Calls every 'change' listener whose subscription has not been removed.
  async function emitAppState(state: string) {
    await act(async () => {
      addListener.mock.calls.forEach(([type, handler], index) => {
        const subscription = addListener.mock.results[index]?.value as { remove: jest.Mock };
        if (type !== 'change' || subscription.remove.mock.calls.length > 0) return;
        (handler as (next: string) => void)(state);
      });
    });
  }

  async function renderStarted() {
    init.mockResolvedValue(undefined);
    const view = render(<App />);
    await screen.findByText('NAVIGATOR', undefined, COLD_RENDER_WAIT);
    await waitFor(() => expect(autoBackup).toHaveBeenCalledTimes(1));
    return view;
  }

  it('checks again every time the app becomes active', async () => {
    await renderStarted();

    await emitAppState('active');
    expect(autoBackup).toHaveBeenCalledTimes(2);

    await emitAppState('background');
    await emitAppState('active');
    expect(autoBackup).toHaveBeenCalledTimes(3);
  });

  it('does not check when the app goes to the background or becomes inactive', async () => {
    await renderStarted();

    await emitAppState('inactive');
    await emitAppState('background');

    expect(autoBackup).toHaveBeenCalledTimes(1);
  });

  it('shows no recovery screen and logs when a foreground check rejects', async () => {
    await renderStarted();
    autoBackup.mockRejectedValue(new Error('disk full'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await emitAppState('active');

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[App] Auto-backup failed:', expect.any(Error)));
    expect(screen.getByText('NAVIGATOR')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save data' })).toBeNull();
  });

  it('does not check when the database failed to initialise', async () => {
    init.mockRejectedValue(new Error('disk exploded'));
    render(<App />);
    await screen.findByRole('button', { name: 'Retry' }, COLD_RENDER_WAIT);

    await emitAppState('active');

    expect(autoBackup).not.toHaveBeenCalled();
  });

  it('does not check on a font load error', async () => {
    (useFonts as jest.Mock).mockReturnValue([false, new Error('font failed')]);
    init.mockResolvedValue(undefined);
    render(<App />);
    await screen.findByText(/font failed/, undefined, COLD_RENDER_WAIT);

    await emitAppState('active');

    expect(autoBackup).not.toHaveBeenCalled();
  });

  it('stops checking once the app is unmounted', async () => {
    const { unmount } = await renderStarted();

    unmount();
    await emitAppState('active');

    expect(autoBackup).toHaveBeenCalledTimes(1);
  });
});
