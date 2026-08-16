const { getDb } = require("../db");
const { jsonStringify, nowIso, runWrite, safeJsonParse } = require("./repositoryUtils");

function loadUsers() {
  return getDb().prepare(`
    SELECT username, password_hash, role, permissions_json, session_version, disabled,
      totp_enabled, totp_secret_json, totp_pending_secret_json, totp_recovery_hashes_json,
      totp_last_used_step, totp_enrolled_at
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
    totpEnabled: Boolean(row.totp_enabled),
    totpSecret: safeJsonParse(row.totp_secret_json, null),
    totpPendingSecret: safeJsonParse(row.totp_pending_secret_json, null),
    totpRecoveryHashes: safeJsonParse(row.totp_recovery_hashes_json, []),
    totpLastUsedStep: row.totp_last_used_step === null ? null : row.totp_last_used_step,
    totpEnrolledAt: row.totp_enrolled_at || null,
  }));
}

function saveUsers(users = []) {
  const db = getDb();
  const now = nowIso();
  runWrite(db, () => {
    const active = new Set();
    const upsert = db.prepare(`
      INSERT INTO users (username, password_hash, role, permissions_json, session_version, disabled,
        totp_enabled, totp_secret_json, totp_pending_secret_json, totp_recovery_hashes_json,
        totp_last_used_step, totp_enrolled_at, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role,
        permissions_json = excluded.permissions_json,
        session_version = CASE
          WHEN users.deleted_at IS NOT NULL THEN MAX(users.session_version + 1, excluded.session_version)
          ELSE excluded.session_version
        END,
        disabled = excluded.disabled,
        totp_enabled = excluded.totp_enabled,
        totp_secret_json = excluded.totp_secret_json,
        totp_pending_secret_json = excluded.totp_pending_secret_json,
        totp_recovery_hashes_json = excluded.totp_recovery_hashes_json,
        totp_last_used_step = excluded.totp_last_used_step,
        totp_enrolled_at = excluded.totp_enrolled_at,
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
        user.totpEnabled ? 1 : 0,
        user.totpSecret ? jsonStringify(user.totpSecret) : null,
        user.totpPendingSecret ? jsonStringify(user.totpPendingSecret) : null,
        jsonStringify(Array.isArray(user.totpRecoveryHashes) ? user.totpRecoveryHashes : []),
        Number.isSafeInteger(user.totpLastUsedStep) ? user.totpLastUsedStep : null,
        user.totpEnrolledAt || null,
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
