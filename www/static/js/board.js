/* NexusBoard — tabuleiro interativo sem dependências.
 * - clique-e-clique ou arrastar (mouse e toque)
 * - marca lances legais, último lance, xeque
 * - animação do lance do adversário
 * - seletor de promoção
 */
(function () {
  const FILES = "abcdefgh";
  // Peças ficam dentro do jogo (static/pieces/<conjunto>/), então funcionam sem internet.
  let pieceSet = "cburnett";
  const pieceUrl = code => `static/pieces/${pieceSet}/${code}.svg`;
  const UNICODE = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };

  function parseFen(fen) {
    const map = {};
    const rows = fen.split(" ")[0].split("/");
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        map[FILES[f] + (8 - r)] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
        f++;
      }
    });
    return map;
  }

  // Se as imagens das peças não carregarem (sem internet), passa a usar símbolos Unicode.
  let useGlyphs = false;

  function pieceEl(code) {
    const el = document.createElement("div");
    el.className = "nb-piece " + (code[0] === "w" ? "white" : "black");
    el.dataset.code = code;
    const glyph = () => { el.textContent = UNICODE[code[1]]; el.classList.add("glyph"); };
    if (useGlyphs) { glyph(); return el; }
    const img = document.createElement("img");
    img.src = pieceUrl(code);
    img.dataset.code = code;
    img.alt = code;
    img.draggable = false;
    img.onerror = () => { useGlyphs = true; img.remove(); glyph(); };
    el.appendChild(img);
    return el;
  }

  class NexusBoard {
    constructor(el, opts = {}) {
      this.el = el;
      this.onMove = opts.onMove || (() => {});
      this.orientation = "white";
      this.playerColor = "w";
      this.position = parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      this.legal = [];
      this.interactive = false;
      this.selected = null;
      this.lastMove = null;
      this.check = null;
      this.drag = null;
      this.premoveAllowed = false;  // vez do adversário: dá para marcar um pré-movimento
      this.premoves = [];           // fila de pré-movimentos: [{from, to}, ...] (vários em sequência)
      this.el.classList.add("nb-board");
      this._build();
      this._bindPointer();
    }

    /* ---------- API pública ---------- */
    setOrientation(color) { this.orientation = color; this.playerColor = color[0]; this._build(); this.render(); }
    setState({ fen, legal = [], lastMove = null, check = null, interactive = false, animate = false, badge = null,
                arrows = [], mark = null, premoveOk = false }) {
      this.premoveAllowed = !!premoveOk && !interactive && !(window.NexPrefs && NexPrefs.get("premove") === false);
      if (!this.premoveAllowed && !interactive) this.premoves = [];
      this.badge = badge; // {square, symbol, hex}: ícone da classificação do lance (análise)
      this.arrows = arrows; // [{from, to, color}] setas (treinador, dicas)
      this.mark = mark;     // casa destacada (dica)
      this.position = parseFen(fen);
      this.legal = legal;
      this.lastMove = lastMove;
      this.check = check;
      this.interactive = interactive;
      this.selected = null;
      this.render();
      if (animate && lastMove) this._animate(lastMove.slice(0, 2), lastMove.slice(2, 4));
    }

    /* ---------- construção ---------- */
    _build() {
      this.el.innerHTML = "";
      this.squares = {};
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const file = this.orientation === "white" ? f : 7 - f;
          const rank = this.orientation === "white" ? 7 - r : r;
          const name = FILES[file] + (rank + 1);
          const sq = document.createElement("div");
          sq.className = "nb-sq " + ((file + rank) % 2 ? "light" : "dark");
          sq.dataset.square = name;
          if (f === 0) sq.insertAdjacentHTML("beforeend", `<span class="nb-coord rank">${rank + 1}</span>`);
          if (r === 7) sq.insertAdjacentHTML("beforeend", `<span class="nb-coord file">${FILES[file]}</span>`);
          this.el.appendChild(sq);
          this.squares[name] = sq;
        }
      }
    }

    /* ---------- setas e destaque (treinador / dicas) ---------- */
    setArrows(arrows = [], mark = this.mark) {
      this.arrows = arrows;
      this.mark = mark;
      this._drawArrows();
    }

    _xy(square) {
      const f = FILES.indexOf(square[0]), r = +square[1] - 1;
      const col = this.orientation === "white" ? f : 7 - f;
      const row = this.orientation === "white" ? 7 - r : r;
      return [col + 0.5, row + 0.5];
    }

    _drawArrows() {
      let svg = this.el.querySelector(".nb-arrows");
      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "nb-arrows");
        svg.setAttribute("viewBox", "0 0 8 8");
        this.el.appendChild(svg);
      }
      let html = `<defs>${["good", "bad", "hint", "pre"].map(k =>
        `<marker id="nb-head-${k}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L4,2 L0,4 Z" class="head-${k}"/></marker>`).join("")}</defs>`;
      if (this.mark) {
        const [x, y] = this._xy(this.mark);
        html += `<circle cx="${x}" cy="${y}" r="0.44" class="nb-mark"/>`;
      }
      this.premoves.forEach(m => {
        const [x1, y1] = this._xy(m.from), [x2, y2] = this._xy(m.to);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ex = x2 - ((x2 - x1) / len) * 0.32, ey = y2 - ((y2 - y1) / len) * 0.32;
        html += `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" class="nb-arrow pre" marker-end="url(#nb-head-pre)"/>`;
      });
      (this.arrows || []).forEach(a => {
        if (!a || !a.from || !a.to) return;
        const [x1, y1] = this._xy(a.from), [x2, y2] = this._xy(a.to);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ex = x2 - ((x2 - x1) / len) * 0.32, ey = y2 - ((y2 - y1) / len) * 0.32;
        const k = a.color || "good";
        html += `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" class="nb-arrow ${k}" marker-end="url(#nb-head-${k})"/>`;
      });
      svg.innerHTML = html;
    }

    render() {
      const targets = this.selected ? this._targets(this.selected) : [];
      const shown = this._shown();
      const preSq = new Set();
      this.premoves.forEach(m => { preSq.add(m.from); preSq.add(m.to); });
      for (const [name, sq] of Object.entries(this.squares)) {
        sq.querySelector(".nb-hint")?.remove();
        sq.querySelector(".nb-badge")?.remove();
        sq.classList.toggle("last", !!this.lastMove && (this.lastMove.slice(0, 2) === name || this.lastMove.slice(2, 4) === name));
        sq.classList.toggle("check", this.check === name);
        sq.classList.toggle("selected", this.selected === name);
        sq.classList.toggle("premove", preSq.has(name));
        const code = shown[name];
        // só troca a peça se mudou (evita recriar as 32 imagens a cada toque = tremida/piscada)
        const cur = sq.querySelector(".nb-piece");
        if (cur && (!code || cur.dataset.code !== code || cur.classList.contains("nb-dragging"))) { cur.remove(); }
        if (code && !sq.querySelector(".nb-piece")) sq.appendChild(pieceEl(code));
        if (this.badge && this.badge.square === name) {
          const b = document.createElement("div");
          b.className = "nb-badge";
          b.textContent = this.badge.symbol;
          b.style.background = this.badge.hex;
          sq.appendChild(b);
          sq.style.setProperty("--badge", this.badge.hex);
          sq.classList.add("badged");
        } else if (sq.classList.contains("badged")) {
          sq.classList.remove("badged");
        }
        if (targets.includes(name)) {
          const hint = document.createElement("div");
          hint.className = "nb-hint " + (code ? "nb-cap" : "nb-dot");
          sq.appendChild(hint);
        }
      }
      this._drawArrows();
    }

    _pre() { return !this.interactive && this.premoveAllowed; }

    /* movimentos "quase legais" (sem checar xeque) para o pré-movimento */
    _pseudo(from) {
      const pos = this._shown();
      const code = pos[from];
      if (!code) return [];
      const color = code[0], type = code[1];
      const f0 = FILES.indexOf(from[0]), r0 = +from[1] - 1, out = [];
      const at = (f, r) => (f < 0 || f > 7 || r < 0 || r > 7) ? null : FILES[f] + (r + 1);
      const push = (f, r) => {
        const sq = at(f, r);
        if (!sq) return false;
        const o = pos[sq];
        if (o && o[0] === color) return false;
        out.push(sq);
        return !o;
      };
      const slide = dirs => dirs.forEach(([df, dr]) => { let f = f0 + df, r = r0 + dr; while (push(f, r)) { f += df; r += dr; } });
      const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], STR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (type === "N") [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([a, b]) => push(f0 + a, r0 + b));
      else if (type === "B") slide(DIAG);
      else if (type === "R") slide(STR);
      else if (type === "Q") slide(DIAG.concat(STR));
      else if (type === "K") {
        DIAG.concat(STR).forEach(([a, b]) => push(f0 + a, r0 + b));
        const home = color === "w" ? "e1" : "e8";
        if (from === home) { out.push("g" + home[1]); out.push("c" + home[1]); }  // roque (o servidor confere)
      } else if (type === "P") {
        const dir = color === "w" ? 1 : -1, start = color === "w" ? 1 : 6;
        const one = at(f0, r0 + dir);
        if (one && !pos[one]) {
          out.push(one);
          const two = at(f0, r0 + 2 * dir);
          if (r0 === start && two && !pos[two]) out.push(two);
        }
        [-1, 1].forEach(df => {
          const sq = at(f0 + df, r0 + dir);
          if (sq && !(pos[sq] && pos[sq][0] === color)) out.push(sq);
        });
      }
      return out;
    }

    /* posição "virtual": a real com os pré-movimentos da fila já aplicados (só para desenhar e escolher o próximo) */
    _shown() {
      if (!this._pre() || !this.premoves.length) return this.position;
      const pos = Object.assign({}, this.position);
      this.premoves.forEach(m => this._apply(pos, m.from, m.to, m.promo || null));
      return pos;
    }

    /* aplica um lance no mapa de peças (en passant, roque e promoção à dama incluídos) */
    _apply(pos, from, to, promo) {
      const code = pos[from];
      if (!code) return;
      delete pos[from];
      if (code[1] === "P" && from[0] !== to[0] && !pos[to]) delete pos[to[0] + from[1]];
      if (code[1] === "K" && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
        const rank = from[1];
        const [rf, rt] = to[0] === "g" ? ["h", "f"] : ["a", "d"];
        if (pos[rf + rank]) { pos[rt + rank] = pos[rf + rank]; delete pos[rf + rank]; }
      }
      const last = to[1] === "8" || to[1] === "1";
      pos[to] = promo ? code[0] + promo.toUpperCase() : (code[1] === "P" && last ? code[0] + "Q" : code);
    }

    setPremove(from, to, promo = null) {
      this.premoves.push({ from, to, promo });   // acrescenta à fila
      this.selected = null;
      this.render();
    }
    clearPremove() {
      if (!this.premoves.length && !this.selected) return;
      this.premoves = [];
      this.selected = null;
      this.render();
    }
    takePremove() { return this.premoves.shift() || null; }   // tira o primeiro da fila; o resto continua
    playMove(uci) { this._commit(uci, uci.slice(0, 2), uci.slice(2, 4)); }

    _targets(from) {
      if (this._pre()) return this._pseudo(from);
      return [...new Set(this.legal.filter(m => m.startsWith(from)).map(m => m.slice(2, 4)))];
    }

    _isMine(square) {
      if (this._pre()) { const c = this._shown()[square]; return !!c && c[0] === this.playerColor; }
      const code = this.position[square];
      return code && code[0] === this.playerColor && this.legal.some(m => m.startsWith(square));
    }

    /* ---------- interação ---------- */
    _bindPointer() {
      this.el.addEventListener("pointerdown", e => this._down(e));
      window.addEventListener("pointermove", e => this._moveDrag(e));
      window.addEventListener("pointerup", e => this._up(e));
      this.el.addEventListener("contextmenu", e => { e.preventDefault(); if (this.premoves.length || this.selected) this.clearPremove(); });
    }

    _squareAt(x, y) {
      const el = document.elementFromPoint(x, y);
      return el?.closest?.(".nb-sq")?.dataset.square || null;
    }

    _down(e) {
      if ((!this.interactive && !this._pre()) || e.button > 0) return;
      const sq = e.target.closest(".nb-sq")?.dataset.square;
      if (!sq) return;
      e.preventDefault();

      // já existe peça selecionada e clicou num destino válido → joga
      if (this.selected && this._targets(this.selected).includes(sq)) {
        this._tryMove(this.selected, sq);
        return;
      }
      if (this._isMine(sq)) {
        const wasSelected = this.selected === sq;
        this.selected = sq;
        this.render();
        this._startDrag(sq, e, wasSelected);
      } else if (this.selected) {
        this.selected = null;
        this.render();
      } else if (this._pre() && this.premoves.length) {
        this.clearPremove();
      }
    }

    _startDrag(square, e, wasSelected) {
      const pieceNode = this.squares[square].querySelector(".nb-piece");
      if (!pieceNode) return;
      const size = this.squares[square].getBoundingClientRect().width;
      this.drag = { from: square, ghost: null, pieceNode, size, wasSelected, moved: false, x0: e.clientX, y0: e.clientY };
    }

    _makeGhost(x, y) {
      const d = this.drag;
      const ghost = d.pieceNode.cloneNode(true);
      ghost.classList.add("nb-ghost");
      ghost.style.width = ghost.style.height = d.size + "px";
      document.body.appendChild(ghost);
      d.pieceNode.classList.add("nb-dragging");
      d.ghost = ghost;
      this._placeGhost(x, y);
    }

    _placeGhost(x, y) {
      const d = this.drag;
      if (!d.ghost) return;
      d.ghost.style.transform = `translate(${x - d.size / 2}px, ${y - d.size / 2}px)`;
    }

    _moveDrag(e) {
      if (!this.drag) return;
      if (!this.drag.moved && Math.abs(e.clientX - this.drag.x0) + Math.abs(e.clientY - this.drag.y0) > 8) { this.drag.moved = true; this._makeGhost(e.clientX, e.clientY); }
      if (!this.drag.moved) return;
      this._placeGhost(e.clientX, e.clientY);
      const over = this._squareAt(e.clientX, e.clientY);
      Object.values(this.squares).forEach(s => s.classList.toggle("hover", s.dataset.square === over && this.drag.moved));
    }

    _up(e) {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      if (d.ghost) d.ghost.remove();
      d.pieceNode.classList.remove("nb-dragging");
      Object.values(this.squares).forEach(s => s.classList.remove("hover"));
      const to = this._squareAt(e.clientX, e.clientY);

      if (to && to !== d.from && this._targets(d.from).includes(to)) {
        this._tryMove(d.from, to);
        return;
      }
      if (to === d.from && d.wasSelected && !d.moved) {
        this.selected = null; // clicou de novo na mesma peça → desseleciona
      }
      this.render();
    }

    _tryMove(from, to) {
      if (this._pre()) {
        const pc = this._shown()[from];
        if (pc && pc[1] === "P" && (to[1] === "8" || to[1] === "1")) {   // promoção num pré-movimento: escolhe a peça
          this._askPromotion(to, piece => piece ? this.setPremove(from, to, piece) : this.render());
        } else this.setPremove(from, to);
        return;
      }
      const base = from + to;
      const options = this.legal.filter(m => m.startsWith(base));
      if (!options.length) return;
      if (options.some(m => m.length === 5)) {
        this._askPromotion(to, piece => piece ? this._commit(base + piece, from, to) : this.render());
      } else {
        this._commit(base, from, to);
      }
    }

    _commit(uci, from, to) {
      // atualização otimista para o lance aparecer na hora
      this._apply(this.position, from, to, uci.length === 5 ? uci[4] : null);
      this.lastMove = uci;
      this.check = null;
      this.selected = null;
      this.arrows = [];
      this.mark = null;
      this.interactive = false;
      this.legal = [];
      this.render();
      this.onMove(uci);
    }

    _askPromotion(square, cb) {
      if (window.NexPrefs && NexPrefs.get("autoQueen")) { cb("q"); return; }  // Configurações: promover sempre a dama
      const box = document.getElementById("promo");
      const c = this.playerColor;
      box.innerHTML = "";
      ["q", "r", "b", "n"].forEach(p => {
        const b = document.createElement("button");
        b.appendChild(pieceEl(c + p.toUpperCase()));
        b.onclick = () => { box.classList.remove("open"); cb(p); };
        box.appendChild(b);
      });
      const cancel = document.createElement("button");
      cancel.className = "promo-cancel";
      cancel.textContent = "✕";
      cancel.onclick = () => { box.classList.remove("open"); cb(null); };
      box.appendChild(cancel);
      const r = this.squares[square].getBoundingClientRect();
      box.style.left = Math.min(window.innerWidth - 70, Math.max(6, r.left)) + "px";
      box.style.top = Math.max(6, Math.min(window.innerHeight - 300, r.top)) + "px";
      box.classList.add("open");
    }

    _animate(from, to) {
      const piece = this.squares[to]?.querySelector(".nb-piece");
      if (!piece) return;
      const a = this.squares[from].getBoundingClientRect();
      const b = this.squares[to].getBoundingClientRect();
      piece.style.transition = "none";
      piece.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      piece.style.zIndex = 5;
      piece.getBoundingClientRect(); // força reflow
      piece.style.transition = "transform 220ms cubic-bezier(.2,.8,.2,1)";
      piece.style.transform = "translate(0,0)";
      setTimeout(() => { piece.style.zIndex = ""; }, 240);
    }
  }

  // troca o conjunto de peças de todos os tabuleiros abertos
  NexusBoard.setPieceSet = function (name) {
    if (!name || name === pieceSet) return;
    pieceSet = name;
    useGlyphs = false;
    document.querySelectorAll(".nb-piece img[data-code]").forEach(img => { img.src = pieceUrl(img.dataset.code); });
  };
  NexusBoard.pieceUrl = (set, code) => `static/pieces/${set}/${code}.svg`;

  window.NexusBoard = NexusBoard;
})();
