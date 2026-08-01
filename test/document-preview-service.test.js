const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { previewText } = require("../services/documentPreviewService");

test("document preview bounds text inputs", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootark-preview-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => { const target = path.join(dir, name); fs.writeFileSync(target, value); return target; };
  await t.test("small UTF-8 text is returned", async () => assert.equal((await previewText(write("small.txt", "olá"), "small.txt")).content, "olá"));
  await t.test("Unicode filenames are accepted", async () => assert.equal((await previewText(write("文档.md", "ok"), "文档.md")).language, "md"));
  await t.test("binary extension is rejected", async () => await assert.rejects(previewText(write("binary.exe", Buffer.from([0, 255])), "binary.exe"), /PREVIEW_UNSUPPORTED/));
  await t.test("unsupported extension is rejected", async () => await assert.rejects(previewText(write("image.png", "x"), "image.png"), /PREVIEW_UNSUPPORTED/));
  await t.test("script-like text stays literal", async () => assert.match((await previewText(write("script.txt", "<script>alert(1)</script>"), "script.txt")).content, /<script>/));
  await t.test("event-handler-like text stays literal", async () => assert.match((await previewText(write("event.txt", "onerror=alert(1)"), "event.txt")).content, /onerror/));
});
