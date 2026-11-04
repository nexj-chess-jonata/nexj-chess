// UCI que usa o gerenciador real dos bots (chooseMove) — para calibrar os níveis de rating.
const readline = require("readline");
const C = require("../www/js/engine/chess.js");
const A = require("../www/js/engine/engine_api.js");
if (process.env.NEX_TUNING) Object.assign(A.TUNING, JSON.parse(process.env.NEX_TUNING));
const mgr = new A.EngineManager({ hashBits: 20 });
let board = new C.Board();
const opt = { Rating: 1500 };
const pers = process.env.NEX_PERS || "";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const t = line.trim().split(/\s+/);
  if (t[0] === "uci") { console.log("id name NexBot"); console.log("option name Rating type spin default 1500 min 0 max 4000"); console.log("uciok"); }
  else if (t[0] === "isready") console.log("readyok");
  else if (t[0] === "ucinewgame") mgr.clear();
  else if (t[0] === "setoption") opt[t[2]] = +t[4];
  else if (t[0] === "position") {
    board = t[1] === "startpos" ? new C.Board() : new C.Board(t.slice(2, 8).join(" "));
    const mi = t.indexOf("moves");
    if (mi >= 0) for (const u of t.slice(mi + 1)) board.pushUci(u);
  } else if (t[0] === "go") {
    const m = mgr.chooseMove(board, { rating: opt.Rating, personality: pers }, null);
    console.log("bestmove " + board.uci(m));
  } else if (t[0] === "quit") process.exit(0);
});
