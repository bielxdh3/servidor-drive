const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("node:child_process");

const MAX_INPUT_BYTES = Number(process.env.PREVIEW_MAX_INPUT_BYTES || 5 * 1024 * 1024);
const MAX_OUTPUT_CHARS = Number(process.env.PREVIEW_MAX_OUTPUT_CHARS || 200_000);
const TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 10_000);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"]);
const PARSER_WORKER = path.join(__dirname, "documentPreviewWorker.js");

function bounded(value) {
  const text = String(value || "");
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[preview truncated]` : text;
}

function killParserProcess(child) {
  if (!child || child.exitCode !== null && child.exitCode !== undefined) return;
  try { child.kill("SIGKILL"); } catch {}
  if (process.platform === "win32" && child.pid) {
    try { spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
}

function parserFailure(message, code = "PREVIEW_PARSER_FAILED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseDocumentInChildProcess(filePath, extension, options = {}) {
  const spawnProcess = options.spawnImpl || spawn;
  const timeout = Number(options.timeoutMs ?? TIMEOUT_MS);
  const maxOutputBytes = Number(options.maxOutputBytes ?? Math.max(16_384, MAX_OUTPUT_CHARS * 8));
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timer;
    let output = "";
    let errorOutput = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => killParserProcess(child);
    try {
      child = spawnProcess(process.execPath, [PARSER_WORKER, JSON.stringify({ filePath, extension })], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish(parserFailure("Falha ao iniciar parser", "PREVIEW_PARSER_START_FAILED"));
      return;
    }
    timer = setTimeout(() => {
      stop();
      finish(parserFailure("PREVIEW_TIMEOUT", "PREVIEW_TIMEOUT"));
    }, Math.max(1, timeout));
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > maxOutputBytes) {
        stop();
        finish(parserFailure("PREVIEW_OUTPUT_TOO_LARGE", "PREVIEW_OUTPUT_TOO_LARGE"));
      }
    });
    child.stderr?.on("data", (chunk) => {
      errorOutput += chunk.toString().slice(0, 512);
    });
    child.once("error", () => finish(parserFailure("Falha no parser", "PREVIEW_PARSER_FAILED")));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(parserFailure(errorOutput.includes("PREVIEW_TIMEOUT") ? "PREVIEW_TIMEOUT" : "Falha no parser", errorOutput.includes("PREVIEW_TIMEOUT") ? "PREVIEW_TIMEOUT" : "PREVIEW_PARSER_FAILED"));
        return;
      }
      try {
        const message = JSON.parse(output);
        if (!message || message.ok !== true) throw new Error("invalid parser response");
        finish(null, bounded(message.content));
      } catch {
        finish(parserFailure("Resposta de parser invalida", "PREVIEW_PARSER_FAILED"));
      }
    });
  });
}

async function previewText(filePath, fileName, options = {}) {
  const extension = path.extname(fileName || filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && extension !== ".doc" && extension !== ".docx") throw new Error("PREVIEW_UNSUPPORTED");
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error("PREVIEW_TOO_LARGE");
  if (TEXT_EXTENSIONS.has(extension)) return { content: bounded(fs.readFileSync(filePath, "utf8")), format: "text", language: extension.slice(1) || "text" };
  const content = await parseDocumentInChildProcess(filePath, extension, options);
  return { content, format: "document", language: extension.slice(1) };
}

module.exports = { MAX_INPUT_BYTES, MAX_OUTPUT_CHARS, TIMEOUT_MS, PARSER_WORKER, previewText, parseDocumentInChildProcess, killParserProcess };
