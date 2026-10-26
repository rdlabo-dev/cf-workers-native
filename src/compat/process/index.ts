import {
  currentDirectory as cwd,
  changeDirectory as chdir,
} from "./directory.js";
export { cwd, chdir };
import * as metadata from "./metadata.js";
export {
  arch,
  pid,
  ppid,
  allowedNodeEnvironmentFlags,
  setSourceMapsEnabled,
  getSourceMapsSupport,
  ref,
  unref,
  setUncaughtExceptionCaptureCallback,
  hasUncaughtExceptionCaptureCallback,
  kill,
  binding,
  dlopen,
  exitCode,
  getActiveResourcesInfo,
  memoryUsage,
  resourceUsage,
  threadCpuUsage,
  cpuUsage,
  channel,
  connected,
  debugPort,
  noDeprecation,
  traceDeprecation,
  throwDeprecation,
  sourceMapsEnabled,
  execPath,
  permission,
  release,
  report,
  finalization,
  _rawDebug,
  moduleLoadList,
  _preload_modules,
  _linkedBinding,
  domain,
  _exiting,
  _getActiveRequests,
  _getActiveHandles,
  _kill,
  constrainedMemory,
  availableMemory,
  execve,
  _fatalException,
  _tickCallback,
  _debugProcess,
  _debugEnd,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  send,
  uptime,
  getegid,
  getgid,
  getgroups,
  geteuid,
  getuid,
  setegid,
  setgid,
  seteuid,
  setuid,
  setgroups,
  initgroups,
} from "./metadata.js";
// Event delivery, warning and nextTick integration for the WebView profile.
// Other process exports retain the existing polyfill; see ../events/README.md.
export {
  argv,
  env,
  execArgv,
  exit,
  features,
  platform,
  title,
  umask,
  version,
  versions,
} from "cf-workers-native:process-base";
import process from "./state.js";
export { default } from "./state.js";
import { EventEmitter } from "../events/index.js";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../net/errors.js";
EventEmitter.init.call(process as any);
export const _events = process._events;
export const _eventsCount = process._eventsCount;
export const _maxListeners = process._maxListeners;
export const _channel = undefined,
  _disconnect = undefined,
  _handleQueue = undefined,
  _pendingMessage = undefined,
  _send = undefined;
export const argv0 = "workerd";
// The pinned profile retains the legacy assertion function.
import internalAssert from "../assert/index.js";
export const assert = internalAssert.ok.bind(internalAssert);
import { config } from "./configuration.js";
import { loadEnvFile } from "./files.js";
import * as stdio from "./stdio.js";
export { config, loadEnvFile };
export { stdin, stdout, stderr, openStdin } from "./stdio.js";
function invoke(method: string, args: any[]): any {
  return Reflect.apply(EventEmitter.prototype[method], process, args);
}
const on = (...args: any[]) => invoke("on", args);
const addListener = on;
const once = (...args: any[]) => invoke("once", args);
const prependListener = (...args: any[]) => invoke("prependListener", args);
const prependOnceListener = (...args: any[]) =>
  invoke("prependOnceListener", args);
const off = (...args: any[]) => invoke("off", args);
const removeListener = off;
const removeAllListeners = (...args: any[]) =>
  invoke("removeAllListeners", args);
const emit = (...args: any[]) => invoke("emit", args);
const listeners = (...args: any[]) => invoke("listeners", args);
const rawListeners = (...args: any[]) => invoke("rawListeners", args);
const eventNames = (...args: any[]) => invoke("eventNames", args);
const listenerCount = (...args: any[]) => invoke("listenerCount", args);
const getMaxListeners = (...args: any[]) => invoke("getMaxListeners", args);
const setMaxListeners = (...args: any[]) => invoke("setMaxListeners", args);
import { nextTick, emitWarning } from "./scheduling.js";
export { nextTick, emitWarning };
export const hrtime = Object.assign(
  function hrtime(time?: [number, number]): [number, number] {
    if (time !== undefined) {
      if (!Array.isArray(time))
        throw new ERR_INVALID_ARG_TYPE("time", "tuple of integers", time);
      else if ((time as number[]).length !== 2)
        throw new ERR_OUT_OF_RANGE("time", "2", time);
    }
    const nanoTime = BigInt(Date.now()) * 1_000_000n;
    const nanosBigint = nanoTime % 1_000_000_000n;
    let seconds = Number((nanoTime - nanosBigint) / 1_000_000_000n);
    let nanos = Number(nanosBigint);
    if (time) {
      const [prevSeconds, prevNanos] = time;
      seconds -= prevSeconds;
      nanos -= prevNanos;
      // We don't have nanosecond-level precision, but if we
      // did (say with the introduction of randomness), this
      // is how we would handle nanosecond underflow
      if (nanos < 0) {
        seconds -= 1;
        nanos += 1e9;
      }
    }
    return [seconds, nanos];
  },
  {
    bigint: function (): bigint {
      return BigInt(Date.now()) * 1_000_000n;
    },
  },
);

Object.assign(process, {
  cwd,
  chdir,
  hrtime,
  ...metadata,
  on,
  addListener,
  once,
  prependListener,
  prependOnceListener,
  off,
  removeListener,
  removeAllListeners,
  emit,
  listeners,
  rawListeners,
  eventNames,
  listenerCount,
  getMaxListeners,
  setMaxListeners,
  nextTick,
  emitWarning,
});

stdio.installStdio();
Object.assign(process, {
  config,
  loadEnvFile,
  argv0,
  assert,
  _channel,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _send,
  stdin: stdio.stdin,
  stdout: stdio.stdout,
  stderr: stdio.stderr,
  openStdin: stdio.openStdin,
});
