(function () {
  "use strict";

  const status = document.getElementById("protectedClientStatus");
  const result = document.getElementById("protectedSearchResult");
  const input = document.getElementById("protectedSearchInput");
  const searchButton = document.getElementById("protectedSearchButton");
  const index = window.RootarkProtectedIndex;

  function setStatus(message) { if (status) status.textContent = message; }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).then(() => setStatus("Offline: shell publico pronto; conteudo protegido fica fora do cache."), () => setStatus("Offline indisponivel nesta sessao."));
  } else {
    setStatus("Offline indisponivel nesta sessao.");
  }

  searchButton?.addEventListener("click", async () => {
    if (!index || !window.ROOTARK_PROTECTED_INDEX_ENTRIES || !window.ROOTARK_PROTECTED_INDEX_KEY) {
      if (result) result.textContent = "Nenhum indice protegido local foi desbloqueado.";
      return;
    }
    try {
      const matches = await index.search(window.ROOTARK_PROTECTED_INDEX_ENTRIES, input?.value || "", window.ROOTARK_PROTECTED_INDEX_KEY);
      if (result) result.textContent = `${matches.length} resultado(s) local(is).`;
    } catch {
      if (result) result.textContent = "Indice protegido indisponivel ou chave incorreta.";
    }
  });

  window.addEventListener("online", () => setStatus("Online: fila local criptografada pronta para sincronizar."));
  window.addEventListener("offline", () => setStatus("Offline: somente o shell publico e a fila criptografada local permanecem disponiveis."));
}());
