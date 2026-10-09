import React from 'react';
import { Alert } from 'react-native';
import { render, screen, act, fireEvent } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn().mockResolvedValue(false),
  getWorkoutReminderTime: jest.fn().mockResolvedValue('09:15'),
  setWorkoutReminderEnabled: jest.fn().mockResolvedValue(undefined),
  setWorkoutReminderTime: jest.fn().mockResolvedValue(undefined),
  getCookWhenEmptyEnabled: jest.fn().mockResolvedValue(false),
  setCookWhenEmptyEnabled: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDayEnabled: jest.fn().mockResolvedValue(false),
  setWeeklyCookDayEnabled: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDay: jest.fn().mockResolvedValue(0),
  setWeeklyCookDay: jest.fn().mockResolvedValue(undefined),
  getWeeklyCookDayTime: jest.fn().mockResolvedValue('10:00'),
  setWeeklyCookDayTime: jest.fn().mockResolvedValue(undefined),
  getMealReminderEnabled: jest.fn().mockResolvedValue(false),
  getMealReminderTime: jest.fn().mockResolvedValue('08:00'),
  setMealReminderEnabled: jest.fn().mockResolvedValue(undefined),
  setMealReminderTime: jest.fn().mockResolvedValue(undefined),
  getBackupReminderEnabled: jest.fn().mockResolvedValue(false),
  setBackupReminderEnabled: jest.fn().mockResolvedValue(undefined),
  getBackupReminderDay: jest.fn().mockResolvedValue(0),
  setBackupReminderDay: jest.fn().mockResolvedValue(undefined),
  getBackupReminderTime: jest.fn().mockResolvedValue('18:00'),
  setBackupReminderTime: jest.fn().mockResolvedValue(undefined),
  getNutritionGoals: jest.fn().mockResolvedValue({ calories: 1800, protein: 150 }),
  setNutritionGoalCalories: jest.fn().mockResolvedValue(undefined),
  setNutritionGoalProtein: jest.fn().mockResolvedValue(undefined),
  setNutritionGoals: jest.fn().mockResolvedValue(undefined),
  getUserProfile: jest.fn().mockResolvedValue({
    heightCm: null,
    age: null,
    sex: null,
    activityLevel: null,
    goalType: null,
  }),
  setProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  setProfileAge: jest.fn().mockResolvedValue(undefined),
  clearProfileHeightCm: jest.fn().mockResolvedValue(undefined),
  clearProfileAge: jest.fn().mockResolvedValue(undefined),
  setProfileSex: jest.fn().mockResolvedValue(undefined),
  setProfileActivityLevel: jest.fn().mockResolvedValue(undefined),
  setProfileGoalType: jest.fn().mockResolvedValue(undefined),
  getLatestBodyWeight: jest.fn().mockResolvedValue(null),
  getHydrationGoal: jest.fn().mockResolvedValue(2000),
  setHydrationGoal: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notifications', () => ({
  ...jest.requireActual('../../services/notifications'),
  ensurePermissions: jest.fn().mockResolvedValue(true),
  reconcileScheduledNotifications: jest.fn().mockResolvedValue(undefined),
  scheduleMealReminder: jest.fn().mockResolvedValue(undefined),
  cancelMealReminder: jest.fn().mockResolvedValue(undefined),
  scheduleBackupReminder: jest.fn().mockResolvedValue(undefined),
  cancelBackupReminder: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/backup', () => ({
  exportBackup: jest.fn(),
  importBackup: jest.fn(),
  shareFile: jest.fn(),
  listAutoBackups: jest.fn(),
  restoreBackupFromUri: jest.fn(),
}));

import SettingsScreen from '../SettingsScreen';
import {
  exportBackup,
  listAutoBackups,
  shareFile,
  type AutoBackupEntry,
} from '../../services/backup';

const mockList = jest.mocked(listAutoBackups);
const mockShare = jest.mocked(shareFile);

function entry(iso: string, sizeBytes: number): AutoBackupEntry {
  const createdAt = new Date(iso);
  const name = `healthtracker-auto-${iso.replace(/[-:]/g, '').replace('.000', '')}.json`;
  return { name, uri: `file:///document/auto-backups/${name}`, createdAt, sizeBytes };
}

const NEWER = entry('2026-10-08T14:03:00.000Z', 2048);
const OLDER = entry('2026-10-07T09:05:00.000Z', 500);

