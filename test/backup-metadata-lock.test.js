const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const originalCwd = process.cwd();
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-metadata-lock-"));
const repoRoot = path.resolve(__dirname, "..");
process.chdir(runtime);
process.env.DB_ENABLED = "false";
const backupRepository = require("../repositories/backupRepository");

function reset() {
  fs.rmSync(path.join(runtime, "data"), { recursive: true, force: true });
  fs.mkdirSync(path.join(runtime, "data"), { recursive: true });
}

function rootIdentity() {
  return fs.realpathSync(runtime);
}

function lockRecord(overrides = {}) {
  return {
    formatVersion: 1,
    token: "seed-token",
    pid: process.pid,
    processStartIdentity: null,
    createdAt: new Date().toISOString(),
    runtimeRootIdentity: rootIdentity(),
    operationName: "restore-sync",
    ...overrides,
  };
}

function writeLock(value) {
  fs.mkdirSync(path.dirname(backupRepository.MUTATION_LOCK_FILE), { recursive: true });
  fs.writeFileSync(backupRepository.MUTATION_LOCK_FILE, typeof value === "string" ? value : JSON.stringify(value));
}

function readLock() {
  return JSON.parse(fs.readFileSync(backupRepository.MUTATION_LOCK_FILE, "utf8"));
}

function childSource(action) {
  const repositoryPath = JSON.stringify(path.join(repoRoot, "repositories", "backupRepository.js"));
  return `
    const fs = require("node:fs");
    const path = require("node:path");
    const repository = require(${repositoryPath});
    ${action}
  `;
}

