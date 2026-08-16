"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { GroupKeySharing, validateOpaqueWrap } = require("../src/services/groupKeySharing");

const input = (epoch, overrides = {}) => ({
  compartmentId: "private", epoch, objectId: "object-1", versionId: "version-1", keyRef: "file-1",
  recipientId: "alice", deviceId: "device-a", ...overrides,
});

test("Phase 16 group sharing keeps per-recipient wraps opaque and enforces epoch/revocation", async () => {
  const cek = crypto.randomBytes(32);
  const cer = crypto.randomBytes(32);
  const sharing = new GroupKeySharing({ groupId: "group-1", members: ["alice"] });
  const record = await sharing.wrapFor({ ...input(1), cek, cer });
  assert.equal(JSON.stringify(record).includes(cek.toString("base64")), false);
  assert.equal(JSON.stringify(record).includes(cer.toString("base64")), false);
  assert.deepEqual(await sharing.unwrap(record, { ...input(1), cer }), cek);
  assert.throws(() => validateOpaqueWrap({ ...record, plaintext: "secret" }));
  await assert.rejects(sharing.wrapFor({ ...input(1, { recipientId: "bob" }), cek, cer }));

  sharing.rotate();
  await assert.rejects(sharing.unwrap(record, { ...input(1), cer }));
  const rotated = await sharing.wrapFor({ ...input(2), cek, cer });
  assert.deepEqual(await sharing.unwrap(rotated, { ...input(2), cer }), cek);
  sharing.revokeDevice("device-a");
  await assert.rejects(sharing.unwrap(rotated, { ...input(2), cer }));
  assert.equal(JSON.stringify(sharing.manifest()).includes("secret"), false);
});

test("Phase 16 group sharing rejects stale membership and exact-schema smuggling", async () => {
  const sharing = new GroupKeySharing({ groupId: "group-1", members: ["alice"] });
  const cek = crypto.randomBytes(32);
  const cer = crypto.randomBytes(32);
  sharing.removeMember("alice");
  await assert.rejects(sharing.wrapFor({ ...input(1), cek, cer }));
  assert.throws(() => validateOpaqueWrap({
    schemaVersion: 1, suite: "rootark-zk-1", suiteVersion: 1, compartmentId: "private", epoch: 1,
    objectId: "object-1", versionId: "version-1", keyRef: "file-1", recipientId: "alice", deviceId: "device-a",
    wrapId: "AA", wrapped: "AA", aad: "AA", search: "smuggle",
  }));
});
