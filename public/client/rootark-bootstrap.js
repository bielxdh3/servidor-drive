(function () {
  "use strict";

  const status = document.getElementById("protectedClientStatus");
  const result = document.getElementById("protectedSearchResult");
  const input = document.getElementById("protectedSearchInput");
  const searchButton = document.getElementById("protectedSearchButton");
  const index = window.RootarkProtectedIndex;
  const protectedStore = window.RootarkProtectedStore?.createProtectedStore?.();
  const session = window.RootarkProtectedSession;
  session?.attachStore?.(protectedStore);

  function setStatus(message) { if (status) status.textContent = message; }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).then(() => setStatus("Offline: shell publico pronto; conteudo protegido fica fora do cache."), () => setStatus("Offline indisponivel nesta sessao."));
  } else {
    setStatus("Offline indisponivel nesta sessao.");
  }

  searchButton?.addEventListener("click", async () => {
    if (!index || !protectedStore || typeof session?.getKey !== "function") {
      if (result) result.textContent = "Nenhum indice protegido local foi desbloqueado.";
      return;
    }
    try {
      await protectedStore.open();
      const key = await session.getKey();
      const entries = await protectedStore.listIndex(key);
      const matches = await index.search(entries, input?.value || "", key);
      if (result) result.textContent = `${matches.length} resultado(s) local(is).`;
    } catch {
      if (result) result.textContent = "Indice protegido indisponivel ou chave incorreta.";
    }
  });

  window.addEventListener("online", async () => {
    setStatus("Online: fila local criptografada pronta para sincronizar.");
    try { await session?.syncOnce?.(); } catch { setStatus("Online: sincronizacao protegida aguardando autorizacao."); }
  });
  window.addEventListener("offline", () => setStatus("Offline: somente o shell publico e a fila criptografada local permanecem disponiveis."));
  window.addEventListener("rootark:logout", () => session?.logout?.() || protectedStore?.logout?.());
  window.addEventListener("rootark:device-revoked", () => session?.revoke?.() || protectedStore?.revoke?.());
}());
