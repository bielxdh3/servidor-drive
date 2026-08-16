"use strict";

const crypto = require("node:crypto");

const PROTOCOL_VERSION = 1;
const MAX_ID_LENGTH = 160;
const MAX_METADATA_BYTES = 16 * 1024;
const OPERATIONS = new Set(["create", "update", "move", "delete"]);
const METADATA_KEYS = [
  "fileId", "versionId", "path", "parentId", "name", "contentType", "size",
  "keyEpoch", "compartmentId", "deviceId",
];

function fail(message, code = "invalid_operation") {
  throw Object.assign(new Error(message), { code });
}

function id(value, name) {
  const result = String(value || "");
  if (!result || result.length > MAX_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(result)) fail(`Invalid ${name}`);
  return result;
}

function revision(value, name = "revision") {
  if (!value || !Number.isSafeInteger(value.counter) || value.counter < 0) fail(`Invalid ${name}`);
  return { counter: value.counter, deviceId: id(value.deviceId, `${name}.deviceId`) };
}

function compareRevisions(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.counter - right.counter || left.deviceId.localeCompare(right.deviceId);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function normalizeMetadata(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid metadata");
  const result = {};
  for (const key of METADATA_KEYS) {
    if (!Object.hasOwn(input, key) || input[key] === undefined || input[key] === null) continue;
    const value = input[key];
    if (key === "size") {
      if (!Number.isSafeInteger(value) || value < 0) fail("Invalid metadata.size");
      result[key] = value;
    } else if (["path", "name", "contentType"].includes(key)) {
      const text = String(value);
      if (!text || text.length > 512 || /[\u0000-\u001f\u007f]/.test(text)) fail(`Invalid metadata.${key}`);
      result[key] = text;
    } else {
      result[key] = id(value, `metadata.${key}`);
    }
  }
  if (Buffer.byteLength(canonicalJson(result)) > MAX_METADATA_BYTES) fail("Metadata too large", "payload_too_large");
  return canonicalize(result);
}

function assertFileKey(fileKey) {
  const key = Buffer.isBuffer(fileKey) ? fileKey : Buffer.from(fileKey || []);
  if (key.length !== 32) fail("A 32-byte per-file key is required");
  return key;
}

function aadFor(operation) {
  return canonicalJson({
    protocolVersion: PROTOCOL_VERSION,
    objectId: operation.objectId,
    fileId: operation.fileId,
    versionId: operation.versionId,
    operation: operation.operation,
    revision: operation.revision,
    baseRevision: operation.baseRevision || null,
    keyEpoch: operation.keyEpoch,
    compartmentId: operation.compartmentId,
    deviceId: operation.deviceId,
  });
}

function encryptPayload(operation, plaintext, fileKey) {
  const key = assertFileKey(fileKey);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const aad = Buffer.from(aadFor(operation), "utf8");
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    aad: aad.toString("base64url"),
  };
}

function decryptPayload(operation, fileKey) {
  if (!operation.ciphertext || !operation.nonce || !operation.tag || !operation.aad) fail("Encrypted payload is incomplete");
  const key = assertFileKey(fileKey);
  const nonce = Buffer.from(operation.nonce, "base64url");
  const tag = Buffer.from(operation.tag, "base64url");
  const aad = Buffer.from(operation.aad, "base64url");
  const expectedAad = Buffer.from(aadFor(operation), "utf8");
  if (aad.length !== expectedAad.length || !crypto.timingSafeEqual(aad, expectedAad)) fail("AAD binding mismatch", "aad_mismatch");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(operation.ciphertext, "base64url")), decipher.final()]);
}

function createOperation(input = {}) {
  const operation = String(input.operation || "");
  if (!OPERATIONS.has(operation)) fail("Invalid sync operation");
  const objectId = id(input.objectId || crypto.randomUUID(), "objectId");
  const fileId = id(input.fileId || objectId, "fileId");
  const versionId = id(input.versionId || crypto.randomUUID(), "versionId");
  const deviceId = id(input.deviceId, "deviceId");
  const keyEpoch = id(input.keyEpoch, "keyEpoch");
  const compartmentId = id(input.compartmentId, "compartmentId");
  const baseRevision = input.baseRevision == null ? null : revision(input.baseRevision, "baseRevision");
  const result = {
    protocolVersion: PROTOCOL_VERSION,
    operationId: id(input.operationId || crypto.randomUUID(), "operationId"),
    objectId,
    fileId,
    versionId,
    operation,
    revision: revision(input.revision, "revision"),
    baseRevision,
    keyEpoch,
    compartmentId,
    deviceId,
    metadata: normalizeMetadata({ ...input.metadata, fileId, versionId, keyEpoch, compartmentId, deviceId }),
    tombstone: operation === "delete",
  };
  if (operation === "delete") return result;
  if (operation === "move") return result;
  Object.assign(result, encryptPayload(result, input.plaintext, input.fileKey));
  return result;
}

function validateOperation(input) {
  const operation = createOperation({ ...input, plaintext: Buffer.alloc(0), fileKey: Buffer.alloc(32) });
  if (input.operation === "delete" || input.operation === "move") return operation;
  for (const field of ["ciphertext", "nonce", "tag", "aad"]) {
    if (typeof input[field] !== "string" || !input[field]) fail(`Missing encrypted field: ${field}`);
  }
  return { ...operation, ciphertext: input.ciphertext, nonce: input.nonce, tag: input.tag, aad: input.aad };
}

function nextRevision(current, deviceId) {
  const device = id(deviceId, "deviceId");
  return { counter: Math.max(0, Number(current?.counter) || 0) + 1, deviceId: device };
}

module.exports = {
  PROTOCOL_VERSION,
  OPERATIONS,
  METADATA_KEYS,
  canonicalJson,
  compareRevisions,
  createOperation,
  decryptPayload,
  nextRevision,
  normalizeMetadata,
  validateOperation,
};
