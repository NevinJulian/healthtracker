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

jest.mock('../../services/csvExport', () => ({
  exportCsv: jest.fn(),
}));

import SettingsScreen from '../SettingsScreen';
import { exportBackup, listAutoBackups } from '../../services/backup';
import { exportCsv } from '../../services/csvExport';

const mockExportCsv = jest.mocked(exportCsv);
const mockExportBackup = jest.mocked(exportBackup);
const mockList = jest.mocked(listAutoBackups);

const CSV_BUTTON = { name: 'Export as CSV' };

let alertSpy: jest.SpyInstance;

async function renderSettings() {
  render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockReset().mockResolvedValue([]);
  mockExportCsv.mockReset().mockResolvedValue({ failed: [] });
  mockExportBackup.mockReset().mockResolvedValue('file:///cache/backup.json');
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('SettingsScreen CSV export', () => {
  it('shows an Export as CSV button with its subtitle', async () => {
    await renderSettings();

    expect(screen.getByRole('button', CSV_BUTTON)).toBeTruthy();
    expect(
      screen.getByText('Workout sets, daily log and meals as three spreadsheet files')
    ).toBeTruthy();
  });

  it('exports on press and shows no message when every file was shared', async () => {
    await renderSettings();

    fireEvent.press(screen.getByRole('button', CSV_BUTTON));
    await flush();

    expect(mockExportCsv).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('names the files that were not shared after a partial failure', async () => {
    mockExportCsv.mockResolvedValue({ failed: ['daily_log.csv', 'meals.csv'] });
    await renderSettings();

    fireEvent.press(screen.getByRole('button', CSV_BUTTON));
    await flush();

    expect(alertSpy).toHaveBeenCalledWith(
      'CSV export incomplete',
      'Could not share: daily_log.csv, meals.csv.'
    );
  });

  it('shows the error when the export rejects', async () => {
    mockExportCsv.mockRejectedValue(new Error('Could not export any CSV file.'));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', CSV_BUTTON));
    await flush();

    expect(alertSpy).toHaveBeenCalledWith('CSV export failed', 'Could not export any CSV file.');
  });

  it('disables the other backup rows while the export runs, then enables them again', async () => {
    let finish: (value: { failed: string[] }) => void = () => {};
    mockExportCsv.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await renderSettings();

    fireEvent.press(screen.getByRole('button', CSV_BUTTON));
    await flush();

    expect(screen.getByRole('button', { name: 'Back up data', disabled: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore from backup', disabled: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export as CSV', disabled: true })).toBeTruthy();

    await act(async () => {
      finish({ failed: [] });
    });

    expect(screen.queryByRole('button', { name: 'Back up data', disabled: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export as CSV', disabled: true })).toBeNull();
  });

  it('ignores a second press while the export runs', async () => {
    mockExportCsv.mockReturnValue(new Promise(() => {}));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', CSV_BUTTON));
    await flush();
    fireEvent.press(screen.getByRole('button', { name: 'Export as CSV', disabled: true }));

    expect(mockExportCsv).toHaveBeenCalledTimes(1);
  });

  it('disables the CSV export while the JSON backup runs', async () => {
    mockExportBackup.mockReturnValue(new Promise(() => {}));
    await renderSettings();

    fireEvent.press(screen.getByRole('button', { name: 'Back up data' }));
    await flush();

    expect(screen.getByRole('button', { name: 'Export as CSV', disabled: true })).toBeTruthy();
  });
});
