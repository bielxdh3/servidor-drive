const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

const MAX_INPUT_BYTES = Number(process.env.PREVIEW_MAX_INPUT_BYTES || 5 * 1024 * 1024);
const MAX_OUTPUT_CHARS = Number(process.env.PREVIEW_MAX_OUTPUT_CHARS || 200_000);
const TIMEOUT_MS = Number(process.env.PREVIEW_TIMEOUT_MS || 10_000);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"]);
const wordExtractor = new WordExtractor();

function bounded(value) {
  const text = String(value || "");
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[preview truncated]` : text;
}

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("PREVIEW_TIMEOUT")), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function previewText(filePath, fileName) {
  const extension = path.extname(fileName || filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && extension !== ".doc" && extension !== ".docx") throw new Error("PREVIEW_UNSUPPORTED");
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error("PREVIEW_TOO_LARGE");
  if (TEXT_EXTENSIONS.has(extension)) return { content: bounded(fs.readFileSync(filePath, "utf8")), format: "text", language: extension.slice(1) || "text" };
  if (extension === ".docx") return { content: bounded((await withTimeout(mammoth.extractRawText({ path: filePath }))).value), format: "document", language: "docx" };
  return { content: bounded((await withTimeout(wordExtractor.extract(filePath))).getBody()), format: "document", language: "doc" };
}

module.exports = { MAX_INPUT_BYTES, MAX_OUTPUT_CHARS, TIMEOUT_MS, previewText };
