"use strict";

const ENROLLMENT_PATHS = new Set([
  "/auth/2fa/enroll",
  "/auth/2fa/confirm",
  "/auth/2fa/status",
  "/auth/2fa/policy",
  "/auth/logout",
]);

function getTotpPolicy(env = process.env) {
  const requestedMode = String(env.TOTP_POLICY || "optional").trim().toLowerCase();
  const mode = ["optional", "role-required", "global-required"].includes(requestedMode) ? requestedMode : "optional";
  const roles = new Set(String(env.TOTP_REQUIRED_ROLES || "admin").split(",").map((role) => role.trim()).filter(Boolean));
  return { mode, roles };
}

function isTotpRequired(user, policy = getTotpPolicy()) {
  return policy.mode === "global-required" || policy.mode === "role-required" && policy.roles.has(user?.role);
}

function isTotpEnrollmentPath(path) {
  return ENROLLMENT_PATHS.has(path);
}

module.exports = {
  getTotpPolicy,
  isTotpEnrollmentPath,
  isTotpRequired,
};
