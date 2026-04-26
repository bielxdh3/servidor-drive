const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "rootark_secret_change_in_production";
const USERS_SEED_FILE = "./data/users.json";
const USERS_FILE = "./data/users.local.json";
const PENDING_UPLOADS_FILE = "./data/pending-uploads.json";
const PUBLIC_LINKS_FILE = "./data/public-links.json";
const ACTION_HISTORY_FILE = "./data/actions-history.json";
const FOLDERS_FILE = "./data/folders.json";
const FILE_PERMISSIONS_FILE = "./data/file-permissions.json";
const FILE_EXPIRATIONS_FILE = "./data/file-expirations.json";
const ROOT_FOLDER_ID = "root";
const MAX_FILE_NAME_LENGTH = 30;
const MAX_SHARE_EXPIRATION_MINUTES = 60 * 24 * 30;
const MAX_SHARE_VIEWS = 1000;
const SHARE_VIEW_SESSION_MS = 10 * 60 * 1000;
const MAX_TEMPORARY_EXPIRATION_MS = 1000 * 60 * 60 * 24 * 365;
const MAX_ACTION_HISTORY_ENTRIES = 500;
const wordExtractor = new WordExtractor();

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getDefaultUsers() {
  return [
    {
      username: "admin",
      password: bcrypt.hashSync("admin123", 10),
      role: "admin",
      permissions: {
        upload: true,
        approve: true,
        delete: true,
        listFiles: true,
        listPending: true,
        manageUsers: true,
      },
    },
    {
      username: "user",
      password: bcrypt.hashSync("user123", 10),
      role: "user",
      permissions: {
        upload: true,
        approve: false,
        delete: false,
        listFiles: true,
        listPending: false,
        manageUsers: false,
      },
    },
  ];
}

function loadSeedUsers() {
  if (!fs.existsSync(USERS_SEED_FILE)) return null;

  try {
    const users = JSON.parse(fs.readFileSync(USERS_SEED_FILE, "utf-8"));
    return Array.isArray(users) && users.length ? users : null;
  } catch {
    return null;
  }
}

function loadPendingUploads() {
  if (!fs.existsSync(PENDING_UPLOADS_FILE)) return {};
  return JSON.parse(fs.readFileSync(PENDING_UPLOADS_FILE, "utf-8"));
}

function savePendingUploads(entries) {
  fs.writeFileSync(PENDING_UPLOADS_FILE, JSON.stringify(entries, null, 2));
}

function getDefaultFolders() {
  return [
    {
      id: ROOT_FOLDER_ID,
      name: "Arquivos atuais",
      createdBy: "sistema",
      createdAt: new Date().toISOString(),
      allowedUsers: [],
      isRoot: true,
    },
  ];
}

function loadFolders() {
  if (!fs.existsSync(FOLDERS_FILE)) return getDefaultFolders();
  const folders = JSON.parse(fs.readFileSync(FOLDERS_FILE, "utf-8"));
  return Array.isArray(folders) ? folders : getDefaultFolders();
}

function saveFolders(folders) {
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2));
}

function loadFilePermissions() {
  if (!fs.existsSync(FILE_PERMISSIONS_FILE)) return {};

  try {
    const entries = JSON.parse(fs.readFileSync(FILE_PERMISSIONS_FILE, "utf-8"));
    return entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
  } catch (error) {
    console.error("Falha ao ler permissoes de arquivos:", error.message);
    return {};
  }
}

function saveFilePermissions(entries) {
  fs.writeFileSync(FILE_PERMISSIONS_FILE, JSON.stringify(entries, null, 2));
}

function loadFileExpirations() {
  if (!fs.existsSync(FILE_EXPIRATIONS_FILE)) return {};

  try {
    const entries = JSON.parse(fs.readFileSync(FILE_EXPIRATIONS_FILE, "utf-8"));
    return entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
  } catch (error) {
    console.error("Falha ao ler expiracoes de arquivos:", error.message);
    return {};
  }
}

function saveFileExpirations(entries) {
  fs.writeFileSync(FILE_EXPIRATIONS_FILE, JSON.stringify(entries, null, 2));
}

function loadPublicLinks() {
  if (!fs.existsSync(PUBLIC_LINKS_FILE)) return {};
  return JSON.parse(fs.readFileSync(PUBLIC_LINKS_FILE, "utf-8"));
}

function savePublicLinks(entries) {
  fs.writeFileSync(PUBLIC_LINKS_FILE, JSON.stringify(entries, null, 2));
}

function loadActionHistory() {
  if (!fs.existsSync(ACTION_HISTORY_FILE)) return [];

  try {
    const entries = JSON.parse(fs.readFileSync(ACTION_HISTORY_FILE, "utf-8"));
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    console.error("Falha ao ler historico de acoes:", error.message);
    return [];
  }
}

function saveActionHistory(entries) {
  fs.writeFileSync(ACTION_HISTORY_FILE, JSON.stringify(entries, null, 2));
}

function addActionHistory(action, fileName, actor, details = {}) {
  try {
    const entries = loadActionHistory();

    entries.unshift({
      id: crypto.randomUUID(),
      action,
      fileName,
      actor: actor || "sistema",
      timestamp: new Date().toISOString(),
      details,
    });

    saveActionHistory(entries.slice(0, MAX_ACTION_HISTORY_ENTRIES));
  } catch (error) {
    console.error("Falha ao registrar historico de acoes:", error.message);
  }
}

function cleanupExpiredPublicLinks(entries = loadPublicLinks()) {
  const now = Date.now();
  let changed = false;

  for (const [token, link] of Object.entries(entries)) {
    const expiresAt = new Date(link.expiresAt).getTime();
    const maxViews = Number(link.maxViews) || 0;
    const views = Number(link.views) || 0;
    const activeViewers = cleanupShareViewers(link, now);
    if (activeViewers.changed) changed = true;

    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now ||
      (maxViews > 0 && views >= maxViews && Object.keys(activeViewers.viewers).length === 0)
    ) {
      delete entries[token];
      changed = true;
    }
  }

  if (changed) savePublicLinks(entries);
  return entries;
}

function removePublicLinksForFile(fileName, folderId = null) {
  const entries = loadPublicLinks();
  let changed = false;

  for (const [token, link] of Object.entries(entries)) {
    const sameFolder = !folderId || (link.folderId || ROOT_FOLDER_ID) === folderId;
    if (link.fileName === fileName && sameFolder) {
      delete entries[token];
      changed = true;
    }
  }

  if (changed) savePublicLinks(entries);
}

function renamePublicLinksForFile(oldName, newName, folderId = null) {
  const entries = loadPublicLinks();
  let changed = false;

  for (const link of Object.values(entries)) {
    const sameFolder = !folderId || (link.folderId || ROOT_FOLDER_ID) === folderId;
    if (link.fileName === oldName && sameFolder) {
      link.fileName = newName;
      changed = true;
    }
  }

  if (changed) savePublicLinks(entries);
}

