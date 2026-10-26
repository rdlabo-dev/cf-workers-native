// From pinned workerd internal_errors.ts (Apache-2.0 / Node MIT).
import { NodeError } from "../net/error-base.js";
export class ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS extends NodeError {
  constructor(type: string, reason: string) {
    super(
      "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS",
      `The selected key encoding ${type} ${reason}.`,
    );
  }
}
export class ERR_INCOMPATIBLE_OPTION_PAIR extends NodeError {
  constructor(a: string, b: string) {
    super(
      "ERR_INCOMPATIBLE_OPTION_PAIR",
      `The options "${a}" and "${b}" are mutually exclusive.`,
    );
  }
}
export class ERR_MISSING_OPTION extends NodeError {
  constructor(name: string) {
    super("ERR_MISSING_OPTION", name);
  }
}
