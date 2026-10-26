// Workers CipherHandle/AeadHandle lifecycle, pinned to workerd
// 5358e3d337336eaf696a48bc1563d808b10feba5 (crypto.c++), Apache-2.0.
import { library, inputs, output, size } from "./native-cipher.js";
import { secretMaterial } from "./keys.js";
import { bufferBytes, viewBytes } from "../../shared/buffer-source.js";
import { isAnyBuffer } from "./validation.js";
const aeadNames = new Set([
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "aes-128-eax",
  "aes-256-eax",
  "aes-128-ccm-matter",
  "aes-128-ccm-bluetooth",
  "aes-128-ccm-bluetooth-8",
  "aes-128-gcm-randnonce",
  "aes-256-gcm-randnonce",
  "aes-128-gcm-siv",
  "aes-256-gcm-siv",
  "aes-128-ctr-hmac-sha256",
  "aes-256-ctr-hmac-sha256",
  "xchacha20-poly1305",
  "chacha20-poly1305",
]);
const finalized = "Cipher/decipher context has already been finalized";
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function bytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (isAnyBuffer(value)) return bufferBytes(value);
  if (ArrayBuffer.isView(value)) return viewBytes(value);
  throw new TypeError("Expected an ArrayBuffer or ArrayBufferView");
}
const released = new FinalizationRegistry<{ pointer: number; aead: boolean }>(
  ({ pointer, aead }) =>
    library()[aead ? "cipher_aead_free" : "cipher_free"](pointer),
);
const validTag = (n: number) => n === 4 || n === 8 || (n >= 12 && n <= 16);
export class CipherHandle {
  private pointer = 0;
  private aead = false;
  private auth = false;
  private mode = 0;
  private block = 1;
  private iv: Uint8Array;
  private aad?: Uint8Array;
  private tag?: Uint8Array;
  private tagLength?: number;
  private tagPassed = false;
  private updated = false;
  private decrypt: boolean;
  constructor(
    direction: number,
    algorithm: string,
    key: unknown,
    iv: ArrayBuffer | ArrayBufferView,
    tagLength?: number,
  ) {
    this.decrypt = direction === 1;
    this.iv = bytes(iv).slice();
    this.tagLength = tagLength;
    const material = secretMaterial(key),
      raw = bytes(material);
    try {
      inputs(
        [algorithm, algorithm.toLowerCase().replaceAll("-", "_"), raw, this.iv],
        (api, [name, aeadName, k, v]) => {
          const cipher = api.cipher_lookup(name);
          if (cipher) {
            this.mode = api.cipher_info(cipher, 3);
            this.auth = this.mode === 6;
            this.block = api.cipher_info(cipher, 2);
            const expected = api.cipher_info(cipher, 1);
            requireValue(
              !(expected && !this.iv.length) &&
                !(!this.auth && this.iv.length && this.iv.length !== expected),
              "Invalid initialization vector",
            );
            this.pointer = api.cipher_new();
            requireValue(
              this.pointer,
              "Failed to create cipher/decipher context",
            );
            requireValue(
              api.cipher_init(this.pointer, cipher, 0, 0, +!this.decrypt),
              "Failed to initialize cipher/decipher context",
            );
            if (this.auth) {
              requireValue(
                api.cipher_iv_size(this.pointer, this.iv.length),
                "Invalid initialization vector",
              );
              requireValue(
                tagLength === undefined || validTag(tagLength),
                "Invalid authentication tag length",
              );
            }
            requireValue(
              api.cipher_key_size(this.pointer, raw.length),
              "Invalid key length",
            );
            requireValue(
              api.cipher_init(this.pointer, 0, k, v, +!this.decrypt),
              "Failed to initialize cipher/cipher context",
            );
          } else {
            const aead = aeadNames.has(algorithm.toLowerCase())
              ? api.cipher_aead(aeadName)
              : 0;
            requireValue(aead, "Unknown or unsupported cipher: " + algorithm);
            this.aead = true;
            this.auth = true;
            this.mode = algorithm.toLowerCase().includes("gcm")
              ? 6
              : algorithm.toLowerCase().includes("ccm")
                ? 7
                : 0;
            requireValue(
              this.iv.length === api.cipher_aead_info(aead, 1),
              "Invalid initialization vector",
            );
            this.pointer = api.cipher_aead_new(
              aead,
              k,
              raw.length,
              tagLength ?? 0,
            );
            requireValue(
              this.pointer,
              "Failed to initialize AEAD cipher/decipher context",
            );
            if (this.mode === 6)
              requireValue(
                tagLength === undefined || validTag(tagLength),
                "Invalid authentication tag length",
              );
            else if (tagLength === undefined) {
              requireValue(
                algorithm.toLowerCase() === "chacha20-poly1305",
                "The auth tag length is required for cipher " + algorithm,
              );
              this.tagLength = 16;
            }
          }
        },
      );
      released.register(this, { pointer: this.pointer, aead: this.aead }, this);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private dispose() {
    if (this.pointer) {
      library()[this.aead ? "cipher_aead_free" : "cipher_free"](this.pointer);
      this.pointer = 0;
      released.unregister(this);
    }
    this.iv.fill(0);
    this.aad?.fill(0);
  }
  private passTag() {
    if (this.decrypt && this.auth && !this.tagPassed) {
      this.tagPassed = true;
      requireValue(this.tag, "No auth tag provided");
      inputs([this.tag], (api, [p]) =>
        requireValue(
          api.cipher_tag(this.pointer, 0, this.tag!.length, p),
          "Failed to set auth tag",
        ),
      );
    }
  }
  update(value: ArrayBuffer | ArrayBufferView) {
    if (this.aead)
      requireValue(
        !this.updated,
        "update() can only be invoked once on an AEAD",
      );
    requireValue(this.pointer, finalized);
    const data = bytes(value);
    requireValue(data.length <= 0x7fffffff, "Data too large");
    if (this.mode === 7)
      requireValue(data.length <= 65535, "Invalid message length");
    requireValue(data.length + this.block <= 0x7fffffff, "Data too large");
    if (this.aead) {
      if (this.decrypt) requireValue(this.tag, "No auth tag provided");
      else this.tagLength ??= 16;
      const tagLength = this.decrypt ? this.tag!.length : this.tagLength!;
      const result = inputs(
        [
          data,
          this.iv,
          this.aad ?? new Uint8Array(),
          this.tag ?? tagLength,
          data.length,
          4,
        ],
        (api, [d, v, a, t, o, n]) => {
          const ok = this.decrypt
            ? api.cipher_aead_open(
                this.pointer,
                o,
                v,
                this.iv.length,
                d,
                data.length,
                t,
                tagLength,
                a,
                this.aad?.length ?? 0,
              )
            : api.cipher_aead_seal(
                this.pointer,
                o,
                t,
                n,
                tagLength,
                v,
                this.iv.length,
                d,
                data.length,
                a,
                this.aad?.length ?? 0,
              );
          // Workers exposes this backend failure as an internal Error with a per-run reference.
          if (!ok && api.cipher_bad_decrypt())
            throw new DOMException(
              "Decryption failed: Incorrect key/IV or corrupted ciphertext/authentication tag provided.",
              "OperationError",
            );
          requireValue(ok, "internal error");
          if (!this.decrypt) this.tag = output(api, t, size(api, n));
          return output(api, o, data.length);
        },
      );
      this.updated = true;
      return result;
    }
    this.passTag();
    return inputs([data, data.length + this.block, 4], (api, [d, o, n]) => {
      api.cipher_update(this.pointer, o, n, d, data.length);
      const length = size(api, n);
      requireValue(length <= data.length + this.block, "Invalid buffer length");
      return output(api, o, length);
    });
  }
  final() {
    requireValue(this.pointer, finalized);
    if (this.aead) {
      this.dispose();
      return new Uint8Array();
    }
    this.passTag();
    const result = inputs([this.block, 4], (api, [o, n]) => {
      requireValue(
        api.cipher_final(this.pointer, o, n),
        "Authentication failed",
      );
      const length = size(api, n);
      requireValue(length <= this.block, "Invalid buffer length");
      if (!this.decrypt && this.auth) {
        this.tagLength ??= 16;
        this.tag = inputs([this.tagLength], (api, [t]) => {
          requireValue(
            api.cipher_tag(this.pointer, 1, this.tagLength!, t),
            "Authentication failed",
          );
          return output(api, t, this.tagLength!);
        });
      }
      return output(api, o, length);
    });
    this.dispose();
    return result;
  }
  setAAD(value: ArrayBuffer | ArrayBufferView, plaintextLength?: number) {
    requireValue(this.pointer, finalized);
    requireValue(this.auth, "Cipher does not support authenticated mode");
    const data = bytes(value);
    if (this.aead) {
      if (this.mode === 7) {
        requireValue(
          plaintextLength !== undefined,
          "options.plaintextLength is required for CCM mode with AAD",
        );
        requireValue(plaintextLength! <= 65535, "Data too large");
        if (this.decrypt) requireValue(this.tag, "No auth tag provided");
      }
      this.aad?.fill(0);
      this.aad = data.slice();
    } else
      inputs([data, 4], (api, [p, n]) =>
        requireValue(
          api.cipher_update(this.pointer, 0, n, p, data.length),
          "Failed to set AAD",
        ),
      );
  }
  setAutoPadding(value: boolean) {
    requireValue(this.pointer, finalized);
    requireValue(!this.aead, "Setting autopadding is not supported on AEADs");
    requireValue(
      library().cipher_padding(this.pointer, +value),
      "Failed to set autopadding",
    );
  }
  setAuthTag(value: ArrayBuffer | ArrayBufferView) {
    if (!isAnyBuffer(value) && !ArrayBuffer.isView(value))
      throw new TypeError(
        `Failed to execute 'setAuthTag' on '${this.aead ? "AeadHandle" : "CipherHandle"}': parameter 1 is not of type 'BufferSource'.`,
      );
    requireValue(this.pointer, finalized);
    requireValue(this.auth, "Cipher does not support authenticated mode");
    requireValue(
      this.decrypt,
      "Setting auth tag only support in decipher mode",
    );
    requireValue(!this.tag, "Auth tag is already set");
    const data = bytes(value);
    requireValue(data.length <= 0x7fffffff, "Auth tag is too big");
    requireValue(
      this.mode === 6
        ? (this.tagLength === undefined || this.tagLength === data.length) &&
            validTag(data.length)
        : this.tagLength === data.length,
      "Invalid authentication tag length",
    );
    this.tagLength = data.length;
    this.tag = data.slice();
  }
  getAuthTag() {
    requireValue(
      !this.pointer,
      "Auth tag is only available once cipher context has been finalized",
    );
    requireValue(
      !this.decrypt,
      "Getting the auth tag is only support for cipher",
    );
    const tag = this.tag ?? new Uint8Array();
    this.tag = undefined;
    return tag;
  }
}
export default {
  newHandle: (...args: ConstructorParameters<typeof CipherHandle>) =>
    new CipherHandle(...args),
};