function movePublicLinksForFile(oldName, newName, fromFolderId, toFolderId) {
  const entries = loadPublicLinks();
  let changed = false;

  for (const link of Object.values(entries)) {
    if (link.fileName === oldName && (link.folderId || ROOT_FOLDER_ID) === fromFolderId) {
      link.fileName = newName;
      link.folderId = toFolderId;
      changed = true;
    }
  }

  if (changed) savePublicLinks(entries);
}

function removePublicLinksForFolder(folderId) {
  const entries = loadPublicLinks();
  let changed = false;

  for (const [token, link] of Object.entries(entries)) {
    if ((link.folderId || ROOT_FOLDER_ID) === folderId) {
      delete entries[token];
      changed = true;
    }
  }

  if (changed) savePublicLinks(entries);
}

function getShareExpirationMinutes(rawValue) {
  const minutes = Number(rawValue);
  if (!Number.isFinite(minutes)) return null;

  const rounded = Math.floor(minutes);
  if (rounded < 1 || rounded > MAX_SHARE_EXPIRATION_MINUTES) return null;

  return rounded;
}

function getShareMaxViews(rawValue) {
  const views = Number(rawValue);
  if (!Number.isFinite(views)) return 0;

  const rounded = Math.floor(views);
  if (rounded < 0 || rounded > MAX_SHARE_VIEWS) return null;

  return rounded;
}

function getTemporaryExpiresAt(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "" || rawValue === false) {
    return null;
  }

  const date = new Date(rawValue);
  const timestamp = date.getTime();
  const now = Date.now();

  if (!Number.isFinite(timestamp) || timestamp <= now || timestamp - now > MAX_TEMPORARY_EXPIRATION_MS) {
    return undefined;
  }

  return date.toISOString();
}

function getTemporaryExpirationFromBody(body = {}) {
  if (body.temporary === false || body.expiresAt === null) return null;
  if (body.expiresAt !== undefined) return getTemporaryExpiresAt(body.expiresAt);

  const amount = Number(body.durationAmount);
  const unit = String(body.durationUnit || "").toLowerCase();
  if (body.durationAmount === undefined && body.durationUnit === undefined) return null;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const multiplier = unit.startsWith("day") || unit === "dias" || unit === "dia"
    ? 24 * 60 * 60 * 1000
    : 60 * 60 * 1000;
  const durationMs = Math.floor(amount) * multiplier;

  if (durationMs <= 0 || durationMs > MAX_TEMPORARY_EXPIRATION_MS) return undefined;
  return new Date(Date.now() + durationMs).toISOString();
}

function cleanupShareViewers(link, now = Date.now()) {
  const viewers = link.activeViewers && typeof link.activeViewers === "object" ? link.activeViewers : {};
  let changed = false;

  for (const [viewerId, viewer] of Object.entries(viewers)) {
    const expiresAt = new Date(viewer?.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      delete viewers[viewerId];
      changed = true;
    }
  }

  link.activeViewers = viewers;
  return { viewers, changed };
}

function getCookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return "";
}

function setShareViewerCookie(req, res, token, viewerId, expiresAt) {
  const maxAge = Math.max(1, Math.min(SHARE_VIEW_SESSION_MS, expiresAt - Date.now()));
  res.cookie(`rootark_share_${token}`, viewerId, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.get("x-forwarded-proto") === "https",
    maxAge,
  });
}

function renderPublicSharePage(token) {
  const safeToken = String(token).replace(/[^a-f0-9]/gi, "");

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta property="og:title" content="Root.ark - Link publico" />
    <meta property="og:description" content="Abra o link no navegador para acessar o arquivo." />
    <title>Root.ark - Link publico</title>
    <style>
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #020202;
        color: white;
        font-family: Arial, sans-serif;
      }

      .card {
        width: min(420px, calc(100% - 32px));
        padding: 24px;
        border: 1px solid #044879;
        border-radius: 16px;
        background: #111012;
        text-align: center;
      }

      button, a {
        display: inline-block;
        margin-top: 16px;
        padding: 10px 14px;
        border-radius: 10px;
        border: 1px solid #044879;
        background: #044879;
        color: white;
        cursor: pointer;
        text-decoration: none;
      }

      p {
        color: #b8b8b8;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Root.ark</h1>
      <p id="message">Preparando arquivo...</p>
      <button type="button" id="openButton" hidden>Abrir arquivo</button>
    </main>
    <script>
      const message = document.getElementById("message");
      const openButton = document.getElementById("openButton");

      async function openSharedFile() {
        openButton.hidden = true;
        message.textContent = "Validando link...";

        try {
          const response = await fetch("/share/${safeToken}/view", {
            method: "POST",
            headers: { "X-Rootark-Share-View": "1" },
          });
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(payload.error || "Link indisponivel.");
          }

          message.textContent = "Abrindo arquivo...";
          window.location.href = payload.url;
        } catch (error) {
          message.textContent = error.message || "Nao foi possivel abrir o link.";
          openButton.hidden = false;
        }
      }

      openButton.addEventListener("click", openSharedFile);
      openSharedFile();
    </script>
  </body>
</html>`;
}

function buildPublicShareUrl(req, token) {
  return `${req.protocol}://${req.get("host")}/share/${token}`;
}

function getFolderById(folderId = ROOT_FOLDER_ID) {
  return loadFolders().find((folder) => folder.id === folderId) || null;
}

function hasFolderAccess(req, folder) {
  if (!folder) return false;
  if (folder.isRoot || folder.id === ROOT_FOLDER_ID) return true;
  if (req.user?.role === "admin" || req.user?.permissions?.manageUsers) return true;
  if (folder.createdBy === req.user?.username) return true;
  return Array.isArray(folder.allowedUsers) && folder.allowedUsers.includes(req.user?.username);
}

function canManageAccess(req) {
  return req.user?.role === "admin" || req.user?.permissions?.manageUsers;
}

function getFilePermissionKey(folderId, fileName) {
  return `${folderId || ROOT_FOLDER_ID}/${path.basename(fileName || "")}`;
}

function getFileExpirationKey(folderId, fileName) {
  return `${folderId || ROOT_FOLDER_ID}/${path.basename(fileName || "")}`;
}

function getFileExpirationEntry(folderId, fileName, entries = loadFileExpirations()) {
  return entries[getFileExpirationKey(folderId, fileName)] || null;
}

function removeFileExpiration(folderId, fileName) {
  const entries = loadFileExpirations();
  const key = getFileExpirationKey(folderId, fileName);
  if (!entries[key]) return;

  delete entries[key];
  saveFileExpirations(entries);
}

function renameFileExpiration(folderId, oldName, newName) {
  const entries = loadFileExpirations();
  const oldKey = getFileExpirationKey(folderId, oldName);
  const newKey = getFileExpirationKey(folderId, newName);
  if (!entries[oldKey]) return;

  entries[newKey] = {
    ...entries[oldKey],
    folderId,
    fileName: newName,
    updatedAt: new Date().toISOString(),
  };
  delete entries[oldKey];
  saveFileExpirations(entries);
}

