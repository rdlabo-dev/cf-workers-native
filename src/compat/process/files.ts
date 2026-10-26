import type { Buffer } from "node:buffer";
import { readFileSync } from "../fs/index.js";
import { parseEnv } from "../util/core.js";
import process from "./state.js";
/** Workers loads into its own environment object; host OS files are inaccessible. */
export function loadEnvFile(path: string | URL | Buffer = ".env"): void {
  if (path === null)
    throw new TypeError("Cannot read properties of null (reading 'toString')");
  const parsed = parseEnv(
    readFileSync(
      path instanceof URL ? path : path.toString(),
      "utf8",
    ) as string,
  );
  Object.assign(process.env, parsed);
}
