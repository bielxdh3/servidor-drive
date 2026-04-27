const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });
const JWT_SECRET = process.env.JWT_SECRET || "rootark_secret_change_in_production";
const USERS_SEED_FILE = "./data/users.json";
const USERS_FILE = "./data/users.local.json";
const PENDING_UPLOADS_FILE = "./data/pending-uploads.json";
const PUBLIC_LINKS_FILE = "./data/public-links.json";
const ACTION_HISTORY_FILE = "./data/actions-history.json";
const FOLDERS_FILE = "./data/folders.json";
const FILE_PERMISSIONS_FILE = "./data/file-permissions.json";
const FILE_EXPIRATIONS_FILE = "./data/file-expirations.json";
const FILE_VERSIONS_FILE = "./data/file-versions.json";
const ENCRYPTED_FILES_FILE = "./data/encrypted-files.json";
const SERVER_MASTER_KEY_FILE = "./data/server-master.key";
const ANALYTICS_FILE = "./data/analytics.json";
const AUDIT_LOGS_FILE = "./data/audit-logs.json";
const AUDIT_ARCHIVE_FILE = "./data/audit-logs-archive.json";
const CLOUD_STORAGE_PROVIDER = String(process.env.CLOUD_STORAGE_PROVIDER || "local").toLowerCase();
const CLOUD_STORAGE_PREFIX = String(process.env.CLOUD_STORAGE_PREFIX || "rootark").replace(/^\/+|\/+$/g, "") || "rootark";
const ROOT_FOLDER_ID = "root";
const MAX_FILE_NAME_LENGTH = 30;
const MAX_FILE_VERSIONS = 10;
const MAX_SHARE_EXPIRATION_MINUTES = 60 * 24 * 30;
const MAX_SHARE_VIEWS = 1000;
const SHARE_VIEW_SESSION_MS = 10 * 60 * 1000;
const MAX_TEMPORARY_EXPIRATION_MS = 1000 * 60 * 60 * 24 * 365;
const OPEN_FILE_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_ACTION_HISTORY_ENTRIES = 500;
const ANALYTICS_RETENTION_MS = 1000 * 60 * 60 * 24 * 365;
const ANALYTICS_SUMMARY_CACHE_MS = 5 * 60 * 1000;
const MAX_AUDIT_LOGS = 10000;
const AUDIT_RETENTION_MS = 1000 * 60 * 60 * 24 * 365;
const CHUNK_UPLOAD_DIR = path.resolve("./temp/.chunks");
const SIMPLE_UPLOAD_INCOMING_DIR = path.resolve("./temp/.incoming");
const MAX_UPLOAD_CHUNKS = 2000;
const SINGLE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const ENCRYPTION_ITERATIONS = 100000;
const wordExtractor = new WordExtractor();
const openFileTokens = new Map();
let analyticsSummaryCache = null;
let s3ClientCache = null;
let googleDriveClientCache = null;

const ENCRYPTION_LEVELS = {
  none: { description: "Arquivo nao criptografado", icon: "open", requiresKey: false },
  "server-key": { description: "Criptografado com chave do servidor", icon: "server", requiresKey: false },
  "user-key": { description: "Criptografado com chave do usuario", icon: "private", requiresKey: false },
  password: { description: "Criptografado com senha", icon: "password", requiresKey: true },
  dual: { description: "Criptografia dupla", icon: "dual", requiresKey: true },
};

function isCloudStorageEnabled() {
  return CLOUD_STORAGE_PROVIDER === "s3" || CLOUD_STORAGE_PROVIDER === "gdrive";
}

function getCloudStorageStatus() {
  return {
    provider: CLOUD_STORAGE_PROVIDER,
    enabled: isCloudStorageEnabled(),
    prefix: CLOUD_STORAGE_PREFIX,
    s3: {
      bucketConfigured: Boolean(process.env.AWS_S3_BUCKET),
      region: process.env.AWS_REGION || "",
      endpointConfigured: Boolean(process.env.AWS_ENDPOINT_URL),
    },
    gdrive: {
      folderConfigured: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID),
      credentialsConfigured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    },
  };
}

function getCloudKey(folderId = ROOT_FOLDER_ID, fileName = "", area = "uploads") {
  return path.posix.join(
    CLOUD_STORAGE_PREFIX,
    area,
    String(folderId || ROOT_FOLDER_ID),
    path.basename(fileName || "")
  );
}

async function getS3Client() {
  if (s3ClientCache) return s3ClientCache;

  const { S3Client } = require("@aws-sdk/client-s3");
  const config = {
    region: process.env.AWS_REGION || "us-east-1",
  };

  if (process.env.AWS_ENDPOINT_URL) config.endpoint = process.env.AWS_ENDPOINT_URL;
  if (process.env.AWS_FORCE_PATH_STYLE === "true") config.forcePathStyle = true;

  s3ClientCache = new S3Client(config);
  return s3ClientCache;
}

async function getGoogleDriveClient() {
  if (googleDriveClientCache) return googleDriveClientCache;

  const { google } = require("googleapis");
  let auth;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  } else {
    auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  googleDriveClientCache = google.drive({ version: "v3", auth });
  return googleDriveClientCache;
}

async function findGoogleDriveFileByKey(cloudKey) {
  const drive = await getGoogleDriveClient();
  const response = await drive.files.list({
    q: `appProperties has { key='rootArkKey' and value='${String(cloudKey).replace(/'/g, "\\'")}' } and trashed=false`,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0] || null;
}

async function uploadFileToCloud(localPath, folderId, fileName, area = "uploads") {
  if (!isCloudStorageEnabled() || !isExistingFile(localPath)) return null;

  const cloudKey = getCloudKey(folderId, fileName, area);

  if (CLOUD_STORAGE_PROVIDER === "s3") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("AWS_S3_BUCKET nao configurado");
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const client = await getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: cloudKey,
      Body: fs.createReadStream(localPath),
    }));
    return { provider: "s3", key: cloudKey };
  }

  if (CLOUD_STORAGE_PROVIDER === "gdrive") {
    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) throw new Error("GOOGLE_DRIVE_FOLDER_ID nao configurado");
    const drive = await getGoogleDriveClient();
    const existing = await findGoogleDriveFileByKey(cloudKey);
    const requestBody = {
      name: path.basename(fileName),
      appProperties: {
        rootArkKey: cloudKey,
        rootArkFolderId: String(folderId || ROOT_FOLDER_ID),
        rootArkArea: area,
      },
    };
    const media = { body: fs.createReadStream(localPath) };

    if (existing?.id) {
      await drive.files.update({ fileId: existing.id, requestBody, media, fields: "id" });
      return { provider: "gdrive", key: cloudKey, id: existing.id };
    }

    requestBody.parents = [process.env.GOOGLE_DRIVE_FOLDER_ID];
    const created = await drive.files.create({ requestBody, media, fields: "id" });
    return { provider: "gdrive", key: cloudKey, id: created.data.id };
  }

  return null;
}

async function downloadFileFromCloud(folderId, fileName, localPath, area = "uploads") {
  if (!isCloudStorageEnabled() || isExistingFile(localPath)) return false;

  const cloudKey = getCloudKey(folderId, fileName, area);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  if (CLOUD_STORAGE_PROVIDER === "s3") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("AWS_S3_BUCKET nao configurado");
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const client = await getS3Client();
    const response = await client.send(new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: cloudKey,
    }));

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(localPath);
      response.Body.pipe(output);
      response.Body.on("error", reject);
      output.on("finish", resolve);
      output.on("error", reject);
    });
    return true;
  }

  if (CLOUD_STORAGE_PROVIDER === "gdrive") {
    const drive = await getGoogleDriveClient();
    const existing = await findGoogleDriveFileByKey(cloudKey);
    if (!existing?.id) return false;

    const response = await drive.files.get(
      { fileId: existing.id, alt: "media" },
      { responseType: "stream" }
    );

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(localPath);
      response.data.pipe(output);
      response.data.on("error", reject);
      output.on("finish", resolve);
      output.on("error", reject);
    });
    return true;
  }

  return false;
}

async function deleteFileFromCloud(folderId, fileName, area = "uploads") {
  if (!isCloudStorageEnabled()) return false;

  const cloudKey = getCloudKey(folderId, fileName, area);

  if (CLOUD_STORAGE_PROVIDER === "s3") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("AWS_S3_BUCKET nao configurado");
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const client = await getS3Client();
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: cloudKey,
    }));
    return true;
  }

  if (CLOUD_STORAGE_PROVIDER === "gdrive") {
    const drive = await getGoogleDriveClient();
    const existing = await findGoogleDriveFileByKey(cloudKey);
    if (!existing?.id) return false;
    await drive.files.delete({ fileId: existing.id });
    return true;
  }

  return false;
}

async function deleteCloudPrefix(prefix) {
  if (!isCloudStorageEnabled()) return false;

  const normalizedPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (!normalizedPrefix || !normalizedPrefix.startsWith(CLOUD_STORAGE_PREFIX)) return false;

  if (CLOUD_STORAGE_PROVIDER === "s3") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("AWS_S3_BUCKET nao configurado");
    const { ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
    const client = await getS3Client();
    let ContinuationToken;

    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET,
        Prefix: `${normalizedPrefix}/`,
        ContinuationToken,
      }));
      const objects = (listed.Contents || []).map((item) => ({ Key: item.Key })).filter((item) => item.Key);
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Delete: { Objects: objects },
        }));
      }
      ContinuationToken = listed.NextContinuationToken;
    } while (ContinuationToken);

    return true;
  }

  if (CLOUD_STORAGE_PROVIDER === "gdrive") {
    const drive = await getGoogleDriveClient();
    const parts = normalizedPrefix.split("/");
    const area = parts[1];
    const folderId = parts[2];
    if (!area || !folderId) return false;
    let pageToken;
    do {
      const response = await drive.files.list({
        q: `appProperties has { key='rootArkFolderId' and value='${String(folderId).replace(/'/g, "\\'")}' } and appProperties has { key='rootArkArea' and value='${String(area).replace(/'/g, "\\'")}' } and trashed=false`,
        fields: "nextPageToken, files(id)",
        spaces: "drive",
        pageToken,
        pageSize: 100,
      });

      for (const file of response.data.files || []) {
        await drive.files.delete({ fileId: file.id });
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return true;
  }

  return false;
}

async function listCloudFiles(folderId, area = "uploads") {
  if (!isCloudStorageEnabled()) return [];

  if (CLOUD_STORAGE_PROVIDER === "s3") {
    if (!process.env.AWS_S3_BUCKET) throw new Error("AWS_S3_BUCKET nao configurado");
    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const client = await getS3Client();
    const prefix = `${getCloudKey(folderId, "", area)}/`;
    const files = [];
    let ContinuationToken;

    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: process.env.AWS_S3_BUCKET,
        Prefix: prefix,
        ContinuationToken,
      }));

      for (const item of listed.Contents || []) {
        const name = path.posix.basename(item.Key || "");
        if (name) files.push({ name, key: item.Key });
      }

      ContinuationToken = listed.NextContinuationToken;
    } while (ContinuationToken);

    return files;
  }

  if (CLOUD_STORAGE_PROVIDER === "gdrive") {
    const drive = await getGoogleDriveClient();
    const files = [];
    let pageToken;

    do {
      const response = await drive.files.list({
        q: `appProperties has { key='rootArkFolderId' and value='${String(folderId || ROOT_FOLDER_ID).replace(/'/g, "\\'")}' } and appProperties has { key='rootArkArea' and value='${String(area).replace(/'/g, "\\'")}' } and trashed=false`,
        fields: "nextPageToken, files(id, name, appProperties)",
        spaces: "drive",
        pageToken,
        pageSize: 100,
      });

      for (const file of response.data.files || []) {
        const key = file.appProperties?.rootArkKey || "";
        const name = path.posix.basename(key) || path.basename(file.name || "");
        if (name) files.push({ name, id: file.id, key });
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return files;
  }

  return [];
}

async function syncFolderCacheFromCloud(folderId, area = "uploads") {
  if (!isCloudStorageEnabled()) return;

  try {
    const files = await listCloudFiles(folderId, area);
    const baseDir = area === "temp" ? "./temp" : "./uploads";
    for (const file of files) {
      const fileName = path.basename(file.name || "");
      if (!fileName) continue;
      const localPath = path.join(getFolderStoragePath(baseDir, folderId), fileName);
      await ensureCloudFileCached(folderId, fileName, localPath, area);
    }
  } catch (error) {
    console.error(`[cloud-storage] sync cache ${area}/${folderId}:`, error.message);
  }
}

function syncCloudFireAndForget(promise, label) {
  if (!isCloudStorageEnabled()) return;
  Promise.resolve(promise).catch((error) => {
    console.error(`[cloud-storage] ${label}:`, error.message);
  });
}

function syncFileToCloud(folderId, fileName, area = "uploads") {
  const baseDir = area === "temp" ? "./temp" : "./uploads";
  const localPath = path.join(getFolderStoragePath(baseDir, folderId), path.basename(fileName));
  syncCloudFireAndForget(uploadFileToCloud(localPath, folderId, fileName, area), `sync ${area}/${folderId}/${fileName}`);
}

function deleteCloudFileLater(folderId, fileName, area = "uploads") {
  syncCloudFireAndForget(deleteFileFromCloud(folderId, fileName, area), `delete ${area}/${folderId}/${fileName}`);
}

function deleteCloudFolderLater(folderId) {
  syncCloudFireAndForget(deleteCloudPrefix(getCloudKey(folderId, "", "uploads")), `delete uploads folder ${folderId}`);
  syncCloudFireAndForget(deleteCloudPrefix(getCloudKey(folderId, "", "temp")), `delete temp folder ${folderId}`);
}

async function ensureCloudFileCached(folderId, fileName, localPath, area = "uploads") {
  if (isExistingFile(localPath)) return true;
  if (!isCloudStorageEnabled()) return false;

  try {
    return await downloadFileFromCloud(folderId, fileName, localPath, area);
  } catch (error) {
    console.error(`[cloud-storage] restore cache ${area}/${folderId}/${fileName}:`, error.message);
    return false;
  }
}

function sendRealtime(socket, event, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ event, payload, timestamp: new Date().toISOString() }));
}

function broadcastRealtime(event, payload = {}) {
  for (const socket of wss.clients) {
    sendRealtime(socket, event, payload);
  }
}

