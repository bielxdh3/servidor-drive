const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const WebSocket = require("ws");

const ROOT = path.resolve(__dirname, "..");
function port() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); }); }); }
function request(portNumber, requestPath, options = {}) { return new Promise((resolve, reject) => { const req = http.request({ host: "127.0.0.1", port: portNumber, path: requestPath, ...options }, (res) => { let body = ""; res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); }); req.once("error", reject); req.end(options.body); }); }
async function ready(portNumber) { for (let index = 0; index < 100; index += 1) { try { await request(portNumber, "/login.html"); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); } } throw new Error("server did not start"); }
function event(socket, name) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`missing ${name}`)), 2000); socket.on("message", (raw) => { const message = JSON.parse(raw); if (message.event === name) { clearTimeout(timer); resolve(message); } }); socket.once("error", reject); }); }
function close(socket) { return new Promise((resolve) => socket.once("close", (code) => resolve(code))); }

test("realtime transport declares bounded payload, compression, binary, and burst handling", () => {
  const contents = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(contents, /maxPayload: REALTIME_MAX_PAYLOAD_BYTES/);
  assert.match(contents, /perMessageDeflate: false/);
  assert.match(contents, /if \(isBinary\) return socket\.close\(1003/);
  assert.match(contents, /REALTIME_MAX_MESSAGES_PER_WINDOW/);
  assert.match(contents, /Limite de mensagens excedido/);
  assert.match(contents, /REALTIME_HEARTBEAT_MS/);
  assert.match(contents, /socket\.ping\(\)/);
  assert.match(contents, /socket\.terminate\(\)/);
  assert.match(contents, /server\.once\("close", \(\) => clearInterval\(realtimeHeartbeat\)\)/);
});

test("WebDAV HTTP boundary rejects unauthenticated, hostile, traversing, and infinite-depth requests", { timeout: 20_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-webdav-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify([{ username: "agent", password: bcrypt.hashSync("password", 10), role: "admin", permissions: { upload: true }, sessionVersion: 0 }]));
  fs.mkdirSync(path.join(dir, "uploads"));
  fs.writeFileSync(path.join(dir, "uploads", "source.txt"), "source");
  fs.symlinkSync(path.join(ROOT, "public"), path.join(dir, "public"), "junction");
  const portNumber = await port();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: dir, env: { ...process.env, PORT: String(portNumber), DB_ENABLED: "false", WEBDAV_ENABLED: "true", UPLOAD_SCAN_ENABLED: "false", JWT_SECRET: crypto.randomBytes(48).toString("base64url") }, stdio: "ignore", windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } fs.rmSync(dir, { recursive: true, force: true }); });
  await ready(portNumber);
  const basic = `Basic ${Buffer.from("agent:password").toString("base64")}`;
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND" })).status, 401);
  assert.equal((await request(portNumber, "/dav/%252e%252e/secret", { method: "PROPFIND", headers: { authorization: basic } })).status, 400);
  assert.equal((await request(portNumber, "/dav/%5Csecret", { method: "PROPFIND", headers: { authorization: basic } })).status, 400);
  assert.equal((await request(portNumber, "/dav//secret", { method: "PROPFIND", headers: { authorization: basic } })).status, 404);
  assert.equal((await request(portNumber, "/dav/../secret", { method: "PROPFIND", headers: { authorization: basic } })).status, 404);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, depth: "infinity" } })).status, 400);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, origin: "https://evil.test" } })).status, 403);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, depth: "0" } })).status, 207);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, depth: "1" } })).status, 207);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, "content-type": "application/xml" }, body: "<broken" })).status, 207);
  assert.equal((await request(portNumber, "/dav/upload.bin", { method: "PUT", headers: { authorization: basic, "content-length": "3" }, body: Buffer.from([0, 1, 2]) })).status, 201);
  assert.equal((await request(portNumber, "/dav/upload.bin", { method: "PUT", headers: { "content-length": "3" }, body: "bad" })).status, 401);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "DELETE", headers: { authorization: basic } })).status, 405);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt" } })).status, 405);
  assert.equal(fs.existsSync(path.join(dir, "temp", "source.txt")), false);
});
