const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const test = require("node:test");
const fs = require("node:fs");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createAuthenticate, getExpectedOrigin } = require("../src/middlewares/auth");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const PUBLIC = path.join(ROOT, "public");

function getUnusedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, requestPath, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method, headers }, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.once("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await request(port, "/login.html");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function login(port, username, password) {
  const body = JSON.stringify({ username, password });
  const response = await request(port, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  });
  assert.equal(response.status, 200);
  const cookies = response.headers["set-cookie"].map((cookie) => cookie.split(";", 1)[0]);
  return { cookie: cookies.join("; "), csrf: cookies.find((cookie) => cookie.startsWith("rootark_csrf=")).split("=", 2)[1] };
}

function createSandbox(users) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-permission-removal-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "users.json"), JSON.stringify(users));
  fs.symlinkSync(PUBLIC, path.join(dir, "public"), "junction");
  return dir;
}

function authenticateRequest({ headers = {}, method = "GET", user = { username: "alice", role: "user", permissions: {}, sessionVersion: 2 } } = {}) {
  const middleware = createAuthenticate({
    jwt: { verify: () => ({ username: "alice", sessionVersion: 2 }) },
    jwtSecret: "test",
    loadUser: () => user,
    normalizeUserPermissions: (current) => current.permissions,
  });
  const req = { headers, method, protocol: "http", get: () => "localhost" };
  let result;
  const res = { status: (code) => ({ json: (body) => { result = { code, body }; } }) };
  middleware(req, res, () => { result = { user: req.user, authType: req.authType }; });
  return result;
}

test("cookie session requires CSRF for state changes", () => {
  assert.equal(authenticateRequest({ method: "POST", headers: { cookie: "rootark_session=t; rootark_csrf=c" } }).code, 403);
  assert.equal(authenticateRequest({ method: "POST", headers: { cookie: "rootark_session=t; rootark_csrf=c", "x-csrf-token": "c", origin: "http://localhost" } }).authType, "cookie");
});

test("WebSocket Origin honors trusted proxy HTTPS forwarding", () => {
  assert.equal(getExpectedOrigin({ headers: { host: "rootark.test", "x-forwarded-proto": "https" }, socket: { encrypted: false } }), "https://rootark.test");
});

test("WebDAV uses the Express 5 named wildcard syntax", () => {
  const contents = fs.readFileSync("server.js", "utf8");
  assert.match(contents, /app\.all\(`\$\{WEBDAV_PATH\}\/\*splat`, handler\)/);
});

test("revoked and disabled users cannot use old tokens", () => {
  assert.equal(authenticateRequest({ user: { username: "alice", disabled: true, sessionVersion: 2 } }).code, 401);
  assert.equal(authenticateRequest({ user: { username: "alice", sessionVersion: 3 } }).code, 401);
});

test("permission removal revokes an existing browser session before a protected HTTP handler", { timeout: 30_000 }, async (t) => {
  const password = crypto.randomBytes(24).toString("base64url");
  const users = ["admin", "agent"].map((username) => ({
    username,
    password: bcrypt.hashSync(password, 10),
    role: "user",
    permissions: { manageUsers: true },
    sessionVersion: 0,
  }));
  const cwd = createSandbox(users);
  const port = await getUnusedPort();
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: { ...process.env, PORT: String(port), DB_ENABLED: "false", JWT_SECRET: crypto.randomBytes(48).toString("base64url") },
    stdio: "ignore",
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  assert.equal((await waitForServer(port)).status, 200);
  const agent = await login(port, "agent", password);
  assert.equal((await request(port, "/storage/status", { headers: { cookie: agent.cookie } })).status, 200);

  const admin = await login(port, "admin", password);
  const body = JSON.stringify({ permissions: { manageUsers: false } });
  assert.equal((await request(port, "/users/agent", {
    method: "PUT",
    headers: {
      cookie: admin.cookie,
      origin: `http://127.0.0.1:${port}`,
      "x-csrf-token": admin.csrf,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
    body,
  })).status, 200);

  const denied = await request(port, "/storage/status", { headers: { cookie: agent.cookie } });
  assert.equal(denied.status, 401);
  assert.match(denied.body, /Token invalido ou expirado/);
});

test("expired browser session cookie is rejected before a protected HTTP handler", { timeout: 30_000 }, async (t) => {
  const password = crypto.randomBytes(24).toString("base64url");
  const users = [{
    username: "agent",
    password: bcrypt.hashSync(password, 10),
    role: "user",
    permissions: { manageUsers: true },
    sessionVersion: 0,
  }];
  const cwd = createSandbox(users);
  const port = await getUnusedPort();
  const jwtSecret = crypto.randomBytes(48).toString("base64url");
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: { ...process.env, PORT: String(port), DB_ENABLED: "false", JWT_SECRET: jwtSecret },
    stdio: "ignore",
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  assert.equal((await waitForServer(port)).status, 200);
  const session = await login(port, "agent", password);
  assert.equal((await request(port, "/storage/status", { headers: { cookie: session.cookie } })).status, 200);

  const expired = jwt.sign({ username: "agent", sessionVersion: 0 }, jwtSecret, { expiresIn: -1 });
  const denied = await request(port, "/storage/status", { headers: { cookie: `rootark_session=${expired}` } });
  assert.equal(denied.status, 401);
  assert.match(denied.body, /Token invalido ou expirado/);
});

test("browser pages contain no persisted auth keys or WebSocket token URLs", () => {
  for (const file of ["login.html", "index.html", "dashboard.html", "admin.html", "audit.html", "backups.html"]) {
    const contents = fs.readFileSync(`public/${file}`, "utf8");
    assert.doesNotMatch(contents, /localStorage\.(getItem|setItem|clear)\([^)]*(token|permissions|username|role)/);
    assert.doesNotMatch(contents, /\/ws\?token/);
  }
});

test("dashboard activity uses DOM text rather than HTML interpolation", () => {
  const contents = fs.readFileSync("public/dashboard.html", "utf8");
  assert.doesNotMatch(contents, /recentActivity"\)\.innerHTML/);
  assert.match(contents, /recentActivity\.append\(item\)/);
});

test("session bootstrap escapes identity data before embedding JavaScript", () => {
  const contents = fs.readFileSync("server.js", "utf8");
  assert.match(contents, /JSON\.stringify\([^\n]+\.replace\(\/</);
});
