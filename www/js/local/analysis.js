/* Nex-J Chess (celular) — análise da partida (porta de core/analysis.py). Mesma fórmula do PC. */
(function (root) {
  "use strict";
  const C = root.NexChess, S = root.NJStore, U = root.NJUtil, K = root.NJCore;
  const { WHITE, BLACK, P, N, B, R, Q, K: KING } = C;
  const ANALYSIS_VERSION = 3;
  const PIECE_VALUE = [0, 1, 3, 3, 5, 9, 0];

  const CLASSES = {
    brilliant: ["Brilhante", "!!", "#1baca6"], great: ["Ótimo", "!", "#5c8bb0"], best: ["Melhor", "★", "#81b64c"],
    excellent: ["Excelente", "👍", "#96bc4b"], good: ["Bom", "✓", "#95af8a"], book: ["Livro", "📖", "#a88865"],
    forced: ["Forçado", "→", "#8d9bb8"], inaccuracy: ["Imprecisão", "?!", "#f7c631"], mistake: ["Erro", "?", "#ffa459"],
    miss: ["Chance perdida", "✗", "#ff7769"], blunder: ["Capivarada", "??", "#fa412d"],
  };
  const ORDER = ["brilliant", "great", "best", "excellent", "good", "book", "forced", "inaccuracy", "mistake", "miss", "blunder"];
  const PERF_TABLE = [[0, 100], [40, 250], [50, 400], [60, 600], [70, 900], [75, 1100], [80, 1300], [85, 1600], [90, 2000], [95, 2400], [100, 2800]];

  const winPct = cp => { cp = Math.max(-1000, Math.min(1000, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); };
  const moveAccuracy = (wb, wa) => { const loss = Math.max(0, wb - wa); return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)); };
  const round1 = x => Math.round(x * 10) / 10;
  function gameAccuracy(accs, weights) {
    if (!accs.length) return null;
    let sw = 0, sa = 0;
    accs.forEach((a, i) => { sa += a * weights[i]; sw += weights[i]; });
    const wmean = sa / sw;
    const harm = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
    return round1((wmean + harm) / 2);
  }
  const pstdev = arr => { const m = arr.reduce((s, x) => s + x, 0) / arr.length; return Math.sqrt(arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length); };
  function volatilityWeights(series) {
    const nMoves = series.length - 1;
    if (nMoves <= 0) return [];
    const size = Math.max(2, Math.min(8, Math.floor(series.length / 10)));
    let windows = [];
    for (let i = 0; i < Math.max(0, size - 2); i++) windows.push(series.slice(0, size));
    for (let i = 0; i <= series.length - size; i++) windows.push(series.slice(i, i + size));
    windows = windows.slice(0, nMoves);
    while (windows.length < nMoves) windows.push(series.slice(-size));
    return windows.map(w => Math.min(12, Math.max(0.5, pstdev(w))));
  }
  function estimateRating(accuracy, counts, nMoves, opponent) {
    if (accuracy === null) return null;
    let rating = PERF_TABLE[PERF_TABLE.length - 1][1];
    for (let i = 0; i < PERF_TABLE.length - 1; i++) {
      const [a0, r0] = PERF_TABLE[i], [a1, r1] = PERF_TABLE[i + 1];
      if (accuracy <= a1) { rating = r0 + (r1 - r0) * (accuracy - a0) / (a1 - a0); break; }
    }
    rating -= 60 * (counts.blunder || 0) + 30 * (counts.miss || 0) + 25 * (counts.mistake || 0);
    if (opponent) {
      const confidence = Math.min(1, nMoves / 25);
      rating = rating * confidence + opponent * (1 - confidence);
      rating = Math.min(rating, opponent + 700);
    }
    return Math.max(100, K.pyRound(rating / 50) * 50);
  }

  function isSacrifice(board, move) {
    const from = move & 63, to = (move >> 6) & 63, promo = (move >> 12) & 7;
    const piece = board.pieceAt(from);
    if (!piece || piece.type === P || piece.type === KING || promo) return false;
    const captured = board.pieceAt(to);
    const capVal = captured ? PIECE_VALUE[captured.type] : 0, movedVal = PIECE_VALUE[piece.type];
    board.push(move);
    const attackers = board.attackers(piece.color ^ 1, to);
    let result = false;
    if (attackers.length) {
      const defenders = board.attackers(piece.color, to);
      const cheapest = Math.min(...attackers.map(a => PIECE_VALUE[board.pieceAt(a).type] || 100));
      const hanging = !defenders.length || cheapest < movedVal;
      result = hanging && movedVal - capVal >= 2;
    }
    board.pop();
    return result;
  }
  function givesMate(board, move) { board.push(move); const m = board.isCheckmate(); board.pop(); return m; }

  function commentFor(cls, san, bestSan, swing) {
    const better = bestSan ? ` O melhor era ${bestSan}.` : "";
    return {
      brilliant: `${san}!! Sacrifício brilhante: entregar material foi a jogada certa.`,
      great: `${san}! Ótimo lance: era praticamente o único bom nesta posição.`,
      best: san.endsWith("#") ? `${san} é xeque-mate! 🏁` : `${san} é o melhor lance da posição.`,
      excellent: `${san} é excelente, quase tão bom quanto o melhor.${better}`,
      good: `${san} é um bom lance.${better}`,
      book: `${san} é um lance de abertura conhecido.`,
      forced: `${san} era o único lance possível.`,
      inaccuracy: `${san} é uma imprecisão.${better}`,
      mistake: `${san} é um erro: perdeu parte da vantagem.${better}`,
      miss: `${san} deixou passar a chance! O adversário tinha errado e dava para punir.${better}`,
      blunder: `${san} é uma capivarada! Entregou muita vantagem.${better}` + (swing ? " A partida virou!" : ""),
    }[cls];
  }

  /** movesUci: lances em UCI. playerColor: "white" | "black". Devolve a análise completa (igual ao PC). */
  async function analyseMoves(movesUci, engine, playerColor, progress, playerRating, botRating) {
    const board = new C.Board();
    const positions = [], boards = [], total = movesUci.length + 1;
    for (let i = 0; i < total; i++) {
      positions.push({ fen: board.fen(), uci: i ? movesUci[i - 1] : null, check: board.inCheck() ? C.sqName(board.king(board.turn)) : null });
      boards.push(board.copy());
      if (i < movesUci.length) board.pushUci(movesUci[i]);
    }
    const evals = new Array(total);
    for (let done = 1, i = total - 1; i >= 0; i--, done++) {
      evals[i] = await engine.analysePosition(boards[i]);
      if (progress) progress(done, total);
    }
    const whiteSeries = evals.map(e => winPct(e.cp));
    const weights = volatilityWeights(whiteSeries);

    const b = new C.Board();
    const plies = [], accs = { white: [], black: [] }, wts = { white: [], black: [] };
    const counts = { white: {}, black: {} };
    for (const c of ["white", "black"]) for (const k of ORDER) counts[c][k] = 0;
    let prevCls = null;

    for (let i = 0; i < movesUci.length; i++) {
      const uci = movesUci[i], move = b.moveFromUci(uci);
      const mover = b.turn === WHITE ? "white" : "black", sign = mover === "white" ? 1 : -1;
      const before = evals[i], after = evals[i + 1];
      const wb = winPct(sign * before.cp), wa = winPct(sign * after.cp);
      const loss = Math.max(0, wb - wa);
      const san = b.san(move);
      const bestUci = before.best;
      const bestSan = bestUci && bestUci !== uci ? b.san(b.moveFromUci(bestUci)) : null;
      const isBest = uci === bestUci || (bestUci !== null && bestUci !== undefined && loss < 0.3);

      let cls;
      if (givesMate(b, move)) cls = "best";
      else if (b.legalMoves().length === 1) cls = "forced";
      else if (i < 10 && loss < 5) cls = "book";
      else if (isBest) {
        const secondLoss = before.second_cp !== null && before.second_cp !== undefined ? wb - winPct(sign * before.second_cp) : 0;
        if (wb > 3 && wa >= 50 && isSacrifice(b, move)) cls = "brilliant";
        else if (wb > 30 && wb < 97 && secondLoss >= 10) cls = "great";
        else cls = "best";
      } else if (loss < 2) cls = "excellent";
      else if (loss < 5) cls = "good";
      else if (loss < 10) cls = "inaccuracy";
      else if (loss < 20) cls = "mistake";
      else cls = "blunder";
      if ((cls === "inaccuracy" || cls === "mistake") && ["mistake", "blunder", "miss"].includes(prevCls)) cls = "miss";

      const a = moveAccuracy(wb, wa);
      accs[mover].push(a);
      wts[mover].push(i < weights.length ? weights[i] : 1.0);
      counts[mover][cls]++;
      const [name, symbol, color] = CLASSES[cls];
      plies.push({ ply: i + 1, san, uci, color: mover, cls, label: name, symbol, hex: color, best_san: bestSan, accuracy: round1(a),
        eval: after.cp, mate: after.mate, comment: commentFor(cls, san, bestSan, wb >= 55 && wa <= 45) });
      prevCls = cls;
      b.push(move);
    }

    const botColor = playerColor === "white" ? "black" : "white";
    const opponent = { [playerColor]: botRating, [botColor]: playerRating };
    const summary = {};
    for (const side of ["white", "black"]) {
      const acc = gameAccuracy(accs[side], wts[side]);
      summary[side] = { accuracy: acc, rating: estimateRating(acc, counts[side], accs[side].length, opponent[side]), counts: counts[side] };
    }
    return {
      version: ANALYSIS_VERSION, player_color: playerColor, positions, plies, graph: whiteSeries.map(round1), summary,
      classes: Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, { label: v[0], symbol: v[1], hex: v[2] }])), order: ORDER,
    };
  }

  /** Roda análises "em segundo plano" e guarda o progresso para a tela consultar. */
  const jobs = new Map();
  function status(gameId) {
    const game = S.get("games", gameId);
    if (!game) return null;
    if (game.analysis) {
      const result = JSON.parse(game.analysis);
      if ((result.version || 1) >= ANALYSIS_VERSION) return { status: "done", result };
    }
    const job = jobs.get(gameId);
    if (job && job.status !== "done") return Object.assign({}, job);
    return { status: "none" };
  }
  function start(gameId) {
    const current = status(gameId);
    if (current === null || current.status === "done" || current.status === "running") return current;
    const game = S.get("games", gameId);
    const moves = (game.moves_uci || "").split(/\s+/).filter(Boolean);
    if (!moves.length) return { status: "error", error: "Esta partida não tem lances salvos para analisar." };
    const playerColor = game.player_color, playerRating = game.rating_before, botRating = game.bot_rating;
    const job = { status: "running", progress: 0, total: moves.length + 1 };
    jobs.set(gameId, job);
    (async () => {
      try {
        const result = await analyseMoves(moves, root.NexEngine, playerColor, (d, t) => { job.progress = d; job.total = t; }, playerRating, botRating);
        const g = S.get("games", gameId);
        g.analysis = JSON.stringify(result);
        g.player_accuracy = result.summary[playerColor].accuracy;
        try { const p = S.get("players", g.player_id); K.Daily.onAnalysis(p, g.player_accuracy); } catch (e) { console.warn("[diário]", e); }
        job.status = "done";
      } catch (e) { job.status = "error"; job.error = "Falha na análise: " + (e && e.message || e); }
    })();
    return Object.assign({}, job);
  }

  root.NJAnalysis = { ANALYSIS_VERSION, CLASSES, ORDER, winPct, moveAccuracy, gameAccuracy, volatilityWeights, estimateRating, analyseMoves, status, start, jobs };
})(typeof self !== "undefined" ? self : this);
