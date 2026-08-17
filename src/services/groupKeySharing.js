"use strict";

const zk = require("../crypto/rootark-zk-1");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const PURPOSE = "key-wrap";
const WRAP_FIELDS = Object.freeze([
  "schemaVersion", "suite", "suiteVersion", "compartmentId", "epoch", "objectId", "versionId",
  "keyRef", "recipientId", "deviceId", "wrapId", "wrapped", "aad",
]);
const HPKE_FIELDS = Object.freeze(["hpkeEnc", "hpkeCiphertext", "hpkeInfo", "hpkeAad"]);

function fail(message, code = "invalid_group_wrap") {
  throw Object.assign(new Error(message), { code });
}

function text(value, name) {
  const result = String(value || "");
  if (!result || result.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(result)) fail(`Invalid ${name}`);
  return result;
}

function epoch(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("Invalid group epoch");
  return value;
}

function bytes(value, name, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail(`Invalid ${name}`);
  const result = Buffer.from(value, "base64url");
  if (result.toString("base64url") !== value || (length !== undefined && result.length !== length)) fail(`Invalid ${name}`);
  return result;
}

function encode(value) { return Buffer.from(value).toString("base64url"); }

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) fail("Invalid group wrap schema");
}

function hpkeInfoInput(input, wrapId, aad) {
  return {
    profile: zk.PROFILE.HPKE_INFO, suite: zk.SUITE_ID, envelope_version: 1,
    compartment_id: Buffer.from(text(input.compartmentId, "compartmentId")), epoch: epoch(input.epoch), purpose: PURPOSE,
    object_id: Buffer.from(text(input.objectId, "objectId")), version_id: Buffer.from(text(input.versionId, "versionId")),
    key_ref: Buffer.from(text(input.keyRef, "keyRef")), sender_key_id: Buffer.from(text(input.senderId || "group", "senderId")),
    recipient_key_id: Buffer.from(text(input.deviceId, "deviceId")), wrap_id: wrapId,
    manifest_core_digest: crypto.createHash("sha256").update(aad).digest(),
  };
}

function scope(input, wrapId) {
  return {
    suite: zk.SUITE_ID,
    compartment_id: Buffer.from(text(input.compartmentId, "compartmentId")),
    epoch: epoch(input.epoch),
    purpose: PURPOSE,
    object_id: Buffer.from(text(input.objectId, "objectId")),
    version_id: Buffer.from(text(input.versionId, "versionId")),
    key_ref: Buffer.from(text(input.keyRef, "keyRef")),
    recipient_key_id: Buffer.from(text(input.recipientId, "recipientId")),
    wrap_id: wrapId,
  };
}

function aadFor(input, wrapId) {
  return Buffer.from(JSON.stringify({
    schemaVersion: SCHEMA_VERSION, suite: zk.SUITE_ID, suiteVersion: zk.SUITE_VERSION,
    compartmentId: text(input.compartmentId, "compartmentId"), epoch: epoch(input.epoch), objectId: text(input.objectId, "objectId"),
    versionId: text(input.versionId, "versionId"), keyRef: text(input.keyRef, "keyRef"), recipientId: text(input.recipientId, "recipientId"),
    deviceId: text(input.deviceId, "deviceId"), wrapId: encode(wrapId), purpose: PURPOSE,
  }));
}

async function createOpaqueWrap(input) {
  const wrapId = input.wrapId ? Buffer.from(input.wrapId) : zk.newWrapId();
  if (wrapId.length !== 16) fail("Invalid wrapId");
  const aad = aadFor(input, wrapId);
  const wrapped = await zk.wrapKey({
    plaintext: input.cek, cer: input.cer, aad, ...scope(input, wrapId),
  });
  const record = {
    schemaVersion: SCHEMA_VERSION, suite: zk.SUITE_ID, suiteVersion: zk.SUITE_VERSION,
    compartmentId: text(input.compartmentId, "compartmentId"), epoch: epoch(input.epoch), objectId: text(input.objectId, "objectId"),
    versionId: text(input.versionId, "versionId"), keyRef: text(input.keyRef, "keyRef"), recipientId: text(input.recipientId, "recipientId"),
    deviceId: text(input.deviceId, "deviceId"), wrapId: encode(wrapId), wrapped: encode(wrapped), aad: encode(aad),
  };
  if (input.recipientPublicKey) {
    const info = await zk.buildHpkeInfoBytes(hpkeInfoInput(input, wrapId, aad));
    const sealed = await zk.hpkeSeal({ recipientPublicKey: input.recipientPublicKey, info, aad, plaintext: input.cer });
    Object.assign(record, { hpkeEnc: encode(sealed.enc), hpkeCiphertext: encode(sealed.ciphertext), hpkeInfo: encode(info), hpkeAad: encode(aad) });
  }
  return record;
}

