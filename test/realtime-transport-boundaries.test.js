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
function message(socket, timeout = 2000) { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("missing WebSocket message")), timeout); socket.once("message", (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString())); }); socket.once("error", reject); }); }
function stop(child) { return new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once("exit", resolve); child.kill(); }); }
async function realtimeServer(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-realtime-contract-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify([{ username: "agent", password: bcrypt.hashSync("password", 10), role: "admin", permissions: {}, sessionVersion: 0 }]));
  fs.symlinkSync(path.join(ROOT, "public"), path.join(dir, "public"), "junction");
  const portNumber = await port();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: dir, env: { ...process.env, PORT: String(portNumber), DB_ENABLED: "false", JWT_SECRET: crypto.randomBytes(48).toString("base64url"), ...extraEnv }, stdio: "ignore", windowsHide: true });
  t.after(async () => { await stop(child); fs.rmSync(dir, { recursive: true, force: true }); });
  await ready(portNumber);
  return { child, portNumber, origin: `http://127.0.0.1:${portNumber}` };
}
async function login(portNumber) { const body = JSON.stringify({ username: "agent", password: "password" }); const response = await request(portNumber, "/auth/login", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body }); assert.equal(response.status, 200); const cookies = response.headers["set-cookie"].map((item) => item.split(";", 1)[0]); return { cookie: cookies.join("; "), csrf: cookies.find((item) => item.startsWith("rootark_csrf=")).split("=", 2)[1] }; }

test("realtime transport declares bounded payload, compression, binary, and burst handling", () => {
  const contents = fs.readFileSync(path.join(ROOT, "src/realtime/server.js"), "utf8");
  assert.match(contents, /maxPayload: REALTIME_MAX_PAYLOAD_BYTES/);
  assert.match(contents, /perMessageDeflate: false/);
  assert.match(contents, /if \(isBinary\) return socket\.close\(1003/);
  assert.match(contents, /REALTIME_MAX_MESSAGES_PER_WINDOW/);
  assert.match(contents, /REALTIME_MAX_BUFFERED_BYTES/);
  assert.match(contents, /socket\.bufferedAmount > REALTIME_MAX_BUFFERED_BYTES/);
  assert.match(contents, /Limite de mensagens excedido/);
  assert.match(contents, /REALTIME_HEARTBEAT_MS/);
  assert.match(contents, /socket\.ping\(\)/);
  assert.match(contents, /socket\.terminate\(\)/);
  assert.match(contents, /server\.once\("close", \(\) => clearInterval\(realtimeHeartbeat\)\)/);
});

test("WebSocket HTTP upgrade enforces cookie, Origin, message, and binary boundaries", { timeout: 20_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-realtime-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify([{ username: "agent", password: bcrypt.hashSync("password", 10), role: "admin", permissions: {}, sessionVersion: 0 }]));
  fs.symlinkSync(path.join(ROOT, "public"), path.join(dir, "public"), "junction");
  const portNumber = await port();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: dir, env: { ...process.env, PORT: String(portNumber), DB_ENABLED: "false", JWT_SECRET: crypto.randomBytes(48).toString("base64url") }, stdio: "ignore", windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } fs.rmSync(dir, { recursive: true, force: true }); });
  await ready(portNumber);
  const body = JSON.stringify({ username: "agent", password: "password" });
  const login = await request(portNumber, "/auth/login", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body });
  const cookie = login.headers["set-cookie"].map((item) => item.split(";", 1)[0]).join("; ");
  const origin = `http://127.0.0.1:${portNumber}`;
  const connect = (headers = {}, requestedOrigin = origin) => new WebSocket(`ws://127.0.0.1:${portNumber}/ws`, { headers, origin: requestedOrigin });
  const allowed = connect({ cookie }); t.after(() => allowed.terminate()); await event(allowed, "connected"); allowed.send("not-json"); allowed.send(JSON.stringify({ event: "ping" })); await event(allowed, "pong");
  const rejected = (socket) => { const events = []; socket.on("message", (raw) => events.push(JSON.parse(raw.toString()))); return close(socket).then((code) => { assert.equal(events.some((item) => item.event === "connected"), false); return code; }); };
  const missing = connect(); assert.equal(await rejected(missing), 1008);
  const malformed = connect({ cookie: "rootark_session=not-a-token" }); assert.equal(await rejected(malformed), 1008);
  const wrongOrigin = connect({ cookie }, "https://evil.test"); assert.equal(await rejected(wrongOrigin), 1008);
  const binary = connect({ cookie }); await event(binary, "connected"); const binaryClose = close(binary); binary.send(Buffer.from([1])); assert.equal(await binaryClose, 1003);
  const oversized = connect({ cookie }); await event(oversized, "connected"); const oversizedClose = close(oversized); oversized.send("x".repeat(17 * 1024)); assert.equal(await oversizedClose, 1009);
  const burst = connect({ cookie }); await event(burst, "connected"); const burstClose = close(burst); for (let index = 0; index < 31; index += 1) burst.send(JSON.stringify({ event: "ping" })); assert.equal(await burstClose, 1008);
});

