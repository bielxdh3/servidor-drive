const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const unzipper = require("unzipper");
const { closeDb, getDatabasePath, isDbEnabled } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");
const backupRepository = require("../repositories/backupRepository");
const backupService = require("./backupService");
const { attestCiphertextOnlyArchive } = require("../src/services/deploymentResilience");

const RESTORE_TMP_DIR = path.join(backupService.BACKUPS_DIR, ".restore-tmp");
const RESTORE_SYNC_LOCK_DIR = resolveRuntimePath("data", "restore-sync-locks");
const RESTORABLE_ROOTS = new Set(["data", "uploads"]);
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
let cloudStorage = null;

function setCloudStorage(storage) {
  cloudStorage = storage || null;
}

function syncNow(clock) {
  return new Date(typeof clock === "function" ? clock() : clock?.now ? clock.now() : Date.now()).toISOString();
}

function syncEntries(manifest) {
  return (manifest?.included_files || [])
    .map((entry) => String(entry.path || "").replace(/\\/g, "/"))
    .filter((entryPath) => entryPath.startsWith("uploads/") || entryPath.startsWith("temp/"))
    .map((entryPath) => {
      const [area, ...parts] = entryPath.split("/");
      const name = parts.pop();
      const folderId = parts.join("/") || "root";
      if (!name || !folderId || folderId.includes("/") || folderId === "." || folderId === ".." || /(^|\/)(\.env|.*credentials.*|.*\.key)$/i.test(name)) return null;
      return { entryId: crypto.randomUUID(), path: entryPath, area, folderId, name, providerIdentity: null, state: "pending", attempts: 0, maxAttempts: 5, nextAttemptAt: null, failureCategory: null, leaseToken: null, leaseUntil: null };
    })
    .filter(Boolean);
}

function createRestoreSync(manifest, clock) {
  const queuedAt = syncNow(clock);
  const entries = syncEntries(manifest);
  const state = entries.length ? "pending" : "completed";
  return {
    operationId: crypto.randomUUID(),
    revision: 0,
    state,
    queuedAt,
    lastAttemptAt: null,
    completedAt: state === "completed" ? queuedAt : null,
    failureCategory: null,
    entries,
    transitions: [{ state, at: queuedAt }],
  };
}

function syncTransition(sync, state, at, details = {}) {
  return { ...sync, ...details, state, transitions: [...(sync.transitions || []), { state, at }] };
}

function claimSyncEntry(backupId, entryId, { now, leaseMs = 60 * 1000, workerId = crypto.randomUUID(), providerIdentity } = {}) {
  const current = backupRepository.getBackup(backupId);
  const sync = current?.metadata?.restoreSync;
  const index = sync?.entries?.findIndex((entry) => entry.entryId === entryId);
  if (!current || !sync || index < 0) return null;
  const existing = sync.entries[index];
  const leaseUntil = new Date(existing.leaseUntil || 0).getTime();
  if (existing.state === "completed" || existing.state === "terminal_failure" || (existing.leaseToken && leaseUntil > now)) return null;
  const token = `${workerId}:${crypto.randomUUID()}`;
  try {
    const saved = backupRepository.mutateRestoreSyncEntry({
      backupId,
      operationId: sync.operationId,
      entryId,
      expectedState: ["pending", "retry_wait", "in_progress"],
      expectedLeaseToken: existing.leaseToken || null,
      expectedRevision: Number(sync.revision) || 0,
      mutate: (entry) => ({
        entry: {
          ...entry,
          state: "in_progress",
          attempts: (Number(entry.attempts) || 0) + 1,
          nextAttemptAt: null,
          leaseToken: token,
          leaseUntil: new Date(now + leaseMs).toISOString(),
          providerIdentity: providerIdentity || entry.providerIdentity || "cloud",
        },
        details: { lastAttemptAt: new Date(now).toISOString() },
        at: new Date(now).toISOString(),
      }),
    });
    const claimedEntry = saved.metadata.restoreSync.entries.find((entry) => entry.entryId === entryId);
    return { backup: saved, entry: claimedEntry, token };
  } catch (error) {
    if (["backup_revision_conflict", "backup_state_conflict", "backup_lease_conflict", "backup_mutation_conflict"].includes(error.code)) return null;
    throw error;
  }
}

