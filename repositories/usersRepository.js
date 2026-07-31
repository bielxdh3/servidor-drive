const { getDb } = require("../db");
const { jsonStringify, nowIso, runWrite, safeJsonParse } = require("./repositoryUtils");

function loadUsers() {
  return getDb().prepare(`
    SELECT username, password_hash, role, permissions_json, session_version, disabled
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY id ASC
  `).all().map((row) => ({
    username: row.username,
    password: row.password_hash,
    role: row.role,
    permissions: safeJsonParse(row.permissions_json, {}),
    sessionVersion: row.session_version || 0,
    disabled: Boolean(row.disabled),
  }));
}

function saveUsers(users = []) {
  const db = getDb();
  const now = nowIso();
  runWrite(db, () => {
    const active = new Set();
    const upsert = db.prepare(`
      INSERT INTO users (username, password_hash, role, permissions_json, session_version, disabled, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role,
        permissions_json = excluded.permissions_json,
        session_version = CASE
          WHEN users.deleted_at IS NOT NULL THEN MAX(users.session_version + 1, excluded.session_version)
          ELSE excluded.session_version
        END,
        disabled = excluded.disabled,
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
        user.sessionVersion || 0,
        user.disabled ? 1 : 0,
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
