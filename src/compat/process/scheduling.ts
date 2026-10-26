import process from "./state.js";
import { ERR_INVALID_ARG_TYPE } from "../net/errors.js";
// Pinned workerd also implements nextTick with queueMicrotask.
export function nextTick(callback: (...args: any[]) => void, ...args: any[]) {
  queueMicrotask(() => callback(...args));
}
// Adapted from cloudflare/workerd@5358e3d337336eaf696a48bc1563d808b10feba5,
// src/node/internal/internal_process.ts, Apache-2.0.
// Copyright (c) 2017-2022 Cloudflare, Inc.
// https://opensource.org/licenses/Apache-2.0
export function emitWarning(
  warning: string | Error,
  options?: any,
  codeOrCtor?: any,
  maybeCtor?: any,
) {
  let err: Error & { code?: string; detail?: string };
  let name = "Warning",
    detail,
    code,
    ctor;
  if (typeof options === "object" && !Array.isArray(options)) {
    if (options.type) name = options.type;
    if (options.code) code = options.code;
    if (options.detail) detail = options.detail;
    ctor = options.ctor;
  } else if (typeof options === "string") {
    name = options;
    if (typeof codeOrCtor === "string") {
      code = codeOrCtor;
      if (typeof maybeCtor === "function") ctor = maybeCtor;
      else if (maybeCtor !== undefined)
        throw new ERR_INVALID_ARG_TYPE("ctor", "function", maybeCtor);
    } else if (typeof codeOrCtor === "function") ctor = codeOrCtor;
    else if (codeOrCtor !== undefined)
      throw new ERR_INVALID_ARG_TYPE("ctor", "function", codeOrCtor);
  } else if (typeof options === "function") ctor = options;
  else if (options !== undefined)
    throw new ERR_INVALID_ARG_TYPE("options", "object", options);
  if (typeof warning === "string") {
    err = new (ctor || Error)(warning);
    err.name = name;
  } else if (warning instanceof Error) {
    err = warning;
    if (name && name !== "Warning") err.name = name;
  } else throw new ERR_INVALID_ARG_TYPE("warning", "string or Error", warning);
  if (code) err.code = code;
  if (detail && typeof detail === "string") err.detail = detail;
  // WebKit lacks V8's captureStackTrace. Exact stack inspection remains a
  // process/engine acceptance gap even when warning delivery matches.
  Error.captureStackTrace?.(err, ctor || emitWarning);
  queueMicrotask(() => process.emit("warning", err));
}
