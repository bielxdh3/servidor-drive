const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDb, isDbEnabled, jsonStringify, safeJsonParse } = require("../db");
const { RUNTIME_ROOT, resolveRuntimePath } = require("../src/runtime-paths");

const HISTORY_FILE = resolveRuntimePath("data", "backup-history.json");
const MUTATION_LOCK_FILE = resolveRuntimePath("data", ".backup-metadata.lock");
const MUTATION_LOCK_FORMAT_VERSION = 1;
const MUTATION_LOCK_TTL_MS = 30 * 1000;
const MALFORMED_LOCK_TTL_MS = 60 * 1000;
const MAX_LOCK_TTL_MS = 5 * 60 * 1000;
const CLAIM_PREFIX = `${path.basename(MUTATION_LOCK_FILE)}.claim-`;

function boundedLockDuration(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1000, Math.min(MAX_LOCK_TTL_MS, value));
}

function runtimeRootIdentity() {
  try { return fs.realpathSync(RUNTIME_ROOT); } catch { return path.resolve(RUNTIME_ROOT); }
}

function processStartIdentity(pid) {
  if (process.platform !== "linux") return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
    return fields[19] || null;
  } catch {
    return null;
  }
}

const CURRENT_PROCESS_START_IDENTITY = processStartIdentity(process.pid);

function mutationBusy(reason) {
  const error = new Error("Outra mutacao de metadados de backup esta em andamento");
  error.code = "BACKUP_METADATA_LOCK_BUSY";
  error.reason = reason;
  return error;
}

function sameRuntimeRoot(left, right) {
  const normalize = (value) => path.normalize(String(value || ""));
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validLockRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (record.formatVersion !== MUTATION_LOCK_FORMAT_VERSION) return false;
  if (typeof record.token !== "string" || !record.token) return false;
  if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
  if (typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return false;
  if (typeof record.runtimeRootIdentity !== "string" || !record.runtimeRootIdentity) return false;
  return typeof record.operationName === "string" && Boolean(record.operationName);
}

function ownerIsLive(record) {
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if (error.code === "EPERM") return true;
    return false;
  }
  if (record.processStartIdentity && processStartIdentity(record.pid)) {
    return record.processStartIdentity === processStartIdentity(record.pid);
  }
  return true;
}

function readMutationLock() {
  let stat;
  try {
    stat = fs.statSync(MUTATION_LOCK_FILE);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  try {
    const record = JSON.parse(fs.readFileSync(MUTATION_LOCK_FILE, "utf8"));
    if (!validLockRecord(record)) return { kind: "malformed", mtimeMs: stat.mtimeMs };
    if (!sameRuntimeRoot(record.runtimeRootIdentity, runtimeRootIdentity())) {
      return { kind: "mismatch", record };
    }
    const createdAtMs = Date.parse(record.createdAt);
    const ageMs = Date.now() - createdAtMs;
    const ttlMs = boundedLockDuration("ROOTARK_JSON_LOCK_TTL_MS", MUTATION_LOCK_TTL_MS);
    return { kind: "valid", record, ageMs, live: ownerIsLive(record), expired: ageMs > ttlMs };
  } catch {
    return { kind: "malformed", mtimeMs: stat.mtimeMs };
  }
}

function sameFileIdentity(left, right) {
  if (!left || !right) return false;
  if (left.dev !== right.dev || left.ino !== right.ino) return false;
  return left.birthtimeMs === right.birthtimeMs || left.ctimeMs === right.ctimeMs;
}

function cleanupOwnedIncompleteLock(fd, descriptorStat, token) {
  try {
    const currentStat = fs.statSync(MUTATION_LOCK_FILE);
    const content = fs.readFileSync(MUTATION_LOCK_FILE, "utf8");
    if (sameFileIdentity(descriptorStat, currentStat) || content.includes(`"token":"${token}"`)) {
      fs.rmSync(MUTATION_LOCK_FILE, { force: true });
    }
  } catch {}
}

function cleanupClaim(claimPath) {
  if (!claimPath) return;
  try { fs.rmSync(claimPath, { force: true }); } catch {}
}

function cleanupOldClaims() {
  const directory = path.dirname(MUTATION_LOCK_FILE);
  const cutoff = Date.now() - boundedLockDuration("ROOTARK_JSON_MALFORMED_TTL_MS", MALFORMED_LOCK_TTL_MS);
  let names;
  try { names = fs.readdirSync(directory); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(CLAIM_PREFIX)) continue;
    const claimPath = path.join(directory, name);
    try {
      if (fs.statSync(claimPath).mtimeMs < cutoff) fs.rmSync(claimPath, { force: true });
    } catch {}
  }
}

