const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ROOT_DIR } = require("../db");
const trashRepository = require("../repositories/trashRepository");

const TRASH_STORAGE_DIR = path.join(ROOT_DIR, "data", "trash");

function ensureTrashStorage() {
  fs.mkdirSync(TRASH_STORAGE_DIR, { recursive: true });
}

function safeName(name) {
  return path.basename(String(name || ""));
}

function ensureInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error("Caminho inseguro bloqueado");
  }
  return resolvedTarget;
}

function directorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(filePath);
    else if (entry.isFile()) total += fs.statSync(filePath).size;
  }
  return total;
}

function getAvailableRestoreName(destinationDir, originalName) {
  const parsed = path.parse(safeName(originalName));
  let candidate = safeName(originalName);
  let index = 1;
  while (fs.existsSync(path.join(destinationDir, candidate))) {
    candidate = `${parsed.name} (restored${index > 1 ? ` ${index}` : ""})${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function movePath(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(source, destination);
}

function buildFileMetadata(context) {
  const { folder, fileName, loaders } = context;
  const key = `${folder.id}/${fileName}`;
  return {
    permissions: loaders.loadFilePermissions()[key] || null,
    expiration: loaders.loadFileExpirations()[key] || null,
    versions: loaders.loadFileVersions()[key] || null,
    encryption: loaders.loadEncryptedFiles()[key] || null,
    publicLinks: Object.fromEntries(
      Object.entries(loaders.loadPublicLinks()).filter(([, link]) => (
        (link.folderId || "root") === folder.id && link.fileName === fileName
      ))
    ),
  };
}

function removeFileMetadata(context) {
  const { folder, fileName, loaders } = context;
  const key = `${folder.id}/${fileName}`;
  for (const [load, save] of [
    [loaders.loadFilePermissions, loaders.saveFilePermissions],
    [loaders.loadFileExpirations, loaders.saveFileExpirations],
    [loaders.loadEncryptedFiles, loaders.saveEncryptedFiles],
  ]) {
    const entries = load();
    if (entries[key]) {
      delete entries[key];
      save(entries);
    }
  }

  const publicLinks = loaders.loadPublicLinks();
  let linksChanged = false;
  for (const [token, link] of Object.entries(publicLinks)) {
    if ((link.folderId || "root") === folder.id && link.fileName === fileName) {
      delete publicLinks[token];
      linksChanged = true;
    }
  }
  if (linksChanged) loaders.savePublicLinks(publicLinks);
}

function removeFolderMetadata({ folderId, loaders }) {
  for (const [load, save] of [
    [loaders.loadFilePermissions, loaders.saveFilePermissions],
    [loaders.loadFileExpirations, loaders.saveFileExpirations],
    [loaders.loadFileVersions, loaders.saveFileVersions],
    [loaders.loadEncryptedFiles, loaders.saveEncryptedFiles],
  ]) {
    const entries = load();
    let changed = false;
    for (const key of Object.keys(entries)) {
      if (key.startsWith(`${folderId}/`)) {
        delete entries[key];
        changed = true;
      }
    }
    if (changed) save(entries);
  }
}

function restoreFileMetadata(context, metadata, restoredName) {
  const { folder, loaders } = context;
  const key = `${folder.id}/${restoredName}`;
  if (metadata.permissions) {
    const entries = loaders.loadFilePermissions();
    entries[key] = { ...metadata.permissions, fileName: restoredName, folderId: folder.id };
    loaders.saveFilePermissions(entries);
  }
  if (metadata.expiration) {
    const entries = loaders.loadFileExpirations();
    entries[key] = { ...metadata.expiration, fileName: restoredName, folderId: folder.id };
    loaders.saveFileExpirations(entries);
  }
  if (metadata.versions) {
    const entries = loaders.loadFileVersions();
    entries[key] = { ...metadata.versions, fileName: restoredName, folderId: folder.id };
    loaders.saveFileVersions(entries);
  }
  if (metadata.encryption) {
    const entries = loaders.loadEncryptedFiles();
    entries[key] = { ...metadata.encryption, fileName: restoredName, folderId: folder.id };
    loaders.saveEncryptedFiles(entries);
  }
}

function moveFileToTrash({ folder, fileName, deletedBy, loaders }) {
  ensureTrashStorage();
  const cleanName = safeName(fileName);
  const sourcePath = ensureInside(folder.uploadDir, path.join(folder.uploadDir, cleanName));
  if (!fs.existsSync(sourcePath)) throw new Error("Arquivo nao encontrado");
  const id = crypto.randomUUID();
  const trashRelative = path.posix.join("files", id, cleanName);
  const trashPath = path.join(TRASH_STORAGE_DIR, "files", id, cleanName);
  const metadata = buildFileMetadata({ folder, fileName: cleanName, loaders });
  const size = fs.statSync(sourcePath).size;

  movePath(sourcePath, trashPath);
  removeFileMetadata({ folder, fileName: cleanName, loaders });

  return trashRepository.saveTrashItem({
    id,
    itemType: "file",
    originalFolderId: folder.id,
    originalFolderName: folder.name,
    originalFileName: cleanName,
    storedFileName: cleanName,
    originalPath: `${folder.id}/${cleanName}`,
    trashPath: trashRelative,
    deletedBy,
    deletedAt: new Date().toISOString(),
    sizeBytes: size,
    metadata: { folderName: folder.name },
    restoreMetadata: metadata,
    status: "trashed",
  });
}

function moveFolderToTrash({ folder, deletedBy, loaders }) {
  ensureTrashStorage();
  if (!folder || folder.isRoot || folder.id === "root") throw new Error("A pasta padrao nao pode ir para lixeira");
  const id = crypto.randomUUID();
  const uploadDir = ensureInside(path.join(ROOT_DIR, "uploads"), folder.uploadDir);
  const tempDir = ensureInside(path.join(ROOT_DIR, "temp"), folder.tempDir);
  const trashFolderDir = path.join(TRASH_STORAGE_DIR, "folders", id);
  const trashUploads = path.join(trashFolderDir, "uploads");
  const trashTemp = path.join(trashFolderDir, "temp");
  const size = directorySize(uploadDir);
  const folderMetadata = {
    folder,
    filePermissions: Object.fromEntries(Object.entries(loaders.loadFilePermissions()).filter(([key]) => key.startsWith(`${folder.id}/`))),
    fileExpirations: Object.fromEntries(Object.entries(loaders.loadFileExpirations()).filter(([key]) => key.startsWith(`${folder.id}/`))),
    fileVersions: Object.fromEntries(Object.entries(loaders.loadFileVersions()).filter(([key]) => key.startsWith(`${folder.id}/`))),
    encryptedFiles: Object.fromEntries(Object.entries(loaders.loadEncryptedFiles()).filter(([key]) => key.startsWith(`${folder.id}/`))),
  };

  fs.mkdirSync(trashFolderDir, { recursive: true });
  if (fs.existsSync(uploadDir)) movePath(uploadDir, trashUploads);
  if (fs.existsSync(tempDir)) movePath(tempDir, trashTemp);

  loaders.saveFolders(loaders.loadFolders().filter((item) => item.id !== folder.id));
  const publicLinks = loaders.loadPublicLinks();
  let linksChanged = false;
  for (const [token, link] of Object.entries(publicLinks)) {
    if ((link.folderId || "root") === folder.id) {
      delete publicLinks[token];
      linksChanged = true;
    }
  }
  if (linksChanged) loaders.savePublicLinks(publicLinks);
  removeFolderMetadata({ folderId: folder.id, loaders });

  return trashRepository.saveTrashItem({
    id,
    itemType: "folder",
    originalFolderId: folder.id,
    originalFolderName: folder.name,
    originalFileName: folder.name,
    storedFileName: folder.id,
    originalPath: folder.id,
    trashPath: path.posix.join("folders", id),
    deletedBy,
    deletedAt: new Date().toISOString(),
    sizeBytes: size,
    metadata: { folderName: folder.name },
    restoreMetadata: folderMetadata,
    status: "trashed",
  });
}

function getTrashAbsolutePath(item) {
  return ensureInside(TRASH_STORAGE_DIR, path.join(TRASH_STORAGE_DIR, String(item.trashPath || "")));
}

function restoreFile({ item, folder, restoredBy, loaders }) {
  const sourcePath = getTrashAbsolutePath(item);
  const destinationDir = folder.uploadDir;
  const restoredName = getAvailableRestoreName(destinationDir, item.originalFileName);
  movePath(sourcePath, path.join(destinationDir, restoredName));
  restoreFileMetadata({ folder, loaders }, item.restoreMetadata || {}, restoredName);
  item.status = "restored";
  item.restoredBy = restoredBy;
  item.restoredAt = new Date().toISOString();
  item.metadata = { ...item.metadata, restoredName };
  return trashRepository.saveTrashItem(item);
}

function restoreFolder({ item, restoredBy, loaders, getDefaultFolder }) {
  const metadata = item.restoreMetadata || {};
  const folder = metadata.folder || {
    id: item.originalFolderId,
    name: item.originalFolderName,
    createdBy: restoredBy,
    createdAt: new Date().toISOString(),
    allowedUsers: [],
    isRoot: false,
  };
  const folders = loaders.loadFolders();
  const existing = folders.find((entry) => entry.id === folder.id);
  const restoredFolder = existing
    ? { ...folder, id: `${folder.id}-restored-${Date.now()}`, name: `${folder.name} restored` }
    : folder;
  loaders.saveFolders([...folders, restoredFolder]);

  const trashPath = getTrashAbsolutePath(item);
  const uploadSource = path.join(trashPath, "uploads");
  const tempSource = path.join(trashPath, "temp");
  const uploadDestination = path.join(ROOT_DIR, "uploads", restoredFolder.id === "root" ? "" : restoredFolder.id);
  const tempDestination = path.join(ROOT_DIR, "temp", restoredFolder.id === "root" ? "" : restoredFolder.id);
  if (fs.existsSync(uploadSource)) movePath(uploadSource, uploadDestination);
  if (fs.existsSync(tempSource)) movePath(tempSource, tempDestination);

  for (const [keyName, load, save] of [
    ["filePermissions", loaders.loadFilePermissions, loaders.saveFilePermissions],
    ["fileExpirations", loaders.loadFileExpirations, loaders.saveFileExpirations],
    ["fileVersions", loaders.loadFileVersions, loaders.saveFileVersions],
    ["encryptedFiles", loaders.loadEncryptedFiles, loaders.saveEncryptedFiles],
  ]) {
    const entries = load();
    for (const [key, value] of Object.entries(metadata[keyName] || {})) {
      const newKey = key.replace(`${folder.id}/`, `${restoredFolder.id}/`);
      entries[newKey] = { ...value, folderId: restoredFolder.id };
    }
    save(entries);
  }

  fs.rmSync(trashPath, { recursive: true, force: true });
  item.status = "restored";
  item.restoredBy = restoredBy;
  item.restoredAt = new Date().toISOString();
  item.metadata = { ...item.metadata, restoredFolderId: restoredFolder.id };
  return trashRepository.saveTrashItem(item);
}

function permanentlyDelete({ item, deletedBy, loaders }) {
  const target = getTrashAbsolutePath(item);
  fs.rmSync(target, { recursive: true, force: true });
  if (item.itemType === "file") {
    const versions = item.restoreMetadata?.versions?.versions || [];
    const uploadDir = path.join(ROOT_DIR, "uploads", item.originalFolderId === "root" ? "" : item.originalFolderId);
    for (const version of versions) {
      if (version.storedAs && version.storedAs !== item.originalFileName) {
        fs.rmSync(path.join(uploadDir, safeName(version.storedAs)), { force: true });
      }
    }
  } else if (item.itemType === "folder") {
    removeFolderMetadata({ folderId: item.originalFolderId, loaders });
  }
  item.status = "permanently_deleted";
  item.permanentlyDeletedBy = deletedBy;
  item.permanentlyDeletedAt = new Date().toISOString();
  return trashRepository.saveTrashItem(item);
}

function summary() {
  const items = trashRepository.listTrashItems();
  return {
    count: items.length,
    sizeBytes: items.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0),
    files: items.filter((item) => item.itemType === "file").length,
    folders: items.filter((item) => item.itemType === "folder").length,
  };
}

module.exports = {
  moveFileToTrash,
  moveFolderToTrash,
  permanentlyDelete,
  restoreFile,
  restoreFolder,
  summary,
};
