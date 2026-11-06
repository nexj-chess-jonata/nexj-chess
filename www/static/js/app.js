/* Nex-J Chess — lógica da tela */
(function () {
  const APP_JS_VERSION = "8.0";
  const $ = id => document.getElementById(id);
  const PIECE_ICON = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };
  const ORDER = { p: 0, n: 1, b: 2, r: 3, q: 4 };

  let game = null;       // estado da partida ao vivo (ou a última que terminou)
  let analysis = null;   // { gameId, data, meta } quando o modo análise está aberto
  let view = null;       // null = lance atual; número = lance sendo revisto (0 = posição inicial)
  let levels = [];
  let player = null;
  let pick = { level: "auto", color: "random", mode: "rated", tc: "none" };
  let timeControls = [];
  const store = {  // preferências deste navegador (se o navegador bloquear, só não lembra)
    get(k, d) { try { const v = localStorage.getItem("nexj." + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("nexj." + k, JSON.stringify(v)); } catch (_) {} },
  };
  pick.tc = store.get("tc", "none");
  let busy = false;

  const board = new NexusBoard($("board"), { onMove: sendMove });

  /* ---------------- API ---------------- */
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 401) { showAuth(); throw new Error(data.error || "Faça login"); }
    if (!res.ok) throw new Error(data.error || "Erro no servidor");
    return data;
  }

  /* ---------------- sons e voz (Fase 6: static/js/prefs.js) ---------------- */
  const beep = kind => NexSound.play(kind);
  const speak = text => NexSound.speak(text);

  function soundFor(state, prevHistoryLen) {
    const last = state.history[state.history.length - 1] || "";
    const endSound = () => beep({ win: "win", loss: "loss", draw: "draw" }[state.result?.outcome] || "draw");
    if (state.history.length === prevHistoryLen) {
      if (state.over) endSound();
      return;
    }
    if (last.includes("#")) { beep("check"); speak("Xeque-mate!"); setTimeout(endSound, 650); }
    else if (last.includes("+")) { beep("check"); speak("Xeque!"); }
    else if (state.over) { beep(last.includes("x") ? "capture" : "move"); setTimeout(endSound, 250); }
    else if (last.startsWith("O-O")) beep("castle");
    else if (last.includes("x")) beep("capture");
    else beep("move");
  }

  /* ---------------- jogador ---------------- */
  function ratingText(p) {
    if (!p.placement.done) return `🎯 ${p.placement.played}/${p.placement.total}`;
    return p.provisional ? `${p.rating}?` : `${p.rating}`;
  }

  function applyPlayer(p) {
    if (player && player.id === p.id && (p.coins || 0) > (player.coins || 0)) {
      const gain = (p.coins || 0) - (player.coins || 0);
      setTimeout(() => { NexFx.coinFloat($("coinPill"), gain); beep("coin"); }, 300);
    }
    player = p;
    $("pName").textContent = p.name;
    if (window.NexShop) NexShop.applyLooks(p);   // rosto, moldura, tabuleiro e peças (Fase 5)
    $("coinBalance").textContent = (p.coins || 0).toLocaleString("pt-BR");
    $("meName").textContent = p.name;
    $("pRating").textContent = ratingText(p);
    $("meRating").textContent = ratingText(p);
    $("pRating").title = !p.placement.done ? "Em classificação"
      : p.provisional ? `Rating provisório: faltam ${p.provisional_left} partidas ranqueadas` : "Seu rating";
    $("pTitle").textContent = p.placement.done ? `${p.title_icon} ${p.title}` : "Em classificação";
    $("pTitle").dataset.tier = p.title_key;
    $("umName").textContent = p.name;
    $("umUser").textContent = "@" + p.username;
    return p;
  }

  async function loadPlayer() {
    return applyPlayer(await api("/api/player"));
  }

  function openNameModal() {
    $("nameInput").value = player ? player.name : "";
    $("nameModal").classList.add("open");
    setTimeout(() => $("nameInput").select(), 50);
  }

  async function saveName() {
    try {
      await api("/api/player/name", { name: $("nameInput").value });
      await loadPlayer();
      closeModals();
      toast("Nome salvo ✓");
    } catch (e) { toast(e.message); }
  }

  async function loadRecent() {
    const list = await api("/api/games/recent");
    const ul = $("recent");
    if (!list.length) { ul.innerHTML = `<li class="empty">Jogue sua primeira partida!</li>`; return; }
    ul.innerHTML = list.map(g => {
      const label = { win: "V", loss: "D", draw: "E" }[g.outcome];
      const change = g.rated
        ? `<span class="mono ${g.rating_change >= 0 ? "up" : "down"}">${g.rating_change >= 0 ? "+" : ""}${g.rating_change}</span>`
        : `<span class="muted">${g.mode === "placement" ? "🎯" : "casual"}</span>`;
      const acc = g.accuracy != null ? `<span class="r-acc mono" title="Sua precisão">${Math.round(g.accuracy)}%</span>` : "";
      return `<li data-id="${g.id}" title="Clique para ver a análise"><span class="res ${g.outcome}">${label}</span>` +
        `<span class="r-name">${g.bot_name} <small class="mono">(${g.bot_rating})</small></span>${acc}${change}<span class="r-go">📊</span></li>`;
    }).join("");
  }

  // Se a página, o script e o servidor não forem da mesma versão (ex.: servidor antigo ainda aberto),
  // mostra um aviso claro — criado aqui mesmo, caso a página antiga não tenha o espaço do aviso.
  function checkVersion(s) {
    if (s.version === APP_JS_VERSION && document.body.dataset.version === APP_JS_VERSION) return true;
    let w = $("versionWarn");
    if (!w) {
      w = document.createElement("div");
      w.id = "versionWarn";
      w.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:560px;" +
        "width:calc(100% - 32px);background:#3a1a1a;border:1px solid #ef5b5b;color:#ffdede;border-radius:14px;" +
        "padding:14px 16px;font:14px/1.5 system-ui,sans-serif;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.5)";
      w.innerHTML = "⚠️ Atualização incompleta: o jogo aberto é de outra versão.<br>Feche <b>todas as janelas pretas</b> " +
        "do Nex-J Chess (ou reinicie o computador) e abra o <b>iniciar.bat</b> de novo.";
      document.body.appendChild(w);
    }
    w.classList.remove("hidden");
    return false;
  }

  async function loadStatus() {
    const s = await api("/api/status");
    checkVersion(s);
    $("engineStatus").innerHTML = (s.stockfish
      ? `<span class="dot ok"></span> Motor: ${s.engine}`
      : `<span class="dot warn"></span> Stockfish não encontrado — usando motor interno (bots mais fracos). Veja o README.`) +
      ` <span class="ver">· Nex-J Chess v${s.version}</span>`;
  }

  /* ---------------- partida ---------------- */
  /* ---------------- rostos dos bots ---------------- */
  let faceBot = null, faceTimer = null;
  function faceHtml(bot, expr = "neutral") {
    return window.NexFace && bot && bot.id ? NexFace.svg(bot, expr) : (bot ? bot.initials || "?" : "?");
  }
  function setBotExpr(expr, ms = 2600) {
    if (!faceBot) return;
    [$("botAvatar"), $("botAvatarBig")].forEach(a => { a.innerHTML = faceHtml(faceBot, expr); });
    clearTimeout(faceTimer);
    if (ms && expr !== "neutral") faceTimer = setTimeout(() => setBotExpr("neutral", 0), ms);
  }

  function showBot(bot) {
    const set = (id, v) => { $(id).textContent = v; };
    faceBot = bot && bot.id ? bot : null;
    [$("botAvatar"), $("botAvatarBig")].forEach(a => {
      a.innerHTML = faceHtml(bot);
      a.style.background = bot.avatar_color;
      a.classList.toggle("has-face", !!faceBot);
    });
    set("botName", bot.name); set("botFlag", bot.flag || "");
    set("botRating", bot.rating); set("botPers", bot.personality_icon ? `${bot.personality_icon} ${bot.personality_label}` : "");
    set("botCardName", `${bot.flag || ""} ${bot.name}`);
    set("botCardLevel", `${bot.level_name} · ${bot.rating} · ${bot.personality_icon} ${bot.personality_label}`);
    set("botCardDesc", bot.personality_desc);
    $("botCard").classList.remove("hidden");
  }

  function render(state, { animate = false, silent = false } = {}) {
    const prevLen = game ? game.history.length : 0;
    const sameGame = game && game.id === state.id;
    game = state;
    if (analysis) return; // no modo análise o tabuleiro mostra a partida analisada
    if (!sameGame || silent) board.setOrientation(state.player_color);

    view = null; // qualquer atualização da partida volta para o lance atual
    $("reviewBanner").classList.remove("show");
    if (!sameGame || silent || state.over) board.premoves = [];   // a fila de pré-movimentos só vale na mesma partida
    board.setState({
      fen: state.fen, legal: state.legal_moves, lastMove: state.last_move,
      check: state.check, interactive: state.player_turn && !busy, animate,
      premoveOk: !state.over && !state.player_turn,
    });
    if (sameGame && !silent) {
      soundFor(state, prevLen); reactFace(state, prevLen);
      const lastSan = state.history[state.history.length - 1] || "";
      if (state.history.length !== prevLen && lastSan.includes("x") && state.last_move) {   // efeito de captura (loja)
        const sqEl = board.squares[state.last_move.slice(2, 4)];
        if (sqEl) setTimeout(() => NexFx.burst(sqEl), 120);
      }
    }
    if (state.player_turn && board.premoves.length) runPremove(state);

    renderMoveList();
    renderCoachPanel(state);

    // peças capturadas: em cima as peças que o BOT capturou (as suas), embaixo as que você capturou
    const me = state.player_color, bot = me === "white" ? "black" : "white";
    const adv = me === "white" ? state.captured.advantage : -state.captured.advantage;
    $("capBottom").innerHTML = capturedHtml(state.captured[bot], adv > 0 ? adv : 0);
    $("capTop").innerHTML = capturedHtml(state.captured[me], adv < 0 ? -adv : 0);

    $("btnResign").disabled = $("btnDraw").disabled = state.over;
    $("btnAnalyze").classList.toggle("hidden", !(state.over && state.result && state.result.game_id));
    $("modeTag").textContent = state.tournament ? `🏆 ${state.tournament.label}` :
      state.mode === "placement" ? "🎯 Classificação" : state.rated ? "🏆 Ranqueada" : "☕ Casual";
    $("colorTag").textContent = state.player_color === "white" ? "♔ Você de brancas" : "♚ Você de pretas";
    $("tcTag").textContent = state.clock ? `${state.clock.icon} ${state.clock.label}` : "∞ Sem tempo";
    syncClock(state);

    if (!silent && state.message) say(state.message);
    if (!silent && state.over) finish(state);
  }

  function capturedHtml(list, adv) {
    const sorted = [...list].sort((a, b) => ORDER[a] - ORDER[b]);
    return sorted.map(p => `<span>${PIECE_ICON[p]}</span>`).join("") + (adv ? `<em>+${adv}</em>` : "");
  }

  /* ---------------- lista de lances + navegação ---------------- */
  function positions() { return analysis?.data ? analysis.data.positions : (game ? game.timeline : []); }
  function sans() { return analysis?.data ? analysis.data.plies.map(p => p.san) : (game ? game.history : []); }
  function lastPly() { return Math.max(0, positions().length - 1); }

  function renderMoveList() {
    const ol = $("moves");
    const list = sans();
    const plies = analysis?.data?.plies;
    if (!list.length) { ol.innerHTML = `<li class="empty">Nenhum lance ainda.</li>`; markMoveList(); return; }
    const cell = i => {
      if (i >= list.length) return `<span></span>`;
      const p = plies && plies[i];
      const icon = p ? `<i class="cls" style="background:${p.hex}" title="${p.label}">${p.symbol}</i>` : "";
      return `<span class="mv" data-ply="${i + 1}">${icon}${list[i]}</span>`;
    };
    let html = "";
    for (let i = 0; i < list.length; i += 2) html += `<li><span class="n">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
    ol.innerHTML = html;
    markMoveList();
    if (view === null) ol.scrollTop = ol.scrollHeight;
  }

  function markMoveList() {
    const n = lastPly();
    const at = view === null ? n : view;
    document.querySelectorAll("#moves .mv").forEach(el => el.classList.toggle("cur", +el.dataset.ply === at));
    const cur = document.querySelector("#moves .mv.cur");
    if (cur && view !== null) {
      // rola só a lista de lances — a página (e o tabuleiro) ficam parados
      const ol = $("moves"), r = cur.getBoundingClientRect(), o = ol.getBoundingClientRect();
      if (r.top < o.top) ol.scrollTop -= o.top - r.top + 6;
      else if (r.bottom > o.bottom) ol.scrollTop += r.bottom - o.bottom + 6;
    }
    const has = positions().length > 0;
    document.querySelector('[data-nav="first"]').disabled = document.querySelector('[data-nav="prev"]').disabled = !has || at === 0;
    document.querySelector('[data-nav="next"]').disabled = document.querySelector('[data-nav="last"]').disabled = !has || at === n;
  }

  function showPly(ply) {
    const tl = positions();
    if (!tl.length) return;
    const n = tl.length - 1;
    ply = Math.max(0, Math.min(n, ply));
    if (!analysis && ply === n) return goLive();
    view = ply;
    const t = tl[ply];
    let badge = null;
    if (analysis && ply > 0) {
      const p = analysis.data.plies[ply - 1];
      badge = { square: p.uci.slice(2, 4), symbol: p.symbol, hex: p.hex };
    }
    board.setState({ fen: t.fen, legal: [], lastMove: t.uci, check: t.check, interactive: false, badge });
    if (analysis) {
      updateAnalysisComment(ply);
    } else {
      $("reviewPly").textContent = ply === 0 ? "inicial" : `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."} ${sans()[ply - 1]}`;
      $("reviewBanner").classList.add("show");
      const c = game && game.coach_log && game.coach_log[String(ply)];
      if (c) showCoach(c);
    }
    markMoveList();
  }

  function goLive() {
    if (analysis) return showPly(lastPly());
    if (!game) return;
    const wasReviewing = view !== null;
    view = null;
    $("reviewBanner").classList.remove("show");
    if (wasReviewing) {
      board.setState({
        fen: game.fen, legal: game.legal_moves, lastMove: game.last_move,
        check: game.check, interactive: game.player_turn && !busy,
        premoveOk: !game.over && !game.player_turn,
      });
    }
    markMoveList();
  }

  function navigate(dir) {
    if (!positions().length) return;
    const at = view === null ? lastPly() : view;
    ({ first: () => showPly(0), prev: () => showPly(at - 1), next: () => showPly(at + 1), last: goLive })[dir]();
  }

  /* ---------------- RELÓGIO ---------------- */
  // O servidor manda quanto tempo resta; aqui só fazemos a contagem visual entre uma resposta e outra.
  let clk = null;           // { white, black, running, base, syncedAt, gameId }
  let clkRaf = null, flagSent = false, warned = false;

  function fmtClock(sec, base) {
    sec = Math.max(0, sec);
    if (sec < 20 && base < 3600) return sec.toFixed(1);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function syncClock(state) {
    const has = !!state.clock;
    $("clockTop").classList.toggle("hidden", !has);
    $("clockBottom").classList.toggle("hidden", !has);
    if (!has) { clk = null; cancelAnimationFrame(clkRaf); return; }
    if (!clk || clk.gameId !== state.id) { flagSent = false; warned = false; }
    clk = { ...state.clock, syncedAt: performance.now(), gameId: state.id, me: state.player_color, over: state.over };
    cancelAnimationFrame(clkRaf);
    drawClock();
  }

  function clockValue(color) {
    if (!clk) return 0;
    let v = clk[color];
    if (clk.running === color && !clk.over) v -= (performance.now() - clk.syncedAt) / 1000;
    return Math.max(0, v);
  }

  function drawClock() {
    if (!clk) return;
    const me = clk.me, bot = me === "white" ? "black" : "white";
    const lowAt = clk.base >= 600 ? 30 : 10;
    [["clockBottom", me], ["clockTop", bot]].forEach(([id, color]) => {
      const el = $(id), v = clockValue(color);
      el.querySelector("span").textContent = fmtClock(v, clk.base);
      el.classList.toggle("active", clk.running === color && !clk.over);
      el.classList.toggle("low", v <= lowAt);
      el.classList.toggle("zero", v <= 0);
    });
    const mine = clockValue(me);
    if (clk.running === me && !clk.over) {
      if (!warned && mine <= 10 && clk.base >= 60) { warned = true; if (NexPrefs.get("lowTime")) { beep("tick"); setTimeout(() => beep("tick"), 180); } }
      if (mine <= 0 && !flagSent && game) {
        flagSent = true;
        api(`/api/game/${game.id}/flag`, {}).then(st => render(st)).catch(() => {});
      }
    }
    if (clk.running && !clk.over) clkRaf = requestAnimationFrame(drawClock);
  }

  /* ---------------- balão / toast ---------------- */
  let bubbleTimer;
  function say(text) {
    const b = $("bubble");
    b.textContent = text;
    b.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => b.classList.remove("show"), 3800);
  }

  function setThinking(on) {
    $("thinking").classList.toggle("on", on);
    if (faceBot) setBotExpr(on ? "thinking" : "neutral", 0);
  }

  // expressão do bot conforme o que aconteceu no último lance
  function reactFace(state, prevLen) {
    if (!faceBot || state.history.length === prevLen && !state.over) return;
    if (state.over && state.result) {
      setBotExpr({ win: "sad", loss: "happy", draw: "neutral" }[state.result.outcome], 0);
      return;
    }
    const last = state.history[state.history.length - 1] || "";
    if (state.bot_last) {
      if (last.includes("#") || state.bot_last.captured) setBotExpr("happy");
      else if (last.includes("+")) setBotExpr("smug");
      else setBotExpr("neutral", 0);
    } else {
      if (last.includes("x")) setBotExpr("sad");
      else if (last.includes("+")) setBotExpr("surprised");
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ---------------- TREINADOR ---------------- */
  let hintLevel = 1;
  function renderCoachPanel(state) {
    const show = !!state.coach_on && !state.tournament;
    $("coachCard").classList.toggle("hidden", !show);
    $("trainActions").classList.toggle("hidden", !(state.mode === "training" && !state.over));
    $("coachSub").textContent = state.mode === "training" ? "Modo treino: dicas e voltar lance liberados" : "Comenta cada lance seu";
    if (!show) return;
    if (!state.history.length) {
      $("coachMsg").innerHTML = state.mode === "training"
        ? "Vamos treinar! Jogue com calma — se travar, peça uma <b>💡 Dica</b>." : "Faça seu lance que eu comento. 😉";
      $("coachTip").classList.add("hidden");
      $("coachWarn").classList.add("hidden");
    }
  }

  function showCoach(c) {
    if (!c) return;
    hintLevel = 1;
    $("coachMsg").innerHTML = `<div class="c-head"><i class="cls" style="background:${c.hex}">${c.symbol}</i>` +
      `<b style="color:${c.hex}">${c.label}</b></div><div>${c.text || ""}</div>`;
    $("coachMsg").style.borderColor = c.hex;
    $("coachTip").classList.toggle("hidden", !c.tip);
    $("coachTip").innerHTML = c.tip ? `📘 ${c.tip}` : "";
    $("coachWarn").classList.add("hidden");
    const arrows = [];
    if (c.arrow) arrows.push({ from: c.arrow[0], to: c.arrow[1], color: "good" });
    if (c.danger) arrows.push({ from: c.danger[0], to: c.danger[1], color: "bad" });
    board.setArrows(arrows, null);
  }

  function showWarning(w) {
    if (!w) { $("coachWarn").classList.add("hidden"); return; }
    $("coachWarn").innerHTML = `⚠️ ${w.text}`;
    $("coachWarn").classList.remove("hidden");
    if (w.danger) board.setArrows([{ from: w.danger[0], to: w.danger[1], color: "bad" }], null);
  }

  async function askHint() {
    if (!game || busy || !game.player_turn) return;
    try {
      const h = await api(`/api/game/${game.id}/hint`, { level: hintLevel });
      $("coachMsg").innerHTML = h.text;
      $("coachMsg").style.borderColor = "#5c8bb0";
      if (h.level === 1) board.setArrows([], h.square);
      else board.setArrows([{ from: h.arrow[0], to: h.arrow[1], color: "hint" }], null);
      hintLevel = Math.min(2, hintLevel + 1);
    } catch (e) { toast(e.message); }
  }

  async function takeback() {
    if (!game || busy) return;
    try {
      const state = await api(`/api/game/${game.id}/takeback`, {});
      render(state, { silent: true });
      hintLevel = 1;
      $("coachMsg").innerHTML = "↶ Lance desfeito. Pense de novo com calma!";
      $("coachMsg").style.borderColor = "";
      $("coachTip").classList.add("hidden");
      $("coachWarn").classList.add("hidden");
    } catch (e) { toast(e.message); }
  }

  /* ---------------- fluxo da partida ---------------- */
  const lastCoachOpts = { level: "coach", color: "random", training: true, rated: false, time_control: "none", coach: true };
  async function newGame(opts) {
    closeModals();
    closeAnalysis(false);
    try {
      busy = false;
      game = null;
      const state = await api("/api/game/new", opts || {
        level: pick.level, color: pick.color, rated: pick.mode === "rated", training: pick.mode === "training",
        time_control: pick.tc, coach: NexPrefs.get("coach"),
      });
      showBot(state.bot);
      render(state);
      beep("start");
      if (!state.player_turn && !state.over) botTurn();
    } catch (e) { toast(e.message); }
  }

  // Pré-movimentos em fila: joga o primeiro da fila quando chega a sua vez; os outros esperam as próximas vezes.
  // Se o lance não for mais possível, a fila inteira é cancelada (os seguintes dependiam dele).
  function runPremove(state) {
    const pm = board.takePremove();
    if (!pm) return;
    const base = pm.from + pm.to;
    const opts = state.legal_moves.filter(m => m.startsWith(base));
    const wanted = pm.promo ? opts.find(m => m === base + pm.promo) : null;
    if (!opts.length) {
      const rest = board.premoves.length;
      board.premoves = [];
      board.render();
      toast(rest ? "Pré-movimentos cancelados: o lance não era mais possível." : "Pré-movimento cancelado: o lance não era mais possível.");
      return;
    }
    const uci = wanted || (opts.includes(base) ? base : (opts.find(m => m.endsWith("q")) || opts[0]));
    board.render();
    setTimeout(() => {
      if (game && game.id === state.id && game.player_turn && !busy && !game.over && view === null) board.playMove(uci);
      else board.premoves = [];
    }, 160);
  }

  async function sendMove(uci) {
    if (!game || busy) return;
    busy = true;
    try {
      const state = await api(`/api/game/${game.id}/move`, { uci });
      busy = false;
      render(state);
      showCoach(state.coach);
      if (!state.over) botTurn();
    } catch (e) {
      busy = false;
      toast(e.message);
      render(await api(`/api/game/${game.id}`));
    }
  }

  async function botTurn() {
    busy = true;
    setThinking(true);
    const gid = game.id;
    const minDelay = new Promise(r => setTimeout(r, game.clock ? 0 : 350 + Math.random() * 650)); // "tempo humano"
    try {
      const [state] = await Promise.all([api(`/api/game/${gid}/bot-move`, {}), minDelay]);
      if (!game || game.id !== gid) return; // começou outra partida no meio
      busy = false;
      setThinking(false);
      const keepArrows = board.arrows ? [...board.arrows] : [];
      render(state, { animate: true });
      if (state.warning) showWarning(state.warning);
      else if (keepArrows.length && game.coach_on) board.setArrows(keepArrows, null);
    } catch (e) {
      busy = false;
      setThinking(false);
      toast(e.message);
    }
  }

  async function resign() {
    if (!game || game.over || !confirmInline($("btnResign"))) return;
    try { render(await api(`/api/game/${game.id}/resign`, {})); } catch (e) { toast(e.message); }
  }

  async function offerDraw() {
    if (!game || game.over || busy) return;
    try {
      const state = await api(`/api/game/${game.id}/draw`, {});
      if (!state.draw_accepted) toast("Empate recusado");
      render(state);
    } catch (e) { toast(e.message); }
  }

  // confirmação sem alert(): primeiro clique arma, segundo confirma
  function confirmInline(btn) {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = "⚑ Desistir"; return true; }
    btn.dataset.armed = "1";
    btn.textContent = "Confirmar?";
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = "⚑ Desistir"; }, 2500);
    return false;
  }

  async function finish(state) {
    const r = state.result;
    const titles = { win: ["🏆", "Vitória!"], loss: ["💀", "Derrota"], draw: ["🤝", "Empate"] };
    const [icon, title] = titles[r.outcome];
    $("resIcon").textContent = icon;
    $("resTitle").textContent = title;
    $("resTitle").className = r.outcome;
    $("resTerm").textContent = `${r.termination} · ${r.result}`;
    const pl = r.placement;
    if (state.mode === "placement" && pl) {
      $("resElo").innerHTML = `<div class="pb-dots big">${dotsHtml(pl.played, pl.total)}</div>` +
        `<div class="muted">Classificação: <b>${pl.played} de ${pl.total}</b></div>`;
    } else if (state.rated) {
      $("resElo").innerHTML = `<span class="mono big">${r.rating_after}</span> <span class="mono ${r.rating_change >= 0 ? "up" : "down"}">${r.rating_change >= 0 ? "+" : ""}${r.rating_change}</span>`;
    } else {
      $("resElo").innerHTML = `<span class="muted">Partida casual — rating não muda</span>`;
    }
    let extra = "";
    if (pl && !pl.done) extra += `<div class="res-next">Próximo adversário: bot de <b class="mono">${pl.next_rating}</b> ${r.outcome === "win" ? "(mais forte 💪)" : r.outcome === "loss" ? "(mais tranquilo)" : "(mesmo nível)"}</div>`;
    (r.new_titles || []).forEach(t => { extra += `<div class="res-title">🏅 Novo título conquistado: <b>${t.icon} ${t.name}</b></div>`; });
    const T = r.tournament;
    if (T) {
      const txt = T.player_status === "champion" ? `🏆 <b>CAMPEÃO</b> do ${T.tournament_name}!`
        : T.player_status === "done" ? `Fim do <b>${T.tournament_name}</b>: ${T.place_label}.`
        : T.player_status === "eliminated" ? `Fim da linha no <b>${T.tournament_name}</b>: ${T.place_label}.`
        : T.next ? `Próxima: <b>${T.next.label}</b> contra ${T.next.opponent.flag || ""} ${T.next.opponent.name} (${T.next.opponent.rating})`
        : `${T.stage_label}`;
      extra += `<div class="res-tour ${T.player_status}">${txt}` +
        (T.prize != null && T.player_status !== "playing" ? `<div class="res-prize">🪙 +${T.prize} moedas</div>` : "") +
        (T.champion && T.player_status !== "champion" ? `<div class="muted">Campeão: ${T.champion.flag} ${T.champion.name}</div>` : "") + `</div>`;
      if (T.tiebreak) extra += `<div class="res-next">⚖️ <b>Empate!</b> No mata-mata tem <b>jogo de desempate</b>, com as cores trocadas${T.next ? ` — você joga de <b>${T.next.color === "white" ? "brancas ♔" : "pretas ♚"}</b>` : ""}.</div>`;
    }
    if (r.coins_earned) extra += `<div class="res-coins">🪙 <b>+${r.coins_earned}</b> moedas pela partida</div>`;
    (r.new_titles || []).forEach(t => { if (t.coins) extra += `<div class="res-coins">🏅 Título novo: <b>+${t.coins} 🪙</b></div>`; });
    (r.daily_events || []).forEach(ev => {
      if (ev.type === "mission") extra += `<div class="res-title">${ev.icon} Missão completa: ${ev.text} <b>+${ev.reward} 🪙</b></div>`;
      if (ev.type === "streak") extra += streakEventHtml(ev);
    });
    $("resExtra").innerHTML = extra;
    const finishedPlacement = pl && pl.done;
    $("btnTour").classList.toggle("hidden", !T);
    $("btnTour").dataset.id = T ? T.tournament_id : "";
    $("btnTour").dataset.champ = T && T.champ ? "1" : "";
    $("btnTour").textContent = T && T.champ ? "🏟️ Voltar ao campeonato" : "🏆 Voltar ao torneio";
    $("btnAgain").classList.toggle("hidden", !!finishedPlacement || !!T);
    $("btnReveal").classList.toggle("hidden", !finishedPlacement);
    $("btnAgain").textContent = pl && !pl.done ? "Próxima partida ▶" : "Jogar de novo";
    $("resQuote").innerHTML = r.bot_message ? `<b>${state.bot.name}:</b> “${r.bot_message}”` : "";
    setTimeout(() => {
      $("resultModal").classList.add("open");
      if (r.outcome === "win") NexFx.victory(T && T.player_status === "champion" ? 260 : 140);
    }, 700);
    await loadPlayer();
    loadRecent();
  }

  function streakEventHtml(ev) {
    let h = "";
    if (ev.freezes_used) h += `<div class="res-title">🧊 Protetor de sequência usado: sua sequência continua (${ev.days} dias)!</div>`;
    if (ev.coins) h += `<div class="res-title">🔥 ${ev.days} dias seguidos! Bônus <b>+${ev.coins} 🪙</b></div>`;
    return h;
  }

  function dotsHtml(played, total) {
    let h = "";
    for (let i = 0; i < total; i++) h += `<i class="${i < played ? "done" : i === played ? "now" : ""}"></i>`;
    return h;
  }

  /* ---------------- revelação do rating (fim da classificação) ---------------- */
  function showReveal(p, fromBeginner = false) {
    closeModals();
    $("revIcon").textContent = p.title_icon;
    $("revTitle").textContent = `${p.title_icon} ${p.title}`;
    $("revText").textContent = fromBeginner
      ? "Você começa pelos bots mais tranquilos. Cada vitória ranqueada faz seu rating subir!"
      : `Nas suas próximas ${p.provisional_left} partidas ranqueadas o rating é provisório (aparece com "?") e se ajusta rápido ao seu nível real.`;
    $("revealModal").querySelector(".up-label").textContent = fromBeginner ? "Tudo pronto!" : "Classificação concluída!";
    $("revealModal").classList.add("open");
    const target = p.rating, t0 = performance.now(), dur = 1600;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - k, 3);
      $("revNum").textContent = Math.round(target * eased);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- ANÁLISE DA PARTIDA ---------------- */
  let pollTimer = null;

  async function openAnalysis(gameId) {
    if (!gameId) return;
    if (game && !game.over) { toast("Termine a partida atual antes de abrir uma análise."); return; }
    closeModals();
    clearTimeout(pollTimer);
    analysis = { gameId, data: null, meta: null };
    view = 0;
    $("anaCard").classList.remove("hidden");
    $("anaBody").classList.add("hidden");
    $("anaLoading").classList.remove("hidden");
    $("anaBar").style.width = "0%";
    $("anaLoadingText").textContent = "Preparando a análise…";
    $("btnAnalyze").classList.add("hidden");
    $("reviewBanner").classList.remove("show");
    document.body.classList.add("analysing");
    if (window.innerWidth < 960) document.querySelector(".board-col").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      handleAnalysis(await api(`/api/games/${gameId}/analysis`, {}));
    } catch (e) { toast(e.message); closeAnalysis(); }
  }

  function handleAnalysis(res) {
    if (!analysis || analysis.gameId !== res.meta.id) return;
    analysis.meta = res.meta;
    if (res.status === "running" || res.status === "none") {
      const pct = res.total ? Math.round(100 * res.progress / res.total) : 0;
      $("anaBar").style.width = pct + "%";
      $("anaLoadingText").textContent = `Analisando lance ${res.progress || 0} de ${res.total || "…"} com o Stockfish…`;
      pollTimer = setTimeout(async () => {
        try { handleAnalysis(await api(`/api/games/${analysis.gameId}/analysis`)); }
        catch (e) { toast(e.message); }
      }, 600);
      return;
    }
    if (res.status === "error") { toast(res.error || "Falha na análise"); closeAnalysis(); return; }
    analysis.data = res.result;
    showAnalysis();
  }

  function showAnalysis() {
    const { data, meta } = analysis;
    const me = meta.player_color, bot = me === "white" ? "black" : "white";
    $("anaLoading").classList.add("hidden");
    $("anaBody").classList.remove("hidden");
    const outcome = { win: "Vitória", loss: "Derrota", draw: "Empate" }[meta.outcome];
    $("anaSub").textContent = `${outcome} · ${meta.termination} · ${meta.date}`;

    // barra do bot (em cima) mostra o adversário daquela partida
    const initials = meta.bot_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    $("botAvatar").textContent = initials;
    $("botAvatar").style.background = "#5c6f95";
    $("botName").textContent = meta.bot_name;
    $("botFlag").textContent = "";
    $("botRating").textContent = meta.bot_rating;
    $("botPers").textContent = "";
    $("capTop").innerHTML = $("capBottom").innerHTML = "";

    fillSide("anaMe", meta.player_name, data.summary[me], true);
    fillSide("anaBot", meta.bot_name, data.summary[bot], false);

    // contagem por tipo de lance
    $("anaCounts").innerHTML = `<tr><th>Você</th><th></th><th>Bot</th></tr>` + data.order.map(k => {
      const c = data.classes[k], a = data.summary[me].counts[k], b = data.summary[bot].counts[k];
      return `<tr class="${a || b ? "" : "zero"}"><td class="mono" style="color:${c.hex}">${a}</td>` +
        `<td><i class="cls" style="background:${c.hex}">${c.symbol}</i>${c.label}</td>` +
        `<td class="mono" style="color:${c.hex}">${b}</td></tr>`;
    }).join("");

    board.setOrientation(me);
    drawGraph();
    renderMoveList();
    showPly(0);
  }

  function fillSide(id, name, s, isMe) {
    const el = $(id);
    el.querySelector(".ana-name").textContent = isMe ? `${name} (você)` : name;
    el.querySelector(".ana-acc").textContent = s.accuracy == null ? "—" : `${s.accuracy.toFixed(1)}%`;
    el.querySelector(".ana-label").textContent = s.accuracy == null ? "poucos lances" : "precisão";
    el.querySelector(".ana-rating").innerHTML = s.rating ? `Jogou como <b>~${s.rating}</b>` : "";
    el.classList.toggle("me", isMe);
  }

  function drawGraph() {
    const g = analysis.data.graph, n = g.length - 1 || 1, W = 300, H = 70;
    const x = i => (i / n) * W, y = v => H - (v / 100) * H;
    const pts = g.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
    let marks = "";
    analysis.data.plies.forEach(p => {
      if (["blunder", "mistake", "brilliant", "great"].includes(p.cls)) {
        marks += `<circle cx="${x(p.ply).toFixed(1)}" cy="${y(g[p.ply]).toFixed(1)}" r="3" fill="${p.hex}" stroke="#0b1220" stroke-width="1"/>`;
      }
    });
    $("anaGraph").innerHTML =
      `<rect width="${W}" height="${H}" fill="#2b3448"/>` +
      `<path d="M0,${H} L${pts} L${W},${H} Z" fill="#e9edf5"/>` +
      `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#8d9bb8" stroke-width=".6" stroke-dasharray="3 3"/>` +
      `<line id="anaCursor" x1="0" x2="0" y1="0" y2="${H}" stroke="#f0c96a" stroke-width="1.5"/>` + marks;
  }

  function updateAnalysisComment(ply) {
    const cursor = $("anaCursor");
    const n = analysis.data.graph.length - 1 || 1;
    if (cursor) { const cx = (ply / n) * 300; cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx); }
    const box = $("anaComment"), strip = $("anaStripBody");
    $("anaStrip").classList.remove("hidden");
    $("anaStripPrev").disabled = ply === 0;
    $("anaStripNext").disabled = ply >= analysis.data.plies.length;
    if (ply === 0) {
      box.innerHTML = `Posição inicial. Use <b>▶</b>, as setas do teclado ou clique nos lances.`;
      box.style.borderColor = "";
      strip.innerHTML = `<div class="as-top"><b>Posição inicial</b></div><div class="as-txt">Use ▶ ou as setas → ← do teclado para ver cada lance.</div>`;
      $("anaStrip").style.borderColor = "";
      return;
    }
    const p = analysis.data.plies[ply - 1];
    const who = p.color === analysis.meta.player_color ? "Você" : analysis.meta.bot_name;
    const evalTxt = p.mate != null && p.mate !== 0
      ? `Mate em ${Math.abs(p.mate)}`
      : `${p.eval >= 0 ? "+" : ""}${(p.eval / 100).toFixed(1)}`;
    box.innerHTML = `<div class="c-head"><i class="cls" style="background:${p.hex}">${p.symbol}</i>` +
      `<b style="color:${p.hex}">${p.label}</b><span class="c-who">${who}</span>` +
      `<span class="c-eval mono" title="Avaliação (positivo = vantagem das brancas)">${evalTxt}</span></div>` +
      `<div>${p.comment}</div>`;
    box.style.borderColor = p.hex;
    const num = `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."}`;
    strip.innerHTML = `<div class="as-top"><span class="as-san mono">${num} ${p.san}</span>` +
      `<i class="cls" style="background:${p.hex}">${p.symbol}</i><b style="color:${p.hex}">${p.label}</b>` +
      `<span class="c-who">${who}</span><span class="c-eval mono">${evalTxt}</span></div>` +
      `<div class="as-txt">${p.comment}</div>`;
    $("anaStrip").style.borderColor = p.hex;
  }

  function closeAnalysis(restore = true) {
    clearTimeout(pollTimer);
    if (!analysis) return;
    analysis = null;
    view = null;
    document.body.classList.remove("analysing");
    $("anaCard").classList.add("hidden");
    $("anaStrip").classList.add("hidden");
    if (restore && game) {
      showBot(game.bot);
      render(game, { silent: true });
    } else if (restore) {
      board.setState({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" });
      $("moves").innerHTML = `<li class="empty">Nenhum lance ainda.</li>`;
      markMoveList();
    }
  }

  /* ---------------- modal de nova partida ---------------- */
  function buildTimeControls() {
    $("tcSeg").innerHTML = timeControls.map(t =>
      `<button data-v="${t.key}" class="${t.key === pick.tc ? "on" : ""}"><span class="tc-ic">${t.icon}</span>` +
      `${t.label.replace(/ (\d.*)/, "<small>$1</small>")}</button>`).join("");
    $("tcSeg").querySelectorAll("button").forEach(b => b.onclick = () => {
      pick.tc = b.dataset.v;
      store.set("tc", pick.tc);
      $("tcSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    });
  }

  function buildLevels(p) {
    const cards = [{ key: "auto", name: "Ajustado a mim", range: `≈ ${p.rating}`, icon: "🎯" }]
      .concat(levels.map(l => ({ key: l.key, name: l.name, range: `${l.min}–${l.max}`, icon: "" })));
    $("levels").innerHTML = cards.map(c =>
      `<button class="level ${c.key === pick.level ? "on" : ""}" data-v="${c.key}" data-tier="${c.key}">
         <span class="lv-name">${c.icon} ${c.name}</span><span class="lv-range mono">${c.range}</span></button>`).join("");
    $("levels").querySelectorAll(".level").forEach(b => b.onclick = () => {
      pick.level = b.dataset.v;
      $("levels").querySelectorAll(".level").forEach(x => x.classList.toggle("on", x === b));
    });
  }

  function syncModeSeg() {
    $("modeSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.v === pick.mode));
    const noClock = pick.mode === "training";
    $("tcSeg").classList.toggle("hidden", noClock);
    $("tcSeg").previousElementSibling.classList.toggle("hidden", noClock);
  }

  function bindSeg(id, key) {
    $(id).querySelectorAll("button").forEach(b => b.onclick = () => {
      pick[key] = b.dataset.v;
      $(id).querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      if (key === "mode") syncModeSeg();
      if (key === "mode" && player && !player.placement.done) {
        const hide = pick.mode === "rated";
        $("levelsWrap").classList.toggle("hidden", hide);
        $("colorWrap").classList.toggle("hidden", hide);
      }
    });
  }

  async function openNew() {
    const p = await loadPlayer();
    const pending = !p.placement.done;
    $("placementBox").classList.toggle("hidden", !pending);
    $("levelsWrap").classList.toggle("hidden", pending && pick.mode === "rated");
    $("colorWrap").classList.toggle("hidden", pending && pick.mode === "rated");
    $("modeRatedBtn").innerHTML = pending ? "🎯 Classificação <small>define seu rating</small>" : "🏆 Ranqueada <small>vale Elo</small>";
    syncModeSeg();
    if (pending) {
      const pl = p.placement;
      $("pbStep").textContent = `${pl.played + 1} de ${pl.total}`;
      $("pbDots").innerHTML = dotsHtml(pl.played, pl.total);
      $("pbText").innerHTML = `Adversário: bot de <b class="mono">${pl.next_rating}</b> · você joga de <b>${pl.next_color === "white" ? "brancas ♔" : "pretas ♚"}</b>.<br>` +
        `<small class="muted">Quer só treinar antes? Escolha <b>Casual</b> abaixo — não conta para a classificação.</small>`;
      $("pbBeginner").classList.toggle("hidden", pl.played > 0);
    }
    buildLevels(p);
    buildTimeControls();
    $("newModal").classList.add("open");
  }

  function closeModals() { document.querySelectorAll(".modal:not(#recoveryModal)").forEach(m => m.classList.remove("open")); }  // o código de recuperação só fecha ao confirmar

  /* ---------------- TREINO: sequência, puzzles do dia, missões ---------------- */
  let trainData = null;
  let pz = null;           // estado do puzzle atual
  let pzBoard = null;      // tabuleiro próprio dos puzzles
  let pzFrom = null;       // de onde veio o puzzle: {daily_index} ou {free:true}

  function showTrainHome() {
    $("trainHome").classList.remove("hidden");
    $("puzzleView").classList.add("hidden");
    loadTraining();
  }

  async function loadTraining() {
    try {
      trainData = await api("/api/training");
      renderTraining(trainData);
    } catch (e) { toast(e.message); }
  }

  function renderTraining(d) {
    applyPlayer(d.user);
    $("streakNum").textContent = d.streak;
    $("streakFlame").classList.toggle("off", d.streak === 0);
    $("streakBox").classList.toggle("done", d.active_today);
    $("streakBest").textContent = d.streak_best;
    $("pzRating").textContent = d.puzzle_rating;
    $("pzSolved").textContent = d.puzzles_solved;
    $("trainCoins").textContent = d.coins.toLocaleString("pt-BR");
    $("streakHint").innerHTML = d.active_today
      ? `✅ Você já treinou hoje. Volte amanhã para manter a sequência!`
      : d.streak ? `⚠️ Resolva um puzzle ou termine uma partida hoje para não perder sua sequência de <b>${d.streak}</b> dias.`
      : `Resolva um puzzle ou termine uma partida para começar sua sequência 🔥`;
    if (d.streak_freezes) $("streakHint").innerHTML += ` <span class="freeze-tag">🧊 ${d.streak_freezes} protetor${d.streak_freezes > 1 ? "es" : ""} guardado${d.streak_freezes > 1 ? "s" : ""}</span>`;

    const lvlIcon = { easy: "🟢", medium: "🟡", hard: "🔴" };
    $("dailyPuzzles").innerHTML = d.puzzles.map((p, i) => {
      const st = p.status === "solved" ? `<span class="pill ok">✓ Resolvido</span>`
        : p.status === "failed" ? `<span class="pill bad">✗ Não foi dessa vez</span>` : `<span class="pill live">● Disponível</span>`;
      return `<button class="daily-card ${p.status}" data-di="${i}">
        <div class="dc-top"><span class="dc-level">${lvlIcon[p.level]} ${p.label}</span><span class="mono dc-rating">~${p.rating}</span></div>
        <div class="dc-side">${p.side === "white" ? "♔ Brancas jogam" : "♚ Pretas jogam"}</div>
        ${st}</button>`;
    }).join("") || `<div class="empty-card">Banco de puzzles não encontrado.</div>`;

    $("missions").innerHTML = d.missions.map(m => `
      <div class="mission ${m.done ? "done" : ""}">
        <div class="m-icon">${m.done ? "✅" : m.icon}</div>
        <div class="m-body"><div class="m-text">${m.text}</div>
          <div class="m-bar"><span style="width:${Math.round(100 * m.progress / m.target)}%"></span></div></div>
        <div class="m-side"><div class="mono">${m.progress}/${m.target}</div><div class="m-reward">+${m.reward} 🪙</div>
          ${!m.done && d.rerolls_left ? `<button class="m-reroll" data-reroll="${m.key}" title="Trocar esta missão por outra">🔄 Trocar · ${d.reroll_price} 🪙</button>` : ""}</div>
      </div>`).join("");

    $("milestones").innerHTML = Object.entries(d.streak_bonus).map(([days, coins]) =>
      `<div class="ms ${d.streak >= +days ? "on" : ""}"><div class="ms-days">${days} dias</div><div class="ms-coins">+${coins} 🪙</div></div>`).join("");
  }

  function ensurePzBoard() {
    if (!pzBoard) pzBoard = new NexusBoard($("pzBoard"), { onMove: pzMove });
    return pzBoard;
  }

  async function startPuzzle(body) {
    try {
      const st = await api("/api/puzzles/start", body);
      pzFrom = body;
      $("trainHome").classList.add("hidden");
      $("puzzleView").classList.remove("hidden");
      ensurePzBoard().setOrientation(st.side);
      pz = st;
      $("pzTitle").textContent = st.side === "white" ? "♔ Brancas jogam e ganham" : "♚ Pretas jogam e ganham";
      $("pzMeta").textContent = st.daily ? `Puzzle do dia · ~${st.rating}` : `Puzzle livre · ~${st.rating} · seu rating de puzzle: ${st.puzzle_rating}`;
      $("pzFeedback").className = "pz-feedback";
      $("pzFeedback").innerHTML = st.moves_total > 1
        ? `Encontre a sequência vencedora (${st.moves_total} lances seus).` : "Encontre o melhor lance!";
      $("pzResult").classList.add("hidden");
      $("pzNext").classList.add("hidden");
      $("pzActions").classList.remove("hidden");
      drawPzProgress();
      pzBoard.setState({ fen: st.fen, legal: st.legal, lastMove: st.last_move, check: st.check, interactive: true });
      window.scrollTo({ top: 0 });
    } catch (e) { toast(e.message); }
  }

  function drawPzProgress() {
    if (!pz) return;
    let h = "";
    for (let i = 0; i < pz.moves_total; i++) h += `<i class="${i < pz.moves_done ? "done" : i === pz.moves_done ? "now" : ""}"></i>`;
    $("pzProgress").innerHTML = pz.moves_total > 1 ? h : "";
  }

  async function pzMove(uci) {
    if (!pz || pz.done) return;
    const before = pz;
    try {
      const st = await api(`/api/puzzles/${pz.token}/move`, { uci });
      if (st.status === "wrong") {
        beep("wrong");
        $("pzFeedback").className = "pz-feedback bad";
        $("pzFeedback").innerHTML = "✗ Não é esse. Tente de novo! <small>(o puzzle já conta como erro)</small>";
        setTimeout(() => pzBoard.setState({ fen: before.fen, legal: before.legal, lastMove: before.last_move, check: before.check, interactive: true }), 450);
        pz = { ...before, failed: true };
        return;
      }
      pz = st;
      beep(st.status === "solved" ? "move" : "correct");
      if (st.reply) {
        // mostra o lance certo e depois a resposta do adversário
        pzBoard.setState({ fen: st.fen, legal: [], lastMove: st.last_move, check: st.check, interactive: false });
        setTimeout(() => {
          pzBoard.setState({ fen: st.fen, legal: st.legal, lastMove: st.last_move, check: st.check, interactive: !st.done, animate: true });
        }, 50);
      } else {
        pzBoard.setState({ fen: st.fen, legal: st.legal, lastMove: st.last_move, check: st.check, interactive: !st.done });
      }
      drawPzProgress();
      if (st.status === "correct") {
        $("pzFeedback").className = "pz-feedback good";
        $("pzFeedback").innerHTML = "✓ Isso! Continue...";
      } else if (st.status === "solved") {
        puzzleDone(st, false);
      }
    } catch (e) { toast(e.message); }
  }

  function puzzleDone(st, shown) {
    const r = st.result || {};
    const solved = !st.failed;
    $("pzActions").classList.add("hidden");
    $("pzFeedback").className = "pz-feedback " + (solved ? "good" : "bad");
    $("pzFeedback").innerHTML = shown ? "👁 Esta era a solução." : solved ? "🎉 Resolvido!" : "✓ Resolvido — mas com erro no caminho.";
    if (solved && !shown) { beep("solved"); if (!st.failed && !st.hinted) NexFx.confetti(70); }
    let html = `<div class="pr-theme">Tema: <b>${st.theme_label || "—"}</b></div>`;
    if (r.delta) html += `<div>Rating de puzzle: <b class="mono">${r.rating_after}</b> <span class="mono ${r.delta >= 0 ? "up" : "down"}">${r.delta >= 0 ? "+" : ""}${r.delta}</span></div>`;
    else if (st.daily) html += `<div class="muted">Puzzles do dia não mexem no rating de puzzle.</div>`;
    else if (st.hinted && solved) html += `<div class="muted">Com dica, o rating não muda.</div>`;
    (r.events || []).forEach(ev => {
      if (ev.type === "mission") html += `<div class="res-title">${ev.icon} ${ev.text} <b>+${ev.reward} 🪙</b></div>`;
      if (ev.type === "streak") html += streakEventHtml(ev);
    });
    $("pzResult").innerHTML = html;
    $("pzResult").classList.remove("hidden");
    $("pzNext").classList.remove("hidden");
    $("pzNext").textContent = pzFrom && pzFrom.daily_index != null ? "← Voltar aos puzzles do dia" : "Próximo puzzle ▶";
    pzBoard.setArrows([], null);
  }

  async function pzHint() {
    if (!pz || pz.done) return;
    try {
      const h = await api(`/api/puzzles/${pz.token}/hint`, {});
      pz.hinted = true;
      pzBoard.setArrows([], h.square);
      $("pzFeedback").className = "pz-feedback";
      $("pzFeedback").innerHTML = h.text;
    } catch (e) { toast(e.message); }
  }

  async function pzSolution() {
    if (!pz || pz.done) return;
    const startFen = pz.fen, startLast = pz.last_move;
    try {
      const st = await api(`/api/puzzles/${pz.token}/solution`, {});
      pz = st;
      pzBoard.setState({ fen: startFen, legal: [], lastMove: startLast, interactive: false });
      // anima os lances da solução, um a um
      let i = 0;
      const play = () => {
        if (i >= st.steps.length) { puzzleDone(st, true); return; }
        const step = st.steps[i++];
        pzBoard.setState({ fen: step.fen, legal: [], lastMove: step.uci, interactive: false, animate: true });
        $("pzFeedback").className = "pz-feedback";
        $("pzFeedback").innerHTML = `👁 ${step.san}`;
        setTimeout(play, 850);
      };
      setTimeout(play, 300);
    } catch (e) { toast(e.message); }
  }

  /* ---------------- CONTAS: entrar / criar conta ---------------- */
  function showAuth(legacy) {
    document.body.classList.add("logged-out");
    closeModals();
    $("authView").classList.add("open");
    if (legacy) {
      $("legacyNote").innerHTML = `♞ Encontramos o progresso de <b>${legacy.name}</b> (rating <b class="mono">${legacy.rating}</b>, ${legacy.games} partidas). ` +
        `Ele será ligado à <b>primeira conta criada</b>.`;
      $("legacyNote").classList.remove("hidden");
      setAuthTab("register");
    } else {
      $("legacyNote").classList.add("hidden");
    }
  }

  function setAuthTab(tab) {
    $("authTabs").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === tab));
    $("loginForm").classList.toggle("hidden", tab !== "login");
    $("registerForm").classList.toggle("hidden", tab !== "register");
    $("recoverForm").classList.toggle("hidden", tab !== "recover");
    $("authTabs").classList.toggle("hidden", tab === "recover");
    $("authError").textContent = "";
    const form = tab === "login" ? $("loginForm") : tab === "register" ? $("registerForm") : $("recoverForm");
    setTimeout(() => form.querySelector("input").focus(), 50);
  }

  async function submitAuth(e, kind) {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    const needsPass = kind === "recover" || (kind === "register" && !body.no_password);
    if (needsPass && body.password !== body.password2) {
      $("authError").textContent = "As senhas não são iguais.";
      return;
    }
    try {
      const res = await api(`/api/auth/${kind}`, body);
      e.target.reset();
      syncRegPass();
      if (res.inherited) toast("Seu progresso foi ligado à sua conta ✓");
      if (kind === "recover") toast("Senha trocada ✓");
      enterApp(res.user);
    } catch (err) { $("authError").textContent = err.message; }
  }

  // "Não quero senha": esconde os campos de senha no cadastro
  function syncRegPass() {
    const off = $("regNoPass").checked;
    $("regPassBox").classList.toggle("hidden", off);
    $("regPassBox").querySelectorAll("input").forEach(i => { i.required = !off; });
  }

  // Código de recuperação: aparece uma vez; só some depois que a pessoa confirma que anotou
  async function ensureRecovery(user) {
    if (!user || user.has_recovery) return;
    try { const r = await api("/api/account/recovery", {}); applyPlayer(r.user); showRecoveryCode(r.code); } catch (_) {}
  }
  function showRecoveryCode(code) {
    $("recCode").textContent = code;
    $("recOk").checked = false;
    $("recGo").disabled = true;
    $("recoveryModal").classList.add("open");
  }

  function enterApp(user) {
    document.body.classList.remove("logged-out");
    $("authView").classList.remove("open");
    applyPlayer(user);
    game = null;
    closeAnalysis(false);
    resetBoard();
    switchView("play");
    loadRecent();
    loadStatus();
    setTimeout(backupReminder, 1500);
    if (!user.placement.done && user.placement.played === 0) {
      $("welName").textContent = user.name;
      $("welcomeModal").classList.add("open");
    } else {
      openNew();
    }
    ensureRecovery(user);
  }

  function resetBoard() {
    board.setOrientation("white");
    board.setState({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" });
    $("moves").innerHTML = `<li class="empty">Nenhum lance ainda.</li>`;
    $("botCard").classList.add("hidden");
    $("botName").textContent = "Escolha um adversário";
    ["botFlag", "botRating", "botPers", "capTop", "capBottom"].forEach(id => { $(id).textContent = ""; });
    $("botAvatar").textContent = "?";
    $("botAvatar").style.background = "";
    $("btnAnalyze").classList.add("hidden");
    $("btnResign").disabled = $("btnDraw").disabled = true;
    markMoveList();
  }

  async function logout() {
    if (game && !game.over && !confirm("Sair agora abandona a partida em andamento. Continuar?")) return;
    await api("/api/auth/logout", {});
    game = null;
    player = null;
    showAuth(null);
    setAuthTab("login");
  }

  async function skipAsBeginner() {
    try {
      const res = await api("/api/placement/skip", {});
      applyPlayer(res.user);
      showReveal(res.user, true);
    } catch (e) { toast(e.message); }
  }

  /* ---------------- navegação: Jogar / Perfil ---------------- */
  function switchView(view) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
    [["playView", "play"], ["profileView", "profile"], ["tournamentsView", "tournaments"], ["trainingView", "training"], ["shopView", "shop"], ["settingsView", "settings"], ["champView", "champ"]]
      .forEach(([id, v]) => $(id)?.classList.toggle("hidden", view !== v));
    document.body.dataset.view = view;
    if (view === "profile") loadProfile();
    if (view === "shop" && window.NexShop) NexShop.open();
    if (view === "settings" && window.NexSettings) NexSettings.open();
    if (view === "champ" && window.NexChamp) NexChamp.open();
    if (view === "training") showTrainHome();
    if (view === "tournaments") showTourList();
    window.scrollTo({ top: 0 });
  }

  function toggleMenu(force) {
    const m = $("userMenu");
    if (window.innerWidth <= 700) {
      const tb = document.querySelector(".topbar");
      m.style.top = (tb ? tb.getBoundingClientRect().bottom + 6 : 60) + "px";
    } else m.style.top = "";
    m.classList.toggle("open", force);
  }

  /* ---------------- LEMBRETE DE BACKUP ---------------- */
  function backupReminder() {
    try {
      const DAY = 864e5, now = Date.now();
      let first = +localStorage.getItem("nj_first_seen") || 0;
      if (!first) { first = now; localStorage.setItem("nj_first_seen", String(now)); }
      const last = +localStorage.getItem("nj_last_export") || 0;
      const snooze = +localStorage.getItem("nj_bk_snooze") || 0;
      const due = last ? now - last > 7 * DAY : now - first > 2 * DAY;
      if (!due || now < snooze || document.getElementById("bkBanner")) return;
      const b = document.createElement("div");
      b.id = "bkBanner";
      b.innerHTML = '<span>💾 ' + (last ? "Faz mais de 7 dias que você não salva uma cópia." : "Salve uma cópia da sua conta para não perder seu progresso.") +
        '</span><button data-a="go">Salvar agora</button><button data-a="later">Depois</button>';
      b.addEventListener("click", e => {
        const a = e.target.dataset.a; if (!a) return;
        if (a === "later") localStorage.setItem("nj_bk_snooze", String(Date.now() + 3 * DAY));
        b.remove();
        if (a === "go") { switchView("settings"); NexSettings.focusBackup(); }
      });
      document.body.appendChild(b);
    } catch (_) {}
  }

  /* ---------------- PERFIL ---------------- */
  let hist = { filter: "all", offset: 0 };

  async function loadProfile() {
    try {
      const data = await api("/api/profile");
      renderProfile(data);
      hist.offset = 0;
      loadHistory(false);
    } catch (e) { toast(e.message); }
  }

  let lastRatingHistory = [];
  function renderProfile({ user: u, stats, rating_history: rh, titles }) {
    lastRatingHistory = rh;
    applyPlayer(u);
    if (window.NexShop) NexShop.paintAvatar($("profAvatar"), u);
    $("profName").textContent = u.name;
    $("profUser").textContent = "@" + u.username;
    $("profTitle").textContent = u.placement.done ? `${u.title_icon} ${u.title}` : "🎯 Em classificação";
    $("profSince").textContent = u.member_since ? `Membro desde ${u.member_since}` : "";
    if (!u.placement.done) {
      $("profRating").textContent = "?";
      $("profRatingSub").textContent = `Classificação: ${u.placement.played} de ${u.placement.total} partidas`;
    } else {
      $("profRating").textContent = u.provisional ? `${u.rating}?` : u.rating;
      $("profRatingSub").innerHTML = `Pico: <b class="mono">${u.peak_rating}</b>` +
        (u.provisional ? ` · provisório (faltam ${u.provisional_left})` : "");
    }

    const g = u.games_played || 0;
    const pct = n => (g ? (100 * n / g) : 0).toFixed(1);
    $("statGrid").innerHTML = `
      <div class="stat"><div class="st-label">Partidas</div><div class="st-value mono">${g}</div>
        <div class="st-sub">${stats.by_mode.rated} ranqueadas · ${stats.by_mode.casual} casuais</div></div>
      <div class="stat wide"><div class="st-label">Resultados</div>
        <div class="st-value mono">${stats.win_rate}% <small>de vitórias</small></div>
        <div class="wld" title="${u.wins} vitórias, ${u.draws} empates, ${u.losses} derrotas">
          <span class="w" style="width:${pct(u.wins)}%"></span><span class="d" style="width:${pct(u.draws)}%"></span><span class="l" style="width:${pct(u.losses)}%"></span></div>
        <div class="st-sub"><b class="up">${u.wins}V</b> · <b>${u.draws}E</b> · <b class="down">${u.losses}D</b></div></div>
      <div class="stat"><div class="st-label">Precisão média</div><div class="st-value mono">${stats.avg_accuracy != null ? stats.avg_accuracy + "%" : "—"}</div>
        <div class="st-sub">das partidas analisadas</div></div>
      <div class="stat"><div class="st-label">Melhor vitória</div><div class="st-value mono">${stats.best_win || "—"}</div>
        <div class="st-sub">rating do bot vencido</div></div>
      <div class="stat"><div class="st-label">Sequência</div><div class="st-value mono">${stats.win_streak}${stats.win_streak >= 3 ? " 🔥" : ""}</div>
        <div class="st-sub">vitórias seguidas</div></div>`;

    drawRatingChart(rh);

    $("titlesGrid").innerHTML = titles.map(t => `
      <div class="title-card ${t.unlocked ? "on" : ""}" title="${t.desc}">
        <div class="tc-icon">${t.unlocked ? t.icon : "🔒"}</div>
        <div class="tc-name">${t.name}</div>
        <div class="tc-sub mono">${t.unlocked ? t.date : (t.min ? t.min + "+" : "")}</div>
      </div>`).join("");
  }

  function drawRatingChart(rh) {
    const box = $("ratingChart");
    if (!rh.length) {
      box.innerHTML = `<div class="chart-empty">O gráfico aparece depois da sua primeira partida ranqueada ${player && !player.placement.done ? "(termine a classificação!)" : ""}.</div>`;
      return;
    }
    const pts = rh.length === 1 ? [rh[0], rh[0]] : rh;
    const W = Math.max(280, box.clientWidth || 600), H = 220, P = { l: 44, r: 14, t: 14, b: 26 };
    const vals = pts.map(p => p.rating);
    let lo = Math.floor((Math.min(...vals) - 30) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 30) / 100) * 100;
    if (hi - lo < 200) { hi += 100; lo = Math.max(0, lo - 100); }
    const x = i => P.l + (i / (pts.length - 1)) * (W - P.l - P.r);
    const y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - P.b} L${P.l},${H - P.b} Z`;
    let grid = "";
    const stepV = (hi - lo) / 4;
    for (let k = 0; k <= 4; k++) {
      const v = lo + stepV * k, yy = y(v).toFixed(1);
      grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" class="grid"/>` +
        `<text x="${P.l - 8}" y="${+yy + 4}" class="axis" text-anchor="end">${Math.round(v)}</text>`;
    }
    const flat = Math.max(...vals) === Math.min(...vals);
    const peakI = flat ? pts.length - 1 : vals.indexOf(Math.max(...vals)), lastI = pts.length - 1;
    const label = (i, txt, anchor) => `<text x="${x(i)}" y="${y(pts[i].rating) - 12}" class="dlabel" text-anchor="${anchor}">${txt}</text>`;
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Evolução do rating">
        <defs><linearGradient id="rgFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#f0c96a" stop-opacity=".28"/><stop offset="1" stop-color="#f0c96a" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <text x="${P.l}" y="${H - 6}" class="axis">${pts[0].date}</text>
        <text x="${W - P.r}" y="${H - 6}" class="axis" text-anchor="end">${pts[lastI].date}</text>
        <path d="${area}" fill="url(#rgFill)"/>
        <path d="${line}" fill="none" stroke="#f0c96a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${peakI !== lastI ? `<circle cx="${x(peakI)}" cy="${y(vals[peakI])}" r="4" class="mk"/>${label(peakI, "pico " + vals[peakI], peakI < pts.length / 2 ? "start" : "middle")}` : ""}
        <circle cx="${x(lastI)}" cy="${y(vals[lastI])}" r="5" class="mk now"/>
        ${label(lastI, vals[lastI], "end")}
        <g class="hover" style="display:none"><line class="xh" y1="${P.t}" y2="${H - P.b}"/><circle r="5" class="mk now"/></g>
        <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent" class="hit"/>
      </svg>
      <div class="chart-tip"></div>`;
    const svg = box.querySelector("svg"), hov = svg.querySelector(".hover"), tip = box.querySelector(".chart-tip");
    const reasons = { start: "início", game: "partida ranqueada", placement: "fim da classificação" };
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(lastI, Math.round(((px - P.l) / (W - P.l - P.r)) * lastI)));
      hov.style.display = "";
      hov.querySelector("line").setAttribute("x1", x(i)); hov.querySelector("line").setAttribute("x2", x(i));
      hov.querySelector("circle").setAttribute("cx", x(i)); hov.querySelector("circle").setAttribute("cy", y(vals[i]));
      tip.innerHTML = `<b class="mono">${vals[i]}</b><span>${pts[i].date} · ${reasons[pts[i].reason] || ""}</span>`;
      tip.style.display = "block";
      const left = (x(i) / W) * r.width;
      tip.style.left = Math.min(r.width - 150, Math.max(0, left - 70)) + "px";
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", () => { hov.style.display = "none"; tip.style.display = "none"; });
  }

  async function loadHistory(append) {
    try {
      const data = await api(`/api/games?filter=${hist.filter}&offset=${hist.offset}&limit=15`);
      const modes = { rated: "🏆 Ranqueada", casual: "☕ Casual", placement: "🎯 Classificação", tournament: "🏆 Torneio" };
      const rows = data.items.map(g => {
        const label = { win: "V", loss: "D", draw: "E" }[g.outcome];
        const change = g.rated ? `<span class="mono ${g.rating_change >= 0 ? "up" : "down"}">${g.rating_change >= 0 ? "+" : ""}${g.rating_change}</span>` : `<span class="muted">—</span>`;
        return `<button class="hrow" data-id="${g.id}">
          <span class="res ${g.outcome}">${label}</span>
          <span class="h-main"><b>${g.bot_name}</b> <small class="mono">(${g.bot_rating})</small><br>
            <small class="muted">${modes[g.mode] || g.mode} · ${g.termination} · ${g.moves} lances · ${g.player_color === "white" ? "♔" : "♚"}</small></span>
          <span class="h-acc mono">${g.accuracy != null ? Math.round(g.accuracy) + "%" : ""}</span>
          <span class="h-chg">${change}</span>
          <span class="h-date muted">${g.date}</span>
          <span class="h-go">📊</span></button>`;
      }).join("");
      $("histList").innerHTML = (append ? $("histList").innerHTML : "") +
        (rows || (append ? "" : `<div class="chart-empty">Nenhuma partida aqui ainda.</div>`));
      hist.offset += data.items.length;
      $("histMore").classList.toggle("hidden", !data.has_more);
    } catch (e) { toast(e.message); }
  }

  /* ---------------- TORNEIOS ---------------- */
  let tourPick = { tc: "blitz", strength: "equal" };
  let currentTour = null;

  function showTourList() {
    $("tourListView").classList.remove("hidden");
    $("tourDetailView").classList.add("hidden");
    currentTour = null;
    loadTournaments();
  }

  async function loadTournaments() {
    try {
      const d = await api("/api/tournaments");
      $("tourCoins").textContent = d.coins.toLocaleString("pt-BR");
      $("tourTrophies").textContent = d.trophies;
      $("tourLock").classList.toggle("hidden", d.can_join);
      $("btnTourCreate").disabled = !d.can_join;
      $("tourName").dataset.suggest = d.random_name;
      const active = d.mine.filter(t => t.player_status === "playing");
      const done = d.mine.filter(t => t.player_status !== "playing");
      $("tourActive").innerHTML = active.length ? active.map(tourCard).join("") :
        `<div class="empty-card">Nenhum torneio em andamento. Entre em um abaixo! 👇</div>`;
      tourDoneList = done;
      $("tourDone").innerHTML = done.length ? done.map(t => `<div class="tour-wrap">${tourCard(t)}
        <button class="btn outline-gold wide" data-again="${t.id}" ${d.can_join ? "" : "disabled"}>🔁 Jogar de novo</button></div>`).join("") : `<div class="empty-card">Seus torneios encerrados aparecem aqui.</div>`;
      $("tourTemplates").innerHTML = d.templates.map(t => `
        <div class="tour-card tpl">
          <div class="tc-head"><span class="tc-big">${t.tc_icon}</span><div><b>${t.name}</b><div class="muted">${t.tc_label}</div></div></div>
          <p>${t.desc}</p>
          <button class="btn outline-gold wide" data-tpl="${t.key}" ${d.can_join ? "" : "disabled"}>Entrar ▶</button>
        </div>`).join("");
      $("tourTemplates").querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => {
        const t = d.templates.find(x => x.key === b.dataset.tpl);
        createTournament({ name: t.name, time_control: t.time_control, strength: t.strength });
      });
    } catch (e) { toast(e.message); }
  }

  let tourDoneList = [];
  function tourCard(t) {
    const status = t.player_status === "champion" ? `<span class="pill gold">🏆 Campeão</span>`
      : t.player_status === "eliminated" ? `<span class="pill">${t.place_label || "Eliminado"}</span>`
      : `<span class="pill live">● ${t.stage_label}</span>`;
    const next = t.next ? `<div class="tc-next">Próximo: ${t.next.opponent.flag || ""} <b>${t.next.opponent.name}</b> <span class="mono">(${t.next.opponent.rating})</span></div>` : "";
    const prize = t.player_status !== "playing" ? `<div class="tc-prize">🪙 ${t.prize} · ${t.wins} vitórias${t.champion ? ` · campeão: ${t.champion}` : ""}</div>` : "";
    return `<button class="tour-card" data-tid="${t.id}">
      <div class="tc-head"><span class="tc-big">${t.tc_icon}</span><div><b>${t.name}</b><div class="muted">${t.tc_label} · ${t.date}</div></div></div>
      ${status}${next}${prize}</button>`;
  }

  function openTourModal() {
    $("tourName").value = $("tourName").dataset.suggest || "Copa Nex-J";
    $("tourTcSeg").innerHTML = timeControls.map(t =>
      `<button data-v="${t.key}" class="${t.key === tourPick.tc ? "on" : ""}"><span class="tc-ic">${t.icon}</span>` +
      `${t.label.replace(/ (\d.*)/, "<small>$1</small>")}</button>`).join("");
    $("tourTcSeg").querySelectorAll("button").forEach(b => b.onclick = () => {
      tourPick.tc = b.dataset.v;
      $("tourTcSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    });
    $("tourModal").classList.add("open");
    setTimeout(() => $("tourName").select(), 50);
  }

  async function createTournament(body) {
    // regras escritas ANTES da inscrição: precisa ler e aceitar
    const ok = await NexRules.ask("tournament", { time_control: body.time_control, strength: body.strength }, "Aceitar e entrar ▶");
    if (!ok) return;
    try {
      const r = await api("/api/tournaments", body);
      closeModals();
      toast("Torneio criado! Boa sorte 🍀");
      openTournament(r.id);
    } catch (e) { toast(e.message); }
  }

  async function openTournament(id) {
    try {
      switchViewOnly("tournaments");
      const t = await api(`/api/tournaments/${id}`);
      currentTour = t;
      $("tourListView").classList.add("hidden");
      $("tourDetailView").classList.remove("hidden");
      renderTournament(t);
      window.scrollTo({ top: 0 });
    } catch (e) { toast(e.message); }
  }

  // troca de aba sem recarregar a lista de torneios
  function switchViewOnly(view) {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
    [["playView", "play"], ["profileView", "profile"], ["tournamentsView", "tournaments"], ["trainingView", "training"], ["shopView", "shop"], ["settingsView", "settings"], ["champView", "champ"]]
      .forEach(([id, v]) => $(id)?.classList.toggle("hidden", view !== v));
    document.body.dataset.view = view;
  }

  function pname(t, id, withRating = true) {
    const p = t.participants[id];
    if (!p) return "—";
    return `<span class="pn ${p.is_player ? "me" : ""}">${p.flag || ""} ${p.is_player ? "<b>" + p.name + "</b>" : p.name}` +
      (withRating ? ` <small class="mono">${p.rating}</small>` : "") + `</span>`;
  }

  function renderTournament(t) {
    $("tdName").textContent = t.name;
    $("tdSub").innerHTML = `${t.tc_icon} ${t.tc_label} · ${t.stage_label} · criado em ${t.date} · <button class="link-btn" id="tdRules">📖 Regras</button>`;
    $("tdRules").onclick = () => NexRules.show("tournament", { time_control: t.time_control, strength: t.strength });
    $("btnTourForfeit").classList.toggle("hidden", t.player_status !== "playing");

    // próxima partida / resultado
    let html;
    if (t.player_status === "playing" && t.next) {
      const o = t.next.opponent;
      html = `<div class="card-title">⚔️ Sua próxima partida · ${t.next.label}</div>
        <div class="nc-body">
          <div class="avatar big has-face" style="background:${o.avatar_color}">${faceHtml(o)}</div>
          <div class="nc-info"><b>${o.flag} ${o.name}</b> <span class="mono">${o.rating}</span>
            <div class="muted">${o.personality_icon || ""} ${o.personality_label || ""} · você joga de <b>${t.next.color === "white" ? "brancas ♔" : "pretas ♚"}</b></div>
            ${t.next.knockout ? `<div class="nc-note">⚖️ Mata-mata: se empatar, tem <b>jogo de desempate</b> com as cores trocadas.</div>` : ""}
          </div>
        </div>
        <button class="btn gold wide" id="btnTourPlay">${t.live_game ? "↩ Voltar para a partida" : "▶ Jogar partida"}</button>`;
    } else {
      const champ = t.champion ? t.participants[t.champion] : null;
      html = `<div class="card-title">🏁 Sua campanha</div>
        <div class="nc-result ${t.player_status}">
          <div class="nc-place">${t.player_status === "champion" ? "🏆 CAMPEÃO!" : t.place_label || "Encerrado"}</div>
          <div>${t.player_wins} vitórias · <b>🪙 ${t.prize_paid}</b> moedas${t.forfeit ? " (abandono)" : ""}</div>
          ${champ && !champ.is_player ? `<div class="muted">Campeão: ${champ.flag} ${champ.name} (${champ.rating})</div>` : ""}
        </div>`;
    }
    $("tdNext").innerHTML = html;
    const playBtn = $("btnTourPlay");
    if (playBtn) playBtn.onclick = () => playTournament(t.id);

    // premiação
    const places = [["champion", "🏆 Campeão"], ["final", "🥈 Vice"], ["sf", "🥉 Semifinal"], ["qf", "Quartas"], ["r16", "Oitavas"], ["group", "Grupos"]];
    $("tdPrizes").innerHTML = places.map(([k, n]) =>
      `<tr class="${t.player_place === k ? "me" : ""}"><td>${n}</td><td class="mono">${t.prizes[k]}</td></tr>`).join("") +
      `<tr class="bonus"><td>+ por vitória</td><td class="mono">${t.win_bonus}</td></tr>`;

    renderBracket(t);
    renderGroups(t);
  }

  function renderBracket(t) {
    const rounds = ["r16", "qf", "sf", "final"];
    const sizes = { r16: 8, qf: 4, sf: 2, final: 1 };
    const cell = (m, id, isWhite) => {
      if (!id) return `<div class="bk-p tbd">a definir</div>`;
      const won = m && m.winner === id, lost = m && m.winner && m.winner !== id;
      let sc = "";
      if (m && m.result) {
        const s = m.result === "1/2-1/2" ? "½" : (m.result === "1-0") === isWhite ? "1" : "0";
        sc = `<span class="bk-s">${s}${m.result === "1/2-1/2" && won ? "<sup>A</sup>" : ""}</span>`;
      }
      return `<div class="bk-p ${won ? "won" : ""} ${lost ? "lost" : ""} ${id === "me" ? "me" : ""}">
        <span class="bk-col ${isWhite ? "w" : "b"}"></span>${pname(t, id, true)}${sc}</div>`;
    };
    let html = "";
    rounds.forEach(r => {
      const ms = t.knockout[r] || [];
      html += `<div class="bk-round"><div class="bk-title">${t.ko_names[r]}</div><div class="bk-list">`;
      for (let i = 0; i < sizes[r]; i++) {
        const m = ms[i];
        html += `<div class="bk-match ${m && (m.white === "me" || m.black === "me") ? "mine" : ""}" title="${m && m.note ? m.note : ""}">
          ${cell(m, m && m.white, true)}${cell(m, m && m.black, false)}</div>`;
      }
      html += `</div></div>`;
    });
    const champ = t.champion ? t.participants[t.champion] : null;
    html += `<div class="bk-round champ"><div class="bk-title">Campeão</div><div class="bk-list">
      <div class="bk-champ ${champ && champ.is_player ? "me" : ""}">${champ ? `<div class="trophy">🏆</div>${pname(t, t.champion, true)}` : `<div class="trophy dim">🏆</div><span class="muted">a definir</span>`}</div>
    </div></div>`;
    $("tdBracket").innerHTML = html;
    if (!t.knockout.r16.length) {
      $("tdBracket").insertAdjacentHTML("afterbegin", `<div class="bk-wait">A chave se forma quando a fase de grupos terminar (rodada ${t.group_round} de 3).</div>`);
    }
  }

  function renderGroups(t) {
    const letters = Object.keys(t.groups);
    $("tdGroups").innerHTML = letters.map(g => {
      const G = t.groups[g];
      const rows = G.standings.map(r => `
        <tr class="${r.pos <= 2 && t.stage !== "groups" ? "q" : ""} ${r.pos <= 2 ? "top" : ""} ${r.id === "me" ? "me" : ""}">
          <td class="pos">${r.pos}</td><td class="nm">${pname(t, r.id, false)}</td>
          <td class="mono">${t.participants[r.id].rating}</td><td class="mono">${r.played}</td>
          <td class="mono">${r.w}-${r.d}-${r.l}</td><td class="mono pts">${String(r.pts).replace(".5", "½").replace(/^0½/, "½")}</td></tr>`).join("");
      let matches = "";
      if (g === "A") {
        matches = `<div class="g-matches">` + G.matches.map(m => {
          const res = m.result ? (m.result === "1/2-1/2" ? "½–½" : m.result.replace("-", "–")) : "vs";
          return `<div class="gm ${m.white === "me" || m.black === "me" ? "mine" : ""}"><span class="r">R${m.round}</span>` +
            `${pname(t, m.white, false)}<b class="mono">${res}</b>${pname(t, m.black, false)}</div>`;
        }).join("") + `</div>`;
      }
      return `<div class="group ${g === "A" ? "mine" : ""}">
        <div class="g-title">Grupo ${g}${g === "A" ? " · o seu" : ""}</div>
        <table><thead><tr><th>#</th><th>Jogador</th><th>Elo</th><th>J</th><th>V-E-D</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>
        ${matches}</div>`;
    }).join("");
  }

  async function playTournament(id) {
    try {
      const state = await api(`/api/tournaments/${id}/play`, {});
      closeModals();
      closeAnalysis(false);
      switchView("play");
      busy = false;
      game = null;
      showBot(state.bot);
      render(state);
      if (!state.player_turn && !state.over) botTurn();
    } catch (e) { toast(e.message); }
  }

  async function forfeitTournament() {
    if (!currentTour) return;
    if (!confirm("Abandonar este torneio? A partida atual conta como derrota e você não recebe prêmio.")) return;
    try {
      await api(`/api/tournaments/${currentTour.id}/forfeit`, {});
      toast("Você abandonou o torneio.");
      openTournament(currentTour.id);
    } catch (e) { toast(e.message); }
  }

  /* ---------------- eventos ---------------- */
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeModals);
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModals(); }));
  $("btnNew").onclick = openNew;
  $("btnAgain").onclick = () => newGame(game && game.bot && game.bot.personality === "professor" ? lastCoachOpts : undefined);
  $("btnStart").onclick = () => newGame();
  $("btnResign").onclick = resign;
  $("btnDraw").onclick = offerDraw;
  $("btnAnalyze").onclick = () => openAnalysis(game?.result?.game_id);
  $("btnResAnalyze").onclick = () => openAnalysis(game?.result?.game_id);
  $("anaClose").onclick = () => closeAnalysis();
  $("playerChip").onclick = e => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener("click", e => { if (!e.target.closest(".user-wrap")) toggleMenu(false); });
  $("coinPill").onclick = () => { switchView("shop"); NexShop.open("wallet"); };
  // abre na aba Jogar uma partida já criada pelo servidor (campeonatos)
  function openGameState(state) {
    closeModals();
    closeAnalysis(false);
    switchView("play");
    busy = false;
    game = null;
    showBot(state.bot);
    render(state);
    if (!state.player_turn && !state.over) botTurn();
  }

  // ponte para o shop.js (Fase 5) e champ.js (Fase 7)
  window.NexApp = { showRecoveryCode, api, toast, applyPlayer, loadPlayer, getPlayer: () => player, switchView, showAuth, beep, openGameState, faceHtml };
  $("userMenu").addEventListener("click", e => {
    const act = e.target.closest("button")?.dataset.act;
    toggleMenu(false);
    if (act === "profile") switchView("profile");
    if (act === "name") openNameModal();
    if (act === "avatar") { switchView("shop"); NexShop.open("avatar"); }
    if (act === "wallet") { switchView("shop"); NexShop.open("wallet"); }
    if (act === "logout") logout();
    if (act === "settings") switchView("settings");
    if (act === "backup") { switchView("settings"); NexSettings.focusBackup(); }
  });
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => switchView(b.dataset.view));
  $("authTabs").querySelectorAll("button").forEach(b => b.onclick = () => setAuthTab(b.dataset.v));
  $("loginForm").addEventListener("submit", e => submitAuth(e, "login"));
  $("recoverForm").addEventListener("submit", e => submitAuth(e, "recover"));
  $("forgotLink").onclick = () => setAuthTab("recover");
  $("recoverBack").onclick = () => setAuthTab("login");
  $("regNoPass").onchange = syncRegPass;
  $("recOk").onchange = () => { $("recGo").disabled = !$("recOk").checked; };
  $("recGo").onclick = () => $("recoveryModal").classList.remove("open");
  $("recCopy").onclick = async () => {
    try { await navigator.clipboard.writeText($("recCode").textContent); toast("Código copiado ✓"); }
    catch (_) { toast("Selecione o código e copie."); }
  };
  $("registerForm").addEventListener("submit", e => submitAuth(e, "register"));
  $("choosePlacement").onclick = () => { closeModals(); pick.mode = "rated"; openNew(); };
  $("chooseBeginner").onclick = skipAsBeginner;
  $("pbBeginner").onclick = skipAsBeginner;
  $("btnReveal").onclick = () => player && showReveal(player);
  $("histFilter").addEventListener("click", e => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    hist = { filter: b.dataset.f, offset: 0 };
    $("histFilter").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    loadHistory(false);
  });
  $("histMore").onclick = () => loadHistory(true);
  $("histList").addEventListener("click", e => {
    const row = e.target.closest(".hrow");
    if (!row) return;
    switchView("play");
    openAnalysis(+row.dataset.id);
  });
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (document.body.dataset.view === "profile") drawRatingChart(lastRatingHistory); }, 200);
  });
  $("revGo").onclick = () => { closeModals(); openNew(); };
  $("btnHint").onclick = askHint;
  $("btnTakeback").onclick = takeback;
  $("btnCoachGame").onclick = () => {
    if (game && !game.over) { switchView("play"); toast("Termine a partida atual antes de começar outra."); return; }
    switchView("play");
    newGame(lastCoachOpts);
  };
  $("btnTrainGame").onclick = () => { pick.mode = "training"; switchView("play"); openNew(); };
  $("btnFreePuzzle").onclick = () => startPuzzle({});
  $("dailyPuzzles").addEventListener("click", e => {
    const c = e.target.closest("[data-di]");
    if (!c) return;
    if (c.classList.contains("pending")) startPuzzle({ daily_index: +c.dataset.di });
    else toast("Você já fez este puzzle hoje. Tente os puzzles livres! 🧩");
  });
  $("pzBack").onclick = showTrainHome;
  $("missions").addEventListener("click", async e => {
    const b = e.target.closest("[data-reroll]");
    if (!b) return;
    if (!confirm(`Trocar esta missão por outra? Custa ${b.textContent.match(/\d+/)[0]} 🪙 (1 troca por dia).`)) return;
    try {
      const r = await api("/api/missions/reroll", { key: b.dataset.reroll });
      toast(`Nova missão: ${r.mission.icon} ${r.mission.text}`);
      r.overview.user = await api("/api/player");
      renderTraining(r.overview);
    } catch (err) { toast(err.message); }
  });
  $("pzHint").onclick = pzHint;
  $("pzSolution").onclick = pzSolution;
  $("pzNext").onclick = () => { if (pzFrom && pzFrom.daily_index != null) showTrainHome(); else startPuzzle({}); };
  $("btnTourCreate").onclick = openTourModal;
  $("btnTourGo").onclick = () => createTournament({ name: $("tourName").value, time_control: tourPick.tc, strength: tourPick.strength });
  $("tourStrSeg").querySelectorAll("button").forEach(b => b.onclick = () => {
    tourPick.strength = b.dataset.v;
    $("tourStrSeg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  });
  $("btnTourBack").onclick = showTourList;
  $("btnTourForfeit").onclick = forfeitTournament;
  // "Jogar de novo": recomeça um torneio já encerrado, com o mesmo nome, ritmo e nível (as regras aparecem antes)
  $("tourDone").addEventListener("click", e => {
    const b = e.target.closest("[data-again]");
    if (!b) return;
    const t = tourDoneList.find(x => x.id === +b.dataset.again);
    if (t) createTournament({ name: t.name, time_control: t.time_control, strength: t.strength });
  });
  ["tourActive", "tourDone"].forEach(id => $(id).addEventListener("click", e => {
    const c = e.target.closest("[data-tid]");
    if (c) openTournament(+c.dataset.tid);
  }));
  $("btnTour").onclick = () => {
    closeModals();
    if ($("btnTour").dataset.champ && window.NexChamp) { switchView("champ"); NexChamp.openComp(+$("btnTour").dataset.id); }
    else openTournament(+$("btnTour").dataset.id);
  };
  $("btnSaveName").onclick = saveName;
  $("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") saveName(); });
  $("recent").addEventListener("click", e => {
    const li = e.target.closest("li[data-id]");
    if (li) openAnalysis(+li.dataset.id);
  });
  $("anaGraph").addEventListener("click", e => {
    if (!analysis?.data) return;
    const r = e.currentTarget.getBoundingClientRect();
    showPly(Math.round(((e.clientX - r.left) / r.width) * (analysis.data.graph.length - 1)));
  });
  bindSeg("colorSeg", "color");
  bindSeg("modeSeg", "mode");

  // navegação pelos lances: botões, clique na lista e setas do teclado
  document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => navigate(b.dataset.nav));
  $("moves").addEventListener("click", e => {
    const mv = e.target.closest(".mv");
    if (mv) showPly(+mv.dataset.ply);
  });
  $("reviewBanner").onclick = goLive;
  $("anaStripPrev").onclick = () => navigate("prev");
  $("anaStripNext").onclick = () => navigate("next");
  // clicar no tabuleiro enquanto revisa (partida ao vivo) volta para o lance atual
  $("board").addEventListener("pointerdown", () => { if (view !== null && !analysis) goLive(); }, true);
  document.addEventListener("keydown", e => {
    if (document.querySelector(".modal.open") || e.target.closest("input, textarea")) return;
    const dir = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last", ArrowUp: "first", ArrowDown: "last" }[e.key];
    if (dir) { e.preventDefault(); navigate(dir); }
  });
  markMoveList();

  /* ---------------- início ---------------- */
  (async () => {
    try {
      try { checkVersion(await api("/api/status")); } catch (_) {}
      const lv = await api("/api/levels");
      levels = lv.levels;
      timeControls = lv.time_controls;
      if (!timeControls.some(t => t.key === pick.tc)) pick.tc = "none";
      const st = await api("/api/auth/state");
      if (st.user) enterApp(st.user);
      else showAuth(st.legacy);
    } catch (e) { toast("Não consegui falar com o servidor. Ele está rodando?"); }
    hideSplash();
  })();
  function hideSplash() {
    const sp = $("splash");
    if (!sp || sp.classList.contains("out")) return;
    sp.classList.add("out");
    setTimeout(() => sp.remove(), 600);
  }
  setTimeout(hideSplash, 5000);  // segurança: nunca prende a tela
})();
