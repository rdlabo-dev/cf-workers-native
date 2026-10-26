import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../..", import.meta.url));
const read = (file) => fs.readFileSync(path.resolve(root, file), "utf8");
const base = JSON.parse(
  read("demo/tests/experiments/node-compat/exports.json"),
);
const types = JSON.parse(
  read("demo/tests/experiments/node-compat/export-types.json"),
);
const reviewed = JSON.parse(
  read("demo/tests/experiments/node-compat/api-test-operations.json"),
);
const gaps = JSON.parse(
  read("demo/tests/experiments/node-compat/surface-gaps.json"),
);
const shared = read("src/tooling/shared.ts");
const entries = Object.fromEntries(
  [
    ...shared
      .slice(
        shared.indexOf("const builtins:"),
        shared.indexOf("function builtinAliases"),
      )
      .matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"/g),
  ].map(([, name, entry]) => [
    name.replace(/^node:/, ""),
    "src/compat/" + entry.replace(/\.(c?js)$/, ".ts"),
  ]),
);
const inventory = {
  modules: Object.keys(base.modules).map((module) => ({
    module,
    entry: entries[module],
  })),
};
const walk = (d) =>
  fs
    .readdirSync(path.resolve(root, d), { withFileTypes: true })
    .flatMap((x) =>
      x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)],
    );
const cases = [];
for (const file of walk("src/compat").filter((x) =>
  /\.(spec|fixture)\.[cm]?[jt]s$/.test(x),
)) {
  const source = read(file),
    tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "explicitResourceManagement"],
    });
  const name = (n) => n?.key?.name ?? n?.key?.value ?? n?.id?.name;
  const add = (id, node, kind) =>
    cases.push({
      id: file + "#" + id,
      file,
      name: id,
      kind,
      code: source.slice(node.start, node.end),
    });
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "ObjectProperty" &&
      name(n) === "cases" &&
      n.value.type === "ObjectExpression"
    )
      for (const p of n.value.properties)
        if (name(p)) add(name(p), p, "contract");
    if (
      n.type === "VariableDeclarator" &&
      n.init?.type === "ObjectExpression"
    ) {
      if (/Cases$/.test(name(n))) {
        for (const p of n.init.properties)
          if (name(p)) add(name(p), p, "comparison");
      } else if (n.init.properties.some((p) => name(p) === "test"))
        add(name(n), n.init, "fixture");
    }
    if (
      n.type === "CallExpression" &&
      ["test", "it"].includes(source.slice(n.callee.start, n.callee.end)) &&
      n.arguments[0]?.type === "StringLiteral"
    )
      add(n.arguments[0].value, n, "unit");
    for (const [k, v] of Object.entries(n))
      if (k !== "loc") {
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
  };
  visit(tree);
}
const special = {
  "fs/promises": "fs",
  "path/posix": "path",
  "path/win32": "path",
  "util/types": "util",
  _tls_wrap: "tls",
  _stream_wrap: "tls",
};
const inputName = {
  fs: "fs",
  crypto: "crypto",
  zlib: "zlib",
  util: "util",
  sys: "sys",
  "util/types": "types",
  tls: "tls",
  http: "http",
  process: "process",
  console: "console",
  module: "module",
  stream: "classicStreams",
  "stream/web": "streams",
  _http_common: "httpCommon",
  _http_outgoing: "httpOutgoing",
  _http_server: "httpServer",
};
const rows = [];
for (const m of inventory.modules) {
  const owner = special[m.module]
    ? inventory.modules.find((x) => x.module === special[m.module])
    : m;
  const dir = path.dirname(owner.entry);
  let selected = cases.filter((c) => c.file.startsWith(dir + "/"));
  if (inputName[m.module])
    selected.push(
      ...cases.filter(
        (c) =>
          c.file.includes("/expansion/") &&
          new RegExp("\\b" + inputName[m.module] + "\\b").test(
            c.code.slice(0, c.code.indexOf("})") + 2),
          ),
      ),
    );
  const entries = base.modules[m.module].map((exp) => {
    const escaped = exp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matched = selected.filter((c) =>
      new RegExp("\\b" + escaped + "\\b").test(c.code),
    );
    return {
      name: exp,
      type: types.modules[m.module][exp],
      surfaceTest: "demo/tests/experiments/node-compat/local-surface.test.mjs",
      missingInPinnedSurfaceAudit:
        gaps.common[m.module]?.missing?.includes(exp) ?? false,
      reviewedOperations: reviewed.operations
        .filter(
          (operation) =>
            operation.modules.includes(m.module) &&
            operation.apis.some(
              (api) => api === exp || api.startsWith(exp + "."),
            ),
        )
        .map((operation) => operation.id),
      cases: matched.map((c) => c.id),
    };
  });
  rows.push({ module: m.module, entry: m.entry, exports: entries });
}
export const referenceIndex = {
  scope:
    "Source reference index, not behavioral coverage certification. Token matches are navigation candidates; reviewed operation rows are in api-test-operations.json. Every export also has the name/type inventory audit in local-surface.test.mjs.",
  profile: base.profile,
  modules: rows,
  cases: cases.map(({ code, ...c }) => c),
};
if (process.argv.includes("--write")) {
  fs.mkdirSync(
    path.resolve(root, "artifacts/validation/existing-api-coverage"),
    {
      recursive: true,
    },
  );
  fs.writeFileSync(
    path.resolve(
      root,
      "artifacts/validation/existing-api-coverage/api-test-map.json",
    ),
    JSON.stringify(referenceIndex, null, 2) + "\n",
  );
}
