import { currentDirectory } from "./writable.js";
// Copyright (c) 2026 Cloudflare, Inc. Licensed under Apache-2.0.
// Ported from workerd@5358e3d337336eaf696a48bc1563d808b10feba5 internal_fs_sync.ts.
import { validateString, validateObject } from "../net/validators.js";
import { Dirent } from "./directory.js";
import type { DirEntryHandle } from "./directory-backend.js";
import {
  expandBraces,
  normalizePattern,
  walkGlob,
  compileExcludePatterns,
  collapseGlobstars,
  precompileSegmentRegexes,
  type GlobResult,
} from "./glob-internal.js";
type GlobOptions = {
  cwd?: string | URL;
  withFileTypes?: boolean;
  exclude?: string[] | ((path: any) => boolean);
};
type GlobOptionsWithFileTypes = GlobOptions;
type GlobOptionsWithoutFileTypes = GlobOptions;
export function globSync(
  pattern: string | readonly string[],
  options:
    | GlobOptions
    | GlobOptionsWithFileTypes
    | GlobOptionsWithoutFileTypes = {},
): string[] | Dirent[] {
  // Normalize pattern to array
  const patterns: string[] =
    typeof pattern === "string" ? [pattern] : [...pattern];
  for (const p of patterns) {
    validateString(p, "pattern");
  }

  if (typeof options !== "object" || options === null) {
    validateObject(options, "options");
  }

  const cwdOption = (options as GlobOptions).cwd;
  const cwd: string =
    cwdOption instanceof URL
      ? cwdOption.pathname
      : ((cwdOption as string | undefined) ?? currentDirectory());
  validateString(cwd, "options.cwd");

  const withFileTypes: boolean =
    (options as GlobOptionsWithFileTypes).withFileTypes ?? false;

  // Exclude can be a user function or an array of glob patterns.
  // Keep them as separate variables to preserve proper type signatures.
  const excludeOption = (options as GlobOptions).exclude;
  let excludeUserFn: ((path: string | Dirent) => boolean) | undefined;
  let excludePatternFn: ((path: string) => boolean) | undefined;
  if (typeof excludeOption === "function") {
    excludeUserFn = excludeOption as (path: string | Dirent) => boolean;
  } else if (Array.isArray(excludeOption)) {
    excludePatternFn = compileExcludePatterns(excludeOption as string[]);
  }

  // Pattern-driven directory walk
  const results = new Map<string, GlobResult>();
  const dirCache = new Map<string, DirEntryHandle[]>();

  for (const p of patterns) {
    for (const expanded of expandBraces(p)) {
      const normalized = normalizePattern(expanded);
      const segments = collapseGlobstars(
        normalized.split("/").filter((s) => s !== ""),
      );
      if (segments.length === 0) continue;
      const segmentRegexes = precompileSegmentRegexes(segments);
      walkGlob(cwd, segments, 0, cwd, "", results, dirCache, segmentRegexes);
    }
  }

  // Build final results, applying exclude filter
  const stringResults: string[] = [];
  const direntResults: Dirent[] = [];

  for (const [relPath, entry] of results) {
    if (!relPath) continue; // skip empty paths

    if (excludePatternFn && excludePatternFn(relPath)) continue;

    if (withFileTypes) {
      const parts = relPath.split("/");
      const name = parts.pop() ?? "";
      const parentPath = cwd + (parts.length ? "/" + parts.join("/") : "");
      const type = entry.handle?.type ?? 0;
      const dirent = new Dirent(name, type, parentPath);
      if (excludeUserFn && excludeUserFn(dirent)) continue;
      direntResults.push(dirent);
    } else {
      if (excludeUserFn && excludeUserFn(relPath)) continue;
      stringResults.push(relPath);
    }
  }

  return withFileTypes ? direntResults : stringResults;
}
