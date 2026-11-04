# Nex-J Chess no iPhone (e Android) — guia rápido

O app é um site que funciona 100% offline depois de instalado. O iPhone precisa que ele esteja numa **página na internet (https)** só na hora de instalar. Depois, abre sem internet.

## Como colocar o app no ar (uma vez só)
Opção mais simples e grátis: **GitHub Pages**
1. Crie uma conta em github.com e um repositório novo (ex.: `nexj-chess`), público.
2. Envie para ele o **conteúdo da pasta `www`** (index.html, sw.js, manifest.webmanifest, js, static, icons).
3. Em *Settings → Pages*, escolha a branch `main` e a pasta `/ (root)`. Em 1–2 minutos aparece o endereço `https://SEUUSUARIO.github.io/nexj-chess/`.

## Instalar no iPhone
1. Abra o endereço **no Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta ↑) → **Adicionar à Tela de Início** → **Adicionar**.
3. Abra **sempre pelo ícone ♞** da tela inicial.
4. Com internet, abra o app uma vez e espere uns segundos (ele baixa tudo para funcionar offline). Pronto: pode ativar o modo avião e testar.

## Instalar no Android (sem APK)
Chrome → endereço do app → menu ⋮ → **Instalar app**. (O APK de verdade vem na etapa 5.)

## Cuidados com seus dados
- Os jogos ficam **dentro do aparelho**. No iPhone, o Safari pode apagar dados de sites que ficam muito tempo sem uso; por isso o app instalado na tela inicial é mais seguro.
- Em **Configurações → Backup** toque em **Salvar cópia em arquivo** de vez em quando e guarde o arquivo no iCloud/Drive/WhatsApp. Para voltar: **Restaurar de um arquivo**.
- Atualizar o app: suba os arquivos novos de `www` (rode antes `python tools/gerar_sw.py`) e abra o app com internet; ele se atualiza sozinho.

## Testar no computador antes


> Mais fácil: o arquivo `GUIA_ANDROID_E_PUBLICACAO.md` mostra como o GitHub publica o app do iPhone e gera o APK sozinho.
