/* Nex-J Chess (celular) — banco de dados local (IndexedDB).
 *
 * As tabelas ficam na memória (rápido) e cada linha alterada é gravada no IndexedDB logo depois.
 * Tabelas: as mesmas do jogo do PC (players, games, rating_history, player_titles, coin_transactions,
 * player_items, daily_sets, puzzle_attempts, tournaments, championships) + "meta" (sessão, contadores).
 * Se o IndexedDB não existir (modo privado, testes), o jogo funciona, só não guarda.
 */
(function (root) {
  "use strict";
  const TABLES = ["players", "games", "rating_history", "player_titles", "coin_transactions", "player_items",
    "daily_sets", "puzzle_attempts", "tournaments", "championships", "backups"];
  const DB_NAME = "nexj_chess", DB_VERSION = 1;

  const data = {};            // tabela -> Map(id -> linha com Proxy)
  const nextId = {};
  const dirty = new Map();    // "tabela:id" -> [tabela, linha]
  const removed = new Map();  // "tabela:id" -> [tabela, id]
  let meta = {};
  let idb = null, timer = null, persistent = false, flushing = Promise.resolve();

  function wrap(table, row) {
    return new Proxy(row, {
      set(t, k, v) { t[k] = v; dirty.set(table + ":" + t.id, [table, t]); schedule(); return true; },
      deleteProperty(t, k) { delete t[k]; dirty.set(table + ":" + t.id, [table, t]); schedule(); return true; },
    });
  }
  for (const t of TABLES) { data[t] = new Map(); nextId[t] = 1; }

  function schedule() { if (persistent && !timer) timer = setTimeout(flush, 250); }

  function flush() {
    timer = null;
    if (!idb) return flushing;
    const writes = [...dirty.values()], dels = [...removed.values()];
    dirty.clear(); removed.clear();
    const metaCopy = JSON.stringify(meta);
    flushing = flushing.then(() => new Promise(resolve => {
      try {
        const names = [...new Set(writes.map(w => w[0]).concat(dels.map(d => d[0])))].concat("meta");
        const tx = idb.transaction(names, "readwrite");
        for (const [t, row] of writes) tx.objectStore(t).put(JSON.parse(JSON.stringify(row)));
        for (const [t, id] of dels) tx.objectStore(t).delete(id);
        tx.objectStore("meta").put({ k: "meta", v: JSON.parse(metaCopy) });
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => resolve();
      } catch (e) { console.warn("[store] falha ao gravar", e); resolve(); }
    }));
    return flushing;
  }

  const Store = {
    TABLES,
    get persistent() { return persistent; },

    async open() {
      if (typeof indexedDB === "undefined") return false;
      try {
        idb = await new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: "id" });
            if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error("banco bloqueado"));
        });
        await new Promise((resolve, reject) => {
          const tx = idb.transaction([...TABLES, "meta"], "readonly");
          for (const t of TABLES) {
            tx.objectStore(t).getAll().onsuccess = e => {
              for (const row of e.target.result) {
                data[t].set(row.id, wrap(t, row));
                nextId[t] = Math.max(nextId[t], row.id + 1);
              }
            };
          }
          tx.objectStore("meta").get("meta").onsuccess = e => { if (e.target.result) meta = e.target.result.v || {}; };
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
        persistent = true;
        const bye = () => { if (timer) { clearTimeout(timer); flush(); } };
        root.addEventListener("pagehide", bye);
        if (root.document) root.document.addEventListener("visibilitychange", () => { if (root.document.visibilityState === "hidden") bye(); });
        return true;
      } catch (e) {
        console.warn("[store] sem IndexedDB, rodando só na memória:", e);
        idb = null; persistent = false;
        return false;
      }
    },

    insert(table, row) {
      row = Object.assign({}, row);
      if (!row.id) row.id = nextId[table]++;
      else nextId[table] = Math.max(nextId[table], row.id + 1);
      const w = wrap(table, row);
      data[table].set(row.id, w);
      dirty.set(table + ":" + row.id, [table, row]); removed.delete(table + ":" + row.id); schedule();
      return w;
    },
    get(table, id) { return data[table].get(+id) || null; },
    all(table) { return [...data[table].values()]; },
    where(table, fn) { const out = []; for (const r of data[table].values()) if (fn(r)) out.push(r); return out; },
    first(table, fn) { for (const r of data[table].values()) if (fn(r)) return r; return null; },
    count(table, fn) { if (!fn) return data[table].size; let n = 0; for (const r of data[table].values()) if (fn(r)) n++; return n; },
    remove(table, id) { data[table].delete(+id); removed.set(table + ":" + id, [table, +id]); dirty.delete(table + ":" + id); schedule(); },

    /** Informações soltas (sessão, configurações): meta.uid, meta.settings... */
    get meta() { return new Proxy(meta, { set(t, k, v) { t[k] = v; schedule(); return true; }, deleteProperty(t, k) { delete t[k]; schedule(); return true; } }); },
    flush,

    /** Tudo em um objeto (backup). Não inclui a tabela de backups internos. */
    exportAll() {
      const out = { app: "nexj-chess-mobile", format: 1, exported_at: new Date().toISOString(), tables: {}, meta: {} };
      for (const t of TABLES) if (t !== "backups") out.tables[t] = this.all(t).map(r => JSON.parse(JSON.stringify(r)));
      out.meta = { counters: {} };   // a sessão não vai no backup
      return out;
    },
    /** Troca TODO o conteúdo pelo de um backup. Lança erro amigável se o arquivo não servir. */
    importAll(obj) {
      if (!obj || obj.app !== "nexj-chess-mobile" || !obj.tables || !Array.isArray(obj.tables.players)) {
        throw new Error("Este arquivo não é um backup do Nex-J Chess do celular.");
      }
      for (const t of TABLES) {
        if (t === "backups") continue;
        for (const id of [...data[t].keys()]) { removed.set(t + ":" + id, [t, id]); }
        data[t].clear(); nextId[t] = 1;
        for (const row of obj.tables[t] || []) {
          data[t].set(row.id, wrap(t, row));
          nextId[t] = Math.max(nextId[t], row.id + 1);
          dirty.set(t + ":" + row.id, [t, row]);
          removed.delete(t + ":" + row.id);
        }
      }
      for (const k of Object.keys(meta)) delete meta[k];
      schedule();
    },
  };
  root.NJStore = Store;
})(typeof self !== "undefined" ? self : this);
