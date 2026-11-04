// Teste do "servidor do celular" no Node (sem navegador): conta, partida, loja, puzzles, análise, backup.
global.self = global;
const L = f => require("../www/js/" + f);
L("local/util.js"); L("local/store.js"); L("local/data_shop.js"); L("local/data_puzzles.js"); L("local/data_clubs.js");
global.NexChess = L("engine/chess.js"); global.NexSearch = L("engine/search.js"); global.NexEngineAPI = L("engine/engine_api.js"); L("engine/engine_client.js");
L("local/core.js"); L("local/analysis.js"); L("local/coach.js"); L("local/games.js"); L("local/competitions.js"); L("local/api.js");
const assert = require("assert");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  ✗", m); } else console.log("  ✓", m); };

async function call(method, path, body) {
  const r = await NJApi.handle(method, path, body ? { body: JSON.stringify(body) } : {});
  const j = await r.json();
  return { status: r.status, ...j, _j: j };
}
(async () => {
  await NJApi.init();
  NexEngine.init();
  let r;
  console.log("contas");
  r = await call("GET", "/api/player"); ok(r.status === 401, "sem login dá 401");
  r = await call("POST", "/api/auth/register", { name: "Jonata", username: "jonata", password: "abcd" }); ok(r.status === 200 && r.user.name === "Jonata", "cria conta");
  r = await call("POST", "/api/auth/register", { name: "Outro", username: "jonata", password: "abcd" }); ok(r.status === 400, "usuário repetido recusado");
  r = await call("POST", "/api/auth/logout"); r = await call("POST", "/api/auth/login", { username: "jonata", password: "errada" }); ok(r.status === 400, "senha errada recusada");
  r = await call("POST", "/api/auth/login", { username: "jonata", password: "abcd" }); ok(r.status === 200, "login com senha certa");
  r = await call("POST", "/api/account/recovery"); ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.code), "gera código de recuperação " + r.code);
  const code = r.code;
  await call("POST", "/api/auth/logout");
  r = await call("POST", "/api/auth/recover", { username: "jonata", code: code.toLowerCase(), password: "nova1" }); ok(r.status === 200, "recupera senha com o código");
  r = await call("POST", "/api/auth/recover", { username: "jonata", code, password: "nova2" }); ok(r.status === 400, "código só vale uma vez");
  await call("POST", "/api/auth/register", { name: "Maria", username: "maria", no_password: true }); r = await call("POST", "/api/auth/logout");
  r = await call("POST", "/api/auth/login", { username: "maria" }); ok(r.status === 200, "conta sem senha entra só com o nome");
  await call("POST", "/api/auth/login", { username: "jonata", password: "nova1" });

  console.log("partida de classificação (com treinador)");
  r = await call("POST", "/api/game/new", { level: "auto", color: "white", rated: true, time_control: "none", coach: true });
  ok(r.mode === "placement" && r.player_color === "white", "primeira partida ranqueada vira classificação");
  let gid = r.id, bot = r.bot;
  ok(r.legal_moves.length === 20, "20 lances legais na abertura");
  let st = await call("POST", `/api/game/${gid}/move`, { uci: "e2e4" }); ok(st.history[0] === "e4" && st.coach && st.coach.text, "lance + comentário do treinador: " + (st.coach && st.coach.text));
  st = await call("POST", `/api/game/${gid}/bot-move`); ok(st.history.length === 2 && st.bot_last.uci, "bot responde " + st.bot_last.san);
  st = await call("POST", `/api/game/${gid}/move`, { uci: "e2e5" }); ok(st.status === 400, "lance ilegal recusado");
  st = await call("POST", `/api/game/${gid}/resign`); ok(st.over && st.result.outcome === "loss" && st.result.placement.played === 1, "desistir encerra e conta na classificação");
  r = await call("GET", "/api/games/recent"); ok(r._j.length === 1, "partida aparece no histórico");

  console.log("análise");
  const g1 = r._j[0].id;
  r = await call("POST", `/api/games/${g1}/analysis`); ok(["running", "done"].includes(r.status === 200 ? r.status : r.status), "análise inicia");
  for (let i = 0; i < 60; i++) { r = await call("GET", `/api/games/${g1}/analysis`); if (r.status !== "running" && r.status !== 200 && !r.progress) break; if (r._j.status === "done") break; await new Promise(x => setTimeout(x, 200)); }
  ok(r._j.status === "done" && r._j.result.plies.length === 2, "análise termina com " + (r._j.result && r._j.result.plies.length) + " lances");

  console.log("pular classificação + loja + moedas");
  await call("POST", "/api/auth/register", { name: "Novo", username: "novo", password: "1234" });
  r = await call("POST", "/api/placement/skip"); ok(r.user.rating === 300 && r.new_titles.length === 1, "começa em 300 e ganha o título Iniciante");
  r = await call("GET", "/api/wallet"); ok(r.coins === 50 && r.history.length === 1, "50 moedas do título no extrato");
  r = await call("GET", "/api/shop"); ok(r.items.length === 87, "loja com 87 itens");
  const caro = r.items.find(i => i.price > 50 && !i.owned && i.cat !== "boost");
  r = await call("POST", "/api/shop/buy", { key: caro.key }); ok(r.status === 400 && /insuficientes/.test(r.error), "compra sem saldo recusada");
  const barato = (await call("GET", "/api/shop")).items.filter(i => i.price > 0 && i.price <= 50 && i.cat !== "boost")[0] || null;
  r = await call("POST", "/api/shop/buy", { key: "streak_freeze" }); ok(r.status === 200 || /insuficientes/.test(r.error), "protetor de sequência: " + (r.error || "comprado"));

  console.log("casual contra bot fraco até o fim (xeque-mate / vitória)");
  r = await call("POST", "/api/game/new", { level: "beginner", color: "white", rated: false, coach: false });
  gid = r.id;
  let moves = 0, last;
  while (moves < 120) {
    last = await call("GET", `/api/game/${gid}`);
    if (last.over) break;
    if (last.player_turn) {
      const lm = last.legal_moves; const pick = lm[Math.floor(Math.random() * lm.length)];
      last = await call("POST", `/api/game/${gid}/move`, { uci: pick });
    } else last = await call("POST", `/api/game/${gid}/bot-move`);
    if (last.over) break; moves++;
  }
  ok(last.over && last.result && last.result.termination, "partida aleatória termina: " + (last.result && last.result.termination) + " em " + last.history.length + " lances");

  console.log("treino: dica, voltar lance");
  r = await call("POST", "/api/game/new", { level: "coach", color: "white" }); gid = r.id;
  await call("POST", `/api/game/${gid}/move`, { uci: "d2d4" }); await call("POST", `/api/game/${gid}/bot-move`);
  r = await call("POST", `/api/game/${gid}/hint`, { level: 2 }); ok(/melhor lance/.test(r.text), "dica: " + r.text);
  r = await call("POST", `/api/game/${gid}/takeback`); ok(r.history.length === 0, "voltar lance desfaz os 2 lances");

  console.log("puzzles");
  r = await call("GET", "/api/training"); ok(r.puzzles.length === 3 && r.missions.length === 3, "3 puzzles e 3 missões do dia");
  r = await call("POST", "/api/puzzles/start", { daily_index: 0 }); ok(r.fen && r.token, "inicia puzzle do dia");
  const pz = NJPuzzles[r.pid]; const tok = r.token;
  r = await call("POST", `/api/puzzles/${tok}/move`, { uci: pz.moves[0] });
  ok(["correct", "solved"].includes(r.status), "primeiro lance da solução aceito (" + r.status + ")");
  r = await call("POST", "/api/puzzles/start", {}); const tok2 = r.token;
  r = await call("POST", `/api/puzzles/${tok2}/solution`); ok(r.status === "shown" && r.steps.length > 0, "ver solução");

  console.log("backup e restauração");
  r = await call("POST", "/api/backups"); ok(r.items.length === 1, "backup criado");
  const bk = r.items[0].name;
  await call("POST", "/api/shop/equip", { key: "board_green" });
  r = await call("POST", "/api/backups/restore", { name: bk }); ok(r.ok && r.restored.players === 3, "restaura (" + JSON.stringify(r.restored) + ")");
  r = await call("GET", "/api/player"); ok(r.status === 401, "depois de restaurar pede login de novo");

  console.log(fails ? `\n${fails} FALHA(S)` : "\nTUDO CERTO");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
