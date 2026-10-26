import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
export { validateUint32 } from "../net/validators.js";
export function checkFiniteNumber(
  value: unknown,
  name: string,
): value is number {
  if (value === undefined || Number.isNaN(value)) return false;
  if (typeof value !== "number")
    throw new ERR_INVALID_ARG_TYPE(name, "number", value);
  if (!Number.isFinite(value))
    throw new ERR_OUT_OF_RANGE(name, "a finite number", value);
  return true;
}
export function checkRangesOrGetDefault(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback?: number,
): number | undefined {
  if (!checkFiniteNumber(value, name)) return fallback;
  if (value < min || value > max)
    throw new ERR_OUT_OF_RANGE(name, `>= ${min} and <= ${max}`, value);
  return value;
}
