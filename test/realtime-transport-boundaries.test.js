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
});

test("WebDAV HTTP boundary rejects unauthenticated, hostile, traversing, and infinite-depth requests", { timeout: 20_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-webdav-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify([{ username: "agent", password: bcrypt.hashSync("password", 10), role: "user", permissions: { upload: true }, sessionVersion: 0 }]));
  fs.symlinkSync(path.join(ROOT, "public"), path.join(dir, "public"), "junction");
  const portNumber = await port();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: dir, env: { ...process.env, PORT: String(portNumber), DB_ENABLED: "false", WEBDAV_ENABLED: "true", JWT_SECRET: crypto.randomBytes(48).toString("base64url") }, stdio: "ignore", windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } fs.rmSync(dir, { recursive: true, force: true }); });
  await ready(portNumber);
  const basic = `Basic ${Buffer.from("agent:password").toString("base64")}`;
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND" })).status, 401);
  assert.equal((await request(portNumber, "/dav/%252e%252e/secret", { method: "PROPFIND", headers: { authorization: basic } })).status, 400);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, depth: "infinity" } })).status, 400);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, origin: "https://evil.test" } })).status, 403);
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, depth: "0" } })).status, 207);
});
