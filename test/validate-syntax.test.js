const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const test = require("node:test");

const validator = path.resolve(__dirname, "..", "scripts", "validate-syntax.js");

test("syntax validator accepts valid files and rejects invalid or missing files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-syntax-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const valid = path.join(directory, "valid.js");
  const invalid = path.join(directory, "invalid.js");
  const missing = path.join(directory, "missing.js");
  fs.writeFileSync(valid, "module.exports = 1;\n");
  fs.writeFileSync(invalid, "module.exports = ;\n");

  const run = (file) => spawnSync(process.execPath, [validator, file], { encoding: "utf8" });
  assert.equal(run(valid).status, 0);
  assert.notEqual(run(invalid).status, 0);
  assert.notEqual(run(missing).status, 0);
});
