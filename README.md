# ♞ Nex-J Chess — versão para celular (Fase 8)

App **offline**: roda inteiro no aparelho, sem servidor e sem internet. O que a pessoa faz fica salvo no próprio celular.

## Estado das etapas
1. ✅ Regras do xadrez + motor dos bots (`www/js/engine/`) — testados contra o python-chess e o Stockfish.
   - Regras: 92.324 posições idênticas ao python-chess; perft correto nas 6 posições de referência.
   - Força: níveis baixos imitam o "Skill Level" do Stockfish do PC (38%–67% de vitórias contra os bots do PC); níveis altos calibrados por nós de busca contra o Stockfish (≈1490 com 1.500 nós, ≈2500 com 120 mil nós). Acima de ~2500 o motor próprio chega ao limite de tempo; o Stockfish WASM entra aqui quando o arquivo for enviado.
   - Análise: mediana de 10 cp de diferença para o Stockfish; mesmo melhor lance em 63% das posições.
2. ✅ Contas, partidas, Elo, moedas, loja e treino (servidor local em JavaScript, dados no IndexedDB do aparelho).
3. ⏳ Torneios, campeonatos e carreira.
4. ⏳ Tela do celular, instalação pelo navegador (iPhone) e backup em arquivo.
5. ⏳ App Android (.apk), guia em português e testes finais.

## Etapa 1 — o que tem aqui
- `www/js/engine/chess.js` — regras completas (lances, xeque, mate, afogamento, roque, en passant, promoção, repetição, 50 lances, material insuficiente, SAN, FEN, PGN).
- `www/js/engine/search.js` — motor próprio (busca alfa-beta + avaliação).
- `www/js/engine/engine_api.js` — escolha de lance dos bots por rating e personalidade, análise e avaliação (porta de `core/engine.py`).
- `www/js/engine/engine_worker.js` + `engine_client.js` — o motor roda num Web Worker (a tela não trava).
- `www/demo_motor.html` — página para jogar contra o motor e sentir a força de cada nível.
- `tests/` — perft, comparação com o python-chess (92 mil posições), calibração contra o Stockfish.

## Etapa 2 — o que tem aqui
O jogo do PC (`app.py` + `core/*.py`) foi portado para JavaScript em `www/js/local/`. A interface (`www/static/js/*`) é a MESMA do PC:
um interceptor responde a cada `fetch("/api/...")` com o mesmo JSON que o Flask respondia.
- `store.js` — banco local (IndexedDB): contas, partidas, rating, moedas, itens, missões, puzzles; grava cada alteração sozinho.
- `core.js` — Elo, classificação (5 partidas), ritmos de jogo, títulos, moedas/extrato, loja (87 itens), avatar, missões, sequência, puzzles, bots.
- `games.js` — partida em andamento: lances, relógio, desistência, empate, dica e voltar lance (treino), fim de jogo e premiação.
- `coach.js` / `analysis.js` — treinador e análise da partida (mesmas fórmulas do PC).
- `api.js` — todas as rotas de conta, perfil, partida, loja, carteira, treino e backup (guardado no aparelho).
- `data_shop.js` / `data_puzzles.js` — gerados do código do PC por `tools/gerar_dados.py` (87 itens, 820 puzzles).
- `www/index.html` — a tela do jogo. Ainda sem torneios/campeonatos (etapa 3). A ponte NexusJCoin fica só no PC.
- Contas: senha, "entrar só com o nome" e código de recuperação funcionam como na v7.4.

Testes: `node tests/api_smoke.js` (servidor local, 35 verificações) e `python tests/ui_flow.py` (jogo pela tela, no Chromium).

## Como testar a etapa 2 no PC
Duplo clique em `iniciar_app.bat` (abre http://localhost:8765/index.html). Os dados de teste ficam no navegador e são separados do jogo do PC.

## Como testar a etapa 1 no PC
Duplo clique em `iniciar_demo.bat`, depois abra http://localhost:8765/demo_motor.html

## Etapa 3 — Torneios, campeonatos e carreira (concluída)
- `www/js/local/competitions.js`: torneios de 32 (grupos + mata-mata, desempate com cores trocadas), Estadual / Liga (Série D→A) / Copa do Brasil, clubes, carreira (temporadas, troféus, honrarias), regras mostradas antes da inscrição.
- "Jogar de novo" nos torneios encerrados; limite de 5 torneios ativos; abandono = derrota sem prêmio.
- Testes: `node tests/api_smoke.js` e `node tests/comp_smoke.js` (torneio completo, abandono, carreira, 3 competições, próxima temporada); `python tests/ui_comp.py`.
- Falta: etapa 4 (toque/PWA/backup em arquivo/guia iPhone) e etapa 5 (APK).

## Etapa 4 — Celular / PWA (concluída)
- `manifest.webmanifest`, `sw.js` (cache offline; gere com `python tools/gerar_sw.py` sempre que mudar algo em `www/`), ícones ♞ dourados em `www/icons/`.
- Barra de abas embaixo no celular, áreas seguras do iPhone, campos sem zoom, alvos de toque maiores.
- Backup: "Salvar cópia em arquivo" + "Restaurar de um arquivo" (.json); pede armazenamento permanente.
- Guia: `GUIA_IPHONE.md`. Teste: `python tests/ui_pwa.py` (emula iPhone 13, SW, offline).

## Etapa 5 — Android + publicação (concluída)
- `android_build/` (Capacitor: package.json, capacitor.config.json, ícones) e `.github/workflows/apk.yml` (gera o APK) e `pages.yml` (publica o app do iPhone).
- No app Android o backup abre o "Compartilhar" (plugins Filesystem + Share).
- Guia completo em português: `GUIA_ANDROID_E_PUBLICACAO.md`.
- Testes finais: `api_smoke.js`, `comp_smoke.js`, `ui_flow.py`, `ui_comp.py`, `ui_pwa.py` (também em subpasta, como no GitHub Pages).