function broadcastDataChanged(source, payload = {}) {
  broadcastRealtime("data:changed", { source, ...payload });
}

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getBasePermissions() {
  return {
    upload: false,
    approve: false,
    delete: false,
    listFiles: true,
    listPending: false,
    manageUsers: false,
    createFolders: false,
    viewAnalytics: false,
    viewAuditLogs: false,
  };
}

function normalizeUserPermissions(user = {}) {
  const permissions = {
    ...getBasePermissions(),
    ...(user.permissions || {}),
  };

  if (user.role === "admin") {
    return Object.fromEntries(Object.keys(permissions).map((key) => [key, true]));
  }

  return permissions;
}

function getDefaultUsers() {
  return [
    {
      username: "admin",
      password: bcrypt.hashSync("admin123", 10),
      role: "admin",
      permissions: normalizeUserPermissions({ role: "admin" }),
    },
    {
      username: "user",
      password: bcrypt.hashSync("user123", 10),
      role: "user",
      permissions: {
        ...getBasePermissions(),
        upload: true,
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
  broadcastDataChanged("pending");
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
  broadcastDataChanged("folders");
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
  broadcastDataChanged("permissions");
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
  broadcastDataChanged("expirations");
}

function loadFileVersions() {
  if (!fs.existsSync(FILE_VERSIONS_FILE)) return {};

  try {
    const entries = JSON.parse(fs.readFileSync(FILE_VERSIONS_FILE, "utf-8"));
    return entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
  } catch (error) {
    console.error("Falha ao ler versoes de arquivos:", error.message);
    return {};
  }
}

function saveFileVersions(entries) {
  fs.writeFileSync(FILE_VERSIONS_FILE, JSON.stringify(entries, null, 2));
  broadcastDataChanged("versions");
}

function loadEncryptedFiles() {
  if (!fs.existsSync(ENCRYPTED_FILES_FILE)) return {};

  try {
    const entries = JSON.parse(fs.readFileSync(ENCRYPTED_FILES_FILE, "utf-8"));
    return entries && typeof entries === "object" && !Array.isArray(entries) ? entries : {};
  } catch (error) {
    console.error("Falha ao ler metadados de criptografia:", error.message);
    return {};
  }
}

function saveEncryptedFiles(entries) {
  fs.writeFileSync(ENCRYPTED_FILES_FILE, JSON.stringify(entries, null, 2));
  broadcastDataChanged("encryption");
}

function getDefaultAnalytics() {
  return {
    uploads: [],
    downloads: [],
    logins: [],
    deletions: [],
    approvals: [],
    rejections: [],
    restores: [],
    versionDeletions: [],
  };
}

function normalizeAnalytics(entries = {}) {
  const defaults = getDefaultAnalytics();
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, Array.isArray(entries[key]) ? entries[key] : []])
  );
}

function loadAnalytics() {
  if (!fs.existsSync(ANALYTICS_FILE)) return getDefaultAnalytics();

  try {
    return normalizeAnalytics(JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8")));
  } catch (error) {
    console.error("Falha ao ler analytics:", error.message);
    return getDefaultAnalytics();
  }
}

function saveAnalytics(entries) {
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(normalizeAnalytics(entries), null, 2));
  broadcastDataChanged("analytics");
}

function invalidateAnalyticsCache() {
  analyticsSummaryCache = null;
}

function cleanOldAnalytics(entries) {
  const cutoff = Date.now() - ANALYTICS_RETENTION_MS;
  let changed = false;
  const dateFields = {
    uploads: "uploadedAt",
    downloads: "downloadedAt",
    logins: "loginAt",
    deletions: "deletedAt",
    approvals: "approvedAt",
    rejections: "rejectedAt",
    restores: "restoredAt",
    versionDeletions: "deletedAt",
  };

  for (const [key, field] of Object.entries(dateFields)) {
    const current = entries[key] || [];
    const filtered = current.filter((item) => {
      const time = new Date(item?.[field]).getTime();
      return Number.isFinite(time) && time >= cutoff;
    });
    if (filtered.length !== current.length) {
      entries[key] = filtered;
      changed = true;
    }
  }

  return changed;
}

