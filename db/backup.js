const fs = require("fs");
const path = require("path");
const { ROOT_DIR, getDatabasePath } = require("./index");

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getRetention() {
  const retention = Number(process.env.DB_BACKUP_RETENTION || 10);
  return Number.isInteger(retention) && retention > 0 ? retention : 10;
}

function cleanupOldBackups(backupsDir, retention = getRetention()) {
  const files = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir)
        .filter((name) => /^rootark-\d{4}-.*\.sqlite$/.test(name))
        .map((name) => ({
          name,
          path: path.join(backupsDir, name),
          mtime: fs.statSync(path.join(backupsDir, name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
    : [];

  for (const file of files.slice(retention)) {
    fs.rmSync(file.path, { force: true });
  }
}

function backupDatabase(options = {}) {
  const databasePath = options.databasePath || getDatabasePath();
  const backupsDir = options.backupsDir || path.join(ROOT_DIR, "data", "backups");

  if (!fs.existsSync(databasePath)) {
    return { skipped: true, reason: "database_not_found", databasePath };
  }

  fs.mkdirSync(backupsDir, { recursive: true });
  const backupPath = path.join(backupsDir, `rootark-${getTimestamp()}.sqlite`);
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  cleanupOldBackups(backupsDir, options.retention || getRetention());

  return { skipped: false, backupPath };
}

if (require.main === module) {
  const result = backupDatabase();
  if (result.skipped) {
    console.log(`Backup ignorado: ${result.reason}`);
  } else {
    console.log(`Backup criado: ${result.backupPath}`);
  }
}

module.exports = {
  backupDatabase,
  cleanupOldBackups,
};
