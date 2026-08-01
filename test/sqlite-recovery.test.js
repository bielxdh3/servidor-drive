const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const test = require("node:test");
const { validateDatabase, recoverDatabaseRollback } = require("../services/restoreService");

test("SQLite restore staging validates and recovers safely", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-sqlite-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const valid = path.join(dir, "valid.sqlite");
  const db = new Database(valid); db.exec("PRAGMA foreign_keys = ON; CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO proof(value) VALUES ('ok');"); db.close();
  assert.doesNotThrow(() => validateDatabase(valid));
  const corrupt = path.join(dir, "corrupt.sqlite"); fs.writeFileSync(corrupt, "not sqlite");
  assert.throws(() => validateDatabase(corrupt));
  const destination = path.join(dir, "configured.sqlite");
  const rollback = `${destination}.restore-rollback-interrupted`; fs.copyFileSync(valid, rollback);
  fs.writeFileSync(`${rollback}-wal`, "sidecar");
  recoverDatabaseRollback(destination);
  assert.doesNotThrow(() => validateDatabase(destination));
  assert.equal(fs.readFileSync(`${destination}-wal`, "utf8"), "sidecar");
});
