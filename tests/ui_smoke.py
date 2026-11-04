"""Teste da interface no navegador (Chromium) contra o servidor local do celular."""
import sys, json
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8777/index.html"
errs = []
def log(m): print(m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 430, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    page.goto(URL); page.wait_for_selector("#authView", state="visible", timeout=15000)
    log("tela de entrada ok")
    page.click('#authTabs [data-v=register]')
    page.fill('#registerForm [name=name]', "Jonata"); page.fill('#registerForm [name=username]', "jonata")
    page.fill('#registerForm [name=password]', "abcd"); page.fill('#registerForm [name=password2]', "abcd")
    page.click('#registerForm button[type=submit]')
    page.wait_for_selector("#recoveryModal.show, #recoveryModal.open, #recoveryModal[style*=flex]", timeout=8000)
    code = page.inner_text("#recCode"); log("código de recuperação: " + code)
    page.check("#recOk"); page.click("#recGo")
    page.wait_for_selector("#welcomeModal.show, #welcomeModal.open, #welcomeModal[style*=flex]", timeout=8000)
    log("boas-vindas ok"); page.click("#choosePlacement")
    page.wait_for_timeout(500)
    page.screenshot(path="/tmp/ui_new.png")
    # começa partida de classificação
    page.click("#btnStart"); page.wait_for_selector("#board .nb-sq, #board [data-sq]", timeout=8000)
    log("partida iniciada")
    page.wait_for_timeout(1500)
    log("engine status: " + page.inner_text("#engineStatus"))
    page.screenshot(path="/tmp/ui_game.png")
    print("ERROS:", json.dumps(errs, ensure_ascii=False)[:1500])
    b.close()
