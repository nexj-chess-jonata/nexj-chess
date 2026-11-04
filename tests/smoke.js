const C = require("../www/js/engine/chess.js");
const S = require("../www/js/engine/search.js");
const eng = new S.Engine({ hashBits: 20 });
const cases = [
  ["mate em 1", "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8"],
  ["mate em 2", "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7"],
  ["ganha dama", "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", null],
  ["fim de jogo", "8/8/8/4k3/8/4K3/4P3/8 w - - 0 1", null],
];
for (const [name, fen, expect] of cases) {
  const b = new C.Board(fen);
  const t0 = Date.now();
  const r = eng.search(b, { time: 1500 });
  const mv = b.uci(r.move);
  console.log(name.padEnd(12), mv, "score", r.score, "mate", r.mate, "prof", r.depth, "nós", r.nodes, ((r.nodes / (Date.now() - t0)) | 0) + " knps", expect ? (mv === expect ? "OK" : "ESPERADO " + expect) : "");
}
const b = new C.Board();
const t0 = Date.now(); const r = eng.search(b, { time: 3000 });
console.log("posição inicial:", b.uci(r.move), "prof", r.depth, "nós", r.nodes, ((r.nodes / (Date.now() - t0)) | 0) + " knps", "pv", r.pv.map(m => b.uci(m)).join(" "));