function validateOpaqueWrap(record) {
  const hasHpke = HPKE_FIELDS.some((field) => Object.hasOwn(record || {}, field));
  exact(record, hasHpke ? [...WRAP_FIELDS, ...HPKE_FIELDS] : WRAP_FIELDS);
  if (record.schemaVersion !== SCHEMA_VERSION || record.suite !== zk.SUITE_ID || record.suiteVersion !== zk.SUITE_VERSION) fail("Unsupported group wrap suite");
  const normalized = {
    ...record, compartmentId: text(record.compartmentId, "compartmentId"), epoch: epoch(record.epoch), objectId: text(record.objectId, "objectId"),
    versionId: text(record.versionId, "versionId"), keyRef: text(record.keyRef, "keyRef"), recipientId: text(record.recipientId, "recipientId"), deviceId: text(record.deviceId, "deviceId"),
  };
  bytes(record.wrapId, "wrapId", 16);
  bytes(record.wrapped, "wrapped", 60);
  bytes(record.aad, "aad");
  if (!Buffer.from(record.aad, "base64url").equals(aadFor(normalized, Buffer.from(record.wrapId, "base64url")))) fail("Group wrap AAD mismatch");
  if (hasHpke) {
    bytes(record.hpkeEnc, "hpkeEnc", 32);
    bytes(record.hpkeCiphertext, "hpkeCiphertext", 48);
    bytes(record.hpkeInfo, "hpkeInfo");
    bytes(record.hpkeAad, "hpkeAad");
    if (record.hpkeAad !== record.aad) fail("Group HPKE AAD mismatch");
  }
  return normalized;
}

async function unwrapOpaqueWrap(record, input) {
  const normalized = validateOpaqueWrap(record);
  for (const field of ["compartmentId", "objectId", "versionId", "keyRef", "recipientId", "deviceId"]) {
    if (normalized[field] !== input[field]) fail("Group wrap scope mismatch", "scope_mismatch");
  }
  if (normalized.epoch !== input.epoch) fail("Stale group epoch", "stale_epoch");
  let cer = input.cer;
  if (normalized.hpkeEnc) {
    if (!input.recipientKey) fail("Recipient device key is required", "device_key_required");
    cer = await zk.hpkeOpen({ recipientKey: input.recipientKey, enc: bytes(normalized.hpkeEnc, "hpkeEnc", 32), ciphertext: bytes(normalized.hpkeCiphertext, "hpkeCiphertext", 48), info: bytes(normalized.hpkeInfo, "hpkeInfo"), aad: bytes(normalized.hpkeAad, "hpkeAad") });
  }
  return zk.unwrapKey({
    wrapped: bytes(normalized.wrapped, "wrapped", 60), cer, aad: bytes(normalized.aad, "aad"), ...scope(input, bytes(normalized.wrapId, "wrapId", 16)),
  });
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("Invalid group manifest");
  const allowed = new Set(["groupId", "epoch", "wraps", "manifestVersion", "membershipVersion", "revokedDevices", "signature"]);
  if (Object.keys(manifest).some((key) => !allowed.has(key))) fail("Invalid group manifest");
  if (!Array.isArray(manifest.wraps) || manifest.wraps.length > 500) fail("Invalid group manifest");
  const result = { groupId: text(manifest.groupId, "groupId"), epoch: epoch(manifest.epoch), wraps: manifest.wraps.map(validateOpaqueWrap) };
  if (manifest.manifestVersion !== undefined) {
    if (manifest.manifestVersion !== 1 || !Number.isSafeInteger(manifest.membershipVersion) || manifest.membershipVersion < 1) fail("Invalid group manifest version");
    result.manifestVersion = 1;
    result.membershipVersion = manifest.membershipVersion;
    result.revokedDevices = Array.isArray(manifest.revokedDevices) ? manifest.revokedDevices.map((item) => text(item, "revokedDevice")) : [];
    if (manifest.signature !== undefined) result.signature = bytes(manifest.signature, "signature", 64).toString("base64url");
  }
  return result;
}

