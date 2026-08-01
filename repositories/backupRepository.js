const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDb, isDbEnabled, jsonStringify, safeJsonParse } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");

const HISTORY_FILE = resolveRuntimePath("data", "backup-history.json");
const MUTATION_LOCK_FILE = resolveRuntimePath("data", ".backup-metadata.lock");

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

function withJsonMutationLock(callback) {
  fs.mkdirSync(path.dirname(MUTATION_LOCK_FILE), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(MUTATION_LOCK_FILE, "wx");
    fs.writeFileSync(fd, String(process.pid), "utf8");
    return callback();
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(MUTATION_LOCK_FILE, { force: true }); } catch {}
    }
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
  deleteBackup,
  getBackup,
  latestStatus,
  listBackups,
  mutateRestoreSyncEntry,
  saveBackup,
};
