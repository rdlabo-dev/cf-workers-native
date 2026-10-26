export {
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
  ERR_MISSING_ARGS,
} from "../net/errors.js";
export {
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_STREAM_DESTROYED,
} from "../stream/errors.js";
import { NodeError } from "../net/errors.js";
export class ERR_SYSTEM_ERROR extends NodeError {
  constructor(message: string) {
    super("ERR_SYSTEM_ERROR", message);
  }
}
