const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const unzipper = require("unzipper");

const originalCwd = process.cwd();
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-"));
process.chdir(runtime);
process.env.DB_ENABLED = "false";
const backupService = require("../services/backupService");

test("cloud-only files are staged into the archive without changing the live cache", async () => {
  fs.mkdirSync(path.join(runtime, "uploads"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "uploads", "local.txt"), "local");
  backupService.setCloudStorage({
    enabled: () => true,
    list: async (folderId, area) => folderId === "root" && area === "uploads" ? [{ name: "cloud.txt" }, { name: "local.txt" }] : [],
    download: async (_folderId, name, target) => { fs.writeFileSync(target, name === "cloud.txt" ? "cloud" : "local"); return true; },
  });
  const backup = await backupService.createBackup({ createdBy: "tester" });
  const archive = await unzipper.Open.file(path.join(runtime, "data", "backups", backup.filename));
  const manifest = JSON.parse((await archive.files.find((entry) => entry.path === "backup-manifest.json").buffer()).toString("utf8"));
  assert.equal(manifest.cloud_complete, true);
  assert.ok(archive.files.some((entry) => entry.path === "uploads/cloud.txt"));
  assert.equal(archive.files.filter((entry) => entry.path === "uploads/local.txt").length, 1);
  assert.equal(fs.existsSync(path.join(runtime, "uploads", "cloud.txt")), false);
  assert.equal(fs.existsSync(path.join(runtime, "data", "backups", ".cloud-stage")), false);
});

test("divergent cloud collisions fail closed and leave no archive", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-fail-"));
  const servicePath = path.join(__dirname, "..", "services", "backupService");
  const script = [
    `process.chdir(${JSON.stringify(isolated)}); process.env.DB_ENABLED = "false";`,
    'const fs = require("fs"); const path = require("path");',
    `const service = require(${JSON.stringify(servicePath)});`,
    'fs.mkdirSync("uploads", { recursive: true }); fs.writeFileSync("uploads/same.txt", "local");',
    'service.setCloudStorage({ enabled: () => true, list: async () => [{ name: "same.txt" }], download: async (_f, _n, target) => { fs.writeFileSync(target, "remote"); return true; } });',
    'service.createBackup().then(() => process.exitCode = 2).catch(() => { const backups = path.join(process.cwd(), "data", "backups"); const files = fs.existsSync(backups) ? fs.readdirSync(backups).filter((name) => name.endsWith(".zip")) : []; process.exitCode = files.length ? 3 : 0; });',
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  fs.rmSync(isolated, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
});

test("cloud inventory and download failures cannot create a successful backup", () => {
  for (const mode of ["list", "download"]) {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-error-"));
    const servicePath = path.join(__dirname, "..", "services", "backupService");
    const script = [
      `process.chdir(${JSON.stringify(isolated)}); process.env.DB_ENABLED = "false";`,
      'const fs = require("fs"); const path = require("path");',
      `const service = require(${JSON.stringify(servicePath)});`,
      `service.setCloudStorage({ enabled: () => true, list: async () => { ${mode === "list" ? 'throw new Error("unavailable");' : 'return [{ name: "cloud.txt" }];'} }, download: async () => { throw new Error("unavailable"); } });`,
      'service.createBackup().then(() => process.exitCode = 2).catch(() => { const backups = path.join(process.cwd(), "data", "backups"); const files = fs.existsSync(backups) ? fs.readdirSync(backups).filter((name) => name.endsWith(".zip")) : []; process.exitCode = files.length ? 3 : 0; });',
    ].join(" ");
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    fs.rmSync(isolated, { recursive: true, force: true });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("pending cloud objects are included only when configured", () => {
  const servicePath = path.join(__dirname, "..", "services", "backupService");
  for (const includePending of [false, true]) {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-pending-"));
    const script = [
      `process.chdir(${JSON.stringify(isolated)}); process.env.DB_ENABLED = "false"; process.env.BACKUP_INCLUDE_PENDING = ${JSON.stringify(String(includePending))};`,
      `const service = require(${JSON.stringify(servicePath)});`,
      'const calls = []; service.setCloudStorage({ enabled: () => true, list: async (_folder, area) => { calls.push(area); return []; }, download: async () => true });',
      'service.createBackup().then(() => console.log(JSON.stringify(calls))).catch((error) => { console.error(error); process.exitCode = 1; });',
    ].join(" ");
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    fs.rmSync(isolated, { recursive: true, force: true });
    assert.equal(result.status, 0, result.stderr);
    const calls = JSON.parse(result.stdout.trim());
    assert.deepEqual(calls, includePending ? ["uploads", "temp"] : ["uploads"]);
  }
});

test("unsafe cloud object names fail closed without retaining an archive", () => {
  const servicePath = path.join(__dirname, "..", "services", "backupService");
  for (const name of ["../escape.txt", "/absolute.txt", "nested/file.txt", "nested\\file.txt", ".env"]) {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-unsafe-"));
    const script = [
      `process.chdir(${JSON.stringify(isolated)}); process.env.DB_ENABLED = "false";`,
      'const fs = require("fs"); const path = require("path");',
      `const service = require(${JSON.stringify(servicePath)});`,
      `service.setCloudStorage({ enabled: () => true, list: async () => [{ name: ${JSON.stringify(name)} }], download: async () => true });`,
      'service.createBackup().then(() => process.exitCode = 2).catch(() => { const backups = path.join(process.cwd(), "data", "backups"); const files = fs.existsSync(backups) ? fs.readdirSync(backups).filter((file) => file.endsWith(".zip")) : []; process.exitCode = files.length ? 3 : 0; });',
    ].join(" ");
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    fs.rmSync(isolated, { recursive: true, force: true });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("a cloud-only object survives SQLite backup and restore", () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-sqlite-runtime-"));
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-cloud-backup-sqlite-db-"));
  const databasePath = path.join(databaseDir, "configured.sqlite");
  const servicePath = path.join(__dirname, "..", "services", "backupService");
  const restorePath = path.join(__dirname, "..", "services", "restoreService");
  const script = [
    `process.chdir(${JSON.stringify(isolated)}); process.env.DB_ENABLED = "true"; process.env.DATABASE_URL = ${JSON.stringify(databasePath)};`,
    'const assert = require("node:assert/strict"); const fs = require("node:fs");',
    `const Database = require(${JSON.stringify(path.join(__dirname, "..", "node_modules", "better-sqlite3"))});`,
    `const backup = require(${JSON.stringify(servicePath)}); const restore = require(${JSON.stringify(restorePath)});`,
    'const db = new Database(process.env.DATABASE_URL); db.exec("CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES (\'cloud\');"); db.close();',
    'backup.setCloudStorage({ enabled: () => true, list: async () => [{ name: "cloud.txt" }], download: async (_folder, _name, target) => { fs.writeFileSync(target, "cloud"); return true; } });',
    'backup.createBackup({ createdBy: "test" }).then(async (saved) => { fs.rmSync("uploads", { recursive: true, force: true }); await restore.restoreBackup(saved.id, { confirmation: "RESTORE", username: "test" }); assert.equal(fs.readFileSync("uploads/cloud.txt", "utf8"), "cloud"); console.log(JSON.stringify({ ok: true })); }).catch((error) => { console.error(error); process.exitCode = 1; });',
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  fs.rmSync(isolated, { recursive: true, force: true });
  fs.rmSync(databaseDir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).ok, true);
});

test.after(() => {
  backupService.setCloudStorage(null);
  process.chdir(originalCwd);
  fs.rmSync(runtime, { recursive: true, force: true });
});
