(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rootark-client-crypto"));
  else root.RootarkProtectedPreview = factory(root.RootarkClientCrypto);
}(typeof globalThis === "object" ? globalThis : this, function (crypto) {
  "use strict";

  const CONTEXT = "Root.ark/protected-preview/v1";

  async function seal({ fileId, contentType, body }, key) {
    const id = String(fileId || "").trim();
    if (!id || typeof body !== "string") throw new Error("Preview protegido invalido");
    return { fileId: id, contentType: String(contentType || "text/plain"), envelope: await crypto.encryptJson({ body, contentType: String(contentType || "text/plain") }, key, CONTEXT) };
  }

  async function open(preview, key) {
    if (!preview?.fileId || !preview.envelope) throw new Error("Preview protegido invalido");
    const payload = await crypto.decryptJson(preview.envelope, key, CONTEXT);
    return { fileId: preview.fileId, contentType: payload.contentType, body: payload.body };
  }

  return { CONTEXT, open, seal };
}));
