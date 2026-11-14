import { gramsPerCup } from '../ingredientDensity';

describe('gramsPerCup', () => {
  it.each([
    ['flour', 125],
    ['sugar', 200],
    ['brown sugar', 210],
    ['powdered sugar', 120],
    ['icing sugar', 120],
    ['rice', 185],
    ['oats', 90],
    ['cocoa powder', 85],
    ['breadcrumbs', 110],
    ['Mehl', 125],
    ['Zucker', 200],
    ['brauner Zucker', 210],
    ['Puderzucker', 120],
    ['Reis', 185],
    ['Haferflocken', 90],
    ['Kakao', 85],
    ['Paniermehl', 110],
    ['Semmelbrösel', 110],
  ])('has %s at %d g per cup', (name, grams) => {
    expect(gramsPerCup(name)).toBe(grams);
  });

  it.each([
    ['plain flour', 125],
    ['Weizenmehl', 125],
    ['caster sugar', 200],
    ['cornflour', 125],
    ['light brown sugar', 210],
    ['flour, sifted', 125],
    ['All-Purpose Flour', 125],
  ])('matches the compound %s', (name, grams) => {
    expect(gramsPerCup(name)).toBe(grams);
  });

  it('prefers the longest keyword', () => {
    expect(gramsPerCup('brown sugar')).toBe(210);
    expect(gramsPerCup('Paniermehl')).toBe(110);
    expect(gramsPerCup('icing sugar')).toBe(120);
  });

  it.each(['rice vinegar', 'butter lettuce', 'milk', 'honey', 'olive oil', 'flour tortillas', ''])(
    'has no density for %s',
    (name) => {
      expect(gramsPerCup(name)).toBeUndefined();
    },
  );
});
