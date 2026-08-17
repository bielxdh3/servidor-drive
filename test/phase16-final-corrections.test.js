"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const protocol = require("../sync-client/rootark-sync-protocol");
const { createAuthorizationProof, verifyAuthorizationProof } = require("../sync-client/rootark-sync-authorization");
const { SyncEngine } = require("../sync-client/rootark-sync-engine");
const { SyncJournal } = require("../sync-client/rootark-sync-journal");
const { LocalSyncWebDavBridge } = require("../sync-client/rootark-sync-webdav");
const { createOpaqueSyncAdapter } = require("../public/client/rootark-sync-adapter");
const { SyncObjectStore, registerSyncRoutes } = require("../src/routes/sync");

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

function appFor(storagePath, options = {}) {
  const app = express();
  app.use(express.json({ limit: "9mb" }));
  const route = registerSyncRoutes({
    app, authenticate: (req, _res, next) => { req.user = { username: "alice" }; next(); },
    requirePermission: () => (_req, _res, next) => next(), storagePath, ...options,
  });
  return { app, route };
}

test("HTTP 409 adapter contract recovers local content and applies remote-wins", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase16-conflict-"));
  const storePath = path.join(dir, "objects.json");
  const { app, route } = appFor(storePath);
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fsp.rm(dir, { recursive: true, force: true }); });
  const adapter = createOpaqueSyncAdapter({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  await route.ready;
  const key = crypto.randomBytes(32);
  const remote = protocol.createOperation({ operation: "create", objectId: "object-conflict", fileId: "file-conflict", versionId: "version-1", operationId: "remote-create", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 1, deviceId: "device-a" }, metadata: { path: "note.txt" }, plaintext: Buffer.from("remote"), fileKey: key });
  assert.equal((await adapter.push(remote)).operationId, remote.operationId);
  const root = path.join(dir, "local");
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "note.txt"), "local");
  const engine = await new SyncEngine({ rootDir: root, adapter, deviceId: "device-b", keyEpoch: "epoch-1", compartmentId: "private", fileKeyResolver: () => key }).open();
  await engine.enqueueChange({ operation: "update", objectId: remote.objectId, fileId: remote.fileId, versionId: "local-version", operationId: "local-update", revision: { counter: 2, deviceId: "device-b" }, metadata: { path: "note.txt" }, plaintext: Buffer.from("local"), fileKey: key });
  const summary = { pushed: 0, conflicts: [] };
  await engine.pushPending(summary);
  assert.equal(summary.conflicts.length, 1);
  assert.equal(summary.conflictRecovery, 1);
  assert.equal(await fsp.readFile(path.join(root, "note.txt"), "utf8"), "remote");
  assert.equal((await fsp.readdir(path.join(root, ".rootark-conflicts"))).length, 1);
  assert.deepEqual(await engine.journal.recover(), []);
});

