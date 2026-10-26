// Copyright (c) 2023 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
import { deepStrictEqual, strictEqual, ok, rejects, throws } from "node:assert";
import {
  KeyObject,
  SecretKeyObject,
  PrivateKeyObject,
  createSecretKey,
  createPrivateKey,
  createPublicKey,
  createHmac,
  generateKey,
  generateKeySync,
  generateKeyPair,
  generateKeyPairSync,
  sign,
  verify,
} from "./index.js";
import { Buffer } from "node:buffer";
import { promisify } from "../util/index.js";

// Generation/export subset of the pinned upstream file; import/key-object coverage remains separate.
export const generate_hmac_secret_key = {
  async test() {
    // Length is intentionally not a multiple of 8
    const key = generateKeySync("hmac", { length: 33 });
    strictEqual(key.type, "secret");
    strictEqual(key.symmetricKeySize, 4);

    const { promise, resolve, reject } = Promise.withResolvers();
    generateKey("hmac", { length: 33 }, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      strictEqual(key.type, "secret");
      strictEqual(key.symmetricKeySize, 4);
      resolve();
    });
    await promise;

    throws(() => generateKeySync("hmac", { length: 0 }), {
      message:
        'The value of "options.length" is out of range. It must ' +
        "be >= 8 && <= 65536. Received 0",
    });
    throws(() => generateKeySync("hmac", { length: 65537 }), {
      message:
        'The value of "options.length" is out of range. It must ' +
        "be >= 8 && <= 65536. Received 65537",
    });

    const h = createHmac("sha256", key);
    ok(h.update("test").digest());
  },
};

export const generate_aes_secret_key = {
  async test() {
    const key = generateKeySync("aes", { length: 128 });
    strictEqual(key.type, "secret");
    strictEqual(key.symmetricKeySize, 16);

    const { promise, resolve, reject } = Promise.withResolvers();
    generateKey("aes", { length: 128 }, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      strictEqual(key.type, "secret");
      strictEqual(key.symmetricKeySize, 16);
      resolve();
    });
    await promise;

    throws(() => generateKeySync("aes", { length: 0 }), {
      message:
        "The property 'options.length' must be one of: 128, 192, " +
        "256. Received 0",
    });
  },
};

