const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { createAuthenticate, getExpectedOrigin } = require("../src/middlewares/auth");

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
