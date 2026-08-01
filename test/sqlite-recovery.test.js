const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const test = require("node:test");
const { validateDatabase, recoverDatabaseRollback } = require("../services/restoreService");

test("SQLite restore staging validates and recovers safely", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-sqlite-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const valid = path.join(dir, "valid.sqlite");
  const db = new Database(valid); db.exec("PRAGMA foreign_keys = ON; CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO proof(value) VALUES ('ok');"); db.close();
  await t.test("valid database passes integrity", () => assert.doesNotThrow(() => validateDatabase(valid)));
  const corrupt = path.join(dir, "corrupt.sqlite"); fs.writeFileSync(corrupt, "not sqlite");
  await t.test("corrupt database is rejected", () => assert.throws(() => validateDatabase(corrupt)));
  const truncated = path.join(dir, "truncated.sqlite"); fs.writeFileSync(truncated, fs.readFileSync(valid).subarray(0, 100));
  await t.test("truncated database is rejected", () => assert.throws(() => validateDatabase(truncated)));
  const destination = path.join(dir, "configured.sqlite");
  const rollback = `${destination}.restore-rollback-interrupted`; fs.copyFileSync(valid, rollback);
  fs.writeFileSync(`${rollback}-wal`, "sidecar");
  recoverDatabaseRollback(destination);
  await t.test("interrupted primary is restored", () => assert.doesNotThrow(() => validateDatabase(destination)));
  await t.test("interrupted sidecar is restored", () => assert.equal(fs.readFileSync(`${destination}-wal`, "utf8"), "sidecar"));
  await t.test("existing destination is never replaced by recovery", () => {
    const preserve = path.join(dir, "preserve.sqlite"); fs.copyFileSync(valid, preserve); fs.writeFileSync(`${preserve}.restore-rollback-stale`, "old");
    recoverDatabaseRollback(preserve); assert.doesNotThrow(() => validateDatabase(preserve)); assert.equal(fs.existsSync(`${preserve}.restore-rollback-stale`), true);
  });
});