test("realtime emits connected first and preserves exact notification envelopes", { timeout: 20_000 }, async (t) => {
  const { portNumber, origin } = await realtimeServer(t);
  const credentials = await login(portNumber);
  const socket = new WebSocket(`ws://127.0.0.1:${portNumber}/ws`, { headers: { cookie: credentials.cookie }, origin });
  t.after(() => socket.terminate());
  const first = message(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const connected = await first;
  assert.deepEqual(Object.keys(connected).sort(), ["event", "payload", "timestamp"]);
  assert.equal(connected.event, "connected");
  assert.deepEqual(connected.payload, { username: "agent" });
  assert.ok(Number.isFinite(Date.parse(connected.timestamp)));

  const notificationPromise = message(socket);
  const body = JSON.stringify({ name: "contract-folder" });
  const response = await request(portNumber, "/folders", { method: "POST", headers: { cookie: credentials.cookie, "x-csrf-token": credentials.csrf, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body });
  assert.equal(response.status, 201);
  const notification = await notificationPromise;
  assert.deepEqual(Object.keys(notification).sort(), ["event", "payload", "timestamp"]);
  assert.equal(notification.event, "data:changed");
  assert.deepEqual(notification.payload, { source: "folders" });
  assert.ok(Date.parse(notification.timestamp) >= Date.parse(connected.timestamp));
});

test("realtime message-rate window resets after the configured interval", { timeout: 20_000 }, async (t) => {
  const { portNumber, origin } = await realtimeServer(t, { REALTIME_MAX_MESSAGES_PER_WINDOW: "2", REALTIME_RATE_WINDOW_MS: "1000" });
  const credentials = await login(portNumber);
  const socket = new WebSocket(`ws://127.0.0.1:${portNumber}/ws`, { headers: { cookie: credentials.cookie }, origin });
  t.after(() => socket.terminate());
  await event(socket, "connected");
  socket.send(JSON.stringify({ event: "ping" })); await event(socket, "pong");
  socket.send(JSON.stringify({ event: "ping" })); await event(socket, "pong");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  socket.send(JSON.stringify({ event: "ping" })); await event(socket, "pong");
  socket.send(JSON.stringify({ event: "ping" })); await event(socket, "pong");
  assert.equal(socket.readyState, WebSocket.OPEN);
});

function unresponsiveWebSocket(portNumber, origin, cookie) {
  const key = crypto.randomBytes(16).toString("base64");
  const socket = net.createConnection(portNumber, "127.0.0.1");
  socket.on("error", () => {});
  const handshake = new Promise((resolve, reject) => {
    let response = "";
    const timer = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 2000);
    socket.on("data", (chunk) => { response += chunk.toString("latin1"); if (response.includes("\r\n\r\n")) { clearTimeout(timer); resolve(response); } });
    socket.once("close", () => { clearTimeout(timer); reject(new Error("WebSocket closed before handshake")); });
  });
  const closed = new Promise((resolve) => socket.once("close", resolve));
  socket.once("connect", () => socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${portNumber}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\n\r\n`));
  return { socket, handshake, closed };
}

test("heartbeat terminates an unresponsive idle client and shutdown leaves no child process", { timeout: 20_000 }, async (t) => {
  const { child, portNumber, origin } = await realtimeServer(t, { REALTIME_HEARTBEAT_MS: "1000", REALTIME_IDLE_TIMEOUT_MS: "1000" });
  const credentials = await login(portNumber);
  const raw = unresponsiveWebSocket(portNumber, origin, credentials.cookie);
  t.after(() => raw.socket.destroy());
  const handshake = await raw.handshake;
  assert.match(handshake, /101 Switching Protocols/);
  await Promise.race([raw.closed, new Promise((_, reject) => setTimeout(() => reject(new Error("idle client remained connected")), 4000))]);
  await stop(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
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
  assert.equal((await request(portNumber, "/dav", { method: "PROPFIND", headers: { authorization: basic, "content-type": "application/xml" }, body: "<broken" })).status, 400);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "GET", headers: { authorization: basic } })).status, 200);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "HEAD", headers: { authorization: basic } })).status, 200);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "LOCK", headers: { authorization: basic } })).status, 501);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "UNLOCK", headers: { authorization: basic } })).status, 501);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "PUT", headers: { authorization: basic, "content-length": String(9 * 1024 * 1024) }, body: Buffer.alloc(9 * 1024 * 1024) })).status, 413);
  assert.equal((await request(portNumber, "/dav/upload.bin", { method: "PUT", headers: { authorization: basic, "content-length": "3" }, body: Buffer.from([0, 1, 2]) })).status, 201);
  assert.equal((await request(portNumber, "/dav/upload.bin", { method: "PUT", headers: { "content-length": "3" }, body: "bad" })).status, 401);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "DELETE", headers: { authorization: basic } })).status, 405);
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt" } })).status, 405);
  assert.equal(fs.existsSync(path.join(dir, "temp", "source.txt")), false);
});

test("WebDAV enabled MOVE preserves same-folder files and fails closed for hostile destinations", { timeout: 20_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-webdav-move-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify([{ username: "agent", password: bcrypt.hashSync("password", 10), role: "admin", permissions: { upload: true }, sessionVersion: 0 }]));
  fs.mkdirSync(path.join(dir, "uploads"));
  fs.writeFileSync(path.join(dir, "uploads", "source.txt"), "source");
  fs.writeFileSync(path.join(dir, "uploads", "replace.txt"), "replacement");
  fs.symlinkSync(path.join(ROOT, "public"), path.join(dir, "public"), "junction");
  const portNumber = await port();
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: dir, env: { ...process.env, PORT: String(portNumber), DB_ENABLED: "false", WEBDAV_ENABLED: "true", WEBDAV_ALLOW_MOVE: "true", JWT_SECRET: crypto.randomBytes(48).toString("base64url") }, stdio: "ignore", windowsHide: true });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } fs.rmSync(dir, { recursive: true, force: true }); });
  await ready(portNumber);
  const basic = `Basic ${Buffer.from("agent:password").toString("base64")}`;
  assert.equal((await request(portNumber, "/dav/source.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt" } })).status, 201);
  assert.equal(fs.readFileSync(path.join(dir, "uploads", "target.txt"), "utf8"), "source");
  assert.equal((await request(portNumber, "/dav/target.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt" } })).status, 403);
  assert.equal((await request(portNumber, "/dav/replace.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt" } })).status, 412);
  assert.equal((await request(portNumber, "/dav/replace.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/target.txt", overwrite: "T" } })).status, 204);
  assert.equal(fs.readFileSync(path.join(dir, "uploads", "target.txt"), "utf8"), "replacement");
  assert.equal((await request(portNumber, "/dav/target.txt", { method: "MOVE", headers: { authorization: basic, destination: "https://evil.test/dav/x" } })).status, 409);
  assert.equal((await request(portNumber, "/dav/target.txt", { method: "MOVE", headers: { authorization: basic, destination: "/dav/private/x" } })).status, 409);
});
