"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");

const protocol = require("./rootark-sync-protocol");
const { SyncJournal } = require("./rootark-sync-journal");

const SNAPSHOT_VERSION = 1;
const INTERNAL_NAMES = new Set([".rootark-trash", ".rootark-sync-journal.json", ".rootark-sync-index.json"]);

function fail(message, code = "sync_engine_error") {
  throw Object.assign(new Error(message), { code });
}

function transient(error) {
  return ["ECONNREFUSED", "ENETUNREACH", "ETIMEDOUT", "EAI_AGAIN", "offline"].includes(error?.code);
}

async function exists(filePath) {
  return fsp.lstat(filePath).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error));
}

async function containedAbsolute(rootDir, target, allowMissing = true) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(target);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) fail("Sync path escaped root", "unsafe_path");
  const rootStats = await fsp.lstat(root);
  if (rootStats.isSymbolicLink()) fail("Sync root symlink is not supported", "unsafe_path");
  let current = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await fsp.lstat(current);
      if (stats.isSymbolicLink()) fail("Sync symlink path is not supported", "unsafe_path");
    } catch (error) {
      if (!allowMissing || error.code !== "ENOENT") throw error;
      break;
    }
  }
  return resolved;
}

async function contained(rootDir, relativePath, allowMissing = true) {
  const safe = protocol.safeRelativePath(relativePath, "path");
  return containedAbsolute(rootDir, path.resolve(rootDir, ...safe.split("/")), allowMissing);
}

async function durableJson(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fsp.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, filePath);
}

class SyncEngine {
  constructor(options = {}) {
    if (!options.adapter || typeof options.adapter.push !== "function" || typeof options.adapter.list !== "function") {
      fail("Sync adapter with push and list is required");
    }
    this.rootDir = path.resolve(options.rootDir || process.cwd());
    this.journal = options.journal || new SyncJournal(options.journalPath || path.join(this.rootDir, ".rootark-sync-journal.json"));
    this.snapshotPath = path.resolve(options.snapshotPath || path.join(this.rootDir, ".rootark-sync-index.json"));
    this.adapter = options.adapter;
    this.deviceId = String(options.deviceId || "");
    this.keyEpoch = String(options.keyEpoch || "");
    this.compartmentId = String(options.compartmentId || "");
    this.fileKeyResolver = options.fileKeyResolver || (() => options.fileKey);
    this.authorize = options.authorize || (() => true);
    this.maxRetries = Math.max(1, Math.min(5, Number(options.maxRetries || 3)));
    this.snapshot = { version: SNAPSHOT_VERSION, files: {} };
    this.opened = false;
  }