function verifyManifest(manifest, publicKey) {
  const normalized = validateManifest(manifest);
  if (!normalized.signature || !publicKey) fail("Signed group manifest required", "manifest_signature");
  const { signature, ...unsigned } = normalized;
  if (!crypto.verify(null, Buffer.from(JSON.stringify(unsigned), "utf8"), publicKey, Buffer.from(signature, "base64url"))) fail("Invalid group manifest signature", "manifest_signature");
  return normalized;
}

class GroupKeySharing {
  constructor({ groupId, members = [], epoch: currentEpoch = 1, signingKey = null } = {}) {
    this.groupId = text(groupId, "groupId");
    this.members = new Set(members.map((member) => text(member, "member")));
    this.revokedDevices = new Set();
    this.devices = new Map();
    this.membershipVersion = 1;
    this.signingKey = signingKey;
    this.epoch = epoch(currentEpoch);
    this.wraps = [];
  }

  active(recipientId, deviceId) {
    const device = text(deviceId, "deviceId");
    return this.members.has(text(recipientId, "recipientId")) && !this.revokedDevices.has(device) && (!this.devices.has(device) || this.devices.get(device).recipientId === recipientId);
  }

  registerDevice(recipientId, deviceId, publicKey) {
    const user = text(recipientId, "recipientId");
    const device = text(deviceId, "deviceId");
    if (!publicKey) fail("Device public key is required");
    this.devices.set(device, { recipientId: user, publicKey });
    return device;
  }
  addMember(recipientId) { this.members.add(text(recipientId, "recipientId")); this.membershipVersion += 1; this.epoch += 1; this.wraps = []; return this.epoch; }
  removeMember(recipientId) { this.members.delete(text(recipientId, "recipientId")); this.membershipVersion += 1; this.epoch += 1; this.wraps = []; return this.epoch; }
  revokeDevice(deviceId) { this.revokedDevices.add(text(deviceId, "deviceId")); this.membershipVersion += 1; this.epoch += 1; this.wraps = []; return this.epoch; }
  rotate() { this.membershipVersion += 1; this.epoch += 1; this.wraps = []; return this.epoch; }

  async wrapFor(input) {
    if (!this.active(input.recipientId, input.deviceId)) fail("Recipient is not active", "revoked_recipient");
    if (epoch(input.epoch) !== this.epoch) fail("Stale group epoch", "stale_epoch");
    const device = this.devices.get(input.deviceId);
    const record = await createOpaqueWrap({ ...input, recipientPublicKey: input.recipientPublicKey || device?.publicKey, epoch: this.epoch });
    this.wraps.push(record);
    return record;
  }

  manifest() {
    const base = { groupId: this.groupId, epoch: this.epoch, wraps: this.wraps, manifestVersion: 1, membershipVersion: this.membershipVersion, revokedDevices: [...this.revokedDevices].sort() };
    if (this.signingKey) base.signature = crypto.sign(null, Buffer.from(JSON.stringify(base), "utf8"), this.signingKey).toString("base64url");
    return validateManifest(base);
  }

  async unwrap(record, input) {
    if (!this.active(input.recipientId, input.deviceId)) fail("Recipient is not active", "revoked_recipient");
    return unwrapOpaqueWrap(record, { ...input, epoch: this.epoch });
  }
}

module.exports = { GroupKeySharing, HPKE_FIELDS, SCHEMA_VERSION, WRAP_FIELDS, createOpaqueWrap, unwrapOpaqueWrap, validateManifest, validateOpaqueWrap, verifyManifest };
