// A directly hosted Worker may be the only user of async propagation in the
// page. Standalone AsyncLocalStorage instances retain their realm lifetime.
export const requestStorageOptions = {};
let owners = 0;
let permanent = false;
let restore: (() => void) | undefined;
let installer: (() => void) | undefined;

function install() {
  if (restore || !installer) return;
  const slots: [object, PropertyKey][] = [
    [Promise.prototype, "then"],
    ...[
      "queueMicrotask",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "MessageChannel",
    ].map((name): [object, PropertyKey] => [globalThis, name]),
  ];
  const before = slots.map(([target, name]) =>
    Object.getOwnPropertyDescriptor(target, name),
  );
  installer();
  const after = slots.map(([target, name]) => Reflect.get(target, name));
  restore = () => {
    slots.forEach(([target, name], i) => {
      if (
        Reflect.get(target, name) !== after[i] ||
        before[i]?.value === after[i]
      )
        return;
      if (before[i]) Object.defineProperty(target, name, before[i]!);
      else Reflect.deleteProperty(target, name);
    });
  };
}

export function usePropagation(options: unknown, patch: () => void) {
  installer = patch;
  if (options !== requestStorageOptions || owners === 0) permanent = true;
  install();
}

export function retainPropagation() {
  owners++;
  install();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners || permanent) return;
    restore?.();
    restore = undefined;
  };
}
