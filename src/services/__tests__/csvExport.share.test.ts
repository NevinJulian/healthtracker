const mockWrite = jest.fn<Promise<void>, [string, string]>();
const mockShare = jest.fn<Promise<void>, [string, Record<string, string>]>();
const mockAvailable = jest.fn<Promise<boolean>, []>();
const mockSets = jest.fn();
const mockLog = jest.fn();
const mockMeals = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: (uri: string, content: string) => mockWrite(uri, content),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (uri: string, options: Record<string, string>) => mockShare(uri, options),
}));

jest.mock('../../db/database', () => ({
  getAllWorkoutSetsForExport: () => mockSets(),
  getAllDailyLogForExport: () => mockLog(),
  getAllMealsForExport: () => mockMeals(),
}));

import { exportCsv } from '../csvExport';

const URIS = [
  'file:///cache/workout_sets.csv',
  'file:///cache/daily_log.csv',
  'file:///cache/meals.csv',
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable.mockResolvedValue(true);
  mockWrite.mockResolvedValue(undefined);
  mockShare.mockResolvedValue(undefined);
  mockSets.mockResolvedValue([]);
  mockLog.mockResolvedValue([]);
  mockMeals.mockResolvedValue([]);
});

describe('exportCsv', () => {
  it('reports nothing failed when all three files were shared', async () => {
    await expect(exportCsv()).resolves.toEqual({ failed: [] });
  });

  it('writes the three files to the cache directory in order', async () => {
    await exportCsv();

    expect(mockWrite.mock.calls.map((c) => c[0])).toEqual(URIS);
  });

  it('writes UTF-8 text that starts with the BOM and the header', async () => {
    mockMeals.mockResolvedValue([
      {
        date: '2026-03-01',
        meal_type: 'lunch',
        recipe_title: 'Zürcher, Rösti',
        calories: 600,
        protein: 40,
        carbs: 50,
        fat: 20,
        is_consumed: 0,
      },
    ]);

    await exportCsv();

    const contents = mockWrite.mock.calls.map((c) => c[1]);
    expect(contents[0]).toBe(
      '﻿date,exercise,set_index,set_type,reps,weight_kg,created_at\r\n'
    );
    expect(contents[1]).toBe(
      '﻿date,body_weight,water_ml,walk_completed,hammer_completed,fasting_completed\r\n'
    );
    expect(contents[2]).toBe(
      '﻿date,meal_type,recipe_title,calories,protein,carbs,fat,is_consumed\r\n' +
        '2026-03-01,lunch,"Zürcher, Rösti",600,40,50,20,0\r\n'
    );
  });

  it('shares each file with the csv mime type, UTI and a title naming the file', async () => {
    await exportCsv();

    expect(mockShare.mock.calls).toEqual([
      [URIS[0], { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Save workout_sets.csv' }],
      [URIS[1], { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Save daily_log.csv' }],
      [URIS[2], { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Save meals.csv' }],
    ]);
  });

  it('waits for each share before writing and sharing the next file', async () => {
    const events: string[] = [];
    mockWrite.mockImplementation(async (uri) => {
      events.push(`write ${uri}`);
    });
    let releaseFirst: () => void = () => {};
    mockShare.mockImplementation(async (uri) => {
      events.push(`share ${uri}`);
      if (uri === URIS[0]) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      events.push(`done ${uri}`);
    });

    const pending = exportCsv();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual([`write ${URIS[0]}`, `share ${URIS[0]}`]);

    releaseFirst();
    await pending;

    expect(events.slice(2, 4)).toEqual([`done ${URIS[0]}`, `write ${URIS[1]}`]);
  });

  it('keeps going after a share rejects and reports the file as failed', async () => {
    mockShare.mockRejectedValueOnce(new Error('dismissed'));

    await expect(exportCsv()).resolves.toEqual({ failed: ['workout_sets.csv'] });
    expect(mockShare).toHaveBeenCalledTimes(3);
  });

  it('keeps going after a write fails, skips that share and reports the file', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));

    await expect(exportCsv()).resolves.toEqual({ failed: ['workout_sets.csv'] });
    expect(mockShare.mock.calls.map((c) => c[0])).toEqual([URIS[1], URIS[2]]);
  });

  it('reports every failed file in order', async () => {
    mockShare.mockRejectedValueOnce(new Error('a'));
    mockShare.mockResolvedValueOnce(undefined);
    mockShare.mockRejectedValueOnce(new Error('c'));

    await expect(exportCsv()).resolves.toEqual({ failed: ['workout_sets.csv', 'meals.csv'] });
  });

  it('throws before reading or writing anything when sharing is unavailable', async () => {
    mockAvailable.mockResolvedValue(false);

    await expect(exportCsv()).rejects.toThrow(
      'Sharing is not available on this device. Cannot export CSV.'
    );
    expect(mockSets).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('throws when every file fails', async () => {
    mockShare.mockRejectedValue(new Error('no'));

    await expect(exportCsv()).rejects.toThrow('Could not export any CSV file.');
  });

  it('throws when a reader fails and writes nothing', async () => {
    mockLog.mockRejectedValue(new Error('db down'));

    await expect(exportCsv()).rejects.toThrow('db down');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
