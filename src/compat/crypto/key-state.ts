import type { NativeKey } from "./native-crypto.js";
// Shared branding without importing crypto's algorithm dependency graph.
export interface KeyState {
  type: "secret" | "private" | "public";
  bytes?: Uint8Array;
  asymmetric?: NativeKey;
  native?: CryptoKey;
  nativeAlgorithm?: KeyAlgorithm;
}
export const keyStates = new WeakMap<object, KeyState>();
export function isKeyObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && keyStates.has(value);
}
