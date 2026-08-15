"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const z = require("../src/crypto/rootark-zk-1");

const b = (value, length = 8) => Buffer.alloc(length, value);
const sample = () => ({
  type: "rootark-authorization-manifest-v1",
  suite: z.SUITE_ID,
  envelope_version: 1,
  compartment_id: b(1),
  epoch: 7,
  purpose: "content",
  sender_key_id: b(2),
  recipient_key_id: b(3),
  object_id: b(4),
  version_id: b(5),
  key_ref: b(6),
  expiry: 9223372036854775807n,
  replay_id: b(7),
  idempotency_key: b(8),
  wrap_id: b(9, 16),
  hpke_enc: b(10, 32),
  hpke_info_digest: b(11, 32),
  wrapped_key_digest: b(12, 32),
  ciphertext_digest: b(13, 32),
});
const scope = (extra = {}) => ({
  profile: z.PROFILE.HPKE_INFO,
  suite: z.SUITE_ID,
  envelope_version: 1,
  compartment_id: b(1),
  epoch: 7,
  purpose: "content",
  object_id: b(4),
  version_id: b(5),
  key_ref: b(6),
  sender_key_id: b(2),
  recipient_key_id: b(3),
  wrap_id: b(9, 16),
  manifest_core_digest: b(11, 32),
  ...extra,
});

test("rootark-zk-1 registry fails closed", () => {
  assert.equal(z.SUITE_REGISTRY[z.SUITE_ID].read, "allowed");
  assert.equal(z.SUITE_REGISTRY[z.SUITE_ID].write, "allowed");
  assert.deepEqual(z.SUITE_STATES, { ALLOWED: "allowed", DEPRECATED: "deprecated", REJECTED: "rejected" });
  assert.throws(() => z.resolveSuite("unknown"), (error) => error.code === "UNKNOWN_SUITE");
  assert.throws(() => z.resolveSuite(z.SUITE_ID, 2), (error) => error.code === "UNSUPPORTED_SUITE_VERSION");
});

test("deterministic CBOR has a stable fixture and strict rejection", async () => {
  const value = { b: 1, a: Buffer.from([1, 2]) };
  const first = await z.encodeDeterministic(value);
  const second = await z.encodeDeterministic({ a: Buffer.from([1, 2]), b: 1 });
  assert.equal(first.toString("hex"), "a26161420102616201");
  assert.deepEqual(first, second);
  assert.deepEqual(await z.decodeDeterministic(first), { a: Uint8Array.from([1, 2]), b: 1 });
  const invalid = [
    Buffer.from("a2616101616101", "hex"),
    Buffer.from("bf616101ff", "hex"),
    Buffer.concat([first, Buffer.from([0])]),
    Buffer.from("a161611801", "hex"),
    Buffer.from("a16161fb3ff0000000000000", "hex"),
    Buffer.from("c000", "hex"),
  ];
  for (const bytes of invalid) await assert.rejects(z.decodeDeterministic(bytes));
  await assert.rejects(z.encodeDeterministic(new Map([["a", 1]])));
});

test("contract byte builders are deterministic and domain separated", async () => {
  const manifest = sample();
  const { hpke_info_digest: _hpke, wrapped_key_digest: _wrapped, ciphertext_digest: _ciphertext, ...coreInput } = manifest;
  assert.equal((await z.buildManifestCoreMap(coreInput)).type, manifest.type);
  const core = await z.buildManifestCoreBytes(coreInput);
  assert.deepEqual(core, await z.buildManifestCoreBytes({ ...coreInput }));
  assert.equal((await z.buildManifestCoreDigest(coreInput)).length, 32);
  const { sender_key_id: _sender, recipient_key_id: _recipient, ...aadInput } = scope({ profile: z.PROFILE.AAD });
  const aad = await z.buildAadBytes(aadInput);
  assert.equal((await z.buildAadMap(aadInput)).profile, z.PROFILE.AAD);
  const info = await z.buildHpkeInfoBytes(scope());
  assert.equal((await z.buildHpkeInfoMap(scope())).suite, z.SUITE_ID);
  const wrap = await z.buildWrapInfo({
    suite: z.SUITE_ID,
    compartment_id: b(1),
    epoch: 7,
    purpose: "content",
    object_id: b(4),
    version_id: b(5),
    key_ref: b(6),
    recipient_key_id: b(3),
    wrap_id: b(9, 16),
  });
  const signatureInput = await z.buildAuthorizationSignatureInput(manifest);
  assert.deepEqual(Object.keys(await z.buildManifestMap(manifest)).sort(), [
    "ciphertext_digest", "compartment_id", "epoch", "expiry", "envelope_version",
    "hpke_enc", "hpke_info_digest", "idempotency_key", "key_ref", "object_id",
    "purpose", "recipient_key_id", "replay_id", "sender_key_id", "suite", "type",
    "version_id", "wrap_id", "wrapped_key_digest",
  ].sort());
  assert.match(info.toString("ascii"), /^Root\.ark\/zk-1\/hpke-info\/v1/);
  assert.match(wrap.toString("ascii"), /^Root\.ark\/zk-1\/key-wrap\/v1/);
  assert.match(signatureInput.toString("ascii"), /^Root\.ark\/zk-1\/authorization-manifest\/v1/);
  assert.notDeepEqual(info, wrap);
  await assert.rejects(z.buildManifestCoreBytes({ ...coreInput, suite: "other" }));
  await assert.rejects(z.buildManifestCoreBytes({ ...coreInput, wrap_id: b(9, 15) }));
  await assert.rejects(z.buildManifestCoreBytes({ ...coreInput, epoch: 0x10000000000000000n }));
  await assert.rejects(z.buildManifestCoreBytes({ ...coreInput, expiry: 0x8000000000000000n }));
  await assert.rejects(z.buildManifestCoreBytes({ ...coreInput, extra_required_field: 1 }));
  await assert.rejects(z.buildAadBytes({ ...aadInput, profile: z.PROFILE.HPKE_INFO }));
  await assert.rejects(z.buildHpkeInfoBytes({ ...scope(), profile: z.PROFILE.AAD }));
  await assert.rejects(z.buildAadBytes({ ...aadInput, purpose: "unknown" }));
  await assert.rejects(z.buildManifestBytes({ ...manifest, hpke_info_digest: b(11, 31) }));
  await assert.rejects(z.buildManifestBytes({ ...manifest, extra_required_field: 1 }));
  assert.notDeepEqual(await z.buildWrapInfo({
    suite: z.SUITE_ID,
    compartment_id: b(1),
    epoch: 7,
    purpose: "content",
    object_id: b(4),
    version_id: b(5),
    key_ref: b(6),
    recipient_key_id: b(3),
    wrap_id: b(12, 16),
  }), wrap);
});

