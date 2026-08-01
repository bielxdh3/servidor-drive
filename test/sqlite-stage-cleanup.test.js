const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("SQLite stage cleanup failure is observable without invalidating a completed archive", () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-sqlite-stage-cleanup-"));
  const servicePath = path.join(__dirname, "..", "services", "backupService");
  try {
    const result = spawnSync(process.execPath, ["-e", `
      const fs = require("node:fs");
      process.chdir(${JSON.stringify(runtime)});
      process.env.DB_ENABLED = "true";
      process.env.DATABASE_URL = ${JSON.stringify(path.join(runtime, "data", "rootark.sqlite"))};
      const db = require(${JSON.stringify(path.join(__dirname, "..", "db"))});
      const live = db.getDb();
      live.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('stage');");
      const service = require(${JSON.stringify(servicePath)});
      const originalRemove = fs.rmSync;
      fs.rmSync = (target, options) => String(target).includes(".sqlite-backup-")
        ? (() => { throw Object.assign(new Error("locked stage"), { code: "EBUSY" }); })()
        : originalRemove(target, options);
      (async () => {
        const backup = await service.createBackup();
        console.log(JSON.stringify({ status: backup.status, cleanup: backup.metadata.sqliteStageCleanup, archive: fs.existsSync(service.getArchivePath(backup.filename)) }));
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `], { encoding: "utf8", env: process.env });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
    assert.equal(output.status, "success");
    assert.deepEqual(output.cleanup, { code: "SQLITE_STAGE_CLEANUP_FAILED", message: "SQLite staging cleanup failed" });
    assert.equal(output.archive, true);
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});
