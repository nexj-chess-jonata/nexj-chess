"""Gera os arquivos de dados do app do celular a partir do código do PC (loja, avatar, puzzles).
Uso: python tools/gerar_dados.py <pasta nexus_chess do PC>"""
import json, sys, types, os
src = sys.argv[1]
for name in ("sqlalchemy", "core", "core.economy", "core.database", "core.coach", "core.analysis", "chess"):
    m = types.ModuleType(name); sys.modules[name] = m
sys.modules["sqlalchemy"].select = lambda *a, **k: None
sys.modules["core.database"].PlayerItem = object
sys.modules["core"].economy = sys.modules["core.economy"]
ns = {"__name__": "shop"}
exec(open(os.path.join(src, "core/shop.py"), encoding="utf-8").read(), ns)
def keyfix(d):  # chaves True/False do avatar viram "true"/"false"
    return {("true" if k is True else "false" if k is False else k): v for k, v in d.items()}
data = {
    "CATEGORIES": ns["CATEGORIES"], "CATALOG": ns["CATALOG"], "DESCRIPTIONS": ns["DESCRIPTIONS"],
    "MAX_FREEZES": ns["MAX_FREEZES"], "DEFAULT_EQUIPPED": ns["DEFAULT_EQUIPPED"],
    "AVATAR_OPTIONS": {k: [[("true" if x is True else "false" if x is False else x), need] for x, need in v.items()]
                       for k, v in ns["AVATAR_OPTIONS"].items()},
    "DEFAULT_AVATAR": ns["DEFAULT_AVATAR"],
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "www", "js", "local")
with open(os.path.join(out, "data_shop.js"), "w", encoding="utf-8") as f:
    f.write("/* GERADO por tools/gerar_dados.py a partir de core/shop.py — não editar à mão. */\nself.NJData = "
            + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
bank = json.load(open(os.path.join(src, "core/puzzles.json"), encoding="utf-8"))
for i, p in enumerate(bank): p["id"] = i
with open(os.path.join(out, "data_puzzles.js"), "w", encoding="utf-8") as f:
    f.write("/* GERADO por tools/gerar_dados.py a partir de core/puzzles.json. */\nself.NJPuzzles = "
            + json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(len(data["CATALOG"]), "itens;", len(bank), "puzzles")

# ---- clubes e estados (Fase 7)
sys.path.insert(0, src)
import importlib.util
spec = importlib.util.spec_from_file_location("clubs", os.path.join(src, "core/clubs.py"))
cl = importlib.util.module_from_spec(spec); spec.loader.exec_module(cl)
clubs = {"UFS": {k: [v[0], v[1], v[2]] for k, v in cl.UFS.items()}, "PATTERNS": cl.PATTERNS, "GLYPHS": cl.GLYPHS,
         "PALETTES": [list(p) for p in cl.PALETTES], "CREST_STYLES": cl.CREST_STYLES}
with open(os.path.join(out, "data_clubs.js"), "w", encoding="utf-8") as f:
    f.write("/* GERADO por tools/gerar_dados.py a partir de core/clubs.py. */\nself.NJClubs = "
            + json.dumps(clubs, ensure_ascii=False, indent=1) + ";\n")
print(len(clubs["UFS"]), "estados")