export const generate_key_pair_arg_validation = {
  async test() {
    throws(() => generateKeyPairSync("invalid type"), {
      message:
        "The argument 'type' must be one of: 'rsa', " +
        "'ec', 'ed25519', 'x25519', 'dh'. Received " +
        "'invalid type'",
    });

    throws(() => generateKeyPairSync("rsa", { modulusLength: -1 }), {
      message:
        'The value of "options.modulusLength" is out of range. ' +
        "It must be >= 0 && < 4294967296. Received -1",
    });

    throws(() => generateKeyPairSync("rsa", { modulusLength: "foo" }), {
      message:
        'The "options.modulusLength" property must be of type number. ' +
        "Received type string ('foo')",
    });

    throws(
      () =>
        generateKeyPairSync("rsa", {
          modulusLength: 512,
          publicExponent: "foo",
        }),
      {
        message:
          'The "options.publicExponent" property must be of type number. ' +
          "Received type string ('foo')",
      },
    );

    // TODO(later): BoringSSL does not currently support rsa-pss key generation
    // in the way Node.js does. Uncomment these later when it does.
    // throws(
    //   () =>
    //     generateKeyPairSync('rsa-pss', {
    //       modulusLength: 512,
    //       hashAlgorithm: false,
    //     }),
    //   {
    //     message:
    //       'The "options.hashAlgorithm" property must be of type string. ' +
    //       'Received type boolean (false)',
    //   }
    // );

    // throws(
    //   () =>
    //     generateKeyPairSync('rsa-pss', {
    //       modulusLength: 512,
    //       mgf1HashAlgorithm: false,
    //     }),
    //   {
    //     message:
    //       'The "options.mgf1HashAlgorithm" property must be of type ' +
    //       'string. Received type boolean (false)',
    //   }
    // );

    // throws(
    //   () =>
    //     generateKeyPairSync('rsa-pss', {
    //       modulusLength: 512,
    //       saltLength: 'foo',
    //     }),
    //   {
    //     message:
    //       'The "options.saltLength" property must be of type number. ' +
    //       "Received type string ('foo')",
    //   }
    // );

    // TODO(later): BoringSSL currently does not support dsa key generation
    // in the same way Node.js does. Uncomment this when it does.
    // throws(
    //   () =>
    //     generateKeyPairSync('dsa', {
    //       modulusLength: 512,
    //       divisorLength: 'foo',
    //     }),
    //   {
    //     message:
    //       'The "options.divisorLength" property must be of type number. ' +
    //       "Received type string ('foo')",
    //   }
    // );

    throws(() => generateKeyPairSync("dh", { prime: "foo" }), {
      message:
        'The "options.prime" property must be an instance of Buffer, ' +
        "TypedArray, or ArrayBuffer. Received type string ('foo')",
    });

    throws(() => generateKeyPairSync("dh", { primeLength: "foo" }), {
      message:
        'The "options.primeLength" property must be of type number. ' +
        "Received type string ('foo')",
    });

    throws(() => generateKeyPairSync("dh", { primeLength: -1 }), {
      message:
        'The value of "options.primeLength" is out of range. It ' +
        "must be >= 0 && <= 2147483647. Received -1",
    });

    throws(
      () => generateKeyPairSync("dh", { primeLength: 10, generator: -1 }),
      {
        message:
          'The value of "options.generator" is out of range. It must ' +
          "be >= 0 && <= 2147483647. Received -1",
      },
    );

    throws(() => generateKeyPairSync("dh", { groupName: 123 }), {
      message:
        'The "options.group" property must be of type string. ' +
        "Received type number (123)",
    });

    throws(
      () =>
        generateKeyPairSync("ec", { namedCurve: "foo", paramEncoding: "foo" }),
      {
        message:
          "The property 'options.paramEncoding' must be one of: " +
          "'named', 'explicit'. Received 'foo'",
      },
    );

    throws(() => generateKeyPairSync("ed25519", { publicKeyEncoding: "foo" }), {
      message:
        'The "options.publicKeyEncoding" property must be of type ' +
        "object. Received type string ('foo')",
    });

    throws(() => generateKeyPairSync("x25519", { privateKeyEncoding: "foo" }), {
      message:
        'The "options.privateKeyEncoding" property must be of type ' +
        "object. Received type string ('foo')",
    });

    // ====
    async function wrapped(...args) {
      const { promise, resolve, reject } = Promise.withResolvers();
      generateKeyPair(...args, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
      await promise;
    }

    await rejects(wrapped("invalid type", {}), {
      message:
        "The argument 'type' must be one of: 'rsa', " +
        "'ec', 'ed25519', 'x25519', 'dh'. Received " +
        "'invalid type'",
    });

    await rejects(wrapped("rsa", { modulusLength: -1 }), {
      message:
        'The value of "options.modulusLength" is out of range. ' +
        "It must be >= 0 && < 4294967296. Received -1",
    });

    await rejects(wrapped("rsa", { modulusLength: "foo" }), {
      message:
        'The "options.modulusLength" property must be of type number. ' +
        "Received type string ('foo')",
    });

    await rejects(
      wrapped("rsa", { modulusLength: 512, publicExponent: "foo" }),
      {
        message:
          'The "options.publicExponent" property must be of type number. ' +
          "Received type string ('foo')",
      },
    );

    // TODO(later): BoringSSL currently does not support rsa-pss key generation
    // in the same way Node.js does. Uncomment these later when it does.
    // await rejects(
    //   wrapped('rsa-pss', { modulusLength: 512, hashAlgorithm: false }),
    //   {
    //     message:
    //       'The "options.hashAlgorithm" property must be of type string. ' +
    //       'Received type boolean (false)',
    //   }
    // );

    // await rejects(
    //   wrapped('rsa-pss', { modulusLength: 512, mgf1HashAlgorithm: false }),
    //   {
    //     message:
    //       'The "options.mgf1HashAlgorithm" property must be of type ' +
    //       'string. Received type boolean (false)',
    //   }
    // );

    // await rejects(
    //   wrapped('rsa-pss', { modulusLength: 512, saltLength: 'foo' }),
    //   {
    //     message:
    //       'The "options.saltLength" property must be of type number. ' +
    //       "Received type string ('foo')",
    //   }
    // );

    // TODO(later): BoringSSL currently does not support dsa key generation
    // in the same way Node.js does. Uncomment this later when it does.
    // await rejects(
    //   wrapped('dsa', { modulusLength: 512, divisorLength: 'foo' }),
    //   {
    //     message:
    //       'The "options.divisorLength" property must be of type number. ' +
    //       "Received type string ('foo')",
    //   }
    // );

    await rejects(wrapped("dh", { prime: "foo" }), {
      message:
        'The "options.prime" property must be an instance of Buffer, ' +
        "TypedArray, or ArrayBuffer. Received type string ('foo')",
    });

    await rejects(wrapped("dh", { primeLength: "foo" }), {
      message:
        'The "options.primeLength" property must be of type number. ' +
        "Received type string ('foo')",
    });

    await rejects(wrapped("dh", { primeLength: -1 }), {
      message:
        'The value of "options.primeLength" is out of range. It ' +
        "must be >= 0 && <= 2147483647. Received -1",
    });

    await rejects(wrapped("dh", { primeLength: 10, generator: -1 }), {
      message:
        'The value of "options.generator" is out of range. It must ' +
        "be >= 0 && <= 2147483647. Received -1",
    });

    await rejects(wrapped("dh", { groupName: 123 }), {
      message:
        'The "options.group" property must be of type string. ' +
        "Received type number (123)",
    });

    await rejects(wrapped("ec", { namedCurve: "foo", paramEncoding: "foo" }), {
      message:
        "The property 'options.paramEncoding' must be one of: " +
        "'named', 'explicit'. Received 'foo'",
    });

    await rejects(wrapped("ed25519", { publicKeyEncoding: "foo" }), {
      message:
        'The "options.publicKeyEncoding" property must be of type ' +
        "object. Received type string ('foo')",
    });

    await rejects(wrapped("x25519", { privateKeyEncoding: "foo" }), {
      message:
        'The "options.privateKeyEncoding" property must be of type ' +
        "object. Received type string ('foo')",
    });
  },
};

export const generate_rsa_key_pair_modulus_cap = {
  test() {
    throws(() => generateKeyPairSync("rsa", { modulusLength: 16385 }), {
      name: "RangeError",
    });
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 2048);
  },
};

