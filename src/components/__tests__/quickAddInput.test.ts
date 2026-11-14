import { parseQuickAddNumber, validateQuickAdd, type QuickAddFields } from '../quickAddInput';

function fields(overrides: Partial<QuickAddFields> = {}): QuickAddFields {
  return { label: '', calories: '250', protein: '', carbs: '', fat: '', ...overrides };
}

describe('parseQuickAddNumber', () => {
  it('reads a point and a comma as the decimal mark', () => {
    expect(parseQuickAddNumber('1.5')).toBe(1.5);
    expect(parseQuickAddNumber('1,5')).toBe(1.5);
  });

  it('reads whole numbers, a leading mark and surrounding spaces', () => {
    expect(parseQuickAddNumber('250')).toBe(250);
    expect(parseQuickAddNumber('.5')).toBe(0.5);
    expect(parseQuickAddNumber(' 12 ')).toBe(12);
  });

  it('returns null for empty input', () => {
    expect(parseQuickAddNumber('')).toBeNull();
    expect(parseQuickAddNumber('   ')).toBeNull();
  });

  it.each(['abc', '12g', '1e3', '1,2,3', '1.2.3', '-5', '+5', '--', ',', '1 2', 'Infinity', 'NaN'])(
    'returns null for %p',
    (text) => {
      expect(parseQuickAddNumber(text)).toBeNull();
    }
  );
});

describe('validateQuickAdd calories', () => {
  it('requires calories', () => {
    const result = validateQuickAdd(fields({ calories: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects 0 and accepts the smallest positive value', () => {
    expect(validateQuickAdd(fields({ calories: '0' })).valid).toBe(false);
    expect(validateQuickAdd(fields({ calories: '0.1' })).valid).toBe(true);
  });

  it('accepts 5000 and rejects 5000.01', () => {
    expect(validateQuickAdd(fields({ calories: '5000' })).valid).toBe(true);
    expect(validateQuickAdd(fields({ calories: '5000.01' })).valid).toBe(false);
  });

  it.each(['-1', 'abc', '1e3', '1,2,3'])('rejects %p', (calories) => {
    expect(validateQuickAdd(fields({ calories })).valid).toBe(false);
  });

  it('names the calories field in the errors', () => {
    const result = validateQuickAdd(fields({ calories: '0' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(Object.keys(result.errors)).toEqual(['calories']);
  });
});

describe('validateQuickAdd macros', () => {
  it.each(['protein', 'carbs', 'fat'] as const)('treats an empty %s as 0', (key) => {
    const result = validateQuickAdd(fields({ [key]: '' }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.entry[key]).toBe(0);
  });

  it.each(['protein', 'carbs', 'fat'] as const)('accepts 0 and 500 and rejects 500.01 for %s', (key) => {
    expect(validateQuickAdd(fields({ [key]: '0' })).valid).toBe(true);
    expect(validateQuickAdd(fields({ [key]: '500' })).valid).toBe(true);
    expect(validateQuickAdd(fields({ [key]: '500.01' })).valid).toBe(false);
  });

  it.each(['protein', 'carbs', 'fat'] as const)('rejects letters, 1e3 and negatives for %s', (key) => {
    for (const bad of ['abc', '1e3', '-1', '1,2,3']) {
      const result = validateQuickAdd(fields({ [key]: bad }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(Object.keys(result.errors)).toEqual([key]);
    }
  });

  it('does not check calories against the macros', () => {
    expect(
      validateQuickAdd(fields({ calories: '10', protein: '500', carbs: '500', fat: '500' })).valid
    ).toBe(true);
  });
});

describe('validateQuickAdd label', () => {
  it('accepts 60 characters and rejects 61', () => {
    expect(validateQuickAdd(fields({ label: 'a'.repeat(60) })).valid).toBe(true);
    const result = validateQuickAdd(fields({ label: 'a'.repeat(61) }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(Object.keys(result.errors)).toEqual(['label']);
  });

  it('measures the label after trimming', () => {
    expect(validateQuickAdd(fields({ label: `  ${'a'.repeat(60)}  ` })).valid).toBe(true);
  });

  it('stores a whitespace-only label as null', () => {
    const result = validateQuickAdd(fields({ label: '   ' }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.entry.label).toBeNull();
  });

  it('trims a label', () => {
    const result = validateQuickAdd(fields({ label: '  Snack ' }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.entry.label).toBe('Snack');
  });
});

describe('validateQuickAdd entry', () => {
  it('returns the parsed numbers, with comma decimals', () => {
    const result = validateQuickAdd({
      label: 'Yoghurt',
      calories: '250,5',
      protein: '10',
      carbs: '1,5',
      fat: '',
    });
    expect(result).toEqual({
      valid: true,
      entry: { label: 'Yoghurt', calories: 250.5, protein: 10, carbs: 1.5, fat: 0 },
    });
  });

  it('reports every bad field at once', () => {
    const result = validateQuickAdd({
      label: 'a'.repeat(61),
      calories: '',
      protein: 'x',
      carbs: '501',
      fat: '-1',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(Object.keys(result.errors).sort()).toEqual(['calories', 'carbs', 'fat', 'label', 'protein']);
    }
  });
});
