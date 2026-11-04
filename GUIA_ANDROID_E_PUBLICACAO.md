# Nex-J Chess no celular — passo a passo (Android .apk + iPhone)

Você só precisa de uma conta gratuita no **GitHub** (github.com) e do computador. Tudo é feito pelo navegador, sem instalar nada.
O GitHub vai montar o **APK do Android** e publicar o **app do iPhone** sozinho.

## Parte 1 — Colocar o projeto no GitHub (uma vez)
1. Entre em github.com → **New repository** (botão verde).
2. Nome: `nexj-chess`. Deixe **Public**. Clique **Create repository**.
3. Na página do repositório vazio, clique em **uploading an existing file**.
4. Descompacte o zip da etapa 5 no computador. Abra a pasta `nexus_chess_mobile` e **arraste TODO o conteúdo** (inclusive a pasta `.github`, que é escondida) para a página do GitHub.
   - Se a pasta `.github` não aparecer no Windows: no Explorador, aba **Exibir → Itens ocultos**.
5. Role até o fim e clique **Commit changes**.

## Parte 2 — Ligar o site do iPhone (GitHub Pages)
1. No repositório: **Settings → Pages**. Em **Source**, escolha **GitHub Actions**.
2. Vá em **Actions** (aba de cima). Aguarde o fluxo **"Publicar o app"** ficar verde (1–3 min). Se não começou, clique nele → **Run workflow**.
3. O endereço aparece em Settings → Pages: `https://SEUUSUARIO.github.io/nexj-chess/`.

### Instalar no iPhone
Abra o endereço no **Safari** → **Compartilhar** (quadrado com seta) → **Adicionar à Tela de Início**. Abra uma vez com internet e espere uns segundos; depois funciona sem internet.

## Parte 3 — Gerar o APK do Android
1. Aba **Actions** → fluxo **"Gerar APK do Nex-J Chess"** → **Run workflow** → verde. Leva uns 5–10 min na primeira vez.
2. Clique na execução concluída → no fim da página, em **Artifacts**, baixe **nexj-chess-apk** (um zip com `app-debug.apk`).
3. Mande o `app-debug.apk` para o celular (Drive, WhatsApp, cabo USB).
4. No Android, toque no arquivo. Se pedir, permita **instalar apps de fontes desconhecidas** para o app que você usou para abrir o arquivo. Pronto: ícone ♞ na tela.

## Cuidados
- **Backup:** Configurações → Backup → **Salvar cópia em arquivo**. No Android abre o "Compartilhar" (mande para o Drive/WhatsApp). Para voltar: **Restaurar de um arquivo**.
- **Desinstalar o app apaga os jogos** — faça o backup antes.
- O APK é de teste (assinatura de depuração): serve para uso pessoal e da família; para a Play Store seria preciso assinar e publicar (outra etapa).
- Atualizar: troque os arquivos no GitHub; os dois fluxos rodam sozinhos. No Android instale o novo APK por cima (mantém os dados); no iPhone o app se atualiza ao abrir com internet.
- A ponte NexusJCoin e o Stockfish do PC não existem no celular; o app usa o motor interno (as partidas e bots funcionam normalmente).
