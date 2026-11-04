/* Nex-J Chess (celular) — cliente do motor (promessas). Usa o Worker; se não existir, roda na própria página. */
(function (root) {
  "use strict";
  let worker = null, local = null, seq = 0;
  const pending = new Map();

  function init(base) {
    if (worker || local) return;
    base = base || "js/engine/";
    try {
      worker = new Worker(base + "engine_worker.js");
      worker.onmessage = e => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        e.data.ok ? p.resolve(e.data.out) : p.reject(new Error(e.data.error));
      };
      worker.onerror = () => { worker = null; local = new NexEngineAPI.EngineManager(); };
    } catch (_) {
      local = new NexEngineAPI.EngineManager();
    }
  }

  // o tabuleiro vai como {startFen, moves[]}: lances são inteiros e independem da posição
  const pack = b => ({ startFen: b.startFen, moves: b.moveStack.slice() });
  const unpack = b => { const x = new NexChess.Board(b.startFen); for (const m of b.moves) x.push(m); return x; };

  function call(op, payload) {
    init();
    if (local) {
      return new Promise(resolve => setTimeout(() => {
        const m = local;
        const board = payload.board ? unpack(payload.board) : null;
        if (op === "choose") resolve(m.chooseMove(board, payload.bot, payload.maxTime));
        else if (op === "analyse") resolve(m.analysePosition(board, payload.depth, payload.time));
        else if (op === "quick") resolve(m.quickEval(board, payload.depth, payload.time));
        else if (op === "evaluate") resolve(m.evaluate(board));
        else resolve(true);
      }, 0));
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage(Object.assign({ id, op }, payload));
    });
  }

  root.NexEngine = {
    init,
    chooseMove: (board, bot, maxTime) => call("choose", { board: pack(board), bot: { rating: bot.rating, personality: bot.personality }, maxTime }),
    analysePosition: (board, depth = 18, time = 1.0) => call("analyse", { board: pack(board), depth, time }),
    quickEval: (board, depth = 12, time = 0.25) => call("quick", { board: pack(board), depth, time }),
    evaluate: board => call("evaluate", { board: pack(board) }),
    clear: () => call("clear", {}),
  };
})(self);