async function renderSettings() {
  render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockReset().mockResolvedValue([]);
});

describe('SettingsScreen automatic backups list', () => {
  it('explains what automatic backups are', async () => {
    await renderSettings();

    expect(screen.getByText('Automatic backups')).toBeTruthy();
    expect(
      screen.getByText('Saved on this device once a day when you open the app. The newest 7 are kept.')
    ).toBeTruthy();
  });

  it('lists each backup newest first with its date, time and size', async () => {
    mockList.mockResolvedValue([NEWER, OLDER]);
    await renderSettings();

    const titles = screen.getAllByText(/^\d{1,2} \w{3} 2026, \d{2}:\d{2}$/);
    expect(titles.map((node) => node.props.children)).toEqual([
      '8 Oct 2026, 14:03',
      '7 Oct 2026, 09:05',
    ]);
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByText('500 B')).toBeTruthy();
  });

  it('formats megabyte sizes with one decimal', async () => {
    mockList.mockResolvedValue([entry('2026-10-08T14:03:00.000Z', 1.5 * 1024 * 1024)]);
    await renderSettings();

    expect(screen.getByText('1.5 MB')).toBeTruthy();
  });

  it('gives every backup a labelled Share and Restore button', async () => {
    mockList.mockResolvedValue([NEWER, OLDER]);
    await renderSettings();

    expect(
      screen.getByRole('button', { name: 'Share automatic backup 8 Oct 2026, 14:03' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Restore automatic backup 8 Oct 2026, 14:03' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Share automatic backup 7 Oct 2026, 09:05' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Restore automatic backup 7 Oct 2026, 09:05' })
    ).toBeTruthy();
  });

  it('says so when there are none yet', async () => {
    await renderSettings();

    expect(
      screen.getByText('No automatic backups yet. The first one is saved the next time you open the app.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Share automatic backup/ })).toBeNull();
  });

  it('says so when the list cannot be read, and shows no empty message', async () => {
    mockList.mockRejectedValue(new Error('no folder'));
    await renderSettings();

    expect(screen.getByText('Could not read the automatic backups.')).toBeTruthy();
    expect(screen.queryByText(/No automatic backups yet/)).toBeNull();
  });

  it('disables the row buttons while another backup action is running', async () => {
    mockList.mockResolvedValue([NEWER]);
    jest.mocked(exportBackup).mockReturnValue(new Promise(() => {}));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: 'Back up data' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByRole('button', { name: 'Share automatic backup 8 Oct 2026, 14:03', disabled: true })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Restore automatic backup 8 Oct 2026, 14:03', disabled: true })
    ).toBeTruthy();
  });
});

describe('SettingsScreen automatic backup share', () => {
  const SHARE_NAME = 'Share automatic backup 8 Oct 2026, 14:03';
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockList.mockResolvedValue([NEWER, OLDER]);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shares the chosen backup file with the backup dialog title', async () => {
    mockShare.mockResolvedValue(true);
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: SHARE_NAME }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith(NEWER.uri, 'Save your HealthTracker backup');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shares the other backup when its own button is pressed', async () => {
    mockShare.mockResolvedValue(true);
    await renderSettings();

    fireEvent.press(
      screen.getByRole('button', { name: 'Share automatic backup 7 Oct 2026, 09:05' })
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockShare).toHaveBeenCalledWith(OLDER.uri, 'Save your HealthTracker backup');
  });

  it('tells the user when sharing is unavailable', async () => {
    mockShare.mockResolvedValue(false);
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: SHARE_NAME }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Sharing unavailable', expect.any(String));
  });

  it('reports a failed share', async () => {
    mockShare.mockRejectedValue(new Error('file vanished'));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: SHARE_NAME }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(alertSpy).toHaveBeenCalledWith('Share failed', 'file vanished');
  });

  it('blocks the other backup actions while the share sheet is opening and frees them after', async () => {
    let finish: (shared: boolean) => void = () => undefined;
    mockShare.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: SHARE_NAME }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole('button', { name: 'Back up data', disabled: true })
    ).toBeTruthy();

    await act(async () => {
      finish(true);
    });
    expect(screen.queryByRole('button', { name: 'Back up data', disabled: true })).toBeNull();
  });
});
