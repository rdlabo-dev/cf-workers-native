/** JSG signed integer conversion checks the range before truncating. */
export function int32(value: unknown): number {
  if (typeof value === "bigint")
    throw new TypeError("Cannot convert a BigInt value to a number");
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a number");
  const number = +(value as number);
  if (!Number.isFinite(number)) return 0;
  if (number < -2147483648 || number > 2147483647)
    throw new TypeError(
      "Value out of range. Must be between -2147483648 and 2147483647 (inclusive).",
    );
  return Math.trunc(number);
}
