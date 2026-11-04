import chess, chess.engine, random, sys, json, os, concurrent.futures as cf
SF = "/opt/sf17/stockfish"
NODE = ["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "uci_node.js")]
OPEN = ["e2e4 e7e5 g1f3 b8c6", "d2d4 d7d5 c2c4 e7e6", "e2e4 c7c5 g1f3 d7d6", "g1f3 g8f6 c2c4 e7e6", "e2e4 e7e6 d2d4 d7d5",
        "d2d4 g8f6 c2c4 g7g6", "e2e4 c7c6 d2d4 d7d5", "c2c4 e7e5 b1c3 g8f6", "e2e4 d7d5 e4d5 d8d5", "d2d4 d7d5 g1f3 g8f6"]

def play(cfg, elo, game_id, sf_ms, my_ms):
    random.seed(game_id * 7919 + elo)
    me_white = game_id % 2 == 0
    board = chess.Board()
    for u in random.choice(OPEN).split(): board.push_uci(u)
    sf = chess.engine.SimpleEngine.popen_uci(SF); me = chess.engine.SimpleEngine.popen_uci(NODE)
    try:
        sf.configure({"UCI_LimitStrength": True, "UCI_Elo": elo, "Threads": 1, "Hash": 16})
        me.configure({k: v for k, v in cfg.items()})
        while not board.is_game_over(claim_draw=True) and len(board.move_stack) < 240:
            mine = (board.turn == chess.WHITE) == me_white
            if mine: m = me.play(board, chess.engine.Limit(time=my_ms/1000)).move
            else: m = sf.play(board, chess.engine.Limit(time=sf_ms/1000)).move
            board.push(m)
        res = board.result(claim_draw=True)
        if res == "*": return 0.5
        s = {"1-0": 1, "0-1": 0, "1/2-1/2": 0.5}[res]
        return s if me_white else 1 - s
    finally:
        sf.quit(); me.quit()

def run(cfg, elo, games, workers, sf_ms=60, my_ms=200):
    with cf.ThreadPoolExecutor(workers) as ex:
        sc = list(ex.map(lambda g: play(cfg, elo, g, sf_ms, my_ms), range(games)))
    return sum(sc) / len(sc)

if __name__ == "__main__":
    cfg = json.loads(sys.argv[1]); elo = int(sys.argv[2]); games = int(sys.argv[3]); workers = int(sys.argv[4])
    sf_ms = int(sys.argv[5]) if len(sys.argv) > 5 else 60; my_ms = int(sys.argv[6]) if len(sys.argv) > 6 else 200
    s = run(cfg, elo, games, workers, sf_ms, my_ms)
    print(json.dumps({"cfg": cfg, "elo": elo, "score": round(s, 3), "games": games}))
