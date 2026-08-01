const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function runNode(script, options) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["-e", script], options, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout));
  });
}

test("configured SQLite backup and restore preserve the database path", { timeout: 30_000 }, async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-backup-sqlite-runtime-"));
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-backup-sqlite-db-"));
  const databasePath = path.join(databaseDir, "configured.sqlite");
  t.after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); fs.rmSync(databaseDir, { recursive: true, force: true }); });
  const script = `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const Database = require(${JSON.stringify(path.join(ROOT, "node_modules", "better-sqlite3"))});
    const unzipper = require(${JSON.stringify(path.join(ROOT, "node_modules", "unzipper"))});
    const databasePath = process.env.DATABASE_URL;
    const db = new Database(databasePath);
    db.exec("CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES ('configured-path');");
    db.close();
      const backupService = require(${JSON.stringify(path.join(ROOT, "services", "backupService"))});
      const restoreService = require(${JSON.stringify(path.join(ROOT, "services", "restoreService"))});
      (async () => {
        const backup = await backupService.createBackup({ createdBy: "test" });
        const archivePath = backupService.getArchivePath(backup.filename);
        const zip = await unzipper.Open.file(archivePath);
        const entry = zip.files.find((file) => file.path === "data/rootark.sqlite");
        assert.ok(entry);
        const archived = await entry.buffer();
        const mutated = new Database(databasePath);
        mutated.prepare("UPDATE proof SET value = 'mutated'").run();
        mutated.close();
        await restoreService.restoreBackup(backup.id, { confirmation: "RESTORE", username: "test" });
        assert.deepEqual(fs.readFileSync(databasePath), archived);
      assert.equal(fs.existsSync(path.join(process.cwd(), "data", "backups")), true);
      assert.equal(fs.existsSync(path.join(process.cwd(), "data", "backup-history.json")), true);
      console.log(JSON.stringify({ ok: true, archivePath, databasePath }));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const stdout = await runNode(script, { cwd: sandbox, env: { ...process.env, DB_ENABLED: "true", DATABASE_URL: databasePath, BACKUP_ENABLED: "true", BACKUP_INCLUDE_UPLOADS: "false" } });
  assert.equal(JSON.parse(stdout).ok, true);
});
