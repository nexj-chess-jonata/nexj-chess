/* Nex-J Chess (celular) — liga o servidor local antes da interface começar. */
(function () {
  NJApi.install();
  NJApi.init().catch(e => console.error("[boot]", e));
  NexEngine.init("js/engine/");
})();

/* PWA: pede armazenamento permanente (evita o aparelho apagar os dados) e oferece "Instalar agora" no Android. */
(function () {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) {}
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    const b = document.getElementById("btnInstallPwa"); if (b) b.classList.remove("hidden");
  });
  document.addEventListener("click", async e => {
    if (!e.target.closest || !e.target.closest("#btnInstallPwa") || !deferred) return;
    deferred.prompt(); try { await deferred.userChoice; } catch (_) {} deferred = null; e.target.closest("#btnInstallPwa").classList.add("hidden");
  });
  window.addEventListener("appinstalled", () => { const s = document.getElementById("installState"); if (s) s.textContent = "✅ App instalado."; });
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
  window.addEventListener("load", () => { const s = document.getElementById("installState"); if (s && standalone) s.textContent = "✅ Você já está usando o app instalado."; });
})();
