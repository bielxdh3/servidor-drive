"use strict";

const ENROLLMENT_PATHS = new Set([
  "/auth/2fa/enroll",
  "/auth/2fa/confirm",
  "/auth/2fa/status",
  "/auth/2fa/policy",
  "/auth/logout",
]);
const VALID_MODES = new Set(["optional", "role-required", "global-required"]);
const DEFAULT_REQUIRED_ROLES = ["admin"];
const TOTP_POLICY_ERROR_CODE = "TOTP_POLICY_INVALID";
const TOTP_POLICY_ERROR_MESSAGE = "Configuracao TOTP invalida.";

function hasConfiguredValue(env, name) {
  return Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined;
}

function invalidPolicyError() {
  const error = new Error(TOTP_POLICY_ERROR_MESSAGE);
  error.code = TOTP_POLICY_ERROR_CODE;
  return error;
}

function getTotpPolicy(env = process.env) {
  const requestedMode = hasConfiguredValue(env, "TOTP_POLICY") ? String(env.TOTP_POLICY).trim().toLowerCase() : "optional";
  if (!VALID_MODES.has(requestedMode)) throw invalidPolicyError();

  const configuredRoles = hasConfiguredValue(env, "TOTP_REQUIRED_ROLES") ? String(env.TOTP_REQUIRED_ROLES).trim() : null;
  const roleValues = configuredRoles === null ? DEFAULT_REQUIRED_ROLES : configuredRoles.split(",").map((role) => role.trim());
  if (roleValues.length === 0 || roleValues.some((role) => !role)) throw invalidPolicyError();

  const mode = requestedMode;
  const roles = new Set(roleValues);
  return { mode, roles };
}

function validateTotpPolicy(env = process.env) {
  return getTotpPolicy(env);
}

function isTotpPolicyError(error) {
  return error?.code === TOTP_POLICY_ERROR_CODE;
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
  isTotpPolicyError,
  TOTP_POLICY_ERROR_MESSAGE,
  validateTotpPolicy,
};
