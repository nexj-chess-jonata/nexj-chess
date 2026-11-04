"""Fluxo completo pela interface: criar conta, jogar, perder, loja, treino, recarregar (persistência)."""
import sys, json
from playwright.sync_api import sync_playwright
URL = "http://localhost:8777/index.html"
errs = []
def log(m): print(m, flush=True)
def shown(page, sel): return page.evaluate("s => { const e = document.querySelector(s); return !!e && e.classList.contains('open'); }", sel)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 430, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    page.goto(URL); page.wait_for_selector("#authView", state="visible", timeout=15000)
    page.click('#authTabs [data-v=register]')
    page.fill('#registerForm [name=name]', "Jonata"); page.fill('#registerForm [name=username]', "jonata")
    page.check('#regNoPass')                       # entra só com o nome
    page.click('#registerForm button[type=submit]')
    page.wait_for_function("document.querySelector('#recoveryModal').classList.contains('open')", timeout=8000)
    page.check("#recOk"); page.click("#recGo")
    page.wait_for_function("document.querySelector('#welcomeModal').classList.contains('open')", timeout=8000)
    page.click("#chooseBeginner")                  # "nunca joguei": rating 300
    page.wait_for_function("document.querySelector('#revealModal').classList.contains('open')", timeout=8000)
    page.click("#revGo"); page.wait_for_timeout(600)
    log("conta criada; rating: " + page.inner_text("#pRating") + "  moedas: " + page.inner_text("#coinBalance"))

    # ---- partida casual: joga e4 com cliques e espera o bot responder
    if not shown(page, "#newModal"): page.click("#btnNew")
    page.wait_for_function("document.querySelector('#newModal').classList.contains('open')", timeout=5000)
    page.click('#colorSeg [data-v=white]'); page.click('#modeSeg [data-v=casual]')
    page.click("#btnStart"); page.wait_for_selector('#board [data-square="e2"]')
    page.click('#board [data-square="e2"]'); page.click('#board [data-square="e4"]')
    page.wait_for_function("document.querySelectorAll('#moves li:not(.empty)').length >= 1", timeout=8000)
    try:
        page.wait_for_function("(() => { const t = document.querySelector('#moves').innerText; return t.split(/\\s+/).filter(x=>x).length >= 3; })()", timeout=15000)
    except Exception:
        log("SEM RESPOSTA DO BOT. moves=" + page.inner_text("#moves").replace("\n"," ") + " erros=" + json.dumps(errs)[:600]); page.screenshot(path="/tmp/ui_stuck.png"); raise
    log("lances na tela: " + " | ".join(page.inner_text("#moves").split()))
    page.screenshot(path="/tmp/ui_moves.png")

    # ---- desiste (confirmação inline) e vê o resultado
    page.click("#btnResign"); page.wait_for_timeout(300); page.click("#btnResign")
    page.wait_for_function("document.querySelector('#resultModal').classList.contains('open')", timeout=8000)
    log("resultado: " + page.inner_text("#resTitle") + " — " + page.inner_text("#resTerm"))
    page.screenshot(path="/tmp/ui_result.png")
    page.click("#resultModal [data-close]")

    # ---- perfil, loja, treino
    page.click("[data-view=profile]"); page.wait_for_timeout(500)
    log("perfil: " + page.inner_text("#profName") + " · jogos: " + page.inner_text("#statGrid")[:80].replace("\n", " "))
    page.screenshot(path="/tmp/ui_profile.png")
    page.click("[data-view=shop]"); page.wait_for_selector("#shopGrid .shop-item, #shopGrid > *", timeout=5000)
    log("loja: " + str(page.locator("#shopGrid > *").count()) + " cartões; saldo " + page.inner_text("#shopCoins"))
    page.screenshot(path="/tmp/ui_shop.png")
    page.click("[data-view=training]"); page.wait_for_selector("#dailyPuzzles > *", timeout=5000)
    log("treino: " + str(page.locator("#dailyPuzzles > *").count()) + " puzzles do dia, " + str(page.locator("#missions > *").count()) + " missões")
    page.screenshot(path="/tmp/ui_train.png")
    page.locator("#dailyPuzzles > *").first.click()
    page.wait_for_selector("#pzBoard .nb-sq", timeout=5000)
    log("puzzle aberto: " + page.inner_text("#pzTitle"))
    page.screenshot(path="/tmp/ui_puzzle.png")

    # ---- recarrega: tudo precisa continuar salvo (IndexedDB) e a conta sem senha entra direto com o nome
    page.wait_for_timeout(800)
    page.reload(); page.wait_for_timeout(2500)
    page.wait_for_timeout(1200)
    logged = page.evaluate("!document.querySelector('#authView').offsetParent")
    log("depois de recarregar: logado=" + str(logged))
    if not logged:
        page.fill('#loginForm [name=username]', "jonata"); page.click('#loginForm button[type=submit]'); page.wait_for_timeout(1200)
    if shown(page, "#newModal"): page.click("#newModal [data-close]"); page.wait_for_timeout(400)
    page.click("[data-view=profile]"); page.wait_for_timeout(500)
    log("perfil após recarregar: " + page.inner_text("#profName") + " | " + page.inner_text("#histList")[:60].replace("\n", " "))
    print("ERROS:", json.dumps(errs, ensure_ascii=False)[:2000])
    b.close()