export const generate_dh_key_pair_prime_size_cap = {
  test() {
    // 1025 bytes > kMaxPrimeBits / 8 (1024 bytes)
    throws(() => generateKeyPairSync("dh", { prime: Buffer.alloc(1025) }), {
      name: "RangeError",
    });
  },
};

export const generate_rsa_key_pair = {
  test() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    strictEqual(publicKey.type, "public");
    strictEqual(publicKey.asymmetricKeyDetails.modulusLength, 2048);
    strictEqual(publicKey.asymmetricKeyDetails.publicExponent, 65537n);

    strictEqual(privateKey.type, "private");
    strictEqual(privateKey.asymmetricKeyDetails.modulusLength, 2048);
    strictEqual(privateKey.asymmetricKeyDetails.publicExponent, 65537n);
  },
};

export const generate_rsa_key_pair_enc = {
  test() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        format: "der",
        type: "pkcs1",
      },
      privateKeyEncoding: {
        format: "pem",
        type: "pkcs8",
      },
    });

    const pubImported = createPublicKey({
      key: publicKey,
      format: "der",
      type: "pkcs1",
    });
    strictEqual(pubImported.type, "public");
    strictEqual(pubImported.asymmetricKeyDetails.modulusLength, 2048);
    strictEqual(pubImported.asymmetricKeyDetails.publicExponent, 65537n);

    const imported = createPrivateKey(privateKey);
    strictEqual(imported.type, "private");
    strictEqual(imported.asymmetricKeyDetails.modulusLength, 2048);
    strictEqual(imported.asymmetricKeyDetails.publicExponent, 65537n);
  },
};

export const generate_ec_key_pair = {
  test() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    strictEqual(publicKey.type, "public");
    strictEqual(publicKey.asymmetricKeyDetails.namedCurve, "prime256v1");
    strictEqual(privateKey.type, "private");
    strictEqual(privateKey.asymmetricKeyDetails.namedCurve, "prime256v1");
  },
};

