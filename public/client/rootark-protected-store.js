(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rootark-client-crypto"));
  else root.RootarkProtectedStore = factory(root.RootarkClientCrypto);
}(typeof globalThis === "object" ? globalThis : this, function (crypto) {
  "use strict";

  const STORE_NAMES = ["index", "preview", "queue"];
  const CONTEXT = "Root.ark/protected-client-store/v1";

  function request(value) {
    return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error || new Error("IndexedDB request failed")); });
  }

  function createProtectedStore(options = {}) {
    const indexed = options.indexedDB || (typeof indexedDB === "undefined" ? null : indexedDB);
    const dbName = String(options.dbName || "rootark-protected-client-v1");
    let db;
    async function open() {
      if (!indexed) throw new Error("IndexedDB unavailable");
      db = await new Promise((resolve, reject) => {
        const openRequest = indexed.open(dbName, 1);
        openRequest.onupgradeneeded = () => STORE_NAMES.forEach((name) => { if (!openRequest.result.objectStoreNames.contains(name)) openRequest.result.createObjectStore(name, { keyPath: "id" }); });
        openRequest.onsuccess = () => resolve(openRequest.result);
        openRequest.onerror = () => reject(openRequest.error || new Error("IndexedDB open failed"));
      });
      return api;
    }
    async function put(storeName, id, value, key) {
      if (!db || !key) throw new Error("Protected store is locked");
      const envelope = await crypto.encryptJson(value, key, { context: CONTEXT, identity: { store: storeName, id: String(id) } });
      await request(db.transaction(storeName, "readwrite").objectStore(storeName).put({ id: String(id), envelope }));
      return true;
    }
    async function list(storeName, key) {
      if (!db || !key) throw new Error("Protected store is locked");
      const records = await request(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
      return Promise.all(records.map(async (record) => crypto.decryptJson(record.envelope, key, { context: CONTEXT, identity: { store: storeName, id: record.id } })));
    }
    async function clear(storeName) {
      if (!db) return false;
      await request(db.transaction(storeName, "readwrite").objectStore(storeName).clear());
      return true;
    }
    const api = {
      open,
      putIndex: (entry, key) => put("index", entry.id, entry, key),
      putPreview: (entry, key) => put("preview", `${entry.fileId}:${entry.sourceVersionId}`, entry, key),
      enqueue: (operation, key) => put("queue", operation.operationId, operation, key),
      listIndex: (key) => list("index", key),
      listPreviews: (key) => list("preview", key),
      drainQueue: async (key) => { const values = await list("queue", key); await clear("queue"); return values; },
      clear: async () => { await Promise.all(STORE_NAMES.map(clear)); return true; },
      logout: async () => api.clear(),
      revoke: async () => api.clear(),
      invalidate: async (storeName, ids) => {
        if (!db) return false;
        const idSet = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
        const records = await request(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
        const transaction = db.transaction(storeName, "readwrite");
        records.filter((record) => idSet.has(record.id)).forEach((record) => transaction.objectStore(storeName).delete(record.id));
        await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
        return true;
      },
    };
    return api;
  }

  return { CONTEXT, createProtectedStore };
}));
