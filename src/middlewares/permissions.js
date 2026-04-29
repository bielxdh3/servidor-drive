function createRequirePermission() {
  return function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user?.permissions?.[permission]) {
        return res.status(403).json({ error: `Permissao negada: ${permission}` });
      }
      next();
    };
  };
}

module.exports = {
  createRequirePermission,
};
