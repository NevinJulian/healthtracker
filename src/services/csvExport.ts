export type CsvValue = string | number | boolean | null | undefined;

export function guardFormula(text: string): string {
  return text;
}

export function escapeCsvField(value: CsvValue): string {
  void value;
  return '';
}
