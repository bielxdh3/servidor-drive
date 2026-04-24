const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "rootark_secret_change_in_production";
const USERS_FILE = "./data/users.json";
const PENDING_UPLOADS_FILE = "./data/pending-uploads.json";
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

function getPendingUploadOwner(fileName) {
  return loadPendingUploads()[fileName]?.uploadedBy || null;
}

function canAccessPendingFile(req, fileName) {
  return (
    req.user?.permissions?.listPending ||
    getPendingUploadOwner(fileName) === req.user?.username ||
    !getPendingUploadOwner(fileName)
  );
}

function resolveScopedFile(scope, rawName) {
  const name = path.basename(rawName || "");

  if (!name) {
    return null;
  }

  if (scope === "public") {
    return {
      name,
      filePath: path.resolve("./uploads", name),
      isPending: false,
    };
  }

  if (scope === "pending") {
    return {
      name,
      filePath: path.resolve("./temp", name),
      isPending: true,
    };
  }

  return null;
}

function ensurePreviewAccess(req, res, scope, rawName) {
  const target = resolveScopedFile(scope, rawName);
  if (!target) {
    res.status(400).json({ error: "Arquivo invalido" });
    return null;
  }

  if (target.isPending) {
    if (!req.user?.permissions?.listPending && !req.user?.permissions?.upload) {
      res.status(403).json({ error: "Permissao negada: listPending" });
      return null;
    }

    if (!canAccessPendingFile(req, target.name)) {
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

    const items = files.map((name) => {
      const filePath = path.join(directory, name);
      const stats = fs.statSync(filePath);

      return {
        name,
        size: stats.size,
        uploadedAt: stats.birthtime.toISOString(),
      };
    });

    callback(null, items);
  });
}

function initData() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync("./temp")) fs.mkdirSync("./temp");
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  if (!fs.existsSync(PENDING_UPLOADS_FILE)) savePendingUploads({});

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
  destination: "./temp",
  filename: (req, file, cb) => cb(null, file.originalname),
});

const upload = multer({ storage });

app.use("/files", express.static("uploads"));

app.post("/upload", authenticate, requirePermission("upload"), upload.single("file"), (req, res) => {
  const pendingUploads = loadPendingUploads();
  pendingUploads[req.file.originalname] = {
    uploadedBy: req.user.username,
    uploadedAt: new Date().toISOString(),
  };
  savePendingUploads(pendingUploads);
  res.json({ message: "Upload enviado para aprovacao" });
});

app.get("/list", authenticate, requirePermission("listFiles"), (req, res) => {
  listFilesWithDetails("./uploads", (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });
    res.json(files);
  });
});

app.get("/pending", authenticate, (req, res) => {
  if (!req.user?.permissions?.listPending && !req.user?.permissions?.upload) {
    return res.status(403).json({ error: "Permissao negada: listPending" });
  }

  listFilesWithDetails("./temp", (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });

    const visibleFiles = files
      .map((file) => ({
        ...file,
        uploadedBy: getPendingUploadOwner(file.name),
      }))
      .filter((file) => req.user.permissions.listPending || canAccessPendingFile(req, file.name));

    res.json(visibleFiles);
  });
});

app.get("/preview/file/:scope/:name", authenticate, (req, res) => {
  const target = ensurePreviewAccess(req, res, req.params.scope, req.params.name);
  if (!target) return;

  res.sendFile(target.filePath);
});

app.get("/preview/text/:scope/:name", authenticate, async (req, res) => {
  const target = ensurePreviewAccess(req, res, req.params.scope, req.params.name);
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
  fs.rename(`./temp/${name}`, `./uploads/${name}`, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao aprovar" });

    const pendingUploads = loadPendingUploads();
    delete pendingUploads[name];
    savePendingUploads(pendingUploads);
    res.json({ message: "Aprovado" });
  });
});

app.get("/reject/:name", authenticate, requirePermission("approve"), (req, res) => {
  const name = path.basename(req.params.name);
  fs.unlink(`./temp/${name}`, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao rejeitar" });

    const pendingUploads = loadPendingUploads();
    delete pendingUploads[name];
    savePendingUploads(pendingUploads);
    res.json({ message: "Rejeitado" });
  });
});

app.get("/delete/:name", authenticate, requirePermission("delete"), (req, res) => {
  const name = path.basename(req.params.name);
  fs.unlink(`./uploads/${name}`, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao excluir" });
    res.json({ message: "Excluido" });
  });
});

app.put("/rename", authenticate, requirePermission("delete"), (req, res) => {
  const rawOldName = typeof req.body.oldName === "string" ? req.body.oldName.trim() : "";
  const rawNewName = typeof req.body.newName === "string" ? req.body.newName.trim() : "";
  const oldName = path.basename(rawOldName);
  const newName = path.basename(rawNewName);

  if (!rawOldName || !rawNewName) {
    return res.status(400).json({ error: "Nome atual e novo nome sao obrigatorios" });
  }

  if (oldName !== rawOldName || newName !== rawNewName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  if (oldName === newName) {
    return res.status(400).json({ error: "O novo nome precisa ser diferente do atual" });
  }

  const oldPath = path.join("./uploads", oldName);
  const newPath = path.join("./uploads", newName);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (fs.existsSync(newPath)) {
    return res.status(409).json({ error: "Ja existe um arquivo com esse nome" });
  }

  fs.rename(oldPath, newPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao renomear arquivo" });
    res.json({ message: "Arquivo renomeado" });
  });
});

initData();
app.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
