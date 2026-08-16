"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { compareRevisions, validateOperation } = require("../../sync-client/rootark-sync-protocol");
const { attestCiphertextOnlySyncState } = require("../services/deploymentResilience");

const STORE_VERSION = 1;
const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;

function isUnsupportedDirectorySync(error) {
  return ["EINVAL", "ENOTSUP"].includes(error?.code)
    || (process.platform === "win32" && error?.code === "EPERM");
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    if (handle) await handle.close();
  }
}

function errorResponse(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

async function durableWrite(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const handle = await fs.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
  await syncDirectory(directory);
}

function publicRecord(record) {
  return {
    protocolVersion: record.protocolVersion,
    operationId: record.operationId,
    objectId: record.objectId,
    fileId: record.fileId,
    versionId: record.versionId,
    operation: record.operation,
    revision: record.revision,
    baseRevision: record.baseRevision,
    keyEpoch: record.keyEpoch,
    compartmentId: record.compartmentId,
    deviceId: record.deviceId,
    metadata: record.metadata,
    tombstone: Boolean(record.tombstone),
    ciphertext: record.ciphertext || null,
    nonce: record.nonce || null,
    tag: record.tag || null,
    aad: record.aad || null,
  };
}

class SyncObjectStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = { version: STORE_VERSION, users: {} };
    this.queue = Promise.resolve();
  }

  async open() {
    try {
      this.state = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (this.state.version !== STORE_VERSION || !this.state.users || typeof this.state.users !== "object") throw new Error("Invalid sync object store");
      attestCiphertextOnlySyncState(this.state);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await durableWrite(this.filePath, this.state);
    }
    return this;
  }

  async transact(mutator) {
    let result;
    this.queue = this.queue.then(async () => {
      const next = JSON.parse(JSON.stringify(this.state));
      result = await mutator(next);
      await durableWrite(this.filePath, next);
      this.state = next;
    });
    await this.queue;
    return result;
  }

  user(next, username) {
    const current = next.users[username] || { objects: {}, seen: {} };
    next.users[username] = current;
    return current;
  }

  async put(username, input) {
    return this.transact((next) => {
      const user = this.user(next, username);
      if (user.seen[input.operationId]) return { kind: "replay", record: null };
      const current = user.objects[input.objectId] || null;
      if (input.operation === "create" && current) return { kind: "conflict", current };
      if (input.operation !== "create" && !current) return { kind: "conflict", current: null };
      if (current && input.baseRevision && compareRevisions(input.baseRevision, current.revision) !== 0) return { kind: "conflict", current };
      if (current && !input.baseRevision) return { kind: "conflict", current };
      if (current && compareRevisions(input.revision, current.revision) <= 0) return { kind: "stale", current };
      const record = publicRecord(input);
      user.objects[input.objectId] = record;
      user.seen[input.operationId] = true;
      return { kind: "stored", record };
    });
  }

  list(username, objectId = null) {
    const user = this.state.users[username] || { objects: {} };
    if (objectId) return user.objects[objectId] ? [publicRecord(user.objects[objectId])] : [];
    return Object.values(user.objects).map(publicRecord);
  }
}

function registerSyncRoutes({ app, authenticate, requirePermission, storagePath = process.env.SYNC_OBJECTS_FILE || "./data/sync-objects.json" }) {
  const store = new SyncObjectStore(storagePath);
  const ready = store.open();
  const sizeGuard = (req, res, next) => {
    const length = Number(req.headers["content-length"]);
    if (Number.isSafeInteger(length) && length > MAX_REQUEST_BYTES) return errorResponse(res, 413, "Sync payload too large");
    next();
  };
  const write = async (req, res, input) => {
    await ready;
    const payload = input === undefined ? req.body : input;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return errorResponse(res, 400, "Invalid sync payload");
    if (Object.hasOwn(payload, "plaintext") || Object.hasOwn(payload, "fileKey")) return errorResponse(res, 400, "Plaintext and keys are not accepted");
    if (typeof payload.ciphertext === "string" && Buffer.byteLength(payload.ciphertext, "base64url") > MAX_CIPHERTEXT_BYTES) return errorResponse(res, 413, "Ciphertext too large");
    let operation;
    try { operation = validateOperation(payload); } catch (error) { return errorResponse(res, error.code === "payload_too_large" ? 413 : 400, "Invalid sync operation"); }
    const result = await store.put(req.user.username, operation);
    if (result.kind === "replay") return errorResponse(res, 409, "Replay rejected");
    if (result.kind === "stale") return errorResponse(res, 409, "Stale revision rejected", { currentRevision: result.current.revision });
    if (result.kind === "conflict") return errorResponse(res, 409, "Base revision conflict", { currentRevision: result.current?.revision || null });
    return res.status(req.method === "POST" ? 201 : 200).json(publicRecord(result.record));
  };

  app.get("/sync/v1/objects", authenticate, requirePermission("listFiles"), async (req, res) => {
    await ready;
    res.json({ protocolVersion: 1, objects: store.list(req.user.username, req.query.objectId ? String(req.query.objectId) : null) });
  });
  app.get("/sync/v1/objects/:objectId", authenticate, requirePermission("listFiles"), async (req, res) => {
    await ready;
    const objects = store.list(req.user.username, req.params.objectId);
    if (!objects.length) return errorResponse(res, 404, "Sync object not found");
    res.json(objects[0]);
  });
  app.post("/sync/v1/objects", sizeGuard, authenticate, requirePermission("upload"), (req, res) => write(req, res));
  app.put("/sync/v1/objects/:objectId", sizeGuard, authenticate, requirePermission("upload"), (req, res) => {
    if (req.body?.objectId && req.body.objectId !== req.params.objectId) return errorResponse(res, 400, "Object id mismatch");
    return write(req, res);
  });
  app.delete("/sync/v1/objects/:objectId", sizeGuard, authenticate, requirePermission("upload"), (req, res) => {
    if (req.body?.objectId && req.body.objectId !== req.params.objectId) return errorResponse(res, 400, "Object id mismatch");
    return write(req, res, { ...req.body, objectId: req.params.objectId, operation: "delete", tombstone: true });
  });
  return { store, ready };
}

module.exports = { MAX_CIPHERTEXT_BYTES, MAX_REQUEST_BYTES, SyncObjectStore, registerSyncRoutes };
