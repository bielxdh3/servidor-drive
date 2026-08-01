function parseBackupTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function scheduleAutomaticBackups({ env = process.env, cron, createBackup, auditLog = () => {}, onInvalid = () => {} }) {
  if (String(env.BACKUP_ENABLED || "true").toLowerCase() === "false" || String(env.BACKUP_AUTO_ENABLED || "true").toLowerCase() === "false") return null;
  const time = parseBackupTime(env.BACKUP_TIME || "03:00");
  if (!time) { onInvalid("BACKUP_TIME invalido. Use HH:mm."); return null; }
  const timezone = env.BACKUP_TIMEZONE || "UTC";
  let running = false;
  return cron.schedule(`${time.minute} ${time.hour} * * *`, async () => {
    if (running) return;
    running = true;
    try {
      const backup = await createBackup({ type: "automatic", createdBy: "system" });
      auditLog("backup.created", { username: "system" }, { type: "backup", id: backup.id }, "created", "success", { filename: backup.filename, automatic: true });
    } catch (error) {
      auditLog("backup.failed", { username: "system" }, { type: "backup", id: error.backup?.id || null }, "created", "failure", { error: error.message, automatic: true });
    } finally {
      running = false;
    }
  }, { timezone });
}

module.exports = { parseBackupTime, scheduleAutomaticBackups };