function cancelRestoreSync(backupId, reason = "cancelled", { clock } = {}) {
  let backup = backupRepository.getBackup(backupId);
  const current = backup?.metadata?.restoreSync;
  if (!backup || !current || ["completed", "cancelled"].includes(current.state)) return backup;
  const at = syncNow(clock);
  for (const entry of current.entries || []) {
    if (entry.state === "cancelled" || entry.state === "completed") continue;
    try {
      backup = backupRepository.mutateRestoreSyncEntry({
        backupId,
        operationId: backup.metadata.restoreSync.operationId,
        entryId: entry.entryId,
        expectedState: entry.state,
        expectedLeaseToken: entry.leaseToken || null,
        expectedRevision: Number(backup.metadata.restoreSync.revision) || 0,
        mutate: (latestEntry) => ({
          entry: { ...latestEntry, state: "cancelled", leaseToken: null, leaseUntil: null, nextAttemptAt: null },
          details: { cancellationReason: String(reason).slice(0, 120) },
          at,
        }),
      });
    } catch (error) {
      if (!["backup_revision_conflict", "backup_state_conflict", "backup_lease_conflict", "backup_mutation_conflict"].includes(error.code)) throw error;
      backup = backupRepository.getBackup(backupId) || backup;
    }
  }
  return backupRepository.getBackup(backupId) || backup;
}

async function processRestoreSync({ backupId, clock, maxAttempts = 5, uploader, leaseMs = 60 * 1000, workerId } = {}) {
  const provider = uploader || cloudStorage;
  let latest = backupRepository.getBackup(backupId);
  if (!latest || !latest.metadata?.restoreSync || !provider?.enabled?.()) return latest;
  if (latest.metadata.restoreSync.entries?.length
    && latest.metadata.restoreSync.entries.every((entry) => entry.state === "completed")
    && latest.metadata.restoreSync.state !== "completed") {
    const entry = latest.metadata.restoreSync.entries[0];
    try {
      latest = backupRepository.mutateRestoreSyncEntry({
        backupId,
        operationId: latest.metadata.restoreSync.operationId,
        entryId: entry.entryId,
        expectedState: "completed",
        expectedLeaseToken: null,
        expectedRevision: Number(latest.metadata.restoreSync.revision) || 0,
        mutate: (latestEntry) => ({ entry: latestEntry, details: { failureCategory: null }, at: syncNow(clock) }),
      });
    } catch (error) {
      if (!["backup_revision_conflict", "backup_state_conflict", "backup_lease_conflict", "backup_mutation_conflict"].includes(error.code)) throw error;
      latest = backupRepository.getBackup(backupId) || latest;
    }
  }
  if (["completed", "cancelled", "terminal_failure"].includes(latest.metadata.restoreSync.state)) return latest;
  const now = typeof clock === "function" ? clock() : clock?.now ? clock.now() : Date.now();
  const providerIdentity = provider.provider || provider.name || "cloud";
  for (const candidate of latest.metadata.restoreSync.entries || []) {
    if (candidate.state === "completed" || candidate.state === "terminal_failure") continue;
    if (candidate.nextAttemptAt && new Date(candidate.nextAttemptAt).getTime() > now) continue;
    const lease = claimSyncEntry(backupId, candidate.entryId, { now, leaseMs, workerId, providerIdentity });
    if (!lease) continue;
    try {
      const localPath = resolveRuntimePath(lease.entry.path);
      if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) throw Object.assign(new Error("restore source unavailable"), { code: "source_unavailable" });
      await provider.upload(localPath, lease.entry.folderId, lease.entry.name, lease.entry.area);
      const current = backupRepository.getBackup(backupId);
      const entry = current?.metadata?.restoreSync?.entries?.find((value) => value.entryId === lease.entry.entryId);
      if (!entry || entry.leaseToken !== lease.token) continue;
      const at = syncNow(clock);
      backupRepository.mutateRestoreSyncEntry({
        backupId,
        operationId: current.metadata.restoreSync.operationId,
        entryId: lease.entry.entryId,
        expectedState: "in_progress",
        expectedLeaseToken: lease.token,
        expectedRevision: Number(current.metadata.restoreSync.revision) || 0,
        mutate: (latestEntry) => ({ entry: { ...latestEntry, state: "completed", failureCategory: null, nextAttemptAt: null, leaseToken: null, leaseUntil: null }, details: { failureCategory: null }, at }),
      });
    } catch (error) {
      if (error.code?.startsWith("backup_")) throw error;
      const current = backupRepository.getBackup(backupId);
      const entry = current?.metadata?.restoreSync?.entries?.find((value) => value.entryId === lease.entry.entryId && value.leaseToken === lease.token);
      if (!entry) continue;
      const attempts = Math.max(1, Number(entry.attempts) || 1);
      const failureCategory = ["source_unavailable", "configuration"].includes(error.code) ? error.code : "provider_error";
      const terminal = attempts >= Math.max(1, Number(entry.maxAttempts || maxAttempts));
      const at = syncNow(clock);
      const nextAttemptAt = terminal ? null : new Date(now + Math.min(60 * 60 * 1000, 1000 * (2 ** (attempts - 1)))).toISOString();
      try {
        backupRepository.mutateRestoreSyncEntry({
          backupId,
          operationId: current.metadata.restoreSync.operationId,
          entryId: lease.entry.entryId,
          expectedState: "in_progress",
          expectedLeaseToken: lease.token,
          expectedRevision: Number(current.metadata.restoreSync.revision) || 0,
          mutate: (latestEntry) => ({ entry: { ...latestEntry, state: terminal ? "terminal_failure" : "retry_wait", failureCategory, nextAttemptAt, leaseToken: null, leaseUntil: null }, details: { failureCategory: terminal ? failureCategory : null }, at }),
        });
      } catch (mutationError) {
        if (!["backup_revision_conflict", "backup_state_conflict", "backup_lease_conflict", "backup_mutation_conflict"].includes(mutationError.code)) throw mutationError;
      }
    }
    latest = backupRepository.getBackup(backupId) || latest;
  }
  return backupRepository.getBackup(backupId) || latest;
}

