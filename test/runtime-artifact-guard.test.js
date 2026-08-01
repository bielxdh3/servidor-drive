const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validateRuntimeArtifacts } = require("../scripts/validate-runtime-artifacts");

test("runtime artifact guard passes cleanly and fails on a disposable seeded database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-artifact-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  assert.doesNotThrow(() => validateRuntimeArtifacts(root));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "rootark.sqlite"), "disposable");
  assert.throws(() => validateRuntimeArtifacts(root), /Runtime artifact guard failed/);
  fs.rmSync(root, { recursive: true, force: true });
});
