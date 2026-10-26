import { pathOf } from "./writable.js";
import { fileMode } from "./mode.js";
import { validateInteger } from "../crypto/validation.js";
import { NodeTypeError } from "../net/errors.js";
export {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateObject,
  validateString,
  validateUint32,
} from "../net/validators.js";
export type FilePath = string | import("node:buffer").Buffer | URL;
export type Position = number | bigint | null;
export type WriteSyncOptions = {
  offset?: number;
  length?: number;
  position?: Position;
};
export type ValidEncoding = BufferEncoding | "buffer" | null;
const handles = new WeakSet<object>();
export function registerFileHandle(handle: object) {
  handles.add(handle);
}
export function isFileHandle(handle: unknown) {
  return typeof handle === "object" && handle !== null && handles.has(handle);
}
export function normalizePath(path: unknown) {
  return new URL("file://" + pathOf(path));
}
export function toPathIfFileURL(path: URL) {
  return path.pathname;
}
export function getValidatedFd(fd: unknown) {
  validateInteger(fd, "fd", 0, 2147483647);
  return fd as number;
}
export function parseFileMode(
  value: unknown,
  _name: string,
  fallback?: number,
) {
  return fileMode(value, fallback);
}
export function validateThisInternalField(
  value: any,
  key: symbol,
  name: string,
) {
  if (!value || !Reflect.has(value, key))
    throw new NodeTypeError(
      "ERR_INVALID_THIS",
      `Value of "this" must be of type ${name}`,
    );
}
