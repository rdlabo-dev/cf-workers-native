// Adapted from pinned workerd crypto_random.ts (Apache-2.0 / Node MIT).
import { bufferBytes, viewBytes } from "../../shared/buffer-source.js";
import { Buffer } from "node:buffer";
import {
  validateObject,
  validateFunction,
  validateBoolean,
  validateInt32,
} from "../net/validators.js";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
import { isAnyBuffer as isAnyArrayBuffer } from "./validation.js";
const isArrayBufferView = ArrayBuffer.isView;
import { nativePrimeCheck, nativePrimeGenerate } from "./native-crypto.js";
function view(value: any): Uint8Array {
  return ArrayBuffer.isView(value) ? viewBytes(value) : bufferBytes(value);
}
function arrayBufferToUnsignedBigInt(value: any): bigint {
  const hex = Buffer.from(view(value)).toString("hex");
  return hex ? BigInt("0x" + hex) : 0n;
}
const cryptoImpl = {
  checkPrimeSync(candidate: ArrayBufferView, checks: number) {
    const data = view(candidate);
    if (checks > 64) throw new RangeError("Invalid number of checks");
    if (data.length > 1024)
      throw new RangeError("checkPrime candidate exceeds maximum size");
    return nativePrimeCheck(data, checks);
  },
  randomPrime(
    bits: number,
    safe: boolean,
    add?: ArrayBufferView,
    rem?: ArrayBufferView,
  ): ArrayBuffer {
    if (bits > 8192)
      throw new RangeError("generatePrime size exceeds maximum (8192 bits)");
    if (add !== undefined) {
      const a = arrayBufferToUnsignedBigInt(add),
        r = rem === undefined ? undefined : arrayBufferToUnsignedBigInt(rem);
      if (
        !(
          (a === 12n && r === 11n) ||
          (a === 24n && r === 23n) ||
          (a === 60n && r === 59n)
        )
      )
        throw new RangeError("Invalid values for add and rem");
      if (a.toString(2).length > bits)
        throw new RangeError(
          "options.add must not be bigger than size of the requested prime",
        );
    }
    return nativePrimeGenerate(
      bits,
      safe,
      add === undefined ? undefined : view(add),
      rem === undefined ? undefined : view(rem),
    ).buffer as ArrayBuffer;
  },
};
export type PrimeNum = ArrayBuffer | ArrayBufferView | Buffer | bigint;
export interface GeneratePrimeOptions {
  add?: PrimeNum;
  rem?: PrimeNum;
  safe?: boolean;
  bigint?: boolean;
}

export interface CheckPrimeOptions {
  checks?: number;
}

export type GeneratePrimeCallback = (
  err: Error | null,
  prime?: bigint | ArrayBuffer,
) => void;
export type CheckPrimeCallback = (err: Error | null, prime?: boolean) => void;

function processGeneratePrimeOptions(options: GeneratePrimeOptions): {
  add: ArrayBufferView;
  rem: ArrayBufferView;
  safe: boolean;
  bigint: boolean;
} {
  validateObject(options, "options");
  const { safe = false, bigint = false } = options;
  let { add, rem } = options;
  validateBoolean(safe, "options.safe");
  validateBoolean(bigint, "options.bigint");

  if (add !== undefined) {
    if (typeof add === "bigint") {
      add = unsignedBigIntToBuffer(add, "options.add");
    } else if (!isAnyArrayBuffer(add) && !isArrayBufferView(add)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.add",
        ["ArrayBuffer", "TypedArray", "Buffer", "DataView", "bigint"],
        add,
      );
    }
  }

  if (rem !== undefined) {
    if (typeof rem === "bigint") {
      rem = unsignedBigIntToBuffer(rem, "options.rem");
    } else if (!isAnyArrayBuffer(rem) && !isArrayBufferView(rem)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.rem",
        ["ArrayBuffer", "TypedArray", "Buffer", "DataView", "bigint"],
        rem,
      );
    }
  }

  return {
    safe,
    bigint,
    add: add as ArrayBufferView,
    rem: rem as ArrayBufferView,
  };
}

