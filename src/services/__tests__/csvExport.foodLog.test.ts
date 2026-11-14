const mockWrite = jest.fn<Promise<void>, [string, string]>();
const mockShare = jest.fn<Promise<void>, [string, Record<string, string>]>();
const mockFoodLog = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: (uri: string, content: string) => mockWrite(uri, content),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (uri: string, options: Record<string, string>) => mockShare(uri, options),
}));

jest.mock('../../db/database', () => ({
  getAllWorkoutSetsForExport: () => Promise.resolve([]),
  getAllDailyLogForExport: () => Promise.resolve([]),
  getAllMealsForExport: () => Promise.resolve([]),
  getAllFoodLogForExport: () => mockFoodLog(),
}));

import { exportCsv, foodLogToCsv } from '../csvExport';

const BOM = '﻿';

beforeEach(() => {
  jest.clearAllMocks();
  mockWrite.mockResolvedValue(undefined);
  mockShare.mockResolvedValue(undefined);
  mockFoodLog.mockResolvedValue([]);
});

describe('food_log.csv', () => {
  it('is written fourth with the exact header, BOM and CRLF', async () => {
    await exportCsv();

    expect(mockWrite.mock.calls).toHaveLength(4);
    expect(mockWrite.mock.calls[3]).toEqual([
      'file:///cache/food_log.csv',
      `${BOM}date,label,calories,protein,carbs,fat\r\n`,
    ]);
  });

  it('writes one row per entry in the order the reader returns them', async () => {
    mockFoodLog.mockResolvedValue([
      { date: '2026-03-01', label: 'Snack', calories: 250, protein: 10, carbs: 30.5, fat: 0 },
      { date: '2026-03-02', label: null, calories: 400, protein: 0, carbs: 0, fat: 0 },
    ]);

    await exportCsv();

    expect(mockWrite.mock.calls[3][1]).toBe(
      `${BOM}date,label,calories,protein,carbs,fat\r\n` +
        '2026-03-01,Snack,250,10,30.5,0\r\n' +
        '2026-03-02,,400,0,0,0\r\n'
    );
  });

  it('quotes a label with a comma and guards a label that starts like a formula', () => {
    const csv = foodLogToCsv([
      { date: '2026-03-01', label: 'rice, beans', calories: 300, protein: 8, carbs: 60, fat: 1 },
      { date: '2026-03-01', label: '=1+1', calories: 100, protein: 0, carbs: 0, fat: 0 },
    ]);

    expect(csv).toContain('2026-03-01,"rice, beans",300,8,60,1\r\n');
    expect(csv).toContain("2026-03-01,'=1+1,100,0,0,0\r\n");
  });

  it('shares it after meals.csv with the csv mime type', async () => {
    await exportCsv();

    expect(mockShare.mock.calls.map((c) => c[0]).slice(2)).toEqual([
      'file:///cache/meals.csv',
      'file:///cache/food_log.csv',
    ]);
    expect(mockShare.mock.calls[3][1]).toEqual({
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'Save food_log.csv',
    });
  });

  it('reports a food_log.csv failure without stopping the other files', async () => {
    mockShare.mockImplementation(async (uri) => {
      if (uri.endsWith('food_log.csv')) throw new Error('dismissed');
    });

    await expect(exportCsv()).resolves.toEqual({ failed: ['food_log.csv'] });
    expect(mockShare).toHaveBeenCalledTimes(4);
  });

  it('throws only when all four files fail', async () => {
    mockShare.mockRejectedValueOnce(new Error('a'));
    mockShare.mockRejectedValueOnce(new Error('b'));
    mockShare.mockRejectedValueOnce(new Error('c'));

    await expect(exportCsv()).resolves.toEqual({
      failed: ['workout_sets.csv', 'daily_log.csv', 'meals.csv'],
    });

    mockShare.mockRejectedValue(new Error('no'));
    await expect(exportCsv()).rejects.toThrow('Could not export any CSV file.');
  });

  it('throws before writing anything when the food log cannot be read', async () => {
    mockFoodLog.mockRejectedValue(new Error('db down'));

    await expect(exportCsv()).rejects.toThrow('db down');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
