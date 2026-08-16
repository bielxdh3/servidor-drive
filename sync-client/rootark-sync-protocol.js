"use strict";

const crypto = require("node:crypto");

const PROTOCOL_VERSION = 2;
const MAX_ID_LENGTH = 160;
const MAX_METADATA_BYTES = 16 * 1024;
const OPERATIONS = new Set(["create", "update", "move", "delete"]);
const METADATA_KEYS = [
  "fileId", "versionId", "path", "parentId", "name", "contentType", "size",
  "keyEpoch", "compartmentId", "deviceId", "sourcePath",
];
const METADATA_KEYS_BY_OPERATION = Object.freeze({
  create: new Set(METADATA_KEYS.filter((key) => key !== "sourcePath")),
  update: new Set(METADATA_KEYS.filter((key) => key !== "sourcePath")),
  move: new Set(["fileId", "versionId", "path", "sourcePath", "keyEpoch", "compartmentId", "deviceId"]),
  delete: new Set(["fileId", "versionId", "path", "keyEpoch", "compartmentId", "deviceId"]),
});
const OPERATION_FIELDS = Object.freeze([
  "protocolVersion", "operationId", "objectId", "fileId", "versionId", "operation",
  "revision", "baseRevision", "keyEpoch", "compartmentId", "deviceId", "metadata",
  "tombstone", "ciphertext", "nonce", "tag", "aad",
]);
const RESERVED_PATH_SEGMENTS = new Set([
  ".rootark-trash", ".rootark-sync", ".rootark-sync-state.json", ".rootark-sync.json",
]);

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

function assertExactKeys(input, allowed, name) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) fail(`Unknown ${name} field: ${key}`);
  }
}

function safeRelativePath(value, name) {
  const text = String(value || "");
  if (!text || text.length > 512 || text.includes("%") || text.includes("\\") || text.startsWith("/") || /^[A-Za-z]:[\\/]/.test(text)) {
    fail(`Invalid metadata.${name}`);
  }
  const segments = text.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || RESERVED_PATH_SEGMENTS.has(segment))) {
    fail(`Invalid metadata.${name}`);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) fail(`Invalid metadata.${name}`);
  return text;
}

function normalizeMetadata(input = {}, allowedKeys = METADATA_KEYS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid metadata");
  assertExactKeys(input, allowedKeys, "metadata");
  const result = {};
  for (const key of allowedKeys) {
    if (!Object.hasOwn(input, key) || input[key] === undefined || input[key] === null) continue;
    const value = input[key];
    if (key === "size") {
      if (!Number.isSafeInteger(value) || value < 0) fail("Invalid metadata.size");
      result[key] = value;
    } else if (["path", "sourcePath"].includes(key)) {
      result[key] = safeRelativePath(value, key);
    } else if (["name", "contentType"].includes(key)) {
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
    metadata: operation.metadata,
    tombstone: operation.tombstone,
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

function decodeBase64Url(value, field) {
  if (typeof value !== "string" || (field !== "ciphertext" && !value) || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    fail(`Invalid encrypted field: ${field}`, "invalid_envelope");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) fail(`Invalid encrypted field: ${field}`, "invalid_envelope");
  if (field === "nonce" && decoded.length !== 12 || field === "tag" && decoded.length !== 16) {
    fail(`Invalid encrypted field: ${field}`, "invalid_envelope");
  }
  return decoded;
}

function decryptPayload(operation, fileKey) {
  if (typeof operation.ciphertext !== "string" || !operation.nonce || !operation.tag || !operation.aad) fail("Encrypted payload is incomplete");
  const key = assertFileKey(fileKey);
  const ciphertext = decodeBase64Url(operation.ciphertext, "ciphertext");
  const nonce = decodeBase64Url(operation.nonce, "nonce");
  const tag = decodeBase64Url(operation.tag, "tag");
  const aad = decodeBase64Url(operation.aad, "aad");
  const expectedAad = Buffer.from(aadFor(operation), "utf8");
  if (aad.length !== expectedAad.length || !crypto.timingSafeEqual(aad, expectedAad)) fail("AAD binding mismatch", "aad_mismatch");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
    metadata: normalizeMetadata(
      { ...input.metadata, fileId, versionId, keyEpoch, compartmentId, deviceId },
      METADATA_KEYS_BY_OPERATION[operation],
    ),
    tombstone: operation === "delete",
  };
  const plaintext = input.plaintext === undefined ? Buffer.from("{}", "utf8") : input.plaintext;
  Object.assign(result, encryptPayload(result, plaintext, input.fileKey));
  return result;
}

function validateOperation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid operation");
  if (input.protocolVersion !== PROTOCOL_VERSION) fail("Unsupported sync protocol version", "invalid_protocol_version");
  assertExactKeys(input, OPERATION_FIELDS, "operation");
  for (const field of OPERATION_FIELDS) {
    if (!Object.hasOwn(input, field)) fail(`Missing operation field: ${field}`);
  }
  const operation = createOperation({ ...input, plaintext: Buffer.alloc(0), fileKey: Buffer.alloc(32) });
  if (input.tombstone !== operation.tombstone) fail("Invalid tombstone flag");
  if (!operation.metadata.path) fail("Operation metadata.path is required");
  if (operation.operation === "move" && !operation.metadata.sourcePath) fail("Move metadata.sourcePath is required");
  for (const field of ["ciphertext", "nonce", "tag", "aad"]) {
    if (typeof input[field] !== "string" || (field !== "ciphertext" && !input[field])) fail(`Missing encrypted field: ${field}`);
  }
  decodeBase64Url(input.ciphertext, "ciphertext");
  decodeBase64Url(input.nonce, "nonce");
  decodeBase64Url(input.tag, "tag");
  const aad = decodeBase64Url(input.aad, "aad");
  const expectedAad = Buffer.from(aadFor(operation), "utf8");
  if (aad.length !== expectedAad.length || !crypto.timingSafeEqual(aad, expectedAad)) fail("AAD binding mismatch", "aad_mismatch");
  return { ...operation, ciphertext: input.ciphertext, nonce: input.nonce, tag: input.tag, aad: input.aad };
}

function nextRevision(current, deviceId) {
  const device = id(deviceId, "deviceId");
  return { counter: Math.max(0, Number(current?.counter) || 0) + 1, deviceId: device };
}

module.exports = {
  OPERATION_FIELDS,
  PROTOCOL_VERSION,
  OPERATIONS,
  METADATA_KEYS,
  canonicalJson,
  compareRevisions,
  createOperation,
  decryptPayload,
  nextRevision,
  normalizeMetadata,
  safeRelativePath,
  validateOperation,
};