function isZipSymlink(entry) {
  if (entry.type === "SymbolicLink") return true;
  const madeByUnix = (Number(entry.versionMadeBy) >>> 8) === 3;
  const unixMode = Number(entry.externalFileAttributes) >>> 16;
  return madeByUnix && (unixMode & S_IFMT) === S_IFLNK;
}

function assertSafeZipPath(entryPath) {
  const archivePath = String(entryPath || "").replace(/\\/g, "/");
  if (!archivePath || archivePath.startsWith("/") || /^[a-zA-Z]:/.test(archivePath)) {
    throw new Error(`Caminho invalido no backup: ${entryPath}`);
  }
  const parts = archivePath.split("/");
  if (parts.includes("..")) throw new Error(`Path traversal bloqueado: ${entryPath}`);
  const normalized = path.posix.normalize(archivePath);
  if (parts[0] !== "backup-manifest.json" && !RESTORABLE_ROOTS.has(parts[0])) {
    throw new Error(`Entrada nao permitida no backup: ${entryPath}`);
  }
  if (normalized.includes("data/backups/") || normalized.endsWith("server-master.key") || normalized.endsWith(".env")) {
    throw new Error(`Entrada sensivel bloqueada no backup: ${entryPath}`);
  }
  return normalized;
}

async function readManifest(archivePath) {
  const zip = await unzipper.Open.file(archivePath);
  const manifestEntry = zip.files.find((entry) => entry.path === "backup-manifest.json");
  if (!manifestEntry) throw new Error("Manifest ausente no backup");
  const raw = await manifestEntry.buffer();
  const manifest = JSON.parse(raw.toString("utf-8"));
  return { zip, manifest };
}

