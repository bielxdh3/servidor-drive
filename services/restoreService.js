const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const unzipper = require("unzipper");
const { closeDb, getDatabasePath, isDbEnabled } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");
const backupRepository = require("../repositories/backupRepository");
const backupService = require("./backupService");

const RESTORE_TMP_DIR = path.join(backupService.BACKUPS_DIR, ".restore-tmp");
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
      return { path: entryPath, area, folderId, name, state: "pending", attempts: 0, maxAttempts: 5, nextAttemptAt: null, failureCategory: null };
    })
    .filter(Boolean);
}

function createRestoreSync(manifest, clock) {
  const queuedAt = syncNow(clock);
  const entries = syncEntries(manifest);
  const state = entries.length ? "pending" : "completed";
  return {
    operationId: crypto.randomUUID(),
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

function saveRestoreSync(backup, restoreSync) {
  return backupRepository.saveBackup({ ...backup, metadata: { ...backup.metadata, restoreSync } });
}

function cancelRestoreSync(backupId, reason = "cancelled", { clock } = {}) {
  const backup = backupRepository.getBackup(backupId);
  const current = backup?.metadata?.restoreSync;
  if (!backup || !current || ["completed", "cancelled"].includes(current.state)) return backup;
  const at = syncNow(clock);
  return saveRestoreSync(backup, syncTransition(current, "cancelled", at, { cancellationReason: String(reason).slice(0, 120) }));
}

async function processRestoreSync({ backupId, clock, maxAttempts = 5, uploader } = {}) {
  const backup = backupRepository.getBackup(backupId);
  const provider = uploader || cloudStorage;
  const current = backup?.metadata?.restoreSync;
  if (!backup || !current || !provider?.enabled?.() || ["completed", "cancelled", "terminal_failure"].includes(current.state)) return backup;
  const now = typeof clock === "function" ? clock() : clock?.now ? clock.now() : Date.now();
  const entries = current.entries.map((entry) => ({ ...entry }));
  for (const entry of entries) {
    if (entry.state === "completed") continue;
    if (entry.nextAttemptAt && new Date(entry.nextAttemptAt).getTime() > now) continue;
    entry.attempts += 1;
    entry.maxAttempts = Math.max(1, Number(entry.maxAttempts || maxAttempts));
    entry.nextAttemptAt = null;
    const marked = { ...current, entries, lastAttemptAt: syncNow(clock) };
    saveRestoreSync(backup, marked);
    try {
      const localPath = resolveRuntimePath(entry.path);
      if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) throw Object.assign(new Error("restore source unavailable"), { code: "source_unavailable" });
      await provider.upload(localPath, entry.folderId, entry.name, entry.area);
      entry.state = "completed";
      entry.failureCategory = null;
    } catch (error) {
      entry.failureCategory = ["source_unavailable", "configuration"].includes(error.code) ? error.code : "provider_error";
      if (entry.attempts >= entry.maxAttempts) entry.state = "terminal_failure";
      else {
        entry.state = "retry_wait";
        entry.nextAttemptAt = new Date(now + Math.min(60 * 60 * 1000, 1000 * (2 ** (entry.attempts - 1)))).toISOString();
      }
    }
    const state = entries.some((item) => item.state === "terminal_failure") ? "terminal_failure" : entries.every((item) => item.state === "completed") ? "completed" : "pending";
    const at = syncNow(clock);
    const updated = syncTransition({ ...current, entries, lastAttemptAt: at }, state, at, { completedAt: state === "completed" ? at : null, failureCategory: state === "terminal_failure" ? entry.failureCategory : null });
    saveRestoreSync(backup, updated);
    if (state === "terminal_failure") break;
  }
  if (entries.length && entries.every((entry) => entry.state === "completed") && current.state !== "completed") {
    const at = syncNow(clock);
    saveRestoreSync(backup, syncTransition({ ...current, entries }, "completed", at, { completedAt: at }));
  }
  return backupRepository.getBackup(backupId) || backup;
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

function restoreDatabaseFiles(extractedRoot) {
  if (!isDbEnabled()) return false;
  const sourcePath = path.join(extractedRoot, "data", "rootark.sqlite");
  if (!fs.existsSync(sourcePath)) return false;

  const destinationPath = getDatabasePath();
  closeDb();
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${sourcePath}${suffix}`;
    const destination = `${destinationPath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, destination);
    else fs.rmSync(destination, { force: true });
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
};
