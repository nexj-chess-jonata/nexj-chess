// UCI mínimo em cima do motor JS, só para calibrar a força contra o Stockfish.
const readline = require("readline");
const C = require("../www/js/engine/chess.js");
const S = require("../www/js/engine/search.js");
const eng = new S.Engine({ hashBits: 20 });
let board = new C.Board();
const opt = { Depth: 64, Noise: 0, Nodes: 0, Blunder: 0 };
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const t = line.trim().split(/\s+/);
  if (t[0] === "uci") { console.log("id name NexJS"); for (const k of Object.keys(opt)) console.log(`option name ${k} type spin default ${opt[k]} min 0 max 100000000`); console.log("uciok"); }
  else if (t[0] === "isready") console.log("readyok");
  else if (t[0] === "ucinewgame") { eng.clear(); }
  else if (t[0] === "setoption") { const name = t[2]; opt[name] = +t[4]; }
  else if (t[0] === "position") {
    board = t[1] === "startpos" ? new C.Board() : new C.Board(t.slice(2, 8).join(" "));
    const mi = t.indexOf("moves");
    if (mi >= 0) for (const u of t.slice(mi + 1)) board.pushUci(u);
  } else if (t[0] === "go") {
    let time = 1000;
    const i = t.indexOf("movetime"); if (i >= 0) time = +t[i + 1];
    const legal = board.legalMoves();
    let move;
    if (opt.Blunder && Math.random() * 100 < opt.Blunder) move = legal[(Math.random() * legal.length) | 0];
    else move = eng.search(board, { time, depth: opt.Depth || 64, nodes: opt.Nodes || 0 || Infinity, noise: opt.Noise }).move;
    console.log("bestmove " + board.uci(move));
  } else if (t[0] === "quit") process.exit(0);
});
