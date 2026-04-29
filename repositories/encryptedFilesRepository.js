const { loadKeyedObjectFromTable, saveKeyedObjectToTable, safeJsonParse, jsonStringify } = require("./repositoryUtils");

function loadEncryptedFiles() {
  return loadKeyedObjectFromTable({
    selectSql: "SELECT folder_id, file_name, metadata_json FROM encrypted_files",
    mapRow: (row) => safeJsonParse(row.metadata_json, {}),
  });
}

function saveEncryptedFiles(entries = {}) {
  saveKeyedObjectToTable(entries, {
    deleteSql: "DELETE FROM encrypted_files",
    insertSql: `
      INSERT INTO encrypted_files (folder_id, file_name, encryption_level, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_id, file_name) DO UPDATE SET
        encryption_level = excluded.encryption_level,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
    toParams: ({ entry, folderId, fileName, now }) => [
      folderId,
      fileName,
      entry?.encryptionLevel || "server-key",
      jsonStringify(entry),
      entry?.uploadedAt || entry?.createdAt || now,
      entry?.updatedAt || now,
    ],
  });
}

module.exports = { loadEncryptedFiles, saveEncryptedFiles };