export const generate_ed25519_key_pair = {
  test() {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {});
    strictEqual(publicKey.type, "public");
    strictEqual(privateKey.type, "private");
    strictEqual(publicKey.asymmetricKeyType, "ed25519");
    strictEqual(privateKey.asymmetricKeyType, "ed25519");
  },
};

export const generate_x25519_key_pair = {
  test() {
    const { privateKey, publicKey } = generateKeyPairSync("x25519", {});
    strictEqual(publicKey.type, "public");
    strictEqual(privateKey.type, "private");
    strictEqual(publicKey.asymmetricKeyType, "x25519");
    strictEqual(privateKey.asymmetricKeyType, "x25519");
  },
};

// TODO(later): BoringSSL with fips does not support generating DH keys
// this way. Uncomment this later when it does.
// export const generate_dh_key_pair = {
//   test() {
//     const { privateKey, publicKey } = generateKeyPairSync('dh', {
//       group: 'modp14',
//     });
//     strictEqual(publicKey.type, 'public');
//     strictEqual(privateKey.type, 'private');
//     strictEqual(publicKey.asymmetricKeyType, 'dh');
//     strictEqual(privateKey.asymmetricKeyType, 'dh');

//     const res = diffieHellman({ privateKey, publicKey });
//     ok(res instanceof Buffer);
//     strictEqual(res.byteLength, 256);
//   },
// };

// TODO(later): BoringSSL with fips does not support generating DH keys
// this way. Uncomment this later when it does.
// export const generate_dh_from_fixed_prime = {
//   test() {
//     const prime = generatePrimeSync(1024);

//     const { privateKey: privateKey1, publicKey: publicKey1 } =
//       generateKeyPairSync('dh', {
//         prime,
//       });
//     strictEqual(publicKey1.type, 'public');
//     strictEqual(privateKey1.type, 'private');
//     strictEqual(publicKey1.asymmetricKeyType, 'dh');
//     strictEqual(privateKey1.asymmetricKeyType, 'dh');

//     const { privateKey: privateKey2, publicKey: publicKey2 } =
//       generateKeyPairSync('dh', {
//         prime,
//       });
//     strictEqual(publicKey2.type, 'public');
//     strictEqual(privateKey2.type, 'private');
//     strictEqual(publicKey2.asymmetricKeyType, 'dh');
//     strictEqual(privateKey2.asymmetricKeyType, 'dh');

//     ok(!publicKey1.equals(publicKey2));
//     ok(!privateKey1.equals(privateKey2));

//     // Once we generate the keys, let's make sure they are usable.

//     const res1 = diffieHellman({
//       privateKey: privateKey2,
//       publicKey: publicKey1,
//     });
//     ok(res1 instanceof Buffer);
//     strictEqual(res1.byteLength, 128);

//     const res2 = diffieHellman({
//       privateKey: privateKey2,
//       publicKey: publicKey1,
//     });
//     ok(res2 instanceof Buffer);
//     strictEqual(res2.byteLength, 128);

//     deepStrictEqual(res1, res2);
//     // It's actual data and not just zeroes right?
//     notDeepStrictEqual(res1, Buffer.alloc(128, 0));

//     // Keys generated from different prime groups aren't compatible and should throw.
//     const prime2 = generatePrimeSync(1024);
//     const { privateKey: privateKey3, publicKey: publicKey3 } =
//       generateKeyPairSync('dh', {
//         prime: prime2,
//       });
//     strictEqual(publicKey3.type, 'public');
//     strictEqual(privateKey3.type, 'private');
//     strictEqual(publicKey3.asymmetricKeyType, 'dh');
//     strictEqual(privateKey3.asymmetricKeyType, 'dh');

//     throws(
//       () => diffieHellman({ publicKey: publicKey1, privateKey: privateKey3 }),
//       {
//         message: 'Failed to derive shared diffie-hellman secret',
//       }
//     );
//   },
// };

export const generate_dh_key_pair_by_length = {
  test() {
    throws(
      () =>
        generateKeyPairSync("dh", {
          primeLength: 1048,
        }),
      {
        message:
          "Generating DH keys from a prime length is not yet implemented",
      },
    );
  },
};

