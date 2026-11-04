/* Nex-J Chess (celular) — gerenciador das partidas em andamento (porta de core/game_manager.py). */
(function (root) {
  "use strict";
  const C = root.NexChess, S = root.NJStore, U = root.NJUtil, K = root.NJCore, Coach = root.NJCoach, E = () => root.NexEngine;
  const { WHITE, BLACK } = C;
  const { UserError } = K;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const TERMINATIONS = { CHECKMATE: "Xeque-mate", STALEMATE: "Afogamento", INSUFFICIENT_MATERIAL: "Material insuficiente", SEVENTYFIVE_MOVES: "Regra dos 75 lances",
    FIVEFOLD_REPETITION: "Repetição quíntupla", FIFTY_MOVES: "Regra dos 50 lances", THREEFOLD_REPETITION: "Repetição tripla" };
  const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 }, VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  const games = new Map();
  const hooks = { tournament: null, champ: null };     // a etapa 3 liga aqui torneios e campeonatos
  const now = () => U.nowSec();

  function findTournamentGame(tid, pid) { for (const s of games.values()) if (s.tournament_id === tid && s.player_id === pid && !s.over) return s; return null; }
  function findChampGame(cid, pid) { for (const s of games.values()) if (s.champ_id === cid && s.player_id === pid && !s.over) return s; return null; }

  function create(bot, color, mode, playerId, tcKey = "none", coach = false) {
    if (color === "random") color = U.rnd.choice(["white", "black"]);
    if (mode === "training") tcKey = "none";
    const [base, inc] = K.TimeControl.get(tcKey);
    const s = {
      id: U.uuid(), bot, player_color: color === "white" ? WHITE : BLACK, rated: mode === "rated" || mode === "tournament", player_id: playerId, mode,
      board: new C.Board(), over: false, result: "*", outcome: "", termination: "", rating_change: 0, rating_after: 0, db_id: 0,
      placement_info: null, new_titles: null, tc_base: base, tc_inc: inc, clock: [base, base], turn_started: now(),
      tournament_id: 0, tournament_label: "", tournament_info: null, champ_id: 0, champ_label: "",
      coach: !!coach && mode !== "tournament", coach_log: {}, hints_used: 0, takebacks: 0, daily_events: null, coins_earned: 0, created: now(),
    };
    for (const [id, g] of games) if (now() - g.created > 6 * 3600) games.delete(id);
    games.set(s.id, s);
    return s;
  }
  function get(id, playerId) { const s = games.get(id); return s && (playerId === undefined || s.player_id === playerId) ? s : null; }

  // ---------------------------------------------------------------- relógio (só corre depois do 1º lance de cada lado)
  const clockRunning = s => s.tc_base > 0 && !s.over && s.board.moveStack.length >= 2;
  function remaining(s, color) {
    if (!s.tc_base) return null;
    let left = s.clock[color];
    if (clockRunning(s) && s.board.turn === color) left -= now() - s.turn_started;
    return Math.max(0, left);
  }
  function flagIfNeeded(s) {
    if (s.over || !clockRunning(s)) return false;
    const color = s.board.turn;
    if (remaining(s, color) > 0) return false;
    s.clock[color] = 0;
    const winner = color ^ 1;
    if (!s.board.hasInsufficientMaterial(winner)) finish(s, winner === WHITE ? "1-0" : "0-1", "Tempo esgotado");
    else finish(s, "1/2-1/2", "Tempo esgotado (material insuficiente)");
    return true;
  }
  function chargeClock(s, color) {
    if (!s.tc_base) return;
    if (s.board.moveStack.length >= 2) { s.clock[color] -= now() - s.turn_started; s.clock[color] = Math.max(0, s.clock[color]) + s.tc_inc; }
    s.turn_started = now();
  }
  const checkFlag = s => flagIfNeeded(s);

  // ---------------------------------------------------------------- lances
  async function playerMove(s, uci) {
    if (s.over) throw new UserError("A partida já terminou.");
    if (s.board.turn !== s.player_color) throw new UserError("Não é a sua vez.");
    if (flagIfNeeded(s)) return { san: null, uci: null, message: null, flagged: true };
    const move = s.board.moveFromUci(uci);
    if (!move) throw new UserError("Lance ilegal.");
    const captured = s.board.isCapture(move), san = s.board.san(move);
    const before = new C.Board(s.board.fen());
    const plyBefore = s.board.moveStack.length;
    const evBefore = s.coach ? await E().quickEval(s.board) : null;
    if (s.over) throw new UserError("A partida já terminou.");
    chargeClock(s, s.player_color);
    s.board.push(move);
    let comment = null;
    if (s.coach) {
      const evAfter = await E().quickEval(s.board);
      try {
        comment = Coach.commentPlayerMove(before, before.moveFromUci(uci), evBefore, evAfter, plyBefore);
        s.coach_log[s.board.moveStack.length] = comment;
      } catch (e) { console.warn("[treinador]", e); }
      s.turn_started = now();      // o tempo do treinador não conta no relógio do bot
    }
    const message = captured ? s.bot.say("lost_piece", 0.3) : null;
    checkEnd(s);
    return { san, uci, message, coach: comment };
  }

  async function botMove(s) {
    if (s.over) throw new UserError("A partida já terminou.");
    if (s.board.turn === s.player_color) throw new UserError("É a vez do jogador.");
    const botColor = s.player_color ^ 1;
    let budget = null;
    if (s.tc_base) budget = K.TimeControl.botThinkBudget(s.tc_base, remaining(s, botColor), s.board.moveStack.length);
    let move = await E().chooseMove(s.board, s.bot, budget);
    if (!move) { const l = s.board.legalMoves(); move = l[(Math.random() * l.length) | 0]; }
    if (budget && clockRunning(s)) {            // o bot "pensa" como uma pessoa: espera até completar o tempo planejado
      const wait = s.turn_started + budget - now();
      if (wait > 0) await sleep(wait * 1000);
    }
    if (s.over) throw new UserError("A partida já terminou.");
    if (flagIfNeeded(s)) return { san: null, uci: null, message: null, flagged: true };
    const captured = s.board.isCapture(move), san = s.board.san(move), uci = s.board.uci(move);
    chargeClock(s, botColor);
    s.board.push(move);
    let message = null;
    if (s.board.inCheck()) message = s.bot.say("check", 0.4);
    else if (captured) message = s.bot.say("capture", 0.3);
    checkEnd(s);
    let warning = null;
    if (s.coach && !s.over) {
      try { warning = Coach.warnAfterBotMove(s.board, move, s.player_color, s.bot.name); } catch (e) { console.warn("[treinador]", e); }
    }
    return { san, uci, message, warning, captured };
  }

  // ---------------------------------------------------------------- treino
  async function hint(s, level = 1) {
    if (s.mode !== "training") throw new UserError("Dicas só no modo Treino.");
    if (s.over || s.board.turn !== s.player_color) throw new UserError("Espere a sua vez.");
    const ev = await E().quickEval(s.board, 16, 0.8);
    const best = ev.best ? s.board.moveFromUci(ev.best) : 0;
    if (!best) throw new UserError("Sem dica para esta posição.");
    s.hints_used++;
    const from = best & 63, to = (best >> 6) & 63, piece = s.board.pieceAt(from);
    const pn = piece ? Coach.pname(piece.type, false) : "peça";
    if (level <= 1) return { level: 1, square: C.sqName(from), text: `💡 Dica: pense num lance com o seu ${pn} de ${C.sqName(from)}.` };
    const san = s.board.san(best);
    let why = "";
    if (s.board.isCapture(best)) why = " — ganha material.";
    else if (s.board.givesCheck(best)) why = " — com xeque!";
    return { level: 2, arrow: [C.sqName(from), C.sqName(to)], text: `💡 O melhor lance é ${san}${why}` };
  }
  function takeback(s) {
    if (s.mode !== "training") throw new UserError("Voltar lance só no modo Treino.");
    if (s.over) throw new UserError("A partida já terminou.");
    const b = s.board;
    let undone;
    if (b.turn === s.player_color) {
      if (b.moveStack.length < 2) throw new UserError("Não há lance seu para voltar.");
      b.pop(); b.pop(); undone = 2;
    } else {
      if (!b.moveStack.length) throw new UserError("Não há lance para voltar.");
      b.pop(); undone = 1;
    }
    for (const k of Object.keys(s.coach_log)) if (+k > b.moveStack.length) delete s.coach_log[k];
    s.takebacks++;
    return undone;
  }

  // ---------------------------------------------------------------- fim de jogo
  function resign(s) {
    if (s.over) throw new UserError("A partida já terminou.");
    const winner = s.player_color ^ 1;
    finish(s, winner === WHITE ? "1-0" : "0-1", "Desistência");
  }
  async function offerDraw(s) {
    if (s.over) throw new UserError("A partida já terminou.");
    const b = s.board;
    if (b.fullmove < 15) return [false, "Ainda é cedo pra empate. Vamos jogar!"];
    let score = await E().evaluate(b);                      // do ponto de vista de quem joga
    if (b.turn === s.player_color) score = -score;          // agora: do ponto de vista do bot
    const accept = score < -150 || (Math.abs(score) <= 60 && Math.random() < 0.8);
    if (accept) { finish(s, "1/2-1/2", "Empate por acordo"); return [true, s.bot.say("draw") || "Aceito o empate."]; }
    if (score > 150) return [false, "Empate? Não, estou gostando da minha posição 😏"];
    return [false, "Ainda tem jogo aqui. Vamos continuar."];
  }
  function checkEnd(s) {
    const oc = s.board.outcome(true);
    if (oc) finish(s, oc.winner === null ? "1/2-1/2" : oc.winner === WHITE ? "1-0" : "0-1", TERMINATIONS[oc.termination] || "Fim de jogo");
  }

  function finish(s, result, termination) {
    s.over = true; s.result = result; s.termination = termination;
    let score;
    if (result === "1/2-1/2") { score = 0.5; s.outcome = "draw"; }
    else { const won = (result === "1-0") === (s.player_color === WHITE); score = won ? 1 : 0; s.outcome = won ? "win" : "loss"; }

    const p = S.get("players", s.player_id);
    const before = p.rating;
    if (s.mode === "rated" || s.mode === "tournament") {
      [p.rating, s.rating_change] = K.Elo.newRating(p.rating, s.bot.rating, score, p.rated_games);
      p.rated_games += 1;
      p.peak_rating = Math.max(p.peak_rating, p.rating);
    } else if (s.mode === "placement") {
      s.placement_info = K.Placement.applyResult(p, score);
      if (s.placement_info.done) s.rating_change = p.rating - before;
    }
    p.games_played += 1;
    if (s.outcome === "win") p.wins += 1; else if (s.outcome === "loss") p.losses += 1; else p.draws += 1;
    s.rating_after = p.rating;

    const white = s.player_color === WHITE;
    const event = s.tournament_id || s.champ_id ? (s.tournament_label || s.champ_label)
      : "Nex-J Chess - " + ({ rated: "Ranqueada", placement: "Classificação", training: "Treino" }[s.mode] || "Casual");
    const record = S.insert("games", {
      player_id: p.id, mode: s.mode, rated: s.rated, player_color: white ? "white" : "black", bot_name: s.bot.name, bot_rating: s.bot.rating,
      bot_personality: s.bot.personality, result, outcome: s.outcome, termination, rating_before: before, rating_after: p.rating,
      moves_count: s.board.moveStack.length,
      pgn: s.board.pgn({ Event: event, White: white ? p.name : s.bot.name, Black: white ? s.bot.name : p.name, Result: result, Termination: termination,
        Date: new Date().toISOString().slice(0, 10).replace(/-/g, ".") }),
      moves_uci: s.board.moveStack.map(m => s.board.uci(m)).join(" "), analysis: null, player_accuracy: null,
      time_control: s.tc_base ? `${s.tc_base}+${s.tc_inc}` : null, created_at: U.nowIso(),
    });
    s.db_id = record.id;

    const placementDoneNow = s.mode === "placement" && s.placement_info.done;
    if (s.tournament_id && hooks.tournament) hooks.tournament(s, p, result, record.id);
    if (s.champ_id && hooks.champ) hooks.champ(s, p, result, record.id);
    if (s.mode === "rated" || s.mode === "tournament" || placementDoneNow) {
      S.insert("rating_history", { player_id: p.id, rating: p.rating, game_id: record.id, reason: placementDoneNow ? "placement" : "game", created_at: U.nowIso() });
    }
    s.new_titles = p.placement_done ? K.Titles.award(p) : [];
    K.Titles.payBonus(p, s.new_titles);
    s.coins_earned = K.Economy.gameReward(p, s, before, record.id);
    try { s.daily_events = K.Daily.onGameFinished(p, s, before); }
    catch (e) { console.warn("[diário]", e); s.daily_events = []; }
  }

  // ---------------------------------------------------------------- estado para o front-end
  function clockState(s) {
    if (!s.tc_base) return null;
    const [key, name, icon] = K.TimeControl.label(s.tc_base, s.tc_inc);
    const r2 = x => Math.round(x * 100) / 100;
    return { white: r2(remaining(s, WHITE)), black: r2(remaining(s, BLACK)), running: clockRunning(s) ? (s.board.turn === WHITE ? "white" : "black") : null,
      base: s.tc_base, inc: s.tc_inc, key, label: name, icon };
  }
  function capturedPieces(board) {
    const layout = board.boardFen(), out = {}, mat = {};
    for (const [color, up] of [["white", true], ["black", false]]) {
      const missing = [];
      for (const [pc, n] of Object.entries(START_COUNTS)) {
        const ch = up ? pc.toUpperCase() : pc;
        const have = layout.split(ch).length - 1;
        for (let i = 0; i < Math.max(0, n - have); i++) missing.push(pc);
      }
      out[color] = missing;
      mat[color] = Object.entries(VALUES).reduce((sum, [pc, v]) => sum + v * (layout.split(up ? pc.toUpperCase() : pc).length - 1), 0);
    }
    out.advantage = mat.white - mat.black;
    return out;
  }
  function state(s) {
    const board = s.board, history = [], replay = new C.Board();
    const timeline = [{ fen: replay.fen(), uci: null, check: null }];
    for (const m of board.moveStack) {
      history.push(replay.san(m));
      replay.push(m);
      timeline.push({ fen: replay.fen(), uci: replay.uci(m), check: replay.inCheck() ? C.sqName(replay.king(replay.turn)) : null });
    }
    const last = board.moveStack.length ? board.uci(board.moveStack[board.moveStack.length - 1]) : null;
    const playerTurn = !s.over && board.turn === s.player_color;
    const data = {
      id: s.id, fen: board.fen(), turn: board.turn === WHITE ? "white" : "black", player_color: s.player_color === WHITE ? "white" : "black",
      player_turn: playerTurn, legal_moves: playerTurn ? board.legalMoves().map(m => board.uci(m)) : [], history, timeline, last_move: last,
      check: board.inCheck() ? C.sqName(board.king(board.turn)) : null, rated: s.rated, mode: s.mode, clock: clockState(s),
      tournament: s.tournament_id ? { id: s.tournament_id, label: s.tournament_label } : s.champ_id ? { id: s.champ_id, label: s.champ_label, champ: true } : null,
      coach_on: s.coach, coach_log: Object.fromEntries(Object.entries(s.coach_log).map(([k, v]) => [String(k), v])),
      bot: s.bot.toDict(), captured: capturedPieces(board), over: s.over,
    };
    // legal_moves: o front-end usa as casas (UCI) — a promoção vem com a letra da peça
    if (s.over) {
      data.result = { result: s.result, outcome: s.outcome, termination: s.termination, rating_change: s.rating_change, rating_after: s.rating_after,
        game_id: s.db_id, placement: s.placement_info, new_titles: s.new_titles || [], tournament: s.tournament_info, daily_events: s.daily_events || [],
        coins_earned: s.coins_earned || 0, bot_message: s.bot.say({ win: "lose", loss: "win", draw: "draw" }[s.outcome]) };
    }
    return data;
  }

  root.NJGames = { games, hooks, TERMINATIONS, create, get, findTournamentGame, findChampGame, remaining, checkFlag, playerMove, botMove, hint, takeback,
    resign, offerDraw, state, capturedPieces, finish };
})(typeof self !== "undefined" ? self : this);