function moveFileExpiration(oldFolderId, oldName, newFolderId, newName) {
  const entries = loadFileExpirations();
  const oldKey = getFileExpirationKey(oldFolderId, oldName);
  const newKey = getFileExpirationKey(newFolderId, newName);
  if (!entries[oldKey]) return;

  entries[newKey] = {
    ...entries[oldKey],
    folderId: newFolderId,
    fileName: newName,
    updatedAt: new Date().toISOString(),
  };
  delete entries[oldKey];
  saveFileExpirations(entries);
}

function removeFileExpirationsForFolder(folderId) {
  const entries = loadFileExpirations();
  let changed = false;

  for (const key of Object.keys(entries)) {
    if (entries[key]?.folderId === folderId || key.startsWith(`${folderId}/`)) {
      delete entries[key];
      changed = true;
    }
  }

  if (changed) saveFileExpirations(entries);
}

function getFilePermissionEntry(folderId, fileName, entries = loadFilePermissions()) {
  return entries[getFilePermissionKey(folderId, fileName)] || null;
}

function normalizeFilePermissionEntry(entry) {
  const legacyAllowedUsers = normalizeAllowedUsers(entry?.allowedUsers);
  const rawUsers = entry?.users && typeof entry.users === "object" ? entry.users : {};
  const users = {};

  for (const [username, access] of Object.entries(rawUsers)) {
    const cleanUsername = String(username || "").trim();
    if (!cleanUsername) continue;

    const canEdit = Boolean(access?.edit);
    const canRead = Boolean(access?.read) || canEdit;
    if (canRead || canEdit) {
      users[cleanUsername] = { read: canRead, edit: canEdit };
    }
  }

  for (const username of legacyAllowedUsers) {
    users[username] = { read: true, edit: Boolean(users[username]?.edit) };
  }

  return {
    public: entry ? Boolean(entry.public) : true,
    owner: entry?.owner || "sistema",
    users,
  };
}

function getFolderEligibleUsers(folder) {
  const users = loadUsers().map(({ password, ...user }) => user);

  if (folder.isRoot || folder.id === ROOT_FOLDER_ID) {
    return users;
  }

  return users.filter((user) => (
    user.role === "admin" ||
    user.permissions?.manageUsers ||
    folder.createdBy === user.username ||
    (Array.isArray(folder.allowedUsers) && folder.allowedUsers.includes(user.username))
  ));
}

function hasFileAccess(req, folder, fileName, entries = loadFilePermissions()) {
  if (!hasFolderAccess(req, folder)) return false;
  if (canManageAccess(req)) return true;

  const entry = getFilePermissionEntry(folder.id, fileName, entries);
  const permissions = normalizeFilePermissionEntry(entry);
  const userAccess = permissions.users[req.user?.username];

  return permissions.public || Boolean(userAccess?.read) || Boolean(userAccess?.edit);
}

function hasFileEditAccess(req, folder, fileName, entries = loadFilePermissions()) {
  if (!hasFolderAccess(req, folder)) return false;
  if (canManageAccess(req)) return true;

  const entry = getFilePermissionEntry(folder.id, fileName, entries);
  if (!entry) return Boolean(req.user?.permissions?.delete);

  const permissions = normalizeFilePermissionEntry(entry);
  if (permissions.public && Object.keys(permissions.users).length === 0) {
    return Boolean(req.user?.permissions?.delete);
  }

  return Boolean(permissions.users[req.user?.username]?.edit);
}

function hasReadableFolderAccess(req, folder) {
  return hasFolderAccess(req, folder);
}

function getReadableFolderOrRespond(req, res, rawFolderId = ROOT_FOLDER_ID) {
  const folderId = String(rawFolderId || ROOT_FOLDER_ID);
  const folder = getFolderById(folderId);

  if (!folder) {
    res.status(404).json({ error: "Pasta nao encontrada" });
    return null;
  }

  if (!hasReadableFolderAccess(req, folder)) {
    res.status(403).json({ error: "Acesso negado a esta pasta" });
    return null;
  }

  const paths = ensureFolderDirectories(folder.id);
  return { ...folder, ...paths };
}

function removeFilePermission(folderId, fileName) {
  const entries = loadFilePermissions();
  const key = getFilePermissionKey(folderId, fileName);
  if (!entries[key]) return;

  delete entries[key];
  saveFilePermissions(entries);
}

function renameFilePermission(folderId, oldName, newName) {
  const entries = loadFilePermissions();
  const oldKey = getFilePermissionKey(folderId, oldName);
  const newKey = getFilePermissionKey(folderId, newName);
  if (!entries[oldKey]) return;

  entries[newKey] = {
    ...entries[oldKey],
    folderId,
    fileName: newName,
    updatedAt: new Date().toISOString(),
  };
  delete entries[oldKey];
  saveFilePermissions(entries);
}

function moveFilePermission(oldFolderId, oldName, newFolderId, newName) {
  const entries = loadFilePermissions();
  const oldKey = getFilePermissionKey(oldFolderId, oldName);
  const newKey = getFilePermissionKey(newFolderId, newName);
  if (!entries[oldKey]) return;

  entries[newKey] = {
    ...entries[oldKey],
    folderId: newFolderId,
    fileName: newName,
    updatedAt: new Date().toISOString(),
  };
  delete entries[oldKey];
  saveFilePermissions(entries);
}

function setFileOwner(folderId, fileName, owner) {
  if (!owner) return;

  const entries = loadFilePermissions();
  const key = getFilePermissionKey(folderId, fileName);
  const current = normalizeFilePermissionEntry(entries[key]);

  entries[key] = {
    folderId,
    fileName,
    owner,
    public: current.public,
    users: current.users,
    updatedAt: new Date().toISOString(),
    updatedBy: "sistema",
  };

  saveFilePermissions(entries);
}

function removeFilePermissionsForFolder(folderId) {
  const entries = loadFilePermissions();
  let changed = false;

  for (const key of Object.keys(entries)) {
    if (entries[key]?.folderId === folderId || key.startsWith(`${folderId}/`)) {
      delete entries[key];
      changed = true;
    }
  }

  if (changed) saveFilePermissions(entries);
}

