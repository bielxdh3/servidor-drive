"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const protocol = require("../sync-client/rootark-sync-protocol");
const { SyncJournal } = require("../sync-client/rootark-sync-journal");
const { LocalSyncWebDavBridge } = require("../sync-client/rootark-sync-webdav");
const { MAX_REQUEST_BYTES, registerSyncRoutes } = require("../src/routes/sync");

function request(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, ...options }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function jsonBody(value) { return Buffer.from(JSON.stringify(value)); }

test("Phase 12 protocol encrypts with bound metadata and rejects tampering", () => {
  const key = crypto.randomBytes(32);
  const operation = protocol.createOperation({
    operation: "create", objectId: "object-1", fileId: "file-1", versionId: "version-1",
    operationId: "operation-1", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private",
    revision: { counter: 1, deviceId: "device-a" }, metadata: { path: "folder/file.txt", name: "file.txt", size: 6 },
    plaintext: Buffer.from("secret"), fileKey: key,
  });
  assert.equal(protocol.decryptPayload(operation, key).toString(), "secret");
  assert.throws(() => protocol.decryptPayload({ ...operation, objectId: "object-2" }, key));
  assert.equal(protocol.compareRevisions({ counter: 2, deviceId: "z" }, { counter: 1, deviceId: "z" }) > 0, true);
  const tombstone = protocol.createOperation({ ...operation, operation: "delete", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 2, deviceId: "device-a" } });
  assert.equal(tombstone.tombstone, true);
});

test("Phase 12 journal is durable and recovers pending operations", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase12-journal-"));
  try {
    const filePath = path.join(dir, "journal.json");
    const journal = await new SyncJournal(filePath).open();
    await journal.enqueue({ operationId: "move-1", kind: "move", source: "/a", destination: "/b" });
    await journal.enqueue({ operationId: "delete-1", kind: "delete", source: "/b" });
    await journal.markSeen("move-1");
    const recovered = await new SyncJournal(filePath).open();
    assert.deepEqual((await recovered.recover()).map((item) => item.operationId), ["delete-1"]);
    assert.equal(recovered.hasSeen("move-1"), true);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("Phase 12 local bridge is loopback bearer protected, contained, and trash-backed", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase12-bridge-"));
  const events = [];
  const bridge = new LocalSyncWebDavBridge({ rootDir: dir, token: "bridge-test-token", onOperation: async (event) => events.push(event) });
  await bridge.start();
  t.after(async () => { await bridge.stop(); await fsp.rm(dir, { recursive: true, force: true }); });
  const port = bridge.address().port;
  assert.equal((await request(port, "/", { method: "PROPFIND" })).status, 401);
  const headers = { authorization: "Bearer bridge-test-token" };
  assert.equal((await request(port, "/%2e%2e/outside", { method: "GET", headers })).status, 400);
  assert.equal((await request(port, "/a.txt", { method: "PUT", headers, body: Buffer.from("hello") })).status, 201);
  assert.equal((await request(port, "/a.txt", { method: "GET", headers })).body.toString(), "hello");
  assert.equal((await request(port, "/a.txt", { method: "MOVE", headers: { ...headers, destination: `http://127.0.0.1:${port}/b.txt` } })).status, 201);
  assert.equal((await request(port, "/b.txt", { method: "DELETE", headers })).status, 204);
  assert.equal(fs.existsSync(path.join(dir, "b.txt")), false);
  assert.equal(events.map((event) => event.kind).join(","), "move,delete");
  assert.equal(fs.readdirSync(path.join(dir, ".rootark-trash")).length, 1);
});

test("Phase 12 server route stores opaque records and rejects conflict/replay", async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "rootark-phase12-route-"));
  const app = express();
  app.use((req, res, next) => req.path.startsWith("/sync/v1/") ? next() : express.json()(req, res, next));
  app.use("/sync/v1", express.json({ limit: "9mb" }));
  const authenticate = (req, _res, next) => { req.user = { username: "alice" }; next(); };
  const requirePermission = () => (_req, _res, next) => next();
  const route = registerSyncRoutes({ app, authenticate, requirePermission, storagePath: path.join(dir, "objects.json") });
  const server = await new Promise((resolve) => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fsp.rm(dir, { recursive: true, force: true }); });
  await route.ready;
  const key = crypto.randomBytes(32);
  const create = protocol.createOperation({ operation: "create", objectId: "object-1", fileId: "file-1", versionId: "version-1", operationId: "operation-1", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 1, deviceId: "device-a" }, metadata: { path: "file.txt", name: "file.txt", size: 6 }, plaintext: Buffer.from("secret"), fileKey: key });
  const port = server.address().port;
  const first = await request(port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json", "content-length": jsonBody(create).length }, body: jsonBody(create) });
  assert.equal(first.status, 201);
  assert.equal(first.body.toString().includes("secret"), false);
  assert.equal((await request(port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json" }, body: jsonBody(create) })).status, 409);
  const update = protocol.createOperation({ operation: "update", objectId: "object-1", fileId: "file-1", versionId: "version-2", operationId: "operation-2", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 2, deviceId: "device-a" }, baseRevision: create.revision, metadata: { path: "file.txt", name: "file.txt", size: 7 }, plaintext: Buffer.from("updated"), fileKey: key });
  assert.equal((await request(port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json" }, body: jsonBody(update) })).status, 201);
  const stale = { ...update, operationId: "operation-3", revision: { counter: 1, deviceId: "device-b" } };
  assert.equal((await request(port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json" }, body: jsonBody(stale) })).status, 409);
  const tombstone = { operationId: "operation-delete", fileId: "file-1", versionId: "version-3", deviceId: "device-a", keyEpoch: "epoch-1", compartmentId: "private", revision: { counter: 3, deviceId: "device-a" }, baseRevision: update.revision, metadata: { path: "file.txt", name: "file.txt", size: 0 } };
  const tombstoneBody = jsonBody(tombstone);
  const deleted = await request(port, "/sync/v1/objects/object-1", { method: "DELETE", headers: { "content-type": "application/json", "content-length": tombstoneBody.length }, body: tombstoneBody });
  assert.equal(deleted.status, 200);
  assert.equal(JSON.parse(deleted.body).tombstone, true);
  assert.equal((await request(port, "/sync/v1/objects/object-1", { method: "DELETE", headers: { "content-type": "application/json", "content-length": tombstoneBody.length }, body: tombstoneBody })).status, 409);
  assert.equal((await request(port, "/sync/v1/objects", { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.alloc(MAX_REQUEST_BYTES + 1, "x") })).status, 413);
  assert.equal((await request(port, "/sync/v1/objects/object-1", { method: "GET" })).status, 200);
  const persisted = JSON.parse(await fsp.readFile(path.join(dir, "objects.json"), "utf8"));
  assert.equal(Object.hasOwn(persisted.users.alice.objects["object-1"], "fileKey"), false);
});
