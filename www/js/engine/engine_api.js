/* Nex-J Chess (celular) — escolha de lance dos bots, análise e avaliação.
 * Porta de core/engine.py. Usa o motor próprio (search.js) e, se existir, o Stockfish WASM
 * (adaptador em stockfish_adapter.js) — a interface é a mesma.
 *
 * Como a força é calibrada (valores medidos contra o Stockfish; ver tests/):
 *  - rating abaixo de ELO_MIN: profundidade pequena + ruído + chance de "lance humano" (erro),
 *    igual ao jogo do PC.
 *  - rating de ELO_MIN para cima: orçamento de nós e ruído conforme a tabela STRENGTH.
 */
(function (root) {
  "use strict";
  const isNode = typeof require !== "undefined" && typeof module !== "undefined";
  const C = isNode ? require("./chess.js") : root.NexChess;
  const S = isNode ? require("./search.js") : root.NexSearch;
  const { WHITE, BLACK, P, N, B, R, Q, K, sqName } = C;

  const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 0];
  const sqs = names => new Set(names.map(C.sqFrom));
  const CENTER = sqs(["d4", "e4", "d5", "e5"]);
  const WIDE_CENTER = sqs(["c3", "d3", "e3", "f3", "c4", "f4", "c5", "f5", "c6", "d6", "e6", "f6"]);
  const ELO_MIN = 1320, ELO_MAX = 3190;

  // [habilidade (0-5), profundidade, chance de erro] — idêntico ao PC
  function lowRatingParams(rating) {
    if (rating < 400) return [0, 1, 0.45];
    if (rating < 550) return [0, 1, 0.32];
    if (rating < 700) return [0, 2, 0.20];
    if (rating < 900) return [1, 3, 0.12];
    if (rating < 1100) return [3, 4, 0.07];
    return [5, 6, 0.04];
  }
  function thinkTime(rating) { return Math.min(1.2, 0.15 + rating / 3000); }

  // Calibração (substituível pelos testes): ruído por "habilidade" e tabela para ratings altos
  const TUNING = {
    skillNoise: [0, 0, 0, 0, 0, 0],
    // [rating, nós, ruído] em ordem crescente; interpola entre as linhas
    strength: [[1320, 700, 0], [1500, 1500, 0], [1700, 4000, 0], [1900, 11000, 0], [2000, 35000, 0], [2200, 90000, 0], [2400, 200000, 0], [2600, 450000, 0], [3000, 1500000, 0]],
  };

  /** Escolha do Stockfish com "Skill Level" (nível 0 = quase sorteio entre as 4 melhores; 20 = sempre a melhor). */
  function skillPick(lines, level) {
    const ls = lines.filter(l => l.move);
    if (!ls.length) return 0;
    if (ls.length === 1) return ls[0].move;
    const top = ls[0].score;
    const delta = Math.min(top - ls[ls.length - 1].score, 100);   // 100 = valor de um peão (cp)
    const weakness = 120 - 2 * level;
    let maxScore = -Infinity, best = ls[0].move;
    for (const l of ls) {
      const push = (weakness * (top - l.score) + delta * Math.floor(Math.random() * weakness)) / 128;
      if (l.score + push >= maxScore) { maxScore = l.score + push; best = l.move; }
    }
    return best;
  }

  function strengthFor(rating) {
    const t = TUNING.strength;
    if (rating <= t[0][0]) return { nodes: t[0][1], noise: t[0][2] };
    for (let i = 1; i < t.length; i++) {
      if (rating <= t[i][0]) {
        const a = t[i - 1], b = t[i], f = (rating - a[0]) / (b[0] - a[0]);
        return { nodes: Math.round(a[1] * Math.pow(b[1] / a[1], f)), noise: Math.round(a[2] + (b[2] - a[2]) * f) };
      }
    }
    const l = t[t.length - 1];
    return { nodes: l[1], noise: l[2] };
  }

  // ----------------------------------------------------------------- personalidade
  function squareDistance(a, b) { return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3))); }

  function styleBonus(board, m, personality) {
    const from = m & 63, to = (m >> 6) & 63;
    const piece = board.sq[from] & 7;
    const us = board.turn;
    const isCapture = board.isCapture(m);
    const givesCheck = board.givesCheck(m);
    const enemyKing = board.king(us ^ 1);
    let bonus = 0;
    if (personality === "agressivo") {
      bonus += 2 * givesCheck + 1.5 * isCapture;
      if (squareDistance(to, enemyKing) <= 2) bonus += 1;
    } else if (personality === "tatico") {
      bonus += 2 * isCapture + 2 * givesCheck;
      board.push(m);
      let attacked = 0;
      for (const s of board.attacks(to)) { const p = board.sq[s]; if (p && (p >> 3) === board.turn) attacked++; }
      board.pop();
      bonus += 0.5 * attacked;
    } else if (personality === "solido") {
      bonus += 1.5 * board.isCastling(m);
      bonus += 1.0 * (!isCapture && !givesCheck);
      const rank = us === WHITE ? (to >> 3) : 7 - (to >> 3);
      bonus -= 0.8 * (rank >= 5 && piece && piece !== P);
    } else if (personality === "posicional") {
      bonus += 1.5 * CENTER.has(to) + 0.7 * WIDE_CENTER.has(to);
      bonus += 1.0 * board.isCastling(m);
      const back = us === WHITE ? 0 : 7;
      if ((piece === N || piece === B) && (from >> 3) === back) bonus += 1.0;
    } else if (personality === "criativo") {
      bonus += Math.random() * 2;
      if (piece === N || piece === B) bonus += 0.8;
    }
    return bonus;
  }

  // Lance "humano" de iniciante: prefere capturas e xeques; a partir de ~500 não perde um mate em 1
  function humanErrorMove(board, legal, personality, rating = 800) {
    const weights = [];
    for (const m of legal) {
      let w = 1.0;
      if (board.isCapture(m)) w += (personality === "agressivo" || personality === "tatico") ? 2.0 : 1.2;
      if (board.givesCheck(m)) w += 1.5;
      board._mk(m);
      if (board.inCheck() && board.legalMoves().length === 0) w += rating >= 500 ? 50 : 3;
      board._um();
      weights.push(w);
    }
    let total = 0;
    for (const w of weights) total += w;
    let x = Math.random() * total;
    for (let i = 0; i < legal.length; i++) { x -= weights[i]; if (x <= 0) return legal[i]; }
    return legal[legal.length - 1];
  }

  function materialEval(board) {
    // do ponto de vista de quem joga
    let score = 0;
    for (let s = 0; s < 64; s++) {
      const p = board.sq[s];
      if (!p) continue;
      let v = PIECE_VALUES[p & 7];
      if (CENTER.has(s)) v += 20; else if (WIDE_CENTER.has(s)) v += 8;
      score += (p >> 3) === board.turn ? v : -v;
    }
    return score;
  }

  // ----------------------------------------------------------------- gerenciador
  class EngineManager {
    constructor(opts = {}) {
      this.search = new S.Engine({ hashBits: opts.hashBits || 20 });
      this.name = "Motor Nex-J (celular)";
      this.eloMin = ELO_MIN;
      this.eloMax = ELO_MAX;
      this.external = null;      // adaptador do Stockfish WASM, se existir
    }

    clear() { this.search.clear(); }

    /** Escolhe o lance do bot. Devolve o lance (inteiro). maxTime em segundos (partidas com relógio). */
    chooseMove(board, bot, maxTime) {
      const legal = board.legalMoves();
      if (legal.length === 1) return legal[0];
      const rating = bot.rating;
      const personality = bot.personality || "";
      const cap = t => maxTime ? Math.min(t, Math.max(0.05, maxTime * 0.8)) : t;
      let params;
      if (rating < this.eloMin) {
        const [skill, depth, blunder] = lowRatingParams(rating);
        if (Math.random() < blunder) return humanErrorMove(board, legal, personality, rating);
        // igual ao "Skill Level" do Stockfish: busca 4 linhas e escolhe entre elas com sorteio ponderado
        const r = this.search.search(board, { depth, time: cap(0.3) * 1000, multipv: 4, nodes: 20000 * depth, noise: TUNING.skillNoise[skill] });
        return skillPick(r.lines, skill) || r.move || legal[(Math.random() * legal.length) | 0];
      } else {
        const st = strengthFor(Math.min(rating, this.eloMax));
        params = { time: cap(thinkTime(rating)) * 1000 * (rating > 2000 ? 1.6 : 1), nodes: st.nodes, noise: st.noise };
      }
      // toque de personalidade (em ~25% dos lances, a partir do nível intermediário)
      if (rating >= 900 && Math.random() < 0.25 && (!maxTime || maxTime > 0.6)) {
        const styled = this._personalityMove(board, bot);
        if (styled) return styled;
      }
      const r = this.search.search(board, params);
      return r.move || legal[(Math.random() * legal.length) | 0];
    }

    _personalityMove(board, bot) {
      const margin = Math.max(25, 140 - Math.floor(bot.rating / 20));
      const r = this.search.search(board, { depth: 8, time: 250, multipv: 4, nodes: 60000 });
      const cands = r.lines.filter(l => l.move).map(l => [l.move, l.score]);
      if (!cands.length) return 0;
      const best = cands[0][1];
      const pool = cands.filter(([, s]) => best - s <= margin);
      let pick = pool[0], pickScore = -Infinity;
      for (const [m, s] of pool) {
        const v = styleBonus(board, m, bot.personality || "") + s / 1000;
        if (v > pickScore) { pickScore = v; pick = [m, s]; }
      }
      return pick[0];
    }

    /** Análise da posição (revisão da partida): cp e mate do ponto de vista das BRANCAS. */
    analysePosition(board, depth = 18, timeLimit = 1.0) {
      const oc = board.outcome(true);
      if (oc) {
        if (oc.termination === "CHECKMATE") return { cp: board.turn === WHITE ? -10000 : 10000, mate: 0, best: null, second_cp: null };
        return { cp: 0, mate: null, best: null, second_cp: null };
      }
      const r = this.search.search(board, { depth: Math.min(depth, 14), time: timeLimit * 1000, multipv: 2, nodes: 400000 });
      const sign = board.turn === WHITE ? 1 : -1;
      const first = r.lines[0], second = r.lines[1];
      const toCp = l => this._cp(l.score) * sign;
      return {
        cp: toCp(first), mate: first.mate === null ? null : first.mate * sign,
        best: board.uci(first.move), second_cp: second ? toCp(second) : null,
      };
    }

    // mate vira ±10000 como no PC (score.score(mate_score=10000))
    _cp(score) {
      if (score > S.MATE - 200) return 10000 - (S.MATE - score);
      if (score < -S.MATE + 200) return -10000 + (S.MATE + score);
      return score;
    }

    /** Avaliação rápida (treinador / dica): {cp, mate, best} das BRANCAS. */
    quickEval(board, depth = 12, timeLimit = 0.25) {
      const oc = board.outcome(true);
      if (oc) {
        if (oc.termination === "CHECKMATE") return { cp: board.turn === WHITE ? -10000 : 10000, mate: 0, best: null };
        return { cp: 0, mate: null, best: null };
      }
      const r = this.search.search(board, { depth: Math.min(depth, 12), time: timeLimit * 1000, nodes: 150000 });
      const sign = board.turn === WHITE ? 1 : -1;
      return { cp: this._cp(r.score) * sign, mate: r.mate === null ? null : r.mate * sign, best: r.move ? board.uci(r.move) : null };
    }

    /** Avaliação em centipeões do ponto de vista de quem joga (proposta de empate). */
    evaluate(board) {
      const r = this.search.search(board, { depth: 8, time: 300, nodes: 80000 });
      return this._cp(r.score);
    }
  }

  const api = { EngineManager, skillPick, lowRatingParams, thinkTime, strengthFor, styleBonus, humanErrorMove, materialEval, TUNING, ELO_MIN, ELO_MAX };
  if (isNode) module.exports = api; else root.NexEngineAPI = api;
})(typeof self !== "undefined" ? self : this);
