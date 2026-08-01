const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ZipArchive } = require("archiver");
const backupRepository = require("../repositories/backupRepository");
const { getDatabasePath, isDbEnabled } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");

const BACKUPS_DIR = resolveRuntimePath("data", "backups");
const LOCK_FILE = path.join(BACKUPS_DIR, ".backup.lock");
let operationLock = null;
let cloudStorage = null;

function setCloudStorage(storage) {
  cloudStorage = storage || null;
}
const RETENTION_TOMBSTONE_SUFFIX = ".retention-tombstone";

function envBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function timestampForName() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeEntryPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function collisionKey(value) {
  return normalizeEntryPath(value).toLowerCase();
}

function isSensitivePath(relativePath) {
  const normalized = normalizeEntryPath(relativePath);
  const base = path.basename(normalized).toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith(".git/") || normalized === ".git") return true;
  if (normalized.startsWith("node_modules/") || normalized === "node_modules") return true;
  if (normalized.startsWith("data/backups/") || normalized === "data/backups") return true;
  if (normalized.startsWith("temp/.chunks/") || normalized.startsWith("temp/.incoming/")) return true;
  if (base === ".env" || base.endsWith(".env")) return true;
  if (base.includes("credentials") || base.includes("service-account")) return true;
  if (base.endsWith(".key") || base.endsWith(".pem") || base.endsWith(".p12")) return true;
  if (base === "server-master.key") return true;
  return false;
}

function collectFilesRecursive(rootPath, entryPrefix, options = {}) {
  if (!fs.existsSync(rootPath)) return [];
  const files = [];
  const stack = [{ absolutePath: rootPath, entryPath: entryPrefix }];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current.absolutePath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current.absolutePath)) {
        const absolutePath = path.join(current.absolutePath, name);
        const entryPath = normalizeEntryPath(path.posix.join(current.entryPath, name));
        if (isSensitivePath(entryPath)) continue;
        stack.push({ absolutePath, entryPath });
      }
      continue;
    }
    if (!stat.isFile()) continue;
    if (options.maxBytes && stat.size > options.maxBytes) continue;
    files.push({ absolutePath: current.absolutePath, entryPath: normalizeEntryPath(current.entryPath), size: stat.size });
  }
  return files;
}

async function collectBackupFiles(options = {}) {
  const files = [];
  const dataDir = resolveRuntimePath("data");
  const includeUploads = envBool("BACKUP_INCLUDE_UPLOADS", true);
  const includeTemp = envBool("BACKUP_INCLUDE_TEMP", false);
  const includePending = envBool("BACKUP_INCLUDE_PENDING", false);

  for (const name of fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []) {
    const absolutePath = path.join(dataDir, name);
    const entryPath = normalizeEntryPath(path.posix.join("data", name));
    if (isSensitivePath(entryPath)) continue;
    const stat = fs.statSync(absolutePath);
    if (stat.isFile() && (
      name.endsWith(".json") ||
      name === "README.md"
    )) {
      files.push({ absolutePath, entryPath, size: stat.size });
    }
  }

  if (isDbEnabled()) {
    const databasePath = getDatabasePath();
    for (const suffix of ["", "-wal", "-shm"]) {
      const absolutePath = `${databasePath}${suffix}`;
      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        files.push({ absolutePath, entryPath: `data/rootark.sqlite${suffix}`, size: fs.statSync(absolutePath).size });
      }
    }
  }

  if (includeUploads) {
    files.push(...collectFilesRecursive(resolveRuntimePath("uploads"), "uploads"));
  }

  if (includeTemp || includePending) {
    files.push(...collectFilesRecursive(resolveRuntimePath("temp"), "temp"));
  }

  if (!cloudStorage?.enabled()) return files.sort((a, b) => a.entryPath.localeCompare(b.entryPath));

  const stageDir = options.stageDir;
  if (!stageDir) throw new Error("Cloud backup staging is required");
  const known = new Map();
  const collisions = new Map();
  for (const file of files) {
    const key = collisionKey(file.entryPath);
    if (collisions.has(key) && collisions.get(key) !== file.entryPath) throw new Error("Backup entry collision");
    collisions.set(key, file.entryPath);
    known.set(file.entryPath, file);
  }
  const areas = ["uploads", ...(includeTemp || includePending ? ["temp"] : [])];
  const remoteIdentities = new Set();
  if (typeof cloudStorage.inventory !== "function") throw new Error("Authoritative cloud inventory is required");
  const remotes = await cloudStorage.inventory();
  for (const remote of remotes) {
    if (!areas.includes(remote.area)) continue;
    const folderId = String(remote.folderId || "");
    const name = String(remote.name || "");
    const identity = `${remote.provider || "cloud"}:${remote.providerIdentity || remote.id || remote.key || `${remote.area}/${folderId}/${name}`}`;
    if (remoteIdentities.has(identity)) throw new Error("Cloud backup inventory contains a duplicate provider identity");
    remoteIdentities.add(identity);
    if (!folderId || folderId === "." || folderId === ".." || /[\\\\/]/.test(folderId)) throw new Error("Cloud backup inventory contains an unsafe folder");
    if (!name || name !== path.basename(name) || /[\\/]/.test(name) || isSensitivePath(`${remote.area}/${folderId}/${name}`)) throw new Error("Cloud backup inventory contains an unsafe path");
    const entryPath = normalizeEntryPath(path.posix.join(remote.area, folderId === "root" ? "" : folderId, name));
    const key = collisionKey(entryPath);
    if (collisions.has(key) && collisions.get(key) !== entryPath) throw new Error("Backup entry collision");
    collisions.set(key, entryPath);
    const staged = path.resolve(stageDir, entryPath);
    if (!staged.startsWith(`${path.resolve(stageDir)}${path.sep}`)) throw new Error("Cloud backup staging escaped its boundary");
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    if (!await cloudStorage.download(folderId, name, staged, remote.area)) throw new Error("Cloud backup object is unavailable");
    const local = known.get(entryPath);
    if (local) {
      if (await calculateFileHash(local.absolutePath) !== await calculateFileHash(staged)) throw new Error("Cloud and local backup objects differ");
      fs.rmSync(staged, { force: true });
    } else {
      known.set(entryPath, { absolutePath: staged, entryPath, size: fs.statSync(staged).size, cloudOnly: true });
    }
  }
  options.cloudComplete = true;
  return [...known.values()].sort((a, b) => a.entryPath.localeCompare(b.entryPath));
}

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function lockRecord(operation, token) {
  return {
    token,
    operation,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    runtimeRoot: path.resolve(resolveRuntimePath(".")),
  };
}

