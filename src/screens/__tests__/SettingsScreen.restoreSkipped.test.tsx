import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(callback, []);
  },
}));

jest.mock('../../db/database', () => ({
  getWorkoutReminderEnabled: jest.fn().mockResolvedValue(true),
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
  listAutoBackups: jest.fn().mockResolvedValue([]),
  listSafetySnapshots: jest.fn().mockResolvedValue([]),
  restoreBackupFromUri: jest.fn(),
}));

import SettingsScreen from '../SettingsScreen';
import { importBackup } from '../../services/backup';

const mockImportBackup = jest.mocked(importBackup);

type AlertCall = [string, string | undefined, unknown?];

async function runRestore(result: Awaited<ReturnType<typeof importBackup>>) {
  mockImportBackup.mockResolvedValue(result);
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const utils = render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.press(utils.getByLabelText('Restore from backup'));
  const confirm = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
  await act(async () => {
    await confirm.find((b) => b.text === 'Restore')!.onPress!();
  });
  return alertSpy.mock.calls[1] as AlertCall;
}

describe('SettingsScreen restore result alert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const base = { tablesRestored: 3, rowsRestored: 10, safetySnapshotUri: '' };
  const skipped = [{ table: 'daily_log', columns: ['foo'], rows: 0 }];

  it('names skipped tables and columns when a snapshot was saved', async () => {
    const [title, body] = await runRestore({ ...base, safetySnapshotUri: 'file:///s.json', skipped });
    expect(title).toBe('Restore complete');
    expect(body).toContain('daily_log');
    expect(body).toContain('foo');
  });

  it('names skipped tables and columns when no snapshot was saved', async () => {
    const [, body] = await runRestore({ ...base, skipped });
    expect(body).toContain('daily_log');
    expect(body).toContain('foo');
  });

  it('includes a row count only when rows were skipped', async () => {
    const [, body] = await runRestore({
      ...base,
      skipped: [{ table: 'legacy', columns: [], rows: 4 }],
    });
    expect(body).toContain('legacy');
    expect(body).toContain('4 rows');
  });

  it('caps a long list', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ table: `t${i}`, columns: ['c'], rows: 0 }));
    const [, body] = await runRestore({ ...base, skipped: many });
    expect(body).toContain('t4');
    expect(body).not.toContain('t5');
    expect(body).toContain('and 3 more');
  });

  it('caps the columns listed per table', async () => {
    const columns = Array.from({ length: 8 }, (_, i) => `c${i}`);
    const [, body] = await runRestore({ ...base, skipped: [{ table: 'wide', columns, rows: 0 }] });
    expect(body).toContain('c4');
    expect(body).not.toContain('c5');
    expect(body).toContain('and 3 more');
  });

  it('lists exactly five columns without a more suffix', async () => {
    const columns = Array.from({ length: 5 }, (_, i) => `c${i}`);
    const [, body] = await runRestore({ ...base, skipped: [{ table: 'wide', columns, rows: 0 }] });
    expect(body).toContain('wide (c0, c1, c2, c3, c4)');
    expect(body).not.toContain('more');
  });

  it('keeps the row count after the column cap', async () => {
    const columns = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const [, body] = await runRestore({ ...base, skipped: [{ table: 'wide', columns, rows: 4 }] });
    expect(body).toContain('wide (a, b, c, d, e and 2 more; 4 rows)');
  });

  it('truncates long table and column names with an ellipsis', async () => {
    const longTable = 'T'.repeat(100);
    const longColumn = 'C'.repeat(100);
    const [, body] = await runRestore({
      ...base,
      skipped: [{ table: longTable, columns: [longColumn], rows: 0 }],
    });
    expect(body).not.toContain(longTable);
    expect(body).not.toContain(longColumn);
    expect(body).toContain(`${'T'.repeat(40)}…`);
    expect(body).toContain(`${'C'.repeat(40)}…`);
    expect(body).not.toContain(`${'T'.repeat(41)}`);
    expect(body).not.toContain(`${'C'.repeat(41)}`);
  });

  it('leaves a 40 character name unchanged', async () => {
    const name = 'N'.repeat(40);
    const [, body] = await runRestore({
      ...base,
      skipped: [{ table: name, columns: [name], rows: 0 }],
    });
    expect(body).toContain(`${name} (${name})`);
    expect(body).not.toContain('…');
  });

  it('truncates by code point without splitting a surrogate pair', async () => {
    const name = '😀'.repeat(41);
    const [, body] = await runRestore({ ...base, skipped: [{ table: name, columns: [], rows: 0 }] });
    expect(body).toContain(`${'😀'.repeat(40)}…`);
    expect(body).not.toContain('😀'.repeat(41));
  });

  it('leaves the text unchanged without skipped data', async () => {
    const expected = 'Restored 3 tables and 10 rows. Revisit each screen to see the updated data.';
    const [, a] = await runRestore({ ...base });
    expect(a).toBe(expected);
    jest.restoreAllMocks();
    const [, b] = await runRestore({ ...base, skipped: [] });
    expect(b).toBe(expected);
  });
});
