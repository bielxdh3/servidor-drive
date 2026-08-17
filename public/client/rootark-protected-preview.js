(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rootark-client-crypto"));
  else root.RootarkProtectedPreview = factory(root.RootarkClientCrypto);
}(typeof globalThis === "object" ? globalThis : this, function (crypto) {
  "use strict";

  const CONTEXT = "Root.ark/protected-preview/v2";
  const PREVIEW_FORMAT = "rootark-protected-preview-v2";

  function value(input, name) {
    const result = String(input || "").trim();
    if (!result || result.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error(`Preview ${name} invalido`);
    return result;
  }

  function mime(input) {
    const result = String(input || "").trim().toLowerCase();
    if (!result || result.length > 127 || !/^[a-z0-9!#$&^_.+\-]+\/[a-z0-9!#$&^_.+\-]+$/.test(result)) throw new Error("Preview contentType invalido");
    return result;
  }

  function identity(input) {
    return { fileId: value(input.fileId, "fileId"), sourceVersionId: value(input.sourceVersionId || input.versionId, "sourceVersionId"), keyEpoch: value(input.keyEpoch, "keyEpoch"), compartmentId: value(input.compartmentId, "compartmentId"), previewFormat: value(input.previewFormat || PREVIEW_FORMAT, "previewFormat"), contentType: mime(input.contentType || "text/plain") };
  }

  async function seal(input, key) {
    if (typeof input.body !== "string") throw new Error("Preview protegido invalido");
    const item = identity(input);
    return { ...item, envelope: await crypto.encryptJson({ identity: item, body: input.body }, key, { context: CONTEXT, identity: item }) };
  }

  async function open(preview, key) {
    if (!preview?.envelope) throw new Error("Preview protegido invalido");
    const item = identity(preview);
    const payload = await crypto.decryptJson(preview.envelope, key, { context: CONTEXT, identity: item });
    if (crypto.canonicalJson(payload.identity) !== crypto.canonicalJson(item)) throw new Error("Identidade do preview nao confere");
    return { fileId: item.fileId, sourceVersionId: item.sourceVersionId, keyEpoch: item.keyEpoch, compartmentId: item.compartmentId, previewFormat: item.previewFormat, contentType: item.contentType, body: payload.body };
  }

  function invalidate(entries, change = {}) {
    return (Array.isArray(entries) ? entries : []).filter((entry) => {
      if (change.fileId && entry.fileId !== change.fileId) return true;
      if (change.tombstone || change.revoked) return false;
      if (change.sourceVersionId && entry.sourceVersionId !== change.sourceVersionId) return false;
      if (change.keyEpoch && entry.keyEpoch !== change.keyEpoch) return false;
      return true;
    });
  }

  return { CONTEXT, PREVIEW_FORMAT, invalidate, invalidateForVersion: (entries, fileId, sourceVersionId) => invalidate(entries, { fileId, sourceVersionId }), invalidateOnVersion: (entries, fileId, sourceVersionId) => invalidate(entries, { fileId, sourceVersionId }), invalidateOnEpoch: (entries, fileId, keyEpoch) => invalidate(entries, { fileId, keyEpoch }), invalidateOnRevoke: (entries, fileId) => invalidate(entries, { fileId, revoked: true }), invalidateOnTombstone: (entries, fileId) => invalidate(entries, { fileId, tombstone: true }), open, seal };
}));
