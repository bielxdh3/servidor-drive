const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  base32Encode,
  decryptSecret,
  deriveTotpSeedKey,
  encryptSecret,
  generateRecoveryCodes,
  hotp,
  verifyRecoveryCode,
  verifyTotp,
} = require("../src/services/totp");

const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("TOTP matches RFC 6238 SHA-1 vectors with the documented one-step window", () => {
  const vectors = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [timestamp, expected8] of vectors) {
    assert.equal(hotp(RFC_SECRET, Math.floor(timestamp / 30)), expected8);
  }
  assert.equal(verifyTotp(RFC_SECRET, "287082", { now: 59_000, window: 1 }), 1);
  assert.equal(verifyTotp(RFC_SECRET, "942870", { now: 120_000, window: 0 }), null);
});

test("TOTP secret encryption requires a 32-byte application key and decrypts with AAD", () => {
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const record = encryptSecret(RFC_SECRET, key, "Root.ark/TOTP/alice");
  assert.equal(record.version, 2);
  assert.equal(record.keyDerivation, "hkdf-sha256");
  assert.equal(record.keyInfo, "Root.ark/TOTP/seed-encryption/v1");
  assert.equal(decryptSecret(record, key, "Root.ark/TOTP/alice"), RFC_SECRET);
  assert.notDeepEqual(deriveTotpSeedKey(key), key);
  assert.notDeepEqual(
    deriveTotpSeedKey(key),
    Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from("different-domain"), 32))
  );
  assert.equal(JSON.stringify(record).includes(key.toString("hex")), false);
  assert.throws(() => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "hex"));
    decipher.setAAD(Buffer.from("Root.ark/TOTP/alice"));
    decipher.setAuthTag(Buffer.from(record.authTag, "hex"));
    decipher.update(Buffer.from(record.ciphertext, "hex"));
    decipher.final();
  });
  assert.throws(() => decryptSecret(record, Buffer.alloc(31), "Root.ark/TOTP/alice"));
  assert.throws(() => decryptSecret(record, key, "Root.ark/TOTP/bob"));
  assert.throws(() => encryptSecret(RFC_SECRET, Buffer.alloc(31), "Root.ark/TOTP/alice"));
  assert.throws(() => encryptSecret(RFC_SECRET, undefined, "Root.ark/TOTP/alice"));
});

test("recovery codes are one-way, single-use values", () => {
  const { codes, hashes } = generateRecoveryCodes(3);
  assert.equal(codes.length, 3);
  assert.equal(hashes.length, 3);
  assert.ok(hashes.every((hash) => hash.startsWith("scrypt-v1$")));
  assert.ok(!hashes.some((hash) => hash.includes(codes[0])));
  assert.equal(verifyRecoveryCode(codes[0], hashes[0]), true);
  assert.equal(verifyRecoveryCode(codes[0], hashes[1]), false);
});
