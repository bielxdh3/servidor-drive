const fs = require("fs");
const path = require("path");
const { ROOT_DIR, getDb, isDbEnabled, jsonStringify, safeJsonParse } = require("../db");

const HISTORY_FILE = path.join(ROOT_DIR, "data", "backup-history.json");

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
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.map(normalize), null, 2));
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
  saveBackup,
};
