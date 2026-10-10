import { formatQuantity } from '../formatQuantity';

describe('formatQuantity', () => {
  it.each([
    [0, '0'],
    [2, '2'],
    [250, '250'],
    [1.5, '1.5'],
    [0.5, '0.5'],
    [1000, '1000'],
    [123456789, '123456789'],
  ])('keeps the existing text for %s', (value, text) => {
    expect(formatQuantity(value)).toBe(text);
  });

  it.each([
    [1.25, '1.25'],
    [1.001, '1.001'],
    [0.333, '0.333'],
    [2.05, '2.05'],
    [0.30000000000000004, '0.3'],
    [10.125, '10.125'],
  ])('shows up to three decimals for %s', (value, text) => {
    expect(formatQuantity(value)).toBe(text);
  });
});
