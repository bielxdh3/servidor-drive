(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RootarkProtectedSession = factory();
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  let keyProvider = null;
  let syncHandler = null;
  let store = null;

  function configure(options = {}) {
    if (typeof options.getKey !== "function") throw new Error("Protected session key provider required");
    keyProvider = options.getKey;
    syncHandler = typeof options.syncOnce === "function" ? options.syncOnce : null;
    store = options.store || store;
    return true;
  }

  async function getKey() {
    if (!keyProvider) throw new Error("Protected session is locked");
    const key = await keyProvider();
    if (!key) throw new Error("Protected session key unavailable");
    return key;
  }

  async function enqueue(operation) {
    if (!store?.enqueue) throw new Error("Protected store unavailable");
    return store.enqueue(operation, await getKey());
  }

  function clearSession() {
    keyProvider = null;
    syncHandler = null;
    return store?.clear?.() ?? true;
  }

  const api = {
    configure,
    attachStore: (value) => { store = value || null; return true; },
    getKey,
    enqueue,
    syncOnce: () => syncHandler ? syncHandler() : false,
    logout: clearSession,
    revoke: clearSession,
  };
  return api;
}));
