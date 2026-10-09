export function formatQuantity(quantity: number): string {
  const oneDecimal = quantity.toFixed(1);
  if (Number(oneDecimal) === quantity) return oneDecimal.replace(/\.0$/, '');
  return quantity
    .toFixed(3)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}
