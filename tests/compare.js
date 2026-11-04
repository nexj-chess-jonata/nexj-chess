const C = require("../www/js/engine/chess.js");
const ref = require("./ref.json");
let bad = 0, n = 0;
function chk(label, b, s) {
  n++;
  const legal = b.legalMoves().map(m => b.uci(m)).sort();
  const errs = [];
  if (b.fen() !== s.fen) errs.push(`fen ${b.fen()} != ${s.fen}`);
  if (JSON.stringify(legal) !== JSON.stringify(s.legal)) errs.push(`legal ${legal} != ${s.legal}`);
  for (const m of b.legalMoves()) { const u = b.uci(m); if (b.san(m) !== s.san[u]) errs.push(`san ${u}: ${b.san(m)} != ${s.san[u]}`); }
  if (b.isCheck() !== s.check) errs.push("check");
  if (b.isInsufficientMaterial() !== s.insuf) errs.push("insuf");
  if (b.hasInsufficientMaterial(0) !== s.ins_w || b.hasInsufficientMaterial(1) !== s.ins_b) errs.push("insuf color");
  const fmt = o => o ? [o.termination, o.winner === 0 ? true : o.winner === 1 ? false : null] : null;
  if (JSON.stringify(fmt(b.outcome(false))) !== JSON.stringify(s.oc)) errs.push(`oc ${JSON.stringify(fmt(b.outcome(false)))} != ${JSON.stringify(s.oc)}`);
  if (JSON.stringify(fmt(b.outcome(true))) !== JSON.stringify(s.oc2)) errs.push(`oc2 ${JSON.stringify(fmt(b.outcome(true)))} != ${JSON.stringify(s.oc2)}`);
  if (errs.length) { bad++; if (bad <= 8) console.log("ERRO", label, errs.slice(0, 3).join(" | ")); }
}
ref.games.forEach((g, gi) => {
  const b = new C.Board();
  chk(`g${gi} início`, b, g.snaps[0]);
  g.moves.forEach((u, i) => { b.pushUci(u); chk(`g${gi} lance ${i + 1} (${u})`, b, g.snaps[i + 1]); });
  // desfazer tudo e conferir de volta
  for (let i = g.moves.length - 1; i >= 0; i--) { b.pop(); if (b.fen() !== g.snaps[i].fen) { bad++; console.log("ERRO pop", gi, i); break; } }
});
ref.specials.forEach((s, i) => chk(`especial ${i} ${s.start}`, new C.Board(s.start), s.snap));
console.log(`${n} posições comparadas, ${bad} com diferença`);
process.exit(bad ? 1 : 0);