function logAnalyticsEvent(type, payload = {}) {
  try {
    const entries = loadAnalytics();
    const now = new Date().toISOString();

    if (type === "upload") {
      entries.uploads.push({
        filename: payload.filename,
        uploadedBy: payload.uploadedBy,
        uploadedAt: payload.uploadedAt || now,
        size: Number(payload.size) || 0,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
        approved: false,
      });
    } else if (type === "approval") {
      const target = [...entries.uploads].reverse().find((item) => (
        item.filename === payload.filename &&
        (item.folderId || ROOT_FOLDER_ID) === (payload.folderId || ROOT_FOLDER_ID) &&
        !item.approved
      ));
      if (target) {
        target.approved = true;
        target.approvedBy = payload.approvedBy;
        target.approvedAt = payload.approvedAt || now;
      }
      entries.approvals.push({
        filename: payload.filename,
        approvedBy: payload.approvedBy,
        approvedAt: payload.approvedAt || now,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    } else if (type === "rejection") {
      entries.rejections.push({
        filename: payload.filename,
        rejectedBy: payload.rejectedBy,
        rejectedAt: payload.rejectedAt || now,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    } else if (type === "download") {
      entries.downloads.push({
        filename: payload.filename,
        downloadedBy: payload.downloadedBy,
        downloadedAt: payload.downloadedAt || now,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    } else if (type === "login") {
      entries.logins.push({
        username: payload.username,
        loginAt: payload.loginAt || now,
        ip: payload.ip || "",
      });
    } else if (type === "deletion") {
      entries.deletions.push({
        filename: payload.filename,
        deletedBy: payload.deletedBy,
        deletedAt: payload.deletedAt || now,
        size: Number(payload.size) || 0,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    } else if (type === "restore") {
      entries.restores.push({
        filename: payload.filename,
        restoredBy: payload.restoredBy,
        restoredAt: payload.restoredAt || now,
        restoredVersion: payload.restoredVersion,
        newVersion: payload.newVersion,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    } else if (type === "versionDeletion") {
      entries.versionDeletions.push({
        filename: payload.filename,
        deletedBy: payload.deletedBy,
        deletedAt: payload.deletedAt || now,
        version: payload.version,
        folderId: payload.folderId || ROOT_FOLDER_ID,
        folderName: payload.folderName || "",
      });
    }

    cleanOldAnalytics(entries);
    saveAnalytics(entries);
    invalidateAnalyticsCache();
  } catch (error) {
    console.error("Falha ao registrar analytics:", error.message);
  }
}

function loadPublicLinks() {
  if (!fs.existsSync(PUBLIC_LINKS_FILE)) return {};
  return JSON.parse(fs.readFileSync(PUBLIC_LINKS_FILE, "utf-8"));
}

function savePublicLinks(entries) {
  fs.writeFileSync(PUBLIC_LINKS_FILE, JSON.stringify(entries, null, 2));
  broadcastDataChanged("shares");
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
  broadcastDataChanged("history");
}

const AUDIT_EVENTS = {
  "auth.login.success": { severity: "info" },
  "auth.login.failed": { severity: "warning" },
  "auth.token.invalid": { severity: "warning" },
  "file.upload": { severity: "info" },
  "file.download": { severity: "info" },
  "file.delete": { severity: "warning" },
  "file.approve": { severity: "info" },
  "file.reject": { severity: "info" },
  "file.rename": { severity: "info" },
  "file.move": { severity: "info" },
  "file.access.denied": { severity: "warning" },
  "file.version.restore": { severity: "warning" },
  "file.version.delete": { severity: "warning" },
  "user.created": { severity: "info" },
  "user.updated": { severity: "info" },
  "user.deleted": { severity: "critical" },
  "user.permission.changed": { severity: "critical" },
  "user.password.changed": { severity: "warning" },
  "folder.created": { severity: "info" },
  "folder.deleted": { severity: "warning" },
  "folder.access.changed": { severity: "critical" },
  "system.startup": { severity: "info" },
  "system.error": { severity: "error" },
  "system.anomaly.detected": { severity: "warning" },
};

function getDefaultAuditLogs() {
  return { logs: [] };
}

function sanitizeAuditValue(value, maxLength = 500) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(/[\r\n\t]/g, " ").slice(0, maxLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAuditValue(item, maxLength));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/password|token|secret|authorization/i.test(key))
        .map(([key, item]) => [sanitizeAuditValue(key, 100), sanitizeAuditValue(item, maxLength)])
    );
  }
  return String(value).slice(0, maxLength);
}

function loadAuditLogs(file = AUDIT_LOGS_FILE) {
  if (!fs.existsSync(file)) return getDefaultAuditLogs();
  try {
    const entries = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { logs: Array.isArray(entries?.logs) ? entries.logs : [] };
  } catch (error) {
    console.error("Falha ao ler audit logs:", error.message);
    return getDefaultAuditLogs();
  }
}

function saveAuditLogs(entries, file = AUDIT_LOGS_FILE) {
  fs.writeFileSync(file, JSON.stringify({ logs: Array.isArray(entries?.logs) ? entries.logs : [] }, null, 2));
  if (file === AUDIT_LOGS_FILE) broadcastDataChanged("audit");
}

function getAuditActor(req, fallbackUsername = "system") {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  const rawIp =
    req?.headers?.["cf-connecting-ip"] ||
    req?.headers?.["x-real-ip"] ||
    forwardedFor[0] ||
    req?.ip ||
    req?.socket?.remoteAddress ||
    null;
  const ip = rawIp === "::1" || rawIp === "::ffff:127.0.0.1" ? "127.0.0.1" : rawIp;

  return {
    username: req?.user?.username || fallbackUsername || "system",
    role: req?.user?.role || null,
    ip,
    userAgent: req?.headers?.["user-agent"] || null,
  };
}

function archiveAuditLogs(logs) {
  if (!logs.length) return;
  const archive = loadAuditLogs(AUDIT_ARCHIVE_FILE);
  archive.logs.push(...logs);
  saveAuditLogs(archive, AUDIT_ARCHIVE_FILE);
}

function appendAuditLog(log) {
  const entries = loadAuditLogs();
  const cutoff = Date.now() - AUDIT_RETENTION_MS;
  const retained = entries.logs.filter((entry) => {
    const time = new Date(entry.timestamp).getTime();
    return Number.isFinite(time) && time >= cutoff;
  });

  retained.push(log);
  if (retained.length > MAX_AUDIT_LOGS) {
    archiveAuditLogs(retained.slice(0, retained.length - MAX_AUDIT_LOGS));
    entries.logs = retained.slice(-MAX_AUDIT_LOGS);
  } else {
    entries.logs = retained;
  }

  saveAuditLogs(entries);
}

function auditLog(eventType, actor, target, action, result, details = {}) {
  const log = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType: sanitizeAuditValue(eventType, 120),
    severity: AUDIT_EVENTS[eventType]?.severity || "info",
    actor: sanitizeAuditValue({
      username: actor?.username || "system",
      role: actor?.role || null,
      ip: actor?.ip || null,
      userAgent: actor?.userAgent || null,
    }),
    target: target ? sanitizeAuditValue(target) : null,
    action: sanitizeAuditValue(action, 120),
    result: result === "failure" || result === "partial" ? result : "success",
    details: sanitizeAuditValue(details),
  };

  appendAuditLog(log);
  if (log.severity === "critical" || log.severity === "error") {
    console.error(`[AUDIT ${log.severity.toUpperCase()}]`, log);
  }
  return log.id;
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
  const access = normalizeFolderAccessEntry(folder).users[req.user?.username];
  return Boolean(access?.read) || Boolean(access?.edit);
}

function canManageAccess(req) {
  return req.user?.role === "admin" || req.user?.permissions?.manageUsers;
}

function canViewAnalytics(req) {
  return canManageAccess(req) || Boolean(req.user?.permissions?.viewAnalytics);
}

function canViewAuditLogs(req) {
  return canManageAccess(req) || Boolean(req.user?.permissions?.viewAuditLogs);
}

function requireAnalyticsAccess(req, res, next) {
  if (!canViewAnalytics(req)) {
    return res.status(403).json({ error: "Permissao negada: viewAnalytics" });
  }

  next();
}

function requireAuditAccess(req, res, next) {
  if (!canViewAuditLogs(req)) {
    auditLog("file.access.denied", getAuditActor(req), { type: "audit", id: req.path }, "read", "failure", {
      reason: "missing_viewAuditLogs",
    });
    return res.status(403).json({ error: "Permissao negada: viewAuditLogs" });
  }

  next();
}

function canCreateFolders(req) {
  return canManageAccess(req) || Boolean(req.user?.permissions?.createFolders);
}

function hasFolderEditAccess(req, folder) {
  if (!folder || folder.isRoot || folder.id === ROOT_FOLDER_ID) return false;
  if (canManageAccess(req)) return true;
  if (folder.createdBy === req.user?.username) return true;
  return Boolean(normalizeFolderAccessEntry(folder).users[req.user?.username]?.edit);
}

function serializeFolderForUser(req, folder) {
  const access = normalizeFolderAccessEntry(folder);
  return {
    ...folder,
    owner: access.owner,
    users: access.users,
    allowedUsers: Object.entries(access.users)
      .filter(([, permission]) => permission.read || permission.edit)
      .map(([username]) => username),
    canEdit: hasFolderEditAccess(req, folder),
    canManageAccess: canManageAccess(req) || hasFolderEditAccess(req, folder),
  };
}

function normalizeAccessUsers(rawUsers = {}, legacyAllowedUsers = []) {
  const users = {};

  if (rawUsers && typeof rawUsers === "object" && !Array.isArray(rawUsers)) {
    for (const [username, access] of Object.entries(rawUsers)) {
      const cleanUsername = String(username || "").trim();
      if (!cleanUsername) continue;

      const canEdit = Boolean(access?.edit);
      const canRead = Boolean(access?.read) || canEdit;
      if (canRead || canEdit) {
        users[cleanUsername] = { read: canRead, edit: canEdit };
      }
    }
  }

  for (const username of legacyAllowedUsers) {
    users[username] = {
      read: true,
      edit: Boolean(users[username]?.edit),
    };
  }

  return users;
}

function normalizeFolderAccessEntry(folder = {}) {
  return {
    owner: folder.createdBy || "sistema",
    users: normalizeAccessUsers(folder.users, normalizeAllowedUsers(folder.allowedUsers)),
  };
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

function getFileVersionKey(folderId, fileName) {
  return `${folderId || ROOT_FOLDER_ID}/${path.basename(fileName || "")}`;
}

function getEncryptedFileKey(folderId, fileName) {
  return `${folderId || ROOT_FOLDER_ID}/${path.basename(fileName || "")}`;
}

function getEncryptedFileMetadata(folderId, fileName, entries = loadEncryptedFiles()) {
  return entries[getEncryptedFileKey(folderId, fileName)] || null;
}

function getStoredVersionName(fileName, version) {
  return `${path.basename(fileName || "")}.v${version}`;
}

function normalizeVersionHistory(entry) {
  const versions = Array.isArray(entry?.versions)
    ? entry.versions
        .map((version) => ({
          version: Number(version.version),
          storedAs: path.basename(version.storedAs || ""),
          uploadedBy: version.uploadedBy || "sistema",
          uploadedAt: version.uploadedAt || new Date().toISOString(),
          size: Number(version.size) || 0,
          comment: version.comment || "",
        }))
        .filter((version) => Number.isInteger(version.version) && version.version > 0 && version.storedAs)
    : [];
  const highestVersion = versions.reduce((max, version) => Math.max(max, version.version), 0);

  return {
    currentVersion: Number(entry?.currentVersion) || highestVersion || 0,
    versions,
  };
}

function getVersionHistory(folderId, fileName, entries = loadFileVersions()) {
  return normalizeVersionHistory(entries[getFileVersionKey(folderId, fileName)]);
}

function ensureVersionHistory(folder, fileName, uploadedBy = "sistema", comment = "Versao inicial") {
  const entries = loadFileVersions();
  const key = getFileVersionKey(folder.id, fileName);
  const history = normalizeVersionHistory(entries[key]);

  if (history.currentVersion && history.versions.length) {
    return { entries, key, history };
  }

  const currentPath = path.join(folder.uploadDir, fileName);
  if (!isExistingFile(currentPath)) {
    return { entries, key, history: { currentVersion: 0, versions: [] } };
  }

  const stats = fs.statSync(currentPath);
  const createdHistory = {
    currentVersion: 1,
    versions: [{
      version: 1,
      storedAs: fileName,
      uploadedBy,
      uploadedAt: stats.birthtime?.toISOString?.() || new Date().toISOString(),
      size: stats.size,
      comment,
    }],
  };

  entries[key] = createdHistory;
  saveFileVersions(entries);
  return { entries, key, history: createdHistory };
}

function pruneFileVersions(entries, key, folder) {
  const history = normalizeVersionHistory(entries[key]);
  let changed = false;

  while (history.versions.length > MAX_FILE_VERSIONS) {
    const removable = history.versions
      .filter((version) => version.version !== history.currentVersion)
      .sort((a, b) => a.version - b.version)[0];

    if (!removable) break;

    const storedPath = path.join(folder.uploadDir, removable.storedAs);
    if (removable.storedAs && removable.storedAs !== path.basename(key) && fs.existsSync(storedPath)) {
      fs.unlinkSync(storedPath);
    }
    if (removable.storedAs) deleteCloudFileLater(folder.id, removable.storedAs, "uploads");

    history.versions = history.versions.filter((version) => version.version !== removable.version);
    changed = true;
  }

  if (changed) entries[key] = history;
}

function recordApprovedFileVersion(folder, fileName, pendingPath, uploadedBy, comment = "") {
  const currentPath = path.join(folder.uploadDir, fileName);
  const exists = isExistingFile(currentPath);
  const initialComment = comment || "Versao inicial";

  if (!exists) {
    fs.renameSync(pendingPath, currentPath);
    ensureVersionHistory(folder, fileName, uploadedBy || "sistema", initialComment);
    return { currentVersion: 1, replaced: false };
  }

  const currentOwner = normalizeFilePermissionEntry(getFilePermissionEntry(folder.id, fileName)).owner;
  const { entries, key, history } = ensureVersionHistory(folder, fileName, currentOwner, "Versao inicial");
  const oldCurrentVersion = history.currentVersion || 1;
  const archivedName = getStoredVersionName(fileName, oldCurrentVersion);
  const archivedPath = path.join(folder.uploadDir, archivedName);

  fs.renameSync(currentPath, archivedPath);
  for (const version of history.versions) {
    if (version.version === oldCurrentVersion) {
      version.storedAs = archivedName;
      version.size = fs.statSync(archivedPath).size;
    }
  }

  fs.renameSync(pendingPath, currentPath);
  const stats = fs.statSync(currentPath);
  const newVersion = oldCurrentVersion + 1;
  history.currentVersion = newVersion;
  history.versions.push({
    version: newVersion,
    storedAs: fileName,
    uploadedBy: uploadedBy || "sistema",
    uploadedAt: new Date().toISOString(),
    size: stats.size,
    comment: comment || "",
  });

  entries[key] = history;
  pruneFileVersions(entries, key, folder);
  saveFileVersions(entries);
  return { currentVersion: newVersion, replaced: true };
}

function syncFileVersionsToCloud(folderId, fileName) {
  const folder = {
    id: folderId || ROOT_FOLDER_ID,
    uploadDir: getFolderStoragePath("./uploads", folderId || ROOT_FOLDER_ID),
  };
  const history = getVersionHistory(folder.id, fileName);
  const storedNames = new Set([
    path.basename(fileName || ""),
    ...history.versions.map((version) => path.basename(version.storedAs || "")).filter(Boolean),
  ]);

  for (const storedName of storedNames) {
    const storedPath = path.join(folder.uploadDir, storedName);
    if (isExistingFile(storedPath)) {
      syncCloudFireAndForget(uploadFileToCloud(storedPath, folder.id, storedName, "uploads"), `sync version ${folder.id}/${storedName}`);
    }
  }
}

function getVersionFilePath(folder, fileName, versionNumber) {
  const history = getVersionHistory(folder.id, fileName);
  const version = history.versions.find((item) => item.version === Number(versionNumber));
  if (!version) return null;

  return {
    history,
    version,
    filePath: path.join(folder.uploadDir, version.storedAs),
  };
}

function isStoredVersionFile(folderId, fileName, entries = loadFileVersions()) {
  const name = path.basename(fileName || "");

  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(`${folderId || ROOT_FOLDER_ID}/`)) continue;

    const history = normalizeVersionHistory(value);
    if (history.versions.some((version) => version.storedAs === name && version.version !== history.currentVersion)) {
      return true;
    }
  }

  return false;
}

function removeFileVersions(folderId, fileName) {
  const entries = loadFileVersions();
  const key = getFileVersionKey(folderId, fileName);
  const history = normalizeVersionHistory(entries[key]);
  const uploadDir = getFolderStoragePath("./uploads", folderId);

  for (const version of history.versions) {
    if (version.storedAs && version.storedAs !== fileName) {
      fs.rmSync(path.join(uploadDir, version.storedAs), { force: true });
      deleteCloudFileLater(folderId, version.storedAs, "uploads");
    }
  }

  if (entries[key]) {
    delete entries[key];
    saveFileVersions(entries);
  }
}

function getActionHistoryForFile(folderId, fileName, limit = 80) {
  const targetFolderId = folderId || ROOT_FOLDER_ID;
  const targetName = path.basename(fileName || "");

  if (!targetName) return [];

  return loadActionHistory()
    .filter((entry) => {
      const details = entry.details || {};
      const entryFolderId = details.folderId || details.toFolderId || details.fromFolderId || ROOT_FOLDER_ID;
      const sameFolder = entryFolderId === targetFolderId ||
        details.toFolderId === targetFolderId ||
        details.fromFolderId === targetFolderId;
      const names = [
        entry.fileName,
        details.oldName,
        details.newName,
        details.originalName,
      ].filter(Boolean).map((name) => path.basename(String(name)));

      return sameFolder && names.includes(targetName);
    })
    .slice(0, limit);
}

function renameFileVersions(folderId, oldName, newName) {
  const entries = loadFileVersions();
  const oldKey = getFileVersionKey(folderId, oldName);
  const newKey = getFileVersionKey(folderId, newName);
  const history = normalizeVersionHistory(entries[oldKey]);
  if (!entries[oldKey]) return;

  const uploadDir = getFolderStoragePath("./uploads", folderId);
  for (const version of history.versions) {
    const nextStoredAs = version.version === history.currentVersion
      ? newName
      : getStoredVersionName(newName, version.version);

    if (version.storedAs !== oldName && version.storedAs !== nextStoredAs) {
      const oldVersionPath = path.join(uploadDir, version.storedAs);
      const newVersionPath = path.join(uploadDir, nextStoredAs);
      if (fs.existsSync(oldVersionPath)) fs.renameSync(oldVersionPath, newVersionPath);
    }

    version.storedAs = nextStoredAs;
  }

  entries[newKey] = history;
  delete entries[oldKey];
  saveFileVersions(entries);
}

function moveFileVersions(oldFolderId, oldName, newFolderId, newName) {
  const entries = loadFileVersions();
  const oldKey = getFileVersionKey(oldFolderId, oldName);
  const newKey = getFileVersionKey(newFolderId, newName);
  const history = normalizeVersionHistory(entries[oldKey]);
  if (!entries[oldKey]) return;

  const oldUploadDir = getFolderStoragePath("./uploads", oldFolderId);
  const newUploadDir = getFolderStoragePath("./uploads", newFolderId);
  if (!fs.existsSync(newUploadDir)) fs.mkdirSync(newUploadDir, { recursive: true });

  for (const version of history.versions) {
    const nextStoredAs = version.version === history.currentVersion
      ? newName
      : getStoredVersionName(newName, version.version);

    if (version.storedAs !== oldName) {
      const oldVersionPath = path.join(oldUploadDir, version.storedAs);
      const newVersionPath = path.join(newUploadDir, nextStoredAs);
      if (fs.existsSync(oldVersionPath)) fs.renameSync(oldVersionPath, newVersionPath);
    }

    version.storedAs = nextStoredAs;
  }

  entries[newKey] = history;
  delete entries[oldKey];
  saveFileVersions(entries);
}

function removeFileVersionsForFolder(folderId) {
  const entries = loadFileVersions();
  let changed = false;

  for (const key of Object.keys(entries)) {
    if (entries[key]?.folderId === folderId || key.startsWith(`${folderId}/`)) {
      delete entries[key];
      changed = true;
    }
  }

  if (changed) saveFileVersions(entries);
}

function cleanupOpenFileTokens() {
  const now = Date.now();

  for (const [token, entry] of openFileTokens.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) {
      openFileTokens.delete(token);
    }
  }
}

function createOpenFileToken(folderId, fileName, options = {}) {
  cleanupOpenFileTokens();
  const token = crypto.randomBytes(24).toString("hex");
  openFileTokens.set(token, {
    folderId,
    fileName,
    filePath: options.filePath || null,
    downloadName: options.downloadName || fileName,
    cloudFileName: options.cloudFileName || path.basename(options.filePath || fileName),
    expiresAt: Date.now() + OPEN_FILE_TOKEN_TTL_MS,
  });
  return token;
}

function getFileContentDisposition(fileName, dispositionType = "inline") {
  const fallbackName = path.basename(fileName || "arquivo")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const safeDisposition = dispositionType === "attachment" ? "attachment" : "inline";

  return `${safeDisposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function getMimeType(fileName) {
  const extension = path.extname(fileName || "").toLowerCase();
  const types = {
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".zip": "application/zip",
    ".exe": "application/octet-stream",
    ".msi": "application/octet-stream",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };

  return types[extension] || "application/octet-stream";
}

function getServerMasterKey() {
  const envKey = process.env.SERVER_MASTER_KEY;
  if (envKey) {
    const cleanKey = envKey.trim();
    if (/^[a-f0-9]{64}$/i.test(cleanKey)) return Buffer.from(cleanKey, "hex");
    const decoded = Buffer.from(cleanKey, "base64");
    if (decoded.length === 32) return decoded;
    throw new Error("SERVER_MASTER_KEY precisa ter 32 bytes em hex ou base64");
  }

  if (!fs.existsSync(SERVER_MASTER_KEY_FILE)) {
    const masterKey = crypto.randomBytes(32);
    fs.writeFileSync(SERVER_MASTER_KEY_FILE, masterKey.toString("hex"), { mode: 0o600 });
    console.warn("[security] Nova chave mestra gerada em data/server-master.key. Faca backup seguro imediatamente.");
    return masterKey;
  }

  return Buffer.from(fs.readFileSync(SERVER_MASTER_KEY_FILE, "utf-8").trim(), "hex");
}

function deriveKeyFromPassword(password, salt = null) {
  const effectiveSalt = salt || crypto.randomBytes(16);
  return {
    key: crypto.pbkdf2Sync(String(password || ""), effectiveSalt, ENCRYPTION_ITERATIONS, 32, "sha256"),
    salt: effectiveSalt,
  };
}

function getUserEncryptionKey(username) {
  const serverSecret = getServerMasterKey();
  const userSalt = crypto.createHash("sha256").update(`${username || "sistema"}:rootark-user-key`).digest();
  return crypto.pbkdf2Sync(serverSecret, userSalt, ENCRYPTION_ITERATIONS, 32, "sha256");
}

function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return { encrypted, iv, authTag: cipher.getAuthTag() };
}

function decryptBuffer(buffer, key, iv, authTag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function resolveEncryptionKeys(level, req, password, metadata = null) {
  const owner = metadata?.accessControl?.owner || metadata?.uploadedBy || req.user?.username;
  if (level === "server-key") return [{ key: getServerMasterKey(), type: "server" }];
  if (level === "user-key") return [{ key: getUserEncryptionKey(owner), type: "user" }];
  if (level === "password") {
    if (!password || String(password).length < 8) throw new Error("Senha obrigatoria com no minimo 8 caracteres");
    const salt = metadata?.salt ? Buffer.from(metadata.salt, "hex") : null;
    const derived = deriveKeyFromPassword(password, salt);
    return [{ key: derived.key, type: "password", salt: derived.salt }];
  }
  if (level === "dual") {
    if (!password || String(password).length < 8) throw new Error("Senha obrigatoria com no minimo 8 caracteres");
    const salt = metadata?.salt ? Buffer.from(metadata.salt, "hex") : null;
    const derived = deriveKeyFromPassword(password, salt);
    return [
      { key: getServerMasterKey(), type: "server" },
      { key: derived.key, type: "password", salt: derived.salt },
    ];
  }
  return [];
}

function encryptFileInPlace(filePath, options) {
  const level = options.encryptionLevel || "none";
  if (level === "none") return null;
  if (!ENCRYPTION_LEVELS[level]) throw new Error("Nivel de criptografia invalido");
  const expiresInDays = options.expiresInDays ? Number(options.expiresInDays) : null;
  if (options.expiresInDays && (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 365)) {
    throw new Error("Expiracao criptografada invalida");
  }

  let buffer = fs.readFileSync(filePath);
  const layers = [];
  const keys = resolveEncryptionKeys(level, options.req, options.password);

  for (const layer of keys) {
    const encrypted = encryptBuffer(buffer, layer.key);
    buffer = encrypted.encrypted;
    layers.push({
      type: layer.type,
      iv: encrypted.iv.toString("hex"),
      authTag: encrypted.authTag.toString("hex"),
    });
    if (layer.salt) layers[layers.length - 1].salt = layer.salt.toString("hex");
  }

  fs.writeFileSync(filePath, buffer);
  return {
    originalFilename: options.originalName,
    fileName: options.fileName,
    folderId: options.folderId,
    uploadedBy: options.req.user.username,
    uploadedAt: new Date().toISOString(),
    size: options.originalSize,
    encryptedSize: buffer.length,
    encryptionLevel: level,
    algorithm: "aes-256-gcm",
    keyDerivation: level === "password" || level === "dual" ? "pbkdf2" : null,
    iterations: level === "password" || level === "dual" ? ENCRYPTION_ITERATIONS : null,
    salt: layers.find((layer) => layer.salt)?.salt || null,
    layers,
    accessControl: {
      owner: options.req.user.username,
      authorizedUsers: [options.req.user.username],
      requiresPassword: level === "password" || level === "dual",
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null,
    },
    metadata: {
      mimeType: options.mimeType || getMimeType(options.originalName),
      isEncrypted: true,
      canPreview: false,
    },
  };
}

function decryptEncryptedFileBuffer(encryptedBuffer, metadata, req, password) {
  let buffer = encryptedBuffer;
  const layers = Array.isArray(metadata.layers) ? metadata.layers.slice().reverse() : [];

  for (const layer of layers) {
    let key;
    if (layer.type === "server") key = getServerMasterKey();
    if (layer.type === "user") key = getUserEncryptionKey(metadata.accessControl?.owner || metadata.uploadedBy);
    if (layer.type === "password") {
      if (!password) throw new Error("Senha obrigatoria");
      key = deriveKeyFromPassword(password, Buffer.from(layer.salt || metadata.salt, "hex")).key;
    }
    if (!key) throw new Error("Camada de criptografia invalida");
    buffer = decryptBuffer(buffer, key, layer.iv, layer.authTag);
  }

  return buffer;
}

function getEncryptedAuthorizedUsers(metadata) {
  const users = new Set(metadata?.accessControl?.authorizedUsers || []);
  const owner = metadata?.accessControl?.owner || metadata?.uploadedBy;
  if (owner) users.add(owner);
  return users;
}

function canAccessEncryptedFile(req, metadata) {
  if (!metadata) return true;
  if (req.user?.role === "admin") return true;

  const level = metadata.encryptionLevel || "server-key";
  if (level === "server-key" || level === "password") {
    return true;
  }

  if (level === "user-key" || level === "dual") {
    return getEncryptedAuthorizedUsers(metadata).has(req.user?.username);
  }

  return false;
}

function saveEncryptedMetadata(folderId, fileName, metadata) {
  const entries = loadEncryptedFiles();
  entries[getEncryptedFileKey(folderId, fileName)] = metadata;
  saveEncryptedFiles(entries);
}

function removeEncryptedMetadata(folderId, fileName) {
  const entries = loadEncryptedFiles();
  const key = getEncryptedFileKey(folderId, fileName);
  if (!entries[key]) return;
  delete entries[key];
  saveEncryptedFiles(entries);
}

function renameEncryptedMetadata(folderId, oldName, newName) {
  const entries = loadEncryptedFiles();
  const oldKey = getEncryptedFileKey(folderId, oldName);
  const newKey = getEncryptedFileKey(folderId, newName);
  if (!entries[oldKey]) return;
  entries[newKey] = { ...entries[oldKey], fileName: newName };
  delete entries[oldKey];
  saveEncryptedFiles(entries);
}

function moveEncryptedMetadata(oldFolderId, oldName, newFolderId, newName) {
  const entries = loadEncryptedFiles();
  const oldKey = getEncryptedFileKey(oldFolderId, oldName);
  const newKey = getEncryptedFileKey(newFolderId, newName);
  if (!entries[oldKey]) return;
  entries[newKey] = { ...entries[oldKey], folderId: newFolderId, fileName: newName };
  delete entries[oldKey];
  saveEncryptedFiles(entries);
}

function removeEncryptedMetadataForFolder(folderId) {
  const entries = loadEncryptedFiles();
  let changed = false;
  for (const key of Object.keys(entries)) {
    if (entries[key]?.folderId === folderId || key.startsWith(`${folderId}/`)) {
      delete entries[key];
      changed = true;
    }
  }
  if (changed) saveEncryptedFiles(entries);
}

function getPublicEncryptionMetadata(metadata) {
  if (!metadata) return null;
  return {
    isEncrypted: true,
    encryptionLevel: metadata.encryptionLevel,
    originalFilename: metadata.originalFilename,
    requiresPassword: Boolean(metadata.accessControl?.requiresPassword),
    expiresAt: metadata.accessControl?.expiresAt || null,
    canPreview: false,
    owner: metadata.accessControl?.owner || metadata.uploadedBy,
  };
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !String(rangeHeader).startsWith("bytes=")) return null;

  const range = String(rangeHeader).replace("bytes=", "").split(",")[0].trim();
  const [rawStart, rawEnd] = range.split("-");
  let start;
  let end;

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function sendOptimizedFile(req, res, filePath, downloadName, dispositionType = "inline", options = {}) {
  const stats = fs.statSync(filePath);
  const size = stats.size;
  const safeName = path.basename(downloadName || path.basename(filePath));
  const range = parseRangeHeader(req.headers.range, size);
  const cacheControl = options.cacheControl || "private, max-age=3600";
  const highWaterMark = Number(options.highWaterMark) || 1024 * 1024;

  if (range?.invalid) {
    res.writeHead(416, {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
    });
    res.end();
    return;
  }

  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Type": options.contentType || getMimeType(safeName),
    "Content-Disposition": getFileContentDisposition(safeName, dispositionType),
    "X-Content-Type-Options": "nosniff",
  };

  const streamOptions = { highWaterMark };
  let statusCode = 200;
  let headers = {
    ...commonHeaders,
    "Content-Length": size,
  };

  if (range) {
    statusCode = 206;
    streamOptions.start = range.start;
    streamOptions.end = range.end;
    headers = {
      ...commonHeaders,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": range.end - range.start + 1,
    };
  }

  res.writeHead(statusCode, headers);
  const stream = fs.createReadStream(filePath, streamOptions);

  stream.on("error", (error) => {
    console.error("Erro ao transmitir arquivo:", error.message);
    if (!res.headersSent) res.status(500).end("Erro ao transmitir arquivo");
    else res.destroy(error);
  });

  req.on("close", () => {
    if (!res.writableEnded) stream.destroy();
  });

  stream.pipe(res);
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

  const folderUsers = normalizeFolderAccessEntry(folder).users;

  return users.filter((user) => (
    user.role === "admin" ||
    user.permissions?.manageUsers ||
    folder.createdBy === user.username ||
    Boolean(folderUsers[user.username]?.read) ||
    Boolean(folderUsers[user.username]?.edit)
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

function removeUserFromFolderPermissions(username) {
  const folders = loadFolders();
  let changed = false;

  for (const folder of folders) {
    if (Array.isArray(folder.allowedUsers)) {
      const nextUsers = folder.allowedUsers.filter((user) => user !== username);
      if (nextUsers.length !== folder.allowedUsers.length) {
        folder.allowedUsers = nextUsers;
        changed = true;
      }
    }

    if (folder.users && typeof folder.users === "object" && folder.users[username]) {
      delete folder.users[username];
      folder.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) saveFolders(folders);
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
  removeFileVersionsForFolder(folderId);
  removeEncryptedMetadataForFolder(folderId);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
  deleteCloudFolderLater(folderId);
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

      deleteCloudFileLater(folderId, fileName, "uploads");
      removePublicLinksForFile(fileName, folderId);
      removeFilePermission(folderId, fileName);
      removeFileVersions(folderId, fileName);
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

function isSafeChildPath(baseDir, targetPath) {
  const basePath = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === basePath || resolvedTarget.startsWith(`${basePath}${path.sep}`);
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

function getAvailableUploadFileName(originalName, folderId = ROOT_FOLDER_ID, allowExistingPublic = false) {
  const shortenedName = shortenFileName(originalName);
  const extension = path.extname(shortenedName);
  const baseName = path.basename(shortenedName, extension);
  let candidate = shortenedName;
  let counter = 1;
  const uploadDir = getFolderStoragePath("./uploads", folderId);
  const tempDir = getFolderStoragePath("./temp", folderId);

  while (
    fs.existsSync(path.join(tempDir, candidate)) ||
    (!allowExistingPublic && fs.existsSync(path.join(uploadDir, candidate)))
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

function isGzipFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(2);
    fs.readSync(fd, buffer, 0, 2, 0);
    fs.closeSync(fd);
    return buffer[0] === 0x1f && buffer[1] === 0x8b;
  } catch {
    return false;
  }
}

async function decompressUploadedFileIfNeeded(req) {
  const compression = String(req.body?.rootarkCompression || req.query?.rootarkCompression || "").toLowerCase();
  if (!req.file?.path) return false;

  const extension = path.extname(req.file.originalname || req.file.filename || "").toLowerCase();
  const hasGzipHeader = isGzipFile(req.file.path);
  const shouldDecompress = compression === "gzip" || (hasGzipHeader && extension !== ".gz");
  if (!shouldDecompress) return false;

  if (!hasGzipHeader) {
    throw new Error("Upload marcado como compactado, mas o arquivo nao esta em gzip");
  }

  const compressedPath = req.file.path;
  const outputPath = `${compressedPath}.decompressed`;

  try {
    await pipeline(
      fs.createReadStream(compressedPath),
      zlib.createGunzip(),
      fs.createWriteStream(outputPath)
    );
    fs.rmSync(compressedPath, { force: true });
    fs.renameSync(outputPath, compressedPath);
    req.file.size = fs.statSync(compressedPath).size;
    return true;
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw new Error("Nao foi possivel descompactar o upload");
  }
}

async function repairCompressedTempUploads(directory = path.resolve("./temp")) {
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await repairCompressedTempUploads(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() === ".gz") continue;
    if (!isGzipFile(fullPath)) continue;

    const outputPath = `${fullPath}.repair`;
    try {
      await pipeline(
        fs.createReadStream(fullPath),
        zlib.createGunzip(),
        fs.createWriteStream(outputPath)
      );
      fs.rmSync(fullPath, { force: true });
      fs.renameSync(outputPath, fullPath);
      console.log(`[upload-repair] Arquivo temporario descompactado: ${fullPath}`);
    } catch (error) {
      fs.rmSync(outputPath, { force: true });
      fs.rmSync(fullPath, { force: true });
      console.error(`[upload-repair] Falha ao recuperar ${fullPath}:`, error.message);
    }
  }
}

function cleanupOrphanTempUploads(directory = path.resolve("./temp")) {
  if (!fs.existsSync(directory)) return;

  const pendingUploads = loadPendingUploads();
  const pendingNames = new Set();
  for (const [key, entry] of Object.entries(pendingUploads)) {
    const folderId = entry?.folderId || (String(key).includes("/") ? String(key).split("/")[0] : ROOT_FOLDER_ID);
    const fileName = path.basename(entry?.fileName || key);
    pendingNames.add(path.join(getFolderStoragePath("./temp", folderId), fileName));
  }

  const now = Date.now();
  const walk = (currentDir) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (fullPath.startsWith(CHUNK_UPLOAD_DIR)) continue;
      if (fullPath.startsWith(SIMPLE_UPLOAD_INCOMING_DIR)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (pendingNames.has(path.resolve(fullPath))) continue;

      const stats = fs.statSync(fullPath);
      if (now - stats.mtimeMs > 30 * 1000) {
        fs.rmSync(fullPath, { force: true });
      }
    }
  };

  walk(directory);
}

function cleanupIncomingUploads() {
  for (const directory of [SIMPLE_UPLOAD_INCOMING_DIR, path.join(CHUNK_UPLOAD_DIR, "incoming")]) {
    if (!fs.existsSync(directory)) continue;

    const now = Date.now();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (!entry.isFile()) continue;

      const stats = fs.statSync(fullPath);
      if (now - stats.mtimeMs > 5 * 60 * 1000) {
        fs.rmSync(fullPath, { force: true });
      }
    }
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

async function ensurePreviewAccess(req, res, scope, rawName, rawFolderId = ROOT_FOLDER_ID) {
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

  if (getEncryptedFileMetadata(target.folderId, target.name)) {
    res.status(403).json({ error: "Preview indisponivel para arquivos criptografados" });
    return null;
  }

  await ensureCloudFileCached(target.folderId, target.name, target.filePath, target.isPending ? "temp" : "uploads");
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

function getDirectorySize(directory) {
  if (!fs.existsSync(directory)) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }

  return total;
}

function getMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function getDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function getUploadsByMonth(months = 6) {
  const analytics = loadAnalytics();
  const count = Math.min(Math.max(Number(months) || 6, 1), 24);
  const result = [];
  const now = new Date();

  for (let index = count - 1; index >= 0; index -= 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - index + 1, 1);
    const uploads = analytics.uploads.filter((upload) => {
      const date = new Date(upload.uploadedAt);
      return date >= monthStart && date < monthEnd;
    });

    result.push({
      month: getMonthKey(monthStart),
      count: uploads.length,
      totalSize: uploads.reduce((sum, upload) => sum + (Number(upload.size) || 0), 0),
    });
  }

  return result;
}

function getUploadsByUser(limit = 10) {
  const analytics = loadAnalytics();
  const totals = {};

  for (const upload of analytics.uploads) {
    const username = upload.uploadedBy || "desconhecido";
    if (!totals[username]) totals[username] = { username, count: 0, totalSize: 0 };
    totals[username].count += 1;
    totals[username].totalSize += Number(upload.size) || 0;
  }

  return Object.values(totals)
    .sort((a, b) => b.count - a.count || b.totalSize - a.totalSize)
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

function getActiveUsers(days = 30) {
  const analytics = loadAnalytics();
  const count = Math.min(Math.max(Number(days) || 30, 1), 365);
  const result = [];
  const byDay = {};

  for (let index = count - 1; index >= 0; index -= 1) {
    const day = new Date(Date.now() - index * 24 * 60 * 60 * 1000);
    byDay[getDayKey(day)] = new Set();
  }

  for (const login of analytics.logins) {
    const date = new Date(login.loginAt);
    const key = Number.isFinite(date.getTime()) ? getDayKey(date) : "";
    if (byDay[key]) byDay[key].add(login.username);
  }

  for (const [date, users] of Object.entries(byDay)) {
    result.push({ date, uniqueUsers: users.size });
  }

  return result;
}

function getFileTypes() {
  const analytics = loadAnalytics();
  const totals = {};

  for (const upload of analytics.uploads) {
    const extension = path.extname(upload.filename || "").toLowerCase() || "sem extensao";
    if (!totals[extension]) totals[extension] = { extension, count: 0, totalSize: 0 };
    totals[extension].count += 1;
    totals[extension].totalSize += Number(upload.size) || 0;
  }

  return Object.values(totals).sort((a, b) => b.count - a.count || b.totalSize - a.totalSize);
}

function getMostDownloadedFiles(limit = 10) {
  const analytics = loadAnalytics();
  const totals = {};

  for (const download of analytics.downloads) {
    const filename = download.filename || "arquivo";
    if (!totals[filename]) totals[filename] = { filename, downloads: 0 };
    totals[filename].downloads += 1;
  }

  return Object.values(totals)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

function getAnalyticsSummary() {
  if (analyticsSummaryCache && analyticsSummaryCache.expiresAt > Date.now()) {
    return analyticsSummaryCache.value;
  }

  const analytics = loadAnalytics();
  const today = getDayKey(new Date());
  const currentMonth = getMonthKey(new Date());
  const activeToday = new Set(
    analytics.logins
      .filter((login) => String(login.loginAt || "").startsWith(today))
      .map((login) => login.username)
  );
  const uploadsThisMonth = analytics.uploads.filter((upload) => String(upload.uploadedAt || "").startsWith(currentMonth));
  const topUser = getUploadsByUser(1)[0]?.username || "";
  const topDownload = getMostDownloadedFiles(1)[0]?.filename || "";
  const pendingUploads = loadPendingUploads();

  const summary = {
    totalUploads: analytics.uploads.length,
    totalDownloads: analytics.downloads.length,
    totalUsers: loadUsers().length,
    activeUsersToday: activeToday.size,
    storageUsed: getDirectorySize("./uploads"),
    pendingApprovals: Object.keys(pendingUploads).length,
    uploadsThisMonth: uploadsThisMonth.length,
    mostActiveUser: topUser,
    mostDownloadedFile: topDownload,
  };

  analyticsSummaryCache = {
    value: summary,
    expiresAt: Date.now() + ANALYTICS_SUMMARY_CACHE_MS,
  };
  return summary;
}

function getRecentAnalyticsEvents(limit = 20) {
  const analytics = loadAnalytics();
  const events = [
    ...analytics.uploads.map((item) => ({
      type: "upload",
      username: item.uploadedBy,
      filename: item.filename,
      timestamp: item.uploadedAt,
    })),
    ...analytics.downloads.map((item) => ({
      type: "download",
      username: item.downloadedBy,
      filename: item.filename,
      timestamp: item.downloadedAt,
    })),
    ...analytics.logins.map((item) => ({
      type: "login",
      username: item.username,
      filename: "",
      timestamp: item.loginAt,
    })),
    ...analytics.deletions.map((item) => ({
      type: "delete",
      username: item.deletedBy,
      filename: item.filename,
      timestamp: item.deletedAt,
    })),
    ...analytics.approvals.map((item) => ({
      type: "approval",
      username: item.approvedBy,
      filename: item.filename,
      timestamp: item.approvedAt,
    })),
    ...analytics.rejections.map((item) => ({
      type: "rejection",
      username: item.rejectedBy,
      filename: item.filename,
      timestamp: item.rejectedAt,
    })),
    ...analytics.restores.map((item) => ({
      type: "restore",
      username: item.restoredBy,
      filename: item.filename,
      timestamp: item.restoredAt,
    })),
    ...analytics.versionDeletions.map((item) => ({
      type: "versionDeletion",
      username: item.deletedBy,
      filename: item.filename,
      timestamp: item.deletedAt,
    })),
  ].filter((event) => Number.isFinite(new Date(event.timestamp).getTime()));

  return events
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100));
}

function getNestedValue(item, key) {
  return String(key).split(".").reduce((value, part) => value?.[part], item);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = getNestedValue(item, key) || "desconhecido";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function findSuspiciousIPs(logs) {
  return Object.entries(countBy(logs.filter((log) => log.eventType === "auth.login.failed"), "actor.ip"))
    .filter(([, count]) => count >= 5)
    .map(([ip, failedAttempts]) => ({ ip, failedAttempts }));
}

function getFilteredAuditLogs(query = {}) {
  let logs = loadAuditLogs().logs;
  const { eventType, username, startDate, endDate, severity, result } = query;

  if (eventType) logs = logs.filter((log) => log.eventType === eventType);
  if (username) logs = logs.filter((log) => log.actor?.username === username);
  if (severity) logs = logs.filter((log) => log.severity === severity);
  if (result) logs = logs.filter((log) => log.result === result);
  if (startDate) logs = logs.filter((log) => new Date(log.timestamp) >= new Date(startDate));
  if (endDate) logs = logs.filter((log) => new Date(log.timestamp) <= new Date(`${endDate}T23:59:59.999Z`));

  return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function convertAuditLogsToCSV(logs) {
  const headers = ["ID", "Timestamp", "Event Type", "Severity", "Username", "Role", "IP", "Action", "Result", "Target", "Details"];
  const rows = logs.map((log) => [
    log.id,
    log.timestamp,
    log.eventType,
    log.severity,
    log.actor?.username,
    log.actor?.role,
    log.actor?.ip,
    log.action,
    log.result,
    log.target ? `${log.target.type || ""}:${log.target.id || ""}` : "",
    JSON.stringify(log.details || {}),
  ].map(csvCell).join(","));

  return `${headers.map(csvCell).join(",")}\n${rows.join("\n")}`;
}

function checkAnomalies(req, username) {
  const logs = loadAuditLogs().logs;
  const since = Date.now() - 60 * 60 * 1000;
  const recent = logs.filter((log) => (
    log.actor?.username === username &&
    new Date(log.timestamp).getTime() >= since
  ));
  const ips = [...new Set(recent.map((log) => log.actor?.ip).filter(Boolean))];
  const failedAttempts = recent.filter((log) => log.eventType === "auth.login.failed").length;

  if (ips.length > 3) {
    auditLog("system.anomaly.detected", { username: "system" }, { type: "user", id: username }, "flagged", "partial", {
      reason: "multiple_ips",
      count: ips.length,
      ips,
    });
  }

  if (failedAttempts >= 3) {
    auditLog("system.anomaly.detected", { username: "system" }, { type: "user", id: username }, "flagged", "partial", {
      reason: "bruteforce_pattern",
      failedAttempts,
      ip: getAuditActor(req, username).ip,
    });
  }
}

function initData() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync("./temp")) fs.mkdirSync("./temp");
  if (!fs.existsSync(CHUNK_UPLOAD_DIR)) fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(SIMPLE_UPLOAD_INCOMING_DIR)) fs.mkdirSync(SIMPLE_UPLOAD_INCOMING_DIR, { recursive: true });
  if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
  if (!fs.existsSync(PENDING_UPLOADS_FILE)) savePendingUploads({});
  if (!fs.existsSync(PUBLIC_LINKS_FILE)) savePublicLinks({});
  if (!fs.existsSync(ACTION_HISTORY_FILE)) saveActionHistory([]);
  if (!fs.existsSync(FOLDERS_FILE)) saveFolders(getDefaultFolders());
  if (!fs.existsSync(FILE_PERMISSIONS_FILE)) saveFilePermissions({});
  if (!fs.existsSync(FILE_EXPIRATIONS_FILE)) saveFileExpirations({});
  if (!fs.existsSync(FILE_VERSIONS_FILE)) saveFileVersions({});
  if (!fs.existsSync(ENCRYPTED_FILES_FILE)) saveEncryptedFiles({});
  if (!fs.existsSync(ANALYTICS_FILE)) saveAnalytics(getDefaultAnalytics());
  if (!fs.existsSync(AUDIT_LOGS_FILE)) saveAuditLogs(getDefaultAuditLogs());

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

app.set("trust proxy", true);
app.use(express.json());
app.use((req, res, next) => {
  if (req.path === "/" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});
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

function authenticateRealtimeToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

wss.on("connection", (socket, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const user = authenticateRealtimeToken(params.get("token"));

  if (!user) {
    sendRealtime(socket, "auth:error", { message: "Token invalido ou expirado" });
    socket.close(1008, "Token invalido");
    return;
  }

  socket.user = user;
  sendRealtime(socket, "connected", { username: user.username });

  socket.on("message", (rawMessage) => {
    let message = {};
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (message.event === "ping") {
      sendRealtime(socket, "pong", {});
    }
  });
});

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user?.permissions?.[permission]) {
      return res.status(403).json({ error: `Permissao negada: ${permission}` });
    }
    next();
  };
}

app.get("/storage/status", authenticate, requirePermission("manageUsers"), (req, res) => {
  res.json(getCloudStorageStatus());
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Usuario e senha obrigatorios" });
  }

  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    auditLog("auth.login.failed", getAuditActor(req, username || "unknown_user"), {
      type: "auth",
      id: username || "unknown_user",
    }, "attempted", "failure", {
      reason: "invalid_credentials",
      attemptedUsername: username || "",
    });
    return res.status(401).json({ error: "Credenciais invalidas" });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role, permissions: normalizeUserPermissions(user) },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  logAnalyticsEvent("login", {
    username: user.username,
    ip: getAuditActor(req, user.username).ip,
  });
  auditLog("auth.login.success", getAuditActor(req, user.username), { type: "user", id: user.username }, "authenticated", "success", {
    username: user.username,
    role: user.role,
    tokenExpiry: "8h",
  });
  checkAnomalies(req, user.username);

  res.json({ token, username: user.username, role: user.role, permissions: normalizeUserPermissions(user) });
});

app.get("/auth/me", authenticate, (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    permissions: normalizeUserPermissions(req.user),
  });
});

app.get("/users", authenticate, requirePermission("manageUsers"), (req, res) => {
  const users = loadUsers().map(({ password, ...rest }) => ({
    ...rest,
    permissions: normalizeUserPermissions(rest),
  }));
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
    ...getBasePermissions(),
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
  auditLog("user.created", getAuditActor(req), { type: "user", id: username }, "created", "success", {
    role: role || "user",
    permissions: finalPermissions,
  });
  res.status(201).json({ message: "Usuario criado" });
});

app.put("/users/:username", authenticate, requirePermission("manageUsers"), (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: "Usuario nao encontrado" });

  if (req.params.username === req.user.username && req.body.permissions?.manageUsers === false) {
    return res.status(400).json({ error: "Voce nao pode revogar sua propria permissao manageUsers" });
  }

  const before = JSON.parse(JSON.stringify(users[idx]));
  const { password, role, permissions } = req.body;
  if (password) users[idx].password = bcrypt.hashSync(password, 10);
  if (role) users[idx].role = role;
  if (permissions) users[idx].permissions = { ...users[idx].permissions, ...permissions };
  users[idx].permissions = normalizeUserPermissions(users[idx]);

  saveUsers(users);
  const changes = {};
  if (role && before.role !== users[idx].role) changes.role = { from: before.role, to: users[idx].role };
  if (password) changes.password = { from: "changed", to: "changed" };
  if (permissions) {
    for (const [key, value] of Object.entries(permissions)) {
      if (before.permissions?.[key] !== value) {
        changes[`permissions.${key}`] = { from: Boolean(before.permissions?.[key]), to: Boolean(value) };
      }
    }
  }
  auditLog(
    permissions ? "user.permission.changed" : password ? "user.password.changed" : "user.updated",
    getAuditActor(req),
    { type: "user", id: req.params.username },
    "modified",
    "success",
    { changes, modifiedBy: req.user.username }
  );

  const { password: _, ...updated } = users[idx];
  res.json({ message: "Usuario atualizado", user: updated });
});

app.delete("/users/:username", authenticate, requirePermission("manageUsers"), (req, res) => {
  if (req.params.username === req.user.username) {
    auditLog("user.deleted", getAuditActor(req), { type: "user", id: req.params.username }, "attempted", "failure", {
      reason: "cannot_delete_self",
    });
    return res.status(400).json({ error: "Voce nao pode excluir a si mesmo" });
  }

  const users = loadUsers();
  const filtered = users.filter((u) => u.username !== req.params.username);
  if (filtered.length === users.length) {
    return res.status(404).json({ error: "Usuario nao encontrado" });
  }

  saveUsers(filtered);
  removeUserFromFilePermissions(req.params.username);
  removeUserFromFolderPermissions(req.params.username);
  auditLog("user.deleted", getAuditActor(req), { type: "user", id: req.params.username }, "deleted", "success", {
    deletedBy: req.user.username,
  });
  res.json({ message: "Usuario excluido" });
});

app.get("/file-access", authenticate, (req, res) => {
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

  if (!canManageAccess(req) && !hasFileEditAccess(req, folder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
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

app.put("/file-access", authenticate, (req, res) => {
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

  if (!canManageAccess(req) && !hasFileEditAccess(req, folder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
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
    fs.mkdirSync(SIMPLE_UPLOAD_INCOMING_DIR, { recursive: true });
    cb(null, SIMPLE_UPLOAD_INCOMING_DIR);
  },
  filename: (req, file, cb) => {
    try {
      req.uploadFinalFileName = getAvailableUploadFileName(file.originalname, req.uploadFolder?.id || ROOT_FOLDER_ID, true);
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.upload`);
    } catch (error) {
      cb(error);
    }
  },
});

