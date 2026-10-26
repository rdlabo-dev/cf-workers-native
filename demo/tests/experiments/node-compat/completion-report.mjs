import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const assessments = [
  {
    modules: ["events"],
    priority: 1,
    category: "implementation-and-host-integration",
    next: "Public events imports implement the explicitly scoped WebView profile, including process warning delivery and nextTick scheduling. Keep native async and V8 inspection boundaries explicit; this is not unrestricted Workers or process-module certification. See the profile and generated acceptance evidence.",
    evidence: [
      "surface-gaps.json",
      "events-baseline.probe.mjs",
      "events-surface.probe.mjs",
      "events-contracts.probe.mjs",
      "events-native.mjs",
      "../../../../src/compat/events/README.md",
      "../../../../src/compat/async-hooks/README.md",
    ],
  },
  {
    modules: ["crypto", "zlib"],
    priority: 2,
    category: "implementation-gap",
    next: "Inventory algorithms, key/codec classes, synchronous and streaming behavior. Evaluate JS/Wasm implementations against all pinned operations; random/Hash/HMAC/PBKDF2/HKDF/scrypt, owned secret/asymmetric keys, RSA/EC/Ed25519 signatures, prime generation/checking X509Certificate parsing/fields/name checks/signature checks and cipher metadata lookup now supplement dependency polyfills. Gzip/deflate now use zlib Wasm; all codec streams use the pinned Workers lifecycle, with option, reset, close, callback and output-limit contracts. Pinned Workers X509 key-check restrictions are documented. The pinned 17 digest names, copying, finalization and KDF length limits have shared contracts; Float16Array input-brand coverage depends on engine availability recorded in native measurements. Additional key-generation options, remaining algorithms and complete codec contracts remain open. No technical-impossibility claim has been established.",
    evidence: [
      "surface-gaps.json",
      "expansion-contracts.probe.mjs",
      "expansion-native.mjs",
      "../../../../src/compat/expansion/README.md",
    ],
  },
  {
    modules: ["fs", "fs/promises"],
    priority: 2,
    category: "implementation-gap",
    next: "Compare the Workers virtual filesystem, descriptors, FileHandle, writes, permissions and watch behavior. Request-local memory-backed /tmp now supports writes, descriptors and FileHandle; permission no-ops, statfs and embedded-file copying are tested; embedded descriptors/FileHandles, links, immutable copies, cp options, millisecond timestamps and readonly metadata are also compared. Devices, directory iteration, glob, stream fd/custom-fs options, byte streams, URL normalization, FD reuse and request-local cwd now have upstream and comparative coverage. Complete the remaining per-operation/option inventory and all-platform acceptance; these cases do not certify the whole module.",
    evidence: [
      "../../../../src/compat/fs/index.ts",
      "../../../../src/compat/fs/promises/index.ts",
    ],
  },
  {
    modules: ["process", "console"],
    priority: 2,
    category: "implementation-and-host-integration",
    next: "Configuration, environment-file loading and standard stream input now have shared behavioral contracts. abort, reallyExit and getBuiltinModule remain unimplemented; termination and builtin lookup require host integration. Audit the remaining process/console operations independently; selected cases do not certify the modules.",
    evidence: ["surface-gaps.json"],
  },
  {
    modules: ["util", "util/types", "sys", "assert", "assert/strict"],
    priority: 3,
    category: "engine-boundary",
    next: "Separate ordinary JS algorithms and sys alias routing from unobservable proxy/promise state, call sites and host brands. Closing the export list will not complete these modules or assertion diagnostics.",
    evidence: [
      "engine-boundaries.probe.mjs",
      "../../../../src/compat/util/README.md",
    ],
  },
  {
    modules: ["async_hooks", "diagnostics_channel"],
    priority: 3,
    category: "engine-boundary",
    next: "Test native async continuation and concurrent request isolation. Build-time lowering supports a bounded profile but changes observable Promise behavior; do not classify arbitrary async code as complete.",
    evidence: ["engine-boundaries.probe.mjs", "async-transform.probe.mjs"],
  },
  {
    modules: ["worker_threads"],
    priority: 3,
    category: "engine-boundary",
    next: "Reconcile MessagePort scheduling, trusted event branding and serialization. Native and synthetic ports have different observable behavior; the current adapter does not supply Node threads.",
    evidence: ["message-port-boundaries.probe.mjs"],
  },
  {
    modules: ["stream/web"],
    priority: 2,
    category: "behavior-gap",
    next: "The owned stream implementation now matches tested Workers tee cancellation reasons and pending pipeTo abort timing. Complete the remaining operation/state inventory and native integration acceptance; raw host boundary probes describe host forwarding, not this adapter.",
    evidence: ["stream-boundaries.probe.mjs"],
  },
  {
    modules: ["module"],
    priority: 3,
    category: "implementation-and-host-integration",
    next: "Audit Workers module resolution and loader/stub behavior. VFS JSON loading and bundling are the current limits; separately evaluate executable resolution and engine compile-cache APIs.",
    evidence: ["../../../../src/compat/module/index.ts", "surface-gaps.json"],
  },
  {
    modules: [
      "tls",
      "_tls_wrap",
      "_stream_wrap",
      "_http_common",
      "_http_outgoing",
      "_http_server",
      "http",
      "https",
      "net",
      "_tls_common",
      "_http_agent",
      "_http_client",
      "_http_incoming",
    ],
    priority: 2,
    category: "implementation-and-native-transport",
    next: "Direct TLS and same-connection STARTTLS exchange/hostname rejection are tested in page and Dedicated Worker on both OSes. TLS 1.2/1.3 and repeated write-half-close are covered on both OSes; custom Duplex wrapping remains unsupported. Native WS/WSS, compression/context takeover, pair and attachment contracts are included, with only the documented engine-private attachment-size boundary. Audit remaining class/prototype/state/event contracts; these scenarios do not certify the whole TLS/server/WebSocket API.",
    evidence: ["surface-gaps.json", "../../../../docs/compatibility.md"],
  },
  {
    modules: ["dns", "dns/promises"],
    priority: 2,
    category: "behavior-gap",
    next: "Verify Workers synthetic Service Binding/Hyperdrive addresses as well as DNS-over-HTTPS and errors; public DNS success does not cover these overrides.",
    evidence: ["../../../../docs/compatibility.md"],
  },
  {
    modules: [
      "child_process",
      "cluster",
      "dgram",
      "vm",
      "v8",
      "wasi",
      "sqlite",
      "inspector",
      "inspector/promises",
      "repl",
      "tty",
      "trace_events",
    ],
    priority: 3,
    category: "workers-stub-profile",
    next: "Audit every operation against the pinned profile, preserving actual rejection/no-op behavior. A module in this group is not necessarily wholly nonfunctional; retained functional methods and validation still require acceptance.",
    evidence: [
      "../../../../src/compat/README.md",
      "engine-boundaries.probe.mjs",
    ],
  },
];

