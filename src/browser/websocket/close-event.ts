import { int32 } from "./conversion.js";
import { dictionary, webString } from "../body/index.js";

/** Workers exposes these fields as readonly own properties, not DOM getters. */
export class CloseEvent extends Event {
  declare readonly wasClean: boolean;
  declare readonly reason: string;
  declare readonly code: number;
  constructor(type: string, init: CloseEventInit = {}) {
    if (!arguments.length)
      throw new TypeError(
        "Failed to construct 'CloseEvent': constructor parameter 1 is not of type 'string'.",
      );
    const name = webString(type);
    const options = dictionary(init ?? {});
    super(name, options as EventInit);
    const codeValue = options.code;
    const code = codeValue === undefined ? 0 : int32(codeValue);
    const reasonValue = options.reason;
    const reason = reasonValue === undefined ? "" : webString(reasonValue);
    const wasClean = Boolean(options.wasClean);
    for (const [key, value] of Object.entries({ wasClean, reason, code }))
      Object.defineProperty(this, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: false,
      });
  }
}
Object.defineProperty(CloseEvent, "length", { value: 0 });
Object.defineProperty(CloseEvent, "name", { value: "CloseEvent" });
Object.defineProperty(CloseEvent.prototype, Symbol.toStringTag, {
  value: "CloseEvent",
  configurable: true,
});
