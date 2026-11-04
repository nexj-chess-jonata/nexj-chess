from playwright.sync_api import sync_playwright
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    dev=p.devices["iPhone 13"]
    ctx=b.new_context(**dev); pg=ctx.new_page()
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None); pg.on("pageerror",lambda e: errs.append("PAGEERROR "+str(e)))
    pg.goto("http://localhost:8777/index.html"); pg.wait_for_selector("#authView",state="visible",timeout=15000)
    pg.wait_for_function("navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then(r=>r&&r.active)",timeout=15000)
    pg.wait_for_timeout(3000)
    print("manifest:", pg.evaluate("document.querySelector('link[rel=manifest]').href"))
    print("caches:", pg.evaluate("caches.keys().then(async ks=>{const c=await caches.open(ks[0]);return ks[0]+' '+(await c.keys()).length})"))
    pg.click('#authTabs [data-v=register]'); pg.fill('#registerForm [name=name]',"Jonata"); pg.fill('#registerForm [name=username]',"jonata"); pg.check('#regNoPass'); pg.click('#registerForm button[type=submit]')
    pg.wait_for_function("document.querySelector('#recoveryModal').classList.contains('open')",timeout=8000); pg.check("#recOk"); pg.click("#recGo")
    pg.wait_for_function("document.querySelector('#welcomeModal').classList.contains('open')",timeout=8000); pg.click("#chooseBeginner")
    pg.wait_for_function("document.querySelector('#revealModal').classList.contains('open')",timeout=8000); pg.click("#revGo"); pg.wait_for_timeout(600)
    pg.evaluate("document.querySelectorAll('.modal.open [data-close]').forEach(b=>b.click())")
    pg.screenshot(path="/tmp/p1.png")
    nav=pg.evaluate("(()=>{const r=document.getElementById('tabs').getBoundingClientRect();return [r.top,r.bottom,innerHeight]})()"); print("nav",nav)
    pg.click('#tabs [data-view=profile]'); pg.wait_for_timeout(300)
    pg.click('#tabs [data-view=play]')
    pg.evaluate("document.querySelector('#btnNew') && document.querySelector('#btnNew').click()"); pg.wait_for_timeout(500)
    pg.screenshot(path="/tmp/p2.png")
    # backup/ settings
    pg.evaluate("document.querySelectorAll('.modal.open [data-close]').forEach(b=>b.click())")
    pg.click("#playerChip"); pg.wait_for_timeout(400); pg.screenshot(path="/tmp/p3.png")
    # offline reload
    ctx.set_offline(True); pg.reload(); pg.wait_for_timeout(2500)
    print("offline ok:", pg.evaluate("!!document.getElementById('playView') || !!document.getElementById('authView')"), pg.title())
    print("erros:", errs)
    b.close()
