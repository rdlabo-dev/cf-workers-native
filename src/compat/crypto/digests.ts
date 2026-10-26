export const hashNames = [
  "md4",
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "md5-sha1",
  "RSA-MD5",
  "RSA-SHA1",
  "RSA-SHA224",
  "RSA-SHA256",
  "RSA-SHA384",
  "RSA-SHA512",
  "DSA-SHA",
  "DSA-SHA1",
  "ecdsa-with-SHA1",
];
export const aliases: Record<string, string> = Object.assign(
  Object.create(null),
  Object.fromEntries(
    hashNames.map((name) => [
      name.toLowerCase(),
      name
        .toLowerCase()
        .replace(/^rsa-/, "")
        .replace(/^(dsa-sha1?|ecdsa-with-sha1)$/, "sha1"),
    ]),
  ),
);
export function signatureDigest(algorithm: string): string {
  const value = aliases[algorithm.split("\0")[0]!.toLowerCase()];
  if (!value) throw new Error(`Unknown digest: ${algorithm}`);
  return value;
}
