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
  importBackup,
  shareFile,
  restoreBackupFromUri,
  type AutoBackupEntry,
} from '../../services/backup';

const mockList = jest.mocked(listAutoBackups);
const mockRestore = jest.mocked(restoreBackupFromUri);
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

describe('SettingsScreen automatic backup restore', () => {
  const RESTORE_NAME = 'Restore automatic backup 8 Oct 2026, 14:03';
  const RESULT = { tablesRestored: 12, rowsRestored: 340, safetySnapshotUri: 'file:///document/safety-snapshots/s.json' };
  let alertSpy: jest.SpyInstance;

  type AlertButton = { text: string; onPress?: () => void | Promise<void> };
  const buttonsOf = (call: number): AlertButton[] => alertSpy.mock.calls[call][2] as AlertButton[];

  async function pressRestoreAndConfirm() {
    fireEvent.press(screen.getByRole('button', { name: RESTORE_NAME }));
    await act(async () => {
      await buttonsOf(0).find((b) => b.text === 'Restore')?.onPress?.();
    });
  }

  beforeEach(() => {
    mockList.mockResolvedValue([NEWER, OLDER]);
    mockRestore.mockReset().mockResolvedValue(RESULT);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('asks for confirmation naming the backup before restoring anything', async () => {
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: RESTORE_NAME }));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][1]).toBe(
      'Restore the automatic backup from 8 Oct 2026, 14:03? This will replace ALL current data with its contents. A safety copy of your current data will be saved first. Continue?'
    );
    expect(buttonsOf(0).map((b) => b.text)).toEqual(['Cancel', 'Restore']);
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it('restores nothing when the confirmation is cancelled', async () => {
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: RESTORE_NAME }));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await buttonsOf(0).find((b) => b.text === 'Cancel')?.onPress?.();
    });

    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('restores from that backup file through the service, not the file picker', async () => {
    await renderSettings();

    await pressRestoreAndConfirm();

    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledWith(NEWER.uri, {
      onSnapshotFailed: expect.any(Function),
    });
    expect(jest.mocked(importBackup)).not.toHaveBeenCalled();
  });

  it('restores the other backup when its own button is pressed', async () => {
    await renderSettings();

    fireEvent.press(
      screen.getByRole('button', { name: 'Restore automatic backup 7 Oct 2026, 09:05' })
    );
    await act(async () => {
      await buttonsOf(0).find((b) => b.text === 'Restore')?.onPress?.();
    });

    expect(mockRestore).toHaveBeenCalledWith(OLDER.uri, expect.anything());
  });

  it('reports the result and offers the safety copy, as a restore from a picked file does', async () => {
    await renderSettings();

    await pressRestoreAndConfirm();

    const [title, body] = alertSpy.mock.calls[1] as [string, string];
    expect(title).toBe('Restore complete');
    expect(body).toContain('Restored 12 tables and 340 rows.');
    expect(body).toContain('A safety copy of your previous data was saved.');
    await act(async () => {
      await buttonsOf(1).find((b) => b.text === 'Share safety copy')?.onPress?.();
    });
    expect(mockShare).toHaveBeenCalledWith(RESULT.safetySnapshotUri);
  });

  it('warns about meals that cannot be traced back, as a restore from a picked file does', async () => {
    mockRestore.mockResolvedValue({ ...RESULT, consumedMealsWithoutRefund: 2 });
    await renderSettings();

    await pressRestoreAndConfirm();

    expect(alertSpy.mock.calls[1][1]).toContain('predates portion tracking');
  });

  it('reloads the list after a restore', async () => {
    await renderSettings();
    mockList.mockResolvedValue([entry('2026-10-09T08:00:00.000Z', 100)]);

    await pressRestoreAndConfirm();

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Restore automatic backup 9 Oct 2026, 08:00' })).toBeTruthy();
  });

  it('reports a failed restore, reloads the list and frees the buttons', async () => {
    mockRestore.mockRejectedValue(new Error('Invalid backup file: could not parse JSON.'));
    await renderSettings();

    await pressRestoreAndConfirm();

    expect(alertSpy).toHaveBeenCalledWith(
      'Restore failed',
      'Invalid backup file: could not parse JSON.'
    );
    expect(alertSpy.mock.calls.some(([title]) => title === 'Restore complete')).toBe(false);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Back up data', disabled: true })).toBeNull();
  });

  it('asks whether to continue when the safety copy cannot be saved', async () => {
    await renderSettings();
    await pressRestoreAndConfirm();
    const options = mockRestore.mock.calls[0][1];

    let proceed: boolean | undefined;
    const asked = options?.onSnapshotFailed?.('disk full').then((answer) => {
      proceed = answer;
    });
    const prompt = alertSpy.mock.calls.find(([title]) => title === 'Safety copy failed');
    expect(prompt?.[1]).toContain('disk full');
    await act(async () => {
      (prompt?.[2] as AlertButton[]).find((b) => b.text === 'Continue anyway')?.onPress?.();
      await asked;
    });

    expect(proceed).toBe(true);
  });

  it('blocks the other backup actions while the restore is running', async () => {
    let finish: () => void = () => undefined;
    mockRestore.mockReturnValue(new Promise((resolve) => { finish = () => resolve(RESULT); }));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: RESTORE_NAME }));
    await act(async () => {
      buttonsOf(0).find((b) => b.text === 'Restore')?.onPress?.();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Back up data', disabled: true })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Share automatic backup 8 Oct 2026, 14:03', disabled: true })
    ).toBeTruthy();

    await act(async () => {
      finish();
    });
    expect(screen.queryByRole('button', { name: 'Back up data', disabled: true })).toBeNull();
  });
});
