const { getDb } = require("../db");
const { ensureFolderId, ensureRootFolder, jsonStringify, nowIso, runWrite, safeJsonParse, splitStorageKey, basename } = require("./repositoryUtils");

function loadPendingUploads() {
  const rows = getDb().prepare("SELECT id, file_name, original_name, folder_id, uploaded_by, uploaded_at, size, metadata_json FROM pending_uploads").all();
  const entries = {};
  for (const row of rows) {
    const metadata = safeJsonParse(row.metadata_json, {});
    entries[row.id] = {
      ...metadata,
      fileName: row.file_name,
      originalName: row.original_name || metadata.originalName || null,
      folderId: row.folder_id || "root",
      uploadedBy: row.uploaded_by || metadata.uploadedBy || null,
      uploadedAt: row.uploaded_at || metadata.uploadedAt || null,
      size: Number(row.size) || Number(metadata.size) || 0,
    };
  }
  return entries;
}

function savePendingUploads(entries = {}) {
  const db = getDb();
  runWrite(db, () => {
    ensureRootFolder(db);
    db.prepare("DELETE FROM pending_uploads").run();
    const insert = db.prepare(`
      INSERT INTO pending_uploads (id, file_name, original_name, folder_id, uploaded_by, uploaded_at, size, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_name = excluded.file_name,
        original_name = excluded.original_name,
        folder_id = excluded.folder_id,
        uploaded_by = excluded.uploaded_by,
        uploaded_at = excluded.uploaded_at,
        size = excluded.size,
        metadata_json = excluded.metadata_json
    `);

    for (const [key, entry] of Object.entries(entries || {})) {
      const parsed = splitStorageKey(key);
      const folderId = entry?.folderId || parsed.folderId || "root";
      const fileName = basename(entry?.fileName || parsed.fileName);
      if (!fileName) continue;
      ensureFolderId(db, folderId);
      const id = `${folderId}/${fileName}`;
      insert.run(
        id,
        fileName,
        entry?.originalName || null,
        folderId,
        entry?.uploadedBy || null,
        entry?.uploadedAt || nowIso(),
        Number(entry?.size) || 0,
        jsonStringify(entry)
      );
    }
  });
}

module.exports = { loadPendingUploads, savePendingUploads };
