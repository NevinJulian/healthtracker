export const QUICK_ADD_LABEL_MAX = 60;
export const QUICK_ADD_CALORIES_MAX = 5000;
export const QUICK_ADD_MACRO_MAX = 500;

export interface QuickAddFields {
  label: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export type QuickAddField = keyof QuickAddFields;

export interface QuickAddEntry {
  label: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type QuickAddResult =
  | { valid: true; entry: QuickAddEntry }
  | { valid: false; errors: Partial<Record<QuickAddField, string>> };

const DECIMAL = /^(\d+[.,]?\d*|[.,]\d+)$/;

/** Reads a non-negative decimal with a point or a comma; null when empty or malformed. */
export function parseQuickAddNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  return Number(trimmed.replace(',', '.'));
}

function parseMacro(text: string, name: string): { value: number } | { error: string } {
  if (text.trim() === '') return { value: 0 };
  const value = parseQuickAddNumber(text);
  if (value === null || value > QUICK_ADD_MACRO_MAX) {
    return { error: `${name} must be between 0 and ${QUICK_ADD_MACRO_MAX}` };
  }
  return { value };
}

export function validateQuickAdd(fields: QuickAddFields): QuickAddResult {
  const errors: Partial<Record<QuickAddField, string>> = {};

  const label = fields.label.trim();
  if (label.length > QUICK_ADD_LABEL_MAX) {
    errors.label = `Label can be at most ${QUICK_ADD_LABEL_MAX} characters`;
  }

  const calories = parseQuickAddNumber(fields.calories);
  if (calories === null || calories <= 0 || calories > QUICK_ADD_CALORIES_MAX) {
    errors.calories = `Calories must be above 0 and at most ${QUICK_ADD_CALORIES_MAX}`;
  }

  const protein = parseMacro(fields.protein, 'Protein');
  const carbs = parseMacro(fields.carbs, 'Carbs');
  const fat = parseMacro(fields.fat, 'Fat');
  if ('error' in protein) errors.protein = protein.error;
  if ('error' in carbs) errors.carbs = carbs.error;
  if ('error' in fat) errors.fat = fat.error;

  if (
    Object.keys(errors).length > 0 ||
    calories === null ||
    'error' in protein ||
    'error' in carbs ||
    'error' in fat
  ) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    entry: {
      label: label === '' ? null : label,
      calories,
      protein: protein.value,
      carbs: carbs.value,
      fat: fat.value,
    },
  };
}

export function formatEntrySummary(entry: { calories: number; protein: number }): string {
  return `${Math.round(entry.calories)} kcal · ${Math.round(entry.protein)} g protein`;
}
