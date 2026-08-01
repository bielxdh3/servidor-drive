const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const servicePath = path.join(__dirname, "..", "services", "backupService");

function run(script) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-backup-lock-"));
  const result = spawnSync(process.execPath, ["-e", `process.chdir(${JSON.stringify(runtime)}); process.env.DB_ENABLED = "false"; ${script}`], { encoding: "utf8" });
  fs.rmSync(runtime, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("backup names and lock recovery remain safe", async (t) => {
  await t.test("two backups created in one second receive distinct names", () => {
    const result = run(`const service = require(${JSON.stringify(servicePath)}); (async () => { const first = await service.createBackup(); const second = await service.createBackup(); console.log(JSON.stringify([first.filename, second.filename])); })().catch((error) => { console.error(error); process.exitCode = 1; });`);
    assert.notEqual(result[0], result[1]);
  });

  await t.test("dead stale locks are recovered", () => {
    const result = run(`const fs = require("fs"); const service = require(${JSON.stringify(servicePath)}); fs.mkdirSync(service.BACKUPS_DIR, { recursive: true }); fs.writeFileSync(service.LOCK_FILE, JSON.stringify({ pid: 99999999 })); fs.utimesSync(service.LOCK_FILE, new Date(0), new Date(0)); const release = service.acquireLock("backup"); release(); console.log(JSON.stringify({ exists: fs.existsSync(service.LOCK_FILE) }));`);
    assert.equal(result.exists, false);
  });

  await t.test("a live PID lock remains authoritative even when old", () => {
    const result = run(`const fs = require("fs"); const service = require(${JSON.stringify(servicePath)}); fs.mkdirSync(service.BACKUPS_DIR, { recursive: true }); fs.writeFileSync(service.LOCK_FILE, JSON.stringify({ pid: process.pid })); fs.utimesSync(service.LOCK_FILE, new Date(0), new Date(0)); try { service.acquireLock("backup"); process.exitCode = 2; } catch (error) { console.log(JSON.stringify(error.code)); }`);
    assert.equal(result, "BACKUP_LOCKED");
  });

  await t.test("old malformed locks recover but recent malformed locks do not", () => {
    for (const [age, expected] of [[0, true], [Date.now(), false]]) {
      const result = run(`const fs = require("fs"); const service = require(${JSON.stringify(servicePath)}); fs.mkdirSync(service.BACKUPS_DIR, { recursive: true }); fs.writeFileSync(service.LOCK_FILE, "broken"); fs.utimesSync(service.LOCK_FILE, new Date(${age}), new Date(${age})); try { const release = service.acquireLock("backup"); release(); console.log(JSON.stringify(true)); } catch { console.log(JSON.stringify(false)); }`);
      assert.equal(result, expected);
    }
  });
});