  async open() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    await containedAbsolute(this.rootDir, this.rootDir, false);
    this.journal = await this.journal.open();
    try {
      const parsed = JSON.parse(await fsp.readFile(this.snapshotPath, "utf8"));
      if (parsed.version !== SNAPSHOT_VERSION || !parsed.files || typeof parsed.files !== "object") throw new Error("Invalid sync snapshot");
      this.snapshot = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") fail("Invalid sync snapshot", "invalid_snapshot");
      await durableJson(this.snapshotPath, this.snapshot);
    }
    this.opened = true;
    return this;
  }

  async keyFor(operation) {
    await this.authorize(operation);
    if (operation.keyEpoch !== this.keyEpoch && this.keyEpoch) fail("Stale sync key epoch", "stale_key_epoch");
    const key = await this.fileKeyResolver(operation);
    if (!key) fail("No authorized file key is available", "key_unavailable");
    return key;
  }

  async buildOperation(input) {
    const key = input.fileKey || await this.fileKeyResolver(input);
    return protocol.createOperation({
      ...input,
      deviceId: input.deviceId || this.deviceId,
      keyEpoch: input.keyEpoch || this.keyEpoch,
      compartmentId: input.compartmentId || this.compartmentId,
      operationId: input.operationId || crypto.randomUUID(),
      fileKey: key,
    });
  }

  async enqueueChange(input) {
    if (!this.opened) await this.open();
    const operation = protocol.validateOperation(await this.buildOperation(input));
    await this.journal.enqueue(operation);
    this.rememberOperation(operation);
    await durableJson(this.snapshotPath, this.snapshot);
    return operation;
  }

  async retryPush(operation) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try { return await this.adapter.push(operation); } catch (error) {
        lastError = error;
        if (!transient(error) || attempt + 1 === this.maxRetries) throw error;
      }
    }
    throw lastError;
  }

  async pushPending(summary) {
    for (const pending of await this.journal.recover()) {
      try {
        const operation = protocol.validateOperation(pending);
        const result = await this.retryPush(operation);
        if (result?.status >= 400) {
          if (result.status !== 409) fail("Sync push rejected", "push_rejected");
          summary.conflicts.push({ operationId: operation.operationId, policy: "remote-wins", currentRevision: result.currentRevision || null });
          if (result.current) await this.apply(protocol.validateOperation(result.current), summary);
        }
        await this.journal.markSeen(operation.operationId);
        summary.pushed += 1;
      } catch (error) {
        if (transient(error)) { summary.offline = true; continue; }
        throw error;
      }
    }
  }

  async stageExisting(target) {
    if (!(await exists(target))) return null;
    const trashDir = path.join(this.rootDir, ".rootark-trash");
    await fsp.mkdir(trashDir, { recursive: true });
    await containedAbsolute(this.rootDir, trashDir, false);
    const trashTarget = path.join(trashDir, `${Date.now()}-${crypto.randomUUID()}-${path.basename(target)}`);
    await containedAbsolute(this.rootDir, trashTarget, true);
    await fsp.rename(target, trashTarget);
    return trashTarget;
  }

  async apply(operation, summary = null) {
    const key = await this.keyFor(operation);
    const plaintext = protocol.decryptPayload(operation, key);
    const metadata = operation.metadata || {};
    if (!metadata.path) fail("Sync operation path is required", "unsafe_path");
    const target = await contained(this.rootDir, metadata.path, true);
    if (operation.operation === "delete" || operation.tombstone) {
      await this.stageExisting(target);
      this.snapshot.files[metadata.path] = { objectId: operation.objectId, fileId: operation.fileId, versionId: operation.versionId, revision: operation.revision, deleted: true };
    } else if (operation.operation === "move") {
      if (!metadata.sourcePath) fail("Move source path is required", "unsafe_path");
      const source = await contained(this.rootDir, metadata.sourcePath, true);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await containedAbsolute(this.rootDir, path.dirname(target), false);
      if (await exists(target)) await this.stageExisting(target);
      if (await exists(source)) await fsp.rename(source, target);
      delete this.snapshot.files[metadata.sourcePath];
      this.rememberOperation(operation);
    } else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await containedAbsolute(this.rootDir, path.dirname(target), false);
      if (metadata.contentType === "inode/directory") {
        await fsp.mkdir(target, { recursive: false }).catch((error) => { if (error.code !== "EEXIST") throw error; });
      } else {
        const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
        await fsp.writeFile(temporary, plaintext, { mode: 0o600 });
        try {
          if (await exists(target)) await this.stageExisting(target);
          await fsp.rename(temporary, target);
        } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
      }
      this.rememberOperation(operation, crypto.createHash("sha256").update(plaintext).digest("hex"));
    }
    await durableJson(this.snapshotPath, this.snapshot);
    if (summary) summary.applied = (summary.applied || 0) + 1;
  }

  async scanFiles() {
    const result = {};
    const walk = async (directory, prefix = "") => {
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (prefix === "" && INTERNAL_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".rootark-put-") || entry.name.startsWith(".rootark-move-")) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const target = path.join(directory, entry.name);
        await containedAbsolute(this.rootDir, target, false);
        if (entry.isDirectory()) await walk(target, relative);
        else if (entry.isFile()) {
          const data = await fsp.readFile(target);
          result[relative] = { hash: crypto.createHash("sha256").update(data).digest("hex"), size: data.length };
        }
      }
    };
    await walk(this.rootDir);
    return result;
  }

  async reconcileLocal() {
    const current = await this.scanFiles();
    for (const [relative, prior] of Object.entries(this.snapshot.files)) {
      if (prior.deleted || current[relative]) continue;
      const key = await this.fileKeyResolver(prior);
      const operation = await this.buildOperation({ operation: "delete", objectId: prior.objectId, fileId: prior.fileId, versionId: crypto.randomUUID(), baseRevision: prior.revision, revision: { counter: (prior.revision?.counter || 0) + 1, deviceId: this.deviceId }, metadata: { path: relative }, fileKey: key });
      await this.journal.enqueue(operation);
      this.rememberOperation(operation);
    }
    for (const [relative, file] of Object.entries(current)) {
      const prior = this.snapshot.files[relative];
      if (prior && !prior.deleted && prior.hash === file.hash) continue;
      const isUpdate = prior && !prior.deleted;
      const objectId = isUpdate ? prior.objectId : `object-${crypto.createHash("sha256").update(relative).digest("hex").slice(0, 32)}`;
      const fileId = isUpdate ? prior.fileId : `file-${crypto.createHash("sha256").update(relative).digest("hex").slice(0, 32)}`;
      const data = await fsp.readFile(path.join(this.rootDir, ...relative.split("/")));
      const key = await this.fileKeyResolver({ objectId, fileId, path: relative, keyEpoch: this.keyEpoch });
      const operation = await this.buildOperation({ operation: isUpdate ? "update" : "create", objectId, fileId, versionId: crypto.randomUUID(), baseRevision: isUpdate ? prior.revision : null, revision: { counter: (prior?.revision?.counter || 0) + 1, deviceId: this.deviceId }, metadata: { path: relative, name: path.basename(relative), size: data.length }, plaintext: data, fileKey: key });
      await this.journal.enqueue(operation);
      this.rememberOperation(operation, file.hash);
    }
    await durableJson(this.snapshotPath, this.snapshot);
  }

  rememberOperation(operation, hash) {
    const pathName = operation.metadata?.path;
    if (!pathName) return;
    this.snapshot.files[pathName] = {
      objectId: operation.objectId, fileId: operation.fileId, versionId: operation.versionId,
      revision: operation.revision, hash: hash || this.snapshot.files[pathName]?.hash, deleted: Boolean(operation.tombstone),
    };
  }

  async pullRemote(summary) {
    const result = await this.adapter.list();
    const records = Array.isArray(result) ? result : result?.objects;
    if (!Array.isArray(records)) fail("Sync pull returned an invalid record list", "invalid_pull");
    const ordered = [...records].sort((left, right) => String(left.objectId).localeCompare(String(right.objectId)) || String(left.versionId).localeCompare(String(right.versionId)));
    for (const raw of ordered) {
      const operation = protocol.validateOperation(raw);
      if (this.journal.hasSeen(operation.operationId)) continue;
      await this.apply(operation, summary);
      await this.journal.markSeen(operation.operationId);
      summary.pulled += 1;
    }
  }

  async syncOnce() {
    if (!this.opened) await this.open();
    const summary = { pushed: 0, pulled: 0, applied: 0, conflicts: [], offline: false };
    await this.reconcileLocal();
    await this.pushPending(summary);
    if (!summary.offline) await this.pullRemote(summary);
    return summary;
  }
}

module.exports = { SyncEngine, contained, containedAbsolute };