async function validateBackupArchive(backup, archivePath) {
  if (backup.checksum) {
    const checksum = await backupService.calculateFileHash(archivePath);
    if (checksum !== backup.checksum) {
      throw new Error("Checksum do backup nao confere");
    }
  }

  const { zip, manifest } = await readManifest(archivePath);
  const destinations = new Set();
  for (const entry of zip.files) {
    if (isZipSymlink(entry)) throw new Error(`Symlink bloqueado no backup: ${entry.path}`);
    const safePath = assertSafeZipPath(entry.path);
    const destinationKey = safePath.replace(/\/+$/, "").toLowerCase();
    if (destinations.has(destinationKey)) throw new Error(`Entrada duplicada no backup: ${entry.path}`);
    destinations.add(destinationKey);
  }
  if (!manifest.backup_id) throw new Error("Manifest invalido");
  await attestCiphertextOnlyArchive(zip);
  return { zip, manifest };
}

async function extractArchive(zip, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of zip.files) {
    const safePath = assertSafeZipPath(entry.path);
    if (safePath === "backup-manifest.json") continue;
    if (entry.type === "Directory") continue;
    if (isZipSymlink(entry)) throw new Error(`Symlink bloqueado no backup: ${entry.path}`);

    const root = path.resolve(targetDir);
    const destination = path.resolve(root, safePath);
    const relative = path.relative(root, destination);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path traversal bloqueado: ${entry.path}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, await entry.buffer());
  }
}