function removeUserFromFilePermissions(username) {
  const entries = loadFilePermissions();
  let changed = false;

  for (const entry of Object.values(entries)) {
    if (Array.isArray(entry.allowedUsers)) {
      const nextUsers = entry.allowedUsers.filter((user) => user !== username);
      if (nextUsers.length !== entry.allowedUsers.length) {
        entry.allowedUsers = nextUsers;
        changed = true;
      }
    }

    if (entry.users && typeof entry.users === "object" && entry.users[username]) {
      delete entry.users[username];
      entry.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) saveFilePermissions(entries);
}

function deleteFolderContents(folder) {
  const folderId = folder.id;
  const uploadDir = getFolderStoragePath("./uploads", folderId);
  const tempDir = getFolderStoragePath("./temp", folderId);

  if (!isSafeFolderChildPath("./uploads", uploadDir) || !isSafeFolderChildPath("./temp", tempDir)) {
    throw new Error("Caminho de pasta invalido");
  }

  removePendingEntriesForFolder(folderId);
  removePublicLinksForFolder(folderId);
  removeFilePermissionsForFolder(folderId);
  removeFileExpirationsForFolder(folderId);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function cleanupExpiredTemporaryItems() {
  const now = Date.now();

  try {
    const folders = loadFolders();
    const remainingFolders = [];
    let foldersChanged = false;

    for (const folder of folders) {
      const expiresAt = folder.expiresAt ? new Date(folder.expiresAt).getTime() : null;
      if (
        folder.id !== ROOT_FOLDER_ID &&
        Number.isFinite(expiresAt) &&
        expiresAt <= now
      ) {
        deleteFolderContents(folder);
        addActionHistory("folder_expired", folder.name, "sistema", {
          folderId: folder.id,
          folderName: folder.name,
          expiresAt: folder.expiresAt,
        });
        foldersChanged = true;
        continue;
      }

      remainingFolders.push(folder);
    }

    if (foldersChanged) saveFolders(remainingFolders);
  } catch (error) {
    console.error("Falha ao limpar pastas temporarias:", error.message);
  }

  try {
    const expirations = loadFileExpirations();
    let filesChanged = false;

    for (const [key, entry] of Object.entries(expirations)) {
      const expiresAt = new Date(entry?.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue;

      const folderId = entry.folderId || ROOT_FOLDER_ID;
      const fileName = path.basename(entry.fileName || "");
      const filePath = path.join(getFolderStoragePath("./uploads", folderId), fileName);

      if (fileName && isExistingFile(filePath)) {
        fs.unlinkSync(filePath);
      }

      removePublicLinksForFile(fileName, folderId);
      removeFilePermission(folderId, fileName);
      delete expirations[key];
      addActionHistory("file_expired", fileName, "sistema", {
        folderId,
        expiresAt: entry.expiresAt,
      });
      filesChanged = true;
    }

    if (filesChanged) saveFileExpirations(expirations);
  } catch (error) {
    console.error("Falha ao limpar arquivos temporarios:", error.message);
  }
}

function sanitizeFolderName(name) {
  return String(name || "").trim().slice(0, 60);
}

function normalizeAllowedUsers(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((user) => String(user).trim()).filter(Boolean))];
  }

  if (typeof value === "string") {
    return [...new Set(value.split(",").map((user) => user.trim()).filter(Boolean))];
  }

  return [];
}

function createFolderId() {
  return crypto.randomBytes(8).toString("hex");
}

function getFolderStoragePath(baseDir, folderId = ROOT_FOLDER_ID) {
  if (folderId === ROOT_FOLDER_ID) return path.resolve(baseDir);
  return path.resolve(baseDir, folderId);
}

function ensureFolderDirectories(folderId) {
  const uploadDir = getFolderStoragePath("./uploads", folderId);
  const tempDir = getFolderStoragePath("./temp", folderId);

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  return { uploadDir, tempDir };
}

function isSafeFolderChildPath(baseDir, targetPath) {
  const basePath = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(`${basePath}${path.sep}`);
}

function removePendingEntriesForFolder(folderId) {
  const entries = loadPendingUploads();
  let changed = false;

  for (const key of Object.keys(entries)) {
    if (key.startsWith(`${folderId}/`) || entries[key]?.folderId === folderId) {
      delete entries[key];
      changed = true;
    }
  }

  if (changed) savePendingUploads(entries);
}

function getAccessibleFolderOrRespond(req, res, rawFolderId = ROOT_FOLDER_ID) {
  const folderId = String(rawFolderId || ROOT_FOLDER_ID);
  const folder = getFolderById(folderId);

  if (!folder) {
    res.status(404).json({ error: "Pasta nao encontrada" });
    return null;
  }

  if (!hasFolderAccess(req, folder)) {
    res.status(403).json({ error: "Acesso negado a esta pasta" });
    return null;
  }

  const paths = ensureFolderDirectories(folder.id);
  return { ...folder, ...paths };
}

function getPendingKey(folderId, fileName) {
  return folderId === ROOT_FOLDER_ID ? fileName : `${folderId}/${fileName}`;
}

function isValidFileNameLength(fileName) {
  return fileName.length <= MAX_FILE_NAME_LENGTH;
}

function shortenFileName(fileName) {
  const safeName = path.basename(fileName || "");
  if (safeName.length <= MAX_FILE_NAME_LENGTH) return safeName;

  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length);

  return `${baseName.slice(0, maxBaseLength)}${extension}`;
}

function getAvailableUploadFileName(originalName, folderId = ROOT_FOLDER_ID) {
  const shortenedName = shortenFileName(originalName);
  const extension = path.extname(shortenedName);
  const baseName = path.basename(shortenedName, extension);
  let candidate = shortenedName;
  let counter = 1;
  const uploadDir = getFolderStoragePath("./uploads", folderId);
  const tempDir = getFolderStoragePath("./temp", folderId);

  while (
    fs.existsSync(path.join(tempDir, candidate)) ||
    fs.existsSync(path.join(uploadDir, candidate))
  ) {
    const suffix = `-${counter}`;
    const maxBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length - suffix.length);
    candidate = `${baseName.slice(0, maxBaseLength)}${suffix}${extension}`;
    counter += 1;
  }

  return candidate;
}

function isExistingFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function getPendingUploadEntry(folderId, fileName) {
  const entries = loadPendingUploads();
  return entries[getPendingKey(folderId, fileName)] || entries[fileName] || null;
}

function getPendingUploadOwner(folderId, fileName) {
  return getPendingUploadEntry(folderId, fileName)?.uploadedBy || null;
}

function canAccessPendingFile(req, folderId, fileName) {
  return (
    req.user?.permissions?.listPending ||
    getPendingUploadOwner(folderId, fileName) === req.user?.username ||
    !getPendingUploadOwner(folderId, fileName)
  );
}

function resolveScopedFile(scope, rawName, rawFolderId = ROOT_FOLDER_ID) {
  const name = path.basename(rawName || "");
  const folderId = String(rawFolderId || ROOT_FOLDER_ID);

  if (!name) {
    return null;
  }

  const folder = getFolderById(folderId);
  if (!folder) return null;

  if (scope === "public") {
    return {
      name,
      folder,
      folderId,
      filePath: path.join(getFolderStoragePath("./uploads", folderId), name),
      isPending: false,
    };
  }

  if (scope === "pending") {
    return {
      name,
      folder,
      folderId,
      filePath: path.join(getFolderStoragePath("./temp", folderId), name),
      isPending: true,
    };
  }

  return null;
}