const upload = multer({ storage });
const chunkUpload = multer({ dest: path.join(CHUNK_UPLOAD_DIR, "incoming") });

function rejectLargeSingleUpload(req, res, next) {
  const contentLength = Number(req.headers["content-length"]) || 0;
  if (contentLength > SINGLE_UPLOAD_MAX_BYTES + 1024 * 512) {
    return res.status(413).json({
      error: "Arquivo grande demais para upload simples. Recarregue a pagina para usar o upload em blocos.",
      useChunkedUpload: true,
      maxSingleUploadBytes: SINGLE_UPLOAD_MAX_BYTES,
    });
  }

  next();
}

function handleUploadSingle(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (req.file?.path) {
      fs.rmSync(req.file.path, { force: true });
    }

    res.status(400).json({ error: error.message || "Upload nao concluido" });
  });
}

function handleChunkUploadSingle(req, res, next) {
  chunkUpload.single("chunk")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (req.file?.path) {
      fs.rmSync(req.file.path, { force: true });
    }

    res.status(400).json({ error: error.message || "Upload do bloco nao concluido" });
  });
}

function prepareUploadFolder(req, res, next) {
  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  req.uploadFolder = folder;
  next();
}

app.get("/folders", authenticate, (req, res) => {
  const folders = loadFolders()
    .filter((folder) => hasFolderAccess(req, folder))
    .map((folder) => serializeFolderForUser(req, folder));
  res.json(folders);
});

