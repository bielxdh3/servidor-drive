const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const archiver = require("archiver");

test("Archiver 8 creates a ZIP archive", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-archiver-"));
  const archivePath = path.join(tempDir, "backup.zip");
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append("disposable", { name: "validation.txt" });
      archive.finalize();
    });
    assert.ok(fs.statSync(archivePath).size > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