function writeLock(operation) {
  const token = crypto.randomUUID();
  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(fd, JSON.stringify(lockRecord(operation, token)), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return token;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
    }
    throw error;
  }
}

function isStaleLock() {
  const staleMs = Math.max(60_000, envNumber("BACKUP_LOCK_STALE_MS", 6 * 60 * 60 * 1000));
  let stat;
  try { stat = fs.statSync(LOCK_FILE); } catch { return false; }
  const age = Date.now() - stat.mtimeMs;
  if (age < staleMs) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    if (Number.isInteger(lock.pid) && lock.pid > 0) {
      try { process.kill(lock.pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
    }
  } catch {
    return true;
  }
  return true;
}

function acquireLock(operation) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (operationLock) {
    const error = new Error(`Operacao de ${operationLock.operation} em andamento`);
    error.code = "BACKUP_LOCKED";
    throw error;
  }
  let token;
  try {
    token = writeLock(operation);
  } catch (error) {
    if (error.code !== "EEXIST") {
      const failed = new Error("Falha ao gravar lock de backup");
      failed.code = "BACKUP_LOCK_WRITE_FAILED";
      throw failed;
    }
    if (!isStaleLock()) {
      const locked = new Error("Outra operacao de backup/restauracao esta em andamento");
      locked.code = "BACKUP_LOCKED";
      throw locked;
    }
    try { fs.rmSync(LOCK_FILE, { force: false }); } catch {
      const locked = new Error("Nao foi possivel reivindicar o lock de backup");
      locked.code = "BACKUP_LOCKED";
      throw locked;
    }
    try { token = writeLock(operation); } catch {
      const locked = new Error("Nao foi possivel gravar o lock de backup");
      locked.code = "BACKUP_LOCK_WRITE_FAILED";
      throw locked;
    }
  }
  operationLock = { operation, token };
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (operationLock?.token === token) operationLock = null;
    try {
      const current = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (current.token === token) fs.rmSync(LOCK_FILE, { force: false });
    } catch {
      // The lock is already gone or malformed; never delete another operation's lock.
    }
  };
}

