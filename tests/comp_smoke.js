// Etapa 3: torneios, campeonatos, carreira, regras.
global.self = global;
const L = f => require("../www/js/" + f);
L("local/util.js"); L("local/store.js"); L("local/data_shop.js"); L("local/data_puzzles.js"); L("local/data_clubs.js");
global.NexChess = L("engine/chess.js"); global.NexSearch = L("engine/search.js"); global.NexEngineAPI = L("engine/engine_api.js"); L("engine/engine_client.js");
L("local/core.js"); L("local/analysis.js"); L("local/coach.js"); L("local/games.js"); L("local/competitions.js"); L("local/api.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  ✗", m); } else console.log("  ✓", m); };
async function call(method, path, body) {
  const r = await NJApi.handle(method, path, body ? { body: JSON.stringify(body) } : {});
  const j = await r.json(); return { status: r.status, ...j, _j: j };
}
// joga uma partida: a cada n lances faz o jogador desistir (ganha/perde), ou joga aleatório até acabar
async function finishGame(st, mode) {
  let n = 0;
  while (!st.over) {
    if (st.turn === st.player_color || (st.turn || "")[0] === (st.player_color || "")[0]) {
      if (mode === "resign" || n > 30) { st = await call("POST", `/api/game/${st.id}/resign`); break; }
      const lm = st.legal_moves; st = await call("POST", `/api/game/${st.id}/move`, { uci: lm[Math.floor(Math.random() * lm.length)] }); n++;
    } else st = await call("POST", `/api/game/${st.id}/bot-move`);
  }
  return st;
}
(async () => {
  await NJApi.init(); NexEngine.init();
  let r;
  console.log(JSON.stringify(await call("POST", "/api/auth/register", { name: "Jonata", username: "jonata", password: "abcd" })).slice(0,200));
  r = await call("GET", "/api/tournaments"); ok(r.templates.length === 4 && r.can_join === false, "lista de torneios (sem classificação: não pode entrar)");
  r = await call("POST", "/api/tournaments", { time_control: "blitz" }); ok(r.status === 400, "torneio exige classificação");
  await call("POST", "/api/placement/skip");
  r = await call("GET", "/api/rules/tournament?time_control=blitz&strength=hard"); ok(r.items.length >= 8 && /mais fortes/.test(JSON.stringify(r.items)), "regras do torneio");
  for (const k of ["estadual", "liga", "copa"]) { r = await call("GET", `/api/rules/${k}?time_control=rapid`); ok(r.items && r.items.length > 5, "regras " + k); }

  console.log("torneio");
  r = await call("POST", "/api/tournaments", { name: "Meu Teste", time_control: "bullet", strength: "easy" }); ok(r.status === 200, "cria torneio"); const tid = r.id;
  let t = await call("GET", `/api/tournaments/${tid}`);
  ok(Object.keys(t.participants).length === 32 && t.groups.A.standings.length === 4 && t.next && t.next.where === "group", "32 participantes, grupo A, próxima partida");
  const coins0 = (await call("GET", "/api/wallet")).coins;
  let guard = 0, tiebreaks = 0;
  while (t.player_status === "playing" && guard++ < 12) {
    let st = await call("POST", `/api/tournaments/${tid}/play`); ok(st.status === 200 && st.id, "inicia partida " + guard + " (" + t.stage_label + ")");
    const again = await call("POST", `/api/tournaments/${tid}/play`); ok(again.id === st.id, "play de novo devolve a mesma partida");
    st = await finishGame(st, guard % 3 === 0 ? "random" : "resign");
    ok((st.result && st.result.tournament) && (st.result && st.result.tournament).tournament_id === tid, "partida informa torneio: " + ((st.result && st.result.tournament) && (st.result && st.result.tournament).stage_label));
    if ((st.result && st.result.tournament) && (st.result && st.result.tournament).tiebreak) tiebreaks++;
    t = await call("GET", `/api/tournaments/${tid}`);
  }
  ok(t.player_status !== "playing", "jogador sai do torneio: " + t.player_status + " / " + t.place_label);
  ok(t.stage === "finished" && t.champion, "torneio termina com campeão");
  let list = await call("GET", "/api/tournaments"); const card = list.mine[0];
  ok(card.time_control === "bullet" && card.strength === "easy", "cartão guarda ritmo e nível (Jogar de novo)");
  const coins1 = (await call("GET", "/api/wallet")).coins; ok(coins1 >= coins0, `prêmio pago (${t.prize_paid}): ${coins0} → ${coins1}`);

  console.log("abandono");
  r = await call("POST", "/api/tournaments", { time_control: "none" }); const t2 = r.id;
  r = await call("POST", `/api/tournaments/${t2}/forfeit`); ok(r.ok, "abandona torneio");
  t = await call("GET", `/api/tournaments/${t2}`); ok(t.stage === "finished" && t.forfeit && t.prize === 0, "terminou sem prêmio");
  for (let i = 0; i < 5; i++) await call("POST", "/api/tournaments", { time_control: "none" });
  r = await call("POST", "/api/tournaments", { time_control: "none" }); ok(r.status === 400 && /5 torneios/.test(r.error), "limite de 5 torneios");

  console.log("carreira");
  r = await call("GET", "/api/career"); ok(!r.has_career && r.ufs.length === 27 && r.can_join, "carreira ainda não iniciada");
  r = await call("POST", "/api/career/start", { uf: "SP", club: "ab", palette: 2 }); ok(r.status === 400, "nome curto recusado");
  r = await call("POST", "/api/career/start", { uf: "SP", club: "Xadrez Paulista", palette: 2 }); ok(r.has_career && r.club.name === "Xadrez Paulista" && r.division === "D", "cria clube, Série " + r.division);
  r = await call("POST", "/api/career/club", { club: "Novo Nome FC", palette: 3 }); ok(r.club.name === "Novo Nome FC", "edita clube");
  r = await call("POST", "/api/champ/copa/start", { time_control: "rapid" }); ok(r.status === 400, "Copa exige classificação no Estadual");
  r = await call("POST", "/api/champ/estadual/start", { time_control: "bullet" }); ok(r.id, "inicia Estadual"); const eid = r.id;
  r = await call("POST", "/api/champ/estadual/start", { time_control: "bullet" }); ok(r.status === 400, "Estadual só uma vez por temporada");
  let c = await call("GET", `/api/champ/${eid}`); ok(c.table.length === 8 && c.total_rounds === 7 && c.next, "Estadual: 8 clubes, 7 rodadas");
  guard = 0;
  while (c.player_status === "playing" && guard++ < 10) {
    let st = await call("POST", `/api/champ/${eid}/play`); ok(st.id, "joga rodada " + guard);
    st = await finishGame(st, guard === 2 ? "random" : "resign");
    ok((st.result && st.result.tournament) && (st.result && st.result.tournament).champ, "info do campeonato");
    c = await call("GET", `/api/champ/${eid}`);
  }
  ok(c.stage === "finished" && c.table.length === 8, "Estadual terminou: " + c.place_label);
  r = await call("GET", "/api/career"); ok(r.competitions.estadual.status === "finished", "carreira vê o Estadual encerrado; Copa: " + r.copa_note);
  console.log("liga");
  r = await call("POST", "/api/champ/liga/start", { time_control: "bullet" }); const lid = r.id; ok(lid, "inicia Liga");
  r = await call("POST", `/api/champ/${lid}/forfeit`); ok(r.ok, "abandona Liga");
  c = await call("GET", `/api/champ/${lid}`); ok(c.stage === "finished" && c.prize === 0, "Liga encerrada por W.O.");
  if (!(await call("GET", "/api/career")).copa_open) {
    // força classificação para testar a Copa
    const row = NJStore.get("championships", eid); const d = JSON.parse(row.data); d.qualified_copa = true; row.data = JSON.stringify(d);
  }
  r = await call("GET", "/api/career"); ok(r.copa_open, "Copa liberada");
  r = await call("POST", "/api/champ/copa/start", { time_control: "bullet" }); const cid = r.id; ok(cid, "inicia Copa");
  c = await call("GET", `/api/champ/${cid}`); ok(c.knockout.r16.length === 8 && c.next, "Copa: 16 clubes");
  guard = 0;
  while (c.player_status === "playing" && guard++ < 10) {
    let st = await call("POST", `/api/champ/${cid}/play`); st = await finishGame(st, "resign"); c = await call("GET", `/api/champ/${cid}`);
  }
  ok(c.stage === "finished" && c.champion, "Copa encerrada: " + c.place_label);
  r = await call("GET", "/api/career"); ok(r.can_next_season, "pode ir para a próxima temporada");
  r = await call("POST", "/api/career/season/next"); ok(r.season === 2 && !r.competitions.estadual, "temporada 2");
  r = await call("GET", "/api/career"); ok(r.history.length >= 3, "histórico com " + r.history.length + " competições");
  await new Promise(x => setTimeout(x, 400)); await NJStore.flush();
  console.log(fails ? `\n${fails} FALHA(S)` : "\nTudo certo"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