function startChild(action, extraEnv = {}) {
  const child = spawn(process.execPath, ["-e", childSource(action)], {
    cwd: runtime,
    env: { ...process.env, NODE_PATH: process.env.NODE_PATH || path.join(repoRoot, "node_modules"), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const result = new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, result };
}

function runChild(action, extraEnv = {}) {
  return startChild(action, extraEnv).result;
}

function seedMutation() {
  const id = "00000000-0000-4000-8000-000000000001";
  return backupRepository.saveBackup({
    id,
    filename: "rootark-backup-2026-08-01-00-00-01.zip",
    metadata: {
      restoreSync: {
        operationId: "operation-1",
        revision: 0,
        state: "pending",
        entries: [{ entryId: "entry-1", state: "pending", leaseToken: null, leaseUntil: null }],
        transitions: [],
      },
    },
  });
}

test("JSON metadata lock uses crash-safe bounded ownership", async (t) => {
  await t.test("normal acquisition and release persist the complete record", () => {
    reset();
    const lease = backupRepository.acquireJsonMutationLock("test-operation");
    const record = readLock();
    assert.equal(record.formatVersion, 1);
    assert.equal(record.token, lease.token);
    assert.equal(record.pid, process.pid);
    assert.equal(record.operationName, "test-operation");
    assert.equal(record.runtimeRootIdentity, rootIdentity());
    assert.ok(record.createdAt);
    lease.release();
    assert.equal(fs.existsSync(backupRepository.MUTATION_LOCK_FILE), false);
  });

  await t.test("second live owner is denied without synchronous waiting", () => {
    reset();
    const lease = backupRepository.acquireJsonMutationLock();
    assert.throws(() => backupRepository.acquireJsonMutationLock(), { code: "BACKUP_METADATA_LOCK_BUSY" });
    lease.release();
  });

  await t.test("token mismatch does not release a replacement lock", () => {
    reset();
    const lease = backupRepository.acquireJsonMutationLock();
    writeLock(lockRecord({ token: "replacement-token" }));
    lease.release();
    assert.equal(readLock().token, "replacement-token");
    fs.rmSync(backupRepository.MUTATION_LOCK_FILE, { force: true });
  });

  await t.test("dead PID is reclaimed", async () => {
    reset();
    const child = await runChild("process.exit(19);");
    writeLock(lockRecord({ pid: child.pid || 999999, createdAt: new Date().toISOString() }));
    const lease = backupRepository.acquireJsonMutationLock();
    lease.release();
  });

  await t.test("recent live PID remains authoritative", () => {
    reset();
    writeLock(lockRecord());
    assert.throws(() => backupRepository.acquireJsonMutationLock(), { code: "BACKUP_METADATA_LOCK_BUSY" });
    fs.rmSync(backupRepository.MUTATION_LOCK_FILE, { force: true });
  });

  await t.test("expired lock is reclaimed", () => {
    reset();
    writeLock(lockRecord({ createdAt: new Date(Date.now() - 31_000).toISOString() }));
    const lease = backupRepository.acquireJsonMutationLock();
    assert.notEqual(readLock().token, "seed-token");
    lease.release();
  });

  await t.test("recent malformed lock fails closed", () => {
    reset();
    writeLock("not-json");
    assert.throws(() => backupRepository.acquireJsonMutationLock(), { code: "BACKUP_METADATA_LOCK_BUSY" });
    assert.equal(fs.readFileSync(backupRepository.MUTATION_LOCK_FILE, "utf8"), "not-json");
    fs.rmSync(backupRepository.MUTATION_LOCK_FILE, { force: true });
  });

  await t.test("old malformed lock is recovered through an atomic claim", () => {
    reset();
    writeLock("not-json");
    const old = new Date(Date.now() - 61_000);
    fs.utimesSync(backupRepository.MUTATION_LOCK_FILE, old, old);
    const lease = backupRepository.acquireJsonMutationLock();
    assert.equal(readLock().formatVersion, 1);
    lease.release();
    assert.deepEqual(fs.readdirSync(path.dirname(backupRepository.MUTATION_LOCK_FILE)), []);
  });

  await t.test("record write failure removes only the owned incomplete lock", () => {
    reset();
    const originalWrite = fs.writeSync;
    fs.writeSync = () => { throw new Error("injected lock write failure"); };
    try {
      assert.throws(() => backupRepository.acquireJsonMutationLock(), /injected lock write failure/);
    } finally {
      fs.writeSync = originalWrite;
    }
    assert.equal(fs.existsSync(backupRepository.MUTATION_LOCK_FILE), false);
  });

  await t.test("a crash immediately after creation is reclaimed by a fresh process", async () => {
    reset();
    const child = await runChild("const lease = repository.acquireJsonMutationLock('crash'); process.stdout.write(lease.token); process.exit(17);");
    assert.equal(child.code, 17, child.stderr);
    assert.equal(fs.existsSync(backupRepository.MUTATION_LOCK_FILE), true);
    const lease = backupRepository.acquireJsonMutationLock();
    lease.release();
  });

  await t.test("JSON restore synchronization resumes after crash-lock restart", async () => {
    reset();
    const saved = seedMutation();
    const child = await runChild("repository.acquireJsonMutationLock('crash'); process.exit(17);");
    assert.equal(child.code, 17, child.stderr);
    const current = backupRepository.getBackup(saved.id);
    const updated = backupRepository.mutateRestoreSyncEntry({
      backupId: saved.id,
      operationId: current.metadata.restoreSync.operationId,
      entryId: "entry-1",
      expectedState: "pending",
      expectedLeaseToken: null,
      expectedRevision: 0,
      mutate: (entry) => ({ entry: { ...entry, state: "completed" }, at: new Date().toISOString() }),
    });
    assert.equal(updated.metadata.restoreSync.entries[0].state, "completed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, "data", "backup-history.json"), "utf8"))[0].metadata.restoreSync.entries[0].state, "completed");
  });

  await t.test("two child processes race and exactly one claim wins", async () => {
    reset();
    const raceDir = path.join(runtime, "race");
    fs.mkdirSync(raceDir);
    const startFile = path.join(raceDir, "start");
    const readyA = path.join(raceDir, "ready-a");
    const readyB = path.join(raceDir, "ready-b");
    const action = `
      const ready = process.env.READY_FILE;
      fs.writeFileSync(ready, "ready");
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(process.env.START_FILE) && Date.now() < deadline) {}
      try {
        const lease = repository.acquireJsonMutationLock("race");
        console.log(JSON.stringify({ winner: true, token: lease.token }));
        setTimeout(() => { lease.release(); process.exit(0); }, 500);
      } catch (error) {
        console.log(JSON.stringify({ winner: false, code: error.code }));
        process.exit(error.code === "BACKUP_METADATA_LOCK_BUSY" ? 2 : 1);
      }
    `;
    const first = runChild(action, { READY_FILE: readyA, START_FILE: startFile });
    const second = runChild(action, { READY_FILE: readyB, START_FILE: startFile });
    const deadline = Date.now() + 3000;
    while ((!fs.existsSync(readyA) || !fs.existsSync(readyB)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(fs.existsSync(readyA) && fs.existsSync(readyB), true, `${fs.existsSync(readyA)} ${fs.existsSync(readyB)}`);
    fs.writeFileSync(startFile, "start");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fs.existsSync(backupRepository.MUTATION_LOCK_FILE), true);
    const results = await Promise.all([first, second]);
    const values = results.map((result) => JSON.parse(result.stdout.trim().split(/\r?\n/).pop()));
    assert.equal(values.filter((value) => value.winner).length, 1, results.map((result) => `${result.code}:${result.stderr}:${result.stdout}`).join(" | "));
    assert.equal(values.filter((value) => value.code === "BACKUP_METADATA_LOCK_BUSY").length, 1);
    assert.equal(fs.existsSync(backupRepository.MUTATION_LOCK_FILE), false);
  });

  await t.test("a stale releaser cannot remove a replacement owner", () => {
    reset();
    const first = backupRepository.acquireJsonMutationLock("first");
    writeLock(lockRecord({ token: "winner-token", operationName: "second" }));
    first.release();
    assert.equal(readLock().token, "winner-token");
    fs.rmSync(backupRepository.MUTATION_LOCK_FILE, { force: true });
  });

  await t.test("runtime-root mismatch fails closed", () => {
    reset();
    writeLock(lockRecord({ runtimeRootIdentity: path.join(runtime, "other-root") }));
    assert.throws(() => backupRepository.acquireJsonMutationLock(), (error) => error.code === "BACKUP_METADATA_LOCK_BUSY" && error.reason === "runtime-root-mismatch");
    fs.rmSync(backupRepository.MUTATION_LOCK_FILE, { force: true });
  });

  await t.test("atomic history remains valid after forced child termination and leaves no temp files", async () => {
    reset();
    const running = startChild(`
      for (let i = 0; i < 1000; i += 1) {
        repository.saveBackup({ id: String(i), filename: 'rootark-backup-2026-08-01-00-00-01.zip' });
      }
    `);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running.child.kill();
    await running.result;
    const historyPath = path.join(runtime, "data", "backup-history.json");
    if (fs.existsSync(historyPath)) assert.ok(Array.isArray(JSON.parse(fs.readFileSync(historyPath, "utf8"))));
    assert.equal(fs.readdirSync(path.join(runtime, "data")).some((name) => name.includes("backup-history.json.") && name.endsWith(".tmp")), false);
  });
});

test.after(() => {
  process.chdir(originalCwd);
  fs.rmSync(runtime, { recursive: true, force: true });
});
