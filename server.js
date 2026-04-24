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
const USERS_FILE = "./data/users.json";
const PENDING_UPLOADS_FILE = "./data/pending-uploads.json";
const PUBLIC_LINKS_FILE = "./data/public-links.json";
const ACTION_HISTORY_FILE = "./data/actions-history.json";
const FOLDERS_FILE = "./data/folders.json";
const ROOT_FOLDER_ID = "root";
const MAX_FILE_NAME_LENGTH = 30;
const MAX_SHARE_EXPIRATION_MINUTES = 60 * 24 * 30;
const MAX_ACTION_HISTORY_ENTRIES = 500;
const wordExtractor = new WordExtractor();

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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

function loadPublicLinks() {
  if (!fs.existsSync(PUBLIC_LINKS_FILE)) return {};
  return JSON.parse(fs.readFileSync(PUBLIC_LINKS_FILE, "utf-8"));
}

function savePublicLinks(entries) {
  fs.writeFileSync(PUBLIC_LINKS_FILE, JSON.stringify(entries, null, 2));
}

function loadActionHistory() {
  if (!fs.existsSync(ACTION_HISTORY_FILE)) return [];
  const entries = JSON.parse(fs.readFileSync(ACTION_HISTORY_FILE, "utf-8"));
  return Array.isArray(entries) ? entries : [];
}

function saveActionHistory(entries) {
  fs.writeFileSync(ACTION_HISTORY_FILE, JSON.stringify(entries, null, 2));
}

function addActionHistory(action, fileName, actor, details = {}) {
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
}

function cleanupExpiredPublicLinks(entries = loadPublicLinks()) {
  const now = Date.now();
  let changed = false;

  for (const [token, link] of Object.entries(entries)) {
    const expiresAt = new Date(link.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
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

  if (!hasFolderAccess(req, target.folder)) {
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

  for (const folder of loadFolders()) {
    ensureFolderDirectories(folder.id);
  }

  if (!fs.existsSync(USERS_FILE)) {
    const defaultUsers = [
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

    saveUsers(defaultUsers);
    console.log("Usuarios padrao criados -> admin:admin123 / user:user123");
  }
}

app.use(express.json());
app.use(express.static("./public"));

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
  res.json({ message: "Usuario excluido" });
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

  if (!name) {
    return res.status(400).json({ error: "Nome da pasta e obrigatorio" });
  }

  const folders = loadFolders();
  const folder = {
    id: createFolderId(),
    name,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    allowedUsers,
    isRoot: false,
  };

  folders.push(folder);
  saveFolders(folders);
  ensureFolderDirectories(folder.id);
  addActionHistory("folder_created", name, req.user.username, { folderId: folder.id, allowedUsers });
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

app.delete("/folders/:id", authenticate, requirePermission("manageUsers"), (req, res) => {
  const folderId = String(req.params.id || "");

  if (!folderId || folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ser excluida" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });

  const uploadDir = getFolderStoragePath("./uploads", folderId);
  const tempDir = getFolderStoragePath("./temp", folderId);

  if (!isSafeFolderChildPath("./uploads", uploadDir) || !isSafeFolderChildPath("./temp", tempDir)) {
    return res.status(400).json({ error: "Caminho de pasta invalido" });
  }

  saveFolders(folders.filter((item) => item.id !== folderId));
  removePendingEntriesForFolder(folderId);
  removePublicLinksForFolder(folderId);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
  addActionHistory("folder_deleted", folder.name, req.user.username, { folderId });
  res.json({ message: "Pasta excluida" });
});

app.get("/files/:name", authenticate, requirePermission("listFiles"), (req, res) => {
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  const name = path.basename(req.params.name);
  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
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

app.get("/list", authenticate, requirePermission("listFiles"), (req, res) => {
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  listFilesWithDetails(folder.uploadDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });
    res.json(files.map((file) => ({ ...file, folderId: folder.id })));
  });
});

app.get("/history", authenticate, requirePermission("listFiles"), (req, res) => {
  res.json(loadActionHistory().slice(0, 200));
});

app.post("/share", authenticate, requirePermission("listFiles"), (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const expiresInMinutes = getShareExpirationMinutes(req.body.expiresInMinutes);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId);
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

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
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
  };

  savePublicLinks(links);
  addActionHistory("share_created", name, req.user.username, { expiresAt, folderId: folder.id, folderName: folder.name });
  res.status(201).json({
    token: shareToken,
    url: buildPublicShareUrl(req, shareToken),
    fileName: name,
    expiresAt,
  });
});

app.get("/share/:token", (req, res) => {
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
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(410).send("Link expirado");
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

app.get("/delete/:name", authenticate, requirePermission("delete"), (req, res) => {
  const name = path.basename(req.params.name);
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  fs.unlink(path.join(folder.uploadDir, name), (err) => {
    if (err) return res.status(500).json({ error: "Erro ao excluir" });
    removePublicLinksForFile(name, folder.id);
    addActionHistory("deleted", name, req.user.username, { folderId: folder.id, folderName: folder.name });
    res.json({ message: "Excluido" });
  });
});

app.put("/rename", authenticate, requirePermission("delete"), (req, res) => {
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

  if (fs.existsSync(newPath)) {
    return res.status(409).json({ error: "Ja existe um arquivo com esse nome" });
  }

  fs.rename(oldPath, newPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao renomear arquivo" });
    renamePublicLinksForFile(oldName, newName, folder.id);
    addActionHistory("renamed", newName, req.user.username, {
      oldName,
      newName,
      folderId: folder.id,
      folderName: folder.name,
    });
    res.json({ message: "Arquivo renomeado" });
  });
});

app.put("/move", authenticate, requirePermission("delete"), (req, res) => {
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

  const finalName = getAvailableUploadFileName(name, toFolder.id);
  const destinationPath = path.join(toFolder.uploadDir, finalName);

  fs.rename(sourcePath, destinationPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao mover arquivo" });

    movePublicLinksForFile(name, finalName, fromFolder.id, toFolder.id);
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
app.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
