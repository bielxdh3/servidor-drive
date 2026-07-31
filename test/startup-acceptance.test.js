const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const PUBLIC = path.join(ROOT, "public");
const TIMEOUT_MS = 10_000;

function getUnusedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sanitize(output, secrets) {
  return secrets.reduce((value, secret) => value.split(secret).join("[redacted]"), output);
}

function waitForExit(child, timeoutMs, secrets) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process did not exit within ${timeoutMs}ms`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  }).catch((error) => {
    throw new Error(sanitize(error.message, secrets));
  });
}

function startServer({ cwd, port, jwtSecret }) {
  const env = { ...process.env, PORT: String(port), DB_ENABLED: "false" };
  if (jwtSecret === undefined) delete env.JWT_SECRET;
  else env.JWT_SECRET = jwtSecret;
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return { child, output: () => output };
}

async function request(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/login.html" }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.setTimeout(1_000, () => req.destroy(new Error("request timed out")));
    req.once("error", reject);
  });
}

async function waitForServer(port, secrets) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await request(port);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(sanitize(`server did not become reachable: ${lastError?.message || "unknown error"}`, secrets));
}

async function stop(child, secrets) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await waitForExit(child, TIMEOUT_MS, secrets);
}

function createSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-startup-"));
  fs.symlinkSync(PUBLIC, path.join(dir, "public"), "junction");
  return dir;
}

test("startup accepts only an explicit strong JWT_SECRET", { timeout: 45_000 }, async (t) => {
  const weakSecret = "rootark-test-weak-secret";
  const strongSecret = crypto.randomBytes(48).toString("base64url");
  const secrets = [weakSecret, strongSecret];
  const sandboxes = [];
  let running;
  t.after(async () => {
    await stop(running?.child, secrets);
    for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const [name, jwtSecret] of [["missing", undefined], ["weak", weakSecret]]) {
    const cwd = createSandbox();
    sandboxes.push(cwd);
    const port = await getUnusedPort();
    const launched = startServer({ cwd, port, jwtSecret });
    const result = await waitForExit(launched.child, TIMEOUT_MS, secrets);
    const output = sanitize(launched.output(), secrets);
    assert.notEqual(result.code, 0, `${name} secret unexpectedly succeeded`);
    assert.match(output, /JWT_SECRET deve ser definido explicitamente/);
    assert.equal(output.includes("[redacted]"), false, `${name} secret was echoed`);
  }

  const cwd = createSandbox();
  sandboxes.push(cwd);
  const port = await getUnusedPort();
  running = startServer({ cwd, port, jwtSecret: strongSecret });
  assert.equal(await waitForServer(port, secrets), 200);
  await stop(running.child, secrets);
  assert.equal(sanitize(running.output(), secrets).includes("[redacted]"), false, "strong secret was echoed");
});
