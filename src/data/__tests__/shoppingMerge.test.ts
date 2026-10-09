import { shoppingKey, unitsCompatible, mergedQuantity } from '../shoppingMerge';

describe('shoppingKey', () => {
  it('lowercases, keeps text before the first comma and collapses spaces', () => {
    expect(shoppingKey('  Onion, diced ')).toBe('onion');
    expect(shoppingKey('Garlic   Cloves, minced, fine')).toBe('garlic cloves');
    expect(shoppingKey('Lean ground beef (5% fat)')).toBe('lean ground beef (5% fat)');
  });

  it('returns an empty key for blank or comma-leading names', () => {
    expect(shoppingKey('   ')).toBe('');
    expect(shoppingKey(', diced')).toBe('');
  });

  it('does not unify plurals', () => {
    expect(shoppingKey('Onions')).not.toBe(shoppingKey('Onion'));
  });
});

describe('unitsCompatible', () => {
  it('accepts equal units ignoring case and spaces', () => {
    expect(unitsCompatible('whole', ' Whole ')).toBe(true);
    expect(unitsCompatible('tsp', 'tsp')).toBe(true);
  });

  it('accepts g with kg and ml with l', () => {
    expect(unitsCompatible('g', 'kg')).toBe(true);
    expect(unitsCompatible('l', 'ml')).toBe(true);
  });

  it('rejects mass with volume and unrelated units', () => {
    expect(unitsCompatible('g', 'ml')).toBe(false);
    expect(unitsCompatible('whole', 'g')).toBe(false);
    expect(unitsCompatible('tsp', 'ml')).toBe(false);
  });
});

describe('mergedQuantity', () => {
  it('converts into the unit of the line', () => {
    expect(mergedQuantity(500, 'g', 0.5, 'kg')).toBe(1000);
    expect(mergedQuantity(1, 'l', 250, 'ml')).toBe(1.25);
    expect(mergedQuantity(1, 'kg', 500, 'g')).toBe(1.5);
  });

  it('adds directly for equal non-convertible units', () => {
    expect(mergedQuantity(1, 'whole', 2, 'whole')).toBe(3);
  });

  it('rounds to three decimals', () => {
    expect(mergedQuantity(0.1, 'tsp', 0.2, 'tsp')).toBe(0.3);
    expect(mergedQuantity(1, 'kg', 1, 'g')).toBe(1.001);
  });

  it('returns null for incompatible units', () => {
    expect(mergedQuantity(200, 'g', 100, 'ml')).toBeNull();
    expect(mergedQuantity(2, 'whole', 150, 'g')).toBeNull();
  });
});