async function createZipArchive(archivePath, manifest, files) {
  const closeTimeoutMs = Math.max(50, Math.min(5000, envNumber("BACKUP_OUTPUT_CLOSE_TIMEOUT_MS", 1000)));
  const cleanupRetries = 2;
  const cleanupDelayMs = 25;
  await new Promise((resolve, reject) => {
    let settled = false;
    let owned = false;
    let outputClosed = false;
    let finalized = false;
    let archive;
    let output;
    let fd;

    const closeOutput = () => {
      if (!output || outputClosed || output.destroyed) return;
      try { output.destroy(); } catch {}
    };

    const waitForOutputClose = () => {
      if (!output || outputClosed || output.closed) return Promise.resolve();
      return new Promise((done) => {
        let timer;
        const finishWait = () => {
          if (timer) clearTimeout(timer);
          output.removeListener("close", finishWait);
          done();
        };
        timer = setTimeout(finishWait, closeTimeoutMs);
        output.once("close", finishWait);
      });
    };

    const removeOwnedArchive = async () => {
      if (!owned) return;
      let lastError;
      for (let attempt = 0; attempt <= cleanupRetries; attempt += 1) {
        try {
          fs.rmSync(archivePath, { force: false });
          return;
        } catch (error) {
          if (error.code === "ENOENT") return;
          lastError = error;
          if (attempt < cleanupRetries) await new Promise((done) => setTimeout(done, cleanupDelayMs));
        }
      }
      throw lastError;
    };

    const stopArchive = () => {
      try {
        if (archive && typeof archive.abort === "function") archive.abort();
        else if (archive && typeof archive.destroy === "function") archive.destroy();
      } catch {}
      closeOutput();
    };

    const finish = async (error) => {
      if (settled) return;
      if (error) {
        settled = true;
        stopArchive();
        await waitForOutputClose();
        try { await removeOwnedArchive(); } catch (cleanupError) { error.cleanupError = cleanupError; }
        reject(error);
        return;
      }
      if (!finalized || !outputClosed) return;
      settled = true;
      resolve();
    };

    const onArchiveError = (error) => { void finish(error); };
    const onOutputError = (error) => { void finish(error); };

    try {
      fd = fs.openSync(archivePath, "wx");
      owned = true;
      output = fs.createWriteStream(archivePath, { fd, autoClose: true });
      archive = new ZipArchive({ zlib: { level: 9 } });
      output.on("close", () => { outputClosed = true; void finish(); });
      output.on("error", onOutputError);
      archive.on("error", onArchiveError);
      archive.pipe(output);
      archive.append(JSON.stringify(manifest, null, 2), { name: "backup-manifest.json" });
      for (const file of files) archive.file(file.absolutePath, { name: file.entryPath });
      Promise.resolve(archive.finalize()).then(() => { finalized = true; void finish(); }, onArchiveError);
    } catch (error) {
      if (fd !== undefined && !output) { try { fs.closeSync(fd); } catch {} }
      void finish(error);
    }
  });
}

function getArchivePath(filename) {
  const safeName = path.basename(filename || "");
  if (!/^rootark-(backup|pre-restore)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d{3}-[a-f0-9]{8})?\.zip$/.test(safeName)) {
    return null;
  }
  const archivePath = path.resolve(BACKUPS_DIR, safeName);
  const root = path.resolve(BACKUPS_DIR);
  return archivePath === root || archivePath.startsWith(`${root}${path.sep}`) ? archivePath : null;
}

function retentionTombstone(archivePath) {
  const root = path.resolve(BACKUPS_DIR);
  const target = path.resolve(`${archivePath}${RETENTION_TOMBSTONE_SUFFIX}`);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Retention tombstone escaped backup root");
  return target;
}

function retentionTombstoneMetadata(tombstone) {
  const root = path.resolve(BACKUPS_DIR);
  const metadata = path.resolve(`${tombstone}.json`);
  if (!metadata.startsWith(`${root}${path.sep}`)) throw new Error("Retention metadata escaped backup root");
  return metadata;
}

function writeRetentionMetadata(tombstone, backup) {
  const metadataPath = retentionTombstoneMetadata(tombstone);
  const temporary = `${metadataPath}.${crypto.randomUUID()}.tmp`;
  const value = JSON.stringify({ backupId: backup.id, filename: backup.filename, checksum: backup.checksum || null });
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, metadataPath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return metadataPath;
}