app.post("/folders", authenticate, (req, res) => {
  if (!canCreateFolders(req)) {
    return res.status(403).json({ error: "Permissao negada: createFolders" });
  }

  const name = sanitizeFolderName(req.body.name);
  const requestedUsers = req.body.users && typeof req.body.users === "object"
    ? req.body.users
    : Object.fromEntries(normalizeAllowedUsers(req.body.allowedUsers).map((username) => [
        username,
        { read: true, edit: false },
      ]));
  const validUsernames = new Set(loadUsers().map((user) => user.username));
  const folderUsers = {};
  const invalidUsers = [];
  const expiresAt = getTemporaryExpirationFromBody(req.body);

  if (!name) {
    return res.status(400).json({ error: "Nome da pasta e obrigatorio" });
  }

  if (expiresAt === undefined) {
    return res.status(400).json({ error: "Expiracao temporaria invalida" });
  }

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
      folderUsers[cleanUsername] = { read: canRead, edit: canEdit };
    }
  }

  if (invalidUsers.length) {
    return res.status(400).json({ error: `Usuarios invalidos: ${invalidUsers.join(", ")}` });
  }

  const folders = loadFolders();
  const folder = {
    id: createFolderId(),
    name,
    createdBy: req.user.username,
    createdAt: new Date().toISOString(),
    expiresAt,
    users: folderUsers,
    allowedUsers: Object.keys(folderUsers),
    isRoot: false,
  };

  folders.push(folder);
  saveFolders(folders);
  ensureFolderDirectories(folder.id);
  auditLog("folder.created", getAuditActor(req), { type: "folder", id: folder.id }, "created", "success", {
    name,
    users: folderUsers,
    expiresAt,
  });
  addActionHistory("folder_created", name, req.user.username, {
    folderId: folder.id,
    users: folderUsers,
    expiresAt,
  });
  res.status(201).json(serializeFolderForUser(req, folder));
});

