const path = require("path");

const RUNTIME_ROOT = path.resolve(process.cwd());

function resolveRuntimePath(...parts) {
  return path.join(RUNTIME_ROOT, ...parts);
}

module.exports = { RUNTIME_ROOT, resolveRuntimePath };