test("AES-GCM and HKDF wrapping bind exact context and wrap_id", async () => {
  const aad = Buffer.from("test-aad");
  const plaintext = b(12, 32);
  const key = b(13, 32);
  const nonce = b(14, 12);
  const sealed = z.aesGcmSeal({ key, nonce, aad, plaintext });
  assert.deepEqual(z.aesGcmOpen({ key, nonce, aad, ...sealed }), plaintext);
  assert.throws(() => z.aesGcmOpen({ key, nonce, aad: Buffer.from("wrong"), ...sealed }));
  const wrongTag = Buffer.from(sealed.tag);
  wrongTag[0] ^= 1;
  assert.throws(() => z.aesGcmOpen({ key, nonce, aad, ciphertext: sealed.ciphertext, tag: wrongTag }));
  const input = { ...scope(), cer: b(15, 32), aad, plaintext };
  const wrapped = await z.wrapKey(input);
  assert.equal(wrapped.length, 60);
  assert.deepEqual(await z.unwrapKey({ ...input, wrapped }), plaintext);
  assert.notDeepEqual(await z.deriveWrapKey(input), await z.deriveWrapKey({ ...input, wrap_id: b(16, 16) }));
  await assert.rejects(z.unwrapKey({ ...input, wrapped: Buffer.from(wrapped).fill(0) }));
  assert.throws(() => z.aesGcmOpen({ key, nonce, aad, ciphertext: sealed.ciphertext, tag: wrongTag }), (error) => {
    assert.equal(error.message.includes(plaintext.toString("hex")), false);
    assert.equal(error.message.includes(key.toString("hex")), false);
    return error instanceof z.RootarkZkError;
  });
});

test("HKDF-SHA-256 uses IKM, salt, and info in the frozen order", async () => {
  const rfc5869 = z.hkdfSha256({
    ikm: Buffer.alloc(22, 0x0b),
    salt: Buffer.from("000102030405060708090a0b0c", "hex"),
    info: Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex"),
    length: 42,
  });
  assert.equal(rfc5869.toString("hex"), "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  const context = {
    suite: z.SUITE_ID,
    compartment_id: b(1),
    epoch: 7,
    purpose: "content",
    object_id: b(4),
    version_id: b(5),
    key_ref: b(6),
    recipient_key_id: b(3),
    wrap_id: b(9, 16),
    cer: b(15, 32),
  };
  const expected = "57acba80f742935aa8251cc51c6040c2f9509afee5a25348e86daf51dbfa86cf";
  const { cer: _cer, ...wrapContext } = context;
  const info = await z.buildWrapInfo(wrapContext);
  assert.equal((await z.deriveWrapKey(context)).toString("hex"), expected);
  assert.equal(z.hkdfSha256({ ikm: context.cer, salt: Buffer.alloc(0), info, length: 32 }).toString("hex"), expected);
  assert.notDeepEqual(await z.deriveWrapKey({ ...context, cer: b(16, 32) }), await z.deriveWrapKey(context));
  assert.notDeepEqual(z.hkdfSha256({ ikm: b(15, 32), salt: Buffer.alloc(0), info, length: 32 }), z.hkdfSha256({ ikm: b(15, 32), salt: b(1), info, length: 32 }));
  assert.notDeepEqual(z.hkdfSha256({ ikm: b(15, 32), salt: Buffer.alloc(0), info, length: 32 }), z.hkdfSha256({ ikm: b(15, 32), salt: Buffer.alloc(0), info: Buffer.concat([info, Buffer.from([1])]), length: 32 }));
  assert.notDeepEqual(await z.deriveWrapKey(context), await z.deriveWrapKey({ ...context, object_id: b(99) }));
  assert.notDeepEqual(await z.deriveWrapKey(context), await z.deriveWrapKey({ ...context, wrap_id: b(16, 16) }));
  assert.throws(() => z.hkdfSha256({ ikm: b(1), info, length: 0 }));
});

