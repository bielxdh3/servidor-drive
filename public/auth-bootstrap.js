(() => {
  const auth = window.ROOTARK_AUTH;
  if (!auth) {
    window.location.replace("/login.html");
    return;
  }
  const csrf = document.cookie.split(";").map((part) => part.trim().split("=")).find(([key]) => key === "rootark_csrf")?.[1];
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.delete("Authorization");
    if (!["GET", "HEAD", "OPTIONS"].includes((init.method || "GET").toUpperCase()) && csrf) headers.set("X-CSRF-Token", csrf);
    return originalFetch(input, { ...init, headers, credentials: "same-origin" });
  };
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (name.toLowerCase() === "authorization") return;
    return originalSetHeader.call(this, name, value);
  };
  window.rootarkLogout = async () => {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login.html";
  };
})();
