const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const { closeDb, getDatabasePath, isDbEnabled } = require("../db");
const { resolveRuntimePath } = require("../src/runtime-paths");
const backupService = require("./backupService");

const RESTORE_TMP_DIR = path.join(backupService.BACKUPS_DIR, ".restore-tmp");
const RESTORABLE_ROOTS = new Set(["data", "uploads"]);

function assertSafeZipPath(entryPath) {
  const normalized = String(entryPath || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Caminho invalido no backup: ${entryPath}`);
  }
  const parts = normalized.split("/");
  if (parts.includes("..")) throw new Error(`Path traversal bloqueado: ${entryPath}`);
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
  for (const entry of zip.files) {
    if (entry.type === "SymbolicLink") throw new Error(`Symlink bloqueado no backup: ${entry.path}`);
    assertSafeZipPath(entry.path);
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
    if (entry.type === "SymbolicLink") throw new Error(`Symlink bloqueado no backup: ${entry.path}`);

    const destination = path.resolve(targetDir, safePath);
    if (!destination.startsWith(path.resolve(targetDir))) {
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
    return {
      backup,
      manifest,
      preRestore,
      restartRecommended: restoredDatabase,
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
  getBackupManifest,
  restoreBackup,
  validateBackupArchive,
};