app.get("/folders/:id/access", authenticate, (req, res) => {
  const folderId = String(req.params.id || "");
  const folder = getFolderById(folderId);

  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });
  if (folderId === ROOT_FOLDER_ID || folder.isRoot) {
    return res.status(400).json({ error: "A pasta padrao nao pode ter acesso alterado" });
  }
  if (!hasFolderEditAccess(req, folder)) {
    return res.status(403).json({ error: "Permissao negada para editar esta pasta" });
  }

  const normalized = normalizeFolderAccessEntry(folder);
  res.json({
    folderId: folder.id,
    folderName: folder.name,
    owner: normalized.owner,
    users: normalized.users,
    eligibleUsers: loadUsers().map(({ password, ...user }) => user),
  });
});

app.put("/folders/:id/access", authenticate, (req, res) => {
  const folderId = String(req.params.id || "");

  if (folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ter acesso alterado" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });
  if (!hasFolderEditAccess(req, folder)) {
    return res.status(403).json({ error: "Permissao negada para editar esta pasta" });
  }

  const requestedUsers = req.body.users && typeof req.body.users === "object"
    ? req.body.users
    : Object.fromEntries(normalizeAllowedUsers(req.body.allowedUsers).map((username) => [
        username,
        { read: true, edit: false },
      ]));
  const validUsernames = new Set(loadUsers().map((user) => user.username));
  const folderUsers = {};
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
      folderUsers[cleanUsername] = { read: canRead, edit: canEdit };
    }
  }

  if (invalidUsers.length) {
    return res.status(400).json({ error: `Usuarios invalidos: ${invalidUsers.join(", ")}` });
  }

  folder.users = folderUsers;
  folder.allowedUsers = Object.keys(folderUsers);
  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  auditLog("folder.access.changed", getAuditActor(req), { type: "folder", id: folderId }, "modified", "success", {
    folderName: folder.name,
    users: folderUsers,
  });
  addActionHistory("folder_access_updated", folder.name, req.user.username, {
    folderId,
    users: folderUsers,
  });
  res.json(serializeFolderForUser(req, folder));
});

app.put("/folders/:id/name", authenticate, (req, res) => {
  const folderId = String(req.params.id || "");
  const name = sanitizeFolderName(req.body.name);

  if (!folderId || folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ser renomeada" });
  }

  if (!name) {
    return res.status(400).json({ error: "Nome da pasta e obrigatorio" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });
  if (!hasFolderEditAccess(req, folder)) {
    return res.status(403).json({ error: "Permissao negada para editar esta pasta" });
  }

  const oldName = folder.name;
  if (oldName === name) {
    return res.status(400).json({ error: "O novo nome precisa ser diferente do atual" });
  }

  folder.name = name;
  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  addActionHistory("folder_renamed", name, req.user.username, {
    folderId,
    oldName,
    newName: name,
  });

  res.json(serializeFolderForUser(req, folder));
});

app.put("/folders/:id/temporary", authenticate, (req, res) => {
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
  if (!hasFolderEditAccess(req, folder)) {
    return res.status(403).json({ error: "Permissao negada para editar esta pasta" });
  }

  folder.expiresAt = expiresAt;
  folder.updatedAt = new Date().toISOString();
  saveFolders(folders);
  addActionHistory("folder_temporary_updated", folder.name, req.user.username, {
    folderId,
    folderName: folder.name,
    expiresAt,
    temporary: Boolean(expiresAt),
  });

  res.json(serializeFolderForUser(req, folder));
});

app.delete("/folders/:id", authenticate, (req, res) => {
  const folderId = String(req.params.id || "");

  if (!folderId || folderId === ROOT_FOLDER_ID) {
    return res.status(400).json({ error: "A pasta padrao nao pode ser excluida" });
  }

  const folders = loadFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return res.status(404).json({ error: "Pasta nao encontrada" });
  if (!hasFolderEditAccess(req, folder)) {
    return res.status(403).json({ error: "Permissao negada para excluir esta pasta" });
  }

  saveFolders(folders.filter((item) => item.id !== folderId));
  deleteFolderContents(folder);
  auditLog("folder.deleted", getAuditActor(req), { type: "folder", id: folderId }, "deleted", "success", {
    folderName: folder.name,
  });
  addActionHistory("folder_deleted", folder.name, req.user.username, { folderId });
  res.json({ message: "Pasta excluida" });
});

app.get("/files/:name", authenticate, requirePermission("listFiles"), async (req, res) => {
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  const name = path.basename(req.params.name);
  const filePath = path.join(folder.uploadDir, name);
  await ensureCloudFileCached(folder.id, name, filePath, "uploads");
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileAccess(req, folder, name)) {
    auditLog("file.access.denied", getAuditActor(req), { type: "file", id: name }, "download", "failure", {
      folderId: folder.id,
      reason: "hasFileAccess_false",
    });
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  if (getEncryptedFileMetadata(folder.id, name)) {
    return res.status(403).json({ error: "Use a rota de download criptografado para este arquivo" });
  }

  logAnalyticsEvent("download", {
    filename: name,
    downloadedBy: req.user.username,
    folderId: folder.id,
    folderName: folder.name,
  });
  auditLog("file.download", getAuditActor(req), { type: "file", id: name }, "downloaded", "success", {
    folderId: folder.id,
    folderName: folder.name,
  });

  sendOptimizedFile(req, res, filePath, name, "attachment");
});

app.post("/file-open-token", authenticate, requirePermission("listFiles"), async (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const folder = getReadableFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const filePath = path.join(folder.uploadDir, name);
  await ensureCloudFileCached(folder.id, name, filePath, "uploads");
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  if (getEncryptedFileMetadata(folder.id, name)) {
    return res.status(403).json({ error: "Arquivo criptografado. Use Download para informar a senha quando necessario." });
  }

  const openToken = createOpenFileToken(folder.id, name);
  if (req.body.download === true) {
    logAnalyticsEvent("download", {
      filename: name,
      downloadedBy: req.user.username,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.download", getAuditActor(req), { type: "file", id: name }, "downloaded", "success", {
      folderId: folder.id,
      folderName: folder.name,
      via: "file-open-token",
    });
  }

  res.json({
    url: `/open-file/${openToken}/${encodeURIComponent(name)}`,
    downloadUrl: `/open-file/${openToken}/${encodeURIComponent(name)}?download=1`,
    expiresAt: new Date(Date.now() + OPEN_FILE_TOKEN_TTL_MS).toISOString(),
  });
});

app.get("/open-file/:token/:name", async (req, res) => {
  cleanupOpenFileTokens();

  const openToken = String(req.params.token || "");
  const entry = openFileTokens.get(openToken);

  if (!entry) {
    return res.status(404).send("Link de abertura expirado ou invalido");
  }

  const name = path.basename(req.params.name || "");
  if (!name || name !== entry.fileName) {
    return res.status(400).send("Nome de arquivo invalido");
  }

  const filePath = entry.filePath || path.join(getFolderStoragePath("./uploads", entry.folderId), name);
  await ensureCloudFileCached(entry.folderId, entry.cloudFileName || entry.downloadName || name, filePath, "uploads");
  if (!isExistingFile(filePath)) {
    openFileTokens.delete(openToken);
    return res.status(404).send("Arquivo nao encontrado");
  }

  const dispositionType = req.query.download === "1" ? "attachment" : "inline";
  sendOptimizedFile(req, res, filePath, entry.downloadName || name, dispositionType, {
    cacheControl: "private, max-age=3600",
  });
});

app.get("/encrypted/:filename/metadata", authenticate, requirePermission("listFiles"), (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const metadata = getEncryptedFileMetadata(folder.id, name);
  if (!metadata) return res.json({ isEncrypted: false });

  if (!hasFileAccess(req, folder, name) || !canAccessEncryptedFile(req, metadata)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  res.json(getPublicEncryptionMetadata(metadata));
});

app.post("/encrypted-download/:filename", authenticate, requirePermission("listFiles"), express.json(), async (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const metadata = getEncryptedFileMetadata(folder.id, name);
  if (!metadata) return res.status(404).json({ error: "Arquivo criptografado nao encontrado" });

  if (!hasFileAccess(req, folder, name) || !canAccessEncryptedFile(req, metadata)) {
    auditLog("file.access.denied", getAuditActor(req), { type: "file", id: name }, "decrypt", "failure", {
      folderId: folder.id,
      reason: "encrypted_access_denied",
    });
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  if (metadata.accessControl?.expiresAt && new Date(metadata.accessControl.expiresAt).getTime() <= Date.now()) {
    return res.status(410).json({ error: "Arquivo criptografado expirado" });
  }

  if (metadata.accessControl?.requiresPassword && !req.body?.password) {
    return res.status(401).json({ error: "Senha obrigatoria para este arquivo" });
  }

  const filePath = path.join(folder.uploadDir, name);
  await ensureCloudFileCached(folder.id, name, filePath, "uploads");
  if (!isExistingFile(filePath)) return res.status(404).json({ error: "Arquivo nao encontrado" });

  try {
    const decrypted = decryptEncryptedFileBuffer(fs.readFileSync(filePath), metadata, req, req.body?.password || "");
    logAnalyticsEvent("download", {
      filename: name,
      downloadedBy: req.user.username,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.decrypt", getAuditActor(req), { type: "file", id: name }, "decrypted", "success", {
      folderId: folder.id,
      encryptionLevel: metadata.encryptionLevel,
    });
    res.setHeader("Content-Type", metadata.metadata?.mimeType || getMimeType(metadata.originalFilename));
    res.setHeader("Content-Disposition", getFileContentDisposition(metadata.originalFilename || name, "attachment"));
    res.setHeader("Cache-Control", "no-store");
    res.send(decrypted);
  } catch (error) {
    auditLog("file.decrypt.failed", getAuditActor(req), { type: "file", id: name }, "decrypt", "failure", {
      folderId: folder.id,
      reason: "bad_key_or_corrupt_file",
    });
    res.status(401).json({ error: "Falha na descriptografia: senha incorreta ou arquivo corrompido" });
  }
});

app.post("/encrypted/:filename/grant-access", authenticate, (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId || req.query.folderId);
  if (!folder) return;
  const username = String(req.body.username || "").trim();
  const metadata = getEncryptedFileMetadata(folder.id, name);
  if (!metadata) return res.status(404).json({ error: "Arquivo criptografado nao encontrado" });
  if (metadata.accessControl?.owner !== req.user.username && req.user.role !== "admin") {
    return res.status(403).json({ error: "Apenas o dono ou admin pode conceder acesso" });
  }
  if (!loadUsers().some((user) => user.username === username)) {
    return res.status(404).json({ error: "Usuario nao encontrado" });
  }
  const entries = loadEncryptedFiles();
  const key = getEncryptedFileKey(folder.id, name);
  const users = new Set(entries[key].accessControl.authorizedUsers || []);
  users.add(username);
  entries[key].accessControl.authorizedUsers = [...users];
  saveEncryptedFiles(entries);
  auditLog("file.encryption.access.grant", getAuditActor(req), { type: "file", id: name }, "granted", "success", {
    folderId: folder.id,
    username,
  });
  res.json({ message: `Acesso concedido para ${username}` });
});

app.delete("/encrypted/:filename/revoke-access", authenticate, (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const folder = getAccessibleFolderOrRespond(req, res, req.body.folderId || req.query.folderId);
  if (!folder) return;
  const username = String(req.body.username || "").trim();
  const metadata = getEncryptedFileMetadata(folder.id, name);
  if (!metadata) return res.status(404).json({ error: "Arquivo criptografado nao encontrado" });
  if (metadata.accessControl?.owner !== req.user.username && req.user.role !== "admin") {
    return res.status(403).json({ error: "Apenas o dono ou admin pode revogar acesso" });
  }
  const entries = loadEncryptedFiles();
  const key = getEncryptedFileKey(folder.id, name);
  entries[key].accessControl.authorizedUsers = (entries[key].accessControl.authorizedUsers || [])
    .filter((item) => item !== username || item === entries[key].accessControl.owner);
  saveEncryptedFiles(entries);
  auditLog("file.encryption.access.revoke", getAuditActor(req), { type: "file", id: name }, "revoked", "success", {
    folderId: folder.id,
    username,
  });
  res.json({ message: `Acesso revogado para ${username}` });
});

function registerPendingUpload(req, options) {
  const folderId = req.uploadFolder?.id || ROOT_FOLDER_ID;
  const fileName = path.basename(options.fileName || "");
  const originalName = path.basename(options.originalName || fileName);
  const uploadedAt = new Date().toISOString();
  const versionComment = typeof options.versionComment === "string" ? options.versionComment.slice(0, 500) : "";
  const compressedUpload = Boolean(options.compressedUpload);
  const size = Number(options.size) || 0;
  const encryptionMetadata = options.encryptionMetadata || null;

  const pendingUploads = loadPendingUploads();
  pendingUploads[getPendingKey(folderId, fileName)] = {
    uploadedBy: req.user.username,
    uploadedAt,
    originalName: originalName !== fileName ? originalName : undefined,
    versionComment,
    compressedUpload,
    folderId,
  };
  savePendingUploads(pendingUploads);
  if (encryptionMetadata) saveEncryptedMetadata(folderId, fileName, encryptionMetadata);
  syncFileToCloud(folderId, fileName, "temp");
  logAnalyticsEvent("upload", {
    filename: fileName,
    uploadedBy: req.user.username,
    uploadedAt,
    size,
    folderId,
    folderName: req.uploadFolder?.name,
  });
  auditLog("file.upload", getAuditActor(req), {
    type: "file",
    id: fileName,
    metadata: { size, mimeType: options.mimeType || "" },
  }, "created", "success", {
    destination: "temp",
    requiresApproval: true,
    folderId,
    folderName: req.uploadFolder?.name,
    chunkedUpload: Boolean(options.chunkedUpload),
    encrypted: Boolean(encryptionMetadata),
    encryptionLevel: encryptionMetadata?.encryptionLevel || "none",
  });
  addActionHistory("upload_pending", fileName, req.user.username, {
    status: "pending",
    originalName: originalName !== fileName ? originalName : null,
    versionComment,
    compressedUpload,
    chunkedUpload: Boolean(options.chunkedUpload),
    folderId,
    folderName: req.uploadFolder?.name,
  });

  return {
    message: "Upload enviado para aprovacao",
    fileName,
    originalName,
    folderId,
    renamed: originalName !== fileName,
    compressedUpload,
    chunkedUpload: Boolean(options.chunkedUpload),
    encrypted: Boolean(encryptionMetadata),
    encryptionLevel: encryptionMetadata?.encryptionLevel || "none",
  };
}

function getChunkSessionDir(folderId, uploadId) {
  const safeFolderId = String(folderId || ROOT_FOLDER_ID).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeUploadId = String(uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeUploadId || safeUploadId.length > 80) return null;

  const sessionDir = path.join(CHUNK_UPLOAD_DIR, safeFolderId, safeUploadId);
  if (!isSafeChildPath(CHUNK_UPLOAD_DIR, sessionDir)) return null;
  return sessionDir;
}

function loadChunkMetadata(sessionDir) {
  const metadataPath = path.join(sessionDir, "metadata.json");
  if (!isExistingFile(metadataPath)) return null;
  return JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
}

function saveChunkMetadata(sessionDir, metadata) {
  fs.writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify(metadata, null, 2));
}

function hasAllChunks(sessionDir, totalChunks) {
  for (let index = 0; index < totalChunks; index += 1) {
    if (!isExistingFile(path.join(sessionDir, `${index}.part`))) return false;
  }
  return true;
}

async function assembleChunkedUpload(sessionDir, destinationPath, totalChunks) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const output = fs.createWriteStream(destinationPath);

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const chunkPath = path.join(sessionDir, `${index}.part`);
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(chunkPath);
        input.on("error", reject);
        input.on("end", resolve);
        input.pipe(output, { end: false });
      });
    }

    await new Promise((resolve, reject) => {
      output.on("finish", resolve);
      output.on("error", reject);
      output.end();
    });
  } catch (error) {
    output.destroy();
    fs.rmSync(destinationPath, { force: true });
    throw error;
  }
}

