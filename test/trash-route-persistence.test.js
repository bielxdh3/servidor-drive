const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const originalCwd = process.cwd();
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-trash-route-"));
process.chdir(runtime);
process.env.DB_ENABLED = "false";

const trashRepository = require("../repositories/trashRepository");
const trashService = require("../services/trashService");
const registerTrashRoutes = require("../src/routes/trash");

const routes = {};
const audits = [];
const broadcasts = [];
const app = {
  get(route, ...handlers) { routes[`GET ${route}`] = handlers.at(-1); },
  post(route, ...handlers) { routes[`POST ${route}`] = handlers.at(-1); },
  delete(route, ...handlers) { routes[`DELETE ${route}`] = handlers.at(-1); },
};

registerTrashRoutes(app, {
  addActionHistory() {},
  auditLog(...event) { audits.push(event); },
  authenticate() {},
  broadcastDataChanged(...event) { broadcasts.push(event); },
  canManageTrash() { return true; },
  canRestoreTrashItem() { return true; },
  deleteCloudTrashItem: async () => true,
  deleteCloudTrashItemLater() {},
  ensureFolderDirectories() { return {}; },
  getAuditActor() { return { username: "tester", role: "admin" }; },
  getCloudStorageStatus() { return { provider: "s3" }; },
  getFolderById() { return null; },
  getTrashLoaders() { return {}; },
  isTrashEnabled() { return true; },
  isCloudStorageEnabled() { return true; },
  requirePermission() {},
  requireTrashManageAccess() {},
  rootFolderId: "root",
  serializeTrashItemForUser(item) { return item; },
  trashRepository,
  trashService,
});

function item(id) {
  const trashPath = path.join("files", id, "item.txt");
  const absolute = path.join(runtime, "data", "trash", trashPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, "disposable");
  const value = {
    id,
    itemType: "file",
    originalFolderId: "root",
    originalFileName: "item.txt",
    trashPath,
    deletedBy: "tester",
    deletedAt: new Date().toISOString(),
    metadata: {},
    restoreMetadata: { versions: { versions: [] } },
    status: "trashed",
  };
  return trashRepository.saveTrashItem(value);
}

function response() {
  const result = {};
  return {
    result,
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
}

function request(id) {
  return { params: { id }, user: { username: "tester" } };
}

test("DELETE /trash/:id reports the reloaded retry state after provider failure", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  item(id);
  const original = trashService.processRemoteDeletion;
  trashService.processRemoteDeletion = async ({ item: queued }) => trashService.failRemoteDeletion(queued, new Error("provider"));
  const res = response();
  try { await routes[`DELETE /trash/:id`](request(id), res); } finally { trashService.processRemoteDeletion = original; }
  assert.equal(res.result.status, undefined);
  assert.equal(res.result.body.remoteDeletion, "retry_wait");
  assert.equal(trashRepository.getTrashItem(id).metadata.remoteDeletion.state, "retry_wait");
  assert.equal(audits.some((event) => event[0] === "trash.remote_delete.failed"), false);
  assert.equal(broadcasts.at(-1)[1].action, "remote_delete_pending");
});

test("DELETE /trash/:id never reports completion when completion persistence fails", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  item(id);
  const originalSave = trashRepository.saveTrashItem;
  trashRepository.saveTrashItem = (value) => {
    if (value.metadata?.remoteDeletion?.state === "completed") throw new Error("completion persistence");
    return originalSave(value);
  };
  const res = response();
  try { await routes[`DELETE /trash/:id`](request(id), res); } finally { trashRepository.saveTrashItem = originalSave; }
  assert.equal(res.result.status, undefined);
  assert.equal(res.result.body.remoteDeletion, "retry_wait");
  assert.notEqual(res.result.body.remoteDeletion, "completed");
  assert.equal(broadcasts.at(-1)[1].action, "remote_delete_pending");
  assert.equal(audits.some((event) => event[0] === "trash.remote_delete.completed"), false);
});

test("DELETE /trash/:id returns generic 500 when persisted state cannot be reloaded", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  item(id);
  const originalGet = trashRepository.getTrashItem;
  let reads = 0;
  trashRepository.getTrashItem = (...args) => {
    reads += 1;
    if (reads > 1) throw new Error("repository unavailable");
    return originalGet(...args);
  };
  const res = response();
  try { await routes[`DELETE /trash/:id`](request(id), res); } finally { trashRepository.getTrashItem = originalGet; }
  assert.equal(res.result.status, 500);
  assert.deepEqual(res.result.body, { error: "Erro de persistencia da lixeira" });
  assert.equal(audits.some((event) => event[0] === "trash.remote_delete.completed"), false);
});

test.after(() => {
  process.chdir(originalCwd);
  fs.rmSync(runtime, { recursive: true, force: true });
});
