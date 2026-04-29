const { loadKeyedObjectFromTable, saveKeyedObjectToTable, safeJsonParse, jsonStringify } = require("./repositoryUtils");

function loadFileVersions() {
  return loadKeyedObjectFromTable({
    selectSql: "SELECT folder_id, file_name, versions_json FROM file_versions",
    mapRow: (row) => safeJsonParse(row.versions_json, {}),
  });
}

function saveFileVersions(entries = {}) {
  saveKeyedObjectToTable(entries, {
    deleteSql: "DELETE FROM file_versions",
    insertSql: `
      INSERT INTO file_versions (folder_id, file_name, versions_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(folder_id, file_name) DO UPDATE SET
        versions_json = excluded.versions_json,
        updated_at = excluded.updated_at
    `,
    toParams: ({ entry, folderId, fileName, now }) => [
      folderId,
      fileName,
      jsonStringify(entry),
      entry?.updatedAt || entry?.updated_at || now,
    ],
  });
}

module.exports = { loadFileVersions, saveFileVersions };
