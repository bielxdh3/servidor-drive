const { test, expect } = require("@playwright/test");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const PUBLIC = path.join(ROOT, "public");
const TIMEOUT_MS = 20_000;

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

function waitForHttp(port) {
  const deadline = Date.now() + TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ host: "127.0.0.1", port, path: "/login.html" }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.once("error", (error) => {
        if (Date.now() >= deadline) reject(error);
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function createSandbox(username, password) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-playwright-xss-"));
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });
  fs.symlinkSync(PUBLIC, path.join(sandbox, "public"), "dir");
  fs.writeFileSync(path.join(sandbox, "data", "users.local.json"), JSON.stringify([
    {
      username,
      password: bcrypt.hashSync(password, 10),
      role: "admin",
      sessionVersion: 0,
      disabled: false,
      permissions: {},
    },
  ], null, 2));
  return sandbox;
}

test("analytics login payload reaches dashboard and is rendered only as text", async ({ browser }) => {
  const payload = `<img id="rootark-xss-probe" src=x onerror="document.body.dataset.rootarkXss='executed'">`;
  const password = "Disposable-Playwright-Password-17";
  const sandbox = createSandbox(payload, password);
  const port = await getUnusedPort();
  const jwtSecret = crypto.randomBytes(48).toString("base64url");
  const child = spawn(process.execPath, [SERVER], {
    cwd: sandbox,
    env: {
      ...process.env,
      PORT: String(port),
      DB_ENABLED: "false",
      JWT_SECRET: jwtSecret,
      CLOUD_STORAGE_PROVIDER: "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });

  try {
    expect(await waitForHttp(port)).toBe(200);
    const baseUrl = `http://127.0.0.1:${port}`;
    const context = await browser.newContext();
    await context.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.Chart = class Chart { constructor() {} destroy() {} };",
    }));

    const login = await context.request.post(`${baseUrl}/auth/login`, {
      data: { username: payload, password },
    });
    expect(login.status(), await login.text()).toBe(200);

    const analyticsFile = path.join(sandbox, "data", "analytics.json");
    await expect.poll(() => fs.existsSync(analyticsFile)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(analyticsFile, "utf8"));
    expect(persisted.logins.some((entry) => entry.username === payload)).toBe(true);

    const recentResponse = await context.request.get(`${baseUrl}/analytics/recent?limit=20`);
    expect(recentResponse.status(), await recentResponse.text()).toBe(200);
    const recent = await recentResponse.json();
    expect(recent.some((entry) => entry.type === "login" && entry.username === payload)).toBe(true);

    const page = await context.newPage();
    const analyticsStatuses = [];
    page.on("response", (response) => {
      if (response.url().includes("/analytics/")) analyticsStatuses.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "domcontentloaded" });

    const eventText = page.locator("#recentActivity .event-text", { hasText: payload });
    await expect(eventText, `analytics responses: ${analyticsStatuses.join(", ")}`).toHaveCount(1);
    await expect(eventText).toContainText(payload);
    await expect(page.locator("#rootark-xss-probe")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.dataset.rootarkXss || "")).toBe("");
    expect(await eventText.evaluate((node) => node.textContent)).toContain(payload);

    await context.close();
  } catch (error) {
    throw new Error(`${error.message}\n--- server output ---\n${serverOutput}`);
  } finally {
    await stopServer(child);
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