function copyDirectoryContents(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(destinationPath, { recursive: true, force: true });
      copyDirectoryContents(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function restoreDataFiles(extractedRoot) {
  const extractedData = path.join(extractedRoot, "data");
  if (!fs.existsSync(extractedData)) return;

  closeDb();
  fs.mkdirSync(resolveRuntimePath("data"), { recursive: true });
  for (const name of fs.readdirSync(extractedData)) {
    if (name === "backups" || name === "server-master.key" || name.endsWith(".key") || name.startsWith("rootark.sqlite")) continue;
    const sourcePath = path.join(extractedData, name);
    const destinationPath = resolveRuntimePath("data", name);
    if (fs.statSync(sourcePath).isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function restoreUploads(extractedRoot) {
  const extractedUploads = path.join(extractedRoot, "uploads");
  if (!fs.existsSync(extractedUploads)) return;

  const destinationUploads = resolveRuntimePath("uploads");
  fs.rmSync(destinationUploads, { recursive: true, force: true });
  copyDirectoryContents(extractedUploads, destinationUploads);
}

function validateDatabase(pathname) {
  const database = new Database(pathname, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Integridade SQLite invalida");
    if (database.pragma("foreign_key_check", { simple: true }) !== undefined) throw new Error("Chaves estrangeiras SQLite invalidas");
  } finally {
    database.close();
  }
}

const SQLITE_SUFFIXES = ["", "-wal", "-shm"];
const RESTORE_JOURNAL_VERSION = 1;

function databaseJournalPath(destinationPath) {
  return `${destinationPath}.restore-journal.json`;
}

function artifactPath(prefix, suffix) {
  return `${prefix}${suffix}`;
}

function fileSha256(pathname) {
  if (!fs.existsSync(pathname)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(pathname)).digest("hex");
}

function fsyncFile(pathname) {
  const fd = fs.openSync(pathname, "r");
  try {
    try { fs.fsyncSync(fd); } catch (error) {
      if (!(["EPERM", "ENOTSUP", "EINVAL"].includes(error.code) && process.platform === "win32")) throw error;
    }
  } finally { fs.closeSync(fd); }
}

function fsyncDirectory(dirname) {
  if (process.platform === "win32") return;
  try {
    const fd = fs.openSync(dirname, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {}
}

function writeRestoreJournal(journal) {
  const pathname = journal.journalPath;
  const temporary = `${pathname}.${journal.transactionId}.tmp`;
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: "w" });
  fsyncFile(temporary);
  fs.renameSync(temporary, pathname);
  fsyncDirectory(path.dirname(pathname));
}

function readRestoreJournal(destinationPath) {
  const pathname = databaseJournalPath(destinationPath);
  if (!fs.existsSync(pathname)) return null;
  let journal;
  try {
    journal = JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch (error) {
    throw new Error(`Journal SQLite invalido; recuperacao interrompida: ${error.message}`);
  }
  const expectedDestination = path.resolve(destinationPath);
  if (journal.version !== RESTORE_JOURNAL_VERSION ||
      journal.destination !== expectedDestination ||
      !/^[a-f0-9-]{36}$/i.test(String(journal.transactionId || "")) ||
      !journal.stagePrefix || !journal.rollbackPrefix ||
      journal.journalPath !== pathname ||
      path.resolve(journal.stagePrefix) !== `${expectedDestination}.restore-stage-${journal.transactionId}` ||
      path.resolve(journal.rollbackPrefix) !== `${expectedDestination}.restore-rollback-${journal.transactionId}` ||
      !Array.isArray(journal.completedOperations)) {
    throw new Error("Journal SQLite ambiguo; recuperacao interrompida");
  }
  return journal;
}

function failureHook(options = {}) {
  const requested = options.failAfter ?? options.failureAfter ?? options.failAt ?? process.env.ROOTARK_SQLITE_FAIL_AFTER;
  let count = 0;
  return (name, journal) => {
    count += 1;
    if (typeof options.failureInjector === "function") options.failureInjector(name, { ...journal, step: name, stepNumber: count });
    if (requested !== undefined && (String(requested) === name || Number(requested) === count)) {
      const error = new Error(`Falha injetada no passo SQLite: ${name}`);
      error.code = "SQLITE_RESTORE_INJECTED_FAILURE";
      error.step = name;
      throw error;
    }
  };
}

function journalHas(journal, operation) {
  return journal.completedOperations.includes(operation);
}

function updateJournal(journal, phase) {
  journal.phase = phase;
  journal.updatedAt = new Date().toISOString();
  writeRestoreJournal(journal);
}

function recordOperation(journal, operation) {
  if (!journalHas(journal, operation)) journal.completedOperations.push(operation);
  journal.updatedAt = new Date().toISOString();
  writeRestoreJournal(journal);
}

function validateJournalArtifacts(journal) {
  const expected = new Set(SQLITE_SUFFIXES);
  for (const suffix of Object.keys(journal.originalPresent || {})) {
    if (!expected.has(suffix)) throw new Error("Journal SQLite contem sidecar desconhecido");
  }
  for (const suffix of SQLITE_SUFFIXES) {
    if (typeof journal.originalPresent?.[suffix] !== "boolean" || typeof journal.stagedPresent?.[suffix] !== "boolean") {
      throw new Error("Journal SQLite incompleto; recuperacao interrompida");
    }
  }
}

function rollbackRestoreJournal(journal, options = {}) {
  validateJournalArtifacts(journal);
  const hook = failureHook(options);
  updateJournal(journal, "rolling_back");

  for (const suffix of SQLITE_SUFFIXES) {
    const destination = artifactPath(journal.destination, suffix);
    const rollback = artifactPath(journal.rollbackPrefix, suffix);
    const stage = artifactPath(journal.stagePrefix, suffix);
    const originalMove = `original.move${suffix || ".primary"}`;
    const replacementMove = `replacement.move${suffix || ".primary"}`;
    const rollbackMove = `rollback.restore${suffix || ".primary"}`;

    if (journal.originalPresent[suffix]) {
      if (fs.existsSync(rollback)) {
        if (fs.existsSync(destination)) {
          fs.rmSync(destination, { force: true });
          recordOperation(journal, `rollback.remove-replacement${suffix || ".primary"}`);
          hook(`rollback.remove-replacement${suffix || ".primary"}`, journal);
        }
        fs.renameSync(rollback, destination);
        recordOperation(journal, rollbackMove);
        hook(rollbackMove, journal);
      } else if (!journalHas(journal, originalMove) && !journalHas(journal, rollbackMove)) {
        // The original was not moved. Leave it untouched.
      } else if (!fs.existsSync(destination)) {
        throw new Error(`Journal SQLite perdeu o original ${suffix || "principal"}`);
      }
    } else if (fs.existsSync(destination) && (journalHas(journal, replacementMove) || journal.phase !== "staged")) {
      fs.rmSync(destination, { force: true });
      recordOperation(journal, `rollback.remove-new${suffix || ".primary"}`);
      hook(`rollback.remove-new${suffix || ".primary"}`, journal);
    }
    fs.rmSync(stage, { force: true });
  }

  updateJournal(journal, "rolled_back");
  fs.rmSync(journal.journalPath, { force: true });
  fsyncDirectory(path.dirname(journal.journalPath));
}

function recoverDatabaseRestore(destinationPath, options = {}) {
  const resolvedDestination = path.resolve(destinationPath);
  const journal = readRestoreJournal(resolvedDestination);
  if (!journal) return { recovered: false, reason: "no_journal" };

  if (!["staged", "validated", "originals_moving", "originals_preserved", "replacement_moving", "replacement_installed", "reopened_verified", "rolling_back", "rolled_back", "committed"].includes(journal.phase)) {
    throw new Error("Journal SQLite contem fase desconhecida; recuperacao interrompida");
  }

  if (journal.phase === "committed") {
    validateJournalArtifacts(journal);
    for (const suffix of SQLITE_SUFFIXES) {
      fs.rmSync(artifactPath(journal.stagePrefix, suffix), { force: true });
      fs.rmSync(artifactPath(journal.rollbackPrefix, suffix), { force: true });
    }
    fs.rmSync(journal.journalPath, { force: true });
    fsyncDirectory(path.dirname(journal.journalPath));
    return { recovered: true, phase: "committed" };
  }

  rollbackRestoreJournal(journal, options);
  return { recovered: true, phase: "rolled_back" };
}

function recoverDatabaseRollback(destinationPath) {
  const journalResult = recoverDatabaseRestore(destinationPath);
  if (journalResult.recovered) return journalResult;
  if (fs.existsSync(destinationPath)) return { recovered: false, reason: "destination_exists" };
  const prefix = `${path.basename(destinationPath)}.restore-rollback-`;
  const candidates = fs.readdirSync(path.dirname(destinationPath)).filter((name) => name.startsWith(prefix) && !name.endsWith("-wal") && !name.endsWith("-shm"));
  if (candidates.length > 1) throw new Error("Rollbacks SQLite ambiguos; recuperacao interrompida");
  if (!candidates.length) return { recovered: false, reason: "no_rollback" };
  const rollbackPath = path.join(path.dirname(destinationPath), candidates[0]);
  fs.renameSync(rollbackPath, destinationPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${rollbackPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.renameSync(sidecar, `${destinationPath}${suffix}`);
  }
  return { recovered: true, phase: "legacy_rollback" };
}

function restoreDatabaseFiles(extractedRoot, options = {}) {
  if (!isDbEnabled()) return false;
  const sourcePath = path.join(extractedRoot, "data", "rootark.sqlite");
  if (!fs.existsSync(sourcePath)) return false;

  const destinationPath = getDatabasePath();
  closeDb();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  recoverDatabaseRollback(destinationPath);
  const token = crypto.randomUUID();
  const stagePath = `${destinationPath}.restore-stage-${token}`;
  const rollbackPath = `${destinationPath}.restore-rollback-${token}`;
  const journal = {
    version: RESTORE_JOURNAL_VERSION,
    transactionId: token,
    destination: path.resolve(destinationPath),
    journalPath: databaseJournalPath(destinationPath),
    stagePrefix: stagePath,
    rollbackPrefix: rollbackPath,
    phase: "staged",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedOperations: [],
    originalPresent: Object.fromEntries(SQLITE_SUFFIXES.map((suffix) => [suffix, fs.existsSync(artifactPath(destinationPath, suffix))])),
    stagedPresent: Object.fromEntries(SQLITE_SUFFIXES.map((suffix) => [suffix, fs.existsSync(artifactPath(sourcePath, suffix))])),
    originalSha256: Object.fromEntries(SQLITE_SUFFIXES.map((suffix) => [suffix, fileSha256(artifactPath(destinationPath, suffix))])),
  };
  validateJournalArtifacts(journal);
  writeRestoreJournal(journal);
  const hook = failureHook(options);

  try {
  for (const suffix of SQLITE_SUFFIXES) {
    const source = artifactPath(sourcePath, suffix);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, artifactPath(stagePath, suffix));
      fsyncFile(artifactPath(stagePath, suffix));
      recordOperation(journal, `stage.copy${suffix || ".primary"}`);
      hook(`stage.copy${suffix || ".primary"}`, journal);
    }
  }
    validateDatabase(stagePath);
    recordOperation(journal, "stage.validate");
    hook("stage.validate", journal);
    updateJournal(journal, "staged");

    updateJournal(journal, "originals_moving");
    for (const suffix of SQLITE_SUFFIXES) {
      const destination = artifactPath(destinationPath, suffix);
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, artifactPath(rollbackPath, suffix));
        recordOperation(journal, `original.move${suffix || ".primary"}`);
        hook(`original.move${suffix || ".primary"}`, journal);
      }
    }
    updateJournal(journal, "originals_preserved");
    updateJournal(journal, "replacement_moving");
    for (const suffix of SQLITE_SUFFIXES) {
      const staged = artifactPath(stagePath, suffix);
      if (fs.existsSync(staged)) {
        fs.renameSync(staged, artifactPath(destinationPath, suffix));
        recordOperation(journal, `replacement.move${suffix || ".primary"}`);
        hook(`replacement.move${suffix || ".primary"}`, journal);
      }
    }
    updateJournal(journal, "replacement_installed");
    validateDatabase(destinationPath);
    recordOperation(journal, "replacement.reopen-validate");
    hook("replacement.reopen-validate", journal);
    updateJournal(journal, "reopened_verified");
    updateJournal(journal, "committed");
    for (const suffix of SQLITE_SUFFIXES) {
      fs.rmSync(artifactPath(rollbackPath, suffix), { force: true });
      fs.rmSync(artifactPath(stagePath, suffix), { force: true });
    }
    fs.rmSync(journal.journalPath, { force: true });
    fsyncDirectory(path.dirname(destinationPath));
  } catch (error) {
    if (!options.simulateCrash && !options.leaveJournalOnFailure) {
      try { recoverDatabaseRestore(destinationPath); } catch (recoveryError) { error.recoveryError = recoveryError; }
    }
    throw error;
  }
  return true;
}

async function restoreBackup(id, options = {}) {
  if (String(options.confirmation || "") !== "RESTORE") {
    throw new Error("Confirmacao invalida. Digite RESTORE para restaurar.");
  }

  const preRestore = await backupService.createBackup({
    type: "pre-restore",
    createdBy: options.username || null,
    notes: `Backup automatico antes de restaurar ${id}`,
  });

  const release = backupService.acquireLock("restore");
  const restoreDir = path.join(RESTORE_TMP_DIR, String(id));
  try {
    const { backup, archivePath } = backupService.getBackupOrThrow(id);
    const { zip, manifest } = await validateBackupArchive(backup, archivePath);
    await extractArchive(zip, restoreDir);
    restoreDataFiles(restoreDir);
    restoreUploads(restoreDir);
    const restoredDatabase = restoreDatabaseFiles(restoreDir);
    const cloudSync = cloudStorage?.enabled() && manifest.cloud_complete
      ? createRestoreSync(manifest)
      : { state: "not_required" };
    if (cloudSync.state === "pending") {
      backupRepository.saveBackup({ ...backup, metadata: { ...backup.metadata, restoreSync: cloudSync } });
    }
    return {
      backup,
      manifest,
      preRestore,
      restartRecommended: restoredDatabase,
      cloudSync,
    };
  } finally {
    fs.rmSync(restoreDir, { recursive: true, force: true });
    fs.rmSync(RESTORE_TMP_DIR, { recursive: true, force: true });
    release();
  }
}

async function getBackupManifest(id) {
  const { backup, archivePath } = backupService.getBackupOrThrow(id);
  const { manifest } = await validateBackupArchive(backup, archivePath);
  return manifest;
}

module.exports = {
  cancelRestoreSync,
  createRestoreSync,
  getBackupManifest,
  processRestoreSync,
  restoreBackup,
  setCloudStorage,
  validateBackupArchive,
  validateDatabase,
  recoverDatabaseRollback,
  recoverDatabaseRestore,
  restoreDatabaseFiles,
  databaseJournalPath,
  SQLITE_SUFFIXES,
};
