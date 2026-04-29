const { getDb } = require("../db");
const { ensureFolderId, ensureRootFolder, jsonStringify, nowIso, runWrite, safeJsonParse, basename } = require("./repositoryUtils");

function rowToLink(row) {
  const metadata = safeJsonParse(row.metadata_json, {});
  return {
    ...metadata,
    fileName: row.file_name,
    folderId: row.folder_id || "root",
    createdBy: row.created_by || metadata.createdBy || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxViews: Number(row.max_views) || 0,
    views: Number(row.views) || 0,
    passwordHash: row.password_hash || metadata.passwordHash || null,
  };
}

function loadPublicLinks() {
  const rows = getDb().prepare(`
    SELECT token, folder_id, file_name, created_by, created_at, expires_at, max_views, views, password_hash, metadata_json
    FROM public_links
    WHERE revoked_at IS NULL
  `).all();
  return Object.fromEntries(rows.map((row) => [row.token, rowToLink(row)]));
}

function savePublicLinks(entries = {}) {
  const db = getDb();
  const now = nowIso();
  runWrite(db, () => {
    ensureRootFolder(db);
    db.prepare("DELETE FROM public_links").run();
    const insert = db.prepare(`
      INSERT INTO public_links (token, folder_id, file_name, created_by, created_at, expires_at, max_views, views, password_hash, metadata_json, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(token) DO UPDATE SET
        folder_id = excluded.folder_id,
        file_name = excluded.file_name,
        created_by = excluded.created_by,
        expires_at = excluded.expires_at,
        max_views = excluded.max_views,
        views = excluded.views,
        password_hash = excluded.password_hash,
        metadata_json = excluded.metadata_json,
        revoked_at = NULL
    `);

    for (const [token, link] of Object.entries(entries || {})) {
      const fileName = basename(link?.fileName);
      if (!/^[a-f0-9]{48}$/i.test(token) || !fileName) continue;
      ensureFolderId(db, link.folderId || "root");
      insert.run(
        token,
        link.folderId || "root",
        fileName,
        link.createdBy || null,
        link.createdAt || now,
        link.expiresAt || now,
        Number(link.maxViews) || 0,
        Number(link.views) || 0,
        link.passwordHash || link.password_hash || null,
        jsonStringify(link)
      );
    }
  });
}

function incrementPublicLinkViews(token, link) {
  const db = getDb();
  const update = () => {
    const row = db.prepare("SELECT views FROM public_links WHERE token = ? AND revoked_at IS NULL").get(token);
    if (!row) return null;

    db.prepare(`
      UPDATE public_links
      SET views = views + 1,
          metadata_json = ?
      WHERE token = ?
    `).run(jsonStringify(link), token);

    return (Number(row.views) || 0) + 1;
  };
  const updated = db.inTransaction ? update() : db.transaction(update)();

  return updated;
}

module.exports = {
  incrementPublicLinkViews,
  loadPublicLinks,
  savePublicLinks,
};
