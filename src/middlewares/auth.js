const MAX_TOKEN_LENGTH = 4096;
const MAX_FUTURE_IAT_SECONDS = 300;
const JWT_VERIFY_OPTIONS = { algorithms: ["HS256"] };
const { isTotpEnrollmentPath, isTotpRequired } = require("../services/totpPolicy");

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const [key, value] = part.trim().split(/=(.*)/s, 2);
    if (!key || Object.hasOwn(cookies, key)) cookies[key] = undefined;
    else cookies[key] = value;
  }
  return cookies;
}

function verifyClaims(jwt, token, jwtSecret) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) throw new Error("invalid token");
  const claims = jwt.verify(token, jwtSecret, JWT_VERIFY_OPTIONS);
  if (!claims || typeof claims.username !== "string" || !claims.username.trim() || !Number.isInteger(claims.sessionVersion) || claims.sessionVersion < 0) throw new Error("invalid claims");
  if (Number.isFinite(claims.iat) && claims.iat > Math.floor(Date.now() / 1000) + MAX_FUTURE_IAT_SECONDS) throw new Error("future token");
  return claims;
}

function getExpectedOrigin(req) {
  const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  return `${protocol}://${req.headers.host}`;
}

function createAuthenticate({ jwt, jwtSecret, loadUser, normalizeUserPermissions, cookieName = "rootark_session" }) {
  return function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie);
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const token = bearer || cookies[cookieName];
    if (!token) {
      return res.status(401).json({ error: "Token ausente" });
    }

    try {
      const claims = verifyClaims(jwt, token, jwtSecret);
      const user = loadUser(claims.username);
      if (!user || user.disabled || claims.sessionVersion !== (user.sessionVersion || 0)) throw new Error("revoked");
      const enrollmentRequired = isTotpRequired(user) && !user.totpEnabled;
      req.user = {
        username: user.username,
        role: user.role,
        permissions: normalizeUserPermissions(user),
        sessionVersion: user.sessionVersion || 0,
        totpEnabled: Boolean(user.totpEnabled),
        enrollmentOnly: Boolean(claims.totpEnrollment),
      };
      if ((claims.totpEnrollment || enrollmentRequired) && !isTotpEnrollmentPath(req.path)) {
        return res.status(403).json({ error: "2FA enrollment required." });
      }
      req.authType = bearer ? "bearer" : "cookie";
      if (req.authType === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.origin;
        const expectedOrigin = `${req.protocol}://${req.get("host")}`;
        if ((origin && origin !== expectedOrigin) || !cookies.rootark_csrf || req.headers["x-csrf-token"] !== cookies.rootark_csrf) {
          return res.status(403).json({ error: "CSRF invalido" });
        }
      }
      next();
    } catch {
      res.status(401).json({ error: "Token invalido ou expirado" });
    }
  };
}

function createRealtimeAuthenticator({ jwt, jwtSecret, loadUser, normalizeUserPermissions, cookieName = "rootark_session" }) {
  return function authenticateRealtimeToken(token) {
    if (!token) return null;
    try {
      const claims = verifyClaims(jwt, token, jwtSecret);
      if (claims.totpEnrollment) return null;
      const user = loadUser(claims.username);
      if (!user || user.disabled || claims.sessionVersion !== (user.sessionVersion || 0)) return null;
      if (isTotpRequired(user) && !user.totpEnabled) return null;
      return {
        username: user.username,
        role: user.role,
        permissions: normalizeUserPermissions(user),
        sessionVersion: user.sessionVersion || 0,
        totpEnabled: Boolean(user.totpEnabled),
        expiresAt: Number.isFinite(claims.exp) ? claims.exp * 1000 : null,
      };
    } catch {
      return null;
    }
  };
}

module.exports = {
  getExpectedOrigin,
  parseCookies,
  verifyClaims,
  createAuthenticate,
  createRealtimeAuthenticator,
};
