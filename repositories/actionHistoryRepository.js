const { getDb } = require("../db");
const { jsonStringify, randomId, runWrite, safeJsonParse } = require("./repositoryUtils");

function loadActionHistory() {
  return getDb().prepare(`
    SELECT id, action_type, username, folder_id, file_name, timestamp, details_json
    FROM actions_history
    ORDER BY timestamp DESC
  `).all().map((row) => ({
    id: row.id,
    action: row.action_type,
    fileName: row.file_name,
    actor: row.username || "sistema",
    timestamp: row.timestamp,
    details: safeJsonParse(row.details_json, {}),
  }));
}

function saveActionHistory(entries = []) {
  const db = getDb();
  runWrite(db, () => {
    db.prepare("DELETE FROM actions_history").run();
    const insert = db.prepare(`
      INSERT INTO actions_history (id, action_type, username, folder_id, file_name, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action_type = excluded.action_type,
        username = excluded.username,
        folder_id = excluded.folder_id,
        file_name = excluded.file_name,
        timestamp = excluded.timestamp,
        details_json = excluded.details_json
    `);
    for (const entry of entries || []) {
      insert.run(
        entry.id || randomId(),
        entry.action || entry.actionType || "unknown",
        entry.actor || entry.username || "sistema",
        entry.details?.folderId || entry.folderId || null,
        entry.fileName || entry.file_name || null,
        entry.timestamp || new Date().toISOString(),
        jsonStringify(entry.details || {})
      );
    }
  });
}

module.exports = { loadActionHistory, saveActionHistory };
