function registerAuthRoutes(app, context) {
  const {
    authenticate,
    auditLog,
    bcrypt,
    checkAnomalies,
    getAuditActor,
    jwt,
    jwtSecret,
    loadUsers,
    logAnalyticsEvent,
    normalizeUserPermissions,
  } = context;

  app.post("/auth/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Usuario e senha obrigatorios" });
    }

    const users = loadUsers();
    const user = users.find((u) => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      auditLog("auth.login.failed", getAuditActor(req, username || "unknown_user"), {
        type: "auth",
        id: username || "unknown_user",
      }, "attempted", "failure", {
        reason: "invalid_credentials",
        attemptedUsername: username || "",
      });
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    const token = jwt.sign(
      { username: user.username, role: user.role, permissions: normalizeUserPermissions(user) },
      jwtSecret,
      { expiresIn: "8h" }
    );

    logAnalyticsEvent("login", {
      username: user.username,
      ip: getAuditActor(req, user.username).ip,
    });
    auditLog("auth.login.success", getAuditActor(req, user.username), { type: "user", id: user.username }, "authenticated", "success", {
      username: user.username,
      role: user.role,
      tokenExpiry: "8h",
    });
    checkAnomalies(req, user.username);

    res.json({ token, username: user.username, role: user.role, permissions: normalizeUserPermissions(user) });
  });

  app.get("/auth/me", authenticate, (req, res) => {
    res.json({
      username: req.user.username,
      role: req.user.role,
      permissions: normalizeUserPermissions(req.user),
    });
  });
}

module.exports = registerAuthRoutes;
