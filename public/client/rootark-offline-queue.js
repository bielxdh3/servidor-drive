(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rootark-sync-adapter"));
  else root.RootarkOfflineQueue = factory(root.RootarkSyncAdapter);
}(typeof globalThis === "object" ? globalThis : this, function (adapter) {
  "use strict";

  function assertEncryptedEnvelope(value) {
    if (!adapter?.normalizeOpaqueEnvelope) throw new Error("Validador de sincronizacao indisponivel");
    return adapter.normalizeOpaqueEnvelope(value);
  }

  function createOfflineQueue(storage = typeof localStorage === "undefined" ? null : localStorage) {
    const key = "rootark.offline.encrypted.v2";
    const read = () => {
      if (!storage) return [];
      try {
        const parsed = JSON.parse(storage.getItem(key) || "[]");
        if (!Array.isArray(parsed)) throw new Error("Invalid offline queue");
        return parsed.map(assertEncryptedEnvelope);
      } catch {
        storage.removeItem(key);
        return [];
      }
    };
    const clear = () => { storage?.removeItem(key); return true; };
    return {
      size: () => read().length,
      enqueue: (envelope) => {
        const normalized = assertEncryptedEnvelope(envelope);
        const next = [...read(), normalized].slice(-100);
        storage?.setItem(key, JSON.stringify(next));
        return next.length;
      },
      drain: () => { const next = read(); clear(); return next; },
      clear,
      logout: clear,
      revoke: clear,
    };
  }

  return { assertEncryptedEnvelope, createOfflineQueue };
}));