function ensurePreviewAccess(req, res, scope, rawName, rawFolderId = ROOT_FOLDER_ID) {
  const target = resolveScopedFile(scope, rawName, rawFolderId);
  if (!target) {
    res.status(400).json({ error: "Arquivo invalido" });
    return null;
  }

  if (target.isPending && !hasFolderAccess(req, target.folder)) {
    res.status(403).json({ error: "Acesso negado a esta pasta" });
    return null;
  }

  if (target.isPending) {
    if (!req.user?.permissions?.listPending && !req.user?.permissions?.upload) {
      res.status(403).json({ error: "Permissao negada: listPending" });
      return null;
    }

    if (!canAccessPendingFile(req, target.folderId, target.name)) {
      res.status(403).json({ error: "Permissao negada para esse arquivo" });
      return null;
    }
  } else if (!req.user?.permissions?.listFiles) {
    res.status(403).json({ error: "Permissao negada: listFiles" });
    return null;
  } else if (!hasFileAccess(req, target.folder, target.name)) {
    res.status(403).json({ error: "Acesso negado a este arquivo" });
    return null;
  }

  if (!fs.existsSync(target.filePath)) {
    res.status(404).json({ error: "Arquivo nao encontrado" });
    return null;
  }

  return target;
}

function listFilesWithDetails(directory, callback) {
  fs.readdir(directory, (readError, files) => {
    if (readError) {
      callback(readError);
      return;
    }

    const items = [];

    for (const name of files) {
      try {
        const filePath = path.join(directory, name);
        const stats = fs.statSync(filePath);

        if (stats.isFile()) {
          items.push({
            name,
            size: stats.size,
            uploadedAt: stats.birthtime.toISOString(),
          });
        }
      } catch (error) {
        // The file may be renamed or removed between readdir() and stat().
        if (error.code === "ENOENT") {
          continue;
        }

        callback(error);
        return;
      }
    }

    callback(null, items);
  });
}

function initData() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync("./temp")) fs.mkdirSync("./temp");
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  if (!fs.existsSync(PENDING_UPLOADS_FILE)) savePendingUploads({});
  if (!fs.existsSync(PUBLIC_LINKS_FILE)) savePublicLinks({});
  if (!fs.existsSync(ACTION_HISTORY_FILE)) saveActionHistory([]);
  if (!fs.existsSync(FOLDERS_FILE)) saveFolders(getDefaultFolders());
  if (!fs.existsSync(FILE_PERMISSIONS_FILE)) saveFilePermissions({});
  if (!fs.existsSync(FILE_EXPIRATIONS_FILE)) saveFileExpirations({});

  for (const folder of loadFolders()) {
    ensureFolderDirectories(folder.id);
  }

  if (!fs.existsSync(USERS_FILE)) {
    const seedUsers = loadSeedUsers();
    const users = seedUsers || getDefaultUsers();

    saveUsers(users);
    console.log(
      seedUsers
        ? "Usuarios locais restaurados a partir de data/users.json"
        : "Usuarios padrao criados -> admin:admin123 / user:user123"
    );
  }
}

app.use(express.json());
app.use(express.static("./public"));
app.use((req, res, next) => {
  cleanupExpiredTemporaryItems();
  next();
});

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalido ou expirado" });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user?.permissions?.[permission]) {
      return res.status(403).json({ error: `Permissao negada: ${permission}` });
    }
    next();
  };
}

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Usuario e senha obrigatorios" });
  }

  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Credenciais invalidas" });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, permissions: user.permissions },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, username: user.username, role: user.role, permissions: user.permissions });
});

app.get("/auth/me", authenticate, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, permissions: req.user.permissions });
});

app.get("/users", authenticate, requirePermission("manageUsers"), (req, res) => {
  const users = loadUsers().map(({ password, ...rest }) => rest);
  res.json(users);
});

app.post("/users", authenticate, requirePermission("manageUsers"), (req, res) => {
  const { username, password, role, permissions } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username e password obrigatorios" });
  }

  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    return res.status(409).json({ error: "Usuario ja existe" });
  }

  const base = {
    upload: false,
    approve: false,
    delete: false,
    listFiles: true,
    listPending: false,
    manageUsers: false,
    ...permissions,
  };

  const finalPermissions =
    role === "admin"
      ? Object.fromEntries(Object.keys(base).map((key) => [key, true]))
      : base;

  users.push({
    username,
    password: bcrypt.hashSync(password, 10),
    role: role || "user",
    permissions: finalPermissions,
  });

  saveUsers(users);
  res.status(201).json({ message: "Usuario criado" });
});

app.put("/users/:username", authenticate, requirePermission("manageUsers"), (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: "Usuario nao encontrado" });

  if (req.params.username === req.user.username && req.body.permissions?.manageUsers === false) {
    return res.status(400).json({ error: "Voce nao pode revogar sua propria permissao manageUsers" });
  }

  const { password, role, permissions } = req.body;
  if (password) users[idx].password = bcrypt.hashSync(password, 10);
  if (role) users[idx].role = role;
  if (permissions) users[idx].permissions = { ...users[idx].permissions, ...permissions };

  saveUsers(users);

  const { password: _, ...updated } = users[idx];
  res.json({ message: "Usuario atualizado", user: updated });
});

app.delete("/users/:username", authenticate, requirePermission("manageUsers"), (req, res) => {
  if (req.params.username === req.user.username) {
    return res.status(400).json({ error: "Voce nao pode excluir a si mesmo" });
  }

  const users = loadUsers();
  const filtered = users.filter((u) => u.username !== req.params.username);
  if (filtered.length === users.length) {
    return res.status(404).json({ error: "Usuario nao encontrado" });
  }

  saveUsers(filtered);
  removeUserFromFilePermissions(req.params.username);
  res.json({ message: "Usuario excluido" });
});

app.get("/file-access", authenticate, requirePermission("manageUsers"), (req, res) => {
  const rawName = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const name = path.basename(rawName);
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  const entry = getFilePermissionEntry(folder.id, name);
  const normalizedEntry = normalizeFilePermissionEntry(entry);
  res.json({
    folderId: folder.id,
    fileName: name,
    owner: normalizedEntry.owner,
    public: normalizedEntry.public,
    users: normalizedEntry.users,
    eligibleUsers: getFolderEligibleUsers(folder),
    allowedUsers: Object.entries(normalizedEntry.users)
      .filter(([, access]) => access.read || access.edit)
      .map(([username]) => username),
    inherited: !entry,
  });
});

