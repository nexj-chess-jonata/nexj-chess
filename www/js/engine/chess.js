/* Nex-J Chess (celular) — regras do xadrez em JavaScript puro.
 *
 * Substitui o python-chess no app offline. Casas 0..63 (a1=0, h8=63), como no python-chess.
 * Peça = tipo | (cor << 3): tipos P=1 N=2 B=3 R=4 Q=5 K=6; cor 0=brancas, 1=pretas.
 * Lance = inteiro: de | (para << 6) | (promoção << 12) | (flags << 15).
 * Funciona no navegador (window.NexChess) e no Node (require), para os testes.
 */
(function (root) {
  "use strict";

  const WHITE = 0, BLACK = 1;
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const FILES = "abcdefgh";
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const EP = 1, CASTLE = 2, DPUSH = 4;               // flags de lance
  const WK = 1, WQ = 2, BK = 4, BQ = 8;               // direitos de roque
  const PIECE_CH = ".PNBRQK";

  const sqName = s => FILES[s & 7] + ((s >> 3) + 1);
  const sqFrom = n => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 8;
  const fileOf = s => s & 7, rankOf = s => s >> 3;

  const mk = (from, to, promo = 0, flags = 0) => from | (to << 6) | (promo << 12) | (flags << 15);
  const mFrom = m => m & 63, mTo = m => (m >> 6) & 63, mPromo = m => (m >> 12) & 7, mFlags = m => m >> 15;

  // ---------------------------------------------------------------- tabelas
  const KNIGHT = [], KING = [], RAYS = [];   // RAYS[sq][dir] = casas em ordem
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];  // 0-3 retas, 4-7 diagonais
  for (let s = 0; s < 64; s++) {
    const f = s & 7, r = s >> 3;
    KNIGHT[s] = []; KING[s] = []; RAYS[s] = [];
    for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KNIGHT[s].push(nr * 8 + nf);
    }
    for (const [df, dr] of DIRS) {
      const nf = f + df, nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) KING[s].push(nr * 8 + nf);
      const ray = [];
      let cf = nf, cr = nr;
      while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) { ray.push(cr * 8 + cf); cf += df; cr += dr; }
      RAYS[s].push(ray);
    }
  }

  // Zobrist (duas palavras de 32 bits; gerador determinístico)
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  const ZP_LO = new Int32Array(16 * 64), ZP_HI = new Int32Array(16 * 64);
  for (let i = 0; i < 16 * 64; i++) { ZP_LO[i] = rnd(); ZP_HI[i] = rnd(); }
  const ZC_LO = new Int32Array(16), ZC_HI = new Int32Array(16);
  for (let i = 0; i < 16; i++) { ZC_LO[i] = rnd(); ZC_HI[i] = rnd(); }
  const ZE_LO = new Int32Array(8), ZE_HI = new Int32Array(8);
  for (let i = 0; i < 8; i++) { ZE_LO[i] = rnd(); ZE_HI[i] = rnd(); }
  const ZT_LO = rnd(), ZT_HI = rnd();

  // direitos de roque que sobram quando algo sai/chega nessa casa
  const CASTLE_MASK = new Int8Array(64).fill(15);
  CASTLE_MASK[0] = 15 & ~WQ; CASTLE_MASK[7] = 15 & ~WK; CASTLE_MASK[4] = 15 & ~(WK | WQ);
  CASTLE_MASK[56] = 15 & ~BQ; CASTLE_MASK[63] = 15 & ~BK; CASTLE_MASK[60] = 15 & ~(BK | BQ);

  class Board {
    constructor(fen) {
      this.sq = new Int8Array(64);
      this.turn = WHITE;
      this.castling = 0;
      this.ep = -1;
      this.halfmove = 0;
      this.fullmove = 1;
      this.kingSq = [4, 60];
      this.hLo = 0; this.hHi = 0;
      this.undo = [];        // pilha de desfazer
      this.moveStack = [];   // lances (inteiros) jogados a partir do FEN inicial
      this.keysLo = []; this.keysHi = [];   // chaves das posições (repetição)
      this.startFen = null;
      this.setFen(fen || START_FEN);
    }

    // ------------------------------------------------------------ FEN
    setFen(fen) {
      const parts = fen.trim().split(/\s+/);
      this.sq.fill(0);
      const rows = parts[0].split("/");
      for (let i = 0; i < 8; i++) {
        let f = 0;
        for (const ch of rows[i]) {
          if (ch >= "1" && ch <= "8") { f += +ch; continue; }
          const color = ch === ch.toUpperCase() ? WHITE : BLACK;
          const type = PIECE_CH.indexOf(ch.toUpperCase());
          const s = (7 - i) * 8 + f;
          this.sq[s] = type | (color << 3);
          if (type === K) this.kingSq[color] = s;
          f++;
        }
      }
      this.turn = (parts[1] || "w") === "w" ? WHITE : BLACK;
      this.castling = 0;
      const c = parts[2] || "-";
      if (c.includes("K")) this.castling |= WK;
      if (c.includes("Q")) this.castling |= WQ;
      if (c.includes("k")) this.castling |= BK;
      if (c.includes("q")) this.castling |= BQ;
      this._cleanCastling();
      this.ep = (parts[3] && parts[3] !== "-") ? sqFrom(parts[3]) : -1;
      this.halfmove = +(parts[4] || 0);
      this.fullmove = +(parts[5] || 1);
      this.undo = []; this.moveStack = []; this.keysLo = []; this.keysHi = [];
      this._rehash();
      this.keysLo.push(this.hLo); this.keysHi.push(this.hHi);
      this.startFen = this.fen();
    }

    // tira direitos de roque sem rei/torre no lugar (como o python-chess)
    _cleanCastling() {
      const w = this.sq[4] === (K | 0), b = this.sq[60] === (K | 8);
      if (!w || this.sq[7] !== (R | 0)) this.castling &= ~WK;
      if (!w || this.sq[0] !== (R | 0)) this.castling &= ~WQ;
      if (!b || this.sq[63] !== (R | 8)) this.castling &= ~BK;
      if (!b || this.sq[56] !== (R | 8)) this.castling &= ~BQ;
    }

    boardFen() {
      const rows = [];
      for (let r = 7; r >= 0; r--) {
        let row = "", empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.sq[r * 8 + f];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const ch = PIECE_CH[p & 7];
          row += (p >> 3) ? ch.toLowerCase() : ch;
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return rows.join("/");
    }

    // como o python-chess: só mostra a casa de en passant se houver captura legal
    fen() {
      let c = "";
      if (this.castling & WK) c += "K";
      if (this.castling & WQ) c += "Q";
      if (this.castling & BK) c += "k";
      if (this.castling & BQ) c += "q";
      const ep = this.legalEp();
      return `${this.boardFen()} ${this.turn === WHITE ? "w" : "b"} ${c || "-"} ${ep >= 0 ? sqName(ep) : "-"} ${this.halfmove} ${this.fullmove}`;
    }

    legalEp() {
      if (this.ep < 0 || !this._epPossible()) return -1;
      for (const m of this.pseudoMoves()) {
        if (mFlags(m) & EP && this._legal(m)) return this.ep;
      }
      return -1;
    }

    // ------------------------------------------------------------ hash
    _rehash() {
      let lo = 0, hi = 0;
      for (let s = 0; s < 64; s++) {
        const p = this.sq[s];
        if (p) { lo ^= ZP_LO[p * 64 + s]; hi ^= ZP_HI[p * 64 + s]; }
      }
      lo ^= ZC_LO[this.castling]; hi ^= ZC_HI[this.castling];
      if (this.ep >= 0 && this._epPossible()) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
      if (this.turn === BLACK) { lo ^= ZT_LO; hi ^= ZT_HI; }
      this.hLo = lo; this.hHi = hi;
    }

    // há peão do lado a jogar ao lado da casa ep? (aproximação barata para o hash)
    _epPossible() {
      const e = this.ep, side = this.turn, pawn = P | (side << 3);
      const base = side === WHITE ? e - 8 : e + 8;
      const f = e & 7;
      return (f > 0 && this.sq[base - 1] === pawn) || (f < 7 && this.sq[base + 1] === pawn);
    }

    posKey() { return this.hLo + ":" + this.hHi; }

    // ------------------------------------------------------------ ataques
    isAttacked(s, by) {
      const sq = this.sq;
      // peões
      const f = s & 7;
      if (by === WHITE) {
        if (s >= 8) {
          if (f > 0 && sq[s - 9] === P) return true;
          if (f < 7 && sq[s - 7] === P) return true;
        }
      } else if (s < 56) {
        if (f > 0 && sq[s + 7] === (P | 8)) return true;
        if (f < 7 && sq[s + 9] === (P | 8)) return true;
      }
      const sh = by << 3;
      for (const t of KNIGHT[s]) if (sq[t] === (N | sh)) return true;
      for (const t of KING[s]) if (sq[t] === (K | sh)) return true;
      const rays = RAYS[s];
      for (let d = 0; d < 8; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const p = sq[ray[i]];
          if (!p) continue;
          if ((p >> 3) === by) {
            const t = p & 7;
            if (t === Q || (d < 4 ? t === R : t === B)) return true;
          }
          break;
        }
      }
      return false;
    }

    inCheck() { return this.isAttacked(this.kingSq[this.turn], this.turn ^ 1); }

    // lista de casas das peças de `by` que atacam a casa s (python-chess: board.attackers)
    attackers(by, s) {
      const out = [], sq = this.sq, f = s & 7, sh = by << 3;
      if (by === WHITE) {
        if (s >= 8) {
          if (f > 0 && sq[s - 9] === P) out.push(s - 9);
          if (f < 7 && sq[s - 7] === P) out.push(s - 7);
        }
      } else if (s < 56) {
        if (f > 0 && sq[s + 7] === (P | 8)) out.push(s + 7);
        if (f < 7 && sq[s + 9] === (P | 8)) out.push(s + 9);
      }
      for (const t of KNIGHT[s]) if (sq[t] === (N | sh)) out.push(t);
      for (const t of KING[s]) if (sq[t] === (K | sh)) out.push(t);
      for (let d = 0; d < 8; d++) {
        for (const t of RAYS[s][d]) {
          const p = sq[t];
          if (!p) continue;
          if ((p >> 3) === by) {
            const ty = p & 7;
            if (ty === Q || (d < 4 ? ty === R : ty === B)) out.push(t);
          }
          break;
        }
      }
      return out;
    }

    // casas que a peça em s ataca (python-chess: board.attacks)
    attacks(s) {
      const p = this.sq[s];
      if (!p) return [];
      const type = p & 7, color = p >> 3, out = [];
      if (type === P) {
        const f = s & 7, r = s >> 3, nr = color === WHITE ? r + 1 : r - 1;
        if (nr >= 0 && nr < 8) {
          if (f > 0) out.push(nr * 8 + f - 1);
          if (f < 7) out.push(nr * 8 + f + 1);
        }
      } else if (type === N) return KNIGHT[s].slice();
      else if (type === K) return KING[s].slice();
      else {
        const from = type === B ? 4 : 0, to = type === R ? 4 : 8;
        for (let d = from; d < to; d++) {
          for (const t of RAYS[s][d]) { out.push(t); if (this.sq[t]) break; }
        }
      }
      return out;
    }

    // ------------------------------------------------------------ geração
    pseudoMoves(capturesOnly = false) {
      const out = [], sq = this.sq, us = this.turn, them = us ^ 1;
      const sh = us << 3;
      for (let s = 0; s < 64; s++) {
        const p = sq[s];
        if (!p || (p >> 3) !== us) continue;
        const type = p & 7;
        if (type === P) {
          const f = s & 7, r = s >> 3;
          const dir = us === WHITE ? 8 : -8;
          const promoRank = us === WHITE ? 6 : 1, startRank = us === WHITE ? 1 : 6;
          const one = s + dir;
          if (!sq[one]) {
            if (r === promoRank) {
              for (let pr = Q; pr >= N; pr--) out.push(mk(s, one, pr));
            } else if (!capturesOnly) {
              out.push(mk(s, one));
              if (r === startRank && !sq[one + dir]) out.push(mk(s, one + dir, 0, DPUSH));
            }
          }
          for (const df of [-1, 1]) {
            const nf = f + df;
            if (nf < 0 || nf > 7) continue;
            const t = one + df;
            const tp = sq[t];
            if (tp && (tp >> 3) === them) {
              if (r === promoRank) for (let pr = Q; pr >= N; pr--) out.push(mk(s, t, pr));
              else out.push(mk(s, t));
            } else if (t === this.ep && !tp) {
              out.push(mk(s, t, 0, EP));
            }
          }
        } else if (type === N || type === K) {
          const list = type === N ? KNIGHT[s] : KING[s];
          for (let i = 0; i < list.length; i++) {
            const t = list[i], tp = sq[t];
            if (!tp) { if (!capturesOnly) out.push(mk(s, t)); }
            else if ((tp >> 3) === them) out.push(mk(s, t));
          }
        } else {
          const from = type === B ? 4 : 0, to = type === R ? 4 : 8;
          for (let d = from; d < to; d++) {
            const ray = RAYS[s][d];
            for (let i = 0; i < ray.length; i++) {
              const t = ray[i], tp = sq[t];
              if (!tp) { if (!capturesOnly) out.push(mk(s, t)); continue; }
              if ((tp >> 3) === them) out.push(mk(s, t));
              break;
            }
          }
        }
      }
      if (!capturesOnly) this._castleMoves(out);
      return out;
    }

    _castleMoves(out) {
      const us = this.turn, them = us ^ 1, sq = this.sq;
      if (us === WHITE) {
        if (sq[4] !== K) return;
        if ((this.castling & WK) && !sq[5] && !sq[6] && !this.isAttacked(4, them) && !this.isAttacked(5, them) && !this.isAttacked(6, them))
          out.push(mk(4, 6, 0, CASTLE));
        if ((this.castling & WQ) && !sq[3] && !sq[2] && !sq[1] && !this.isAttacked(4, them) && !this.isAttacked(3, them) && !this.isAttacked(2, them))
          out.push(mk(4, 2, 0, CASTLE));
      } else {
        if (sq[60] !== (K | 8)) return;
        if ((this.castling & BK) && !sq[61] && !sq[62] && !this.isAttacked(60, them) && !this.isAttacked(61, them) && !this.isAttacked(62, them))
          out.push(mk(60, 62, 0, CASTLE));
        if ((this.castling & BQ) && !sq[59] && !sq[58] && !sq[57] && !this.isAttacked(60, them) && !this.isAttacked(59, them) && !this.isAttacked(58, them))
          out.push(mk(60, 58, 0, CASTLE));
      }
    }

    _legal(m) {
      const us = this.turn;
      this._make(m);
      const bad = this.isAttacked(this.kingSq[us], us ^ 1);
      this._unmake();
      return !bad;
    }

    legalMoves(capturesOnly = false) {
      const out = [];
      for (const m of this.pseudoMoves(capturesOnly)) if (this._legal(m)) out.push(m);
      return out;
    }

    // ------------------------------------------------------------ jogar / desfazer
    // versão interna (sem pilha pública de lances)
    _make(m) {
      const sq = this.sq, from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, flags = m >> 15;
      const piece = sq[from], us = this.turn;
      let captured = sq[to];
      const rec = { m, captured: 0, castling: this.castling, ep: this.ep, half: this.halfmove, lo: this.hLo, hi: this.hHi, capSq: to };
      let lo = this.hLo, hi = this.hHi;
      // tira o en passant antigo do hash
      if (this.ep >= 0 && this._epPossible()) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
      lo ^= ZC_LO[this.castling]; hi ^= ZC_HI[this.castling];

      if (flags & EP) {
        const cs = us === WHITE ? to - 8 : to + 8;
        captured = sq[cs];
        rec.capSq = cs;
        sq[cs] = 0;
        lo ^= ZP_LO[captured * 64 + cs]; hi ^= ZP_HI[captured * 64 + cs];
      } else if (captured) {
        lo ^= ZP_LO[captured * 64 + to]; hi ^= ZP_HI[captured * 64 + to];
      }
      rec.captured = captured;

      sq[from] = 0;
      lo ^= ZP_LO[piece * 64 + from]; hi ^= ZP_HI[piece * 64 + from];
      const placed = promo ? (promo | (us << 3)) : piece;
      sq[to] = placed;
      lo ^= ZP_LO[placed * 64 + to]; hi ^= ZP_HI[placed * 64 + to];
      if ((piece & 7) === K) this.kingSq[us] = to;

      if (flags & CASTLE) {
        let rf, rt;
        if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        const rook = sq[rf];
        sq[rf] = 0; sq[rt] = rook;
        lo ^= ZP_LO[rook * 64 + rf] ^ ZP_LO[rook * 64 + rt];
        hi ^= ZP_HI[rook * 64 + rf] ^ ZP_HI[rook * 64 + rt];
      }

      this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
      this.ep = (flags & DPUSH) ? (us === WHITE ? from + 8 : from - 8) : -1;
      this.halfmove = ((piece & 7) === P || captured) ? 0 : this.halfmove + 1;
      if (us === BLACK) this.fullmove++;
      this.turn = us ^ 1;
      lo ^= ZT_LO; hi ^= ZT_HI;
      lo ^= ZC_LO[this.castling]; hi ^= ZC_HI[this.castling];
      if (this.ep >= 0 && this._epPossible()) { lo ^= ZE_LO[this.ep & 7]; hi ^= ZE_HI[this.ep & 7]; }
      this.hLo = lo; this.hHi = hi;
      rec.piece = piece;
      this.undo.push(rec);
    }

    _unmake() {
      const rec = this.undo.pop();
      const sq = this.sq, m = rec.m, from = m & 63, to = (m >> 6) & 63, flags = m >> 15;
      this.turn ^= 1;
      const us = this.turn;
      if (us === BLACK) this.fullmove--;
      sq[from] = rec.piece;
      sq[to] = 0;
      if (flags & EP) { sq[rec.capSq] = rec.captured; }
      else if (rec.captured) sq[to] = rec.captured;
      if ((rec.piece & 7) === K) this.kingSq[us] = from;
      if (flags & CASTLE) {
        let rf, rt;
        if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
        sq[rf] = sq[rt]; sq[rt] = 0;
      }
      this.castling = rec.castling; this.ep = rec.ep; this.halfmove = rec.half;
      this.hLo = rec.lo; this.hHi = rec.hi;
    }

    // jogada "pública": guarda o lance e a chave da posição
    push(m) {
      this._make(m);
      this.moveStack.push(m);
      this.keysLo.push(this.hLo); this.keysHi.push(this.hHi);
    }

    pop() {
      this._unmake();
      this.keysLo.pop(); this.keysHi.pop();
      return this.moveStack.pop();
    }

    // versões leves para o motor de busca (sem pilha pública de lances)
    _mk(m) { this._make(m); this.keysLo.push(this.hLo); this.keysHi.push(this.hHi); }
    _um() { this._unmake(); this.keysLo.pop(); this.keysHi.pop(); }

    // null move (para o motor)
    makeNull() {
      const rec = { ep: this.ep, lo: this.hLo, hi: this.hHi, half: this.halfmove };
      if (this.ep >= 0 && this._epPossible()) { this.hLo ^= ZE_LO[this.ep & 7]; this.hHi ^= ZE_HI[this.ep & 7]; }
      this.ep = -1;
      this.turn ^= 1;
      this.hLo ^= ZT_LO; this.hHi ^= ZT_HI;
      this.halfmove++;
      this.undo.push(rec);
      this.keysLo.push(this.hLo); this.keysHi.push(this.hHi);
    }
    unmakeNull() {
      this.keysLo.pop(); this.keysHi.pop();
      const rec = this.undo.pop();
      this.turn ^= 1;
      this.ep = rec.ep; this.hLo = rec.lo; this.hHi = rec.hi; this.halfmove = rec.half;
    }

    // ------------------------------------------------------------ UCI / SAN
    uci(m) {
      return sqName(m & 63) + sqName((m >> 6) & 63) + (((m >> 12) & 7) ? PIECE_CH[(m >> 12) & 7].toLowerCase() : "");
    }

    // devolve o lance legal (inteiro) com esse UCI, ou 0
    moveFromUci(uci) {
      if (!uci || uci.length < 4) return 0;
      const from = sqFrom(uci.slice(0, 2)), to = sqFrom(uci.slice(2, 4));
      const promo = uci.length > 4 ? PIECE_CH.indexOf(uci[4].toUpperCase()) : 0;
      for (const m of this.legalMoves()) {
        if ((m & 63) === from && ((m >> 6) & 63) === to && ((m >> 12) & 7) === promo) return m;
      }
      return 0;
    }

    pushUci(uci) {
      const m = this.moveFromUci(uci);
      if (!m) throw new Error("Lance ilegal: " + uci);
      this.push(m);
      return m;
    }

    isCapture(m) {
      return !!this.sq[(m >> 6) & 63] || !!((m >> 15) & EP);
    }
    isCastling(m) { return !!((m >> 15) & CASTLE); }
    isEnPassant(m) { return !!((m >> 15) & EP); }

    givesCheck(m) {
      this._make(m);
      const chk = this.inCheck();
      this._unmake();
      return chk;
    }

    san(m, legal) {
      const sq = this.sq, from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, flags = m >> 15;
      const piece = sq[from], type = piece & 7;
      let s;
      if (flags & CASTLE) s = to > from ? "O-O" : "O-O-O";
      else {
        const cap = this.isCapture(m);
        if (type === P) {
          s = cap ? FILES[from & 7] + "x" : "";
          s += sqName(to);
          if (promo) s += "=" + PIECE_CH[promo];
        } else {
          s = PIECE_CH[type];
          legal = legal || this.legalMoves();
          let amb = false, sameFile = false, sameRank = false;
          for (const o of legal) {
            if (o === m) continue;
            if (((o >> 6) & 63) === to && sq[o & 63] === piece && ((o >> 12) & 7) === 0) {
              amb = true;
              if ((o & 7) === (from & 7)) sameFile = true;   // mesma coluna
              if (((o & 63) >> 3) === (from >> 3)) sameRank = true;
            }
          }
          if (amb) {
            if (!sameFile) s += FILES[from & 7];
            else if (!sameRank) s += (from >> 3) + 1;
            else s += sqName(from);
          }
          if (cap) s += "x";
          s += sqName(to);
        }
      }
      this._make(m);
      if (this.inCheck()) s += this.legalMoves().length ? "+" : "#";
      this._unmake();
      return s;
    }

    // aceita SAN ("Nf3", "O-O", "exd5", "e8=Q"), com ou sem +/#
    moveFromSan(san) {
      const clean = san.replace(/[+#!?]/g, "").replace(/0/g, "O");
      const legal = this.legalMoves();
      for (const m of legal) if (this.san(m, legal).replace(/[+#]/g, "") === clean) return m;
      return 0;
    }

    // ------------------------------------------------------------ estado da partida
    isCheck() { return this.inCheck(); }
    isCheckmate() { return this.inCheck() && this.legalMoves().length === 0; }
    isStalemate() { return !this.inCheck() && this.legalMoves().length === 0; }

    hasInsufficientMaterial(color) {
      const mine = [], theirs = [];
      let bishopsLight = false, bishopsDark = false, anyPawnOrKnightOrBishop = false;
      for (let s = 0; s < 64; s++) {
        const p = this.sq[s];
        if (!p) continue;
        if ((p >> 3) === color) mine.push(p & 7); else theirs.push(p & 7);
      }
      if (mine.some(t => t === P || t === R || t === Q)) return false;
      if (mine.includes(N)) {
        return mine.length <= 2 && !theirs.some(t => t !== K && t !== Q);
      }
      if (mine.includes(B)) {
        let light = false, dark = false, hasPN = false;
        for (let s = 0; s < 64; s++) {
          const p = this.sq[s];
          if (!p) continue;
          const t = p & 7;
          if (t === B) { ((s & 7) + (s >> 3)) % 2 === 0 ? dark = true : light = true; }
          if (t === P || t === N) hasPN = true;
        }
        return !(light && dark) && !hasPN;
      }
      return true;
    }
    isInsufficientMaterial() { return this.hasInsufficientMaterial(WHITE) && this.hasInsufficientMaterial(BLACK); }

    repetitionCount() {
      const n = this.keysLo.length, lo = this.keysLo[n - 1], hi = this.keysHi[n - 1];
      let c = 0;
      for (let i = n - 1; i >= 0; i--) if (this.keysLo[i] === lo && this.keysHi[i] === hi) c++;
      return c;
    }
    isRepetition(count = 3) { return this.repetitionCount() >= count; }
    isFivefold() { return this.repetitionCount() >= 5; }
    isFiftyMoves() { return this.halfmove >= 100 && this.legalMoves().length > 0; }
    isSeventyFiveMoves() { return this.halfmove >= 150 && !this.isCheckmate(); }

    // "pode pedir empate": já aconteceu OU o próximo lance legal faria acontecer (igual ao python-chess)
    canClaimFiftyMoves() {
      if (this.isFiftyMoves()) return true;
      if (this.halfmove >= 99) {
        for (const m of this.legalMoves()) {
          const zeroing = this.isCapture(m) || (this.sq[m & 63] & 7) === P;
          if (!zeroing) {
            this._make(m);
            const hm = this.halfmove;
            const any = hm >= 100 && this.legalMoves().length > 0;
            this._unmake();
            if (any) return true;
          }
        }
      }
      return false;
    }
    canClaimThreefold() {
      const counts = new Map();
      const n = this.keysLo.length;
      for (let i = 0; i < n; i++) { const k = this.keysLo[i] + ":" + this.keysHi[i]; counts.set(k, (counts.get(k) || 0) + 1); }
      const cur = this.keysLo[n - 1] + ":" + this.keysHi[n - 1];
      if (counts.get(cur) >= 3) return true;
      for (const m of this.legalMoves()) {
        this._make(m);
        const k = this.hLo + ":" + this.hHi;
        this._unmake();
        if ((counts.get(k) || 0) >= 2) return true;
      }
      return false;
    }

    /** Como board.outcome() do python-chess. Devolve {termination, winner} ou null. winner: 0, 1 ou null. */
    outcome(claimDraw = false) {
      const legal = this.legalMoves();
      if (!legal.length) {
        if (this.inCheck()) return { termination: "CHECKMATE", winner: this.turn ^ 1 };
        return { termination: "STALEMATE", winner: null };
      }
      if (this.isInsufficientMaterial()) return { termination: "INSUFFICIENT_MATERIAL", winner: null };
      if (this.halfmove >= 150) return { termination: "SEVENTYFIVE_MOVES", winner: null };
      if (this.isFivefold()) return { termination: "FIVEFOLD_REPETITION", winner: null };
      if (claimDraw) {
        if (this.canClaimFiftyMoves()) return { termination: "FIFTY_MOVES", winner: null };
        if (this.canClaimThreefold()) return { termination: "THREEFOLD_REPETITION", winner: null };
      }
      return null;
    }
    isGameOver(claimDraw = false) { return this.outcome(claimDraw) !== null; }

    // ------------------------------------------------------------ utilidades
    pieceAt(s) {
      const p = this.sq[s];
      return p ? { type: p & 7, color: p >> 3, symbol: (p >> 3) ? PIECE_CH[p & 7].toLowerCase() : PIECE_CH[p & 7] } : null;
    }
    pieceMap() {
      const out = {};
      for (let s = 0; s < 64; s++) if (this.sq[s]) out[s] = this.pieceAt(s);
      return out;
    }
    king(color) { return this.kingSq[color]; }

    copy() {
      const b = new Board(this.startFen);
      for (const m of this.moveStack) b.push(m);
      return b;
    }

    // cópia rápida da posição atual (sem histórico de lances)
    snapshot() { return new Board(this.fen()); }

    /** PGN simples da partida (cabeçalhos em `headers`). */
    pgn(headers = {}) {
      const b = new Board(this.startFen);
      const lines = [];
      const h = Object.assign({ Event: "Nex-J Chess", Site: "?", Date: "????.??.??", Round: "?", White: "?", Black: "?", Result: "*" }, headers);
      for (const k of Object.keys(h)) lines.push(`[${k} "${String(h[k]).replace(/"/g, "'")}"]`);
      const toks = [];
      for (const m of this.moveStack) {
        const n = b.fullmove;
        if (b.turn === WHITE) toks.push(`${n}. ${b.san(m)}`); else toks.push(`${b.san(m)}`);
        b.push(m);
      }
      toks.push(h.Result);
      return lines.join("\n") + "\n\n" + toks.join(" ");
    }

    // perft para os testes
    perft(depth) {
      if (depth === 0) return 1;
      let n = 0;
      for (const m of this.pseudoMoves()) {
        const us = this.turn;
        this._make(m);
        if (!this.isAttacked(this.kingSq[us], us ^ 1)) n += depth === 1 ? 1 : this.perft(depth - 1);
        this._unmake();
      }
      return n;
    }
  }

  const api = {
    Board, WHITE, BLACK, P, N, B, R, Q, K, START_FEN, FILES, PIECE_CH,
    EP, CASTLE, DPUSH, mk, mFrom, mTo, mPromo, mFlags, sqName, sqFrom, fileOf, rankOf,
    KNIGHT, KING, RAYS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NexChess = api;
})(typeof self !== "undefined" ? self : this);
