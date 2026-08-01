const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");
const backupRepository = require("../repositories/backupRepository");
const { getDatabasePath, isDbEnabled } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");

const BACKUPS_DIR = resolveRuntimePath("data", "backups");
const LOCK_FILE = path.join(BACKUPS_DIR, ".backup.lock");
let operationLock = null;

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function normalizeEntryPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
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

function collectBackupFiles() {
  const files = [];
  const dataDir = resolveRuntimePath("data");
  const includeUploads = envBool("BACKUP_INCLUDE_UPLOADS", true);
  const includeTemp = envBool("BACKUP_INCLUDE_TEMP", false);

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

  if (includeTemp) {
    files.push(...collectFilesRecursive(resolveRuntimePath("temp"), "temp"));
  }

  return files.sort((a, b) => a.entryPath.localeCompare(b.entryPath));
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

function acquireLock(operation) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (operationLock) {
    const error = new Error(`Operacao de ${operationLock} em andamento`);
    error.code = "BACKUP_LOCKED";
    throw error;
  }

  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(fd, JSON.stringify({ operation, pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    const locked = new Error("Outra operacao de backup/restauracao esta em andamento");
    locked.code = "BACKUP_LOCKED";
    throw locked;
  }

  operationLock = operation;
  return () => {
    operationLock = null;
    try {
      if (fd) fs.closeSync(fd);
    } catch {}
    fs.rmSync(LOCK_FILE, { force: true });
  };
}

async function createZipArchive(archivePath, manifest, files) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: "backup-manifest.json" });
    for (const file of files) {
      archive.file(file.absolutePath, { name: file.entryPath });
    }
    archive.finalize();
  });
}

function getArchivePath(filename) {
  const safeName = path.basename(filename || "");
  if (!/^rootark-(backup|pre-restore)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/.test(safeName)) {
    return null;
  }
  const archivePath = path.resolve(BACKUPS_DIR, safeName);
  return archivePath.startsWith(path.resolve(BACKUPS_DIR)) ? archivePath : null;
}

async function cleanupRetention() {
  const count = envNumber("BACKUP_RETENTION_COUNT", 10);
  const days = envNumber("BACKUP_RETENTION_DAYS", 30);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const backups = backupRepository.listBackups()
    .filter((item) => item.status === "success" && item.type !== "pre-restore")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const toDelete = backups.filter((item, index) => index >= count || new Date(item.createdAt).getTime() < cutoff);
  for (const backup of toDelete) {
    const archivePath = getArchivePath(backup.filename);
    if (archivePath && fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });
    backupRepository.deleteBackup(backup.id);
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
  const filename = `rootark-${backupType === "pre-restore" ? "pre-restore" : "backup"}-${timestampForName()}.zip`;
  const archivePath = path.join(BACKUPS_DIR, filename);
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
    const files = collectBackupFiles();
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
    };

    await createZipArchive(archivePath, manifest, files);
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
      },
    });

    await cleanupRetention();
    return saved;
  } catch (error) {
    fs.rmSync(archivePath, { force: true });
    const failed = backupRepository.saveBackup({
      ...baseEntry,
      finishedAt: new Date().toISOString(),
      errorMessage: error.message,
      metadata: { ...baseEntry.metadata, durationMs: Date.now() - startedAt },
    });
    throw Object.assign(error, { backup: failed });
  } finally {
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
  createBackup,
  deleteBackup,
  getArchivePath,
  getBackupOrThrow,
  latestStatus,
  listBackups,
};
