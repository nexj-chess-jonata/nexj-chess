/* Nex-J Chess (celular) — Web Worker do motor: o tabuleiro não trava enquanto o bot pensa. */
importScripts("chess.js", "search.js", "engine_api.js");
const mgr = new NexEngineAPI.EngineManager({ hashBits: 20 });

function rebuild(b) {
  const board = new NexChess.Board(b.startFen);
  for (const m of b.moves) board.push(m);
  return board;
}

self.onmessage = e => {
  const { id, op, board, bot, maxTime, depth, time } = e.data;
  try {
    let out;
    if (op === "choose") out = mgr.chooseMove(rebuild(board), bot, maxTime);
    else if (op === "analyse") out = mgr.analysePosition(rebuild(board), depth, time);
    else if (op === "quick") out = mgr.quickEval(rebuild(board), depth, time);
    else if (op === "evaluate") out = mgr.evaluate(rebuild(board));
    else if (op === "clear") { mgr.clear(); out = true; }
    else if (op === "ping") out = { name: mgr.name };
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