app.post("/upload-chunk", authenticate, requirePermission("upload"), prepareUploadFolder, handleChunkUploadSingle, async (req, res) => {
  const folderId = req.uploadFolder?.id || ROOT_FOLDER_ID;
  const uploadId = String(req.body.uploadId || "");
  const originalName = path.basename(String(req.body.originalName || ""));
  const chunkIndex = Number(req.body.chunkIndex);
  const totalChunks = Number(req.body.totalChunks);

  if (!req.file) {
    return res.status(400).json({ error: "Bloco obrigatorio" });
  }

  if (
    !originalName ||
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(totalChunks) ||
    chunkIndex < 0 ||
    totalChunks < 1 ||
    totalChunks > MAX_UPLOAD_CHUNKS ||
    chunkIndex >= totalChunks
  ) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "Dados do upload em blocos invalidos" });
  }

  const sessionDir = getChunkSessionDir(folderId, uploadId);
  if (!sessionDir) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "Sessao de upload invalida" });
  }

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    let metadata = loadChunkMetadata(sessionDir);

    if (!metadata) {
      const fileName = getAvailableUploadFileName(originalName, folderId, true);
      metadata = {
        uploadId,
        folderId,
        originalName,
        fileName,
        totalChunks,
        uploadedBy: req.user.username,
        versionComment: typeof req.body.versionComment === "string" ? req.body.versionComment.slice(0, 500) : "",
        encryptionLevel: typeof req.body.encryptionLevel === "string" ? req.body.encryptionLevel : "none",
        password: typeof req.body.password === "string" ? req.body.password : "",
        expiresInDays: typeof req.body.expiresInDays === "string" ? req.body.expiresInDays : "",
        createdAt: new Date().toISOString(),
      };
      saveChunkMetadata(sessionDir, metadata);
    }

    if (metadata.totalChunks !== totalChunks || metadata.originalName !== originalName) {
      fs.rmSync(req.file.path, { force: true });
      return res.status(409).json({ error: "Sessao de upload inconsistente" });
    }

    const chunkPath = path.join(sessionDir, `${chunkIndex}.part`);
    fs.rmSync(chunkPath, { force: true });
    fs.renameSync(req.file.path, chunkPath);

    if (!hasAllChunks(sessionDir, totalChunks)) {
      return res.json({
        complete: false,
        received: chunkIndex + 1,
        totalChunks,
        fileName: metadata.fileName,
      });
    }

    const finalPath = path.join(req.uploadFolder.tempDir, metadata.fileName);
    await assembleChunkedUpload(sessionDir, finalPath, totalChunks);
    const stats = fs.statSync(finalPath);
    let encryptionMetadata = null;
    try {
      encryptionMetadata = encryptFileInPlace(finalPath, {
        req,
        fileName: metadata.fileName,
        originalName: metadata.originalName,
        folderId,
        originalSize: stats.size,
        mimeType: req.file.mimetype,
        encryptionLevel: metadata.encryptionLevel || "none",
        password: metadata.password || "",
        expiresInDays: metadata.expiresInDays || "",
      });
    } catch (error) {
      fs.rmSync(finalPath, { force: true });
      fs.rmSync(sessionDir, { recursive: true, force: true });
      return res.status(400).json({ error: error.message || "Falha ao criptografar arquivo" });
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });

    const payload = registerPendingUpload(req, {
      fileName: metadata.fileName,
      originalName: metadata.originalName,
      versionComment: metadata.versionComment,
      size: stats.size,
      mimeType: req.file.mimetype,
      chunkedUpload: true,
      encryptionMetadata,
    });

    res.json({ ...payload, complete: true, totalChunks });
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    console.error("Erro no upload em blocos:", error.message);
    res.status(500).json({ error: "Upload em blocos nao concluido" });
  }
});

app.post("/upload", authenticate, requirePermission("upload"), prepareUploadFolder, rejectLargeSingleUpload, handleUploadSingle, async (req, res) => {
  const originalName = path.basename(req.file?.originalname || "");
  const fileName = path.basename(req.uploadFinalFileName || "");

  if (!req.file || !fileName) {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: "Arquivo obrigatorio" });
  }

  let uploadWasCompressed = false;
  try {
    uploadWasCompressed = await decompressUploadedFileIfNeeded(req);
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: error.message || "Upload compactado invalido" });
  }

  const finalTempPath = path.join(req.uploadFolder.tempDir, fileName);
  try {
    fs.renameSync(req.file.path, finalTempPath);
    req.file.path = finalTempPath;
  } catch (error) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(500).json({ error: "Nao foi possivel finalizar o upload" });
  }

  let encryptionMetadata = null;
  try {
    encryptionMetadata = encryptFileInPlace(finalTempPath, {
      req,
      fileName,
      originalName,
      folderId: req.uploadFolder?.id || ROOT_FOLDER_ID,
      originalSize: req.file.size,
      mimeType: req.file.mimetype,
      encryptionLevel: req.body.encryptionLevel || "none",
      password: req.body.password || "",
      expiresInDays: req.body.expiresInDays || "",
    });
  } catch (error) {
    fs.rmSync(finalTempPath, { force: true });
    return res.status(400).json({ error: error.message || "Falha ao criptografar arquivo" });
  }

  res.json(registerPendingUpload(req, {
    fileName,
    originalName,
    versionComment: req.body.versionComment,
    size: req.file.size,
    mimeType: req.file.mimetype,
    compressedUpload: uploadWasCompressed,
    encryptionMetadata,
  }));
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

app.get("/list", authenticate, requirePermission("listFiles"), async (req, res) => {
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  await syncFolderCacheFromCloud(folder.id, "uploads");
  listFilesWithDetails(folder.uploadDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });

    const filePermissions = loadFilePermissions();
    const fileExpirations = loadFileExpirations();
    const fileVersions = loadFileVersions();
    const encryptedFiles = loadEncryptedFiles();
    const visibleFiles = files
      .filter((file) => !isStoredVersionFile(folder.id, file.name, fileVersions))
      .filter((file) => hasFileAccess(req, folder, file.name, filePermissions))
      .filter((file) => canAccessEncryptedFile(req, getEncryptedFileMetadata(folder.id, file.name, encryptedFiles)))
      .map((file) => {
        const entry = getFilePermissionEntry(folder.id, file.name, filePermissions);
        const normalizedEntry = normalizeFilePermissionEntry(entry);
        const expiration = getFileExpirationEntry(folder.id, file.name, fileExpirations);
        const versions = getVersionHistory(folder.id, file.name, fileVersions);
        const encryption = getEncryptedFileMetadata(folder.id, file.name, encryptedFiles);

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
          currentVersion: versions.currentVersion || 0,
          versionCount: versions.versions.length,
          encryption: getPublicEncryptionMetadata(encryption),
          canEdit: hasFileEditAccess(req, folder, file.name, filePermissions),
          canManageAccess: canManageAccess(req) || hasFileEditAccess(req, folder, file.name, filePermissions),
        };
      });

    res.json(visibleFiles);
  });
});

app.get("/versions/:filename", authenticate, requirePermission("listFiles"), (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName) {
    return res.status(400).json({ error: "Nome de arquivo invalido" });
  }

  const filePath = path.join(folder.uploadDir, name);
  if (!isExistingFile(filePath)) {
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  const { history } = ensureVersionHistory(folder, name, normalizeFilePermissionEntry(getFilePermissionEntry(folder.id, name)).owner, "Versao inicial");
  const owner = normalizeFilePermissionEntry(getFilePermissionEntry(folder.id, name)).owner;
  res.json({
    folderId: folder.id,
    fileName: name,
    currentVersion: history.currentVersion,
    canDeleteVersions: Boolean(req.user?.permissions?.delete && (canManageAccess(req) || owner === req.user?.username)),
    canRestore: hasFileEditAccess(req, folder, name),
    versions: history.versions.slice().sort((a, b) => b.version - a.version),
    actionHistory: getActionHistoryForFile(folder.id, name),
  });
});

app.get("/download/:filename/v/:version", authenticate, requirePermission("listFiles"), async (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const versionNumber = Number(req.params.version);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName || !Number.isInteger(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ error: "Versao invalida" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  const target = getVersionFilePath(folder, name, versionNumber);
  if (target?.version?.storedAs) {
    await ensureCloudFileCached(folder.id, target.version.storedAs, target.filePath, "uploads");
  }
  if (!target || !isExistingFile(target.filePath)) {
    return res.status(404).json({ error: "Versao nao encontrada" });
  }

  if (getEncryptedFileMetadata(folder.id, name)) {
    return res.status(403).json({ error: "Download de versoes criptografadas exige a versao atual da rota segura" });
  }

  sendOptimizedFile(req, res, target.filePath, name, "attachment");
});

app.post("/version-open-token", authenticate, requirePermission("listFiles"), async (req, res) => {
  const rawName = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const name = path.basename(rawName);
  const versionNumber = Number(req.body.version);
  const folder = getReadableFolderOrRespond(req, res, req.body.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName || !Number.isInteger(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ error: "Versao invalida" });
  }

  if (!hasFileAccess(req, folder, name)) {
    return res.status(403).json({ error: "Acesso negado a este arquivo" });
  }

  const target = getVersionFilePath(folder, name, versionNumber);
  if (target?.version?.storedAs) {
    await ensureCloudFileCached(folder.id, target.version.storedAs, target.filePath, "uploads");
  }
  if (!target || !isExistingFile(target.filePath)) {
    return res.status(404).json({ error: "Versao nao encontrada" });
  }

  const openToken = createOpenFileToken(folder.id, name, {
    filePath: target.filePath,
    downloadName: name,
    cloudFileName: target.version.storedAs,
  });

  res.json({
    downloadUrl: `/open-file/${openToken}/${encodeURIComponent(name)}?download=1`,
    expiresAt: new Date(Date.now() + OPEN_FILE_TOKEN_TTL_MS).toISOString(),
  });
});

