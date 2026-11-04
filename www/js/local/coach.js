/* Nex-J Chess (celular) — Treinador: comentários que ensinam depois de cada lance (porta de core/coach.py). */
(function (root) {
  "use strict";
  const C = root.NexChess, U = root.NJUtil, A = root.NJAnalysis;
  const { WHITE, P, N, B, R, Q, K } = C;
  const VAL = [0, 1, 3, 3, 5, 9, 0];
  const NAME = ["", "peão", "cavalo", "bispo", "torre", "dama", "rei"];
  const ART = ["", "o", "o", "o", "a", "a", "o"];
  const pname = (t, withArticle = true) => withArticle ? `${ART[t]} ${NAME[t]}` : NAME[t];
  const sq = C.sqName;
  const san = (board, m) => { try { return board.san(m); } catch (_) { return board.uci(m); } };

  function classify(loss, isBest) {
    if (isBest) return "best";
    if (loss < 2) return "excellent";
    if (loss < 5) return "good";
    if (loss < 10) return "inaccuracy";
    if (loss < 20) return "mistake";
    return "blunder";
  }
  function forkTargets(boardAfter, square, color) {
    const out = [];
    for (const t of boardAfter.attacks(square)) {
      const p = boardAfter.pieceAt(t);
      if (p && p.color !== color && (VAL[p.type] >= 3 || p.type === K)) out.push(p.type);
    }
    return out;
  }
  function isHanging(board, square) {
    const p = board.pieceAt(square);
    if (!p) return false;
    const attackers = board.attackers(p.color ^ 1, square);
    if (!attackers.length) return false;
    const defenders = board.attackers(p.color, square);
    const cheapest = Math.min(...attackers.map(a => VAL[board.pieceAt(a).type] || 100));
    return !defenders.length || cheapest < VAL[p.type];
  }
  const hasCastlingRights = (b, color) => !!(b.castling & (color === WHITE ? 3 : 12));

  function openingTip(bb, move, plyIndex) {
    if (plyIndex > 24) return null;
    const from = move & 63;
    const piece = bb.pieceAt(from);
    if (!piece) return null;
    const color = piece.color, moveNo = bb.fullmove, home = color === WHITE ? 0 : 7, rank = from >> 3, file = from & 7;
    if (piece.type === Q && moveNo <= 5 && !bb.isCapture(move)) return "Dica de abertura: evite tirar a dama cedo — ela vira alvo e você perde tempo fugindo.";
    if (piece.type === K && !bb.isCastling(move) && moveNo <= 12) return "Dica: mexer o rei no começo tira o direito ao roque. Prefira rocar para proteger o rei.";
    if ((piece.type === N || piece.type === B) && rank !== home && moveNo <= 8) {
      let undeveloped = 0;
      for (let s = 0; s < 64; s++) { const p = bb.pieceAt(s); if (p && p.color === color && (p.type === N || p.type === B) && (s >> 3) === home) undeveloped++; }
      if (undeveloped >= 2 && !bb.isCapture(move)) return "Dica de abertura: tente desenvolver peças novas em vez de mexer a mesma duas vezes.";
    }
    if (piece.type === P && (file === 0 || file === 7) && moveNo <= 6) return "Dica: peões da borda (a e h) quase não ajudam na abertura. Foque no centro e no desenvolvimento.";
    const kingSq = bb.king(color);
    if (moveNo >= 11 && (kingSq === 4 || kingSq === 60) && hasCastlingRights(bb, color) && !bb.isCastling(move)) return "Já passou da hora de rocar: o rei no centro fica exposto quando as colunas abrem.";
    if (bb.isCastling(move)) return "Roque feito: rei protegido e torre pronta para entrar no jogo. 👍";
    if ((piece.type === N || piece.type === B) && rank === home && moveNo <= 10) return "Bom desenvolvimento: tirar cavalos e bispos cedo é um dos princípios mais importantes.";
    return null;
  }

  /** evBefore/evAfter: {cp, mate, best(uci)} do ponto de vista das BRANCAS. */
  function commentPlayerMove(bb, move, evBefore, evAfter, plyIndex) {
    const color = bb.turn, sign = color === WHITE ? 1 : -1;
    const wb = A.winPct(sign * evBefore.cp), wa = A.winPct(sign * evAfter.cp);
    const loss = Math.max(0, wb - wa);
    const bestMove = evBefore.best ? bb.moveFromUci(evBefore.best) : 0;
    const moveUci = bb.uci(move);
    const isBest = !!bestMove && (evBefore.best === moveUci || loss < 0.3);
    const sanMove = san(bb, move);
    const bestSan = bestMove && evBefore.best !== moveUci ? san(bb, bestMove) : null;

    const boardAfter = new C.Board(bb.fen());
    boardAfter.push(boardAfter.moveFromUci(moveUci));
    let cls = classify(loss, isBest);
    const mated = boardAfter.isCheckmate();
    if (mated) cls = "best";
    const [label, symbol, hexc] = A.CLASSES[cls];
    let text = null, arrow = null, danger = null;

    const mateBefore = evBefore.mate, mateAfter = evAfter.mate;
    const myMateBefore = mateBefore !== null && mateBefore !== undefined && mateBefore * sign > 0;
    const theirMateAfter = mateAfter !== null && mateAfter !== undefined && mateAfter * sign < 0;
    const reply = evAfter.best ? boardAfter.moveFromUci(evAfter.best) : 0;
    const rnd = U.rnd;

    if (mated) text = rnd.choice(["Xeque-mate! Que final! 🏁", "Mate! Partida encerrada com estilo. 🏁"]);
    else if (myMateBefore && !(mateAfter !== null && mateAfter !== undefined && mateAfter * sign > 0) && bestSan) {
      text = `Havia mate em ${Math.abs(mateBefore)} começando com ${bestSan}! Procure sempre xeques, capturas e ameaças.`;
      arrow = bestMove;
    } else if (theirMateAfter && ["mistake", "blunder", "inaccuracy"].includes(cls)) {
      text = `Cuidado! Depois de ${sanMove} o adversário tem mate em ${Math.abs(mateAfter)}.`;
      if (reply) { danger = reply; text += ` A ameaça começa com ${san(boardAfter, reply)}.`; }
      if (bestSan) { text += ` O melhor era ${bestSan}.`; arrow = bestMove; }
    } else if (["inaccuracy", "mistake", "blunder"].includes(cls)) {
      if (reply && boardAfter.isCapture(reply)) {
        const target = boardAfter.pieceAt((reply >> 6) & 63);
        if (target && target.color === color && VAL[target.type] >= 1) {
          text = `Seu ${NAME[target.type]} em ${sq((reply >> 6) & 63)} ficou sem defesa suficiente: o adversário pode jogar ${san(boardAfter, reply)}.`;
          danger = reply;
        }
      }
      if (!text && bestMove && bb.isCapture(bestMove)) {
        const to = (bestMove >> 6) & 63, victim = bb.pieceAt(to);
        if (victim && isHanging(bb, to)) text = `Você podia capturar ${pname(victim.type)} em ${sq(to)} de graça com ${bestSan}.`;
      }
      if (!text && bestMove) {
        const tmp = new C.Board(bb.fen());
        tmp.push(tmp.moveFromUci(evBefore.best));
        const targets = forkTargets(tmp, (bestMove >> 6) & 63, color);
        if (targets.length >= 2) text = `Havia um garfo! ${bestSan} ataca ${targets.slice(0, 2).map(t => pname(t)).join(" e ")} ao mesmo tempo.`;
      }
      if (!text) {
        text = {
          inaccuracy: bestSan ? `${sanMove} é uma imprecisão. ${bestSan} era mais forte.` : `${sanMove} é uma imprecisão.`,
          mistake: `${sanMove} é um erro: você perdeu parte da vantagem.` + (bestSan ? ` O melhor era ${bestSan}.` : ""),
          blunder: `${sanMove} é uma capivarada! Entregou muita vantagem.` + (bestSan ? ` O certo era ${bestSan}.` : ""),
        }[cls];
      } else if (bestSan && !text.includes(bestSan)) text += ` Melhor era ${bestSan}.`;
      arrow = arrow || bestMove;
    } else {
      const targets = forkTargets(boardAfter, (move >> 6) & 63, color);
      if (bb.isCastling(move)) text = "Roque! Rei em segurança e torre pronta para a luta.";
      else if (targets.length >= 2) text = `Garfo! ${sanMove} ataca ${targets.slice(0, 2).map(t => pname(t)).join(" e ")} ao mesmo tempo. 🍴`;
      else if (bb.isCapture(move) && (cls === "best" || cls === "excellent")) text = rnd.choice([`Boa captura com ${sanMove}!`, `${sanMove}: material ganho, bem visto!`, `Isso! ${sanMove} leva vantagem material.`]);
      else if (boardAfter.inCheck() && cls === "best") text = `${sanMove}: xeque forte, era o melhor lance!`;
      else if (cls === "best") text = rnd.choice([`${sanMove} é o melhor lance da posição! ⭐`, `Perfeito: ${sanMove} era exatamente o lance do motor.`, `Excelente escolha: ${sanMove} é o melhor aqui.`]);
      else if (cls === "excellent") text = `${sanMove} é excelente, quase tão bom quanto o melhor.`;
      else {
        text = `${sanMove} é um bom lance.`;
        if (bestSan && loss >= 3.5) { text += ` Uma alternativa ainda melhor era ${bestSan}.`; arrow = bestMove; }
      }
    }

    let tip = openingTip(bb, move, plyIndex);
    const positive = tip && (tip.startsWith("Bom desenvolvimento") || tip.startsWith("Roque feito"));
    if (tip && (text.includes(tip) || (positive && ["inaccuracy", "mistake", "blunder"].includes(cls)) || (tip.startsWith("Roque feito") && text.includes("Roque")))) tip = null;
    const pair = m => m ? [sq(m & 63), sq((m >> 6) & 63)] : null;
    return { cls, label, symbol, hex: hexc, text, tip, best_san: bestSan, arrow: pair(arrow), danger: pair(danger), eval: evAfter.cp, mate: mateAfter === undefined ? null : mateAfter };
  }

  /** Ameaças criadas pelo lance do bot (sem motor: rápido). */
  function warnAfterBotMove(board, botMove, playerColor, botName) {
    if (board.isGameOver()) return null;
    const pair = m => [sq(m & 63), sq((m >> 6) & 63)];
    if (board.inCheck()) return { text: `Xeque! ${botName} atacou seu rei — primeiro proteja o rei.`, danger: botMove ? pair(botMove) : null };
    const nb = new C.Board(board.fen());
    nb.makeNull();
    for (const m of nb.legalMoves()) {
      nb.push(m);
      const mate = nb.isCheckmate();
      nb.pop();
      if (mate) return { text: `Atenção: ${botName} ameaça xeque-mate em ${sq((m >> 6) & 63)}! Defenda-se.`, danger: pair(m) };
    }
    let worst = null;
    for (let s = 0; s < 64; s++) {
      const p = board.pieceAt(s);
      if (p && p.color === playerColor && p.type !== K && isHanging(board, s)) if (!worst || VAL[p.type] > VAL[worst[1].type]) worst = [s, p];
    }
    if (worst) {
      const [s, p] = worst;
      const attackers = board.attackers(playerColor ^ 1, s);
      const attacker = attackers.reduce((a, b) => (VAL[board.pieceAt(a).type] || 100) <= (VAL[board.pieceAt(b).type] || 100) ? a : b);
      return { text: `Atenção: ${botName} está atacando seu ${NAME[p.type]} em ${sq(s)}.`, danger: [sq(attacker), sq(s)] };
    }
    return null;
  }

  root.NJCoach = { pname, openingTip, commentPlayerMove, warnAfterBotMove, VAL, NAME };
})(typeof self !== "undefined" ? self : this);