export function completionReport(baseline, reports) {
  const names = Object.keys(baseline.modules).sort();
  const covered = new Map();
  for (const item of assessments)
    for (const name of item.modules) {
      assert.ok(names.includes(name), `Unknown assessment module: ${name}`);
      assert.ok(!covered.has(name), `Duplicate assessment: ${name}`);
      covered.set(name, item);
    }
  for (const [engine, report] of Object.entries(reports)) {
    assert.deepEqual(
      report.profile,
      baseline.profile,
      `${engine}: mismatched Workers profile`,
    );
    assert.deepEqual(
      Object.keys(report.modules).sort(),
      names,
      `${engine}: incomplete inventory`,
    );
  }
  assert.deepEqual(Object.keys(reports).sort(), ["chromium", "webkit"]);
  const modules = Object.fromEntries(
    names.map((name) => {
      const engines = Object.fromEntries(
        Object.entries(reports).map(([engine, report]) => {
          const value = report.modules[name];
          if (!value.buildError && !value.evaluationError) {
            assert.ok(
              value.surface &&
                Array.isArray(value.missing) &&
                Array.isArray(value.extra),
              `${engine}/${name}: missing surface evidence`,
            );
            assert.ok(
              value.typeMismatches && typeof value.typeMismatches === "object",
              `${engine}/${name}: missing type audit`,
            );
          }
          return [
            engine,
            {
              missing: value.missing ?? [],
              extra: value.extra ?? [],
              typeMismatches: value.typeMismatches ?? {},
              ...(value.buildError ? { buildError: value.buildError } : {}),
              ...(value.evaluationError
                ? { evaluationError: value.evaluationError }
                : {}),
            },
          ];
        }),
      );
      const gaps = Object.values(engines).some(
        (value) =>
          value.buildError ||
          value.evaluationError ||
          value.missing.length ||
          value.extra.length ||
          Object.keys(value.typeMismatches).length,
      );
      const { modules: ignored, ...assessment } = covered.get(name) ?? {
        priority: 2,
        category: "verification-gap",
        next: "Existing contracts and matching exports do not certify a whole module. Finish operation/prototype inventory, invalid inputs, state, cleanup, build integration and iOS/Android acceptance before promotion.",
        evidence: ["../../../../src/compat/README.md"],
      };
      return [
        name,
        {
          status: gaps ? "surface-gaps" : "surface-aligned-not-certified",
          ...assessment,
          engines,
        },
      ];
    }),
  );
  return {
    profile: baseline.profile,
    scope:
      "Import/export and type audit plus implementation triage. Not whole-module behavioral or native acceptance. Priority is an investigation order, not a feasibility guarantee.",
    summary: {
      modules: names.length,
      withSurfaceGaps: Object.values(modules).filter(
        (m) => m.status === "surface-gaps",
      ).length,
      surfaceAligned: Object.values(modules).filter(
        (m) => m.status === "surface-aligned-not-certified",
      ).length,
      certifiedCompleteByThisAudit: 0,
    },
    modules,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const read = async (url) => JSON.parse(await readFile(url, "utf8"));
  const artifacts = new URL(
    "../../../artifacts/node-inventory/",
    import.meta.url,
  );
  const baseline = await read(new URL("exports.json", import.meta.url));
  const reports = Object.fromEntries(
    await Promise.all(
      ["chromium", "webkit"].map(async (engine) => [
        engine,
        await read(new URL(`${engine}-surface.json`, artifacts)),
      ]),
    ),
  );
  const report = completionReport(baseline, reports);
  await writeFile(
    new URL("completion.json", artifacts),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(
    "Report: demo/artifacts/node-inventory/completion.json; successful generation is not compatibility acceptance.",
  );
  if (process.argv.includes("--require-complete")) {
    console.error(
      "No whole-module certification is supplied by an import/export audit.",
    );
    process.exitCode = 1;
  }
}
