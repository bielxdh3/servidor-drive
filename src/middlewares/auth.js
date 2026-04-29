function createAuthenticate({ jwt, jwtSecret }) {
  return function authenticate(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente" });
    }

    try {
      req.user = jwt.verify(auth.slice(7), jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: "Token invalido ou expirado" });
    }
  };
}

function createRealtimeAuthenticator({ jwt, jwtSecret }) {
  return function authenticateRealtimeToken(token) {
    if (!token) return null;
    try {
      return jwt.verify(token, jwtSecret);
    } catch {
      return null;
    }
  };
}

module.exports = {
  createAuthenticate,
  createRealtimeAuthenticator,
};
