const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const unzipper = require("unzipper");

test("online SQLite backup is a coherent snapshot while writers continue", async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-online-backup-"));
  const databasePath = path.join(runtime, "external.sqlite");
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const originalCwd = process.cwd();
  process.chdir(runtime);
  process.env.DB_ENABLED = "true";
  process.env.DATABASE_URL = databasePath;
  process.env.BACKUP_INCLUDE_UPLOADS = "false";
  const dbModule = require("../db");
  const backupService = require("../services/backupService");
  const live = dbModule.getDb();
  live.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT);");
  const insertLive = live.prepare("INSERT INTO proof(value) VALUES (?)");
  const other = new Database(databasePath);
  const insertOther = other.prepare("INSERT INTO proof(value) VALUES (?)");
  const liveTimer = setInterval(() => insertLive.run("live"), 1);
  const otherTimer = setInterval(() => insertOther.run("other"), 2);
  try {
    const backup = await backupService.createBackup({ createdBy: "test" });
    const archive = await unzipper.Open.file(backupService.getArchivePath(backup.filename));
    const entry = archive.files.find((file) => file.path === "data/rootark.sqlite");
    assert.ok(entry);
    const snapshotPath = path.join(runtime, "snapshot.sqlite");
    fs.writeFileSync(snapshotPath, await entry.buffer());
    const snapshot = new Database(snapshotPath, { readonly: true });
    assert.equal(snapshot.pragma("integrity_check", { simple: true }), "ok");
    assert.ok(snapshot.prepare("SELECT COUNT(*) AS count FROM proof").get().count >= 1);
    snapshot.close();
    assert.equal(archive.files.some((file) => file.path === "data/rootark.sqlite-wal"), false);
    assert.equal(archive.files.some((file) => file.path === "data/rootark.sqlite-shm"), false);
  } finally {
    clearInterval(liveTimer);
    clearInterval(otherTimer);
    other.close();
    dbModule.closeDb();
    process.chdir(originalCwd);
  }
});
