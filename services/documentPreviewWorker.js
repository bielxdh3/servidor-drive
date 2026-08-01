const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");

async function main() {
  const request = JSON.parse(process.argv[2] || "{}");
  if (!request.filePath || ![".doc", ".docx"].includes(request.extension)) throw new Error("unsupported parser request");
  const value = request.extension === ".docx"
    ? (await mammoth.extractRawText({ path: request.filePath })).value
    : (await new WordExtractor().extract(request.filePath)).getBody();
  process.stdout.write(JSON.stringify({ ok: true, content: String(value || "") }));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || "parser failure").slice(0, 512));
  process.exitCode = 1;
});
