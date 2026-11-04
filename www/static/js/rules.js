/* Nex-J Chess — Fase 7.2: regras escritas ANTES da inscrição (torneios e campeonatos). */
(function () {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function fetchRules(scope, params) {
    const q = new URLSearchParams(params || {}).toString();
    const res = await fetch(`/api/rules/${scope}${q ? "?" + q : ""}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Não consegui carregar as regras.");
    return data;
  }

  // ask: mostra as regras e exige "Li e entendi" para continuar. Retorna true/false.
  // show: só leitura (botão Fechar).
  function modal(scope, params, { confirm = true, okText = "Aceitar e entrar ▶" } = {}) {
    return new Promise(async resolve => {
      let data;
      try { data = await fetchRules(scope, params); }
      catch (e) { window.NexApp && NexApp.toast(e.message); return resolve(false); }
      const el = document.createElement("div");
      el.className = "modal open rules-modal";
      el.innerHTML = `<div class="modal-box rules-box">
        <h2>📖 ${esc(data.title)}</h2>
        <ul class="rules-list">${data.items.map(([ic, tx]) => `<li><span>${ic}</span><p>${esc(tx)}</p></li>`).join("")}</ul>
        ${confirm ? `<label class="rules-agree"><input type="checkbox" id="rulesAgree"> <span>Li e entendi as regras</span></label>` : ""}
        <div class="modal-actions">
          ${confirm ? `<button class="btn ghost" data-act="no">Cancelar</button><button class="btn gold" data-act="yes" disabled>${esc(okText)}</button>`
                    : `<button class="btn gold" data-act="no">Fechar</button>`}
        </div></div>`;
      const done = v => { el.remove(); resolve(v); };
      el.addEventListener("click", e => {
        if (e.target === el) return done(false);
        const b = e.target.closest("[data-act]");
        if (b) done(b.dataset.act === "yes");
      });
      document.body.appendChild(el);
      const agree = el.querySelector("#rulesAgree");
      if (agree) agree.onchange = () => { el.querySelector('[data-act="yes"]').disabled = !agree.checked; };
    });
  }

  window.NexRules = {
    ask: (scope, params, okText) => modal(scope, params, { confirm: true, okText }),
    show: (scope, params) => modal(scope, params, { confirm: false }),
  };
})();
