/* Nex-J Chess (celular) — torneios, campeonatos, carreira, clubes e regras escritas.
 * Porta de core/tournament.py, core/championship.py, core/career.py, core/clubs.py e core/rules.py. */
(function (root) {
  "use strict";
  const S = root.NJStore, U = root.NJUtil, K = root.NJCore, D = root.NJClubs, G = root.NJGames;
  const { UserError } = K;
  const rnd = U.rnd;
  const gauss = (mu, sd) => rnd.gauss(mu, sd);
  const clone = x => JSON.parse(JSON.stringify(x));
  const dumps = x => JSON.stringify(x), loads = t => JSON.parse(t);
  const now = () => U.nowIso();
  const sortBy = (arr, cmp) => arr.sort(cmp);          // Array.sort é estável (como o sorted do Python)
  const expScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

  // ======================================================================= clubes
  const Clubs = (() => {
    const { UFS, PATTERNS, GLYPHS, PALETTES, CREST_STYLES } = D;
    const ufList = () => Object.entries(UFS).sort((a, b) => a[1][0].localeCompare(b[1][0], "pt")).map(([uf, v]) => ({ uf, name: v[0], region: v[1] }));
    const validUf = uf => Object.prototype.hasOwnProperty.call(UFS, uf);
    const abbr = city => { const letters = [...city.toUpperCase()].filter(ch => /\p{L}/u.test(ch)); return letters.slice(0, 3).join("") || "XAD"; };
    function makeClub(uf, used, rng = rnd) {
      used = used || new Set();
      const cities = UFS[uf][2];
      let name = "", city = "", found = false;
      for (let i = 0; i < 80; i++) {
        city = rng.choice(cities);
        name = rng.choice(PATTERNS).replace("{c}", city);
        if (!used.has(name)) { found = true; break; }
      }
      if (!found) name = `${name} II`;
      used.add(name);
      const [c1, c2] = rng.choice(PALETTES);
      return { name, city, uf, abbr: abbr(city), c1, c2, style: rng.choice(CREST_STYLES.slice(0, 5)), glyph: rng.choice(GLYPHS) };
    }
    function playerClub(name, uf, paletteIndex = 0, style = "half") {
      const [c1, c2] = PALETTES[paletteIndex % PALETTES.length];
      name = name.split(/\s+/).filter(Boolean).join(" ").slice(0, 28);
      return { name, city: UFS[uf][2][0], uf, abbr: abbr(name.replace("Xadrez", "").trim() || name), c1, c2, style: CREST_STYLES.includes(style) ? style : "half", glyph: "♞" };
    }
    return { UFS, PALETTES, CREST_STYLES, ufList, validUf, makeClub, playerClub };
  })();

  // ======================================================================= torneios (32 jogadores)
  const Tour = (() => {
    const GROUP_NAMES = "ABCDEFGH".split("");
    const RR_SCHEDULE = [[[0, 3], [1, 2]], [[2, 0], [3, 1]], [[0, 1], [2, 3]]];
    const KO_ROUNDS = ["r16", "qf", "sf", "final"];
    const KO_NAMES = { r16: "Oitavas de final", qf: "Quartas de final", sf: "Semifinal", final: "Final" };
    const R16_PAIRS = [["A", 1, "B", 2], ["C", 1, "D", 2], ["E", 1, "F", 2], ["G", 1, "H", 2], ["B", 1, "A", 2], ["D", 1, "C", 2], ["F", 1, "E", 2], ["H", 1, "G", 2]];
    const PRIZES = { champion: 500, final: 250, sf: 120, qf: 60, r16: 25, group: 0 };
    const WIN_BONUS = 10, MAX_TIEBREAKS = 4;
    const PLACE_NAMES = { champion: "🏆 Campeão", final: "🥈 Vice-campeão", sf: "🥉 Semifinal", qf: "Quartas de final", r16: "Oitavas de final", group: "Fase de grupos" };
    const STRENGTHS = { easy: -150, equal: 0, hard: 150 };
    const NAME_A = ["Copa", "Torneio", "Desafio", "Taça", "Circuito", "Open", "Festival"];
    const NAME_B = ["Nex-J", "das Torres", "dos Reis", "Relâmpago", "da Meia-Noite", "dos Campeões", "do Xeque", "da Dama", "dos Cavalos", "de Primavera", "Estrelado", "Dourado"];
    const TEMPLATES = [
      { key: "blitz", name: "Copa Relâmpago", time_control: "blitz", strength: "equal", desc: "Blitz de 2 min +1s. Rápido e emocionante." },
      { key: "rapid", name: "Open Nex-J", time_control: "rapid", strength: "equal", desc: "Partidas de 10 minutos. O torneio clássico da casa." },
      { key: "bullet", name: "Desafio Bullet", time_control: "bullet", strength: "easy", desc: "1 minuto por partida. Reflexo puro, bots um pouco mais fracos." },
      { key: "hard", name: "Taça dos Campeões", time_control: "none", strength: "hard", desc: "Sem relógio, mas contra bots ~150 pontos mais fortes." },
    ];
    const randomName = () => `${rnd.choice(NAME_A)} ${rnd.choice(NAME_B)}`;

    function createData(player, name, tcKey, strength) {
      const center = Math.max(300, player.rating + (STRENGTHS[strength] || 0));
      const me = { id: "me", name: player.name, rating: player.rating, is_player: true, flag: "⭐", initials: player.name.trim()[0].toUpperCase(), avatar_color: "#f0c96a",
        personality: null, personality_label: "Você", personality_icon: "⭐" };
      const botEntry = rating => { const d = K.Bots.generate(null, null, Math.max(300, Math.min(2850, Math.trunc(rating)))).toDict(); d.is_player = false; return d; };
      const myGroupBots = [0, 1, 2].map(() => botEntry(center + rnd.uniform(-100, 100)));
      const others = []; for (let i = 0; i < 28; i++) others.push(botEntry(gauss(center, 120)));
      others.sort((a, b) => b.rating - a.rating);
      const members = Object.fromEntries(GROUP_NAMES.map(g => [g, []]));
      members.A = ["me", ...myGroupBots.map(b => b.id)];
      const order = GROUP_NAMES.slice(1);
      others.forEach((bot, i) => {
        const row = Math.floor(i / order.length);
        const g = row % 2 === 0 ? order[i % order.length] : order[order.length - 1 - (i % order.length)];
        members[g].push(bot.id);
      });
      const participants = {};
      for (const p of [me, ...myGroupBots, ...others]) participants[p.id] = p;
      const groups = {};
      for (const [g, mem] of Object.entries(members)) {
        if (g !== "A") rnd.shuffle(mem);
        const matches = [];
        RR_SCHEDULE.forEach((pairs, r) => { for (const [a, b] of pairs) matches.push({ round: r + 1, white: mem[a], black: mem[b], result: null }); });
        groups[g] = { members: mem, matches };
      }
      const [, , tcName, tcIcon] = K.TimeControl.get(tcKey);
      return { name, time_control: tcKey, tc_label: tcName, tc_icon: tcIcon, strength, center, participants, groups, group_round: 1, stage: "groups", knockout: {}, ko_round: null,
        player_status: "playing", player_place: null, player_wins: 0, champion: null, log: [] };
    }

    const scoreOf = (result, pid, m) => result === "1/2-1/2" ? 0.5 : ((m.white === pid) === (result === "1-0") ? 1 : 0);

    function standings(data, g) {
      const grp = data.groups[g];
      const table = {};
      for (const pid of grp.members) table[pid] = { id: pid, played: 0, w: 0, d: 0, l: 0, pts: 0, sb: 0 };
      for (const m of grp.matches) {
        if (!m.result) continue;
        for (const pid of [m.white, m.black]) {
          const s = scoreOf(m.result, pid, m), row = table[pid];
          row.played++; row.pts += s; row[s === 1 ? "w" : s === 0.5 ? "d" : "l"]++;
        }
      }
      for (const m of grp.matches) {
        if (!m.result) continue;
        for (const [pid, opp] of [[m.white, m.black], [m.black, m.white]]) table[pid].sb += scoreOf(m.result, pid, m) * table[opp].pts;
      }
      const h2h = (a, b) => { for (const m of grp.matches) if (m.result && ((m.white === a && m.black === b) || (m.white === b && m.black === a))) return scoreOf(m.result, a, m); return 0.5; };
      const rows = Object.values(table);
      sortBy(rows, (a, b) => (b.pts - a.pts) || (b.sb - a.sb) || (b.w - a.w) || (data.participants[b.id].rating - data.participants[a.id].rating));
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i], b = rows[i + 1];
        if (a.pts === b.pts && a.sb === b.sb && h2h(a.id, b.id) < 0.5) { rows[i] = b; rows[i + 1] = a; }
      }
      rows.forEach((r, i) => { r.pos = i + 1; });
      return rows;
    }

    function simulateResult(data, white, black) {
      const exp = expScore(data.participants[white].rating, data.participants[black].rating);
      const draw = 0.10 + 0.14 * (1 - Math.abs(exp - 0.5) * 2);
      const r = rnd.random();
      if (r < exp - draw / 2) return "1-0";
      if (r < exp + draw / 2) return "1/2-1/2";
      return "0-1";
    }
    const koWinner = m => m.result === "1-0" ? m.white : m.black;
    function simKoWinner(data, m) {
      if (m.result === "1-0") return m.white;
      if (m.result === "0-1") return m.black;
      return rnd.random() < expScore(data.participants[m.white].rating, data.participants[m.black].rating) ? m.white : m.black;
    }

    function playerMatch(data) {
      if (data.stage === "groups") {
        const ms = data.groups.A.matches;
        for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m.round === data.group_round && !m.result && (m.white === "me" || m.black === "me")) return ["group", i, m]; }
      } else if (data.stage === "knockout" && data.player_status === "playing") {
        const rd = data.ko_round, ms = data.knockout[rd] || [];
        for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (!m.result && (m.white === "me" || m.black === "me")) return [rd, i, m]; }
      }
      return null;
    }
    function stageLabel(data) {
      if (data.stage === "groups") return `Grupo A · Rodada ${data.group_round} de 3`;
      if (data.stage === "knockout") return KO_NAMES[data.ko_round];
      return "Encerrado";
    }

    function eliminate(data, where) { data.player_status = "eliminated"; data.player_place = where; }
    function simulateKoRoundBots(data) {
      for (const m of data.knockout[data.ko_round]) {
        if (!m.result && (m.white === "me" || m.black === "me") && data.player_status !== "playing") {   // jogador já fora: perde por W.O.
          m.result = m.white === "me" ? "0-1" : "1-0"; m.winner = koWinner(m); m.note = "W.O. (abandono)";
        } else if (!m.result && m.white !== "me" && m.black !== "me") {
          m.result = simulateResult(data, m.white, m.black);
          m.winner = simKoWinner(data, m);
          if (m.result === "1/2-1/2") m.note = "Empate → desempate (simulado)";
        }
      }
    }
    function finishGroupRound(data) {
      const rd = data.group_round;
      for (const grp of Object.values(data.groups)) for (const m of grp.matches) if (m.round === rd && !m.result) m.result = simulateResult(data, m.white, m.black);
      if (rd < 3) { data.group_round = rd + 1; return; }
      const qualified = {};
      for (const g of GROUP_NAMES) qualified[g] = standings(data, g).slice(0, 2).map(r => r.id);
      if (!qualified.A.includes("me")) eliminate(data, "group");
      data.knockout.r16 = R16_PAIRS.map(([g1, p1, g2, p2]) => ({ white: qualified[g1][p1 - 1], black: qualified[g2][p2 - 1], result: null, winner: null }));
      data.stage = "knockout"; data.ko_round = "r16";
      simulateKoRoundBots(data);
    }
    function finishKoRound(data) {
      const rd = data.ko_round;
      simulateKoRoundBots(data);
      const matches = data.knockout[rd];
      if (matches.some(m => !m.result)) return;
      if (rd === "final") {
        data.champion = matches[0].winner; data.stage = "finished";
        if (data.champion === "me") { data.player_status = "champion"; data.player_place = "champion"; }
        return;
      }
      const nxt = KO_ROUNDS[KO_ROUNDS.indexOf(rd) + 1];
      const winners = matches.map(m => m.winner), pairs = [];
      for (let i = 0; i < winners.length; i += 2) {
        let a = winners[i], b = winners[i + 1];
        if (rnd.random() < 0.5) [a, b] = [b, a];
        pairs.push({ white: a, black: b, result: null, winner: null });
      }
      data.knockout[nxt] = pairs; data.ko_round = nxt;
      simulateKoRoundBots(data);
      if (pairs.every(m => m.result)) finishKoRound(data);
    }
    function simulateToEnd(data) {
      let guard = 0;
      while (data.stage !== "finished" && guard < 20) { guard++; if (data.stage === "groups") finishGroupRound(data); else { simulateKoRoundBots(data); finishKoRound(data); } }
    }

    function recordPlayerResult(data, result, gameId) {
      const found = playerMatch(data);
      if (!found) return null;
      const [where, , match] = found;
      match.result = result; match.game_id = gameId;
      const myScore = scoreOf(result, "me", match);
      if (myScore === 1) data.player_wins++;
      const summary = { where, score: myScore, stage_before: stageLabel(data) };
      if (where === "group") finishGroupRound(data);
      else if (result === "1/2-1/2" && (match.tb || 0) < MAX_TIEBREAKS) {         // empate no mata-mata: novo jogo, cores trocadas
        match.result = null; match.tb = (match.tb || 0) + 1;
        [match.white, match.black] = [match.black, match.white];
        match.note = `Empate! Jogo de desempate ${match.tb} (cores trocadas)`;
        summary.tiebreak = match.tb;
      } else {
        match.winner = koWinner(match);
        if (result === "1/2-1/2") match.note = "Empates seguidos: avançam as pretas";
        if (match.winner !== "me") eliminate(data, where);
        finishKoRound(data);
      }
      if (data.player_status !== "playing") simulateToEnd(data);
      return Object.assign(summary, progressSummary(data));
    }
    function forfeit(data) {
      const found = playerMatch(data);
      if (found) {
        const [where, , m] = found;
        m.result = m.white === "me" ? "0-1" : "1-0"; m.note = "W.O. (abandono)";
        if (where !== "group") m.winner = koWinner(m);
      }
      data.player_status = "eliminated";
      data.player_place = data.player_place || (data.stage === "knockout" ? data.ko_round : "group");
      data.forfeit = true;
      simulateToEnd(data);
    }
    function prize(data) {
      const place = data.player_place || "group";
      if (data.forfeit) return 0;
      return (PRIZES[place] || 0) + WIN_BONUS * data.player_wins;
    }
    function describeMatch(data, found) {
      const [where, idx, m] = found;
      const oppId = m.white === "me" ? m.black : m.white;
      return { where, index: idx, label: stageLabel(data) + (m.tb ? " · Desempate" : ""), color: m.white === "me" ? "white" : "black", opponent: data.participants[oppId], knockout: where !== "group" };
    }
    function progressSummary(data) {
      const out = { stage: data.stage, stage_label: stageLabel(data), player_status: data.player_status };
      if (data.player_status === "playing") { const n = playerMatch(data); if (n) out.next = describeMatch(data, n); }
      else { out.place = data.player_place; out.place_label = PLACE_NAMES[data.player_place] || ""; out.prize = prize(data); }
      if (data.stage === "finished") { const c = data.participants[data.champion]; out.champion = { id: c.id, name: c.name, flag: c.flag || "" }; }
      return out;
    }
    function publicState(data) {
      const groups = {};
      for (const g of GROUP_NAMES) groups[g] = { standings: standings(data, g), matches: g === "A" ? data.groups[g].matches : [] };
      const nxt = data.player_status === "playing" ? playerMatch(data) : null;
      return {
        name: data.name, time_control: data.time_control, tc_label: data.tc_label, tc_icon: data.tc_icon, strength: data.strength, stage: data.stage, stage_label: stageLabel(data),
        group_round: data.group_round, ko_round: data.ko_round, participants: data.participants, groups,
        knockout: Object.fromEntries(KO_ROUNDS.map(r => [r, data.knockout[r] || []])), ko_names: KO_NAMES,
        player_status: data.player_status, player_place: data.player_place, place_label: data.player_place ? (PLACE_NAMES[data.player_place] || "") : null,
        player_wins: data.player_wins, prize: data.player_status !== "playing" ? prize(data) : null, prizes: PRIZES, win_bonus: WIN_BONUS, champion: data.champion,
        next: nxt ? describeMatch(data, nxt) : null, forfeit: !!data.forfeit,
      };
    }
    return { GROUP_NAMES, KO_ROUNDS, KO_NAMES, PRIZES, WIN_BONUS, MAX_TIEBREAKS, PLACE_NAMES, STRENGTHS, TEMPLATES, randomName, createData, standings, playerMatch, stageLabel,
      recordPlayerResult, forfeit, prize, describeMatch, publicState, scoreOf };
  })();

  // ======================================================================= campeonatos (futebol no xadrez)
  const Champ = (() => {
    const KINDS = { estadual: { label: "Campeonato Estadual", icon: "🏟️" }, liga: { label: "Liga Nex-J", icon: "⚽" }, copa: { label: "Copa do Brasil", icon: "🏆" } };
    const DIVISIONS = ["D", "C", "B", "A"], DIV_CENTER = { D: 600, C: 1000, B: 1400, A: 1900 };
    const CLUB_COUNT = 8, KO_ROUNDS = Tour.KO_ROUNDS, KO_NAMES = Tour.KO_NAMES;
    const COPA_PLACES = { champion: "🏆 Campeão", final: "🥈 Vice-campeão", sf: "🥉 Semifinal", qf: "Quartas de final", r16: "Oitavas de final" };
    const PRIZES = { estadual: { 1: 300, 2: 150, 3: 80, 4: 80, other: 20 }, liga: { 1: 600, 2: 350, 3: 200, 4: 120, other: 30 }, copa: { champion: 800, final: 400, sf: 200, qf: 100, r16: 40 } };
    const PROMOTION_BONUS = 100, WIN_BONUS = 5, MAX_TIEBREAKS = 4;
    const divisionForRating = r => r < 800 ? "D" : r < 1200 ? "C" : r < 1600 ? "B" : "A";
    const divisionName = d => `Série ${d}`;

    const playerEntry = (player, club) => ({ id: "me", name: player.name, rating: player.rating, is_player: true, flag: "⭐", initials: player.name.trim()[0].toUpperCase(),
      avatar_color: "#f0c96a", personality: null, personality_label: "Você", personality_icon: "⭐", club });
    function botEntry(rating, club) {
      const b = K.Bots.generate(null, null, Math.max(300, Math.min(2850, Math.trunc(rating)))).toDict();
      const [, firsts, lasts] = K.Bots.NAME_POOLS[0];
      const first = rnd.choice(firsts), last = rnd.choice(lasts);
      return Object.assign(b, { name: `${first} ${last}`, flag: "🇧🇷", initials: (first[0] + last[0]).toUpperCase(), is_player: false, club });
    }
    const ratingsFor = (center, n, spread) => { const v = []; for (let i = 0; i < n; i++) v.push(Math.max(300, Math.min(2850, Math.trunc(gauss(center, spread))))); return v.sort((a, b) => b - a); };
    function base(kind, season, name, tcKey, uf) {
      const [, , tcName, tcIcon] = K.TimeControl.get(tcKey);
      return { kind, season, name, uf, time_control: tcKey, tc_label: tcName, tc_icon: tcIcon, participants: {}, order: [], player_status: "playing", player_place: null,
        player_wins: 0, champion: null, forfeit: false, stage: "league" };
    }
    function roundRobin(ids, legs = 1) {
      const n = ids.length, rounds = [];
      let arr = ids.slice();
      for (let r = 0; r < n - 1; r++) {
        const pairs = [];
        for (let i = 0; i < Math.floor(n / 2); i++) {
          let a = arr[i], b = arr[n - 1 - i];
          if (r % 2 === 1) [a, b] = [b, a];
          pairs.push({ white: a, black: b, result: null });
        }
        rounds.push(pairs);
        arr = [arr[0], arr[arr.length - 1], ...arr.slice(1, -1)];
      }
      if (legs === 2) rounds.push(...rounds.map(rd => rd.map(m => ({ white: m.black, black: m.white, result: null }))));
      return rounds;
    }
    function createLeague(kind, player, season, uf, club, tcKey, division) {
      const used = new Set([club.name]);
      let name, ratings, oppClubs, legs;
      if (kind === "estadual") {
        name = `Campeonato ${Clubs.UFS[uf][0]} · Temporada ${season}`;
        ratings = ratingsFor(player.rating, CLUB_COUNT - 1, 160);
        oppClubs = Array.from({ length: CLUB_COUNT - 1 }, () => Clubs.makeClub(uf, used));
        legs = 1;
      } else {
        name = `Liga Nex-J ${divisionName(division)} · Temporada ${season}`;
        ratings = ratingsFor(DIV_CENTER[division], CLUB_COUNT - 1, 170);
        const ufs = Object.keys(Clubs.UFS);
        oppClubs = Array.from({ length: CLUB_COUNT - 1 }, () => Clubs.makeClub(rnd.choice(ufs), used));
        legs = 2;
      }
      const data = base(kind, season, name, tcKey, uf);
      data.participants.me = playerEntry(player, club);
      ratings.forEach((r, i) => { const e = botEntry(r, oppClubs[i]); data.participants[e.id] = e; });
      const order = rnd.shuffle(Object.keys(data.participants));
      Object.assign(data, { order, division: division || null, legs, rounds: roundRobin(order, legs), round: 1, knockout: {}, ko_round: null });
      data.total_rounds = data.rounds.length;
      return data;
    }
    function createCopa(player, season, uf, club, tcKey) {
      const used = new Set([club.name]), ufs = Object.keys(Clubs.UFS);
      const data = base("copa", season, `Copa do Brasil · Temporada ${season}`, tcKey, uf);
      data.participants.me = playerEntry(player, club);
      for (const r of ratingsFor(player.rating + 30, 15, 180)) { const e = botEntry(r, Clubs.makeClub(rnd.choice(ufs), used)); data.participants[e.id] = e; }
      const ids = rnd.shuffle(Object.keys(data.participants).filter(i => i !== "me"));
      ids.splice(rnd.randint(0, 15), 0, "me");
      const pairs = [];
      for (let i = 0; i < 16; i += 2) pairs.push({ white: ids[i], black: ids[i + 1], result: null, winner: null });
      Object.assign(data, { knockout: { r16: pairs }, ko_round: "r16", stage: "knockout", rounds: [], round: 0, total_rounds: 0, division: null, legs: 1 });
      simulateKoRoundBots(data);
      return data;
    }

    const scoreOf = Tour.scoreOf;
    function simulateResult(data, white, black) {
      const exp = expScore(data.participants[white].rating, data.participants[black].rating);
      const draw = 0.10 + 0.14 * (1 - Math.abs(exp - 0.5) * 2), r = rnd.random();
      if (r < exp - draw / 2) return "1-0";
      if (r < exp + draw / 2) return "1/2-1/2";
      return "0-1";
    }
    function standings(data) {
      const table = {};
      for (const pid of data.order) table[pid] = { id: pid, played: 0, w: 0, d: 0, l: 0, pts: 0 };
      for (const rd of data.rounds) for (const m of rd) {
        if (!m.result) continue;
        for (const pid of [m.white, m.black]) {
          const s = scoreOf(m.result, pid, m), row = table[pid];
          row.played++;
          if (s === 1) { row.w++; row.pts += 3; } else if (s === 0.5) { row.d++; row.pts += 1; } else row.l++;
        }
      }
      const rows = Object.values(table).sort((a, b) => (b.pts - a.pts) || (b.w - a.w) || (data.participants[b.id].rating - data.participants[a.id].rating));
      rows.forEach((r, i) => { r.pos = i + 1; });
      return rows;
    }
    const koWinner = m => m.result === "1-0" ? m.white : m.black;
    function simKoWinner(data, m) {
      if (m.result === "1-0") return m.white;
      if (m.result === "0-1") return m.black;
      return rnd.random() < expScore(data.participants[m.white].rating, data.participants[m.black].rating) ? m.white : m.black;
    }
    function playerMatch(data) {
      if (data.player_status !== "playing") return null;
      if (data.kind === "copa") {
        const ms = data.knockout[data.ko_round] || [];
        for (let i = 0; i < ms.length; i++) if (!ms[i].result && (ms[i].white === "me" || ms[i].black === "me")) return [data.ko_round, i, ms[i]];
        return null;
      }
      if (data.stage === "league") {
        const ms = data.rounds[data.round - 1];
        for (let i = 0; i < ms.length; i++) if (!ms[i].result && (ms[i].white === "me" || ms[i].black === "me")) return ["group", i, ms[i]];
      }
      return null;
    }
    function stageLabel(data) {
      if (data.stage === "finished") return "Encerrado";
      if (data.kind === "copa") return KO_NAMES[data.ko_round];
      return `Rodada ${data.round} de ${data.total_rounds}`;
    }
    function describeMatch(data, found) {
      const [where, idx, m] = found, oppId = m.white === "me" ? m.black : m.white;
      return { where, index: idx, label: stageLabel(data) + (m.tb ? " · Desempate" : ""), color: m.white === "me" ? "white" : "black", opponent: data.participants[oppId], knockout: where !== "group" };
    }

    function finishLeagueRound(data) {
      const rd = data.rounds[data.round - 1];
      for (const m of rd) if (!m.result) m.result = simulateResult(data, m.white, m.black);
      if (data.round < data.total_rounds) { data.round++; return; }
      data.stage = "finished";
      const table = standings(data);
      data.final_table = table.map(r => r.id);
      data.champion = table[0].id;
      const pos = table.find(r => r.id === "me").pos;
      data.player_place = pos;
      data.player_status = pos === 1 ? "champion" : "done";
      if (data.kind === "estadual") data.qualified_copa = pos <= 4;
      else {
        const div = data.division, n = table.length;
        data.promoted = pos <= 2 && div !== "A";
        data.relegated = pos > n - 2 && div !== "D";
        const idx = DIVISIONS.indexOf(div);
        data.division_after = data.promoted ? DIVISIONS[Math.min(3, idx + 1)] : data.relegated ? DIVISIONS[Math.max(0, idx - 1)] : div;
      }
    }
    function simulateKoRoundBots(data) {
      for (const m of data.knockout[data.ko_round]) {
        if (!m.result && (m.white === "me" || m.black === "me") && data.player_status !== "playing") {   // jogador já fora: perde por W.O.
          m.result = m.white === "me" ? "0-1" : "1-0"; m.winner = koWinner(m); m.note = "W.O. (abandono)";
        } else if (!m.result && m.white !== "me" && m.black !== "me") {
          m.result = simulateResult(data, m.white, m.black);
          m.winner = simKoWinner(data, m);
          if (m.result === "1/2-1/2") m.note = "Empate → desempate (simulado)";
        }
      }
    }
    function finishKoRound(data) {
      const rd = data.ko_round;
      simulateKoRoundBots(data);
      const matches = data.knockout[rd];
      if (matches.some(m => !m.result)) return;
      if (rd === "final") {
        data.champion = matches[0].winner; data.stage = "finished";
        if (data.champion === "me") { data.player_status = "champion"; data.player_place = "champion"; }
        return;
      }
      const nxt = KO_ROUNDS[KO_ROUNDS.indexOf(rd) + 1], winners = matches.map(m => m.winner), pairs = [];
      for (let i = 0; i < winners.length; i += 2) {
        let a = winners[i], b = winners[i + 1];
        if (rnd.random() < 0.5) [a, b] = [b, a];
        pairs.push({ white: a, black: b, result: null, winner: null });
      }
      data.knockout[nxt] = pairs; data.ko_round = nxt;
      simulateKoRoundBots(data);
      if (pairs.every(m => m.result)) finishKoRound(data);
    }
    function simulateToEnd(data) {
      let guard = 0;
      while (data.stage !== "finished" && guard < 40) {
        guard++;
        if (data.kind === "copa") { simulateKoRoundBots(data); finishKoRound(data); } else finishLeagueRound(data);
      }
    }
    function recordPlayerResult(data, result, gameId) {
      const found = playerMatch(data);
      if (!found) return null;
      const [where, , match] = found;
      match.result = result; match.game_id = gameId;
      if (scoreOf(result, "me", match) === 1) data.player_wins++;
      const summary = { where, score: scoreOf(result, "me", match), kind: data.kind };
      if (data.kind === "copa") {
        if (result === "1/2-1/2" && (match.tb || 0) < MAX_TIEBREAKS) {
          match.result = null; match.tb = (match.tb || 0) + 1;
          [match.white, match.black] = [match.black, match.white];
          match.note = `Empate! Jogo de desempate ${match.tb} (cores trocadas)`;
          summary.tiebreak = match.tb;
        } else {
          match.winner = koWinner(match);
          if (result === "1/2-1/2") match.note = "Empates seguidos: avançam as pretas";
          if (match.winner !== "me") { data.player_status = "eliminated"; data.player_place = where; }
          finishKoRound(data);
        }
      } else finishLeagueRound(data);
      if (data.player_status === "eliminated") simulateToEnd(data);
      return Object.assign(summary, progressSummary(data));
    }
    function forfeit(data) {
      if (data.player_status !== "playing") return;
      data.forfeit = true;
      if (data.kind === "copa") {
        const found = playerMatch(data);
        if (found) { const [, , m] = found; m.result = m.white === "me" ? "0-1" : "1-0"; m.note = "W.O. (abandono)"; m.winner = koWinner(m); }
        data.player_status = "eliminated"; data.player_place = data.ko_round;
        simulateToEnd(data);
        return;
      }
      data.player_status = "eliminated";
      while (data.stage !== "finished") {
        for (const m of data.rounds[data.round - 1]) if (!m.result && (m.white === "me" || m.black === "me")) { m.result = m.white === "me" ? "0-1" : "1-0"; m.note = "W.O. (abandono)"; }
        finishLeagueRound(data);
      }
      data.player_status = "eliminated";            // abandono mantém 'eliminated'
    }
    function prize(data) {
      if (data.forfeit || data.stage === "playing") return 0;
      const table = PRIZES[data.kind], place = data.player_place;
      const baseP = data.kind === "copa" ? (table[place] || 0) : (table[place] !== undefined ? table[place] : table.other);
      let bonus = WIN_BONUS * data.player_wins;
      if (data.kind === "liga" && data.promoted) bonus += PROMOTION_BONUS;
      return baseP + bonus;
    }
    function placeLabel(data) {
      const p = data.player_place;
      if (p === null || p === undefined) return "";
      if (data.kind === "copa") return COPA_PLACES[p] || "";
      if (p === 1) return "🏆 Campeão";
      let extra = "";
      if (data.kind === "estadual" && data.qualified_copa) extra = " · classificado para a Copa";
      if (data.kind === "liga") { if (data.promoted) extra = " · ⬆️ subiu de série"; else if (data.relegated) extra = " · ⬇️ rebaixado"; }
      return `${p}º lugar${extra}`;
    }
    function championInfo(data) {
      if (!data.champion) return null;
      const c = data.participants[data.champion];
      return { id: c.id, name: c.club.name, flag: "🏆" };
    }
    function progressSummary(data) {
      const out = { stage: data.stage, stage_label: stageLabel(data), player_status: data.player_status, kind: data.kind, champ: true };
      if (data.player_status === "playing") { const n = playerMatch(data); if (n) out.next = describeMatch(data, n); }
      else { out.place = data.player_place; out.place_label = placeLabel(data); }
      if (data.stage === "finished") { out.prize = prize(data); out.champion = championInfo(data); }
      return out;
    }
    function zones(data) {
      if (data.kind === "estadual") return { up: 4, down: 0, up_label: "Classificado para a Copa do Brasil" };
      const div = data.division;
      return { up: div !== "A" ? 2 : 0, down: div !== "D" ? 2 : 0, up_label: "Acesso à série de cima", down_label: "Zona de rebaixamento", title: div === "A" ? 1 : 0 };
    }
    function publicState(data) {
      const nxt = playerMatch(data);
      const out = {
        kind: data.kind, kind_label: KINDS[data.kind].label, icon: KINDS[data.kind].icon, season: data.season, name: data.name, uf: data.uf, division: data.division || null,
        tc_label: data.tc_label, tc_icon: data.tc_icon, time_control: data.time_control, stage: data.stage, stage_label: stageLabel(data), round: data.round, total_rounds: data.total_rounds,
        participants: data.participants, player_status: data.player_status, player_place: data.player_place, place_label: placeLabel(data), player_wins: data.player_wins,
        champion: data.champion, champion_info: championInfo(data), next: nxt ? describeMatch(data, nxt) : null, forfeit: !!data.forfeit,
        prize: data.stage === "finished" ? prize(data) : null, prizes: PRIZES[data.kind], win_bonus: WIN_BONUS, promotion_bonus: PROMOTION_BONUS,
        qualified_copa: data.qualified_copa === undefined ? null : data.qualified_copa, promoted: data.promoted === undefined ? null : data.promoted,
        relegated: data.relegated === undefined ? null : data.relegated, division_after: data.division_after || null,
      };
      if (data.kind === "copa") { out.knockout = Object.fromEntries(KO_ROUNDS.map(r => [r, data.knockout[r] || []])); out.ko_names = KO_NAMES; out.ko_round = data.ko_round; }
      else { out.table = standings(data); out.rounds = data.rounds; out.zones = zones(data); }
      return out;
    }
    return { KINDS, DIVISIONS, PRIZES, PROMOTION_BONUS, WIN_BONUS, divisionForRating, divisionName, createLeague, createCopa, playerMatch, stageLabel, describeMatch,
      recordPlayerResult, forfeit, prize, placeLabel, championInfo, publicState };
  })();

  // ======================================================================= carreira
  const Career = (() => {
    class CareerError extends UserError {}
    const honors = p => K.jparse(p.honors, []);
    function addHonor(p, h) { const l = honors(p); l.push(h); p.honors = JSON.stringify(l); }
    function getClub(p) {
      const c = K.jparse(p.club, null);
      if (!c) return null;
      const crest = K.Shop.BY_KEY[K.Shop.equipped(p).crest || ""];
      if (crest && crest.data) c.style = crest.data;
      return c;
    }
    const rows = (p, season) => S.where("championships", r => r.player_id === p.id && (season === undefined || r.season === season)).sort((a, b) => b.id - a.id);
    function current(p) { const out = {}; for (const r of rows(p, p.season)) if (!(r.kind in out)) out[r.kind] = r; return out; }

    function startCareer(p, uf, clubName, palette = 0) {
      if (p.season) throw new CareerError('Você já tem uma carreira. Para trocar o clube, use "Editar clube".');
      if (!p.placement_done) throw new CareerError("Termine suas partidas de classificação antes de iniciar a carreira.");
      if (!Clubs.validUf(uf)) throw new CareerError("Escolha o seu estado.");
      const name = String(clubName || "").split(/\s+/).filter(Boolean).join(" ");
      if (name.length < 3) throw new CareerError("O nome do clube precisa ter pelo menos 3 letras.");
      p.uf = uf;
      p.club = JSON.stringify(Clubs.playerClub(name, uf, parseInt(palette || 0, 10)));
      p.division = Champ.divisionForRating(p.rating);
      p.season = 1;
    }
    function editClub(p, clubName, palette, uf) {
      if (!p.season) throw new CareerError("Inicie a carreira primeiro.");
      const c = K.jparse(p.club, {});
      if (uf && uf !== p.uf) {
        if (rows(p).some(r => r.status === "active")) throw new CareerError("Termine ou abandone as competições em andamento antes de trocar de estado.");
        if (!Clubs.validUf(uf)) throw new CareerError("Estado inválido.");
        p.uf = uf; c.uf = uf; c.city = Clubs.UFS[uf][2][0];
      }
      if (clubName !== undefined && clubName !== null) {
        const name = String(clubName).split(/\s+/).filter(Boolean).join(" ");
        if (name.length < 3) throw new CareerError("O nome do clube precisa ter pelo menos 3 letras.");
        c.name = name.slice(0, 28);
      }
      if (palette !== undefined && palette !== null) { const pal = Clubs.PALETTES[((parseInt(palette, 10) % 16) + 16) % Clubs.PALETTES.length]; c.c1 = pal[0]; c.c2 = pal[1]; }
      p.club = JSON.stringify(c);
    }
    function card(row) {
      const data = loads(row.data), nxt = Champ.playerMatch(data);
      return { id: row.id, kind: row.kind, name: row.name, season: row.season, status: row.status, player_status: row.player_status, stage_label: Champ.stageLabel(data),
        tc_label: data.tc_label, tc_icon: data.tc_icon, place_label: data.player_place !== null && data.player_place !== undefined ? Champ.placeLabel(data) : null, prize: row.prize,
        wins: data.player_wins, forfeit: !!data.forfeit, next: nxt ? Champ.describeMatch(data, nxt) : null, champion: Champ.championInfo(data),
        qualified_copa: data.qualified_copa === undefined ? null : data.qualified_copa, promoted: data.promoted === undefined ? null : data.promoted,
        relegated: data.relegated === undefined ? null : data.relegated, division: data.division || null };
    }
    function nextHint(estDone, liga, copa) {
      const pend = [];
      if (!estDone) pend.push("o Estadual");
      if (!(liga && liga.status === "finished")) pend.push("a Liga");
      if (copa && copa.status === "active") pend.push("a Copa do Brasil");
      return pend.length ? "Termine " + pend.join(" e ") + " para encerrar a temporada." : null;
    }
    function status(p) {
      const out = { has_career: !!p.season, can_join: !!p.placement_done, coins: p.coins || 0, trophies: p.trophies || 0, ufs: Clubs.ufList(),
        palettes: Clubs.PALETTES.map(([c1, c2]) => ({ c1, c2 })), crest_styles: Clubs.CREST_STYLES, kinds: Champ.KINDS, division_suggested: Champ.divisionForRating(p.rating) };
      if (!p.season) return out;
      const cur = current(p), est = cur.estadual;
      const estDone = !!(est && est.status === "finished");
      const qualified = !!(estDone && loads(est.data).qualified_copa);
      const liga = cur.liga, copa = cur.copa;
      const canNext = estDone && !!(liga && liga.status === "finished") && !(copa && copa.status === "active");
      const prizes = {};
      for (const [k, v] of Object.entries(Champ.PRIZES)) prizes[k] = Object.fromEntries(Object.entries(v).map(([a, b]) => [String(a), b]));
      return Object.assign(out, {
        uf: p.uf, uf_name: p.uf ? Clubs.UFS[p.uf][0] : null, club: getClub(p), division: p.division, division_name: Champ.divisionName(p.division), season: p.season,
        competitions: Object.fromEntries(Object.keys(Champ.KINDS).map(k => [k, cur[k] ? card(cur[k]) : null])),
        copa_open: qualified && !copa,
        copa_note: !estDone ? "Termine entre os 4 primeiros do Estadual para disputar a Copa." : qualified ? "Você se classificou!" : "Você não se classificou para a Copa nesta temporada.",
        can_next_season: canNext, next_season_hint: canNext ? null : nextHint(estDone, liga, copa), honors: honors(p),
        history: rows(p).filter(r => r.status === "finished" && r.season !== p.season).slice(0, 30).map(card),
        prizes, win_bonus: Champ.WIN_BONUS, promotion_bonus: Champ.PROMOTION_BONUS, live_ids: Object.values(cur).filter(r => r.status === "active").map(r => r.id),
      });
    }
    function startCompetition(p, kind, tcKey) {
      if (!(kind in Champ.KINDS)) throw new CareerError("Competição inválida.");
      if (!p.season) throw new CareerError("Inicie a carreira primeiro.");
      if (!(tcKey in K.TimeControl.TIME_CONTROLS)) throw new CareerError("Ritmo de jogo inválido.");
      const cur = current(p);
      if (kind in cur) throw new CareerError("Você já disputou essa competição nesta temporada.");
      const club = getClub(p);
      let data;
      if (kind === "estadual") data = Champ.createLeague("estadual", p, p.season, p.uf, club, tcKey);
      else if (kind === "liga") data = Champ.createLeague("liga", p, p.season, p.uf, club, tcKey, p.division);
      else {
        const est = cur.estadual;
        if (!(est && est.status === "finished" && loads(est.data).qualified_copa)) throw new CareerError("Você precisa se classificar no Estadual (4 primeiros) para disputar a Copa do Brasil.");
        data = Champ.createCopa(p, p.season, p.uf, club, tcKey);
      }
      return S.insert("championships", { player_id: p.id, kind, season: p.season, name: data.name, status: "active", player_status: "playing", place: null, prize: 0,
        data: dumps(data), created_at: now(), finished_at: null });
    }
    function honorOf(p, data) {
      const k = data.kind;
      const label = k === "estadual" ? `Campeão ${Clubs.UFS[data.uf][0]}` : k === "liga" ? `Campeão da ${Champ.divisionName(data.division)}` : "Campeão da Copa do Brasil";
      const club = getClub(p) || {};
      return { kind: k, season: data.season, label, club: club.name || "", icon: Champ.KINDS[k].icon };
    }
    function sync(p, row, data) {
      row.data = dumps(data);
      row.player_status = data.player_status;
      row.place = data.player_place !== null && data.player_place !== undefined ? String(data.player_place) : null;
      row.status = data.stage === "finished" ? "finished" : "active";
      const summary = {};
      if (data.stage === "finished" && !row.finished_at) {
        row.finished_at = now();
        row.prize = Champ.prize(data);
        const label = Champ.KINDS[row.kind].label;
        if (row.prize) K.Economy.credit(p, row.prize, "championship", `${label}: ${Champ.placeLabel(data).replace("🏆 ", "")} (temporada ${row.season})`, row.id);
        if (data.kind === "liga" && data.division_after) p.division = data.division_after;
        if (data.player_status === "champion" && !data.forfeit) { p.trophies = (p.trophies || 0) + 1; addHonor(p, honorOf(p, data)); }
        summary.prize = row.prize;
      }
      return summary;
    }
    function nextSeason(p) {
      const s = status(p);
      if (!s.can_next_season) throw new CareerError(s.next_season_hint || "A temporada ainda não terminou.");
      p.season += 1;
      return p.season;
    }
    return { CareerError, getClub, honors, startCareer, editClub, status, startCompetition, sync, nextSeason, card };
  })();

  // ======================================================================= regras escritas (mostradas ANTES da inscrição)
  const Rules = (() => {
    const STRENGTH_TEXT = { easy: "mais fracos (cerca de 150 pontos abaixo de você)", equal: "do seu nível (rating parecido com o seu)", hard: "mais fortes (cerca de 150 pontos acima de você)" };
    function common(tcKey) {
      const [base, , name, icon] = K.TimeControl.get(tcKey);
      const out = [["⚖️", "As partidas valem rating (Elo), como nas ranqueadas."]];
      if (base) out.push([icon, `Ritmo: ${name}. Se o seu tempo acabar, você perde a partida (a não ser que o adversário não tenha material para dar mate: aí é empate).`]);
      else out.push(["∞", "Sem relógio: pense o tempo que quiser."]);
      out.push(["🏳️", "Desistir de uma partida conta como derrota."]);
      out.push(["🚪", "Abandonar a competição: a partida pendente conta como derrota e você não recebe prêmio."]);
      return out;
    }
    const TIEBREAK = ["🔁", "Empate no mata-mata: tem JOGO DE DESEMPATE, com as cores trocadas (quem jogou de brancas joga de pretas). Se empatar de novo, repete. " +
      `Só depois de ${Tour.MAX_TIEBREAKS} empates seguidos avança quem jogou de pretas no último jogo.`];
    function tournament(tcKey = "blitz", strength = "equal") {
      const p = Tour.PRIZES;
      const items = [
        ["👥", `32 participantes: você e 31 bots, ${STRENGTH_TEXT[strength] || STRENGTH_TEXT.equal}.`],
        ["📋", "Fase de grupos: 8 grupos de 4, todos contra todos (3 rodadas). Vitória = 1 ponto, empate = ½, derrota = 0."],
        ["➡️", "Os 2 primeiros de cada grupo avançam. Desempate na tabela: pontos, Sonneborn-Berger, confronto direto, vitórias e rating."],
        ["🧩", "Mata-mata: oitavas, quartas, semifinal e final, em partida única."],
        TIEBREAK,
        ["🪙", `Prêmios: campeão ${p.champion} 🪙, vice ${p.final}, semifinal ${p.sf}, quartas ${p.qf}, oitavas ${p.r16}, e +${Tour.WIN_BONUS} por vitória. Quem cai na fase de grupos ganha só o bônus das vitórias.`],
        ["🏆", "O campeão ganha 1 troféu."],
        ["📌", "Você pode estar em até 5 torneios ao mesmo tempo."],
        ...common(tcKey),
      ];
      return { title: "Regras do torneio", items };
    }
    function championship(kind, tcKey = "rapid", division) {
      const pz = Champ.PRIZES[kind], items = [];
      if (kind === "estadual") items.push(
        ["🏟️", "8 clubes do seu estado (você e 7 clubes fictícios), pontos corridos em turno único: 7 rodadas, um jogo por rodada."],
        ["🧮", "Vitória = 3 pontos, empate = 1, derrota = 0. Desempate na tabela: pontos, vitórias e rating."],
        ["🏆", "Os 4 primeiros se classificam para a Copa do Brasil da temporada."],
        ["🪙", `Prêmios: 1º ${pz[1]} 🪙, 2º ${pz[2]}, 3º e 4º ${pz[3]}, demais ${pz.other}; +${Champ.WIN_BONUS} por vitória.`]);
      else if (kind === "liga") {
        const d = division || "D";
        items.push(
          ["⚽", `Liga Nex-J, ${Champ.divisionName(d)}: 8 clubes, ida e volta (14 rodadas). Adversários na força da série.`],
          ["🧮", "Vitória = 3 pontos, empate = 1, derrota = 0. Desempate na tabela: pontos, vitórias e rating."],
          ["⬆️", d !== "A" ? "Os 2 primeiros SOBEM de série." : "Você já está na Série A: briga pelo título."],
          ["⬇️", d !== "D" ? "Os 2 últimos CAEM de série." : "Na Série D não há rebaixamento."],
          ["🪙", `Prêmios: 1º ${pz[1]} 🪙, 2º ${pz[2]}, 3º ${pz[3]}, 4º ${pz[4]}, demais ${pz.other}; +${Champ.WIN_BONUS} por vitória e +${Champ.PROMOTION_BONUS} pelo acesso.`]);
      } else items.push(
        ["🏆", "Copa do Brasil: 16 clubes, mata-mata em partida única (oitavas, quartas, semifinal, final)."],
        ["🎟️", "Só joga quem se classificou entre os 4 primeiros do Estadual da temporada."],
        TIEBREAK,
        ["🪙", `Prêmios: campeão ${pz.champion} 🪙, vice ${pz.final}, semifinal ${pz.sf}, quartas ${pz.qf}, oitavas ${pz.r16}; +${Champ.WIN_BONUS} por vitória.`]);
      items.push(["🏅", "Quem for campeão ganha um troféu na sala de troféus."], ["📅", "Cada competição é disputada uma vez por temporada."], ...common(tcKey));
      return { title: `Regras: ${Champ.KINDS[kind].label}`, items };
    }
    return { tournament, championship };
  })();

  // ======================================================================= ganchos do fim de partida (games.js)
  G.hooks.tournament = function (s, player, result, gameId) {
    const t = S.get("tournaments", s.tournament_id);
    if (!t || t.player_id !== player.id) return;
    const data = loads(t.data), summary = Tour.recordPlayerResult(data, result, gameId);
    if (!summary) return;
    t.data = dumps(data); t.status = data.stage; t.player_status = data.player_status; t.place = data.player_place;
    if (data.player_status !== "playing" && !t.finished_at) {
      t.prize = Tour.prize(data);
      K.Economy.credit(player, t.prize, "tournament", `Prêmio de torneio: ${Tour.PLACE_NAMES[data.player_place] || "participação"} no ${t.name}`, t.id);
      if (data.player_status === "champion") player.trophies = (player.trophies || 0) + 1;
      summary.prize = t.prize;
    }
    if (data.stage === "finished" && !t.finished_at) t.finished_at = now();
    summary.tournament_id = t.id; summary.tournament_name = t.name;
    s.tournament_info = summary;
  };
  G.hooks.champ = function (s, player, result, gameId) {
    const row = S.get("championships", s.champ_id);
    if (!row || row.player_id !== player.id) return;
    const data = loads(row.data), summary = Champ.recordPlayerResult(data, result, gameId);
    if (!summary) return;
    Object.assign(summary, Career.sync(player, row, data));
    if (data.stage === "finished") summary.prize = row.prize;
    summary.tournament_id = row.id; summary.tournament_name = row.name; summary.kind_label = Champ.KINDS[row.kind].label;
    if (data.stage === "finished") { summary.promoted = data.promoted === undefined ? null : data.promoted; summary.relegated = data.relegated === undefined ? null : data.relegated; summary.qualified_copa = data.qualified_copa === undefined ? null : data.qualified_copa; }
    s.tournament_info = summary;
  };

  root.NJComp = { Clubs, Tour, Champ, Career, Rules, loads, dumps };
})(typeof self !== "undefined" ? self : this);