export function generatePrimeSync(
  size: number,
  options: GeneratePrimeOptions = {},
): bigint | ArrayBuffer {
  validateInt32(size, "size", 1);
  const { safe, bigint, add, rem } = processGeneratePrimeOptions(options);

  const primeBuf = cryptoImpl.randomPrime(size, safe, add, rem);
  return bigint ? arrayBufferToUnsignedBigInt(primeBuf) : primeBuf;
}

export function generatePrime(
  size: number,
  options: GeneratePrimeOptions,
  callback: GeneratePrimeCallback,
): void;
export function generatePrime(
  size: number,
  callback: GeneratePrimeCallback,
): void;
export function generatePrime(
  size: number,
  options: GeneratePrimeOptions | GeneratePrimeCallback,
  callback?: GeneratePrimeCallback,
): void {
  validateInt32(size, "size", 1);
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateFunction(callback, "callback");

  const { safe, bigint, add, rem } = processGeneratePrimeOptions(options);

  new Promise<bigint | ArrayBuffer>((res, rej) => {
    try {
      const primeBuf = cryptoImpl.randomPrime(size, safe, add, rem);
      res(bigint ? arrayBufferToUnsignedBigInt(primeBuf) : primeBuf);
    } catch (err) {
      rej(err as Error);
    }
  }).then(
    (val: bigint | ArrayBuffer): void => {
      callback(null, val);
    },
    (err: unknown): void => {
      callback(err as Error);
    },
  );
}

function unsignedBigIntToBuffer(bigint: bigint, name: string): Buffer {
  if (bigint < 0) {
    throw new ERR_OUT_OF_RANGE(name, ">= 0", bigint);
  }

  const hex = bigint.toString(16);
  const padded = hex.padStart(hex.length + (hex.length % 2), "0");
  return Buffer.from(padded, "hex");
}

function validateCandidate(candidate: PrimeNum): Buffer {
  if (typeof candidate === "bigint")
    candidate = unsignedBigIntToBuffer(candidate, "candidate");
  if (!isAnyArrayBuffer(candidate) && !isArrayBufferView(candidate)) {
    throw new ERR_INVALID_ARG_TYPE(
      "candidate",
      ["ArrayBuffer", "TypedArray", "Buffer", "DataView", "bigint"],
      candidate,
    );
  }
  return candidate as Buffer;
}

function validateChecks(options: CheckPrimeOptions): number {
  const { checks = 0 } = options;
  // The checks option is unsigned but must fit into a signed 32-bit integer for OpenSSL.
  validateInt32(checks, "options.checks", 0);
  return checks;
}

export function checkPrimeSync(
  candidate: PrimeNum,
  options: CheckPrimeOptions = {},
): boolean {
  candidate = validateCandidate(candidate);
  validateObject(options, "options");
  const checks = validateChecks(options);
  return cryptoImpl.checkPrimeSync(candidate as ArrayBufferView, checks);
}

export function checkPrime(
  candidate: PrimeNum,
  options: CheckPrimeOptions,
  callback: CheckPrimeCallback,
): void;
export function checkPrime(
  candidate: PrimeNum,
  callback: CheckPrimeCallback,
): void;
export function checkPrime(
  candidate: PrimeNum,
  options: CheckPrimeOptions | CheckPrimeCallback,
  callback?: CheckPrimeCallback,
): void {
  candidate = validateCandidate(candidate);
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateObject(options, "options");
  validateFunction(callback, "callback");
  const checks = validateChecks(options);
  new Promise<boolean>((res, rej) => {
    try {
      res(cryptoImpl.checkPrimeSync(candidate as ArrayBufferView, checks));
    } catch (err) {
      rej(err as Error);
    }
  }).then(
    (val: boolean): void => {
      callback(null, val);
    },
    (err: unknown): void => {
      callback(err);
    },
  );
}
