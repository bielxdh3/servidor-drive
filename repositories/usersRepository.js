const { getDb } = require("../db");
const { jsonStringify, nowIso, runWrite, safeJsonParse } = require("./repositoryUtils");

function loadUsers() {
  return getDb().prepare(`
    SELECT username, password_hash, role, permissions_json
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY id ASC
  `).all().map((row) => ({
    username: row.username,
    password: row.password_hash,
    role: row.role,
    permissions: safeJsonParse(row.permissions_json, {}),
  }));
}

function saveUsers(users = []) {
  const db = getDb();
  const now = nowIso();
  runWrite(db, () => {
    const active = new Set();
    const upsert = db.prepare(`
      INSERT INTO users (username, password_hash, role, permissions_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role,
        permissions_json = excluded.permissions_json,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `);

    for (const user of users) {
      const username = String(user?.username || "").trim();
      if (!username) continue;
      active.add(username);
      upsert.run(
        username,
        user.password || user.password_hash || "",
        user.role || "user",
        jsonStringify(user.permissions || {}),
        user.createdAt || user.created_at || now,
        now
      );
    }

    const current = db.prepare("SELECT username FROM users WHERE deleted_at IS NULL").all();
    const softDelete = db.prepare("UPDATE users SET deleted_at = ?, updated_at = ? WHERE username = ?");
    for (const row of current) {
      if (!active.has(row.username)) softDelete.run(now, now, row.username);
    }
  });
}

module.exports = { loadUsers, saveUsers };
