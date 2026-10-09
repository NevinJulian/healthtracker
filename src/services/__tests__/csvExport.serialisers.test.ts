import { buildCsv, workoutSetsToCsv, dailyLogToCsv, mealsToCsv } from '../csvExport';
import type {
  DailyLogExportRow,
  MealExportRow,
  WorkoutSetExportRow,
} from '../../db/database';

const BOM = '﻿';

const SETS_HEADER = 'date,exercise,set_index,set_type,reps,weight_kg,created_at';
const LOG_HEADER = 'date,body_weight,water_ml,walk_completed,hammer_completed,fasting_completed';
const MEALS_HEADER = 'date,meal_type,recipe_title,calories,protein,carbs,fat,is_consumed';

describe('buildCsv', () => {
  it('starts with one BOM, then the header, then CRLF-terminated rows', () => {
    expect(buildCsv(['a', 'b'], [[1, 'x'], [2, 'y']])).toBe(`${BOM}a,b\r\n1,x\r\n2,y\r\n`);
  });

  it('gives only the header line for no rows', () => {
    expect(buildCsv(['a', 'b'], [])).toBe(`${BOM}a,b\r\n`);
  });

  it('escapes every field of a row', () => {
    expect(buildCsv(['a'], [['x,y'], [null]])).toBe(`${BOM}a\r\n"x,y"\r\n\r\n`);
  });
});

describe('workoutSetsToCsv', () => {
  const row = (over: Partial<WorkoutSetExportRow>): WorkoutSetExportRow => ({
    date: '2026-03-01',
    exercise: 'Bench Press',
    set_index: 0,
    set_type: null,
    reps: 5,
    weight_kg: 82.5,
    created_at: '2026-03-01T10:15:00.000Z',
    ...over,
  });

  it('gives BOM and header only for no rows', () => {
    expect(workoutSetsToCsv([])).toBe(`${BOM}${SETS_HEADER}\r\n`);
  });

  it('writes an awkward exercise name quoted and intact', () => {
    expect(workoutSetsToCsv([row({ exercise: 'Curl, "EZ" Bar Ü' })])).toBe(
      `${BOM}${SETS_HEADER}\r\n2026-03-01,"Curl, ""EZ"" Bar Ü",0,working,5,82.5,2026-03-01T10:15:00.000Z\r\n`
    );
  });

  it('writes NULL and unknown set types as working and warmup as warmup', () => {
    const csv = workoutSetsToCsv([
      row({ set_index: 0, set_type: null }),
      row({ set_index: 1, set_type: 'x' }),
      row({ set_index: 2, set_type: 'warmup' }),
    ]);
    const types = csv
      .split('\r\n')
      .slice(1, 4)
      .map((line) => line.split(',')[3]);
    expect(types).toEqual(['working', 'working', 'warmup']);
  });

  it('starts with exactly one BOM', () => {
    const csv = workoutSetsToCsv([row({})]);
    expect(csv.charAt(0)).toBe(BOM);
    expect(csv.charAt(1)).not.toBe(BOM);
  });
});

describe('dailyLogToCsv', () => {
  const row = (over: Partial<DailyLogExportRow>): DailyLogExportRow => ({
    date: '2026-03-01',
    body_weight: 80.4,
    water_ml: 1500,
    walk_completed: 1,
    hammer_completed: 0,
    fasting_completed: 1,
    ...over,
  });

  it('gives BOM and header only for no rows', () => {
    expect(dailyLogToCsv([])).toBe(`${BOM}${LOG_HEADER}\r\n`);
  });

  it('writes a row with flags as 0 or 1', () => {
    expect(dailyLogToCsv([row({})])).toBe(`${BOM}${LOG_HEADER}\r\n2026-03-01,80.4,1500,1,0,1\r\n`);
  });

  it('writes a NULL body weight as an empty field', () => {
    expect(dailyLogToCsv([row({ body_weight: null })])).toBe(
      `${BOM}${LOG_HEADER}\r\n2026-03-01,,1500,1,0,1\r\n`
    );
  });
});

describe('mealsToCsv', () => {
  const row = (over: Partial<MealExportRow>): MealExportRow => ({
    date: '2026-03-01',
    meal_type: 'lunch',
    recipe_title: 'Zürcher Geschnetzeltes, mit Rösti',
    calories: 640,
    protein: 42,
    carbs: 55,
    fat: 28,
    is_consumed: 1,
    ...over,
  });

  it('gives BOM and header only for no rows', () => {
    expect(mealsToCsv([])).toBe(`${BOM}${MEALS_HEADER}\r\n`);
  });

  it('writes a title with a comma and umlauts quoted and intact', () => {
    expect(mealsToCsv([row({})])).toBe(
      `${BOM}${MEALS_HEADER}\r\n2026-03-01,lunch,"Zürcher Geschnetzeltes, mit Rösti",640,42,55,28,1\r\n`
    );
  });

  it('writes empty title and macros for a missing recipe but keeps is_consumed', () => {
    expect(
      mealsToCsv([
        row({
          recipe_title: null,
          calories: null,
          protein: null,
          carbs: null,
          fat: null,
          is_consumed: 1,
        }),
      ])
    ).toBe(`${BOM}${MEALS_HEADER}\r\n2026-03-01,lunch,,,,,,1\r\n`);
  });

  it('guards a title that starts like a formula', () => {
    expect(mealsToCsv([row({ recipe_title: '-5 min bowl' })])).toContain(",'-5 min bowl,");
  });
});
