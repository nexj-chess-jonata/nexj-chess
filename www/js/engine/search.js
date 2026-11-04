/* Nex-J Chess (celular) — motor de xadrez próprio (busca alfa-beta + avaliação).
 *
 * É o "cérebro" dos bots quando o Stockfish não está disponível no celular.
 * Busca: aprofundamento iterativo, PVS, tabela de transposição, poda de lance nulo,
 * LMR, quiescence, killers/histórico. Avaliação: material + tabelas de casas (início/fim de jogo),
 * par de bispos, peões passados/dobrados/isolados, torres em colunas abertas, segurança do rei.
 *
 * A força é regulada por: profundidade máxima, limite de nós, tempo e "ruído" na avaliação
 * (erros parecidos com os humanos). Funciona no navegador (NexSearch) e no Node (testes).
 */
(function (root) {
  "use strict";
  const C = (typeof require !== "undefined" && typeof module !== "undefined") ? require("./chess.js") : root.NexChess;
  const { WHITE, BLACK, P, N, B, R, Q, K, EP, mk } = C;

  const INF = 32000, MATE = 30000;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ------------------------------------------------------------------ avaliação
  const MG = [0, 82, 337, 365, 477, 1025, 0], EG = [0, 94, 281, 297, 512, 936, 0];
  const PST = {
    1: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    4: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    6: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  };
  const KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  const PHASE = [0, 0, 1, 1, 2, 4, 0];
  const PASSED = [0, 5, 10, 20, 35, 60, 100, 0];   // bônus por fileira (relativa)

  // tabelas por casa real: PM[tipo|cor<<3][casa] (mg) e PE (eg)
  const PM = [], PE = [];
  for (let t = 1; t <= 6; t++) {
    for (const color of [WHITE, BLACK]) {
      const code = t | (color << 3);
      PM[code] = new Int16Array(64); PE[code] = new Int16Array(64);
      for (let s = 0; s < 64; s++) {
        const idx = color === WHITE ? s ^ 56 : s;
        const sgn = 1;
        PM[code][s] = MG[t] + PST[t][idx] * sgn;
        let eg = EG[t] + PST[t][idx];
        if (t === K) eg = KING_EG[idx];
        if (t === P) eg = EG[1] + PST[1][idx] * 0.6 + ((color === WHITE ? (s >> 3) : 7 - (s >> 3)) * 4);
        PE[code][s] = eg;
      }
    }
  }

  const pawnCols = [new Int8Array(8), new Int8Array(8)];   // nº de peões por coluna
  const pawnMin = [new Int8Array(8), new Int8Array(8)];     // fileira mais avançada (relativa) por coluna
  const pawnBack = [new Int8Array(8), new Int8Array(8)];    // fileira menos avançada

  /** Avaliação em centipeões do ponto de vista de quem joga. */
  function evaluate(b) {
    const sq = b.sq;
    let mg0 = 0, mg1 = 0, eg0 = 0, eg1 = 0, phase = 0;
    let bishops0 = 0, bishops1 = 0;
    pawnCols[0].fill(0); pawnCols[1].fill(0);
    pawnMin[0].fill(0); pawnMin[1].fill(0);
    pawnBack[0].fill(9); pawnBack[1].fill(9);
    for (let s = 0; s < 64; s++) {
      const p = sq[s];
      if (!p) continue;
      const t = p & 7, c = p >> 3;
      if (c === 0) { mg0 += PM[p][s]; eg0 += PE[p][s]; } else { mg1 += PM[p][s]; eg1 += PE[p][s]; }
      phase += PHASE[t];
      if (t === P) {
        const f = s & 7, r = c === 0 ? (s >> 3) : 7 - (s >> 3);
        pawnCols[c][f]++;
        if (r > pawnMin[c][f]) pawnMin[c][f] = r;
        if (r < pawnBack[c][f]) pawnBack[c][f] = r;
      } else if (t === B) { if (c === 0) bishops0++; else bishops1++; }
    }
    let bonusMg = 0, bonusEg = 0;
    if (bishops0 >= 2) { bonusMg += 30; bonusEg += 45; }
    if (bishops1 >= 2) { bonusMg -= 30; bonusEg -= 45; }

    // estrutura de peões + torres
    for (let c = 0; c < 2; c++) {
      const sgn = c === 0 ? 1 : -1, o = c ^ 1;
      for (let f = 0; f < 8; f++) {
        const n = pawnCols[c][f];
        if (!n) continue;
        if (n > 1) { bonusMg -= sgn * 12 * (n - 1); bonusEg -= sgn * 18 * (n - 1); }          // dobrados
        const left = f > 0 ? pawnCols[c][f - 1] : 0, right = f < 7 ? pawnCols[c][f + 1] : 0;
        if (!left && !right) { bonusMg -= sgn * 10; bonusEg -= sgn * 14; }                      // isolado
        // passado: nenhum peão adversário à frente nas colunas f-1..f+1
        const myR = pawnMin[c][f];
        let passed = true;
        for (let g = Math.max(0, f - 1); g <= Math.min(7, f + 1) && passed; g++) {
          if (pawnCols[o][g] && (7 - pawnBack[o][g]) > myR) passed = false;                   // peão inimigo mais atrás dele (em relação ao lado dele)
        }
        if (passed) { bonusMg += sgn * (PASSED[myR] >> 1); bonusEg += sgn * PASSED[myR]; }
      }
    }
    for (let s = 0; s < 64; s++) {
      const p = sq[s];
      if (!p) continue;
      const t = p & 7;
      if (t === R) {
        const c = p >> 3, f = s & 7, sgn = c === 0 ? 1 : -1;
        if (!pawnCols[c][f]) { bonusMg += sgn * (pawnCols[c ^ 1][f] ? 10 : 22); bonusEg += sgn * 8; }
        const r7 = c === 0 ? (s >> 3) === 6 : (s >> 3) === 1;
        if (r7) { bonusMg += sgn * 15; bonusEg += sgn * 20; }
      }
    }
    // segurança do rei: escudo de peões à frente (só no meio-jogo)
    for (let c = 0; c < 2; c++) {
      const ks = b.kingSq[c], kf = ks & 7, kr = ks >> 3, sgn = c === 0 ? 1 : -1;
      const fwd = c === 0 ? 1 : -1;
      let shield = 0;
      for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
        const r1 = kr + fwd, r2 = kr + 2 * fwd;
        if (r1 >= 0 && r1 < 8 && sq[r1 * 8 + f] === (P | (c << 3))) shield += 2;
        else if (r2 >= 0 && r2 < 8 && sq[r2 * 8 + f] === (P | (c << 3))) shield += 1;
      }
      bonusMg += sgn * (shield * 7 - 10);
    }
    if (phase > 24) phase = 24;
    const mg = mg0 - mg1 + bonusMg, eg = eg0 - eg1 + bonusEg;
    let score = ((mg * phase + eg * (24 - phase)) / 24) | 0;
    score += b.turn === WHITE ? 10 : -10;   // tempo
    return b.turn === WHITE ? score : -score;
  }

  // ------------------------------------------------------------------ busca
  const FLAG_EXACT = 0, FLAG_LOWER = 1, FLAG_UPPER = 2;
  const VAL = [0, 100, 320, 330, 500, 900, 20000];

  class Engine {
    constructor(opts = {}) {
      const bits = opts.hashBits || 20;
      this.size = 1 << bits;
      this.mask = this.size - 1;
      this.tLo = new Int32Array(this.size);
      this.tHi = new Int32Array(this.size);
      this.tMove = new Int32Array(this.size);
      this.tScore = new Int16Array(this.size);
      this.tDepth = new Int8Array(this.size);
      this.tFlag = new Uint8Array(this.size);
      this.killers = [];
      for (let i = 0; i < 128; i++) this.killers.push([0, 0]);
      this.history = new Int32Array(2 * 64 * 64);
      this.nodes = 0;
      this.stop = false;
      this.seedNoise = 12345;
    }

    clear() {
      this.tLo.fill(0); this.tHi.fill(0); this.tMove.fill(0); this.tScore.fill(0); this.tDepth.fill(0); this.tFlag.fill(0);
      this.history.fill(0);
    }

    _eval(b) {
      let v = evaluate(b);
      if (this.noise) {
        // ruído determinístico por posição (mesma posição → mesmo erro dentro da busca)
        let h = (b.hLo ^ this.seedNoise) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
        v += (((h >>> 0) / 4294967295) * 2 - 1) * this.noise | 0;
      }
      return v;
    }

    _score(b, moves, ttMove, ply) {
      const n = moves.length, scores = new Int32Array(n), sq = b.sq, side = b.turn;
      const k1 = this.killers[ply][0], k2 = this.killers[ply][1];
      for (let i = 0; i < n; i++) {
        const m = moves[i], to = (m >> 6) & 63, from = m & 63;
        let sc = 0;
        if (m === ttMove) sc = 1e7;
        else {
          const victim = sq[to] & 7, mover = sq[from] & 7, promo = (m >> 12) & 7;
          if (victim || (m >> 15) & EP) sc = 1e6 + VAL[victim || P] * 10 - mover;
          else if (promo) sc = 9e5 + promo;
          else if (m === k1) sc = 8e5;
          else if (m === k2) sc = 7e5;
          else sc = this.history[(side * 64 + from) * 64 + to];
          if (promo && (victim || (m >> 15) & EP)) sc += 1000;
        }
        scores[i] = sc;
      }
      return scores;
    }

    _pick(moves, scores, i) {
      let best = i;
      for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[best]) best = j;
      if (best !== i) {
        const m = moves[i]; moves[i] = moves[best]; moves[best] = m;
        const s = scores[i]; scores[i] = scores[best]; scores[best] = s;
      }
      return moves[i];
    }

    _isRep(b) {
      const n = b.keysLo.length, lo = b.keysLo[n - 1], hi = b.keysHi[n - 1];
      const lim = Math.max(0, n - 1 - b.halfmove);
      for (let i = n - 3; i >= lim; i -= 2) if (b.keysLo[i] === lo && b.keysHi[i] === hi) return true;
      return false;
    }

    _check() {
      if (this.depthNow <= 1) return;   // a primeira profundidade sempre termina (sempre há um lance)
      if (this.nodes >= this.maxNodes) this.stop = true;
      else if ((this.nodes & 1023) === 0 && now() >= this.deadline) this.stop = true;
    }

    _qsearch(b, alpha, beta, ply, qd) {
      this.nodes++;
      if ((this.nodes & 1023) === 0) this._check();
      if (this.stop) return 0;
      const inCheck = b.inCheck();
      let stand = -INF;
      if (!inCheck) {
        stand = this._eval(b);
        if (stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
        if (qd > 8) return stand;
      }
      const moves = b.pseudoMoves(!inCheck);
      const scores = this._score(b, moves, 0, Math.min(ply, 127));
      let best = stand, legalCount = 0;
      for (let i = 0; i < moves.length; i++) {
        const m = this._pick(moves, scores, i);
        if (!inCheck) {
          const victim = b.sq[(m >> 6) & 63] & 7;
          const promo = (m >> 12) & 7;
          if (!promo && stand + VAL[victim || P] + 200 < alpha) continue;   // poda delta
        }
        const us = b.turn;
        b._mk(m);
        if (b.isAttacked(b.kingSq[us], us ^ 1)) { b._um(); continue; }
        legalCount++;
        const v = -this._qsearch(b, -beta, -alpha, ply + 1, qd + 1);
        b._um();
        if (this.stop) return 0;
        if (v > best) { best = v; if (v > alpha) { alpha = v; if (v >= beta) return v; } }
      }
      if (inCheck && !legalCount) return -MATE + ply;
      return best;
    }

    _negamax(b, depth, alpha, beta, ply, nullOk, pv) {
      this.nodes++;
      if ((this.nodes & 1023) === 0) this._check();
      if (this.stop) return 0;
      const isPV = beta - alpha > 1;
      if (ply > 0) {
        if (b.halfmove >= 100 || this._isRep(b)) return 0;
        // insuficiência simples de material
        if (alpha < -MATE + ply) alpha = -MATE + ply;
        if (beta > MATE - ply) beta = MATE - ply;
        if (alpha >= beta) return alpha;
      }
      const inCheck = b.inCheck();
      if (inCheck) depth++;
      if (depth <= 0) return this._qsearch(b, alpha, beta, ply, 0);
      if (ply >= 120) return this._eval(b);

      // tabela de transposição
      const idx = (b.hLo & this.mask) >>> 0;
      let ttMove = 0;
      if (this.tLo[idx] === b.hLo && this.tHi[idx] === b.hHi) {
        ttMove = this.tMove[idx];
        if (this.tDepth[idx] >= depth && ply > 0) {
          let s = this.tScore[idx];
          if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
          const f = this.tFlag[idx];
          if (f === FLAG_EXACT && !isPV) return s;
          if (f === FLAG_LOWER && s >= beta) return s;
          if (f === FLAG_UPPER && s <= alpha) return s;
        }
      }

      let staticEval = null;
      if (!inCheck && !isPV) {
        staticEval = this._eval(b);
        // poda reversa (rei seguro com folga de material)
        if (depth <= 3 && staticEval - 110 * depth >= beta && Math.abs(beta) < MATE - 200) return staticEval;
        // lance nulo
        if (nullOk && depth >= 3 && staticEval >= beta && this._hasPieces(b)) {
          b.makeNull();
          const r = depth > 6 ? 3 : 2;
          const v = -this._negamax(b, depth - 1 - r, -beta, -beta + 1, ply + 1, false, null);
          b.unmakeNull();
          if (this.stop) return 0;
          if (v >= beta) return v >= MATE - 200 ? beta : v;
        }
      }

      const moves = b.pseudoMoves();
      const scores = this._score(b, moves, ttMove, ply);
      let best = -INF, bestMove = 0, legalCount = 0, flag = FLAG_UPPER;
      const childPV = isPV ? [] : null;
      const side = b.turn;
      const futile = !inCheck && !isPV && depth <= 2 && staticEval !== null && staticEval + 140 * depth <= alpha;
      for (let i = 0; i < moves.length; i++) {
        const m = this._pick(moves, scores, i);
        const to = (m >> 6) & 63, from = m & 63;
        const quiet = !b.sq[to] && !((m >> 15) & EP) && !((m >> 12) & 7);
        b._mk(m);
        if (b.isAttacked(b.kingSq[side], side ^ 1)) { b._um(); continue; }
        legalCount++;
        if (futile && quiet && legalCount > 1 && !b.inCheck()) { b._um(); continue; }
        let v;
        const givesCheck = b.inCheck();
        if (childPV) childPV.length = 0;
        if (legalCount === 1) {
          v = -this._negamax(b, depth - 1, -beta, -alpha, ply + 1, true, childPV);
        } else {
          let red = 0;
          if (depth >= 3 && quiet && !inCheck && !givesCheck && legalCount > 3) red = legalCount > 8 ? 2 : 1;
          v = -this._negamax(b, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true, null);
          if (v > alpha && red) v = -this._negamax(b, depth - 1, -alpha - 1, -alpha, ply + 1, true, null);
          if (v > alpha && v < beta) v = -this._negamax(b, depth - 1, -beta, -alpha, ply + 1, true, childPV);
        }
        b._um();
        if (this.stop) return 0;
        if (v > best) {
          best = v; bestMove = m;
          if (v > alpha) {
            alpha = v; flag = FLAG_EXACT;
            if (pv) { pv.length = 0; pv.push(m); if (childPV) for (const x of childPV) pv.push(x); }
            if (v >= beta) {
              flag = FLAG_LOWER;
              if (quiet) {
                const k = this.killers[ply];
                if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
                this.history[(side * 64 + from) * 64 + to] += depth * depth;
              }
              break;
            }
          }
        }
      }
      if (!legalCount) return inCheck ? -MATE + ply : 0;
      // grava na tabela
      let s = best;
      if (s > MATE - 200) s += ply; else if (s < -MATE + 200) s -= ply;
      this.tLo[idx] = b.hLo; this.tHi[idx] = b.hHi; this.tMove[idx] = bestMove;
      this.tScore[idx] = s; this.tDepth[idx] = depth; this.tFlag[idx] = flag;
      return best;
    }

    _hasPieces(b) {
      const c = b.turn;
      for (let s = 0; s < 64; s++) {
        const p = b.sq[s];
        if (p && (p >> 3) === c) { const t = p & 7; if (t !== P && t !== K) return true; }
      }
      return false;
    }

    /**
     * Pensa e devolve {move, score, mate, depth, nodes, pv, lines}.
     * opts: depth, nodes, time (ms), multipv, noise (cp), exclude (lances proibidos na raiz),
     *       onInfo(info) a cada profundidade.
     * score: centipeões do ponto de vista de quem joga; mate: lances até o mate (negativo = leva mate) ou null.
     */
    search(board, opts = {}) {
      const b = board;
      this.maxDepth = Math.min(opts.depth || 64, 64);
      this.maxNodes = opts.nodes || Infinity;
      this.deadline = now() + (opts.time != null ? opts.time : 1000);
      this.noise = opts.noise || 0;
      this.seedNoise = opts.seed != null ? opts.seed : ((Math.random() * 4294967295) | 0);
      this.stop = false;
      this.nodes = 0;
      for (const k of this.killers) { k[0] = 0; k[1] = 0; }
      for (let i = 0; i < this.history.length; i++) this.history[i] >>= 2;
      const multipv = Math.max(1, opts.multipv || 1);
      const legalAll = b.legalMoves();
      if (!legalAll.length) return { move: 0, score: b.inCheck() ? -MATE : 0, mate: b.inCheck() ? 0 : null, depth: 0, nodes: 0, pv: [], lines: [] };
      if (legalAll.length === 1 && multipv === 1 && !opts.exclude) {
        return { move: legalAll[0], score: this._eval(b), mate: null, depth: 0, nodes: 0, pv: [legalAll[0]], lines: [{ move: legalAll[0], score: this._eval(b), mate: null, pv: [legalAll[0]] }] };
      }
      let result = null;
      let prevBest = 0;
      const exclude = new Set(opts.exclude || []);
      for (let depth = 1; depth <= this.maxDepth; depth++) {
        this.depthNow = depth;
        const lines = [];
        const skip = new Set(exclude);
        let aborted = false;
        for (let k = 0; k < Math.min(multipv, legalAll.length - exclude.size); k++) {
          const r = this._root(b, depth, skip, prevBest);
          if (this.stop) { aborted = true; if (r && r.move && k === 0 && depth > 1 && result && r.complete) { /* usa o parcial */ } break; }
          if (!r.move) break;
          lines.push(r);
          skip.add(r.move);
        }
        if (aborted && depth > 1) break;
        if (!lines.length) break;
        const top = lines[0];
        prevBest = top.move;
        result = { move: top.move, score: top.score, mate: scoreToMate(top.score), depth, nodes: this.nodes, pv: top.pv,
          lines: lines.map(l => ({ move: l.move, score: l.score, mate: scoreToMate(l.score), pv: l.pv })) };
        if (opts.onInfo) opts.onInfo(result);
        if (Math.abs(top.score) > MATE - 100 && multipv === 1 && depth >= 4) break;   // mate encontrado
        if (now() >= this.deadline) break;
      }
      if (!result) result = { move: legalAll[0], score: 0, mate: null, depth: 0, nodes: this.nodes, pv: [legalAll[0]], lines: [] };
      return result;
    }

    _root(b, depth, skip, prevBest) {
      let alpha = -INF, bestMove = 0, bestScore = -INF;
      const moves = b.legalMoves().filter(m => !skip.has(m));
      const scores = this._score(b, moves, prevBest, 0);
      const pv = [], childPV = [];
      const side = b.turn;
      let complete = false;
      for (let i = 0; i < moves.length; i++) {
        const m = this._pick(moves, scores, i);
        b._mk(m);
        childPV.length = 0;
        let v;
        if (i === 0) v = -this._negamax(b, depth - 1, -INF, -alpha, 1, true, childPV);
        else {
          v = -this._negamax(b, depth - 1, -alpha - 1, -alpha, 1, true, null);
          if (v > alpha && !this.stop) v = -this._negamax(b, depth - 1, -INF, -alpha, 1, true, childPV);
        }
        b._um();
        if (this.stop) { if (v > bestScore && i > 0 && v > alpha) { bestMove = m; bestScore = v; complete = false; } break; }
        if (v > bestScore) {
          bestScore = v; bestMove = m;
          if (v > alpha) { alpha = v; pv.length = 0; pv.push(m); for (const x of childPV) pv.push(x); }
        }
        complete = i === moves.length - 1;
      }
      return { move: bestMove, score: bestScore, pv: pv.length ? pv.slice() : (bestMove ? [bestMove] : []), complete };
    }
  }

  function scoreToMate(s) {
    if (s > MATE - 200) return Math.ceil((MATE - s) / 2);
    if (s < -MATE + 200) return -Math.ceil((MATE + s) / 2);
    return null;
  }

  const api = { Engine, evaluate, INF, MATE, scoreToMate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NexSearch = api;
})(typeof self !== "undefined" ? self : this);