function recoverRetentionTombstones() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const names = fs.readdirSync(BACKUPS_DIR);
  const tombstoneNames = names.filter((name) => name.endsWith(RETENTION_TOMBSTONE_SUFFIX));
  for (const name of names.filter((value) => value.endsWith(`${RETENTION_TOMBSTONE_SUFFIX}.json`))) {
    const tombstone = name.slice(0, -5);
    if (!tombstoneNames.includes(tombstone)) throw new Error("Retention metadata without tombstone");
  }
  const claims = new Map();
  const records = [];
  for (const name of tombstoneNames) {
    const original = getArchivePath(name.slice(0, -RETENTION_TOMBSTONE_SUFFIX.length));
    const tombstone = path.resolve(BACKUPS_DIR, name);
    if (!original || !tombstone.startsWith(`${path.resolve(BACKUPS_DIR)}${path.sep}`)) throw new Error("Invalid retention tombstone path");
    const metadataPath = retentionTombstoneMetadata(tombstone);
    let metadata;
    try { metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")); } catch { throw new Error("Malformed retention tombstone metadata"); }
    if (metadata.filename !== path.basename(original) || !metadata.backupId) throw new Error("Retention tombstone identity mismatch");
    for (const claim of [String(metadata.backupId), `filename:${metadata.filename}`]) {
      if (claims.has(claim)) throw new Error("Multiple retention tombstones claim one backup");
      claims.set(claim, name);
    }
    records.push({ name, original, tombstone, metadata, metadataPath });
  }
  const history = backupRepository.listBackups();
  for (const { original, tombstone, metadata, metadataPath } of records) {
    const matches = history.filter((backup) => backup.id === metadata.backupId || backup.filename === metadata.filename);
    if (matches.length > 1) throw new Error("Ambiguous retention tombstone history");
    if (fs.existsSync(original)) {
      if (matches.length === 0 || (matches[0].checksum && matches[0].checksum !== metadata.checksum) || (metadata.checksum && matches[0].checksum !== metadata.checksum)) throw new Error("Conflicting retention archive evidence");
      if (fs.readFileSync(original).equals(fs.readFileSync(tombstone))) {
        fs.rmSync(tombstone, { force: false });
        fs.rmSync(metadataPath, { force: false });
      } else throw new Error("Conflicting retention archive bytes");
    } else if (matches.length === 1) {
      if (metadata.checksum !== null && metadata.checksum !== undefined && matches[0].checksum !== metadata.checksum) throw new Error("Retention checksum mismatch");
      if (matches[0].checksum && !metadata.checksum) throw new Error("Retention checksum evidence missing");
      fs.renameSync(tombstone, original);
      fs.rmSync(metadataPath, { force: false });
    } else {
      fs.rmSync(tombstone, { force: false });
      fs.rmSync(metadataPath, { force: false });
    }
  }
}

async function cleanupRetention() {
  const count = Math.max(0, Math.floor(envNumber("BACKUP_RETENTION_COUNT", 10)));
  const days = Math.max(0, Math.floor(envNumber("BACKUP_RETENTION_DAYS", 30)));
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  recoverRetentionTombstones();
  const backups = backupRepository.listBackups()
    .filter((item) => item.status === "success" && item.type !== "pre-restore")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b.id).localeCompare(String(a.id)));

  const toDelete = backups.filter((item, index) => (count > 0 && index >= count) || (cutoff && new Date(item.createdAt).getTime() < cutoff));
  for (const backup of toDelete) {
    const archivePath = getArchivePath(backup.filename);
    if (!archivePath || !fs.existsSync(archivePath)) continue;
    const tombstone = retentionTombstone(archivePath);
    const metadataPath = retentionTombstoneMetadata(tombstone);
    fs.renameSync(archivePath, tombstone);
    let repositoryDeleted = false;
    try {
      writeRetentionMetadata(tombstone, backup);
      backupRepository.deleteBackup(backup.id);
      repositoryDeleted = true;
    } catch (error) {
      try { fs.renameSync(tombstone, archivePath); } catch {}
      fs.rmSync(metadataPath, { force: true });
      throw error;
    } finally {
      if (repositoryDeleted) {
        try { fs.rmSync(tombstone, { force: false }); } catch {}
        try { fs.rmSync(metadataPath, { force: false }); } catch {}
      }
    }
  }
}

