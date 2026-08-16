"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const clientCrypto = require("../public/client/rootark-client-crypto");
const protectedIndex = require("../public/client/rootark-protected-index");
const protectedPreview = require("../public/client/rootark-protected-preview");
const syncAdapter = require("../public/client/rootark-sync-adapter");
const offlineQueue = require("../public/client/rootark-offline-queue");
const { AtomicGroupsStore, isGroupMember, MAX_MEMBERS, registerGroupRoutes } = require("../src/routes/groups");

function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, ...options }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.once("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function json(value) {
  return Buffer.from(JSON.stringify(value));
}

test("protected client index canonicalizes metadata and rejects tamper/wrong keys", async () => {
  const key = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const first = await protectedIndex.createEntry({ id: "file-1", metadata: { name: "secret.txt", size: 4, nested: { b: 2, a: 1 } } }, key);
  const second = await protectedIndex.createEntry({ id: "file-2", metadata: { name: "public.txt", size: 6 } }, key);
  assert.equal(JSON.stringify(first).includes("secret.txt"), false);
  assert.deepEqual((await protectedIndex.search([first, second], "secret", key)).map((item) => item.id), ["file-1"]);
  await assert.rejects(protectedIndex.decryptEntry(first, wrongKey));
  await assert.rejects(protectedIndex.decryptEntry({ ...first, envelope: { ...first.envelope, ciphertext: `${first.envelope.ciphertext}x` } }, key));
  assert.equal(clientCrypto.canonicalJson({ b: 2, a: 1 }), clientCrypto.canonicalJson({ a: 1, b: 2 }));
});

test("protected preview never exposes body in its envelope and decrypts locally", async () => {
  const key = crypto.randomBytes(32);
  const preview = await protectedPreview.seal({ fileId: "file-1", contentType: "text/plain", body: "private preview" }, key);
  assert.equal(JSON.stringify(preview).includes("private preview"), false);
  assert.deepEqual(await protectedPreview.open(preview, key), { fileId: "file-1", contentType: "text/plain", body: "private preview" });
  await assert.rejects(protectedPreview.open(preview, crypto.randomBytes(32)));
});

test("offline queue and sync adapter reject plaintext, keys, and search terms", () => {
  const store = new Map();
  const local = { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const queue = offlineQueue.createOfflineQueue(local);
  assert.throws(() => queue.enqueue({ ciphertext: "opaque", plaintext: "secret" }));
  assert.equal(queue.enqueue({ ciphertext: "opaque", nonce: "n", tag: "t", aad: "a" }), 1);
  assert.throws(() => syncAdapter.assertOpaqueEnvelope({ plaintext: "secret" }));
  assert.throws(() => syncAdapter.assertOpaqueEnvelope({ ciphertext: "x", fileKey: "key" }));
});

test("service worker caches only the public shell and bypasses protected paths", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "service-worker.js"), "utf8");
  const handlers = {};
  const cached = [];
  const context = {
    URL,
    Promise,
    self: {
      location: { origin: "https://rootark.test" },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    },
    caches: {
      open: async () => ({
        addAll: async (assets) => cached.push(...assets),
        put: async () => {},
      }),
      match: async () => null,
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
  };
  vm.runInNewContext(source, context);
  let installWait;
  handlers.install({ waitUntil: (promise) => { installWait = promise; } });
  await installWait;
  assert.ok(cached.includes("/index.html"));
  assert.equal(cached.some((asset) => /auth|api|files|preview|sync|encrypted|groups|folders/i.test(asset)), false);
  let fetchWait;
  handlers.fetch({ request: { method: "GET", url: "https://rootark.test/files/private.txt" }, respondWith: (promise) => { fetchWait = promise; } });
  assert.equal(fetchWait, undefined);
  handlers.fetch({ request: { method: "GET", url: "https://rootark.test/" }, respondWith: (promise) => { fetchWait = promise; } });
  assert.ok(fetchWait);
  await fetchWait;
});

test("groups require manageUsers, persist atomically, and add folder membership access", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase13-groups-"));
  const events = [];
  const users = [{ username: "admin", role: "admin" }, { username: "alice", role: "user" }, { username: "bob", role: "user" }];
  const folders = [{ id: "folder-1", createdBy: "owner", users: { bob: { read: true } }, groupIds: [] }];
  const app = express();
  app.use(express.json());
  const authenticate = (req, _res, next) => { req.user = users.find((user) => user.username === req.headers["x-user"]) || users[1]; next(); };
  const requirePermission = (permission) => (req, res, next) => req.user.role === "admin" || req.user.permissions?.[permission] ? next() : res.status(403).json({ error: `Permissao negada: ${permission}` });
  const route = registerGroupRoutes({ app, authenticate, requirePermission, loadUsers: () => users, loadFolders: () => folders, saveFolders: (next) => folders.splice(0, folders.length, ...next), auditLog: (...args) => events.push(args), getAuditActor: () => ({ username: "admin" }), storagePath: path.join(dir, "groups.json") });
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fsp.rm(dir, { recursive: true, force: true }); });
  const port = server.address().port;
  const denied = await request(port, "/groups", { headers: { "x-user": "alice" } });
  assert.equal(denied.status, 403);
  const createdBody = json({ name: "docs", members: ["alice"] });
  const created = await request(port, "/groups", { method: "POST", headers: { "x-user": "admin", "content-type": "application/json", "content-length": createdBody.length }, body: createdBody });
  assert.equal(created.status, 201);
  const group = JSON.parse(created.body).group;
  assert.equal(JSON.stringify(created.body).includes("password"), false);
  assert.equal(route.store.isMember("alice", [group.id]), true);
  assert.equal(isGroupMember(route.store, "alice", [group.id]), true);
  folders[0].groupIds = [group.id];
  assert.equal(route.store.isMember("alice", folders[0].groupIds), true);
  const persisted = new AtomicGroupsStore(path.join(dir, "groups.json"));
  assert.equal(persisted.get(group.id).name, "docs");
  assert.ok(events.some((entry) => entry[0] === "group.created"));
  route.store.state.groups[group.id].members = Array.from({ length: MAX_MEMBERS }, () => "alice");
  const overLimitBody = json({ username: "bob" });
  const overLimit = await request(port, `/groups/${group.id}/members`, { method: "POST", headers: { "x-user": "admin", "content-type": "application/json", "content-length": overLimitBody.length }, body: overLimitBody });
  assert.equal(overLimit.status, 400);
});
