/* Nex-J Chess (celular) — o "servidor" dentro do aparelho.
 *
 * Intercepta fetch("/api/...") e responde com o mesmo JSON que o app.py do PC respondia, usando o
 * banco local (store.js) e as regras portadas (core.js, games.js, analysis.js, coach.js).
 * Assim a interface (static/js/*.js) funciona igualzinha, sem internet e sem servidor.
 */
(function (root) {
  "use strict";
  const S = root.NJStore, U = root.NJUtil, K = root.NJCore, G = root.NJGames, A = root.NJAnalysis, C = root.NexChess;
  const { UserError } = K;
  const APP_VERSION = "8.0";
  const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

  // ---------------------------------------------------------------- respostas
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const error = (msg, status = 400) => json({ error: msg }, status);
  const uid = () => S.meta.uid || null;
  const currentPlayer = () => (uid() ? S.get("players", uid()) : null);

  function playerDict(p) {
    const [key, name] = K.Elo.tierFor(p.rating), pl = K.Placement.info(p);
    return {
      id: p.id, username: p.username, name: p.name, rating: p.rating, peak_rating: p.peak_rating, title: name, title_key: key,
      title_icon: K.Titles.BY_KEY[key][3], provisional: pl.done && K.Elo.isProvisional(p.rated_games),
      provisional_left: pl.done ? Math.max(0, K.Elo.PROVISIONAL_GAMES - p.rated_games) : null, placement: pl,
      games_played: p.games_played, rated_games: p.rated_games, wins: p.wins, losses: p.losses, draws: p.draws,
      member_since: U.local(p.created_at), coins: p.coins || 0, trophies: p.trophies || 0, streak_freezes: p.streak_freezes || 0,
      looks: K.Shop.looks(p), has_recovery: !!p.recovery_hash, open_login: !!p.open_login,
    };
  }

  // ---------------------------------------------------------------- tentativas erradas de senha (6 a cada 15 min)
  const ATTEMPTS = new Map(), MAX_ATTEMPTS = 6, WINDOW = 15 * 60 * 1000;
  function tooMany(kind, key) {
    const now = Date.now(), k = kind + ":" + key;
    const lst = (ATTEMPTS.get(k) || []).filter(t => now - t < WINDOW);
    ATTEMPTS.set(k, lst);
    return lst.length >= MAX_ATTEMPTS;
  }
  const failAttempt = (kind, key) => { const k = kind + ":" + key; ATTEMPTS.set(k, (ATTEMPTS.get(k) || []).concat(Date.now())); };
  const clearAttempts = (kind, key) => ATTEMPTS.delete(kind + ":" + key);
  const lockedMsg = () => error("Muitas tentativas erradas. Espere uns 15 minutos e tente de novo.", 429);

  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function newRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const raw = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    return raw.slice(0, 4) + "-" + raw.slice(4);
  }
  const normCode = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const randomPassword = () => U.toHex(crypto.getRandomValues(new Uint8Array(18)));

  // ---------------------------------------------------------------- linhas de partida / perfil
  function tcInfo(tc) {
    if (!tc) return null;
    const [base, inc] = tc.split("+").map(Number), [key, name, icon] = K.TimeControl.label(base, inc);
    return { key, label: name, icon };
  }
  function gameRow(g) {
    return {
      id: g.id, accuracy: g.player_accuracy, bot_name: g.bot_name, bot_rating: g.bot_rating, bot_personality: g.bot_personality, outcome: g.outcome,
      result: g.result, mode: g.mode || (g.rated ? "rated" : "casual"), rated: g.rated, termination: g.termination, moves: Math.floor((g.moves_count + 1) / 2),
      time_control: tcInfo(g.time_control), player_color: g.player_color, rating_change: g.rating_after - g.rating_before,
      date: U.local(g.created_at, "dm"), date_full: U.local(g.created_at, "full"),
    };
  }
  function gameMeta(id) {
    const g = S.get("games", id);
    if (!g || g.player_id !== uid()) return null;
    return { id: g.id, bot_name: g.bot_name, bot_rating: g.bot_rating, bot_personality: g.bot_personality, player_color: g.player_color, result: g.result,
      outcome: g.outcome, termination: g.termination, rated: g.rated, mode: g.mode, player_name: currentPlayer().name, date: U.local(g.created_at, "full") };
  }
  const myGames = () => S.where("games", g => g.player_id === uid()).sort((a, b) => b.id - a.id);

  // ---------------------------------------------------------------- carteira / NexusJCoin (no celular a ponte fica desligada)
  function njcBlock(p) {
    return { enabled: false, url: "", rate: 100, min_coins: 100, daily_limit: 0, name: "NexusJCoin", symbol: "NJC", wallet: p.njc_wallet || null, sent_today: 0, transfers: [],
      config_error: "A ponte com o NexusJCoin precisa de internet e fica no jogo do computador. No celular as moedas ficam guardadas aqui." };
  }

  // ---------------------------------------------------------------- backups (guardados no próprio aparelho)
  const BK_KINDS = { manual: "Manual", auto: "Automático", restore: "Antes de restaurar", update: "Antes de atualizar" };
  const bkSettings = () => Object.assign({ auto_backup: true, keep: 15, extra_dir: "" }, S.meta.settings && S.meta.settings.backup || {});
  const pad2 = n => String(n).padStart(2, "0");
  function createBackup(kind) {
    const d = new Date();
    const name = `nexj_backup_${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}_${kind}.json`;
    const all = S.exportAll();
    const payload = JSON.stringify(all);
    const row = S.insert("backups", { name, kind, created_at: U.nowIso(), size_kb: Math.round(payload.length / 1024), version: APP_VERSION,
      players: all.tables.players.length, games: all.tables.games.length, payload });
    const keep = Math.max(3, +bkSettings().keep || 15);
    const rows = S.all("backups").sort((a, b) => b.id - a.id);
    const protectedRow = rows.find(r => r.kind === "restore");
    for (const r of rows.slice(keep)) if (r !== protectedRow) S.remove("backups", r.id);
    return { name, extra: null };
  }
  function backupOverview() {
    const rows = S.all("backups").sort((a, b) => b.id - a.id);
    const last = rows[0];
    return {
      items: rows.map(r => ({ name: r.name, kind: r.kind, kind_label: BK_KINDS[r.kind] || r.kind, date: U.local(r.created_at, "full"), size_kb: r.size_kb,
        version: r.version, players: r.players, games: r.games, broken: false })),
      settings: bkSettings(), folder: "dentro do aparelho (use ⬇️ para guardar uma cópia no Drive ou no WhatsApp)",
      last: last ? U.local(last.created_at, "full") : null, can_open_folder: false,
    };
  }
  function autoBackupIfDue() {
    try {
      if (!bkSettings().auto_backup || !S.count("players")) return;
      const last = S.all("backups").sort((a, b) => b.id - a.id)[0];
      if (!last || Date.now() - new Date(last.created_at).getTime() > 20 * 3600 * 1000) createBackup("auto");
    } catch (e) { console.warn("[backup automático]", e); }
  }
  function restoreFrom(obj) {
    createBackup("restore");                 // a rede de segurança
    S.importAll(obj);
    G.games.clear(); K.Puzzles.sessions.clear();
    delete S.meta.uid;
    return { ok: true, restored: { players: S.count("players"), games: S.count("games") }, safety: true };
  }

  // ---------------------------------------------------------------- rotas
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const names = [];
    const re = new RegExp("^" + pattern.replace(/<(\w+)>/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    routes.push({ method, re, names, handler, auth: opts.auth !== false });
  };

  // ---- contas
  route("GET", "/api/auth/state", () => { const p = currentPlayer(); return json({ user: p ? playerDict(p) : null, legacy: null }); }, { auth: false });

  route("POST", "/api/auth/register", async ({ body }) => {
    const username = String(body.username || "").trim().toLowerCase();
    const name = String(body.name || "").split(/\s+/).filter(Boolean).join(" ");
    let password = body.password || "";
    const noPassword = ["1", "true", "on", "yes"].includes(String(body.no_password || "").toLowerCase());
    if (noPassword) password = randomPassword();
    if (!USERNAME_RE.test(username)) return error("Usuário: de 3 a 20 caracteres, só letras minúsculas, números, ponto ou _.");
    if (S.first("players", p => p.username === username)) return error("Esse usuário já existe. Escolha outro.");
    if (name.length < 2 || name.length > 20) return error("O nome precisa ter entre 2 e 20 letras.");
    if (password.length < 4) return error("A senha precisa ter pelo menos 4 caracteres.");
    const hash = await U.hashPassword(password);
    const p = S.insert("players", {
      username, password_hash: hash, name, rating: 800, peak_rating: 800, games_played: 0, rated_games: 0, wins: 0, losses: 0, draws: 0,
      placement_done: false, placement_step: 0, placement_target: K.Placement.START, last_login: U.nowIso(), coins: 0, trophies: 0,
      puzzle_rating: null, puzzle_attempts: 0, streak: 0, streak_best: 0, last_active: null, streak_freezes: 0, equipped: null, avatar: null,
      uf: null, club: null, division: null, season: 0, honors: null, recovery_hash: null, open_login: noPassword, njc_wallet: null, created_at: U.nowIso(),
    });
    S.meta.uid = p.id;
    return json({ user: playerDict(p), inherited: false });
  }, { auth: false });

  route("POST", "/api/auth/login", async ({ body }) => {
    const username = String(body.username || "").trim().toLowerCase(), password = body.password || "";
    if (tooMany("login", username)) return lockedMsg();
    const p = S.first("players", x => x.username === username);
    let ok;
    if (p && p.open_login) ok = true;
    else if (!p || !p.password_hash) ok = false;
    else if (!password) return error('Esta conta tem senha. Digite a senha ou toque em "Esqueci a senha".');
    else ok = await U.checkPassword(p.password_hash, password);
    if (!ok) { failAttempt("login", username); return error("Usuário ou senha incorretos."); }
    clearAttempts("login", username);
    p.last_login = U.nowIso();
    S.meta.uid = p.id;
    return json({ user: playerDict(p) });
  }, { auth: false });

  route("POST", "/api/auth/recover", async ({ body }) => {
    const username = String(body.username || "").trim().toLowerCase(), code = normCode(body.code), password = body.password || "";
    if (tooMany("recover", username)) return lockedMsg();
    if (password.length < 4) return error("A senha nova precisa ter pelo menos 4 caracteres.");
    const p = S.first("players", x => x.username === username);
    if (!p || !p.recovery_hash || code.length !== 8 || !(await U.checkPassword(p.recovery_hash, code))) {
      failAttempt("recover", username);
      return error("Usuário ou código incorretos.");
    }
    clearAttempts("recover", username);
    p.password_hash = await U.hashPassword(password);
    p.open_login = false;
    p.recovery_hash = null;                  // código usado: o app gera outro na hora
    p.last_login = U.nowIso();
    S.meta.uid = p.id;
    return json({ user: playerDict(p) });
  }, { auth: false });

  route("POST", "/api/account/recovery", async () => {
    const p = currentPlayer(), code = newRecoveryCode();
    p.recovery_hash = await U.hashPassword(normCode(code));
    return json({ code, user: playerDict(p) });
  });

  route("POST", "/api/account/open-login", async ({ body }) => {
    const p = currentPlayer();
    if (body.on) p.open_login = true;
    else {
      const password = body.password || "";
      if (password.length < 4) return error("Escolha uma senha com pelo menos 4 caracteres.");
      p.password_hash = await U.hashPassword(password);
      p.open_login = false;
    }
    return json({ user: playerDict(p) });
  });

  route("POST", "/api/auth/logout", () => { delete S.meta.uid; return json({ ok: true }); }, { auth: false });

  // ---- jogador / perfil
  route("GET", "/api/status", () => json({ engine: root.NexEngineName || "Motor Nex-J (celular)", stockfish: true, version: APP_VERSION }), { auth: false });
  route("GET", "/api/player", () => json(playerDict(currentPlayer())));
  route("POST", "/api/player/name", ({ body }) => {
    const name = String(body.name || "").split(/\s+/).filter(Boolean).join(" ");
    if (name.length < 2 || name.length > 20) return error("O nome precisa ter entre 2 e 20 letras.");
    const p = currentPlayer(); p.name = name;
    return json(playerDict(p));
  });
  route("POST", "/api/placement/skip", () => {
    const p = currentPlayer();
    if (p.placement_done) return error("Sua classificação já foi concluída.");
    if (p.placement_step) return error("Você já começou a classificação. Termine as partidas que faltam!");
    K.Placement.skipAsBeginner(p);
    S.insert("rating_history", { player_id: p.id, rating: p.rating, game_id: null, reason: "start", created_at: U.nowIso() });
    const newTitles = K.Titles.award(p);
    K.Titles.payBonus(p, newTitles);
    return json({ user: playerDict(p), new_titles: newTitles });
  });

  route("GET", "/api/profile", () => {
    const p = currentPlayer(), games = myGames();
    const wins = games.filter(g => g.outcome === "win");
    const accs = games.filter(g => g.player_accuracy !== null && g.player_accuracy !== undefined).map(g => g.player_accuracy);
    const byMode = {};
    for (const g of games) byMode[g.mode] = (byMode[g.mode] || 0) + 1;
    let streak = 0;
    for (const g of games.slice(0, 50)) { if (g.outcome !== "win") break; streak++; }
    const avg = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
    const history = S.where("rating_history", h => h.player_id === p.id).sort((a, b) => a.id - b.id);
    return json({
      user: playerDict(p),
      stats: {
        win_rate: p.games_played ? Math.round(100 * p.wins / p.games_played) : 0, best_win: wins.length ? Math.max(...wins.map(g => g.bot_rating)) : null,
        avg_accuracy: avg !== null ? Math.round(avg * 10) / 10 : null, win_streak: streak,
        by_mode: { rated: byMode.rated || 0, casual: byMode.casual || 0, placement: byMode.placement || 0 },
      },
      rating_history: history.map(h => ({ rating: h.rating, reason: h.reason, date: U.local(h.created_at) })),
      titles: K.Titles.forPlayer(p),
    });
  });

  route("GET", "/api/games/recent", () => json(myGames().slice(0, 10).map(gameRow)));
  route("GET", "/api/games", ({ query }) => {
    const kind = query.get("filter") || "all";
    const offset = Math.max(0, parseInt(query.get("offset") || "0", 10) || 0), limit = Math.min(50, Math.max(1, parseInt(query.get("limit") || "20", 10) || 20));
    let rows = myGames();
    if (["rated", "casual", "placement", "tournament", "training"].includes(kind)) rows = rows.filter(g => g.mode === kind);
    else if (["win", "loss", "draw"].includes(kind)) rows = rows.filter(g => g.outcome === kind);
    const items = rows.slice(offset, offset + limit);
    return json({ items: items.map(gameRow), total: rows.length, has_more: offset + items.length < rows.length });
  });

  // ---- análise
  route("POST", "/api/games/<id>/analysis", ({ params }) => {
    const meta = gameMeta(+params.id);
    if (!meta) return error("Partida não encontrada.", 404);
    return json(Object.assign({}, A.start(+params.id), { meta }));
  });
  route("GET", "/api/games/<id>/analysis", ({ params }) => {
    const meta = gameMeta(+params.id);
    if (!meta) return error("Partida não encontrada.", 404);
    return json(Object.assign({}, A.status(+params.id), { meta }));
  });

  // ---- partidas
  route("GET", "/api/levels", () => json({
    levels: K.Bots.LEVELS.map(([key, name, min, max]) => ({ key, name, min, max })), personalities: K.Bots.PERSONALITIES,
    time_controls: Object.entries(K.TimeControl.TIME_CONTROLS).map(([key, [base, inc, label, icon]]) => ({ key, base, inc, label, icon })),
  }), { auth: false });

  route("POST", "/api/game/new", ({ body }) => {
    const level = body.level === undefined ? "auto" : body.level, color = body.color || "random";
    const vsCoach = level === "coach";
    let mode = body.training || vsCoach ? "training" : (body.rated === undefined || body.rated ? "rated" : "casual");
    const useCoach = (body.coach === undefined ? true : !!body.coach) || mode === "training";
    let tcKey = body.time_control || "none";
    if (!(tcKey in K.TimeControl.TIME_CONTROLS)) return error("Ritmo de jogo inválido.");
    if (!["white", "black", "random"].includes(color)) return error("Cor inválida.");
    if (vsCoach) tcKey = "none";
    else if (level !== "auto" && !K.Bots.LEVELS.some(l => l[0] === level)) return error("Nível inválido.");
    const p = currentPlayer();
    let bot, col = color;
    if (vsCoach) bot = K.Bots.coach(p.rating);
    else if (mode === "rated" && !p.placement_done) {      // enquanto não terminar a classificação, "valendo rating" = classificação
      const info = K.Placement.info(p);
      mode = "placement"; col = info.next_color;
      bot = K.Bots.generate(null, null, info.next_rating);
    } else bot = K.Bots.generate(level, p.rating);
    const s = G.create(bot, col, mode, p.id, tcKey, useCoach);
    const state = G.state(s);
    state.message = bot.say("greet");
    return json(state);
  });

  const ownGame = id => G.get(id, uid());
  route("GET", "/api/game/<id>", ({ params }) => { const s = ownGame(params.id); return s ? json(G.state(s)) : error("Partida não encontrada.", 404); });
  route("POST", "/api/game/<id>/move", async ({ params, body }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    const info = await G.playerMove(s, body.uci || "");
    const state = G.state(s); state.message = info.message; state.coach = info.coach || null;
    return json(state);
  });
  route("POST", "/api/game/<id>/hint", async ({ params, body }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    return json(await G.hint(s, parseInt(body.level || 1, 10)));
  });
  route("POST", "/api/game/<id>/takeback", ({ params }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    G.takeback(s); return json(G.state(s));
  });
  route("POST", "/api/game/<id>/bot-move", async ({ params }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    const info = await G.botMove(s);
    const state = G.state(s); state.message = info.message; state.bot_last = info; state.warning = info.warning || null;
    return json(state);
  });
  route("POST", "/api/game/<id>/resign", ({ params }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    G.resign(s); return json(G.state(s));
  });
  route("POST", "/api/game/<id>/flag", ({ params }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    G.checkFlag(s); return json(G.state(s));
  });
  route("POST", "/api/game/<id>/draw", async ({ params }) => {
    const s = ownGame(params.id); if (!s) return error("Partida não encontrada.", 404);
    const [accepted, message] = await G.offerDraw(s);
    const state = G.state(s); state.draw_accepted = accepted; state.message = message;
    return json(state);
  });

  // ---- loja, avatar, carteira
  route("GET", "/api/shop", () => json(K.Shop.catalog(currentPlayer())));
  route("POST", "/api/shop/buy", ({ body }) => {
    const p = currentPlayer(), item = K.Shop.buy(p, body.key || "");
    return json({ ok: true, item: item.name, catalog: K.Shop.catalog(p), user: playerDict(p) });
  });
  route("POST", "/api/shop/equip", ({ body }) => {
    const p = currentPlayer(); K.Shop.equip(p, body.key || "");
    return json({ ok: true, catalog: K.Shop.catalog(p), user: playerDict(p) });
  });
  route("GET", "/api/avatar", () => {
    const p = currentPlayer();
    return json({ avatar: K.Shop.avatarOf(p), default: K.Shop.DEFAULT_AVATAR, options: K.Shop.avatarOptions(p), coins: p.coins || 0 });
  });
  route("POST", "/api/avatar", ({ body }) => {
    const p = currentPlayer(); K.Shop.saveAvatar(p, body.traits);
    return json({ ok: true, user: playerDict(p) });
  });
  route("GET", "/api/wallet", () => {
    const p = currentPlayer();
    return json({
      coins: p.coins || 0, totals: K.Economy.totals(p), kinds: Object.fromEntries(Object.entries(K.Economy.KIND_LABELS).map(([k, v]) => [k, { label: v[0], icon: v[1] }])),
      rules: K.Economy.rules(),
      history: K.Economy.history(p, 80).map(t => ({ amount: t.amount, balance: t.balance, kind: t.kind, reason: t.reason, date: U.local(t.created_at, "dm") })),
      njc: njcBlock(p),
    });
  });
  route("POST", "/api/wallet/njc/wallet", ({ body }) => {
    const addr = String(body.wallet || "").trim();
    if (addr && !/^[A-Za-z0-9_\-:.]{6,120}$/.test(addr)) return error("Endereço de carteira inválido (use só letras, números, - _ : .).");
    const p = currentPlayer(); p.njc_wallet = addr || null;
    return json({ ok: true, njc: njcBlock(p) });
  });
  route("GET", "/api/wallet/njc/status", () => json({ enabled: false, online: false, message: "A ponte NexusJCoin só funciona no jogo do computador." }));
  route("POST", "/api/wallet/njc/send", () => error("A ponte NexusJCoin só funciona no jogo do computador."));
  route("POST", "/api/wallet/njc/<id>/<action>", () => error("A ponte NexusJCoin só funciona no jogo do computador."));

  route("POST", "/api/missions/reroll", ({ body }) => {
    const p = currentPlayer(), key = body.key || "";
    if ((p.coins || 0) < K.Daily.REROLL_PRICE) throw new K.Economy.NotEnoughCoins(K.Daily.REROLL_PRICE, p.coins || 0);
    const m = K.Daily.rerollMission(p, key);          // se der erro aqui, nada foi cobrado
    K.Economy.debit(p, K.Daily.REROLL_PRICE, "shop", "Troca de missão do dia", key);
    return json({ ok: true, mission: m, overview: K.Daily.overview(p) });
  });

  // ---- backup
  route("GET", "/api/backups", () => json(backupOverview()));
  route("POST", "/api/backups", () => json(Object.assign({ created: createBackup("manual") }, backupOverview())));
  route("POST", "/api/backups/<name>/delete", ({ params }) => {
    const row = S.first("backups", r => r.name === decodeURIComponent(params.name));
    if (!row) return error("Backup não encontrado.");
    S.remove("backups", row.id);
    return json(backupOverview());
  });
  route("POST", "/api/backups/settings", ({ body }) => {
    const cur = Object.assign({}, bkSettings());
    if ("auto_backup" in body) cur.auto_backup = !!body.auto_backup;
    if ("keep" in body) cur.keep = Math.max(3, Math.min(60, parseInt(body.keep, 10) || 15));
    S.meta.settings = Object.assign({}, S.meta.settings || {}, { backup: cur });
    return json(backupOverview());
  });
  route("POST", "/api/backups/open-folder", () => error("Abrir a pasta só funciona no Windows."));
  route("POST", "/api/backups/restore", async ({ body, form }) => {
    let obj;
    try {
      if (form && form.get("file")) obj = JSON.parse(await form.get("file").text());
      else {
        const row = S.first("backups", r => r.name === (body.name || ""));
        if (!row) return error("Backup não encontrado.");
        obj = JSON.parse(row.payload);
      }
    } catch (e) { return error("Não consegui ler esse arquivo de backup."); }
    const out = restoreFrom(obj);
    try { await S.flush(); } catch (_) {}      // garante que gravou no aparelho antes de recarregar
    return json(out);
  }, { auth: false });

  // ---- treino
  route("GET", "/api/training", () => { const p = currentPlayer(), d = K.Daily.overview(p); d.user = playerDict(p); return json(d); });
  route("POST", "/api/puzzles/start", ({ body }) => {
    const p = currentPlayer();
    if (!K.Puzzles.bank().length) return error("O banco de puzzles não foi encontrado.");
    let puzzle, day = null, di = body.daily_index;
    if (di !== undefined && di !== null) {
      const row = K.Daily.getSet(p), items = JSON.parse(row.puzzles);
      di = parseInt(di, 10);
      if (!(di >= 0 && di < items.length)) return error("Puzzle do dia inválido.");
      puzzle = K.Puzzles.get(items[di].id); day = row.day;
    } else {
      const done = new Set(S.where("puzzle_attempts", a => a.player_id === p.id).map(a => a.puzzle_id));
      puzzle = K.Puzzles.pickNear(p.puzzle_rating || 800, done); di = null;
    }
    const s = K.Puzzles.start(p.id, puzzle, day, di);
    return json(K.Puzzles.stateOf(s, { puzzle_rating: p.puzzle_rating }));
  });
  function finishPuzzle(s, solved) {
    const p = currentPlayer();
    const res = K.Daily.onPuzzleFinished(p, s.pid, solved, s.hinted, s.daily_index);
    res.puzzle_rating = p.puzzle_rating; res.coins = p.coins;
    return res;
  }
  route("POST", "/api/puzzles/<token>/move", ({ params, body }) => {
    const s = K.Puzzles.getSession(params.token, uid()); if (!s) return error("Puzzle não encontrado.", 404);
    if (s.done) return error("Este puzzle já terminou.");
    const [status, info] = K.Puzzles.tryMove(s, body.uci || "");
    const extra = Object.assign({ status }, info);
    if (status === "solved") extra.result = finishPuzzle(s, !s.failed);
    return json(K.Puzzles.stateOf(s, extra));
  });
  route("POST", "/api/puzzles/<token>/hint", ({ params }) => {
    const s = K.Puzzles.getSession(params.token, uid()); if (!s || s.done) return error("Puzzle não encontrado.", 404);
    return json(K.Puzzles.hint(s));
  });
  route("POST", "/api/puzzles/<token>/solution", ({ params }) => {
    const s = K.Puzzles.getSession(params.token, uid()); if (!s || s.done) return error("Puzzle não encontrado.", 404);
    const steps = K.Puzzles.solution(s), result = finishPuzzle(s, false);
    return json(K.Puzzles.stateOf(s, { status: "shown", steps, result }));
  });

  // ---- torneios, campeonatos, carreira, regras (etapa 3)
  const CP = root.NJComp, Tour = CP.Tour, Champ = CP.Champ, Career = CP.Career, Rules = CP.Rules;
  const MAX_ACTIVE_TOURNAMENTS = 5;
  const tcOk = k => Object.prototype.hasOwnProperty.call(K.TimeControl.TIME_CONTROLS, k);
  const ownRow = (table, id) => { const r = S.get(table, parseInt(id, 10)); return r && r.player_id === uid() ? r : null; };

  function tournamentCard(t) {
    const data = CP.loads(t.data), nxt = data.player_status === "playing" ? Tour.playerMatch(data) : null;
    return { id: t.id, name: t.name, status: t.status, player_status: t.player_status, stage_label: Tour.stageLabel(data), tc_label: data.tc_label, tc_icon: data.tc_icon,
      place: t.place, place_label: t.place ? (Tour.PLACE_NAMES[t.place] || "") : null, prize: t.prize, wins: data.player_wins, time_control: t.time_control,
      strength: data.strength || "equal", next: nxt ? Tour.describeMatch(data, nxt) : null, champion: data.champion ? data.participants[data.champion].name : null,
      date: U.local(t.created_at, "d") };
  }
  route("GET", "/api/tournaments", () => {
    const p = currentPlayer();
    const rows = S.where("tournaments", r => r.player_id === p.id).sort((a, b) => b.id - a.id);
    return json({ mine: rows.map(tournamentCard),
      templates: Tour.TEMPLATES.map(t => { const tc = K.TimeControl.get(t.time_control); return Object.assign({}, t, { tc_label: tc[2], tc_icon: tc[3] }); }),
      prizes: Tour.PRIZES, win_bonus: Tour.WIN_BONUS, random_name: Tour.randomName(), can_join: !!p.placement_done, coins: p.coins || 0, trophies: p.trophies || 0 });
  });
  route("POST", "/api/tournaments", ({ body }) => {
    const p = currentPlayer();
    const tc = body.time_control || "none", strength = body.strength || "equal";
    const name = String(body.name || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 60) || Tour.randomName();
    if (!tcOk(tc)) return error("Ritmo de jogo inválido.");
    if (!(strength in Tour.STRENGTHS)) return error("Nível inválido.");
    if (!p.placement_done) return error("Termine suas partidas de classificação antes de entrar em torneios.");
    const active = S.count("tournaments", r => r.player_id === p.id && r.player_status === "playing");
    if (active >= MAX_ACTIVE_TOURNAMENTS) return error(`Você já está em ${active} torneios. Termine algum antes de entrar em outro.`);
    const state = Tour.createData(p, name, tc, strength);
    const t = S.insert("tournaments", { player_id: p.id, name, time_control: tc, status: "groups", player_status: "playing", place: null, prize: 0, data: CP.dumps(state), created_at: U.nowIso(), finished_at: null });
    return json({ id: t.id });
  });
  route("GET", "/api/tournaments/<id>", ({ params }) => {
    const t = ownRow("tournaments", params.id); if (!t) return error("Torneio não encontrado.", 404);
    const state = Tour.publicState(CP.loads(t.data));
    const live = G.findTournamentGame(t.id, uid());
    return json(Object.assign(state, { id: t.id, prize_paid: t.prize, date: U.local(t.created_at, "d"), live_game: live ? live.id : null }));
  });
  route("POST", "/api/tournaments/<id>/play", ({ params }) => {
    const t = ownRow("tournaments", params.id); if (!t) return error("Torneio não encontrado.", 404);
    const existing = G.findTournamentGame(t.id, uid());
    if (existing) return json(G.state(existing));
    const data = CP.loads(t.data), found = data.player_status === "playing" ? Tour.playerMatch(data) : null;
    if (!found) return error("Não há partida sua para jogar neste torneio agora.");
    const info = Tour.describeMatch(data, found), bot = K.Bots.fromDict(info.opponent);
    const g = G.create(bot, info.color, "tournament", uid(), data.time_control);
    g.tournament_id = t.id; g.tournament_label = `${t.name} · ${info.label}`;
    const state = G.state(g);
    state.message = bot.sayTournament(info.where === "final" ? "final" : info.where === "group" ? "group" : "ko");
    return json(state);
  });
  route("POST", "/api/tournaments/<id>/forfeit", ({ params }) => {
    let t = ownRow("tournaments", params.id); if (!t) return error("Torneio não encontrado.", 404);
    const live = G.findTournamentGame(t.id, uid());
    if (live) { G.resign(live); t = S.get("tournaments", t.id); }
    const data = CP.loads(t.data);
    if (data.player_status === "playing") {
      Tour.forfeit(data);
      t.data = CP.dumps(data); t.status = data.stage; t.player_status = data.player_status; t.place = data.player_place; t.prize = 0; t.finished_at = U.nowIso();
    }
    return json({ ok: true });
  });

  route("GET", "/api/career", () => json(Career.status(currentPlayer())));
  route("POST", "/api/career/start", ({ body }) => { const p = currentPlayer(); Career.startCareer(p, body.uf, body.club, body.palette || 0); return json(Career.status(p)); });
  route("POST", "/api/career/club", ({ body }) => { const p = currentPlayer(); Career.editClub(p, body.club, body.palette, body.uf); return json(Career.status(p)); });
  route("POST", "/api/career/season/next", () => { const p = currentPlayer(); Career.nextSeason(p); return json(Career.status(p)); });
  route("POST", "/api/champ/<kind>/start", ({ params, body }) => {
    const p = currentPlayer();
    if (!p.placement_done) throw new Career.CareerError("Termine suas partidas de classificação antes dos campeonatos.");
    const row = Career.startCompetition(p, params.kind, body.time_control || "rapid");
    return json({ id: row.id });
  });
  route("GET", "/api/rules/<scope>", ({ params, query }) => {
    let tc = query.get("time_control") || "rapid"; if (!tcOk(tc)) tc = "rapid";
    if (params.scope === "tournament") { const st = query.get("strength") || "equal"; return json(Rules.tournament(tc, st in Tour.STRENGTHS ? st : "equal")); }
    if (params.scope in Champ.KINDS) return json(Rules.championship(params.scope, tc, currentPlayer().division));
    return error("Competição desconhecida.", 404);
  });
  route("GET", "/api/champ/<id>", ({ params }) => {
    const row = ownRow("championships", params.id); if (!row) return error("Competição não encontrada.", 404);
    const state = Champ.publicState(CP.loads(row.data)), live = G.findChampGame(row.id, uid());
    return json(Object.assign(state, { id: row.id, prize_paid: row.prize, status: row.status, live_game: live ? live.id : null }));
  });
  route("POST", "/api/champ/<id>/play", ({ params }) => {
    const row = ownRow("championships", params.id); if (!row) return error("Competição não encontrada.", 404);
    const existing = G.findChampGame(row.id, uid());
    if (existing) return json(G.state(existing));
    const data = CP.loads(row.data), found = Champ.playerMatch(data);
    if (!found) return error("Não há partida sua para jogar nesta competição agora.");
    const info = Champ.describeMatch(data, found), bot = K.Bots.fromDict(info.opponent);
    const g = G.create(bot, info.color, "tournament", uid(), data.time_control);
    g.champ_id = row.id; g.champ_label = `${row.name} · ${info.label}`;
    const state = G.state(g);
    state.message = bot.sayTournament(info.where === "final" ? "final" : info.where === "group" ? "group" : "ko");
    return json(state);
  });
  route("POST", "/api/champ/<id>/forfeit", ({ params }) => {
    let row = ownRow("championships", params.id); if (!row) return error("Competição não encontrada.", 404);
    const live = G.findChampGame(row.id, uid());
    if (live) { G.resign(live); row = S.get("championships", row.id); }
    const data = CP.loads(row.data);
    if (data.player_status === "playing") { Champ.forfeit(data); Career.sync(currentPlayer(), row, data); }
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- despachante
  async function handle(method, url, init) {
    const u = new URL(url, "http://local/");
    let body = {}, form = null;
    const raw = init && init.body;
    if (raw instanceof FormData) form = raw;
    else if (typeof raw === "string" && raw) { try { body = JSON.parse(raw) || {}; } catch (_) { body = {}; } }
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(u.pathname);
      if (!m) continue;
      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      if (r.auth && !currentPlayer()) { delete S.meta.uid; return error("Faça login para continuar.", 401); }
      try { return await r.handler({ params, body, form, query: u.searchParams }); }
      catch (e) {
        if (e instanceof UserError) return error(e.message);
        console.error("[api]", method, u.pathname, e);
        return error("Erro interno: " + (e && e.message || e), 500);
      }
    }
    return error("Rota não encontrada: " + u.pathname, 404);
  }

  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });
  async function init() {
    await S.open();
    autoBackupIfDue();
    readyResolve(true);
  }

  function install() {
    const realFetch = root.fetch.bind(root);
    root.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || String(input);
      const path = new URL(url, root.location ? root.location.href : "http://local/").pathname;
      if (!path.startsWith("/api/")) return realFetch(input, init);
      await ready;
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      return handle(method, path + (url.includes("?") ? url.slice(url.indexOf("?")) : ""), init);
    };
    // o link "⬇️" dos backups é um <a href="/api/backups/NOME/download">: vira download do arquivo guardado no aparelho
    if (root.document) root.document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest('a[href^="/api/backups/"]');
      if (!a) return;
      const m = /^\/api\/backups\/([^/]+)\/download$/.exec(new URL(a.href).pathname);
      if (!m) return;
      e.preventDefault();
      const row = S.first("backups", r => r.name === decodeURIComponent(m[1]));
      if (!row) return;
      const cap = root.Capacitor && root.Capacitor.Plugins;                       // app Android: salva e abre o "Compartilhar"
      if (cap && cap.Filesystem && cap.Share) {
        cap.Filesystem.writeFile({ path: row.name, data: row.payload, directory: "CACHE", encoding: "utf8" })
          .then(r => cap.Share.share({ title: "Backup Nex-J Chess", text: "Backup do Nex-J Chess", url: r.uri, dialogTitle: "Guardar backup" }))
          .catch(err => alert("Não consegui compartilhar o backup: " + (err && err.message || err)));
        return;
      }
      const url = URL.createObjectURL(new Blob([row.payload], { type: "application/json" }));
      const dl = document.createElement("a"); dl.href = url; dl.download = row.name; document.body.appendChild(dl); dl.click(); dl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, true);
  }

  root.NJApi = { handle, init, install, ready, playerDict, APP_VERSION, routes };
})(typeof self !== "undefined" ? self : this);
