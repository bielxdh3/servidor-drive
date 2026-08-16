"use strict";

const zk = require("../crypto/rootark-zk-1");

const SCHEMA_VERSION = 1;
const PURPOSE = "key-wrap";
const WRAP_FIELDS = Object.freeze([
  "schemaVersion", "suite", "suiteVersion", "compartmentId", "epoch", "objectId", "versionId",
  "keyRef", "recipientId", "deviceId", "wrapId", "wrapped", "aad",
]);

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
  return {
    schemaVersion: SCHEMA_VERSION, suite: zk.SUITE_ID, suiteVersion: zk.SUITE_VERSION,
    compartmentId: text(input.compartmentId, "compartmentId"), epoch: epoch(input.epoch), objectId: text(input.objectId, "objectId"),
    versionId: text(input.versionId, "versionId"), keyRef: text(input.keyRef, "keyRef"), recipientId: text(input.recipientId, "recipientId"),
    deviceId: text(input.deviceId, "deviceId"), wrapId: encode(wrapId), wrapped: encode(wrapped), aad: encode(aad),
  };
}

function validateOpaqueWrap(record) {
  exact(record, WRAP_FIELDS);
  if (record.schemaVersion !== SCHEMA_VERSION || record.suite !== zk.SUITE_ID || record.suiteVersion !== zk.SUITE_VERSION) fail("Unsupported group wrap suite");
  const normalized = {
    ...record, compartmentId: text(record.compartmentId, "compartmentId"), epoch: epoch(record.epoch), objectId: text(record.objectId, "objectId"),
    versionId: text(record.versionId, "versionId"), keyRef: text(record.keyRef, "keyRef"), recipientId: text(record.recipientId, "recipientId"), deviceId: text(record.deviceId, "deviceId"),
  };
  bytes(record.wrapId, "wrapId", 16);
  bytes(record.wrapped, "wrapped", 60);
  bytes(record.aad, "aad");
  if (!Buffer.from(record.aad, "base64url").equals(aadFor(normalized, Buffer.from(record.wrapId, "base64url")))) fail("Group wrap AAD mismatch");
  return normalized;
}

async function unwrapOpaqueWrap(record, input) {
  const normalized = validateOpaqueWrap(record);
  for (const field of ["compartmentId", "objectId", "versionId", "keyRef", "recipientId", "deviceId"]) {
    if (normalized[field] !== input[field]) fail("Group wrap scope mismatch", "scope_mismatch");
  }
  if (normalized.epoch !== input.epoch) fail("Stale group epoch", "stale_epoch");
  return zk.unwrapKey({
    wrapped: bytes(normalized.wrapped, "wrapped", 60), cer: input.cer, aad: bytes(normalized.aad, "aad"), ...scope(input, bytes(normalized.wrapId, "wrapId", 16)),
  });
}

function validateManifest(manifest) {
  exact(manifest, ["groupId", "epoch", "wraps"]);
  if (!Array.isArray(manifest.wraps) || manifest.wraps.length > 500) fail("Invalid group manifest");
  return { groupId: text(manifest.groupId, "groupId"), epoch: epoch(manifest.epoch), wraps: manifest.wraps.map(validateOpaqueWrap) };
}

class GroupKeySharing {
  constructor({ groupId, members = [], epoch: currentEpoch = 1 } = {}) {
    this.groupId = text(groupId, "groupId");
    this.members = new Set(members.map((member) => text(member, "member")));
    this.revokedDevices = new Set();
    this.epoch = epoch(currentEpoch);
    this.wraps = [];
  }

  active(recipientId, deviceId) {
    return this.members.has(text(recipientId, "recipientId")) && !this.revokedDevices.has(text(deviceId, "deviceId"));
  }

  addMember(recipientId) { this.members.add(text(recipientId, "recipientId")); this.epoch += 1; return this.epoch; }
  removeMember(recipientId) { this.members.delete(text(recipientId, "recipientId")); this.epoch += 1; return this.epoch; }
  revokeDevice(deviceId) { this.revokedDevices.add(text(deviceId, "deviceId")); this.epoch += 1; return this.epoch; }
  rotate() { this.epoch += 1; this.wraps = []; return this.epoch; }

  async wrapFor(input) {
    if (!this.active(input.recipientId, input.deviceId)) fail("Recipient is not active", "revoked_recipient");
    if (epoch(input.epoch) !== this.epoch) fail("Stale group epoch", "stale_epoch");
    const record = await createOpaqueWrap({ ...input, epoch: this.epoch });
    this.wraps.push(record);
    return record;
  }

  manifest() {
    return validateManifest({ groupId: this.groupId, epoch: this.epoch, wraps: this.wraps });
  }

  async unwrap(record, input) {
    if (!this.active(input.recipientId, input.deviceId)) fail("Recipient is not active", "revoked_recipient");
    return unwrapOpaqueWrap(record, { ...input, epoch: this.epoch });
  }
}

module.exports = { GroupKeySharing, SCHEMA_VERSION, WRAP_FIELDS, createOpaqueWrap, unwrapOpaqueWrap, validateManifest, validateOpaqueWrap };
