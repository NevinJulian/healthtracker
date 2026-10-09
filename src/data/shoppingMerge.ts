const UNIT_FAMILIES: Record<string, { family: 'mass' | 'volume'; factor: number }> = {
  g: { family: 'mass', factor: 1 },
  kg: { family: 'mass', factor: 1000 },
  ml: { family: 'volume', factor: 1 },
  l: { family: 'volume', factor: 1000 },
};

export function shoppingKey(name: string): string {
  return name.toLowerCase().split(',')[0].replace(/\s+/g, ' ').trim();
}

function unitKey(unit: string): string {
  return unit.trim().toLowerCase();
}

export function unitsCompatible(a: string, b: string): boolean {
  const ka = unitKey(a);
  const kb = unitKey(b);
  if (ka === kb) return true;
  const fa = UNIT_FAMILIES[ka];
  const fb = UNIT_FAMILIES[kb];
  return fa !== undefined && fb !== undefined && fa.family === fb.family;
}

/**
 * Adds `addQuantity` (in `addUnit`) to `lineQuantity` (in `lineUnit`), expressed in
 * the line's unit. Returns null when the units cannot be combined.
 */
export function mergedQuantity(
  lineQuantity: number,
  lineUnit: string,
  addQuantity: number,
  addUnit: string,
): number | null {
  if (!unitsCompatible(lineUnit, addUnit)) return null;
  const fl = UNIT_FAMILIES[unitKey(lineUnit)];
  const fa = UNIT_FAMILIES[unitKey(addUnit)];
  const ratio = fl !== undefined && fa !== undefined ? fa.factor / fl.factor : 1;
  return Math.round((lineQuantity + addQuantity * ratio) * 1000) / 1000;
}
