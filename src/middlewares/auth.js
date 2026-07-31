function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split(/=(.*)/s, 2)).filter(([key]) => key));
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
      const claims = jwt.verify(token, jwtSecret);
      const user = loadUser(claims.username);
      if (!user || user.disabled || claims.sessionVersion !== (user.sessionVersion || 0)) throw new Error("revoked");
      req.user = { username: user.username, role: user.role, permissions: normalizeUserPermissions(user), sessionVersion: user.sessionVersion || 0 };
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
      const claims = jwt.verify(token, jwtSecret);
      const user = loadUser(claims.username);
      if (!user || user.disabled || claims.sessionVersion !== (user.sessionVersion || 0)) return null;
      return { username: user.username, role: user.role, permissions: normalizeUserPermissions(user), sessionVersion: user.sessionVersion || 0, expiresAt: Number.isFinite(claims.exp) ? claims.exp * 1000 : null };
    } catch {
      return null;
    }
  };
}

module.exports = {
  getExpectedOrigin,
  parseCookies,
  createAuthenticate,
  createRealtimeAuthenticator,
};
