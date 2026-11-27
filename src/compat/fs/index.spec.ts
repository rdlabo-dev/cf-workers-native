import {
  defineFeature,
  FeatureImplementation,
} from "cf-workers-native/shared/contracts";
import type { ContractSuite } from "cf-workers-native/shared/contracts/testing";
import * as fs from "./index.js";
export const fsFeature = defineFeature<typeof fs>()("node.fs", [
  "readFileSync",
  "copyFileEntry",
  "readFileCallback",
  "wholeFileDanglingLink",
  "promises",
  "readdirSync",
  "existsSync",
  "statSync",
  "realpathSync",
  "enoent",
]);
const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};
const enoent = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Expected ENOENT");
};
export const fsContract: ContractSuite<typeof fsFeature> = {
  feature: fsFeature,
  cases: {
    copyFileEntry(api) {
      const root = api.mkdtempSync("/tmp/copy-contract-");
      try {
        api.mkdirSync(root + "/files");
        api.symlinkSync(root + "/files", root + "/alias");
        api.writeFileSync(root + "/source", "replacement");
        api.writeFileSync(root + "/files/destination", "original");
        for (let i = 0; i < 3; i++)
          api.copyFileSync(root + "/source", root + "/alias/destination");
        equal(
          api.readFileSync(root + "/files/destination", "utf8"),
          "replacement",
        );
        api.unlinkSync(root + "/files/destination");
        api.rmdirSync(root + "/files");
        equal(api.existsSync(root + "/files"), false);
      } finally {
        api.rmSync(root, { recursive: true, force: true });
      }
    },
    readFileSync(api) {
      equal(api.readFileSync("/app/dist/a.txt", "utf8"), "alpha");
      equal(api.readFileSync("/app/dist/a.txt", { encoding: "utf8" }), "alpha");
      const bytes = api.readFileSync("/app/dist/a.txt") as Uint8Array;
      equal(bytes.length, 5);
    },
    async wholeFileDanglingLink(api) {
      const link = "/tmp/whole-file-dangling-link";
      const target = "/tmp/whole-file-absent-target";
      api.symlinkSync(target, link);
      try {
        for (const write of [api.promises.writeFile, api.promises.appendFile]) {
          let code;
          try {
            await write(link, "data");
          } catch (error) {
            code = (error as { code?: string }).code;
          }
          equal(code, "EEXIST");
          equal(api.readlinkSync(link), target);
          equal(api.existsSync(target), false);
        }
      } finally {
        api.unlinkSync(link);
      }
    },
    async readFileCallback(api) {
      await new Promise<void>((resolve, reject) => {
        api.readFile(
          "/app/dist/a.txt",
          "utf8",
          (err: unknown, data: unknown) => {
            try {
              equal(err, null);
              equal(data, "alpha");
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        );
      });
    },
    async promises(api) {
      equal(await api.promises.readFile("/app/dist/a.txt", "utf8"), "alpha");
      equal(await api.promises.readdir("/app/dist"), ["a.txt", "b.json"]);
      equal((await api.promises.stat("/app/dist/a.txt")).size, 5);
      await api.promises.access("/app/dist/a.txt");
      await api.promises.access("/nope").then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: { code?: string }) => equal(error.code, "ENOENT"),
      );
    },
    readdirSync(api) {
      equal(api.readdirSync("/app/dist"), ["a.txt", "b.json"]);
      equal(api.readdirSync("/app"), ["dist"]);
      enoent(() => api.readdirSync("/missing"));
    },
    existsSync(api) {
      equal(api.existsSync("/app/dist/a.txt"), true);
      equal(api.existsSync("/app/dist"), true);
      equal(api.existsSync("/missing"), false);
    },
    statSync(api) {
      const file = api.statSync("/app/dist/a.txt");
      equal(file.isFile(), true);
      equal(file.isDirectory(), false);
      equal(file.size, 5);
      const dir = api.statSync("/app/dist");
      equal(dir.isDirectory(), true);
      equal(dir.isFile(), false);
      equal(api.lstatSync("/app/dist/a.txt").isFile(), true);
    },
    realpathSync(api) {
      equal(api.realpathSync("/app/./dist/../dist/a.txt"), "/app/dist/a.txt");
      enoent(() => api.realpathSync("/missing"));
    },
    enoent(api) {
      enoent(() => api.readFileSync("/missing"));
      enoent(() => api.statSync("/missing"));
    },
  },
};
export class FsImplementation extends FeatureImplementation<typeof fsFeature> {
  constructor(private readonly api = fs) {
    super(fsFeature, {
      readFileSync: { status: "supported" },
      copyFileEntry: { status: "supported" },
      readFileCallback: { status: "supported" },
      wholeFileDanglingLink: { status: "supported" },
      promises: { status: "supported" },
      readdirSync: { status: "supported" },
      existsSync: { status: "supported" },
      statSync: { status: "supported" },
      realpathSync: { status: "supported" },
      enoent: { status: "supported" },
    });
  }
  create() {
    fs.registerVirtualFiles({
      "/app/dist/a.txt": "alpha",
      "/app/dist/b.json": "{}",
    });
    return this.api;
  }
}