export const generate_ed_keypair_promisified = {
  async test() {
    const promisifiedGenKeyPair = promisify(generateKeyPair);
    const { publicKey, privateKey } = await promisifiedGenKeyPair(
      "ed25519",
      {},
    );
    strictEqual(publicKey.asymmetricKeyType, "ed25519");
    strictEqual(privateKey.asymmetricKeyType, "ed25519");
  },
};

// Regression test: privateKey.export() with cipher and passphrase must
// produce an encrypted PEM (BEGIN ENCRYPTED PRIVATE KEY), not plaintext.
export const export_encrypted_private_key = {
  test() {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

    const plainPem = privateKey.export({ format: "pem", type: "pkcs8" });
    const encryptedPem = privateKey.export({
      format: "pem",
      type: "pkcs8",
      cipher: "aes-256-cbc",
      passphrase: "test-passphrase",
    });

    // Encrypted PEM must differ from unencrypted PEM.
    ok(plainPem !== encryptedPem);

    // Encrypted PEM must have the ENCRYPTED header.
    ok(
      encryptedPem.startsWith("-----BEGIN ENCRYPTED PRIVATE KEY-----"),
      "Expected encrypted PEM header",
    );

    // Re-import the encrypted PEM using the passphrase.
    const reimported = createPrivateKey({
      key: encryptedPem,
      format: "pem",
      passphrase: "test-passphrase",
    });

    // The re-imported key must produce the same unencrypted export.
    strictEqual(reimported.export({ format: "pem", type: "pkcs8" }), plainPem);
  },
};

// Verify encrypted export also works for EC keys.
export const export_encrypted_ec_private_key = {
  test() {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });

    const encryptedPem = privateKey.export({
      format: "pem",
      type: "pkcs8",
      cipher: "aes-128-cbc",
      passphrase: "ec-passphrase",
    });

    ok(
      encryptedPem.startsWith("-----BEGIN ENCRYPTED PRIVATE KEY-----"),
      "Expected encrypted PEM header for EC key",
    );

    const reimported = createPrivateKey({
      key: encryptedPem,
      format: "pem",
      passphrase: "ec-passphrase",
    });

    strictEqual(
      reimported.export({ format: "pem", type: "pkcs8" }),
      privateKey.export({ format: "pem", type: "pkcs8" }),
    );
  },
};

// Regression test for AUTOVULN-CLOUDFLARE-WORKERD-30:
// createSecretKey() must correctly copy DataView key material.
// Previously, Buffer.from(dataView) produced an empty Buffer because
// DataView has no .length property, causing the key material to be lost.
export const regression_create_secret_key_dataview = {
  test() {
    // Create a 16-byte ArrayBuffer filled with 0x41 ('A')
    const ab = new ArrayBuffer(16);
    new Uint8Array(ab).fill(0x41);

    // Create a secret key from a DataView over the full buffer
    const dvFull = new DataView(ab);
    const keyFull = createSecretKey(dvFull);
    const exported = keyFull.export();

    // The exported key must contain exactly the 16 bytes, not be empty
    strictEqual(exported.length, 16, "DataView key material must not be empty");
    strictEqual(
      exported.toString(),
      "A".repeat(16),
      "DataView key material must match the original bytes",
    );
    strictEqual(keyFull.symmetricKeySize, 16);

    // Also verify a DataView over a sub-range of the buffer works correctly
    const abLarge = new ArrayBuffer(32);
    const u8 = new Uint8Array(abLarge);
    u8.fill(0x42); // fill with 'B'
    u8.fill(0x43, 8, 16); // bytes 8..15 = 'C'

    const dvSlice = new DataView(abLarge, 8, 8);
    const keySlice = createSecretKey(dvSlice);
    const exportedSlice = keySlice.export();

    strictEqual(
      exportedSlice.length,
      8,
      "DataView sub-range key must have correct length",
    );
    strictEqual(
      exportedSlice.toString(),
      "C".repeat(8),
      "DataView sub-range key must contain the correct bytes",
    );
    strictEqual(keySlice.symmetricKeySize, 8);

    // Verify the DataView-created key matches a Uint8Array-created key
    // over the same bytes
    const keyFromUint8 = createSecretKey(Buffer.from("A".repeat(16)));
    ok(
      keyFull.equals(keyFromUint8),
      "DataView key must equal Buffer key with same bytes",
    );
  },
};
