(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RootarkOfflineQueue = factory();
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function assertEncryptedEnvelope(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.ciphertext !== "string") throw new Error("A fila offline aceita somente envelopes criptografados");
    for (const forbidden of ["plaintext", "fileKey", "key", "keys", "token", "authorization"]) {
      if (Object.hasOwn(value, forbidden)) throw new Error("Dados sensiveis nao podem entrar na fila offline");
    }
    return value;
  }

  function createOfflineQueue(storage = typeof localStorage === "undefined" ? null : localStorage) {
    const key = "rootark.offline.encrypted.v1";
    const read = () => { try { return JSON.parse(storage?.getItem(key) || "[]"); } catch { return []; } };
    return {
      size: () => read().length,
      enqueue: (envelope) => {
        assertEncryptedEnvelope(envelope);
        const next = [...read(), envelope].slice(-100);
        storage?.setItem(key, JSON.stringify(next));
        return next.length;
      },
      drain: () => {
        const next = read();
        storage?.removeItem(key);
        return next;
      },
    };
  }

  return { assertEncryptedEnvelope, createOfflineQueue };
}));
