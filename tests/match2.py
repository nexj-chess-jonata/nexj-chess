"""Partidas do bot JS (rating R) contra: 'sf:E' (Stockfish UCI_Elo=E) ou 'py:R2' (bot do PC com rating R2)."""
import chess, chess.engine, random, sys, json, os, types, concurrent.futures as cf
sys.path.insert(0, "/home/claude/nexus_chess")
HERE = os.path.dirname(os.path.abspath(__file__))
NODE = ["node", os.path.join(HERE, "uci_bot.js")]
OPEN = ["e2e4 e7e5 g1f3 b8c6", "d2d4 d7d5 c2c4 e7e6", "e2e4 c7c5 g1f3 d7d6", "g1f3 g8f6 c2c4 e7e6", "e2e4 e7e6 d2d4 d7d5",
        "d2d4 g8f6 c2c4 g7g6", "e2e4 c7c6 d2d4 d7d5", "c2c4 e7e5 b1c3 g8f6", "e2e4 d7d5 e4d5 d8d5", "d2d4 d7d5 g1f3 g8f6"]

def play(js_rating, opp, gid, tuning):
    from core.engine import EngineManager
    random.seed(gid * 104729 + js_rating)
    me_white = gid % 2 == 0
    board = chess.Board()
    for u in random.choice(OPEN).split(): board.push_uci(u)
    env = dict(os.environ)
    if tuning: env["NEX_TUNING"] = json.dumps(tuning)
    me = chess.engine.SimpleEngine.popen_uci(NODE, env=env)
    kind, val = opp.split(":"); val = int(val)
    mgr = EngineManager("/opt/sf17/stockfish")
    sf = None
    if kind == "sf":
        sf = chess.engine.SimpleEngine.popen_uci("/opt/sf17/stockfish")
        sf.configure({"UCI_LimitStrength": True, "UCI_Elo": val, "Threads": 1, "Hash": 16})
    try:
        me.configure({"Rating": js_rating})
        bot = types.SimpleNamespace(rating=val, personality="solido")
        while not board.is_game_over(claim_draw=True) and len(board.move_stack) < 260:
            mine = (board.turn == chess.WHITE) == me_white
            if mine: m = me.play(board, chess.engine.Limit(time=30)).move
            elif sf: m = sf.play(board, chess.engine.Limit(time=0.05)).move
            else: m = mgr.choose_move(board, bot)
            board.push(m)
        res = board.result(claim_draw=True)
        if res == "*": return 0.5
        s = {"1-0": 1, "0-1": 0, "1/2-1/2": 0.5}[res]
        return s if me_white else 1 - s
    finally:
        me.quit(); mgr.close()
        if sf: sf.quit()

if __name__ == "__main__":
    js_rating = int(sys.argv[1]); opp = sys.argv[2]; games = int(sys.argv[3]); workers = int(sys.argv[4])
    tuning = json.loads(sys.argv[5]) if len(sys.argv) > 5 else None
    with cf.ThreadPoolExecutor(workers) as ex:
        sc = list(ex.map(lambda g: play(js_rating, opp, g, tuning), range(games)))
    print(json.dumps({"js": js_rating, "opp": opp, "score": round(sum(sc) / len(sc), 3), "games": games}), flush=True)
