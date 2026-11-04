import chess, json, random, sys
random.seed(7)
out = []
def snap(b):
    legal = list(b.legal_moves)
    oc = b.outcome(claim_draw=False); oc2 = b.outcome(claim_draw=True)
    return {
        "fen": b.fen(), "legal": sorted(m.uci() for m in legal),
        "san": {m.uci(): b.san(m) for m in legal},
        "check": b.is_check(), "insuf": b.is_insufficient_material(),
        "oc": [oc.termination.name, oc.winner] if oc else None,
        "oc2": [oc2.termination.name, oc2.winner] if oc2 else None,
        "ins_w": b.has_insufficient_material(chess.WHITE), "ins_b": b.has_insufficient_material(chess.BLACK),
    }
games = []
for g in range(int(sys.argv[1])):
    b = chess.Board()
    seq = []; snaps = [snap(b)]
    while not b.is_game_over(claim_draw=False) and len(seq) < 300:
        legal = list(b.legal_moves)
        # favorece capturas/promoções para chegar a finais e casos raros
        w = [3 if (b.is_capture(m) or m.promotion) else 1 for m in legal]
        m = random.choices(legal, w)[0]
        seq.append(m.uci()); b.push(m); snaps.append(snap(b))
    games.append({"moves": seq, "snaps": snaps})
# posições especiais
specials = ["8/8/8/8/8/8/8/K1k5 w - - 0 1", "8/8/8/8/8/8/8/KNk5 w - - 0 1", "8/8/8/8/8/8/8/KBk5 w - - 0 1",
 "8/8/8/8/8/8/8/KNNk4 w - - 0 1", "8/8/4b3/8/8/3B4/8/K1k5 w - - 0 1", "8/8/4b3/8/8/4B3/8/K1k5 w - - 0 1",
 "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "4k3/8/8/8/8/8/p7/4K3 b - - 0 1",
 "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
 "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", "k7/8/1K6/8/8/8/8/7R w - - 99 80", "k7/8/1K6/8/8/8/8/7R w - - 150 80"]
sp = []
for f in specials:
    b = chess.Board(f); sp.append({"start": f, "snap": snap(b)})
json.dump({"games": games, "specials": sp}, open("ref.json", "w"))
print(len(games), sum(len(g["snaps"]) for g in games), "posições")
