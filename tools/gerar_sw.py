"""Gera www/sw.js com a lista de todos os arquivos do app (cache offline). Rode depois de mudar qualquer arquivo de www/."""
import os, sys, json, hashlib
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "www")
root = os.path.normpath(root)
skip = {"sw.js", "demo_motor.html"}
files, h = [], hashlib.sha1()
for d, _, fs in os.walk(root):
    for f in sorted(fs):
        full = os.path.join(d, f); rel = os.path.relpath(full, root).replace(os.sep, "/")
        if rel in skip or f.startswith("."): continue
        files.append(rel); h.update(rel.encode()); h.update(open(full, "rb").read())
files.sort()
version = h.hexdigest()[:10]
js = f'''/* Nex-J Chess — cache offline (gerado por tools/gerar_sw.py; não edite à mão). */
const VERSION = "nexj-{version}";
const FILES = {json.dumps(["./"] + files, indent=1)};
self.addEventListener("install", e => {{
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", e => {{
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k.startsWith("nexj-")).map(k => caches.delete(k)))).then(() => self.clients.claim()));
}});
self.addEventListener("fetch", e => {{
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, {{ ignoreSearch: true }}).then(hit => hit || fetch(e.request).then(r => {{
    if (r && r.ok && new URL(e.request.url).origin === location.origin) {{ const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }}
    return r;
  }}).catch(() => caches.match("./index.html"))));
}});
'''
open(os.path.join(root, "sw.js"), "w", encoding="utf-8").write(js)
print(f"sw.js: {len(files)} arquivos, versão {version}")
