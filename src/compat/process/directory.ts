import { AsyncLocalStorage } from "../async-hooks/index.js";
import { registerRequestScope } from "../../shared/request-scope.js";
const contexts = new AsyncLocalStorage<{ path: string }>();
const fallback = { path: "/bundle" };
const active = () => contexts.getStore() ?? fallback;
export const currentDirectory = () => active().path;
let validateDirectory = (path: string) => {
  const normalized =
    new URL(path, "file://" + currentDirectory() + "/").pathname.replace(
      /\/$/,
      "",
    ) || "/";
  if (!["/", "/tmp", "/bundle", "/dev"].includes(normalized))
    throw Object.assign(new Error("no such file or directory"), {
      code: "ENOENT",
      syscall: "chdir",
      path: normalized,
    });
  return normalized;
};
export function registerDirectoryValidator(validate: (path: string) => string) {
  validateDirectory = validate;
}
export function changeDirectory(path: unknown) {
  if (typeof path !== "string")
    throw Object.assign(
      new TypeError('The "directory" argument must be of type string.'),
      { code: "ERR_INVALID_ARG_TYPE" },
    );
  active().path = validateDirectory(path);
}
export function runWithDirectory<T>(callback: () => T): T {
  return contexts.run({ path: "/bundle" }, callback);
}
registerRequestScope(runWithDirectory);
