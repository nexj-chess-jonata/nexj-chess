const C = require("../www/js/engine/chess.js");
const T = [
  ["start", C.START_FEN, [20, 400, 8902, 197281, 4865609]],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862, 4085603]],
  ["pos3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624]],
  ["pos4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333]],
  ["pos5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379, 2103487]],
  ["pos6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890, 3894594]],
];
let ok = true;
for (const [name, fen, exp] of T) {
  const b = new C.Board(fen);
  const t0 = Date.now();
  const got = exp.map((_, i) => b.perft(i + 1));
  const good = JSON.stringify(got) === JSON.stringify(exp);
  ok = ok && good;
  console.log(good ? "OK  " : "FAIL", name, got.join(","), (good ? "" : "esperado " + exp.join(",")), (Date.now() - t0) + "ms");
}
process.exit(ok ? 0 : 1);
