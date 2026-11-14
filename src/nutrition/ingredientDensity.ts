import { normaliseIngredientName } from './units';

const GRAMS_PER_US_CUP: Record<string, number> = {
  flour: 125,
  sugar: 200,
  'brown sugar': 210,
  'powdered sugar': 120,
  'icing sugar': 120,
  rice: 185,
  oats: 90,
  'cocoa powder': 85,
  breadcrumbs: 110,
  mehl: 125,
  zucker: 200,
  'brauner zucker': 210,
  puderzucker: 120,
  reis: 185,
  haferflocken: 90,
  kakao: 85,
  paniermehl: 110,
  semmelbrösel: 110,
};

const KEYWORDS = Object.keys(GRAMS_PER_US_CUP).sort((a, b) => b.length - a.length);

/** Grams per US cup of a dry ingredient, or undefined when it has no entry. */
export function gramsPerCup(name: string): number | undefined {
  const normalised = normaliseIngredientName(name).split(',')[0].replace(/\s+/g, ' ').trim();
  const keyword = KEYWORDS.find((k) => normalised.endsWith(k));
  return keyword === undefined ? undefined : GRAMS_PER_US_CUP[keyword];
}
