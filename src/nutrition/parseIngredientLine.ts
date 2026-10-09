export interface ParsedIngredientLine {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'whole';
}

export function parseIngredientLine(line: string): ParsedIngredientLine {
  return { name: line, quantity: 0, unit: 'g' };
}