app.put("/file-access", authenticate, requirePermission("manageUsers"), (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  const eligibleUsers = getFolderEligibleUsers(folder);
  const validUsernames = new Set(eligibleUsers.map((user) => user.username));
  const publicAccess = Boolean(req.body.public);
  const requestedUsers = req.body.users && typeof req.body.users === "object"
    ? req.body.users
    : Object.fromEntries(normalizeAllowedUsers(req.body.allowedUsers).map((username) => [
        username,
        { read: true, edit: false },
      ]));
  const userAccess = {};
  const invalidUsers = [];

  for (const [username, access] of Object.entries(requestedUsers)) {
    const cleanUsername = String(username || "").trim();
    if (!cleanUsername) continue;

    if (!validUsernames.has(cleanUsername)) {
      invalidUsers.push(cleanUsername);
      continue;
    }

    const canEdit = Boolean(access?.edit);
    const canRead = Boolean(access?.read) || canEdit;
    if (canRead || canEdit) {
      userAccess[cleanUsername] = { read: canRead, edit: canEdit };
    }
  }

  if (invalidUsers.length) {
    return res.status(400).json({
      error: `Usuarios sem acesso a pasta ou invalidos: ${invalidUsers.join(", ")}`,
    });
  }

  const entries = loadFilePermissions();
  const key = getFilePermissionKey(folder.id, name);
  const hasSpecificUsers = Object.keys(userAccess).length > 0;

  if (publicAccess && !hasSpecificUsers) {
    delete entries[key];
  } else {
    const previous = normalizeFilePermissionEntry(entries[key]);
    entries[key] = {
      folderId: folder.id,
      fileName: name,
      owner: previous.owner,
      public: publicAccess,
      users: userAccess,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username,
    };
  }

  saveFilePermissions(entries);
  addActionHistory("file_access_updated", name, req.user.username, {
    folderId: folder.id,
    folderName: folder.name,
    public: publicAccess,
    users: userAccess,
    inherited: publicAccess && !hasSpecificUsers,
  });

  res.json({
    message: "Permissoes do arquivo atualizadas",
    folderId: folder.id,
    fileName: name,
    owner: entries[key]?.owner || "sistema",
    public: publicAccess,
    users: userAccess,
    eligibleUsers,
    allowedUsers: Object.keys(userAccess),
    inherited: publicAccess && !hasSpecificUsers,
  });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, req.uploadFolder?.tempDir || getFolderStoragePath("./temp", ROOT_FOLDER_ID));
  },
  filename: (req, file, cb) => {
    try {
      cb(null, getAvailableUploadFileName(file.originalname, req.uploadFolder?.id || ROOT_FOLDER_ID));
    } catch (error) {
      cb(error);
    }
  },
});

const upload = multer({ storage });

function prepareUploadFolder(req, res, next) {
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  req.uploadFolder = folder;
  next();
}

app.get("/folders", authenticate, (req, res) => {
  const folders = loadFolders().filter((folder) => hasFolderAccess(req, folder));
  res.json(folders);
});

app.post("/folders", authenticate, requirePermission("manageUsers"), (req, res) => {
  const name = sanitizeFolderName(req.body.name);
  const allowedUsers = normalizeAllowedUsers(req.body.allowedUsers);
  const expiresAt = getTemporaryExpirationFromBody(req.body);

  if (!name) {
    return res.status(400).json({ error: "Nome da pasta e obrigatorio" });
  }

  if (expiresAt === undefined) {
    return res.status(400).json({ error: "Expiracao temporaria invalida" });
  }

  const folders = loadFolders();
  const folder = {
    id: createFolderId(),
    name,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    expiresAt,
    allowedUsers,
    isRoot: false,
  };

  folders.push(folder);
  saveFolders(folders);
  ensureFolderDirectories(folder.id);
  addActionHistory("folder_created", name, req.user.username, { folderId: folder.id, allowedUsers, expiresAt });
  res.status(201).json(folder);
});