function claimStaleMutationLock() {
  const claimPath = `${MUTATION_LOCK_FILE}.claim-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(MUTATION_LOCK_FILE, claimPath);
    return claimPath;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function acquireJsonMutationLock(operationName = "restore-sync") {
  fs.mkdirSync(path.dirname(MUTATION_LOCK_FILE), { recursive: true });
  cleanupOldClaims();
  let claimPath = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = readMutationLock();
    if (state.kind === "mismatch") throw mutationBusy("runtime-root-mismatch");
    if (state.kind === "valid" && state.live && !state.expired) throw mutationBusy("live-owner");
    if (state.kind === "malformed") {
      const ageMs = Date.now() - state.mtimeMs;
      const ttlMs = boundedLockDuration("ROOTARK_JSON_MALFORMED_TTL_MS", MALFORMED_LOCK_TTL_MS);
      if (ageMs <= ttlMs) throw mutationBusy("recent-malformed");
    }
    if (state.kind === "valid" || state.kind === "malformed") {
      claimPath = claimStaleMutationLock();
      if (!claimPath) continue;
    }

    let fd;
    let descriptorStat;
    const token = crypto.randomUUID();
    try {
      fd = fs.openSync(MUTATION_LOCK_FILE, "wx");
      descriptorStat = fs.fstatSync(fd);
      const record = {
        formatVersion: MUTATION_LOCK_FORMAT_VERSION,
        token,
        pid: process.pid,
        processStartIdentity: CURRENT_PROCESS_START_IDENTITY,
        createdAt: new Date().toISOString(),
        runtimeRootIdentity: runtimeRootIdentity(),
        operationName,
      };
      const contents = Buffer.from(JSON.stringify(record));
      let offset = 0;
      while (offset < contents.length) {
        const written = fs.writeSync(fd, contents, offset, contents.length - offset);
        if (!written) throw new Error("Backup metadata lock write made no progress");
        offset += written;
      }
      fs.fsyncSync(fd);
      cleanupClaim(claimPath);
      claimPath = null;
      let released = false;
      return {
        token,
        release() {
          if (released) return;
          released = true;
          let ownsPath = false;
          try {
            const current = JSON.parse(fs.readFileSync(MUTATION_LOCK_FILE, "utf8"));
            ownsPath = current.token === token;
          } catch {}
          try { fs.closeSync(fd); } catch {}
          if (ownsPath) {
            try { fs.rmSync(MUTATION_LOCK_FILE, { force: true }); } catch {}
          }
        },
      };
    } catch (error) {
      try { if (fd !== undefined) fs.closeSync(fd); } catch {}
      cleanupOwnedIncompleteLock(fd, descriptorStat, token);
      cleanupClaim(claimPath);
      claimPath = null;
      if (error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw mutationBusy("claim-race");
}

function withJsonMutationLock(callback, operationName = "restore-sync") {
  const lease = acquireJsonMutationLock(operationName);
  try {
    return callback();
  } finally {
    lease.release();
  }
}

function rowToBackup(row) {
  const metadata = safeJsonParse(row.metadata_json, {});
  return {
    id: row.id,
    filename: row.filename,
    type: row.type,
    status: row.status,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    finishedAt: row.finished_at || null,
    sizeBytes: Number(row.size_bytes) || 0,
    checksum: row.checksum || null,
    errorMessage: row.error_message || null,
    metadata,
  };
}

function normalize(entry = {}) {
  return {
    id: entry.id,
    filename: entry.filename,
    type: entry.type || "manual",
    status: entry.status || "success",
    createdBy: entry.createdBy || entry.created_by || null,
    createdAt: entry.createdAt || entry.created_at || new Date().toISOString(),
    finishedAt: entry.finishedAt || entry.finished_at || null,
    sizeBytes: Number(entry.sizeBytes ?? entry.size_bytes) || 0,
    checksum: entry.checksum || null,
    errorMessage: entry.errorMessage || entry.error_message || null,
    metadata: entry.metadata || {},
  };
}

function loadJsonHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
    return Array.isArray(entries) ? entries.map(normalize) : [];
  } catch {
    return [];
  }
}

function saveJsonHistory(entries) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const temporary = `${HISTORY_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries.map(normalize), null, 2));
  try {
    fs.renameSync(temporary, HISTORY_FILE);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function mutationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function applyRestoreSyncMutation(current, options) {
  const sync = current?.metadata?.restoreSync;
  if (!sync || sync.operationId !== options.operationId) throw mutationError("backup_mutation_conflict", "Restore operation mismatch");
  const revision = Number(sync.revision) || 0;
  if (revision !== options.expectedRevision) throw mutationError("backup_revision_conflict", "Restore metadata revision mismatch");
  const index = sync.entries?.findIndex((entry) => entry.entryId === options.entryId) ?? -1;
  if (index < 0) throw mutationError("backup_entry_not_found", "Restore entry not found");
  const entry = sync.entries[index];
  const expectedStates = Array.isArray(options.expectedState) ? options.expectedState : [options.expectedState];
  if (!expectedStates.includes(entry.state)) throw mutationError("backup_state_conflict", "Restore entry state mismatch");
  if (entry.leaseToken !== options.expectedLeaseToken) throw mutationError("backup_lease_conflict", "Restore entry lease mismatch");
  const result = options.mutate({ ...entry }, current);
  if (!result || !result.entry) throw new TypeError("Restore mutation must return an entry");
  const entries = sync.entries.map((value, currentIndex) => currentIndex === index ? result.entry : { ...value });
  const aggregateState = entries.some((value) => value.state === "terminal_failure")
    ? "terminal_failure"
    : entries.length && entries.every((value) => value.state === "completed")
      ? "completed"
      : entries.length && entries.every((value) => value.state === "cancelled")
        ? "cancelled"
        : "pending";
  const at = result.at || new Date().toISOString();
  const nextSync = {
    ...sync,
    ...result.details,
    entries,
    state: aggregateState,
    revision: revision + 1,
    transitions: aggregateState !== sync.state ? [...(sync.transitions || []), { state: aggregateState, at }] : (sync.transitions || []),
  };
  if (aggregateState === "completed") nextSync.completedAt = nextSync.completedAt || at;
  if (aggregateState !== "completed") nextSync.completedAt = null;
  return { ...current, metadata: { ...current.metadata, restoreSync: nextSync } };
}

function mutateRestoreSyncEntry(options = {}) {
  for (const required of ["backupId", "operationId", "entryId", "expectedState", "expectedLeaseToken", "expectedRevision", "mutate"]) {
    if (!(required in options)) throw new TypeError(`Missing restore mutation field: ${required}`);
  }
  if (isDbEnabled() && hasBackupTable()) {
    const db = getDb();
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT id, filename, type, status, created_by, created_at, finished_at, size_bytes, checksum, error_message, metadata_json
        FROM backup_history WHERE id = ?
      `).get(options.backupId);
      if (!row) throw mutationError("backup_not_found", "Backup not found");
      const current = rowToBackup(row);
      const updated = applyRestoreSyncMutation(current, options);
      const result = db.prepare("UPDATE backup_history SET metadata_json = ? WHERE id = ? AND metadata_json = ?")
        .run(jsonStringify(updated.metadata), options.backupId, row.metadata_json);
      if (result.changes !== 1) throw mutationError("backup_revision_conflict", "Restore metadata compare-and-swap failed");
      return updated;
    })();
  }

  return withJsonMutationLock(() => {
    const entries = loadJsonHistory();
    const current = entries.find((entry) => entry.id === options.backupId);
    if (!current) throw mutationError("backup_not_found", "Backup not found");
    const updated = applyRestoreSyncMutation(current, options);
    const index = entries.findIndex((entry) => entry.id === options.backupId);
    entries[index] = updated;
    saveJsonHistory(entries);
    return normalize(updated);
  });
}

function hasBackupTable() {
  try {
    return Boolean(getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_history'").get());
  } catch {
    return false;
  }
}

function listBackups() {
  if (isDbEnabled() && hasBackupTable()) {
    return getDb().prepare(`
      SELECT id, filename, type, status, created_by, created_at, finished_at, size_bytes, checksum, error_message, metadata_json
      FROM backup_history
      ORDER BY created_at DESC
    `).all().map(rowToBackup);
  }

  return loadJsonHistory().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getBackup(id) {
  if (!id) return null;
  if (isDbEnabled() && hasBackupTable()) {
    const row = getDb().prepare(`
      SELECT id, filename, type, status, created_by, created_at, finished_at, size_bytes, checksum, error_message, metadata_json
      FROM backup_history
      WHERE id = ?
    `).get(id);
    return row ? rowToBackup(row) : null;
  }

  return loadJsonHistory().find((entry) => entry.id === id) || null;
}

function saveBackup(entry) {
  const normalized = normalize(entry);
  if (isDbEnabled() && hasBackupTable()) {
    getDb().prepare(`
      INSERT INTO backup_history (id, filename, type, status, created_by, created_at, finished_at, size_bytes, checksum, error_message, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename,
        type = excluded.type,
        status = excluded.status,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        finished_at = excluded.finished_at,
        size_bytes = excluded.size_bytes,
        checksum = excluded.checksum,
        error_message = excluded.error_message,
        metadata_json = excluded.metadata_json
    `).run(
      normalized.id,
      normalized.filename,
      normalized.type,
      normalized.status,
      normalized.createdBy,
      normalized.createdAt,
      normalized.finishedAt,
      normalized.sizeBytes,
      normalized.checksum,
      normalized.errorMessage,
      jsonStringify(normalized.metadata)
    );
    return normalized;
  }

  const entries = loadJsonHistory();
  const index = entries.findIndex((item) => item.id === normalized.id);
  if (index === -1) entries.push(normalized);
  else entries[index] = normalized;
  saveJsonHistory(entries);
  return normalized;
}

function deleteBackup(id) {
  if (isDbEnabled() && hasBackupTable()) {
    getDb().prepare("DELETE FROM backup_history WHERE id = ?").run(id);
    return;
  }

  saveJsonHistory(loadJsonHistory().filter((entry) => entry.id !== id));
}

function latestStatus() {
  return listBackups()[0] || null;
}

module.exports = {
  acquireJsonMutationLock,
  deleteBackup,
  getBackup,
  latestStatus,
  listBackups,
  mutateRestoreSyncEntry,
  releaseJsonMutationLock: (lease) => lease?.release?.(),
  saveBackup,
  withJsonMutationLock,
  MUTATION_LOCK_FILE,
};
