(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RootarkSyncAdapter = factory();
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function assertOpaqueEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Envelope de sincronizacao invalido");
    for (const forbidden of ["plaintext", "fileKey", "key", "keys", "searchTerm", "previewBody"]) {
      if (Object.hasOwn(envelope, forbidden)) throw new Error("A sincronizacao aceita apenas envelopes opacos");
    }
    if (envelope.operation !== "delete" && (!envelope.ciphertext || !envelope.nonce || !envelope.tag || !envelope.aad)) throw new Error("Envelope de sincronizacao incompleto");
    return envelope;
  }

  function createOpaqueSyncAdapter({ fetchImpl = fetch, baseUrl = "" } = {}) {
    const request = async (path, options = {}) => {
      const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || "Falha de sincronizacao"), { status: response.status, payload });
      return payload;
    };
    return {
      list: (objectId = "") => request(`/sync/v1/objects${objectId ? `/${encodeURIComponent(objectId)}` : ""}`),
      push: (envelope) => request(`/sync/v1/objects${envelope.operation === "delete" ? `/${encodeURIComponent(envelope.objectId)}` : ""}`, { method: envelope.operation === "delete" ? "DELETE" : "POST", body: JSON.stringify(assertOpaqueEnvelope(envelope)) }),
      validate: assertOpaqueEnvelope,
    };
  }

  return { assertOpaqueEnvelope, createOpaqueSyncAdapter };
}));