async function createBackup(options = {}) {
  if (!envBool("BACKUP_ENABLED", true)) {
    throw new Error("Backups desativados por BACKUP_ENABLED=false");
  }

  const release = acquireLock("backup");
  const startedAt = Date.now();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const backupType = options.type || "manual";
  const filenameBase = `rootark-${backupType === "pre-restore" ? "pre-restore" : "backup"}-${timestampForName()}`;
  const maxArchiveAttempts = Math.max(1, Math.min(20, Math.floor(envNumber("BACKUP_ARCHIVE_COLLISION_RETRIES", 5))));
  let filename = `${filenameBase}.zip`;
  let archivePath = path.join(BACKUPS_DIR, filename);
  let archiveCreated = false;
  const stageDir = path.join(BACKUPS_DIR, ".cloud-stage", id);
  const baseEntry = {
    id,
    filename,
    type: backupType,
    status: "failed",
    createdBy: options.createdBy || null,
    createdAt,
    finishedAt: null,
    sizeBytes: 0,
    checksum: null,
    errorMessage: null,
    metadata: { notes: options.notes || "" },
  };

  try {
    const collectionOptions = { stageDir };
    const files = await collectBackupFiles(collectionOptions);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const manifest = {
      backup_id: id,
      created_at: createdAt,
      type: backupType,
      created_by: options.createdBy || null,
      total_size: totalSize,
      included_files: files.map((file) => ({ path: file.entryPath, size: file.size })),
      archive_sha256: null,
      app_version: process.env.npm_package_version || "1.0.0",
      status: "success",
      error_message: null,
      duration_ms: null,
      notes: options.notes || "",
      cloud_complete: Boolean(collectionOptions.cloudComplete),
    };

    let created = false;
    for (let attempt = 0; attempt < maxArchiveAttempts; attempt += 1) {
      filename = attempt === 0 ? `${filenameBase}.zip` : `${filenameBase}-${String(attempt).padStart(3, "0")}.zip`;
      archivePath = path.join(BACKUPS_DIR, filename);
      try {
        await createZipArchive(archivePath, manifest, files);
        created = true;
        archiveCreated = true;
        break;
      } catch (error) {
        if (error.code !== "EEXIST" || attempt === maxArchiveAttempts - 1) {
          if (error.code === "EEXIST") error.code = "BACKUP_ARCHIVE_COLLISION_LIMIT";
          throw error;
        }
      }
    }
    if (!created) throw new Error("Backup archive was not created");
    baseEntry.filename = filename;
    const checksum = await calculateFileHash(archivePath);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    const sizeBytes = fs.statSync(archivePath).size;

    const saved = backupRepository.saveBackup({
      ...baseEntry,
      status: "success",
      finishedAt,
      sizeBytes,
      checksum,
      metadata: {
        ...baseEntry.metadata,
        manifest: { ...manifest, duration_ms: durationMs },
        includedFiles: files.length,
        cloudComplete: Boolean(collectionOptions.cloudComplete),
      },
    });

    await cleanupRetention();
    return saved;
  } catch (error) {
    let cleanupError = null;
    if (archiveCreated) {
      try { fs.rmSync(archivePath, { force: false }); } catch (cleanupFailure) { cleanupError = cleanupFailure; }
    }
    let failed;
    try {
      failed = backupRepository.saveBackup({
        ...baseEntry,
        finishedAt: new Date().toISOString(),
        errorMessage: error.message,
        metadata: { ...baseEntry.metadata, durationMs: Date.now() - startedAt },
      });
    } catch (historyError) {
      historyError.archiveCleanupError = cleanupError;
      throw historyError;
    }
    if (cleanupError) error.archiveCleanupError = cleanupError;
    throw Object.assign(error, { backup: failed });
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
    try { fs.rmdirSync(path.dirname(stageDir)); } catch {}
    release();
  }
}

function listBackups() {
  return backupRepository.listBackups().map((backup) => ({
    ...backup,
    exists: Boolean(getArchivePath(backup.filename) && fs.existsSync(getArchivePath(backup.filename))),
  }));
}

function getBackupOrThrow(id) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id || ""))) throw new Error("Backup invalido");
  const backup = backupRepository.getBackup(id);
  if (!backup) throw new Error("Backup nao encontrado");
  const archivePath = getArchivePath(backup.filename);
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error("Arquivo de backup nao encontrado");
  return { backup, archivePath };
}

function deleteBackup(id) {
  const release = acquireLock("delete");
  try {
    const { backup, archivePath } = getBackupOrThrow(id);
    fs.rmSync(archivePath, { force: true });
    backupRepository.deleteBackup(backup.id);
    return backup;
  } finally {
    release();
  }
}

function latestStatus() {
  return backupRepository.latestStatus();
}

module.exports = {
  BACKUPS_DIR,
  LOCK_FILE,
  acquireLock,
  calculateFileHash,
  cleanupRetention,
  createBackup,
  createZipArchive,
  deleteBackup,
  getArchivePath,
  getBackupOrThrow,
  latestStatus,
  listBackups,
  setCloudStorage,
  recoverRetentionTombstones,
};
