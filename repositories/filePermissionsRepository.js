const { loadKeyedObjectFromTable, saveKeyedObjectToTable, safeJsonParse, jsonStringify } = require("./repositoryUtils");

function loadFilePermissions() {
  return loadKeyedObjectFromTable({
    selectSql: "SELECT folder_id, file_name, allowed_users_json FROM file_permissions",
    mapRow: (row) => safeJsonParse(row.allowed_users_json, {}),
  });
}

function saveFilePermissions(entries = {}) {
  saveKeyedObjectToTable(entries, {
    deleteSql: "DELETE FROM file_permissions",
    insertSql: `
      INSERT INTO file_permissions (folder_id, file_name, allowed_users_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(folder_id, file_name) DO UPDATE SET
        allowed_users_json = excluded.allowed_users_json,
        updated_at = excluded.updated_at
    `,
    toParams: ({ entry, folderId, fileName, now }) => [
      folderId,
      fileName,
      jsonStringify(entry),
      entry?.createdAt || entry?.created_at || now,
      entry?.updatedAt || entry?.updated_at || now,
    ],
  });
}

module.exports = { loadFilePermissions, saveFilePermissions };
