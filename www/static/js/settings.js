/* Nex-J Chess — Fase 6: tela de Configurações (aparência, sons, jogo e backup). */
(function () {
  const $ = id => document.getElementById(id);
  const A = () => window.NexApp;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let bk = null;

  /* ------------------------------------------------------------ preferências */
  function syncPrefs() {
    const p = NexPrefs.all();
    document.querySelectorAll("#settingsView [data-pref]").forEach(seg => {
      seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === p[seg.dataset.pref]));
    });
    document.querySelectorAll("#settingsView [data-pref-bool]").forEach(inp => { inp.checked = !!p[inp.dataset.prefBool]; });
    $("volRange").value = Math.round(p.volume * 100);
    $("volLabel").textContent = `${Math.round(p.volume * 100)}%`;
    $("soundTest").classList.toggle("off", !p.sound);
  }

  function drawPreview() {
    // mini tabuleiro mostrando o tema + coordenadas + pontinhos
    const files = "abcd";
    let html = "";
    for (let r = 0; r < 2; r++) {
      for (let f = 0; f < 4; f++) {
        const light = (r + f) % 2 === 0;
        const coord = (r === 1 ? `<span class="nb-coord file">${files[f]}</span>` : "") + (f === 0 ? `<span class="nb-coord rank">${2 - r}</span>` : "");
        const hint = (r === 0 && f === 2) ? `<div class="nb-hint nb-dot"></div>` : "";
        html += `<div class="nb-sq ${light ? "light" : "dark"}">${coord}${hint}</div>`;
      }
    }
    $("setPreview").innerHTML = `<div class="sp-board">${html}</div><div class="muted sp-cap">Prévia</div>`;
  }

  /* ------------------------------------------------------------ conta e senha (v7.4) */
  function renderAccount() {
    const p = A().getPlayer();
    if (!p) return;
    $("accRecState").textContent = p.has_recovery
      ? "Você tem um código guardado. Se perdeu o papel, gere um novo (o antigo deixa de valer)."
      : "Você ainda não tem código. Gere um e anote.";
    $("accOpen").checked = !!p.open_login;
    $("accPassRow").classList.add("hidden");
  }

  function bindAccount() {
    $("accNewCode").onclick = async () => {
      try {
        const r = await A().api("/api/account/recovery", {});
        A().applyPlayer(r.user);
        A().showRecoveryCode(r.code);
        renderAccount();
      } catch (e) { A().toast(e.message); }
    };
    $("accOpen").onchange = async () => {
      if ($("accOpen").checked) {
        try { A().applyPlayer((await A().api("/api/account/open-login", { on: true })).user); A().toast("Agora você entra só com o nome."); }
        catch (e) { A().toast(e.message); $("accOpen").checked = false; }
        renderAccount();
      } else {
        $("accPassRow").classList.remove("hidden");   // para voltar a ter senha, escolhe uma
        $("accNewPass").focus();
      }
    };
    $("accSavePass").onclick = async () => {
      try {
        const r = await A().api("/api/account/open-login", { on: false, password: $("accNewPass").value });
        $("accNewPass").value = "";
        A().applyPlayer(r.user);
        A().toast("Senha salva ✓");
        renderAccount();
      } catch (e) { A().toast(e.message); }
    };
  }

  function open() {
    renderAccount();
    syncPrefs();
    drawPreview();
    loadBackups();
  }

  function focusBackup() {
    setTimeout(() => $("setBackup").scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  /* ------------------------------------------------------------ backup */
  async function loadBackups() {
    try { bk = await A().api("/api/backups"); renderBackups(); } catch (e) { A().toast(e.message); }
  }

  function renderBackups() {
    const s = bk.settings;
    $("bkStatus").innerHTML = bk.last
      ? `✅ Último backup: <b>${bk.last}</b> · ${bk.items.length} guardado${bk.items.length === 1 ? "" : "s"}<br><small class="muted">Pasta: <code>${esc(bk.folder)}</code></small>`
      : `⚠️ Nenhum backup ainda. Faça o primeiro agora!<br><small class="muted">Pasta: <code>${esc(bk.folder)}</code></small>`;
    $("bkAuto").checked = !!s.auto_backup;
    $("bkOpen").classList.toggle("hidden", !bk.can_open_folder);
    $("bkList").innerHTML = bk.items.map(b => `
      <li class="${b.broken ? "broken" : ""}">
        <span class="bk-kind ${b.kind}">${b.kind_label}</span>
        <div class="wh-body"><div><b>${b.date}</b></div>
          <div class="muted">${b.broken ? "arquivo danificado" : `${b.players ?? "?"} conta(s) · ${b.games ?? "?"} partida(s) · v${b.version || "?"} · ${b.size_kb} KB`}</div></div>
        <a class="btn ghost sm" href="/api/backups/${encodeURIComponent(b.name)}/download" download title="Baixar (para guardar no Drive, pendrive...)">⬇️</a>
        ${b.broken ? "" : `<button class="btn ghost sm" data-restore="${b.name}" title="Voltar para este backup">↩️ Restaurar</button>`}
        <button class="btn ghost sm danger" data-del="${b.name}" title="Apagar">🗑️</button>
      </li>`).join("") || `<li class="empty">Nenhum backup ainda.</li>`;
  }

  async function backupNow() {
    $("bkNow").disabled = true;
    try {
      bk = await A().api("/api/backups", {});
      renderBackups();
      const extra = bk.created.extra;
      A().toast(extra && extra !== "ok" ? `💾 Backup feito, mas: ${extra}` : extra === "ok" ? "💾 Backup feito (e copiado para a pasta extra)!" : "💾 Backup feito!");
      A().beep("coin");
    } catch (e) { A().toast(e.message); }
    $("bkNow").disabled = false;
  }

  function confirmRestore(what) {
    const typed = prompt(`Restaurar ${what}?\n\nO jogo volta exatamente para como estava nesse backup ` +
      `(contas, partidas, moedas, torneios). Antes disso eu faço um backup de agora, então dá para desfazer.\n\n` +
      `Para confirmar, digite RESTAURAR:`);
    return (typed || "").trim().toUpperCase() === "RESTAURAR";
  }

  async function restoreDone(r) {
    alert(`✅ Restaurado! ${r.restored.players} conta(s) e ${r.restored.games} partida(s).\n\n` +
      `Se precisar desfazer, use o backup "Antes de restaurar" da lista.\nAgora entre de novo na sua conta.`);
    location.reload();
  }

  async function restoreFromList(name) {
    const item = bk.items.find(b => b.name === name);
    if (!confirmRestore(`o backup de ${item ? item.date : name}`)) return;
    try { restoreDone(await A().api("/api/backups/restore", { name })); } catch (e) { A().toast(e.message); }
  }

  async function restoreFromFile(file) {
    if (!file) return;
    if (!confirmRestore(`o arquivo "${file.name}"`)) { $("bkFile").value = ""; return; }
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/backups/restore", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao restaurar");
      restoreDone(data);
    } catch (e) { A().toast(e.message); }
    $("bkFile").value = "";
  }

  async function del(name) {
    if (!confirm("Apagar este backup? (não dá para desfazer)")) return;
    try { bk = await A().api(`/api/backups/${encodeURIComponent(name)}/delete`, {}); renderBackups(); } catch (e) { A().toast(e.message); }
  }

  async function saveSetting(body, msg) {
    try { bk = await A().api("/api/backups/settings", body); renderBackups(); if (msg) A().toast(msg); }
    catch (e) { A().toast(e.message); loadBackups(); }
  }

  /* ------------------------------------------------------------ eventos */
  document.addEventListener("DOMContentLoaded", () => {
    const view = $("settingsView");
    view.addEventListener("click", e => {
      const segBtn = e.target.closest("[data-pref] button");
      if (segBtn) {
        NexPrefs.set(segBtn.closest("[data-pref]").dataset.pref, segBtn.dataset.v);
        syncPrefs();
        return;
      }
      const s = e.target.closest("#soundTest [data-s]");
      if (s) { NexSound.play(s.dataset.s); if (s.dataset.s === "check") NexSound.speak("Xeque!"); if (s.dataset.s === "win") NexFx.confetti(90); }
    });
    view.addEventListener("change", e => {
      const inp = e.target.closest("[data-pref-bool]");
      if (inp) {
        NexPrefs.set(inp.dataset.prefBool, inp.checked);
        syncPrefs();
        if (inp.dataset.prefBool === "sound" && inp.checked) NexSound.play("move");
        if (inp.dataset.prefBool === "voice" && inp.checked) NexSound.speak("Xeque!");
        if (inp.dataset.prefBool === "coach") A().toast("Vale a partir da próxima partida.");
      }
    });
    $("volRange").addEventListener("input", e => { $("volLabel").textContent = `${e.target.value}%`; });
    $("volRange").addEventListener("change", e => { NexPrefs.set("volume", +e.target.value / 100); NexSound.play("capture"); });

    $("bkNow").onclick = backupNow;
    $("bkFile").onchange = e => restoreFromFile(e.target.files[0]);
    $("bkDownload").onclick = async () => {
      try {
        const r = await A().api("/api/backups", {});
        const name = r.items && r.items[0] && r.items[0].name;
        if (!name) return A().toast("Não consegui criar o backup.");
        const a = document.createElement("a"); a.href = "/api/backups/" + encodeURIComponent(name) + "/download"; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        bk = r; renderBackups(); A().toast("Cópia salva. Guarde o arquivo no Drive, e-mail ou WhatsApp.");
      } catch (e) { A().toast(e.message); }
    };
    $("bkOpen").onclick = () => A().api("/api/backups/open-folder", {}).catch(e => A().toast(e.message));
    $("bkAuto").onchange = e => saveSetting({ auto_backup: e.target.checked }, e.target.checked ? "Backup automático ligado." : "Backup automático desligado.");

    $("bkList").addEventListener("click", e => {
      const r = e.target.closest("[data-restore]"); if (r) restoreFromList(r.dataset.restore);
      const d = e.target.closest("[data-del]"); if (d) del(d.dataset.del);
    });
  });

  bindAccount();
  window.NexSettings = { open, focusBackup };
})();