app.put("/folders/:id/access", authenticate, requirePermission("manageUsers"), (req, res) => {
  const folderId = String(req.params.id || "");

  if (folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ter acesso alterado" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });

  folder.allowedUsers = normalizeAllowedUsers(req.body.allowedUsers);
  saveFolders(folders);
  addActionHistory("folder_access_updated", folder.name, req.user.username, {
    folderId,
    allowedUsers: folder.allowedUsers,
  });
  res.json(folder);
});

app.put("/folders/:id/temporary", authenticate, requirePermission("manageUsers"), (req, res) => {
  const folderId = String(req.params.id || "");

  if (!folderId || folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ser temporaria" });
  }

  const expiresAt = getTemporaryExpirationFromBody(req.body);
  if (expiresAt === undefined) {
    return res.status(400).json({ error: "Expiracao temporaria invalida" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });

  folder.expiresAt = expiresAt;
  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  addActionHistory("folder_temporary_updated", folder.name, req.user.username, {
    folderId,
    folderName: folder.name,
    expiresAt,
    temporary: Boolean(expiresAt),
  });

  res.json(folder);
});

app.delete("/folders/:id", authenticate, requirePermission("manageUsers"), (req, res) => {
  const folderId = String(req.params.id || "");

  if (!folderId || folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ser excluida" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });

  saveFolders(folders.filter((item) => item.id !== folderId));
  deleteFolderContents(folder);
  addActionHistory("folder_deleted", folder.name, req.user.username, { folderId });
  res.json({ message: "Pasta excluida" });
});

app.get("/files/:name", authenticate, requirePermission("listFiles"), (req, res) => {
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  const name = path.basename(req.params.name);
  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  res.sendFile(filePath);
});

app.post("/upload", authenticate, requirePermission("upload"), prepareUploadFolder, upload.single("file"), (req, res) => {
  const originalName = path.basename(req.file?.originalname || "");
  const fileName = path.basename(req.file?.filename || "");
  const folderId = req.uploadFolder?.id || ROOT_FOLDER_ID;

  if (!req.file || !fileName) {
    return res.status(400).json({ error: "Arquivo obrigatorio" });
  }

  const pendingUploads = loadPendingUploads();
  pendingUploads[getPendingKey(folderId, fileName)] = {
    uploadedBy: req.user.username,
    uploadedAt: new Date().toISOString(),
    originalName: originalName !== fileName ? originalName : undefined,
    folderId,
  };
  savePendingUploads(pendingUploads);
  addActionHistory("upload_pending", fileName, req.user.username, {
    status: "pending",
    originalName: originalName !== fileName ? originalName : null,
    folderId,
    folderName: req.uploadFolder?.name,
  });
  res.json({
    message: "Upload enviado para aprovacao",
    fileName,
    originalName,
    folderId,
    renamed: originalName !== fileName,
  });
});

app.put("/file-temporary", authenticate, (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  if (!hasFileEditAccess(req, folder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
  }

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  const expiresAt = getTemporaryExpirationFromBody(req.body);
  if (expiresAt === undefined) {
    return res.status(400).json({ error: "Expiracao temporaria invalida" });
  }

  const expirations = loadFileExpirations();
  const key = getFileExpirationKey(folder.id, name);

  if (!expiresAt) {
    delete expirations[key];
  } else {
    expirations[key] = {
      folderId: folder.id,
      fileName: name,
      expiresAt,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username,
    };
  }

  saveFileExpirations(expirations);
  addActionHistory("file_temporary_updated", name, req.user.username, {
    folderId: folder.id,
    folderName: folder.name,
    expiresAt,
    temporary: Boolean(expiresAt),
  });

  res.json({
    message: "Temporariedade do arquivo atualizada",
    folderId: folder.id,
    fileName: name,
    expiresAt,
    temporary: Boolean(expiresAt),
  });
});

app.get("/list", authenticate, requirePermission("listFiles"), (req, res) => {
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  listFilesWithDetails(folder.uploadDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });

    const filePermissions = loadFilePermissions();
    const fileExpirations = loadFileExpirations();
    const visibleFiles = files
      .filter((file) => hasFileAccess(req, folder, file.name, filePermissions))
      .map((file) => {
        const entry = getFilePermissionEntry(folder.id, file.name, filePermissions);
        const normalizedEntry = normalizeFilePermissionEntry(entry);
        const expiration = getFileExpirationEntry(folder.id, file.name, fileExpirations);

        return {
          ...file,
          folderId: folder.id,
          expiresAt: expiration?.expiresAt || null,
          temporary: Boolean(expiration?.expiresAt),
          access: {
            public: normalizedEntry.public,
            owner: normalizedEntry.owner,
            users: normalizedEntry.users,
          },
          canEdit: hasFileEditAccess(req, folder, file.name, filePermissions),
          canManageAccess: canManageAccess(req),
        };
      });

    res.json(visibleFiles);
  });
});

app.get("/history", authenticate, requirePermission("listFiles"), (req, res) => {
  try {
    res.json({ items: loadActionHistory().slice(0, 200) });
  } catch {
    res.status(500).json({ error: "Erro ao carregar historico" });
  }
});

app.post("/share", authenticate, requirePermission("listFiles"), (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const expiresInMinutes = getShareExpirationMinutes(req.body.expiresInMinutes);
  const maxViews = getShareMaxViews(req.body.maxViews);
  const folder = getReadableFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawName) {
    return res.status(400).json({ error: "Nome do arquivo e obrigatorio" });
  }

  if (name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  if (!expiresInMinutes) {
    return res.status(400).json({
      error: `Expiracao invalida. Use entre 1 e ${MAX_SHARE_EXPIRATION_MINUTES} minutos.`,
    });
  }

  if (maxViews === null) {
    return res.status(400).json({
      error: `Limite de visualizacoes invalido. Use 0 para ilimitado ou ate ${MAX_SHARE_VIEWS}.`,
    });
  }

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  const links = cleanupExpiredPublicLinks();
  const shareToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  links[shareToken] = {
    fileName: name,
    folderId: folder.id,
    createdAt: new Date().toISOString(),
    expiresAt,
    createdBy: req.user.username,
    views: 0,
    maxViews,
    activeViewers: {},
  };

  savePublicLinks(links);
  addActionHistory("share_created", name, req.user.username, {
    expiresAt,
    folderId: folder.id,
    folderName: folder.name,
    maxViews,
  });
  res.status(201).json({
    token: shareToken,
    url: buildPublicShareUrl(req, shareToken),
    fileName: name,
    expiresAt,
    views: 0,
    maxViews,
    remainingViews: maxViews > 0 ? maxViews : null,
  });
});

app.get("/share/:token", (req, res) => {
  const shareToken = String(req.params.token || "");
  if (!/^[a-f0-9]{48}$/i.test(shareToken)) {
    return res.status(404).send("Link nao encontrado");
  }

  res.type("html").send(renderPublicSharePage(shareToken));
});

app.post("/share/:token/view", (req, res) => {
  const shareToken = String(req.params.token || "");
  if (!/^[a-f0-9]{48}$/i.test(shareToken)) {
    return res.status(404).json({ error: "Link nao encontrado" });
  }

  if (req.get("x-rootark-share-view") !== "1") {
    return res.status(400).json({ error: "Visualizacao invalida" });
  }

  const links = loadPublicLinks();
  const link = links[shareToken];

  if (!link) {
    return res.status(404).json({ error: "Link nao encontrado" });
  }

  const expiresAt = new Date(link.expiresAt).getTime();
  const maxViews = Number(link.maxViews) || 0;
  let currentViews = Number(link.views) || 0;

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(410).json({ error: "Link expirado" });
  }

  const { viewers: activeViewers, changed: cleanedViewers } = cleanupShareViewers(link);
  let changed = cleanedViewers;

  if (maxViews > 0 && currentViews >= maxViews) {
    if (Object.keys(activeViewers).length === 0) {
      delete links[shareToken];
      savePublicLinks(links);
    } else if (changed) {
      savePublicLinks(links);
    }

    return res.status(410).json({ error: "Link expirado por limite de visualizacoes" });
  }

  const folderId = link.folderId || ROOT_FOLDER_ID;
  const fileName = path.basename(link.fileName || "");
  if (!fileName || fileName !== link.fileName) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  const filePath = path.join(getFolderStoragePath("./uploads", folderId), fileName);
  if (!isExistingFile(filePath)) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  const viewerId = crypto.randomBytes(16).toString("hex");
  const viewerExpiresAt = new Date(Math.min(Date.now() + SHARE_VIEW_SESSION_MS, expiresAt)).toISOString();
  activeViewers[viewerId] = {
    createdAt: new Date().toISOString(),
    expiresAt: viewerExpiresAt,
  };
  currentViews += 1;
  link.views = currentViews;
  link.lastViewedAt = new Date().toISOString();
  setShareViewerCookie(req, res, shareToken, viewerId, expiresAt);
  savePublicLinks(links);

  res.json({
    url: `/share/${shareToken}/file`,
    views: currentViews,
    maxViews,
    remainingViews: maxViews > 0 ? Math.max(0, maxViews - currentViews) : null,
  });
});

app.get("/share/:token/file", (req, res) => {
  const shareToken = String(req.params.token || "");
  if (!/^[a-f0-9]{48}$/i.test(shareToken)) {
    return res.status(404).send("Link nao encontrado");
  }

  const links = loadPublicLinks();
  const link = links[shareToken];

  if (!link) {
    return res.status(404).send("Link nao encontrado");
  }

  const expiresAt = new Date(link.expiresAt).getTime();
  const maxViews = Number(link.maxViews) || 0;

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(410).send("Link expirado");
  }

  const { viewers: activeViewers, changed } = cleanupShareViewers(link);

  if (maxViews > 0) {
    const cookieViewerId = getCookieValue(req, `rootark_share_${shareToken}`);
    if (!cookieViewerId || !activeViewers[cookieViewerId]) {
      if (changed) savePublicLinks(links);
      return res.status(410).send("Link expirado por limite de visualizacoes");
    }
  }

  const folderId = link.folderId || ROOT_FOLDER_ID;
  const fileName = path.basename(link.fileName || "");
  if (!fileName || fileName !== link.fileName) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).send("Arquivo nao encontrado");
  }

  const filePath = path.join(getFolderStoragePath("./uploads", folderId), fileName);
  if (!isExistingFile(filePath)) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).send("Arquivo nao encontrado");
  }

  if (changed) savePublicLinks(links);
  res.sendFile(filePath);
});

