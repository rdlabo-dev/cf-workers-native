/** Shared attachment behavior; canonical representation differences are confined
 * to the separate boundary probe, not removed from ordinary limit coverage. */
export async function observeAttachments(api) {
  const socket = new api.WebSocketPair()[0];
  const failure = (action) => {
    try {
      action();
      return null;
    } catch (error) {
      return { name: error.name, message: error.message };
    }
  };
  const initial = socket.deserializeAttachment();
  const missing = failure(() => socket.serializeAttachment());
  socket.serializeAttachment(undefined);
  const undefinedValue = socket.deserializeAttachment() === undefined;
  const input = {
    child: { value: 1 },
    map: new Map(),
    set: new Set(),
    view: new Uint8Array([1, 2, 3]),
  };
  input.self = input;
  input.map.set(input.child, input);
  input.set.add(input.child);
  socket.serializeAttachment(input);
  input.child.value = 2;
  input.view.fill(9);
  const first = socket.deserializeAttachment();
  const graph = [
    first.self === first,
    first.map.get(first.child) === first,
    first.set.has(first.child),
    first.child.value,
    [...first.view],
  ];
  first.child.value = 3;
  const independent = socket.deserializeAttachment().child.value;
  const sizes = [];
  for (const make of [(n) => "x".repeat(n), (n) => new ArrayBuffer(n)]) {
    socket.serializeAttachment(make(16379));
    sizes.push(failure(() => socket.serializeAttachment(make(16380))));
    const preserved = socket.deserializeAttachment();
    sizes.push(
      typeof preserved === "string" ? preserved.length : preserved.byteLength,
    );
  }
  const unsupported = [
    () => {},
    Symbol("x"),
    new WeakMap(),
    new api.Request("https://a/", { method: "POST", body: "body" }),
    new api.Response("body"),
    socket,
  ];
  const rejections = unsupported.map(
    (value) => failure(() => socket.serializeAttachment(value))?.name,
  );
  const error = new Error("hello", { cause: { value: 1 } });
  error.stack = "stack";
  Object.defineProperty(error, "hidden", { value: "kept" });
  const dom = new DOMException("hello", "AbortError");
  dom.stack = "stack";
  const types = [
    new api.Blob(["abc"], { type: "text/plain" }),
    new api.Headers({ "x-test": "a" }),
    new api.Request("https://a/"),
    new api.Response(null),
    error,
    dom,
    Object(1n),
    new Date(123),
    /a/gi,
  ];
  const clones = [];
  for (const value of types) {
    socket.serializeAttachment(value);
    const copy = socket.deserializeAttachment();
    if (copy instanceof api.Blob) clones.push([copy.type, await copy.text()]);
    else if (copy instanceof api.Headers) clones.push([...copy]);
    else if (copy instanceof api.Request)
      clones.push([copy.url, copy.method, [...copy.headers]]);
    else if (copy instanceof api.Response)
      clones.push([copy.status, copy.statusText, [...copy.headers]]);
    else if (copy instanceof Error)
      clones.push([
        copy.name,
        copy.message,
        copy.stack,
        copy.cause,
        copy.hidden,
      ]);
    else if (copy instanceof DOMException)
      clones.push([copy.name, copy.message, copy.stack]);
    else if (copy instanceof Date) clones.push(+copy);
    else if (copy instanceof RegExp)
      clones.push([copy.source, copy.flags, copy.lastIndex]);
    else clones.push(String(copy.valueOf()));
  }
  let getterCalls = 0;
  socket.serializeAttachment({
    get value() {
      getterCalls++;
      return 1;
    },
  });
  socket.deserializeAttachment();
  socket.deserializeAttachment();
  // Wasm supplies a real shared buffer even where the global constructor is hidden.
  const sharedBuffer = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  }).buffer;
  socket.serializeAttachment(sharedBuffer);
  const shared = failure(() => socket.deserializeAttachment());
  const sharedView = new Uint8Array(sharedBuffer, 0, 1);
  socket.serializeAttachment({ sharedBuffer, sharedView });
  const sharedViewResult = failure(() => socket.deserializeAttachment());
  const wasm = {};
  wasm.unshared = failure(() =>
    socket.serializeAttachment(new WebAssembly.Memory({ initial: 0 })),
  );
  socket.serializeAttachment(
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }),
  );
  wasm.shared = failure(() => socket.deserializeAttachment());
  socket.serializeAttachment(api.wasmModule);
  wasm.module = failure(() => socket.deserializeAttachment());
  const pairFailure = failure(() =>
    socket.serializeAttachment(new api.WebSocketPair()),
  );
  const formFailure = failure(() => socket.serializeAttachment(new FormData()));
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"],
  );
  const keyFailure = failure(() => socket.serializeAttachment(key));
  return {
    initial,
    missing,
    undefinedValue,
    graph,
    independent,
    sizes,
    rejections,
    clones,
    getterCalls,
    shared,
    sharedViewResult,
    wasm,
    pairFailure,
    formFailure,
    keyFailure,
  };
}

export const expectedAttachments = {
  initial: null,
  missing: {
    name: "TypeError",
    message:
      "Failed to execute 'serializeAttachment' on 'WebSocket': parameter 1 is not of type 'Value'.",
  },
  undefinedValue: true,
  graph: [true, true, true, 1, [1, 2, 3]],
  independent: 1,
  sizes: [
    {
      name: "Error",
      message:
        "A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was 16385 bytes.",
    },
    16379,
    {
      name: "Error",
      message:
        "A WebSocket 'attachment' cannot be larger than 16384 bytes.'attachment' was 16385 bytes.",
    },
    16379,
  ],
  rejections: [
    "DataCloneError",
    "DataCloneError",
    "DataCloneError",
    "DataCloneError",
    "DataCloneError",
    "DataCloneError",
  ],
  clones: [
    ["text/plain", "abc"],
    [["x-test", "a"]],
    ["https://a/", "GET", []],
    [200, "OK", []],
    [
      "Error",
      "hello",
      "stack",
      {
        value: 1,
      },
      "kept",
    ],
    ["AbortError", "hello", "stack", null, null],
    "1",
    123,
    ["a", "gi", 0],
  ],
  getterCalls: 1,
  shared: {
    name: "Error",
    message: "Unable to deserialize cloned data.",
  },
  sharedViewResult: {
    name: "Error",
    message: "Unable to deserialize cloned data.",
  },
  wasm: {
    unshared: {
      name: "DataCloneError",
      message: "#<Memory> could not be cloned.",
    },
    shared: { name: "Error", message: "Unable to deserialize cloned data." },
    module: { name: "Error", message: "Unable to deserialize cloned data." },
  },
  pairFailure: {
    name: "DataCloneError",
    message:
      'Could not serialize object of type "WebSocketPair". This type does not support serialization.',
  },
  formFailure: {
    name: "DataCloneError",
    message:
      'Could not serialize object of type "FormData". This type does not support serialization.',
  },
  keyFailure: {
    name: "DataCloneError",
    message:
      'Could not serialize object of type "CryptoKey". This type does not support serialization.',
  },
};