test("HPKE is RFC 9180 base mode with exact info and AAD", async () => {
  const suite = z.hpkeSuite();
  assert.equal(suite.kem.id, z.KEM_ID);
  assert.equal(suite.kdf.id, z.KDF_ID);
  assert.equal(suite.aead.id, z.AEAD_ID);
  const keys = await suite.kem.generateKeyPair();
  const input = { recipientPublicKey: keys.publicKey, info: Buffer.from("info"), aad: Buffer.from("aad"), plaintext: b(17, 32) };
  const sealed = await z.hpkeSeal(input);
  assert.equal(sealed.enc.length, 32);
  assert.deepEqual(await z.hpkeOpen({ ...input, recipientKey: keys.privateKey, ...sealed }), input.plaintext);
  await assert.rejects(z.hpkeOpen({ ...input, recipientKey: keys.privateKey, info: Buffer.from("wrong"), ...sealed }));
  await assert.rejects(z.hpkeOpen({ ...input, recipientKey: keys.privateKey, aad: Buffer.from("wrong"), ...sealed }));
  const wrongEnc = Buffer.from(sealed.enc);
  wrongEnc[0] ^= 1;
  await assert.rejects(z.hpkeOpen({ ...input, ...sealed, recipientKey: keys.privateKey, enc: wrongEnc }));
  const wrongCiphertext = Buffer.from(sealed.ciphertext);
  wrongCiphertext[0] ^= 1;
  await assert.rejects(z.hpkeOpen({ ...input, ...sealed, recipientKey: keys.privateKey, ciphertext: wrongCiphertext }));
  const other = await suite.kem.generateKeyPair();
  await assert.rejects(z.hpkeOpen({ ...input, recipientKey: other.privateKey, ...sealed }));
});

test("Ed25519 authorization rejects altered signatures and substitutions", async () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const manifest = sample();
  const signature = await z.signAuthorization(manifest, keys.privateKey);
  assert.equal(signature.length, 64);
  assert.equal(await z.verifyAuthorization(manifest, signature, keys.publicKey), true);
  const altered = Buffer.from(signature);
  altered[0] ^= 1;
  assert.equal(await z.verifyAuthorization(manifest, altered, keys.publicKey), false);
  assert.equal(await z.verifyAuthorization({ ...manifest, purpose: "key-wrap" }, signature, keys.publicKey), false);
  await assert.rejects(z.verifyAuthorization(manifest, signature, keys.publicKey, { object_id: b(99) }));
  for (const field of ["sender_key_id", "recipient_key_id", "compartment_id", "object_id", "version_id", "epoch", "expiry", "replay_id", "idempotency_key", "wrap_id"]) {
    const expected = {
      [field]: Buffer.isBuffer(manifest[field])
        ? b(99, manifest[field].length)
        : typeof manifest[field] === "bigint" ? manifest[field] + 1n : manifest[field] + 1,
    };
    await assert.rejects(z.verifyAuthorization(manifest, signature, keys.publicKey, expected));
  }
});

test("Argon2id recovery derivation is explicit and upstream-compatible", async () => {
  const output = await z.deriveRecoveryKey({
    password: "test",
    salt: Buffer.alloc(16, 4),
    opslimit: 1,
    memlimit: 8192,
  });
  assert.equal(output.toString("hex"), "01208557cb93b18e135a9aba6409a7ed8423ee6276c9eb37f1570316cbcea69b");
  await assert.rejects(z.deriveRecoveryKey({ password: "test", salt: Buffer.alloc(15), opslimit: 1, memlimit: 8192 }));
  assert.equal(z.newWrapId().length, 16);
  assert.equal(z.newRecoverySalt().length, 16);
});

test("security errors do not contain secret material and clearing is best effort", async () => {
  const secret = "test-secret-material";
  await assert.rejects(z.decodeDeterministic(Buffer.from("c000", "hex")), (error) => {
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message, error.code);
    return error instanceof z.RootarkZkError;
  });
  const value = Buffer.from(secret);
  assert.equal(z.clearSecret(value), true);
  assert.deepEqual(value, Buffer.alloc(secret.length));
  assert.equal(z.clearSecret("not-bytes"), false);
});
