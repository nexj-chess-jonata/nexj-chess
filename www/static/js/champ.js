/* Nex-J Chess — Fase 7: Campeonatos (Estadual, Liga e Copa do Brasil).
 * Tela da aba "Campeonatos": criar o clube, ver as competições da temporada, tabela, rodadas e chave da Copa.
 * Usa as funções do app.js através de window.NexApp.
 */
(function () {
  const $ = id => document.getElementById(id);
  const A = () => window.NexApp;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = n => (n || 0).toLocaleString("pt-BR");

  let career = null, comp = null, compId = null, setup = { uf: "", name: "", palette: 0 }, tc = "rapid", viewRound = null, editing = false;
  const TCS = [["rapid", "⏱️ Rápida 10 min"], ["blitz", "⚡ Blitz 2+1"], ["bullet", "🔫 Bullet 1 min"], ["none", "∞ Sem tempo"], ["classic", "🏛️ Clássica 60 min"]];
  const root = () => $("champBody");
  const crest = (club, size) => window.NexCrest ? NexCrest.svg(club, size) : "";

  /* ------------------------------------------------------------------ carregamento */
  async function open() {
    compId = null; comp = null; editing = false;
    try { career = await A().api("/api/career"); } catch (e) { A().toast(e.message); return; }
    if (compId && comp) return;
    render();
  }

  async function openComp(id) {
    compId = id; viewRound = null;
    try { comp = await A().api(`/api/champ/${id}`); } catch (e) { A().toast(e.message); compId = null; return; }
    try { career = await A().api("/api/career"); } catch (_) { /* segue com o que tem */ }
    renderComp();
  }

  function render() {
    if (compId && comp) return renderComp();
    if (!career) return;
    career.has_career ? renderHub() : renderSetup();
  }

  /* ------------------------------------------------------------------ criar clube */
  function palettesHtml(sel) {
    return career.palettes.map((p, i) => `<button type="button" class="cp-pal ${i === sel ? "on" : ""}" data-pal="${i}"
      style="background:linear-gradient(135deg,${p.c1} 50%,${p.c2} 50%)" aria-label="Cores ${i + 1}"></button>`).join("");
  }

  function ufOptions(sel) {
    return `<option value="">Escolha…</option>` + career.ufs.map(u => `<option value="${u.uf}" ${u.uf === sel ? "selected" : ""}>${esc(u.name)} (${u.uf})</option>`).join("");
  }

  function previewClub(name, uf, palette, style) {
    const p = career.palettes[palette] || career.palettes[0];
    return { name: name || "Seu clube", c1: p.c1, c2: p.c2, style: style || "half", glyph: "♞", uf };
  }

  function renderSetup() {
    if (!setup.name) setup.name = "";
    root().innerHTML = `
      <section class="card champ-hero">
        <div><h2>🏟️ Campeonatos</h2>
          <p class="muted">É o <b>futebol do xadrez</b>: funde o seu clube, escolha o seu estado e dispute o <b>Estadual</b>,
            a <b>Liga</b> (Série D → A, com acesso e rebaixamento) e a <b>Copa do Brasil</b>. Os adversários são clubes e jogadores fictícios.</p></div>
      </section>
      ${career.can_join ? "" : `<div class="tour-lock">🎯 Termine suas <b>partidas de classificação</b> para fundar um clube.</div>`}
      <section class="card champ-setup">
        <div class="cs-form">
          <label>Seu estado</label>
          <select id="csUf">${ufOptions(setup.uf)}</select>
          <label>Nome do clube</label>
          <input id="csName" maxlength="28" placeholder="Ex.: Xadrez Clube Nex-J" value="${esc(setup.name)}">
          <label>Cores do escudo</label>
          <div class="cp-pal-row" id="csPals">${palettesHtml(setup.palette)}</div>
          <button class="btn gold" id="csGo" ${career.can_join ? "" : "disabled"}>Fundar clube e começar ▶</button>
          <div class="muted small">Você começa na <b>Série ${career.division_suggested}</b> da Liga, de acordo com o seu rating.</div>
        </div>
        <div class="cs-preview" id="csPrev"></div>
      </section>
      ${rulesHtml()}`;
    const upd = () => {
      $("csPrev").innerHTML = crest(previewClub(setup.name, setup.uf, setup.palette), 120) +
        `<b>${esc(setup.name || "Seu clube")}</b><span class="muted">${setup.uf ? esc(career.ufs.find(u => u.uf === setup.uf)?.name || "") : "Escolha o estado"}</span>`;
    };
    upd();
    $("csUf").onchange = e => { setup.uf = e.target.value; upd(); };
    $("csName").oninput = e => { setup.name = e.target.value; upd(); };
    $("csPals").onclick = e => {
      const b = e.target.closest("[data-pal]"); if (!b) return;
      setup.palette = +b.dataset.pal;
      document.querySelectorAll("#csPals .cp-pal").forEach(x => x.classList.toggle("on", x === b));
      upd();
    };
    $("csGo").onclick = async () => {
      try {
        career = await A().api("/api/career/start", { uf: setup.uf, club: setup.name, palette: setup.palette });
        A().beep("start");
        render();
      } catch (e) { A().toast(e.message); }
    };
  }

  function rulesHtml() {
    const P = career.prizes || {};
    return `<details class="card champ-rules"><summary>📖 Como funciona</summary>
      <ul>
        <li><b>Estadual</b>: 8 clubes do seu estado, pontos corridos em turno único (7 rodadas). Os <b>4 primeiros</b> se classificam para a Copa do Brasil.</li>
        <li><b>Liga</b>: Série D, C, B e A com 8 clubes, ida e volta (14 rodadas). Os <b>2 primeiros sobem</b> de série e os <b>2 últimos caem</b>.</li>
        <li><b>Copa do Brasil</b>: 16 clubes, mata-mata em partida única. Empate = <b>jogo de desempate</b> com as cores trocadas.</li>
        <li>Vitória vale 3 pontos, empate 1, derrota 0. Suas partidas valem rating (Elo) normalmente.</li>
        <li>Prêmios em moedas: Estadual campeão ${P.estadual ? P.estadual["1"] : 300} 🪙 · Liga campeã ${P.liga ? P.liga["1"] : 600} 🪙 ·
          Copa campeã ${P.copa ? P.copa.champion : 800} 🪙, mais ${career.win_bonus || 5} 🪙 por vitória e ${career.promotion_bonus || 100} 🪙 pelo acesso.</li>
        <li>Quem for campeão ganha um <b>troféu</b> na sala de troféus. Abandonar uma competição conta como derrota e não paga prêmio.</li>
      </ul></details>`;
  }

  /* ------------------------------------------------------------------ hub */
  function compDesc(kind) {
    if (kind === "estadual") return `8 clubes de ${esc(career.uf_name)} · turno único · 7 rodadas · os 4 primeiros vão para a Copa`;
    if (kind === "liga") {
      const d = career.division;
      return `${career.division_name} · 8 clubes · ida e volta · 14 rodadas` +
        (d === "A" ? " · últimos 2 caem" : d === "D" ? " · os 2 primeiros sobem" : " · 2 sobem, 2 caem");
    }
    return "16 clubes · mata-mata · empate = jogo de desempate";
  }

  function nextPreview(n) {
    if (!n) return "";
    const o = n.opponent;
    return `<div class="cc-next">${crest(o.club, 30)}<div><b>${esc(o.club.name)}</b><div class="muted small">${esc(o.name)} · ${o.rating} · ${n.color === "white" ? "você de brancas ♔" : "você de pretas ♚"}</div></div></div>`;
  }

  function compCard(kind) {
    const meta = career.kinds[kind], c = career.competitions[kind];
    let body, action = "";
    if (!c) {
      if (kind === "copa" && !career.copa_open) {
        body = `<div class="cc-lock">🔒 ${esc(career.copa_note)}</div>`;
      } else {
        body = `<div class="muted">${compDesc(kind)}</div>`;
        action = `<button class="btn gold" data-start="${kind}">▶ Iniciar</button>`;
      }
    } else if (c.status === "active") {
      body = `<div class="cc-stage">${esc(c.stage_label)} · ${c.wins} vitória${c.wins === 1 ? "" : "s"}</div>${nextPreview(c.next)}`;
      action = `<button class="btn gold" data-open="${c.id}">Continuar ▶</button>`;
    } else {
      body = `<div class="cc-place ${c.player_status}">${esc(c.place_label || "Encerrado")}</div>
        <div class="muted">🪙 ${fmt(c.prize)} moedas${c.forfeit ? " (abandono)" : ""}${c.champion && c.player_status !== "champion" ? ` · campeão: ${esc(c.champion.name)}` : ""}</div>`;
      action = `<button class="btn outline-gold" data-open="${c.id}">Ver tabela</button>`;
    }
    return `<div class="card comp-card ${c ? c.status : ""} k-${kind}">
      <div class="cc-icon">${meta.icon}</div>
      <div class="cc-main"><h3>${meta.label}</h3>${body}</div>
      <div class="cc-act">${action}</div></div>`;
  }

  function renderHub() {
    const club = career.club;
    const honors = career.honors || [];
    root().innerHTML = `
      <section class="card champ-head">
        <div class="ch-crest">${crest(club, 78)}</div>
        <div class="ch-info"><h2>${esc(club.name)}</h2>
          <div class="muted">${esc(career.uf_name)} · <b>Temporada ${career.season}</b> · ${career.division_name} da Liga</div>
          <div class="ch-stats"><span>🏆 <b>${career.trophies}</b> troféu${career.trophies === 1 ? "" : "s"}</span><span>🪙 <b>${fmt(career.coins)}</b></span></div></div>
        <div class="ch-actions">
          <label class="muted small">Ritmo das partidas</label>
          <select id="chTc">${TCS.map(([k, n]) => `<option value="${k}" ${k === tc ? "selected" : ""}>${n}</option>`).join("")}</select>
          <button class="btn ghost sm" id="chEdit">✏️ Editar clube</button>
        </div>
      </section>
      <section class="card champ-edit ${editing ? "" : "hidden"}" id="chEditBox">
        <div class="cs-form">
          <label>Nome do clube</label><input id="ceName" maxlength="28" value="${esc(club.name)}">
          <label>Estado</label><select id="ceUf">${ufOptions(career.uf)}</select>
          <label>Cores</label><div class="cp-pal-row" id="cePals">${palettesHtml(career.palettes.findIndex(p => p.c1 === club.c1 && p.c2 === club.c2))}</div>
          <div class="muted small">O formato do escudo você compra na Loja (🛡️ Escudos do clube).</div>
          <div class="ce-btns"><button class="btn gold" id="ceSave">Salvar</button><button class="btn ghost" id="ceCancel">Cancelar</button></div>
        </div>
      </section>
      <div class="comp-grid">${["estadual", "liga", "copa"].map(compCard).join("")}</div>
      ${career.can_next_season
        ? `<button class="btn gold wide season-btn" id="chNext">🏁 Encerrar a temporada ${career.season} e começar a ${career.season + 1} ▶</button>`
        : career.next_season_hint ? `<div class="muted center small">${esc(career.next_season_hint)}</div>` : ""}
      <section class="card">
        <div class="card-title">🏆 Sala de troféus</div>
        ${honors.length ? `<div class="honors">${honors.slice().reverse().map(h => `<div class="honor"><span class="h-ico">${h.icon}</span><div><b>${esc(h.label)}</b><div class="muted small">Temporada ${h.season} · ${esc(h.club)}</div></div></div>`).join("")}</div>`
          : `<div class="muted">Nenhum troféu ainda. Seja campeão de uma competição para começar a sua coleção!</div>`}
      </section>
      ${(career.history || []).length ? `<section class="card"><div class="card-title">📜 Temporadas anteriores</div><div class="hist-list">${career.history.map(h =>
        `<button class="hist-row" data-open="${h.id}"><span>${career.kinds[h.kind].icon} ${esc(h.name)}</span><span class="muted">${esc(h.place_label || "")}</span><span class="mono">🪙 ${fmt(h.prize)}</span></button>`).join("")}</div></section>` : ""}
      ${rulesHtml()}`;

    $("chTc").onchange = e => { tc = e.target.value; };
    $("chEdit").onclick = () => { editing = !editing; $("chEditBox").classList.toggle("hidden", !editing); };
    $("ceCancel").onclick = () => { editing = false; $("chEditBox").classList.add("hidden"); };
    let pal = career.palettes.findIndex(p => p.c1 === club.c1 && p.c2 === club.c2);
    $("cePals").onclick = e => {
      const b = e.target.closest("[data-pal]"); if (!b) return;
      pal = +b.dataset.pal;
      document.querySelectorAll("#cePals .cp-pal").forEach(x => x.classList.toggle("on", x === b));
    };
    $("ceSave").onclick = async () => {
      try {
        career = await A().api("/api/career/club", { club: $("ceName").value, uf: $("ceUf").value || career.uf, palette: pal < 0 ? 0 : pal });
        editing = false; renderHub(); A().toast("Clube atualizado!");
      } catch (e) { A().toast(e.message); }
    };
    if ($("chNext")) $("chNext").onclick = async () => {
      try { career = await A().api("/api/career/season/next", {}); A().beep("start"); renderHub(); A().toast(`🏁 Temporada ${career.season} começou! Você está na ${career.division_name}.`); }
      catch (e) { A().toast(e.message); }
    };
    root().querySelectorAll("[data-open]").forEach(b => b.onclick = () => openComp(+b.dataset.open));
    root().querySelectorAll("[data-start]").forEach(b => b.onclick = () => startComp(b.dataset.start));
  }

  async function startComp(kind) {
    // regras escritas ANTES de se inscrever: precisa ler e aceitar
    const ok = await NexRules.ask(kind, { time_control: tc }, "Aceitar e iniciar ▶");
    if (!ok) return;
    try {
      const r = await A().api(`/api/champ/${kind}/start`, { time_control: tc });
      A().beep("start");
      await openComp(r.id);
    } catch (e) { A().toast(e.message); }
  }

  /* ------------------------------------------------------------------ detalhe da competição */
  const clubLabel = (p, size = 22) => `<span class="cp-cl ${p.is_player ? "me" : ""}">${crest(p.club, size)}<span class="cp-cl-name">${esc(p.club.name)}</span></span>`;

  function scoreText(m) {
    if (!m.result) return `<span class="muted">×</span>`;
    return m.result === "1-0" ? "1 – 0" : m.result === "0-1" ? "0 – 1" : "½ – ½";
  }

  function tableHtml(c) {
    const z = c.zones || {};
    const n = c.table.length;
    const rows = c.table.map(r => {
      const p = c.participants[r.id];
      const zone = r.pos <= (z.title || 0) ? "title" : r.pos <= (z.up || 0) ? "up" : (z.down && r.pos > n - z.down) ? "down" : "";
      return `<tr class="${r.id === "me" ? "me" : ""} ${zone}"><td class="pos"><i></i>${r.pos}</td><td class="club">${clubLabel(p)}<small class="muted">${esc(p.name)} · ${p.rating}</small></td>
        <td>${r.played}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td class="pts">${r.pts}</td></tr>`;
    }).join("");
    const legend = [z.up ? `<span class="cp-lg up">■ ${esc(z.up_label)}</span>` : "", z.down ? `<span class="cp-lg down">■ ${esc(z.down_label)}</span>` : ""].join("");
    return `<div class="table-wrap"><table class="league"><thead><tr><th>#</th><th>Clube</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="cp-legend">${legend}</div>`;
  }

  function roundsHtml(c) {
    const total = c.rounds.length;
    if (viewRound === null) viewRound = c.stage === "finished" ? total : c.round;
    const rnd = c.rounds[viewRound - 1];
    const items = rnd.map(m => {
      const w = c.participants[m.white], b = c.participants[m.black];
      return `<div class="cp-match ${m.white === "me" || m.black === "me" ? "mine" : ""}">${clubLabel(w, 20)}<span class="cp-score">${scoreText(m)}</span>${clubLabel(b, 20)}${m.note ? `<small class="muted">${esc(m.note)}</small>` : ""}</div>`;
    }).join("");
    return `<div class="round-nav"><button class="btn ghost sm" data-rd="-1" ${viewRound <= 1 ? "disabled" : ""}>◀</button>
      <b>Rodada ${viewRound} de ${total}</b>
      <button class="btn ghost sm" data-rd="1" ${viewRound >= total ? "disabled" : ""}>▶</button></div><div class="cp-matches">${items}</div>`;
  }

  function bracketHtml(c) {
    return `<div class="cp-bracket">${["r16", "qf", "sf", "final"].map(r => {
      const ms = c.knockout[r] || [];
      const col = ms.length ? ms.map(m => {
        const a = c.participants[m.white], b = c.participants[m.black];
        const line = (p, win, score) => `<div class="cpb-team ${p.is_player ? "me" : ""} ${m.result && win ? "win" : ""}">${crest(p.club, 18)}<span>${esc(p.club.name)}</span><small class="mono">${p.rating}</small>${m.result ? `<b>${score}</b>` : ""}</div>`;
        const sa = m.result === "1-0" ? "1" : m.result === "0-1" ? "0" : "½", sb = m.result === "1-0" ? "0" : m.result === "0-1" ? "1" : "½";
        return `<div class="cpb-match">${line(a, m.winner === m.white, sa)}${line(b, m.winner === m.black, sb)}${m.note ? `<small class="muted">${esc(m.note)}</small>` : ""}</div>`;
      }).join("") : `<div class="muted small cpb-empty">a definir</div>`;
      return `<div class="cpb-col ${c.ko_round === r && c.stage !== "finished" ? "current" : ""}"><div class="cpb-title">${c.ko_names[r]}</div>${col}</div>`;
    }).join("")}</div>`;
  }

  function renderComp() {
    const c = comp;
    let main;
    if (c.player_status === "playing" && c.next) {
      const o = c.next.opponent;
      main = `<section class="card next-card"><div class="card-title">⚔️ Sua próxima partida · ${esc(c.next.label)}</div>
        <div class="nc-body">${crest(o.club, 54)}
          <div class="avatar big has-face" style="background:${o.avatar_color}">${A().faceHtml(o)}</div>
          <div class="nc-info"><b>${esc(o.club.name)}</b>
            <div>${o.flag} ${esc(o.name)} <span class="mono">${o.rating}</span></div>
            <div class="muted">${o.personality_icon || ""} ${o.personality_label || ""} · você joga de <b>${c.next.color === "white" ? "brancas ♔" : "pretas ♚"}</b></div>
            ${c.next.knockout ? `<div class="nc-note">⚖️ Mata-mata: se empatar, tem <b>jogo de desempate</b> com as cores trocadas.</div>` : ""}
          </div></div>
        <button class="btn gold wide" id="cpPlay">${c.live_game ? "↩ Voltar para a partida" : "▶ Jogar partida"}</button></section>`;
    } else {
      const champ = c.champion_info;
      const extras = [
        c.promoted ? `<div class="cp-banner up">⬆️ Acesso! Na próxima temporada você joga na <b>Série ${c.division_after}</b>.</div>` : "",
        c.relegated ? `<div class="cp-banner down">⬇️ Rebaixado para a <b>Série ${c.division_after}</b>. Dá para voltar!</div>` : "",
        c.kind === "estadual" && c.stage === "finished" ? (c.qualified_copa ? `<div class="cp-banner up">🏆 Classificado para a <b>Copa do Brasil</b>!</div>` : `<div class="cp-banner">Não foi desta vez: só os 4 primeiros vão para a Copa.</div>`) : "",
      ].join("");
      main = `<section class="card next-card"><div class="card-title">🏁 Sua campanha</div>
        <div class="nc-result ${c.player_status}"><div class="nc-place">${c.player_status === "champion" ? "🏆 CAMPEÃO!" : esc(c.place_label || "Encerrado")}</div>
          <div>${c.player_wins} vitória${c.player_wins === 1 ? "" : "s"} · <b>🪙 ${fmt(c.prize_paid)}</b> moedas${c.forfeit ? " (abandono)" : ""}</div>
          ${champ && c.player_status !== "champion" ? `<div class="muted">Campeão: ${esc(champ.name)}</div>` : ""}</div>${extras}</section>`;
    }
    root().innerHTML = `
      <div class="comp-top"><button class="btn ghost" id="cpBack">← Campeonatos</button>
        <div class="ct-title"><h2>${c.icon} ${esc(c.name)}</h2><div class="muted">${c.tc_icon} ${esc(c.tc_label)} · ${esc(c.stage_label)} · <button class="link-btn" id="cpRules">📖 Regras</button></div></div>
        <button class="btn ghost danger ${c.player_status === "playing" ? "" : "hidden"}" id="cpForfeit">Abandonar</button></div>
      ${main}
      <section class="card">${c.kind === "copa"
        ? `<div class="card-title">🧩 Chave</div>${bracketHtml(c)}`
        : `<div class="card-title">📊 Classificação</div>${tableHtml(c)}`}</section>
      ${c.kind === "copa" ? "" : `<section class="card"><div class="card-title">📅 Rodadas</div><div id="cpRounds">${roundsHtml(c)}</div></section>`}`;

    $("cpBack").onclick = () => { compId = null; comp = null; render(); };
    $("cpRules").onclick = () => NexRules.show(c.kind, { time_control: c.time_control });
    if ($("cpPlay")) $("cpPlay").onclick = playMatch;
    $("cpForfeit").onclick = forfeit;
    const rd = $("cpRounds");
    if (rd) rd.onclick = e => {
      const b = e.target.closest("[data-rd]"); if (!b) return;
      viewRound = Math.max(1, Math.min(c.rounds.length, viewRound + +b.dataset.rd));
      rd.innerHTML = roundsHtml(c);
    };
  }

  async function playMatch() {
    try {
      const state = await A().api(`/api/champ/${compId}/play`, {});
      A().openGameState(state);
    } catch (e) { A().toast(e.message); }
  }

  async function forfeit() {
    if (!confirm("Abandonar esta competição? A partida atual conta como derrota e você não recebe prêmio.")) return;
    try {
      await A().api(`/api/champ/${compId}/forfeit`, {});
      A().toast("Você abandonou a competição.");
      openComp(compId);
    } catch (e) { A().toast(e.message); }
  }

  window.NexChamp = { open, openComp };
})();
