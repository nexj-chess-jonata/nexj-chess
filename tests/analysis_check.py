import json, subprocess, random, chess, chess.engine
ref = json.load(open("ref.json"))
random.seed(3)
fens = []
for g in ref["games"][:200]:
    snaps = g["snaps"]
    if len(snaps) > 30:
        i = random.randint(12, min(60, len(snaps) - 2))
        if not snaps[i]["oc"] and len(snaps[i]["legal"]) > 3: fens.append(snaps[i]["fen"])
fens = fens[:30]
js = r'''
const C=require("../www/js/engine/chess.js"),A=require("../www/js/engine/engine_api.js");
const m=new A.EngineManager({hashBits:20});
const fens=JSON.parse(process.argv[1]);
console.log(JSON.stringify(fens.map(f=>{const b=new C.Board(f);const t=Date.now();const r=m.analysePosition(b,14,1.0);return {...r,ms:Date.now()-t};})));
'''
out = subprocess.run(["node", "-e", js, json.dumps(fens)], capture_output=True, text=True, cwd=".").stdout
res = json.loads(out)
sf = chess.engine.SimpleEngine.popen_uci("/opt/sf17/stockfish")
agree = 0; diffs = []
for f, r in zip(fens, res):
    b = chess.Board(f)
    info = sf.analyse(b, chess.engine.Limit(depth=16))
    cp = info["score"].white().score(mate_score=10000)
    best = info["pv"][0].uci()
    agree += (best == r["best"])
    diffs.append(abs(max(-600, min(600, cp)) - max(-600, min(600, r["cp"]))))
sf.quit()
diffs.sort()
print(f"{len(fens)} posições | mesmo melhor lance: {agree}/{len(fens)} | diferença de avaliação (cp, mediana): {diffs[len(diffs)//2]:.0f}, 80%: {diffs[int(len(diffs)*.8)]:.0f} | tempo médio JS: {sum(r['ms'] for r in res)/len(res):.0f} ms")
