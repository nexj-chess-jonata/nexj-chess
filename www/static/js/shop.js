/* Nex-J Chess — Fase 5: Loja, Meu avatar e Carteira.
 *
 * - applyLooks(player): aplica o visual comprado (tabuleiro, peças, moldura e rosto do jogador)
 * - open(sub): abre a aba Loja em "store" | "avatar" | "wallet"
 * Usa as funções do app.js através de window.NexApp.
 */
(function () {
  const $ = id => document.getElementById(id);
  const A = () => window.NexApp;
  const fmt = n => (n || 0).toLocaleString("pt-BR");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let sub = "store", cat = "board", catalog = null, avatarData = null, draft = null, saved = null, wallet = null;

  /* ------------------------------------------------------------------ visual do jogador */
  function playerTraits(p) {
    return (p.looks && p.looks.avatar) || NexFace.playerDefault(p.id, p.name);
  }

  function faceSvg(p, traits, expr = "neutral", idSuffix = "") {
    return NexFace.svg({ id: "me" + p.id + idSuffix, name: p.name, traits: traits || playerTraits(p) }, expr);
  }

  function setFrame(el, frame) {
    [...el.classList].filter(c => c.startsWith("frame-")).forEach(c => el.classList.remove(c));
    if (frame && frame !== "none") el.classList.add("frame-" + frame);
  }

  function paintAvatar(el, p, expr) {
    if (!el || !p || !window.NexFace) return;
    el.innerHTML = faceSvg(p, null, expr);
    el.classList.add("has-face", "player-face");
    setFrame(el, p.looks ? p.looks.frame : "none");
  }

  function applyLooks(p) {
    if (!p || !p.looks) return;
    const [light, dark] = p.looks.board;
    const root = document.documentElement.style;
    root.setProperty("--sq-light", light);
    root.setProperty("--sq-dark", dark);
    // coordenadas precisam de cor sólida
    root.setProperty("--sq-light-c", light.startsWith("linear") ? "#e6e6e6" : light);
    root.setProperty("--sq-dark-c", dark.startsWith("linear") ? "#6b7079" : dark);
    if (window.NexusBoard && NexusBoard.setPieceSet) NexusBoard.setPieceSet(p.looks.pieces);
    // Fase 7: skin das peças, rastro do lance e efeitos
    document.documentElement.dataset.skin = p.looks.skin || "none";
    document.documentElement.dataset.trail = p.looks.trail || "none";
    if (window.NexFx) { NexFx.cfg.burst = p.looks.burst || "none"; NexFx.cfg.victory = p.looks.victory || "classic"; }
    paintAvatar($("pAvatar"), p);
    paintAvatar($("meAvatar"), p);
    if ($("profAvatar") && !$("profileView").classList.contains("hidden")) paintAvatar($("profAvatar"), p);
    const me = $("shopMe");
    if (me) {
      me.innerHTML = `<div class="avatar huge sh-av" id="shopMeAv"></div><div><b>${esc(p.name)}</b><div class="muted">@${esc(p.username)}</div></div>`;
      paintAvatar($("shopMeAv"), p);
    }
    $("shopCoins") && ($("shopCoins").textContent = fmt(p.coins));
  }

  /* ------------------------------------------------------------------ navegação */
  function open(which) {
    if (which) sub = which;
    document.querySelectorAll("#shopTabs button").forEach(b => b.classList.toggle("on", b.dataset.v === sub));
    $("shopStore").classList.toggle("hidden", sub !== "store");
    $("shopAvatar").classList.toggle("hidden", sub !== "avatar");
    $("shopWallet").classList.toggle("hidden", sub !== "wallet");
    const p = A().getPlayer();
    if (p) applyLooks(p);
    if (sub === "store") loadStore();
    if (sub === "avatar") loadAvatar();
    if (sub === "wallet") loadWallet();
  }

  /* ------------------------------------------------------------------ LOJA */
  async function loadStore() {
    try { catalog = await A().api("/api/shop"); renderStore(); } catch (e) { A().toast(e.message); }
  }

  const AV_PREVIEW = {
    av_dyed: { hairColor: "#ff4f8b" }, av_sunglasses: { glasses: "sun" }, av_galaxy: { bg: "galaxy" },
    av_headphones: { hat: "headphones" }, av_goldshirt: { shirt: "gold" }, av_tophat: { hat: "tophat" },
    av_wizard: { hat: "wizard" }, av_crown: { hat: "crown" },
  };

  function preview(item, p) {
    const looks = catalog.looks;
    if (item.cat === "board") {
      const [l, d] = item.data;
      let cells = "";
      for (let i = 0; i < 16; i++) {
        const light = (Math.floor(i / 4) + i) % 2 === 0;
        const pc = { 5: "wN", 10: "bQ", 3: "bK", 12: "wR" }[i];
        cells += `<i style="background:${light ? l : d}">${pc ? `<img src="${NexusBoard.pieceUrl(looks.pieces, pc)}" alt="">` : ""}</i>`;
      }
      return `<div class="pv-board">${cells}</div>`;
    }
    if (item.cat === "pieces") {
      const [l, d] = looks.board;
      return `<div class="pv-pieces" style="--l:${l};--d:${d}">` +
        ["wK", "wQ", "wN", "bB", "bQ", "bK"].map(c => `<i><img src="${NexusBoard.pieceUrl(item.data, c)}" alt=""></i>`).join("") + `</div>`;
    }
    if (item.cat === "frame") {
      return `<div class="pv-frame"><div class="avatar huge has-face player-face ${item.data !== "none" ? "frame-" + item.data : ""}">${faceSvg(p, null, "happy", "f" + item.key)}</div></div>`;
    }
    if (item.cat === "avatar") {
      const t = { ...playerTraits(p), ...(AV_PREVIEW[item.key] || {}) };
      return `<div class="pv-frame"><div class="avatar huge has-face player-face">${faceSvg(p, t, "happy", "a" + item.key)}</div></div>`;
    }
    if (item.cat === "skin") {
      const [l, d] = looks.board;
      const pcs = [["wK", "w"], ["wQ", "w"], ["wN", "w"], ["bB", "b"], ["bQ", "b"], ["bK", "b"]];
      return `<div class="pv-skin skin-pv" data-skin="${item.data}" style="--l:${l};--d:${d}">` +
        pcs.map(([c, s]) => `<i><img class="${s}" src="${NexusBoard.pieceUrl(looks.pieces, c)}" alt=""></i>`).join("") + `</div>`;
    }
    if (item.cat === "crest") {
      const club = Object.assign({ name: "Seu clube", c1: "#1d4ed8", c2: "#ffffff", glyph: "♞" }, catalog.club || {}, { style: item.data });
      return `<div class="pv-crest">${NexCrest.svg(club, 64)}</div>`;
    }
    if (item.cat === "trail") {
      const T = { none: ["#f3e08a", "#b7a64c"], gold: ["#ffe9a0", "#d9a521"], fire: ["#ffc388", "#e8571f"], ice: ["#cdf1ff", "#4fb3df"],
        neon: ["#b9fff0", "#19b99a"], rainbow: ["#ffd93d", "#4dc4ff"] }[item.data] || ["#f3e08a", "#b7a64c"];
      const [l, d] = looks.board;
      return `<div class="pv-trail" style="--l:${l};--d:${d}"><i></i><i></i><i style="background:${T[0]}"></i><i style="background:${T[1]}"></i><i></i><i></i></div>`;
    }
    if (item.cat === "burst" || item.cat === "victory") {
      const ico = { none: "—", sparks: "✨", stars: "⭐", hearts: "💖", smoke: "💨", coins: "🪙", fire: "🔥",
        classic: "🎊", fireworks: "🎆" }[item.data] || "✨";
      return `<div class="pv-fx" data-fx="${item.cat}" data-v="${item.data}">${ico}<small>${item.data === "none" ? "" : "toque para ver"}</small></div>`;
    }
    return `<div class="pv-boost">🧊<span>${item.count || 0}/${item.max}</span></div>`;
  }

  function button(item, coins) {
    const short = coins < item.price;
    if (item.cat === "boost") {
      const full = item.count >= item.max;
      return `<button class="btn ${full ? "ghost" : "gold"} sm" data-buy="${item.key}" ${full ? "disabled" : ""}>` +
        (full ? "Máximo guardado" : `Comprar · ${item.price} 🪙`) + `</button>`;
    }
    if (item.owned) {
      if (item.cat === "avatar") return `<button class="btn outline-gold sm" data-goavatar="1">✓ Liberado · usar</button>`;
      return item.equipped ? `<button class="btn ghost sm" disabled>✓ Em uso</button>`
        : `<button class="btn outline-gold sm" data-equip="${item.key}">Usar</button>`;
    }
    return `<button class="btn ${short ? "ghost short" : "gold"} sm" data-buy="${item.key}">${item.price ? `Comprar · ${item.price} 🪙` : "Grátis"}</button>`;
  }

  function renderStore() {
    const p = A().getPlayer();
    $("shopCats").innerHTML = catalog.categories.map(c =>
      `<button data-cat="${c.key}" class="${c.key === cat ? "on" : ""}">${c.icon} ${c.name}</button>`).join("");
    const items = catalog.items.filter(i => i.cat === cat);
    $("shopGrid").innerHTML = items.map(i => `
      <div class="shop-item ${i.owned ? "owned" : ""} ${i.equipped ? "equipped" : ""} r-${i.rarity}">
        ${i.rarity && i.rarity !== "common" && i.cat !== "boost" ? `<span class="si-rarity ${i.rarity}">${{ rare: "Rara", epic: "Épica", legendary: "Lendária" }[i.rarity]}</span>` : ""}
        ${i.equipped ? `<span class="si-badge">EM USO</span>` : i.price === 0 ? `<span class="si-badge free">GRÁTIS</span>` : ""}
        ${preview(i, p)}
        <div class="si-name">${esc(i.name)}</div>
        <div class="si-desc muted">${esc(i.desc)}</div>
        ${button(i, catalog.coins)}
      </div>`).join("");
  }

  async function buy(key) {
    const item = catalog.items.find(i => i.key === key);
    if (!item) return;
    if (catalog.coins < item.price) {
      A().toast(`Faltam ${item.price - catalog.coins} 🪙 para "${item.name}". Jogue ranqueadas, puzzles e missões para ganhar!`);
      return;
    }
    if (!confirm(`Comprar "${item.name}" por ${item.price} 🪙?`)) return;
    try {
      const r = await A().api("/api/shop/buy", { key });
      catalog = r.catalog;
      A().applyPlayer(r.user);
      renderStore();
      A().beep("buy");
      A().toast(item.cat === "avatar" ? `🎉 ${item.name} liberado! Use em "Meu avatar".`
        : item.cat === "boost" ? "🧊 Protetor guardado! Ele é usado sozinho se você perder um dia."
        : `🎉 ${item.name} comprado e já está em uso!`);
    } catch (e) { A().toast(e.message); }
  }

  async function equip(key) {
    try {
      const r = await A().api("/api/shop/equip", { key });
      catalog = r.catalog;
      A().applyPlayer(r.user);
      renderStore();
    } catch (e) { A().toast(e.message); }
  }

  /* ------------------------------------------------------------------ MEU AVATAR */
  const FIELDS = [
    ["skin", "Pele", "color"], ["face", "Rosto", "chip"], ["hair", "Cabelo", "chip"], ["hairColor", "Cor do cabelo", "color"],
    ["eyeShape", "Olhos", "chip"], ["beard", "Barba", "chip"], ["glasses", "Óculos", "chip"], ["hat", "Chapéu", "chip"],
    ["shirt", "Roupa", "color"], ["bg", "Fundo", "color"], ["freckles", "Sardas", "chip"], ["earrings", "Brincos", "chip"],
  ];
  const LABELS = {
    round: "Redondo", oval: "Oval", square: "Quadrado", short: "Curto", side: "De lado", buzz: "Raspado", curly: "Cacheado",
    bald: "Careca", mohawk: "Moicano", afro: "Black power", long: "Longo", bun: "Coque", ponytail: "Rabo de cavalo", bob: "Chanel",
    dot: "Pontinho", focus: "Concentrado", none: "Nenhum", stubble: "Por fazer", mustache: "Bigode", goatee: "Cavanhaque",
    full: "Cheia", sun: "Escuros", beanie: "Gorro", cap: "Boné", band: "Faixa", headphones: "Fone", tophat: "Cartola",
    wizard: "Mago", crown: "Coroa", true: "Sim", false: "Não",
  };
  const label = (field, v) => field === "eyeShape" && v === "round" ? "Normal" : field === "glasses" && v === "round" ? "Redondos"
    : field === "glasses" && v === "square" ? "Quadrados" : LABELS[String(v)] || v;

  async function loadAvatar() {
    try {
      avatarData = await A().api("/api/avatar");
      const p = A().getPlayer();
      saved = avatarData.avatar || NexFace.playerDefault(p.id, p.name);
      draft = { ...saved };
      renderAvatar();
    } catch (e) { A().toast(e.message); }
  }

  function renderAvatarPreview() {
    const p = A().getPlayer();
    $("avBig").innerHTML = `<div class="avatar has-face player-face av-face ${p.looks.frame !== "none" ? "frame-" + p.looks.frame : ""}">${faceSvg(p, draft, "happy", "big")}</div>`;
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    $("avSave").disabled = !dirty;
    $("avReset").disabled = !dirty;
  }

  function renderAvatar() {
    const opts = avatarData.options;
    $("avEditor").innerHTML = FIELDS.map(([field, name, kind]) => {
      const list = opts[field] || [];
      const html = list.map(o => {
        const on = draft[field] === o.v;
        const lock = o.locked ? `<b class="lk">🔒${o.price}</b>` : "";
        if (kind === "color") {
          const bg = o.v === "gold" ? "linear-gradient(90deg,#b8860b,#ffe082,#b8860b)"
            : o.v === "galaxy" ? "radial-gradient(circle at 30% 25%,#8e5cff,#2a1b6b 55%,#0b0620)" : o.v;
          return `<button class="sw ${on ? "on" : ""} ${o.locked ? "locked" : ""}" data-f="${field}" data-v='${JSON.stringify(o.v)}' style="background:${bg}" title="${o.locked ? "Liberar na Loja" : ""}">${lock}</button>`;
        }
        return `<button class="chip-o ${on ? "on" : ""} ${o.locked ? "locked" : ""}" data-f="${field}" data-v='${JSON.stringify(o.v)}'>${label(field, o.v)}${lock}</button>`;
      }).join("");
      return `<div class="av-field"><div class="field-label">${name}</div><div class="av-opts ${kind}">${html}</div></div>`;
    }).join("");
    renderAvatarPreview();
  }

  function pickOption(btn) {
    const field = btn.dataset.f, v = JSON.parse(btn.dataset.v);
    const o = avatarData.options[field].find(x => x.v === v);
    if (o && o.locked) {
      if (confirm(`Essa opção é liberada na Loja por ${o.price} 🪙. Ir para a Loja agora?`)) { cat = "avatar"; open("store"); }
      return;
    }
    draft[field] = v;
    document.querySelectorAll(`#avEditor [data-f="${field}"]`).forEach(b => b.classList.toggle("on", b === btn));
    renderAvatarPreview();
  }

  function randomize() {
    const opts = avatarData.options;
    FIELDS.forEach(([f]) => {
      const free = opts[f].filter(o => !o.locked);
      let pool = free;
      if (["hat", "glasses", "beard"].includes(f)) pool = Math.random() < 0.6 ? free.filter(o => o.v === "none") : free;
      if (f === "freckles" || f === "earrings") pool = Math.random() < 0.75 ? free.filter(o => o.v === false) : free;
      draft[f] = pool[Math.floor(Math.random() * pool.length)].v;
    });
    renderAvatar();
  }

  async function saveAvatar() {
    try {
      const r = await A().api("/api/avatar", { traits: draft });
      saved = { ...draft };
      A().applyPlayer(r.user);
      renderAvatarPreview();
      A().toast("🙂 Avatar salvo!");
    } catch (e) { A().toast(e.message); }
  }

  /* ------------------------------------------------------------------ CARTEIRA */
  async function loadWallet() {
    try { wallet = await A().api("/api/wallet"); renderWallet(); } catch (e) { A().toast(e.message); }
  }

  function renderWallet() {
    const w = wallet, t = w.totals;
    $("shopCoins").textContent = fmt(w.coins);
    const byKind = Object.entries(t.by_kind).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    $("walSum").innerHTML = `
      <div class="ws-row"><div><div class="muted">Ganhou no total</div><b class="mono up">+${fmt(t.earned)}</b></div>
        <div><div class="muted">Gastou</div><b class="mono down">−${fmt(t.spent)}</b></div>
        <div><div class="muted">Saldo</div><b class="mono">${fmt(w.coins)} 🪙</b></div></div>
      <div class="ws-kinds">${byKind.map(([k, v]) => `<span>${w.kinds[k]?.icon || "•"} ${w.kinds[k]?.label || k} <b class="mono">${fmt(v)}</b></span>`).join("") || `<span class="muted">Ainda sem ganhos.</span>`}</div>`;
    $("walRules").innerHTML = w.rules.map(r => `<tr><td>${r.icon}</td><td>${r.text}</td><td class="mono">+${r.coins} 🪙</td></tr>`).join("");
    $("walHist").innerHTML = w.history.map(h => `
      <li><span class="wh-ic">${w.kinds[h.kind]?.icon || "•"}</span>
        <div class="wh-body"><div>${esc(h.reason)}</div><div class="muted">${h.date} · saldo ${fmt(h.balance)}</div></div>
        <b class="mono ${h.amount >= 0 ? "up" : "down"}">${h.amount >= 0 ? "+" : "−"}${fmt(Math.abs(h.amount))}</b></li>`).join("")
      || `<li class="empty">Nenhum lançamento ainda. Jogue ranqueadas, resolva puzzles e complete missões!</li>`;
    renderNjc();
  }

  const ST = { sent: ["✓ Enviado", "ok"], pending: ["⏳ Pendente", "live"], refunded: ["↩ Estornado", "bad"] };

  function renderNjc() {
    const n = wallet.njc;
    const st = $("njcStatus");
    if (!n.enabled) {
      st.textContent = "Desligada"; st.className = "njc-status off";
      $("njcBody").innerHTML = `
        <p>A ponte vem <b>desligada</b> — o jogo funciona normalmente sem ela. Quando o NexusJCoin tiver a rota do xadrez,
        dá para converter moedas do jogo em NJC (hoje a taxa configurada é <b>${n.rate} 🪙 = 1 NJC</b>).</p>
        ${n.config_error ? `<p class="njc-err">⚠️ ${esc(n.config_error)}</p>` : ""}
        <ol class="njc-steps">
          <li>No NexusJCoin: instale a rota do arquivo <code>integracao_nexusjcoin/rota_nexusjcoin.py</code></li>
          <li>No PC do jogo: copie <code>nexusjcoin.exemplo.json</code> para a pasta <code>data</code> com o nome <code>nexusjcoin.json</code>, coloque a chave e <code>"enabled": true</code></li>
          <li>Feche e abra o jogo de novo</li>
        </ol>
        <p class="muted">Passo a passo completo em <code>integracao_nexusjcoin/LEIA-ME.txt</code>.</p>`;
      return;
    }
    st.textContent = "Ligada"; st.className = "njc-status on";
    const left = Math.max(0, n.daily_limit - n.sent_today);
    $("njcBody").innerHTML = `
      <div class="njc-row">
        <label class="njc-label">Sua carteira NexusJCoin
          <div class="njc-inline"><input id="njcWallet" value="${esc(n.wallet || "")}" placeholder="endereço da carteira NJC" maxlength="120">
          <button class="btn ghost sm" id="njcSaveWallet">Salvar</button><button class="btn ghost sm" id="njcTest">Testar conexão</button></div>
        </label>
        <div class="muted" id="njcTestMsg"></div>
      </div>
      <div class="njc-send">
        <div><div class="field-label">Enviar moedas do jogo</div>
          <div class="njc-inline"><input id="njcCoins" type="number" min="${n.min_coins}" step="${n.rate}" value="${Math.min(Math.max(n.min_coins, n.rate), Math.max(n.min_coins, left))}">
          <span class="njc-quote mono" id="njcQuote"></span>
          <button class="btn gold sm" id="njcSend" ${n.wallet ? "" : "disabled"}>Enviar ▶</button></div>
          <div class="muted">Taxa: ${n.rate} 🪙 = 1 NJC · mínimo ${n.min_coins} 🪙 · hoje ainda pode enviar <b>${fmt(left)} 🪙</b></div>
        </div>
      </div>
      <div class="field-label">Últimos envios</div>
      <ul class="njc-list">${n.transfers.map(t => `
        <li><span class="pill ${ST[t.status][1]}">${ST[t.status][0]}</span>
          <div class="wh-body"><div><b class="mono">${fmt(t.coins)} 🪙 → ${t.amount} NJC</b></div>
            <div class="muted">${t.date} · ${esc(t.receipt || t.message || t.reference)}</div></div>
          ${t.status === "pending" ? `<button class="btn ghost sm" data-njc="retry" data-id="${t.id}">Tentar de novo</button>
            <button class="btn ghost sm danger" data-njc="cancel" data-id="${t.id}">Cancelar</button>` : ""}</li>`).join("")
        || `<li class="empty">Nenhum envio ainda.</li>`}</ul>`;
    const quote = () => { const c = +$("njcCoins").value || 0; $("njcQuote").textContent = `= ${(c / n.rate).toFixed(2)} NJC`; };
    $("njcCoins").oninput = quote; quote();
    $("njcSaveWallet").onclick = async () => {
      try { const r = await A().api("/api/wallet/njc/wallet", { wallet: $("njcWallet").value }); wallet.njc = r.njc; renderNjc(); A().toast("Carteira salva."); }
      catch (e) { A().toast(e.message); }
    };
    $("njcTest").onclick = async () => {
      $("njcTestMsg").textContent = "Testando…";
      try { const r = await A().api("/api/wallet/njc/status"); $("njcTestMsg").textContent = (r.online ? "✅ " : "❌ ") + r.message; }
      catch (e) { $("njcTestMsg").textContent = "❌ " + e.message; }
    };
    $("njcSend").onclick = async () => {
      const coins = +$("njcCoins").value || 0;
      if (!confirm(`Enviar ${coins} 🪙 (= ${(coins / n.rate).toFixed(2)} NJC) para a carteira ${n.wallet}?`)) return;
      $("njcSend").disabled = true;
      try {
        const r = await A().api("/api/wallet/njc/send", { coins });
        A().applyPlayer(r.user);
        const tr = r.transfer;
        A().toast(tr.status === "sent" ? `✅ Enviado! ${tr.amount} NJC a caminho da sua carteira.`
          : tr.status === "refunded" ? `↩ Não foi: ${tr.message} As moedas voltaram.` : `⏳ ${tr.message}`);
        await loadWallet();
      } catch (e) { A().toast(e.message); $("njcSend").disabled = false; }
    };
  }

  async function njcAction(action, id) {
    if (action === "cancel" && !confirm("Cancelar só se tiver certeza de que NÃO chegou no NexusJCoin. As moedas voltam para você. Continuar?")) return;
    try {
      const r = await A().api(`/api/wallet/njc/${id}/${action}`, {});
      A().applyPlayer(r.user);
      await loadWallet();
    } catch (e) { A().toast(e.message); }
  }

  /* ------------------------------------------------------------------ eventos */
  document.addEventListener("DOMContentLoaded", () => {
    $("shopTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) open(b.dataset.v); });
    $("shopCats").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (b) { cat = b.dataset.cat; renderStore(); } });
    $("shopGrid").addEventListener("click", e => {
      const fx = e.target.closest(".pv-fx");
      if (fx && fx.dataset.v !== "none") {            // ver o efeito antes de comprar
        if (fx.dataset.fx === "burst") NexFx.burst(fx, fx.dataset.v); else NexFx.victory(120, fx.dataset.v);
        return;
      }
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.buy) buy(b.dataset.buy);
      if (b.dataset.equip) equip(b.dataset.equip);
      if (b.dataset.goavatar) open("avatar");
    });
    $("avEditor").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) pickOption(b); });
    $("avRandom").onclick = randomize;
    $("avReset").onclick = () => { draft = { ...saved }; renderAvatar(); };
    $("avSave").onclick = saveAvatar;
    $("njcBody").addEventListener("click", e => { const b = e.target.closest("[data-njc]"); if (b) njcAction(b.dataset.njc, b.dataset.id); });
  });

  window.NexShop = { applyLooks, paintAvatar, open };
})();
