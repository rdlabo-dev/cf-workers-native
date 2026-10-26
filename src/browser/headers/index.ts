const immutable = new WeakSet<Headers>();
/** Internal Fetch guard; constructing a new Headers always creates a mutable copy. */
export function immutableHeaders(headers: Headers): Headers {
  immutable.add(headers);
  return headers;
}
export function cloneHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  return immutable.has(headers) ? immutableHeaders(copy) : copy;
}
function writable(headers: Headers) {
  if (immutable.has(headers))
    throw new TypeError("Can't modify immutable headers.");
}

/** Workers Headers, including UTF-8 values and separate Set-Cookie entries. */
const invalidName = /[\x00-\x20\x7f()<>@,;:\\"/\[\]?={}]/;
function string(value: unknown): string {
  if (typeof value === "symbol")
    throw new TypeError("Cannot convert a Symbol value to a string");
  return String(value);
}
// The pinned workerd lowercases UTF-8 byte blocks using its SWAR routine.
// Retain the raw normalized bytes as the key: decoding them before lookup
// would merge distinct keys when the baseline produces invalid UTF-8.
// Adapted from workerd v1.20261012.1 src/workerd/util/strings.c++ (Apache-2.0).
function utf8(input: string): number[] {
  const bytes: number[] = [];
  for (const character of input) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000)
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
  }
  return bytes;
}
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
function display(key: string): string {
  return decoder.decode(Uint8Array.from(key, (c) => c.charCodeAt(0)));
}
function name(input: unknown): string {
  const text = string(input);
  if (invalidName.test(text)) throw new TypeError("Invalid header name.");
  const bytes = utf8(text);
  for (let start = 0; start < bytes.length; start += 8) {
    let word = 0n;
    const length = Math.min(8, bytes.length - start);
    for (let i = 0; i < length; i++)
      word |= BigInt(bytes[start + i]) << BigInt(i * 8);
    word ^=
      (((word + 0x3f3f3f3f3f3f3f3fn) ^ (word + 0x2525252525252525n)) &
        0x8080808080808080n) >>
      2n;
    for (let i = 0; i < length; i++)
      bytes[start + i] = Number((word >> BigInt(i * 8)) & 255n);
  }
  return bytes.map((byte) => String.fromCharCode(byte)).join("");
}
function required(actual: number, count: number, method: string) {
  if (actual < count)
    throw new TypeError(
      `Failed to execute '${method}' on 'Headers': parameter ${actual + 1} is not of type 'string'.`,
    );
}
function value(input: unknown): string {
  const result = string(input).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  if (/[\0\r\n]/.test(result)) throw new TypeError("Invalid header value.");
  // workerd stores UTF-8 bytes. An isolated UTF-16 surrogate is encoded as
  // an invalid three-byte sequence, with one replacement per invalid byte.
  return result.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "���",
  );
}
export type HeadersInit =
  | Headers
  | Iterable<Iterable<unknown>>
  | Record<string, unknown>;
/** Internal serialization preserves separate values before display joins them. */
export let serializedHeaderFields: (headers: Headers) => [string, string[]][];
export class Headers {
  #fields = new Map<string, string[]>();
  static {
    serializedHeaderFields = (headers) =>
      [...headers.#fields].map(([name, values]) => [name, [...values]]);
  }
  constructor(init: HeadersInit | undefined = undefined) {
    if (init === undefined) return;
    if (
      init === null ||
      (typeof init !== "object" && typeof init !== "function")
    )
      throw new TypeError(
        "Failed to construct 'Headers': constructor parameter 1 is not of type 'Headers or Sequence or object'.",
      );
    if (#fields in init) {
      this.#fields = new Map(
        [...init.#fields].map(([key, values]) => [key, [...values]]),
      );
      return;
    }
    const iterator = (init as Iterable<Iterable<unknown>>)[Symbol.iterator];
    if (iterator != null) {
      if (typeof iterator !== "function")
        throw new TypeError("Invalid iterator.");
      // GetMethod is evaluated once, including accessor side effects.
      const iterable = { [Symbol.iterator]: () => iterator.call(init) };
      for (const item of iterable) {
        if (
          item === null ||
          (typeof item !== "object" && typeof item !== "function") ||
          !(Symbol.iterator in item)
        )
          throw new TypeError("Each header must be a sequence.");
        const pair = [...item];
        if (pair.length !== 2)
          throw new TypeError(
            "To initialize a Headers object from a sequence, each inner sequence must have exactly two elements.",
          );
        this.#append(pair[0], pair[1]);
      }
    } else {
      for (const key of Object.keys(init))
        this.#append(key, (init as Record<string, string>)[key]);
    }
  }
  append(key: string, item: string): void {
    required(arguments.length, 2, "append");
    writable(this);
    this.#append(key, item);
  }
  #append(key: unknown, item: unknown): void {
    const normalized = name(key);
    const content = value(item);
    const list = this.#fields.get(normalized);
    if (list) list.push(content);
    else this.#fields.set(normalized, [content]);
  }
  set(key: string, item: string): void {
    required(arguments.length, 2, "set");
    writable(this);
    this.#fields.set(name(key), [value(item)]);
  }
  get(key: string): string | null {
    required(arguments.length, 1, "get");
    return this.#fields.get(name(key))?.join(", ") ?? null;
  }
  has(key: string): boolean {
    required(arguments.length, 1, "has");
    return this.#fields.has(name(key));
  }
  delete(key: string): void {
    required(arguments.length, 1, "delete");
    writable(this);
    this.#fields.delete(name(key));
  }
  getAll(key: string): string[] {
    required(arguments.length, 1, "getAll");
    if (string(key).toLowerCase() !== "set-cookie")
      throw new TypeError(
        'getAll() can only be used with the header name "Set-Cookie".',
      );
    return [...(this.#fields.get("set-cookie") ?? [])];
  }
  getSetCookie(): string[] {
    return [...(this.#fields.get("set-cookie") ?? [])];
  }
  #entries(): [string, string][] {
    return [...this.#fields.keys()]
      .sort()
      .flatMap((key): [string, string][] => {
        const entries = this.#fields.get(key)!;
        return key === "set-cookie"
          ? entries.map((item) => [display(key), item])
          : [[display(key), entries.join(", ")]];
      });
  }
  entries(): IterableIterator<[string, string]> {
    return this.#entries()[Symbol.iterator]();
  }
  keys(): IterableIterator<string> {
    return this.#entries()
      .map(([key]) => key)
      [Symbol.iterator]();
  }
  values(): IterableIterator<string> {
    return this.#entries()
      .map(([, item]) => item)
      [Symbol.iterator]();
  }
  forEach(
    callback: (value: string, key: string, parent: Headers) => void,
    thisArg?: unknown,
  ): void {
    if (typeof callback !== "function")
      throw new TypeError("The callback must be a function.");
    for (const [key, item] of this.#entries())
      callback.call(thisArg, item, key, this);
  }
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.#entries()[Symbol.iterator]();
  }
}
Object.defineProperty(Headers, "name", {
  value: "Headers",
  configurable: true,
});

for (const key of Object.getOwnPropertyNames(Headers.prototype)) {
  if (key !== "constructor")
    Object.defineProperty(Headers.prototype, key, { enumerable: true });
}
Object.defineProperty(Headers.prototype, Symbol.toStringTag, {
  value: "Headers",
  configurable: true,
  writable: true,
});
