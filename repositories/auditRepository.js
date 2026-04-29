const { getDb } = require("../db");
const { jsonStringify, runWrite, safeJsonParse } = require("./repositoryUtils");

function rowToLog(row) {
  const details = safeJsonParse(row.details_json, {});
  return {
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    severity: row.severity,
    actor: {
      username: row.actor_username || "system",
      role: details.actorRole || null,
      ip: row.actor_ip || null,
      userAgent: details.userAgent || null,
    },
    target: row.target_type || row.target_id
      ? {
          type: row.target_type || null,
          id: row.target_id || null,
          metadata: details.targetMetadata || undefined,
        }
      : null,
    action: row.action,
    result: row.result,
    details: details.details || details,
  };
}

function logToRow(log) {
  const details = {
    details: log.details || {},
    actorRole: log.actor?.role || null,
    userAgent: log.actor?.userAgent || null,
    targetMetadata: log.target?.metadata || null,
  };
  return {
    id: log.id,
    eventType: log.eventType || log.event_type || "system.unknown",
    severity: log.severity || "info",
    actorUsername: log.actor?.username || log.actor_username || "system",
    actorIp: log.actor?.ip || log.actor_ip || null,
    targetType: log.target?.type || log.target_type || null,
    targetId: log.target?.id || log.target_id || null,
    action: log.action || "",
    result: log.result || "success",
    timestamp: log.timestamp || new Date().toISOString(),
    detailsJson: jsonStringify(details),
  };
}

function loadAuditLogs() {
  const rows = getDb().prepare(`
    SELECT id, event_type, severity, actor_username, actor_ip, target_type, target_id, action, result, timestamp, details_json
    FROM audit_logs
    ORDER BY timestamp ASC
  `).all();
  return { logs: rows.map(rowToLog) };
}

function saveAuditLogs(entries = {}) {
  const db = getDb();
  const logs = Array.isArray(entries?.logs) ? entries.logs : [];
  runWrite(db, () => {
    db.prepare("DELETE FROM audit_logs").run();
    const insert = db.prepare(`
      INSERT INTO audit_logs (id, event_type, severity, actor_username, actor_ip, target_type, target_id, action, result, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_type = excluded.event_type,
        severity = excluded.severity,
        actor_username = excluded.actor_username,
        actor_ip = excluded.actor_ip,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        action = excluded.action,
        result = excluded.result,
        timestamp = excluded.timestamp,
        details_json = excluded.details_json
    `);

    for (const log of logs) {
      const row = logToRow(log);
      insert.run(
        row.id,
        row.eventType,
        row.severity,
        row.actorUsername,
        row.actorIp,
        row.targetType,
        row.targetId,
        row.action,
        row.result,
        row.timestamp,
        row.detailsJson
      );
    }
  });
}

module.exports = { loadAuditLogs, saveAuditLogs };