test("device authorization is exact, signed, expiry-bound, and revocable", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase16-authz-"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const registryPath = path.join(dir, "devices.json");
  await fsp.writeFile(registryPath, JSON.stringify({ devices: { "device-a": { username: "alice", publicKey, active: true } } }));
  const { app, route } = appFor(path.join(dir, "objects.json"), { requireDeviceAuthorization: true, deviceRegistryPath: registryPath });
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fsp.rm(dir, { recursive: true, force: true }); });
  await route.ready;
  const key = crypto.randomBytes(32);
  const operation = protocol.createOperation({ operation: "create", objectId: "auth-object", fileId: "auth-file", versionId: "auth-version", operationId: "auth-operation", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 1, deviceId: "device-a" }, metadata: { path: "auth.txt" }, plaintext: Buffer.from("ciphertext-only"), fileKey: key });
  operation.authorization = await createAuthorizationProof(operation, { username: "alice", privateKey: keys.privateKey, publicKey, expiresAt: Date.now() + 60_000 });
  const body = Buffer.from(JSON.stringify(operation));
  const first = await request(server.address().port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json", "content-length": body.length }, body });
  assert.equal(first.status, 201);
  assert.equal((await request(server.address().port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json", "content-length": body.length }, body })).status, 409);
  const expired = { ...operation, operationId: "expired-operation", authorization: { ...operation.authorization, expiresAt: Date.now() - 1 } };
  const expiredBody = Buffer.from(JSON.stringify(expired));
  assert.equal((await request(server.address().port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json", "content-length": expiredBody.length }, body: expiredBody })).status, 403);
  await fsp.writeFile(registryPath, JSON.stringify({ devices: { "device-a": { username: "alice", publicKey, active: false } } }));
  const revoked = { ...operation, operationId: "revoked-operation" };
  const revokedBody = Buffer.from(JSON.stringify(revoked));
  assert.equal((await request(server.address().port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json", "content-length": revokedBody.length }, body: revokedBody })).status, 403);
});

test("two authorized devices separate local send authorization from remote apply verification", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase16-two-device-"));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  let revoked = false;
  const deviceA = crypto.generateKeyPairSync("ed25519");
  const deviceB = crypto.generateKeyPairSync("ed25519");
  const publicDer = (pair) => pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const records = new Map();
  const adapter = {
    async push(operation) { records.set(operation.objectId, operation); return { status: 201, operationId: operation.operationId }; },
    async list() { return [...records.values()]; },
  };
  const authorizeIncoming = async (operation) => verifyAuthorizationProof(operation.authorization, operation, { username: "alice" });
  const engineA = await new SyncEngine({
    rootDir: path.join(dir, "a"), adapter, deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private",
    fileKeyResolver: () => key, authorize: async () => true,
    authorizeOutgoing: async (operation) => !revoked && operation.deviceId === "device-a",
    authorizationFactory: (operation) => createAuthorizationProof(operation, { username: "alice", privateKey: deviceA.privateKey, publicKey: publicDer(deviceA) }),
  }).open();
  await assert.rejects(engineA.enqueueChange({ operation: "create", objectId: "wrong-device", fileId: "wrong-file", versionId: "wrong-version", operationId: "wrong-device-op", deviceId: "device-b", revision: { counter: 1, deviceId: "device-b" }, metadata: { path: "blocked.txt" }, plaintext: Buffer.from("blocked"), fileKey: key }), { code: "authorization_rejected" });
  await engineA.enqueueChange({ operation: "create", objectId: "shared-object", fileId: "shared-file", versionId: "shared-version", operationId: "device-a-op", revision: { counter: 1, deviceId: "device-a" }, metadata: { path: "shared.txt" }, plaintext: Buffer.from("two-device-secret"), fileKey: key });
  await engineA.syncOnce();
  assert.equal(JSON.stringify([...records.values()]).includes("two-device-secret"), false);
  revoked = true;
  await assert.rejects(engineA.enqueueChange({ operation: "update", objectId: "shared-object", fileId: "shared-file", versionId: "revoked-version", operationId: "revoked-local-op", revision: { counter: 2, deviceId: "device-a" }, metadata: { path: "shared.txt" }, plaintext: Buffer.from("revoked"), fileKey: key }), { code: "authorization_rejected" });
  const engineB = await new SyncEngine({
    rootDir: path.join(dir, "b"), adapter, deviceId: "device-b", keyEpoch: "epoch-1", compartmentId: "private",
    fileKeyResolver: () => key, authorize: async () => true, authorizeOutgoing: async (operation) => operation.deviceId === "device-b",
    verifyIncoming: authorizeIncoming,
  }).open();
  const summary = await engineB.syncOnce();
  assert.equal(summary.pulled, 1);
  assert.equal(await fsp.readFile(path.join(dir, "b", "shared.txt"), "utf8"), "two-device-secret");
});

test("sync object history retains encrypted versions and tombstones across restart", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase16-history-"));
  const filePath = path.join(dir, "objects.json");
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const store = await new SyncObjectStore(filePath).open();
  const key = crypto.randomBytes(32);
  const make = (operation, versionId, operationId, counter, baseRevision, plaintext = "x") => protocol.createOperation({ operation, objectId: "history-object", fileId: "history-file", versionId, operationId, deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter, deviceId: "device-a" }, baseRevision, metadata: { path: "history.txt" }, plaintext: Buffer.from(plaintext), fileKey: key });
  const first = make("create", "history-v1", "history-op-1", 1, null, "one");
  const second = make("update", "history-v2", "history-op-2", 2, first.revision, "two");
  const tombstone = make("delete", "history-v3", "history-op-3", 3, second.revision, "");
  await store.put("alice", first); await store.put("alice", second); await store.put("alice", tombstone);
  assert.equal(store.history("alice", "history-object").length, 3);
  assert.equal(store.list("alice")[0].tombstone, true);
  const reopened = await new SyncObjectStore(filePath).open();
  assert.equal(reopened.history("alice", "history-object").length, 3);
  await reopened.transact((next) => { delete next.users.alice.seen["history-op-1"]; });
  assert.ok(["stale", "conflict"].includes((await reopened.put("alice", first)).kind));
});

test("WebDAV mutation journal translates into v2 move and reaches a second client", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase16-webdav-sync-"));
  const rootA = path.join(dir, "a");
  const rootB = path.join(dir, "b");
  await fsp.mkdir(rootA, { recursive: true }); await fsp.mkdir(rootB, { recursive: true });
  const store = await new SyncObjectStore(path.join(dir, "objects.json")).open();
  const key = crypto.randomBytes(32);
  const adapter = { async push(operation) { const result = await store.put("alice", operation); return result.kind === "stored" ? { status: 201 } : { status: 409, current: result.current, currentRevision: result.current?.revision || null }; }, async list() { return store.list("alice"); } };
  const protocolJournal = await new SyncJournal(path.join(dir, "protocol-journal.json")).open();
  const transactionJournal = await new SyncJournal(path.join(dir, "webdav-journal.json")).open();
  const translate = async (event) => {
    const current = store.list("alice")[0];
    const sourcePath = (event.source || event.path).replace(/^\/+/, "");
    const destinationPath = event.destination?.replace(/^\/+/, "") || sourcePath;
    const operation = event.kind === "put" ? (event.existed ? "update" : "create") : event.kind;
    const plaintext = event.kind === "put" ? await fsp.readFile(path.join(rootA, sourcePath)) : Buffer.alloc(0);
    const objectId = current?.objectId || "webdav-object";
    const fileId = current?.fileId || "webdav-file";
    const revision = { counter: (current?.revision?.counter || 0) + 1, deviceId: "device-a" };
    return protocol.createOperation({ operation, objectId, fileId, versionId: `webdav-${event.operationId}`, operationId: `webdav-op-${event.operationId}`, deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision, baseRevision: current?.revision || null, metadata: operation === "move" ? { path: destinationPath, sourcePath } : { path: sourcePath }, plaintext, fileKey: key });
  };
  const bridge = new LocalSyncWebDavBridge({ rootDir: rootA, token: "webdav-sync-token", journal: transactionJournal, protocolJournal, toProtocolOperation: translate });
  await bridge.start();
  t.after(async () => { await bridge.stop(); await fsp.rm(dir, { recursive: true, force: true }); });
  const headers = { authorization: "Bearer webdav-sync-token" };
  await request(bridge.address().port, "/file.txt", { method: "PUT", headers, body: Buffer.from("payload") });
  const a = await new SyncEngine({ rootDir: rootA, journal: protocolJournal, adapter, deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", fileKeyResolver: () => key }).open();
  await a.syncOnce();
  const b = await new SyncEngine({ rootDir: rootB, adapter, deviceId: "device-b", keyEpoch: "epoch-1", compartmentId: "private", fileKeyResolver: () => key }).open();
  await b.syncOnce();
  await request(bridge.address().port, "/file.txt", { method: "MOVE", headers: { ...headers, destination: `http://127.0.0.1:${bridge.address().port}/renamed.txt` } });
  await a.syncOnce();
  await b.syncOnce();
  assert.equal(await fsp.readFile(path.join(rootB, "renamed.txt"), "utf8"), "payload");
  assert.equal(await fsp.stat(path.join(rootB, "file.txt")).then(() => true, () => false), false);
});
