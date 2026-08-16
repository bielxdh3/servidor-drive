(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rootark-client-crypto"));
  else root.RootarkProtectedIndex = factory(root.RootarkClientCrypto);
}(typeof globalThis === "object" ? globalThis : this, function (crypto) {
  "use strict";

  const CONTEXT = "Root.ark/protected-index/v1";

  async function createEntry({ id, metadata }, key) {
    const fileId = String(id || metadata?.fileId || "").trim();
    if (!fileId || fileId.length > 160) throw new Error("Index id invalido");
    return { id: fileId, envelope: await crypto.encryptJson(metadata || {}, key, CONTEXT) };
  }

  async function decryptEntry(entry, key) {
    if (!entry || typeof entry.id !== "string" || !entry.envelope) throw new Error("Entrada de indice invalida");
    return { id: entry.id, metadata: await crypto.decryptJson(entry.envelope, key, CONTEXT) };
  }

  async function search(entries, term, key) {
    const query = String(term || "").trim().toLocaleLowerCase();
    const results = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const decrypted = await decryptEntry(entry, key);
      if (!query || crypto.canonicalJson(decrypted.metadata).toLocaleLowerCase().includes(query)) results.push(decrypted);
    }
    return results;
  }

  return { CONTEXT, createEntry, decryptEntry, search };
}));
