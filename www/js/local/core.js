/* Nex-J Chess (celular) — regras do jogo portadas do PC (core/*.py):
 * elo, classificação, ritmos de jogo, títulos, moedas, loja, missões/sequência, puzzles e bots. */
(function (root) {
  "use strict";
  const S = root.NJStore, U = root.NJUtil, D = root.NJData;
  const C = root.NexChess || (typeof require !== "undefined" ? require("../engine/chess.js") : null);

  const pyRound = x => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); };
  const jparse = (s, dflt) => { try { return s ? JSON.parse(s) : dflt; } catch (_) { return dflt; } };
  class UserError extends Error {}               // mensagem amigável para mostrar ao jogador

  // ======================================================================= elo
  const Elo = (() => {
    const PROVISIONAL_GAMES = 20, RATING_FLOOR = 300;
    const TIERS = [[800, "beginner", "Iniciante"], [1200, "intermediate", "Intermediário"], [1600, "advanced", "Avançado"],
      [2000, "expert", "Especialista"], [2400, "master", "Mestre"], [Infinity, "grandmaster", "Grande Mestre"]];
    const tierFor = r => { for (const [lim, key, name] of TIERS) if (r <= lim) return [key, name]; return [TIERS[5][1], TIERS[5][2]]; };
    const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
    const isProvisional = n => n < PROVISIONAL_GAMES;
    const kFactor = (r, n) => isProvisional(n) ? 40 : r < 2400 ? 20 : 10;
    function newRating(rating, opp, score, ratedGames) {
      const delta = pyRound(kFactor(rating, ratedGames) * (score - expected(rating, opp)));
      const updated = Math.max(RATING_FLOOR, rating + delta);
      return [updated, updated - rating];
    }
    return { PROVISIONAL_GAMES, RATING_FLOOR, TIERS, tierFor, expected, isProvisional, newRating };
  })();

  // ======================================================================= classificação
  const Placement = (() => {
    const START = 800, STEPS = [400, 300, 200, 100, 50], GAMES = 5, MAX_START = 2850;
    function info(p) {
      const done = !!p.placement_done, step = p.placement_step || 0;
      return { done, played: Math.min(step, GAMES), total: GAMES, next_rating: done ? null : (p.placement_target || START),
        next_color: done ? null : (step % 2 === 0 ? "white" : "black") };
    }
    function applyResult(p, score) {
      const step = p.placement_step || 0;
      let target = p.placement_target || START;
      const jump = STEPS[Math.min(step, GAMES - 1)];
      if (score === 1) target += jump; else if (score === 0) target -= jump;
      target = Math.max(Elo.RATING_FLOOR, Math.min(MAX_START, target));
      p.placement_target = target;
      p.placement_step = step + 1;
      const finished = p.placement_step >= GAMES;
      if (finished) { p.placement_done = true; p.rating = target; p.peak_rating = target; }
      return { played: p.placement_step, total: GAMES, done: finished, next_rating: finished ? null : target, final_rating: finished ? target : null };
    }
    function skipAsBeginner(p) { p.placement_done = true; p.placement_step = 0; p.rating = Elo.RATING_FLOOR; p.peak_rating = Elo.RATING_FLOOR; }
    return { START, STEPS, GAMES, MAX_START, info, applyResult, skipAsBeginner };
  })();

  // ======================================================================= ritmos
  const TimeControl = (() => {
    const TIME_CONTROLS = {
      none: [0, 0, "Sem tempo", "∞"], bullet: [60, 0, "Bullet 1 min", "🔫"], blitz: [120, 1, "Blitz 2 min +1s", "⚡"],
      rapid: [600, 0, "Rápida 10 min", "⏱️"], classic: [3600, 0, "Clássica 60 min", "🏛️"],
    };
    const get = key => TIME_CONTROLS[key] || TIME_CONTROLS.none;
    function label(base, inc) {
      for (const [key, [b, i, name, icon]] of Object.entries(TIME_CONTROLS)) if (b === base && i === inc) return [key, name, icon];
      return ["custom", `${Math.floor(base / 60)} min +${inc}s`, "⏱️"];
    }
    function botThinkBudget(base, remaining, ply) {
      let t;
      if (base < 180) t = Math.min(2.5, Math.max(0.2, remaining / 30));
      else if (base < 900) t = Math.min(6.0, Math.max(0.6, remaining / 35));
      else t = Math.min(12.0, Math.max(1.0, remaining / 40));
      if (ply < 8) t *= 0.4;
      t *= U.rnd.uniform(0.5, 1.4);
      return Math.max(0.1, Math.min(t, remaining * 0.5));
    }
    return { TIME_CONTROLS, get, label, botThinkBudget };
  })();

  // ======================================================================= moedas
  const Economy = (() => {
    const GAME_REWARDS = { rated: { win: 10, draw: 4, loss: 1 }, placement: { win: 10, draw: 4, loss: 1 }, casual: { win: 3, draw: 1, loss: 0 } };
    const BEAT_STRONGER_BONUS = 5, PUZZLE_FREE = 2, PUZZLE_DAILY = 5, TITLE_BONUS = 50;
    const KIND_LABELS = {
      game: ["Partidas", "♟️"], puzzle: ["Puzzles", "🧩"], mission: ["Missões", "📋"], streak: ["Sequência", "🔥"],
      tournament: ["Torneios", "🏆"], championship: ["Campeonatos", "🏟️"], title: ["Títulos", "🏅"], shop: ["Loja", "🛒"],
      njc: ["NexusJCoin", "🔗"], legacy: ["Saldo anterior", "📦"], admin: ["Ajuste", "⚙️"],
    };
    class NotEnoughCoins extends UserError {
      constructor(needed, balance) { super(`Moedas insuficientes: precisa de ${needed} 🪙 e você tem ${balance} 🪙.`); this.needed = needed; this.balance = balance; }
    }
    function tx(p, amount, kind, reason, ref) {
      return S.insert("coin_transactions", { player_id: p.id, amount, balance: p.coins, kind, reason: String(reason).slice(0, 120),
        ref: ref !== undefined && ref !== null ? String(ref) : null, created_at: U.nowIso() });
    }
    function credit(p, amount, kind, reason, ref) {
      amount = Math.trunc(amount);
      if (amount <= 0) return null;
      p.coins = (p.coins || 0) + amount;
      return tx(p, amount, kind, reason, ref);
    }
    function debit(p, amount, kind, reason, ref) {
      amount = Math.trunc(amount);
      if (amount <= 0) return null;
      if ((p.coins || 0) < amount) throw new NotEnoughCoins(amount, p.coins || 0);
      p.coins -= amount;
      return tx(p, -amount, kind, reason, ref);
    }
    function gameReward(p, session, ratingBefore, gameId) {
      const table = GAME_REWARDS[session.mode];
      if (!table || session.tournament_id) return 0;
      let total = 0;
      const base = table[session.outcome] || 0;
      const labels = { win: "Vitória", draw: "Empate", loss: "Participação" };
      const modeLabel = { rated: "ranqueada", placement: "de classificação", casual: "casual" }[session.mode];
      if (base) { credit(p, base, "game", `${labels[session.outcome]} em partida ${modeLabel} vs ${session.bot.name}`, gameId); total += base; }
      if (session.outcome === "win" && session.mode !== "casual" && session.bot.rating > ratingBefore) {
        credit(p, BEAT_STRONGER_BONUS, "game", `Bônus: venceu bot mais forte (${session.bot.rating})`, gameId); total += BEAT_STRONGER_BONUS;
      }
      return total;
    }
    const history = (p, limit = 60, offset = 0) =>
      S.where("coin_transactions", t => t.player_id === p.id).sort((a, b) => b.id - a.id).slice(offset, offset + limit);
    function totals(p) {
      const byKind = {};
      for (const t of S.where("coin_transactions", t => t.player_id === p.id)) byKind[t.kind] = (byKind[t.kind] || 0) + t.amount;
      let earned = 0, spent = 0;
      for (const [k, v] of Object.entries(byKind)) { if (v > 0 && k !== "shop" && k !== "njc") earned += v; if (v < 0) spent -= v; }
      return { by_kind: byKind, earned, spent };
    }
    const rules = () => [
      { icon: "🏆", text: "Vitória em ranqueada/classificação", coins: GAME_REWARDS.rated.win },
      { icon: "🤝", text: "Empate em ranqueada/classificação", coins: GAME_REWARDS.rated.draw },
      { icon: "♟️", text: "Derrota em ranqueada (participação)", coins: GAME_REWARDS.rated.loss },
      { icon: "💪", text: "Bônus: vencer bot com rating maior", coins: BEAT_STRONGER_BONUS },
      { icon: "☕", text: "Vitória em partida casual", coins: GAME_REWARDS.casual.win },
      { icon: "🧩", text: "Puzzle livre de primeira, sem dica", coins: PUZZLE_FREE },
      { icon: "📅", text: "Puzzle do dia resolvido", coins: PUZZLE_DAILY },
      { icon: "📋", text: "Missões diárias", coins: "15–40" },
      { icon: "🔥", text: "Sequência de 3 / 7 / 14 / 30 dias", coins: "30–500" },
      { icon: "🏅", text: "Novo título conquistado", coins: TITLE_BONUS },
      { icon: "🥇", text: "Torneios (prêmio pela colocação)", coins: "25–500" },
    ];
    return { GAME_REWARDS, BEAT_STRONGER_BONUS, PUZZLE_FREE, PUZZLE_DAILY, TITLE_BONUS, KIND_LABELS, NotEnoughCoins, credit, debit, gameReward, history, totals, rules };
  })();

  // ======================================================================= títulos
  const Titles = (() => {
    const TITLES = [["beginner", "Iniciante", 0, "🌱", "Todo mestre já foi iniciante."],
      ["intermediate", "Intermediário", 801, "♟️", "Já domina o básico e as primeiras táticas."],
      ["advanced", "Avançado", 1201, "⚔️", "Planos, táticas e finais sólidos."],
      ["expert", "Especialista", 1601, "🎯", "Força de jogador de clube experiente."],
      ["master", "Mestre", 2001, "👑", "Nível de mestre: poucos chegam aqui."],
      ["grandmaster", "Grande Mestre", 2401, "🏆", "O topo do Nex-J Chess."]];
    const BY_KEY = Object.fromEntries(TITLES.map(t => [t[0], t]));
    function award(p) {
      const owned = new Set(S.where("player_titles", t => t.player_id === p.id).map(t => t.key));
      const peak = Math.max(p.peak_rating || 0, p.rating || 0);
      const out = [];
      for (const [key, name, min, icon] of TITLES) {
        if (peak >= min && !owned.has(key)) { S.insert("player_titles", { player_id: p.id, key, achieved_at: U.nowIso() }); out.push({ key, name, icon }); }
      }
      return out;
    }
    function payBonus(p, newTitles) {
      for (const t of newTitles) { Economy.credit(p, Economy.TITLE_BONUS, "title", `Novo título: ${t.icon} ${t.name}`, t.key); t.coins = Economy.TITLE_BONUS; }
    }
    function forPlayer(p) {
      const owned = {};
      for (const t of S.where("player_titles", t => t.player_id === p.id)) owned[t.key] = t.achieved_at;
      return TITLES.map(([key, name, min, icon, desc]) => ({ key, name, min, icon, desc, unlocked: key in owned, date: key in owned ? U.local(owned[key]) : null }));
    }
    return { TITLES, BY_KEY, award, payBonus, forPlayer };
  })();

  // ======================================================================= loja e avatar
  const Shop = (() => {
    const CATALOG = D.CATALOG, BY_KEY = Object.fromEntries(CATALOG.map(i => [i.key, i]));
    const BOOL_FIELDS = new Set(["freckles", "earrings"]);
    const optVal = (field, v) => BOOL_FIELDS.has(field) ? v === "true" : v;
    const AVATAR = Object.fromEntries(Object.entries(D.AVATAR_OPTIONS).map(([f, list]) => [f, new Map(list.map(([v, need]) => [String(v), need]))]));
    const clubOf = p => jparse(p.club, null);
    const rarity = price => price < 150 ? "common" : price < 400 ? "rare" : price < 1000 ? "epic" : "legendary";
    function ownedKeys(p) {
      const keys = new Set(S.where("player_items", i => i.player_id === p.id).map(i => i.item_key));
      for (const i of CATALOG) if (i.price === 0) keys.add(i.key);
      return keys;
    }
    function equipped(p) {
      const eq = jparse(p.equipped, {});
      const out = Object.assign({}, D.DEFAULT_EQUIPPED);
      for (const [k, v] of Object.entries(eq || {})) if (v in BY_KEY) out[k] = v;
      return out;
    }
    function avatarOf(p) {
      if (!p.avatar) return null;
      const a = jparse(p.avatar, null);
      return a ? Object.assign({}, D.DEFAULT_AVATAR, a) : null;
    }
    function looks(p) {
      const eq = equipped(p);
      const out = { equipped: eq };
      for (const k of ["board", "pieces", "frame", "skin", "crest", "trail", "burst", "victory"]) out[k] = BY_KEY[eq[k]].data;
      out.avatar = avatarOf(p);
      return out;
    }
    function catalog(p) {
      const owned = ownedKeys(p), eq = equipped(p);
      const items = CATALOG.map(i => Object.assign({}, i, {
        rarity: rarity(i.price), desc: i.desc || D.DESCRIPTIONS[i.cat] || "",
        owned: i.cat !== "boost" ? owned.has(i.key) : false, equipped: eq[i.cat] === i.key,
        count: i.key === "streak_freeze" ? (p.streak_freezes || 0) : null, max: i.key === "streak_freeze" ? D.MAX_FREEZES : null,
      }));
      return { categories: D.CATEGORIES.map(([key, name, icon]) => ({ key, name, icon })), items, coins: p.coins || 0, looks: looks(p), club: clubOf(p) };
    }
    function setEquipped(p, cat, key) { const eq = equipped(p); eq[cat] = key; p.equipped = JSON.stringify(eq); }
    function buy(p, key) {
      const item = BY_KEY[key];
      if (!item) throw new UserError("Item não encontrado.");
      if (item.key === "streak_freeze") {
        if ((p.streak_freezes || 0) >= D.MAX_FREEZES) throw new UserError(`Você já tem ${D.MAX_FREEZES} protetores guardados (o máximo).`);
        Economy.debit(p, item.price, "shop", `Loja: ${item.name}`, key);
        p.streak_freezes = (p.streak_freezes || 0) + 1;
        return item;
      }
      if (ownedKeys(p).has(key)) throw new UserError("Você já tem esse item.");
      Economy.debit(p, item.price, "shop", `Loja: ${item.name}`, key);
      S.insert("player_items", { player_id: p.id, item_key: key, price: item.price, created_at: U.nowIso() });
      if (item.cat in D.DEFAULT_EQUIPPED) setEquipped(p, item.cat, key);
      return item;
    }
    function equip(p, key) {
      const item = BY_KEY[key];
      if (!item || !(item.cat in D.DEFAULT_EQUIPPED)) throw new UserError("Esse item não pode ser equipado.");
      if (!ownedKeys(p).has(key)) throw new UserError("Compre o item antes de usar.");
      setEquipped(p, item.cat, key);
      return item;
    }
    function saveAvatar(p, traits) {
      if (!traits || typeof traits !== "object" || Array.isArray(traits)) throw new UserError("Avatar inválido.");
      const owned = ownedKeys(p), clean = {};
      for (const [field, options] of Object.entries(AVATAR)) {
        const value = field in traits ? traits[field] : D.DEFAULT_AVATAR[field];
        if (!options.has(String(value))) throw new UserError(`Opção inválida no avatar (${field}).`);
        const need = options.get(String(value));
        if (need && !owned.has(need)) throw new UserError(`Compre "${BY_KEY[need].name}" na loja para usar essa opção.`);
        clean[field] = value;
      }
      p.avatar = JSON.stringify(clean);
      return clean;
    }
    function avatarOptions(p) {
      const owned = ownedKeys(p), out = {};
      for (const [field, opts] of Object.entries(AVATAR)) {
        out[field] = [...opts].map(([v, need]) => ({ v: optVal(field, v), locked: !!(need && !owned.has(need)), item: need, price: need ? BY_KEY[need].price : 0 }));
      }
      return out;
    }
    return { CATALOG, BY_KEY, rarity, ownedKeys, equipped, avatarOf, looks, catalog, buy, equip, saveAvatar, avatarOptions, DEFAULT_AVATAR: D.DEFAULT_AVATAR };
  })();

  // ======================================================================= puzzles
  const Puzzles = (() => {
    const LEVELS = { easy: ["Fácil", -250], medium: ["Médio", 0], hard: ["Difícil", 250] };
    const bank = () => root.NJPuzzles || [];
    const get = pid => { const b = bank(); return pid >= 0 && pid < b.length ? b[pid] : null; };
    function pickNear(rating, exclude = new Set(), rng = U.rnd, spread = 150) {
      const b = bank();
      if (!b.length) return null;
      for (const width of [spread, spread * 2, spread * 4, 5000]) {
        const pool = b.filter(p => Math.abs(p.rating - rating) <= width && !exclude.has(p.id));
        if (pool.length) return rng.choice(pool);
      }
      return rng.choice(b);
    }
    const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
    function newPuzzleRating(playerRating, puzzleRating, solved, attempts) {
      const k = attempts < 20 ? 40 : 24;
      const delta = pyRound(k * ((solved ? 1 : 0) - expected(playerRating, puzzleRating)));
      return [Math.max(100, playerRating + delta), delta];
    }
    const sessions = new Map();
    function start(playerId, puzzle, dailyDate = null, dailyIndex = null) {
      const token = U.uuid() + U.uuid().slice(0, 0);
      const s = { token, player_id: playerId, pid: puzzle.id, board: new C.Board(puzzle.fen), step: 0, failed: false, hinted: false, done: false,
        daily_date: dailyDate, daily_index: dailyIndex, created: Date.now() };
      const now = Date.now();
      for (const [t, v] of sessions) if (now - v.created > 3 * 3600 * 1000) sessions.delete(t);
      sessions.set(token, s);
      return s;
    }
    const getSession = (token, playerId) => { const s = sessions.get(token); return s && s.player_id === playerId ? s : null; };
    function stateOf(s, extra) {
      const b = s.board, p = get(s.pid);
      const last = b.moveStack.length ? b.uci(b.moveStack[b.moveStack.length - 1]) : null;
      const out = {
        token: s.token, pid: s.pid, fen: b.fen(), legal: s.done ? [] : b.legalMoves().map(m => b.uci(m)),
        side: p.side, last_move: last, check: b.inCheck() ? C.sqName(b.king(b.turn)) : null,
        done: s.done, failed: s.failed, hinted: s.hinted, rating: p.rating, daily: s.daily_date !== null,
        moves_total: Math.floor((p.moves.length + 1) / 2), moves_done: Math.floor((s.step + 1) / 2),
      };
      if (s.done) { out.theme = p.theme; out.theme_label = p.theme_label; }
      return Object.assign(out, extra || {});
    }
    function tryMove(s, uci) {
      const p = get(s.pid), sol = p.moves, b = s.board;
      const move = b.moveFromUci(uci);
      if (!move) return ["wrong", {}];
      b.push(move);
      const mateOk = b.isCheckmate();
      b.pop();
      if (uci !== sol[s.step] && !mateOk) { s.failed = true; return ["wrong", { wrong: uci }]; }
      b.push(move);
      s.step++;
      if (mateOk || s.step >= sol.length) { s.done = true; return ["solved", {}]; }
      const reply = b.moveFromUci(sol[s.step]);
      b.push(reply);
      s.step++;
      if (s.step >= sol.length) { s.done = true; return ["solved", { reply: sol[s.step - 1] }]; }
      return ["correct", { reply: sol[s.step - 1] }];
    }
    function hint(s) {
      const p = get(s.pid), uci = p.moves[s.step];
      const from = C.sqFrom(uci.slice(0, 2)), piece = s.board.pieceAt(from);
      s.hinted = true;
      return { square: uci.slice(0, 2), text: piece ? `💡 Mexa ${root.NJCoach.pname(piece.type)} de ${uci.slice(0, 2)}.` : "💡 Pense bem..." };
    }
    function solution(s) {
      const p = get(s.pid), b = s.board, steps = [];
      while (s.step < p.moves.length) {
        const mv = b.moveFromUci(p.moves[s.step]);
        const san = b.san(mv);
        b.push(mv); s.step++;
        steps.push({ uci: p.moves[s.step - 1], san, fen: b.fen() });
      }
      s.failed = true; s.done = true;
      return steps;
    }
    return { LEVELS, bank, get, pickNear, expected, newPuzzleRating, sessions, start, getSession, stateOf, tryMove, hint, solution };
  })();

  // ======================================================================= missões, sequência, puzzles do dia
  const Daily = (() => {
    const MISSIONS = {
      win_rated: ["Vença 1 partida ranqueada", 1, 30, "🏆"], play_games: ["Jogue 3 partidas (qualquer modo)", 3, 20, "♟️"],
      solve_puzzles: ["Resolva 5 puzzles", 5, 25, "🧩"], daily_puzzles: ["Resolva os 3 puzzles do dia", 3, 30, "📅"],
      training_game: ["Termine uma partida de treino", 1, 20, "🎓"], accuracy80: ["Tenha 80% de precisão numa partida analisada", 1, 40, "🎯"],
      castle: ["Faça o roque em 2 partidas", 2, 15, "🏰"], checkmate: ["Vença por xeque-mate", 1, 35, "👑"],
      beat_stronger: ["Vença um bot com rating maior que o seu", 1, 40, "💪"], timed_game: ["Jogue uma partida com relógio", 1, 15, "⏱️"],
    };
    const STREAK_BONUS = { 3: 30, 7: 100, 14: 200, 30: 500 };
    const MAX_REROLLS = 1, REROLL_PRICE = 20;
    const today = () => U.todayStr();
    const mission = key => ({ key, text: MISSIONS[key][0], target: MISSIONS[key][1], reward: MISSIONS[key][2], icon: MISSIONS[key][3], progress: 0, done: false });

    function missedDays(p) {
      if (!p.last_active) return null;
      return Math.max(0, U.daysBetween(p.last_active, today()) - 1);
    }
    function currentStreak(p) {
      const missed = missedDays(p);
      if (missed === null) return 0;
      return missed === 0 || missed <= (p.streak_freezes || 0) ? (p.streak || 0) : 0;
    }
    function getSet(p) {
      const d = today();
      const row = S.first("daily_sets", r => r.player_id === p.id && r.day === d);
      if (row) return row;
      const rng = U.Rng(`${p.id}-${d}`);
      const doneIds = new Set(S.where("puzzle_attempts", a => a.player_id === p.id).map(a => a.puzzle_id));
      const base = p.puzzle_rating || p.rating || 800;
      const chosen = new Set(doneIds), items = [];
      for (const [level, [label, offset]] of Object.entries(Puzzles.LEVELS)) {
        const pz = Puzzles.pickNear(base + offset, chosen, rng, 120);
        if (pz) { chosen.add(pz.id); items.push({ id: pz.id, level, label, rating: pz.rating, side: pz.side, status: "pending" }); }
      }
      const keys = rng.sample(Object.keys(MISSIONS), 3);
      return S.insert("daily_sets", { player_id: p.id, day: d, puzzles: JSON.stringify(items), missions: JSON.stringify(keys.map(mission)), rerolls: 0 });
    }
    function markActive(p) {
      const d = today();
      if (p.last_active === d) return null;
      const missed = missedDays(p);
      let used = 0;
      if (missed !== null && missed === 0) p.streak = (p.streak || 0) + 1;
      else if (missed !== null && missed <= (p.streak_freezes || 0)) { used = missed; p.streak_freezes -= missed; p.streak = (p.streak || 0) + 1; }
      else p.streak = 1;
      p.last_active = d;
      p.streak_best = Math.max(p.streak_best || 0, p.streak);
      const bonus = STREAK_BONUS[p.streak];
      let out = used ? { days: p.streak, coins: 0, freezes_used: used } : null;
      if (bonus) { Economy.credit(p, bonus, "streak", `Sequência de ${p.streak} dias seguidos`); out = { days: p.streak, coins: bonus, freezes_used: used }; }
      return out;
    }
    function progress(p, key, amount = 1) {
      const row = getSet(p), missions = JSON.parse(row.missions);
      let completed = null;
      for (const m of missions) {
        if (m.key === key && !m.done) {
          m.progress = Math.min(m.target, m.progress + amount);
          if (m.progress >= m.target) { m.done = true; Economy.credit(p, m.reward, "mission", `Missão: ${m.text}`, key); completed = m; }
        }
      }
      row.missions = JSON.stringify(missions);
      return completed;
    }
    function rerollMission(p, key) {
      const row = getSet(p), missions = JSON.parse(row.missions);
      const idx = missions.findIndex(m => m.key === key);
      if (idx < 0) throw new UserError("Missão não encontrada.");
      if (missions[idx].done) throw new UserError("Essa missão já foi concluída.");
      if ((row.rerolls || 0) >= MAX_REROLLS) throw new UserError("Você já trocou uma missão hoje. Amanhã tem mais!");
      const used = new Set(missions.map(m => m.key));
      const options = Object.keys(MISSIONS).filter(k => !used.has(k));
      missions[idx] = mission(U.rnd.choice(options));
      row.missions = JSON.stringify(missions);
      row.rerolls = (row.rerolls || 0) + 1;
      return missions[idx];
    }
    const evMission = m => ({ type: "mission", text: m.text, reward: m.reward, icon: m.icon });
    function onGameFinished(p, session, ratingBefore) {
      const events = [];
      const streak = markActive(p);
      if (streak) events.push(Object.assign({ type: "streak" }, streak));
      const add = (key, n = 1) => { const m = progress(p, key, n); if (m) events.push(evMission(m)); };
      const won = session.outcome === "win";
      add("play_games");
      if (won && (session.mode === "rated" || session.mode === "tournament")) add("win_rated");
      if (session.mode === "training") add("training_game");
      if (won && session.termination === "Xeque-mate") add("checkmate");
      if (won && session.bot.rating > ratingBefore) add("beat_stronger");
      if (session.tc_base) add("timed_game");
      const b = session.board;
      if (b.moveStack.some((m, i) => (i % 2) === session.player_color && b.isCastling(m))) add("castle");
      return events;
    }
    function onAnalysis(p, accuracy) { return accuracy !== null && accuracy !== undefined && accuracy >= 80 ? progress(p, "accuracy80") : null; }
    function onPuzzleFinished(p, puzzleId, solved, hinted, dailyIndex) {
      const events = [];
      const firstTry = !S.first("puzzle_attempts", a => a.player_id === p.id && a.puzzle_id === puzzleId);
      const pz = Puzzles.get(puzzleId);
      const before = p.puzzle_rating || 800;
      let after = before, delta = 0;
      const isDaily = dailyIndex !== null && dailyIndex !== undefined;
      if (firstTry && !isDaily && !(hinted && solved)) {
        [after, delta] = Puzzles.newPuzzleRating(before, pz.rating, solved, p.puzzle_attempts || 0);
        p.puzzle_rating = after;
        p.puzzle_attempts = (p.puzzle_attempts || 0) + 1;
      }
      S.insert("puzzle_attempts", { player_id: p.id, puzzle_id: puzzleId, solved, hinted, daily: isDaily, rating_before: before, rating_after: after, created_at: U.nowIso() });
      if (solved && firstTry && !hinted && !isDaily) Economy.credit(p, Economy.PUZZLE_FREE, "puzzle", `Puzzle #${puzzleId} resolvido de primeira`, puzzleId);
      if (solved) {
        const streak = markActive(p);
        if (streak) events.push(Object.assign({ type: "streak" }, streak));
        const m = progress(p, "solve_puzzles");
        if (m) events.push(evMission(m));
      }
      if (isDaily) {
        const row = getSet(p), items = JSON.parse(row.puzzles);
        if (dailyIndex >= 0 && dailyIndex < items.length && items[dailyIndex].id === puzzleId && items[dailyIndex].status === "pending") {
          items[dailyIndex].status = solved ? "solved" : "failed";
          row.puzzles = JSON.stringify(items);
          if (solved) {
            Economy.credit(p, Economy.PUZZLE_DAILY, "puzzle", `Puzzle do dia (${items[dailyIndex].label}) resolvido`, puzzleId);
            const m = progress(p, "daily_puzzles");
            if (m) events.push(evMission(m));
          }
        }
      }
      return { rating_before: before, rating_after: after, delta, first_try: firstTry, events };
    }
    function overview(p) {
      const row = getSet(p);
      const attempts = S.where("puzzle_attempts", a => a.player_id === p.id);
      return {
        day: row.day, puzzles: JSON.parse(row.puzzles), missions: JSON.parse(row.missions), streak: currentStreak(p),
        streak_best: p.streak_best || 0, active_today: p.last_active === today(), streak_bonus: STREAK_BONUS,
        puzzle_rating: p.puzzle_rating || 800, puzzles_solved: attempts.filter(a => a.solved).length, puzzles_tried: attempts.length,
        coins: p.coins || 0, bank_size: Puzzles.bank().length, streak_freezes: p.streak_freezes || 0,
        rerolls_left: Math.max(0, MAX_REROLLS - (row.rerolls || 0)), reroll_price: REROLL_PRICE,
      };
    }
    return { MISSIONS, STREAK_BONUS, MAX_REROLLS, REROLL_PRICE, getSet, markActive, progress, rerollMission, onGameFinished, onAnalysis, onPuzzleFinished, overview, currentStreak };
  })();

  // ======================================================================= bots
  const Bots = (() => {
    const LEVELS = [["beginner", "Iniciante", 300, 800], ["intermediate", "Intermediário", 801, 1200], ["advanced", "Avançado", 1201, 1600],
      ["expert", "Especialista", 1601, 2000], ["master", "Mestre", 2001, 2400], ["grandmaster", "Grande Mestre", 2401, 2850]];
    const PERSONALITIES = {
      agressivo: { label: "Agressivo", icon: "🔥", desc: "Parte pra cima do rei sem pensar duas vezes." },
      solido: { label: "Sólido", icon: "🛡️", desc: "Defende tudo, erra pouco e espera o seu erro." },
      tatico: { label: "Tático", icon: "⚡", desc: "Vive de golpes, capturas e combinações." },
      posicional: { label: "Posicional", icon: "🧠", desc: "Domina o centro e sufoca devagar." },
      criativo: { label: "Criativo", icon: "🎲", desc: "Imprevisível. Lances estranhos que às vezes funcionam." },
    };
    const COACH_PERSONALITY = { label: "Professor", icon: "🎓", desc: "Joga no seu nível, explica cada lance e deixa você pedir dica e voltar lance." };
    const RANDOM_PERSONALITIES = Object.keys(PERSONALITIES);
    PERSONALITIES.professor = COACH_PERSONALITY;
    const NAME_POOLS = [
      ["🇧🇷", ["Rafael", "Lucas", "Mariana", "Beatriz", "Thiago", "Camila", "Diego", "Júlia", "Pedro", "Larissa", "Gustavo", "Fernanda", "Bruno", "Aline", "Caio", "Letícia", "Mateus", "Renata"],
        ["Silva", "Souza", "Oliveira", "Costa", "Almeida", "Ribeiro", "Carvalho", "Mendes", "Barbosa", "Rocha", "Moreira", "Teixeira", "Cardoso", "Nogueira"]],
      ["🇵🇹", ["João", "Inês", "Tiago", "Mafalda", "Duarte", "Carolina"], ["Ferreira", "Pereira", "Santos", "Martins", "Lopes", "Gonçalves"]],
      ["🇦🇷", ["Martín", "Sofía", "Facundo", "Valentina", "Joaquín", "Lucía"], ["González", "Fernández", "Rodríguez", "López", "Díaz", "Romero"]],
      ["🇪🇸", ["Alejandro", "Paula", "Sergio", "Marta", "Javier", "Elena"], ["García", "Martínez", "Sánchez", "Navarro", "Torres", "Ruiz"]],
      ["🇺🇸", ["Michael", "Emily", "Ryan", "Olivia", "Tyler", "Hannah"], ["Johnson", "Miller", "Davis", "Anderson", "Clark", "Walker"]],
      ["🇷🇺", ["Dmitri", "Anastasia", "Ivan", "Ekaterina", "Sergei", "Olga"], ["Petrov", "Smirnov", "Volkov", "Kuznetsov", "Morozov", "Popov"]],
      ["🇮🇳", ["Arjun", "Priya", "Vikram", "Ananya", "Rohan", "Kavya"], ["Sharma", "Patel", "Iyer", "Reddy", "Nair", "Gupta"]],
      ["🇳🇴", ["Magnus", "Ingrid", "Henrik", "Sigrid"], ["Hansen", "Johansen", "Larsen", "Berg"]],
      ["🇫🇷", ["Julien", "Camille", "Hugo", "Léa", "Antoine"], ["Dubois", "Moreau", "Laurent", "Lefèvre", "Girard"]],
      ["🇩🇪", ["Lukas", "Hannah", "Felix", "Lena"], ["Müller", "Schmidt", "Weber", "Wagner"]],
      ["🇨🇳", ["Wei", "Li Na", "Hao", "Mei"], ["Wang", "Zhang", "Liu", "Chen"]],
    ];
    const AVATAR_COLORS = ["#d4a843", "#4f8cff", "#e2555a", "#39b385", "#9b6cf0", "#e98b3a", "#2bb3c0", "#d25ca6"];
    const CHAT = {
      professor: {
        greet: ["Oi! Eu sou o Treinador Nex. Vamos jogar e aprender juntos. Pode pedir dica quando quiser!", "Bora treinar! Jogo no seu nível e comento seus lances. Sem pressa e sem rating.", "Olá! Hoje a aula é na prática. Pense antes de cada lance: o que o meu último lance ameaça?"],
        capture: ["Peguei essa peça. Ela estava defendida?", "Captura! Sempre confira se suas peças estão protegidas.", "Opa, essa ficou sem defesa."],
        lost_piece: ["Boa! Você achou a captura.", "Muito bem, ganhou material!", "Isso aí, peça a mais é vantagem."],
        check: ["Xeque! Três saídas: mover o rei, bloquear ou capturar quem dá xeque.", "Xeque! Qual a melhor defesa?"],
        win: ["Dessa vez ganhei, mas você aprendeu muito. Veja a análise para entender os momentos-chave!", "Boa partida! Abra a análise e veja onde a partida virou."],
        lose: ["Parabéns, você me venceu! Está evoluindo. 👏", "Ganhou do treinador! Agora tente uma ranqueada."],
        draw: ["Empate! Bom trabalho defensivo.", "Empatamos. Na análise dá pra ver onde havia vitória."],
      },
      agressivo: {
        greet: ["Prepara o rei, que eu vou atacar.", "Espero que você goste de sacrifícios!", "Sem enrolação: vamos pro ataque."],
        capture: ["Uma a menos!", "Isso é só o começo.", "Rrrá! Peguei."], lost_piece: ["Tudo bem, material é detalhe.", "Foi investimento, confia.", "Hmm... não era pra ser assim."],
        check: ["Xeque! Corre, rei!", "Sente a pressão?", "Xeque! E vem mais."], win: ["Ataque é a melhor defesa. GG!", "Falei que ia pra cima!"],
        lose: ["Você aguentou o ataque... respeito.", "Bem jogado. Na próxima eu venho com mais fogo."], draw: ["Empate? Queria sangue, mas ok.", "Dividimos o ponto. Da próxima não escapa."],
      },
      solido: {
        greet: ["Boa partida. Vamos com calma.", "Que vença quem errar menos.", "Olá! Jogo limpo e paciência."],
        capture: ["Obrigado pela peça.", "Anotado.", "Sem pressa, mas aceito."], lost_piece: ["Bem visto.", "Hm, preciso me reorganizar.", "Ok, vou consolidar."],
        check: ["Xeque.", "Só um xequezinho.", "Xeque, com calma."], win: ["Paciência vence. Boa partida!", "Obrigado pelo jogo, foi uma boa luta."],
        lose: ["Muito bem jogado, parabéns.", "Você foi mais preciso hoje."], draw: ["Empate justo.", "Resultado equilibrado, bom jogo."],
      },
      tatico: {
        greet: ["Tô vendo combinações em todo lugar hoje.", "Cuidado com os garfos!", "Vamos calcular?"],
        capture: ["Calculei isso 5 lances atrás.", "Tática pura!", "Viu o golpe?"], lost_piece: ["Opa, não vi essa.", "Boa tática!", "Hmm, errei a conta."],
        check: ["Xeque! E olha o que vem depois...", "Xeque com ideia.", "Xeque. Conta aí as variantes."], win: ["As táticas não mentem. GG!", "Combinação final! Boa partida."],
        lose: ["Você calculou melhor. Parabéns!", "Essa eu não vi vindo. Bem jogado."], draw: ["Empate. Tudo se anulou.", "Ninguém achou o golpe decisivo."],
      },
      posicional: {
        greet: ["Controle do centro é tudo.", "Vamos construir devagar.", "Estrutura de peões é destino."],
        capture: ["Uma melhora estrutural.", "Peça ganha, posição melhor.", "Faz sentido."], lost_piece: ["Compensação posicional, talvez.", "Hmm, minha estrutura sofreu.", "Interessante."],
        check: ["Xeque, com ganho de tempo.", "Xeque. Só melhorando a posição.", "Xeque."], win: ["A pressão acumulada decidiu. Boa partida!", "Estratégia vence. GG."],
        lose: ["Você entendeu melhor a posição. Parabéns.", "Belo plano, bem executado."], draw: ["Posição equilibrada, empate lógico.", "Estruturas simétricas, resultado justo."],
      },
      criativo: {
        greet: ["Hoje eu vou jogar umas coisas diferentes 😄", "Regras de abertura? Nunca ouvi falar.", "Vamos nos divertir!"],
        capture: ["Surpresa!", "Hehe, essa foi arte.", "Nem eu esperava isso."], lost_piece: ["Era parte do plano. Acho.", "Arte exige sacrifícios.", "Ops! Tudo bem."],
        check: ["Xeque criativo!", "Xeque! Gostou?", "Tcharam, xeque!"], win: ["Caos vence! GG!", "O imprevisível funcionou!"],
        lose: ["Minha arte não foi compreendida... parabéns!", "Você domou o caos. Bem jogado!"], draw: ["Empate artístico.", "Uma obra inacabada. Empate!"],
      },
    };
    const TOURNAMENT_CHAT = {
      greet_group: ["Que vença o melhor!", "Preciso desses pontos no grupo.", "Bora, a tabela está apertada!", "Boa sorte. Vou precisar dela também.", "Só os dois primeiros passam... foco!"],
      greet_ko: ["Mata-mata: só um de nós continua.", "Daqui ninguém sai sem briga!", "Partida única. Sem segunda chance!", "Chegamos longe, hein? Agora é tudo ou nada.", "Lembre: empate é das pretas!"],
      greet_final: ["A final! Que partida vai ser essa.", "O troféu está logo ali...", "Final é final. Vamos!"],
    };
    const FIELDS = ["id", "name", "flag", "rating", "level", "level_name", "personality", "personality_label", "personality_icon", "personality_desc", "avatar_color", "initials"];
    class Bot {
      constructor(d) { for (const k of FIELDS) if (k in d) this[k] = d[k]; }
      toDict() { const o = {}; for (const k of FIELDS) o[k] = this[k]; return o; }
      sayTournament(stage) { return U.rnd.choice(TOURNAMENT_CHAT[stage === "final" ? "greet_final" : stage === "group" ? "greet_group" : "greet_ko"]); }
      say(event, chance = 1.0) {
        if (U.rnd.random() > chance) return null;
        const lines = (CHAT[this.personality] || {})[event];
        return lines ? U.rnd.choice(lines) : null;
      }
    }
    const fromDict = d => new Bot(d);
    function levelRange(key) { for (const l of LEVELS) if (l[0] === key) return l; throw new Error("Nível desconhecido: " + key); }
    function generate(levelKey, playerRating, exactRating) {
      let rating;
      if (exactRating !== undefined && exactRating !== null) rating = Math.trunc(exactRating);
      else if (!levelKey || levelKey === "auto") rating = Math.max(300, Math.min(2850, (playerRating || 800) + U.rnd.randint(-100, 100)));
      else { const [, , lo, hi] = levelRange(levelKey); rating = U.rnd.randint(lo, hi); }
      const [level, levelName] = Elo.tierFor(rating);
      const [flag, firsts, lasts] = U.rnd.choice(NAME_POOLS);
      const first = U.rnd.choice(firsts), last = U.rnd.choice(lasts);
      const personality = U.rnd.choice(RANDOM_PERSONALITIES), p = PERSONALITIES[personality];
      return new Bot({ id: U.uuid().slice(0, 8), name: `${first} ${last}`, flag, rating, level, level_name: levelName, personality,
        personality_label: p.label, personality_icon: p.icon, personality_desc: p.desc, avatar_color: U.rnd.choice(AVATAR_COLORS),
        initials: (first[0] + last[0]).toUpperCase() });
    }
    function coach(playerRating) {
      const rating = Math.max(300, Math.min(2850, (playerRating || 800) - 50));
      const [level, levelName] = Elo.tierFor(rating), p = COACH_PERSONALITY;
      return new Bot({ id: "coachnex", name: "Treinador Nex", flag: "🎓", rating, level, level_name: levelName, personality: "professor",
        personality_label: p.label, personality_icon: p.icon, personality_desc: p.desc, avatar_color: "#2e7d5b", initials: "TN" });
    }
    return { LEVELS, PERSONALITIES, NAME_POOLS, Bot, fromDict, generate, coach, levelRange };
  })();

  root.NJCore = { pyRound, jparse, UserError, Elo, Placement, TimeControl, Economy, Titles, Shop, Puzzles, Daily, Bots };
})(typeof self !== "undefined" ? self : this);
