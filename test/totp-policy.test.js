const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getTotpPolicy,
  isTotpPolicyError,
  isTotpRequired,
  TOTP_POLICY_ERROR_MESSAGE,
  validateTotpPolicy,
} = require("../src/services/totpPolicy");

test("TOTP policy defaults to optional with admin as the implicit required role", () => {
  const policy = getTotpPolicy({});
  assert.equal(policy.mode, "optional");
  assert.deepEqual([...policy.roles], ["admin"]);
  assert.equal(isTotpRequired({ role: "admin" }, getTotpPolicy({ TOTP_POLICY: "role-required" })), true);
});

test("explicit valid TOTP policy modes normalize to their canonical values", () => {
  for (const mode of ["optional", "role-required", "global-required"]) {
    assert.equal(getTotpPolicy({ TOTP_POLICY: ` ${mode.toUpperCase()} ` }).mode, mode);
  }
});

test("invalid policy modes and explicit blank role lists fail closed", () => {
  for (const env of [
    { TOTP_POLICY: "role-requred" },
    { TOTP_POLICY: "" },
    { TOTP_POLICY: "role-required", TOTP_REQUIRED_ROLES: "" },
    { TOTP_POLICY: "role-required", TOTP_REQUIRED_ROLES: "   " },
    { TOTP_POLICY: "role-required", TOTP_REQUIRED_ROLES: "admin,,auditor" },
  ]) {
    assert.throws(() => getTotpPolicy(env), (error) => {
      assert.equal(isTotpPolicyError(error), true);
      assert.equal(error.message, TOTP_POLICY_ERROR_MESSAGE);
      return true;
    });
  }
});

test("startup/config validation uses the same fail-closed policy boundary", () => {
  assert.equal(validateTotpPolicy({ TOTP_POLICY: "global-required" }).mode, "global-required");
  assert.throws(() => validateTotpPolicy({ TOTP_POLICY: "invalid" }), { code: "TOTP_POLICY_INVALID" });
});