app.get("/pending", authenticate, (req, res) => {
  if (!req.user?.permissions?.listPending && !req.user?.permissions?.upload) {
    return res.status(403).json({ error: "Permissao negada: listPending" });
  }

  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  listFilesWithDetails(folder.tempDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });

    const visibleFiles = files
      .map((file) => ({
        ...file,
        folderId: folder.id,
        uploadedBy: getPendingUploadOwner(folder.id, file.name),
      }))
      .filter((file) => req.user.permissions.listPending || canAccessPendingFile(req, folder.id, file.name));

    res.json(visibleFiles);
  });
});

app.get("/preview/file/:scope/:name", authenticate, (req, res) => {
  const target = ensurePreviewAccess(req, res, req.params.scope, req.params.name, req.query.folderId);
  if (!target) return;

  res.sendFile(target.filePath);
});

app.get("/preview/text/:scope/:name", authenticate, async (req, res) => {
  const target = ensurePreviewAccess(req, res, req.params.scope, req.params.name, req.query.folderId);
  if (!target) return;

  const extension = path.extname(target.name).toLowerCase();

  try {
    if (extension === ".txt") {
      const content = fs.readFileSync(target.filePath, "utf-8");
      res.json({ content, format: "text" });
      return;
    }

    if (extension === ".docx") {
      const result = await mammoth.extractRawText({ path: target.filePath });
      res.json({ content: result.value, format: "text" });
      return;
    }

    if (extension === ".doc") {
      const document = await wordExtractor.extract(target.filePath);
      res.json({ content: document.getBody(), format: "text" });
      return;
    }

    res.status(400).json({ error: "Tipo de arquivo sem preview textual" });
  } catch (error) {
    res.status(500).json({ error: "Nao foi possivel gerar a previa" });
  }
});

app.get("/approve/:name", authenticate, requirePermission("approve"), (req, res) => {
  const name = path.basename(req.params.name);
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  fs.rename(path.join(folder.tempDir, name), path.join(folder.uploadDir, name), (err) => {
    if (err) return res.status(500).json({ error: "Erro ao aprovar" });

    const pendingUploads = loadPendingUploads();
    const key = getPendingKey(folder.id, name);
    const uploadedBy = pendingUploads[key]?.uploadedBy || pendingUploads[name]?.uploadedBy || null;
    delete pendingUploads[key];
    if (folder.id === ROOT_FOLDER_ID) delete pendingUploads[name];
    savePendingUploads(pendingUploads);
    setFileOwner(folder.id, name, uploadedBy);
    addActionHistory("approved", name, req.user.username, { uploadedBy, folderId: folder.id, folderName: folder.name });
    res.json({ message: "Aprovado" });
  });
});

app.get("/reject/:name", authenticate, requirePermission("approve"), (req, res) => {
  const name = path.basename(req.params.name);
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  fs.unlink(path.join(folder.tempDir, name), (err) => {
    if (err) return res.status(500).json({ error: "Erro ao rejeitar" });

    const pendingUploads = loadPendingUploads();
    const key = getPendingKey(folder.id, name);
    const uploadedBy = pendingUploads[key]?.uploadedBy || pendingUploads[name]?.uploadedBy || null;
    delete pendingUploads[key];
    if (folder.id === ROOT_FOLDER_ID) delete pendingUploads[name];
    savePendingUploads(pendingUploads);
    addActionHistory("rejected", name, req.user.username, { uploadedBy, folderId: folder.id, folderName: folder.name });
    res.json({ message: "Rejeitado" });
  });
});

app.get("/delete/:name", authenticate, (req, res) => {
  const name = path.basename(req.params.name);
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!hasFileEditAccess(req, folder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
  }

  fs.unlink(path.join(folder.uploadDir, name), (err) => {
    if (err) return res.status(500).json({ error: "Erro ao excluir" });
    removePublicLinksForFile(name, folder.id);
    removeFilePermission(folder.id, name);
    removeFileExpiration(folder.id, name);
    addActionHistory("deleted", name, req.user.username, { folderId: folder.id, folderName: folder.name });
    res.json({ message: "Excluido" });
  });
});

app.put("/rename", authenticate, (req, res) => {
  const rawOldName = typeof req.body.oldName === "string" ? req.body.oldName.trim() : "";
  const rawNewName = typeof req.body.newName === "string" ? req.body.newName.trim() : "";
  const oldName = path.basename(rawOldName);
  const newName = path.basename(rawNewName);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawOldName || !rawNewName) {
    return res.status(400).json({ error: "Nome atual e novo nome sao obrigatorios" });
  }

  if (oldName !== rawOldName || newName !== rawNewName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  if (oldName === newName) {
    return res.status(400).json({ error: "O novo nome precisa ser diferente do atual" });
  }

  if (!isValidFileNameLength(newName)) {
    return res.status(400).json({ error: `O nome do arquivo deve ter no maximo ${MAX_FILE_NAME_LENGTH} caracteres` });
  }

  const oldPath = path.join(folder.uploadDir, oldName);
  const newPath = path.join(folder.uploadDir, newName);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileEditAccess(req, folder, oldName)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
  }

  if (fs.existsSync(newPath)) {
    return res.status(409).json({ error: "Ja existe um arquivo com esse nome" });
  }

  fs.rename(oldPath, newPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao renomear arquivo" });
    renamePublicLinksForFile(oldName, newName, folder.id);
    renameFilePermission(folder.id, oldName, newName);
    renameFileExpiration(folder.id, oldName, newName);
    addActionHistory("renamed", newName, req.user.username, {
      oldName,
      newName,
      folderId: folder.id,
      folderName: folder.name,
    });
    res.json({ message: "Arquivo renomeado" });
  });
});

app.put("/move", authenticate, (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const fromFolder = getAccessibleFolderOrRespond(req, res, req.body.fromFolderId);
  if (!fromFolder) return;
  const toFolder = getAccessibleFolderOrRespond(req, res, req.body.toFolderId);
  if (!toFolder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  if (fromFolder.id === toFolder.id) {
    return res.status(400).json({ error: "Escolha uma pasta diferente da atual" });
  }

  const sourcePath = path.join(fromFolder.uploadDir, name);
  if (!isExistingFile(sourcePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileEditAccess(req, fromFolder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
  }

  const finalName = getAvailableUploadFileName(name, toFolder.id);
  const destinationPath = path.join(toFolder.uploadDir, finalName);

  fs.rename(sourcePath, destinationPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao mover arquivo" });

    movePublicLinksForFile(name, finalName, fromFolder.id, toFolder.id);
    moveFilePermission(fromFolder.id, name, toFolder.id, finalName);
    moveFileExpiration(fromFolder.id, name, toFolder.id, finalName);
    addActionHistory("moved", finalName, req.user.username, {
      oldName: name,
      newName: finalName,
      fromFolderId: fromFolder.id,
      fromFolderName: fromFolder.name,
      toFolderId: toFolder.id,
      toFolderName: toFolder.name,
    });
    res.json({ message: "Arquivo movido", fileName: finalName, folderId: toFolder.id });
  });
});

initData();
cleanupExpiredTemporaryItems();
setInterval(cleanupExpiredTemporaryItems, 60 * 1000);
app.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
