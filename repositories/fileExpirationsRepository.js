const { loadKeyedObjectFromTable, saveKeyedObjectToTable } = require("./repositoryUtils");

function loadFileExpirations() {
  return loadKeyedObjectFromTable({
    selectSql: "SELECT folder_id, file_name, expires_at, created_by, created_at FROM file_expirations",
    mapRow: (row) => ({
      folderId: row.folder_id,
      fileName: row.file_name,
      expiresAt: row.expires_at,
      createdBy: row.created_by || null,
      createdAt: row.created_at,
    }),
  });
}

function saveFileExpirations(entries = {}) {
  saveKeyedObjectToTable(entries, {
    deleteSql: "DELETE FROM file_expirations",
    insertSql: `
      INSERT INTO file_expirations (folder_id, file_name, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(folder_id, file_name) DO UPDATE SET
        expires_at = excluded.expires_at,
        created_by = excluded.created_by
    `,
    toParams: ({ entry, folderId, fileName, now }) => [
      folderId,
      fileName,
      entry?.expiresAt || entry?.expires_at || now,
      entry?.createdBy || entry?.created_by || entry?.updatedBy || null,
      entry?.createdAt || entry?.created_at || entry?.updatedAt || now,
    ],
  });
}

module.exports = { loadFileExpirations, saveFileExpirations };