app.post("/restore/:filename/v/:version", authenticate, async (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const versionNumber = Number(req.params.version);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName || !Number.isInteger(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ error: "Versao invalida" });
  }

  if (!hasFileEditAccess(req, folder, name)) {
    return res.status(403).json({ error: "Permissao negada para editar este arquivo" });
  }

  const entries = loadFileVersions();
  const key = getFileVersionKey(folder.id, name);
  const history = normalizeVersionHistory(entries[key]);
  const target = history.versions.find((item) => item.version === versionNumber);

  if (!target) {
    return res.status(404).json({ error: "Versao nao encontrada" });
  }

  if (versionNumber === history.currentVersion) {
    return res.status(400).json({ error: "Esta versao ja e a atual" });
  }

  const currentPath = path.join(folder.uploadDir, name);
  const targetPath = path.join(folder.uploadDir, target.storedAs);
  await ensureCloudFileCached(folder.id, name, currentPath, "uploads");
  await ensureCloudFileCached(folder.id, target.storedAs, targetPath, "uploads");
  if (!isExistingFile(currentPath) || !isExistingFile(targetPath)) {
    return res.status(404).json({ error: "Arquivo da versao nao encontrado" });
  }

  try {
    const oldCurrentVersion = history.currentVersion;
    const archivedName = getStoredVersionName(name, oldCurrentVersion);
    const archivedPath = path.join(folder.uploadDir, archivedName);

    fs.renameSync(currentPath, archivedPath);
    for (const version of history.versions) {
      if (version.version === oldCurrentVersion) {
        version.storedAs = archivedName;
        version.size = fs.statSync(archivedPath).size;
      }
    }

    fs.copyFileSync(targetPath, currentPath);
    const stats = fs.statSync(currentPath);
    const newVersion = oldCurrentVersion + 1;
    history.currentVersion = newVersion;
    history.versions.push({
      version: newVersion,
      storedAs: name,
      uploadedBy: req.user.username,
      uploadedAt: new Date().toISOString(),
      size: stats.size,
      comment: `Restaurado da versao ${versionNumber}`,
    });

    entries[key] = history;
    pruneFileVersions(entries, key, folder);
    saveFileVersions(entries);
    syncFileVersionsToCloud(folder.id, name);
    addActionHistory("version_restored", name, req.user.username, {
      folderId: folder.id,
      folderName: folder.name,
      restoredVersion: versionNumber,
      newVersion,
    });
    logAnalyticsEvent("restore", {
      filename: name,
      restoredBy: req.user.username,
      restoredVersion: versionNumber,
      newVersion,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.version.restore", getAuditActor(req), { type: "file", id: name }, "restored", "success", {
      folderId: folder.id,
      restoredVersion: versionNumber,
      newVersion,
    });
    res.json({ message: "Versao restaurada", version: newVersion, restoredVersion: versionNumber });
  } catch (error) {
    console.error("Erro ao restaurar versao:", error.message);
    res.status(500).json({ error: "Erro ao restaurar versao" });
  }
});

app.delete("/versions/:filename/v/:version", authenticate, requirePermission("delete"), (req, res) => {
  const rawName = typeof req.params.filename === "string" ? req.params.filename.trim() : "";
  const name = path.basename(rawName);
  const versionNumber = Number(req.params.version);
  const folder = getReadableFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  if (!rawName || name !== rawName || !Number.isInteger(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ error: "Versao invalida" });
  }

  const owner = normalizeFilePermissionEntry(getFilePermissionEntry(folder.id, name)).owner;
  if (!canManageAccess(req) && owner !== req.user?.username) {
    return res.status(403).json({ error: "Apenas o dono ou admin pode deletar versoes" });
  }

  const entries = loadFileVersions();
  const key = getFileVersionKey(folder.id, name);
  const history = normalizeVersionHistory(entries[key]);
  const target = history.versions.find((item) => item.version === versionNumber);

  if (!target) {
    return res.status(404).json({ error: "Versao nao encontrada" });
  }

  if (versionNumber === history.currentVersion) {
    return res.status(400).json({ error: "A versao atual nao pode ser deletada" });
  }

  fs.rmSync(path.join(folder.uploadDir, target.storedAs), { force: true });
  deleteCloudFileLater(folder.id, target.storedAs, "uploads");
  history.versions = history.versions.filter((item) => item.version !== versionNumber);
  entries[key] = history;
  saveFileVersions(entries);
  addActionHistory("version_deleted", name, req.user.username, {
    folderId: folder.id,
    folderName: folder.name,
    version: versionNumber,
  });
  logAnalyticsEvent("versionDeletion", {
    filename: name,
    deletedBy: req.user.username,
    version: versionNumber,
    folderId: folder.id,
    folderName: folder.name,
  });
  auditLog("file.version.delete", getAuditActor(req), { type: "file", id: name }, "deleted", "success", {
    folderId: folder.id,
    version: versionNumber,
  });
  res.json({ message: "Versao deletada" });
});

app.get("/history", authenticate, requirePermission("listFiles"), (req, res) => {
  try {
    res.json({ items: loadActionHistory().slice(0, 200) });
  } catch {
    res.status(500).json({ error: "Erro ao carregar historico" });
  }
});

app.get("/analytics/summary", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getAnalyticsSummary());
});

app.get("/analytics/uploads-by-month", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getUploadsByMonth(req.query.months));
});

app.get("/analytics/uploads-by-user", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getUploadsByUser(req.query.limit));
});

app.get("/analytics/active-users", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getActiveUsers(req.query.days));
});

app.get("/analytics/file-types", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getFileTypes());
});

app.get("/analytics/downloads-by-file", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getMostDownloadedFiles(req.query.limit));
});

app.get("/analytics/recent", authenticate, requireAnalyticsAccess, (req, res) => {
  res.json(getRecentAnalyticsEvents(req.query.limit));
});

app.get("/audit/logs", authenticate, requireAuditAccess, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const logs = getFilteredAuditLogs(req.query);
  const start = (page - 1) * limit;

  res.json({
    total: logs.length,
    page,
    limit,
    logs: logs.slice(start, start + limit),
  });
});

app.get("/audit/summary", authenticate, requireAuditAccess, (req, res) => {
  const logs = loadAuditLogs().logs;
  const critical = logs
    .filter((log) => log.severity === "critical")
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  res.json({
    totalLogs: logs.length,
    bySeverity: countBy(logs, "severity"),
    byEventType: countBy(logs, "eventType"),
    byResult: countBy(logs, "result"),
    recentCritical: critical,
    failedLogins: logs.filter((log) => log.eventType === "auth.login.failed").length,
    suspiciousIPs: findSuspiciousIPs(logs),
  });
});

app.get("/audit/export", authenticate, requireAuditAccess, (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const logs = getFilteredAuditLogs(req.query);

  auditLog("system.config.changed", getAuditActor(req), { type: "audit", id: "export" }, "exported", "success", {
    format,
    count: logs.length,
  });

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv");
    return res.send(convertAuditLogsToCSV(logs));
  }

  res.json(logs);
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

  if (getEncryptedFileMetadata(folder.id, name)) {
    return res.status(403).json({ error: "Links publicos nao estao disponiveis para arquivos criptografados" });
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

app.post("/share/:token/view", async (req, res) => {
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
  await ensureCloudFileCached(folderId, fileName, filePath, "uploads");
  if (!isExistingFile(filePath)) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).json({ error: "Arquivo nao encontrado" });
  }
  if (getEncryptedFileMetadata(folderId, fileName)) {
    return res.status(403).json({ error: "Links publicos nao estao disponiveis para arquivos criptografados" });
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

app.get("/share/:token/file", async (req, res) => {
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
  await ensureCloudFileCached(folderId, fileName, filePath, "uploads");
  if (!isExistingFile(filePath)) {
    delete links[shareToken];
    savePublicLinks(links);
    return res.status(404).send("Arquivo nao encontrado");
  }
  if (getEncryptedFileMetadata(folderId, fileName)) {
    return res.status(403).send("Links publicos nao estao disponiveis para arquivos criptografados");
  }

  if (changed) savePublicLinks(links);
  sendOptimizedFile(req, res, filePath, fileName, "inline", {
    cacheControl: "private, max-age=600",
  });
});

app.get("/pending", authenticate, async (req, res) => {
  if (!req.user?.permissions?.listPending && !req.user?.permissions?.upload) {
    return res.status(403).json({ error: "Permissao negada: listPending" });
  }

  const folder = getAccessibleFolderOrRespond(req, res, req.query.folderId);
  if (!folder) return;

  await repairCompressedTempUploads(folder.tempDir);
  cleanupOrphanTempUploads(folder.tempDir);
  await syncFolderCacheFromCloud(folder.id, "temp");
  listFilesWithDetails(folder.tempDir, (err, files) => {
    if (err) return res.status(500).json({ error: "Erro ao listar" });
    const encryptedFiles = loadEncryptedFiles();

    const visibleFiles = files
      .map((file) => ({
        ...file,
        folderId: folder.id,
        uploadedBy: getPendingUploadOwner(folder.id, file.name),
        encryption: getPublicEncryptionMetadata(getEncryptedFileMetadata(folder.id, file.name, encryptedFiles)),
      }))
      .filter((file) => req.user.permissions.listPending || canAccessPendingFile(req, folder.id, file.name));

    res.json(visibleFiles);
  });
});

app.get("/preview/file/:scope/:name", authenticate, async (req, res) => {
  const target = await ensurePreviewAccess(req, res, req.params.scope, req.params.name, req.query.folderId);
  if (!target) return;

  sendOptimizedFile(req, res, target.filePath, target.name, "inline", {
    cacheControl: "private, max-age=600",
  });
});

app.get("/preview/text/:scope/:name", authenticate, async (req, res) => {
  const target = await ensurePreviewAccess(req, res, req.params.scope, req.params.name, req.query.folderId);
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

  try {
    const pendingPath = path.join(folder.tempDir, name);
    if (!isExistingFile(pendingPath)) {
      return res.status(404).json({ error: "Arquivo pendente nao encontrado" });
    }

    const pendingUploads = loadPendingUploads();
    const key = getPendingKey(folder.id, name);
    const pendingEntry = pendingUploads[key] || pendingUploads[name] || {};
    const uploadedBy = pendingEntry.uploadedBy || null;
    const versionInfo = recordApprovedFileVersion(
      folder,
      name,
      pendingPath,
      uploadedBy || req.user.username,
      pendingEntry.versionComment || ""
    );
    syncFileVersionsToCloud(folder.id, name);
    deleteCloudFileLater(folder.id, name, "temp");

    delete pendingUploads[key];
    if (folder.id === ROOT_FOLDER_ID) delete pendingUploads[name];
    savePendingUploads(pendingUploads);
    setFileOwner(folder.id, name, uploadedBy);
    logAnalyticsEvent("approval", {
      filename: name,
      approvedBy: req.user.username,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.approve", getAuditActor(req), { type: "file", id: name }, "approved", "success", {
      from: "temp",
      to: "uploads",
      folderId: folder.id,
      version: versionInfo.currentVersion,
    });
    addActionHistory("approved", name, req.user.username, {
      uploadedBy,
      folderId: folder.id,
      folderName: folder.name,
      version: versionInfo.currentVersion,
      replaced: versionInfo.replaced,
    });
    res.json({ message: "Aprovado", version: versionInfo.currentVersion, replaced: versionInfo.replaced });
  } catch (error) {
    console.error("Erro ao aprovar arquivo:", error.message);
    res.status(500).json({ error: "Erro ao aprovar" });
  }
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
    deleteCloudFileLater(folder.id, name, "temp");
    logAnalyticsEvent("rejection", {
      filename: name,
      rejectedBy: req.user.username,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.reject", getAuditActor(req), { type: "file", id: name }, "rejected", "success", {
      folderId: folder.id,
      uploadedBy,
    });
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

  const filePath = path.join(folder.uploadDir, name);
  const fileSize = isExistingFile(filePath) ? fs.statSync(filePath).size : 0;

  fs.unlink(filePath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao excluir" });
    deleteCloudFileLater(folder.id, name, "uploads");
    removePublicLinksForFile(name, folder.id);
    removeFilePermission(folder.id, name);
    removeFileExpiration(folder.id, name);
    removeFileVersions(folder.id, name);
    removeEncryptedMetadata(folder.id, name);
    logAnalyticsEvent("deletion", {
      filename: name,
      deletedBy: req.user.username,
      size: fileSize,
      folderId: folder.id,
      folderName: folder.name,
    });
    auditLog("file.delete", getAuditActor(req), { type: "file", id: name, metadata: { size: fileSize } }, "deleted", "success", {
      folderId: folder.id,
      folderName: folder.name,
    });
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
  const oldStoredNames = getVersionHistory(folder.id, oldName).versions
    .map((version) => path.basename(version.storedAs || ""))
    .filter(Boolean);

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
    renameFileVersions(folder.id, oldName, newName);
    renameEncryptedMetadata(folder.id, oldName, newName);
    for (const storedName of new Set([oldName, ...oldStoredNames])) {
      deleteCloudFileLater(folder.id, storedName, "uploads");
    }
    syncFileVersionsToCloud(folder.id, newName);
    auditLog("file.rename", getAuditActor(req), { type: "file", id: newName }, "renamed", "success", {
      oldName,
      newName,
      folderId: folder.id,
    });
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
  const oldStoredNames = getVersionHistory(fromFolder.id, name).versions
    .map((version) => path.basename(version.storedAs || ""))
    .filter(Boolean);

  fs.rename(sourcePath, destinationPath, (err) => {
    if (err) return res.status(500).json({ error: "Erro ao mover arquivo" });

    movePublicLinksForFile(name, finalName, fromFolder.id, toFolder.id);
    moveFilePermission(fromFolder.id, name, toFolder.id, finalName);
    moveFileExpiration(fromFolder.id, name, toFolder.id, finalName);
    moveFileVersions(fromFolder.id, name, toFolder.id, finalName);
    moveEncryptedMetadata(fromFolder.id, name, toFolder.id, finalName);
    for (const storedName of new Set([name, ...oldStoredNames])) {
      deleteCloudFileLater(fromFolder.id, storedName, "uploads");
    }
    syncFileVersionsToCloud(toFolder.id, finalName);
    auditLog("file.move", getAuditActor(req), { type: "file", id: finalName }, "moved", "success", {
      oldName: name,
      newName: finalName,
      fromFolderId: fromFolder.id,
      toFolderId: toFolder.id,
    });
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
repairCompressedTempUploads().catch((error) => {
  console.error("Falha ao reparar uploads temporarios:", error.message);
});
cleanupOrphanTempUploads();
cleanupIncomingUploads();
setInterval(cleanupExpiredTemporaryItems, 60 * 1000);
setInterval(cleanupIncomingUploads, 60 * 1000);
server.listen(3000, () => console.log("Servidor rodando em http://localhost:3000"));
