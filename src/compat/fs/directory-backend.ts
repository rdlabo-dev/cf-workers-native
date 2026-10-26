import { temporary, embeddedStat, pathOf } from "./writable.js";
export interface DirEntryHandle {
  name: string;
  parentPath: string;
  type: number;
}
export function readDirectory(
  path: unknown,
  recursive: boolean,
): DirEntryHandle[] {
  const normalized = pathOf(path);
  const list = (directory: string): DirEntryHandle[] => {
    if (directory === "/")
      return ["bundle", "tmp", "dev"].map((name) => ({
        name,
        parentPath: "/",
        type: 2,
      }));
    if (directory === "/dev")
      return ["null", "zero", "full", "random"].map((name) => ({
        name,
        parentPath: "/dev",
        type: 6,
      }));
    embeddedStat(directory);
    return temporary
      .readdirSync(directory, { withFileTypes: true, encoding: "buffer" })
      .map((entry: any) => ({
        name: String(entry.name),
        parentPath: directory,
        type: entry.isDirectory()
          ? 2
          : entry.isFile()
            ? 1
            : entry.isSymbolicLink()
              ? 3
              : entry.isFIFO()
                ? 4
                : entry.isSocket()
                  ? 5
                  : entry.isCharacterDevice()
                    ? 6
                    : entry.isBlockDevice()
                      ? 7
                      : 0,
      }));
  };
  const entries: DirEntryHandle[] = [];
  const visit = (directory: string, prefix: string) => {
    for (const entry of list(directory)) {
      const name = prefix + entry.name;
      entries.push({ ...entry, name });
      if (recursive && entry.type === 2)
        visit(
          (directory === "/" ? "" : directory) + "/" + entry.name,
          name + "/",
        );
    }
  };
  visit(
    normalized,
    recursive && normalized !== "/" ? normalized.slice(1) + "/" : "",
  );
  return entries;
}
