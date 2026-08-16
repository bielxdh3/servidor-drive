const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const test = require("node:test");
const { createAuthenticate, parseCookies, verifyClaims } = require("../src/middlewares/auth");

const SECRET = "a".repeat(48);
const valid = (claims = {}, options = {}) => jwt.sign({ username: "alice", sessionVersion: 2, ...claims }, SECRET, { algorithm: "HS256", ...options });
function auth(headers = {}, claims = { username: "alice", sessionVersion: 2 }) {
  let result;
  createAuthenticate({ jwt: { verify: () => claims }, jwtSecret: SECRET, loadUser: () => ({ username: "alice", sessionVersion: 2, permissions: {} }), normalizeUserPermissions: (user) => user.permissions })({ headers, method: "GET", protocol: "http", get: () => "localhost" }, { status: (code) => ({ json: (body) => { result = { code, body }; } }) }, () => { result = { ok: true }; });
  return result;
}

test("JWT claim boundary accepts only current HS256 session identities", async (t) => {
  await t.test("explicit HS256 allowlist", () => assert.equal(verifyClaims(jwt, valid(), SECRET).username, "alice"));
  for (const [name, token] of [
    ["none", `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"username":"alice","sessionVersion":2}').toString("base64url")}.`],
    ["unexpected symmetric algorithm", jwt.sign({ username: "alice", sessionVersion: 2 }, SECRET, { algorithm: "HS384" })],
    ["malformed header", "not-a-token"],
    ["malformed payload", `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.not-json.signature`],
    ["invalid signature", `${valid()}.tampered`],
    ["expired token", valid({}, { expiresIn: -1 })],
    ["future nbf", valid({}, { notBefore: "1h" })],
    ["future iat", valid({ iat: Math.floor(Date.now() / 1000) + 301 })],
    ["missing identity", jwt.sign({ sessionVersion: 2 }, SECRET, { algorithm: "HS256" })],
    ["missing session version", jwt.sign({ username: "alice" }, SECRET, { algorithm: "HS256" })],
    ["noninteger session version", jwt.sign({ username: "alice", sessionVersion: 2.5 }, SECRET, { algorithm: "HS256" })],
    ["oversized token", "x".repeat(4097)],
  ]) await t.test(name, () => assert.throws(() => verifyClaims(jwt, token, SECRET)));
});

test("cookie parsing fails closed on duplicates and bearer remains deliberate precedence", () => {
  assert.equal(parseCookies("rootark_session=a; rootark_session=b").rootark_session, undefined);
  assert.equal(auth({ authorization: "Bearer token", cookie: "rootark_session=other" }).ok, true);
  assert.equal(auth({ cookie: "rootark_session=a; rootark_session=b" }).code, 401);
});

test("middleware suppresses token parsing detail", () => {
  const denied = auth({ authorization: "Bearer token" }, { username: "alice", sessionVersion: "bad" });
  assert.deepEqual(denied, { code: 401, body: { error: "Token invalido ou expirado" } });
});

test("enrollment-only sessions cannot reach application routes or realtime", () => {
  const middleware = createAuthenticate({
    jwt: { verify: () => ({ username: "alice", sessionVersion: 2, totpEnrollment: true }) },
    jwtSecret: SECRET,
    loadUser: () => ({ username: "alice", sessionVersion: 2, permissions: {} }),
    normalizeUserPermissions: (user) => user.permissions,
  });
  let result;
  const deniedReq = { headers: { authorization: "Bearer token" }, method: "GET", path: "/files", protocol: "http", get: () => "localhost" };
  middleware(deniedReq, { status: (code) => ({ json: (body) => { result = { code, body }; } }) }, () => { result = { ok: true }; });
  assert.equal(result.code, 403);
  const allowedReq = { ...deniedReq, path: "/auth/2fa/enroll" };
  middleware(allowedReq, { status: (code) => ({ json: (body) => { result = { code, body }; } }) }, () => { result = { ok: true, user: allowedReq.user }; });
  assert.equal(result.ok, true);
  const realtime = require("../src/middlewares/auth").createRealtimeAuthenticator({
    jwt: { verify: () => ({ username: "alice", sessionVersion: 2, totpEnrollment: true }) },
    jwtSecret: SECRET,
    loadUser: () => ({ username: "alice", sessionVersion: 2, permissions: {} }),
    normalizeUserPermissions: (user) => user.permissions,
  });
  assert.equal(realtime("token"), null);
});
