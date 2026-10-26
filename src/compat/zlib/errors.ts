export { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
export class NodeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class ERR_BUFFER_TOO_LARGE extends RangeError {
  readonly code = "ERR_BUFFER_TOO_LARGE";
  constructor(size: number) {
    super(`Cannot create a Buffer larger than ${size} bytes`);
  }
}
export class ERR_BROTLI_INVALID_PARAM extends RangeError {
  readonly code = "ERR_BROTLI_INVALID_PARAM";
  constructor(key: string) {
    super(`${key} is not a valid Brotli parameter`);
  }
}
export class ERR_ZSTD_INVALID_PARAM extends RangeError {
  readonly code = "ERR_ZSTD_INVALID_PARAM";
  constructor(key: string) {
    super(`${key} is not a valid Zstd parameter`);
  }
}
export class ERR_ZLIB_INITIALIZATION_FAILED extends Error {
  readonly code = "ERR_ZLIB_INITIALIZATION_FAILED";
  constructor() {
    super("Initialization failed");
  }
}
