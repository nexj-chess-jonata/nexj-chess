/* Nex-J Chess (celular) — utilidades: números aleatórios (como o `random` do Python), datas e senhas. */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- aleatório
  function hashStr(s) {                       // string -> semente de 32 bits
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function Rng(seed) {                        // mulberry32; sem semente usa Math.random
    let next;
    if (seed === undefined) next = Math.random;
    else {
      let a = hashStr(String(seed))();
      next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const r = {
      random: next,
      randint: (a, b) => a + Math.floor(next() * (b - a + 1)),     // inclusivo, como no Python
      choice: arr => arr[Math.floor(next() * arr.length)],
      uniform: (a, b) => a + next() * (b - a),
      gauss(mu, sigma) { let u1 = 0; while (u1 === 0) u1 = next(); const u2 = next(); return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); },
      sample(arr, k) { const c = arr.slice(); const out = []; for (let i = 0; i < k && c.length; i++) out.push(c.splice(Math.floor(next() * c.length), 1)[0]); return out; },
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
    };
    return r;
  }
  const rnd = Rng();

  // ---------------------------------------------------------------- datas
  const pad = n => String(n).padStart(2, "0");
  const nowIso = () => new Date().toISOString();
  const nowSec = () => Date.now() / 1000;
  function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }   // dia local
  function daysBetween(a, b) {                // a, b = "AAAA-MM-DD" -> dias entre (b - a)
    const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  /** Datas ficam em UTC (ISO); mostra no horário do aparelho. fmt: "d" = dd/mm/aaaa, "dm" = dd/mm hh:mm, "full" = dd/mm/aaaa hh:mm */
  function local(iso, fmt = "d") {
    if (!iso) return null;
    const d = new Date(iso);
    const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    if (fmt === "dm") return `${dm} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (fmt === "full") return `${dm}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${dm}/${d.getFullYear()}`;
  }

  // ---------------------------------------------------------------- senhas (PBKDF2-SHA256)
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {                    // Uint8Array -> Uint8Array(32)
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 0x20000000));
    const w = new Uint32Array(64);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
    return out;
  }
  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64); k.set(key);
    const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    ip.set(msg, 64); op.set(sha256(ip), 64);
    return sha256(op);
  }
  function pbkdf2Js(pw, salt, iter) {
    const s1 = new Uint8Array(salt.length + 4); s1.set(salt); s1[salt.length + 3] = 1;
    let u = hmac(pw, s1); const t = u.slice();
    for (let i = 1; i < iter; i++) { u = hmac(pw, u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
    return t;
  }
  const enc = s => new TextEncoder().encode(s);
  const toHex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
  const ITER = 15000;
  async function pbkdf2(pw, salt, iter) {
    if (root.crypto && root.crypto.subtle) {
      try {
        const key = await root.crypto.subtle.importKey("raw", enc(pw), "PBKDF2", false, ["deriveBits"]);
        return new Uint8Array(await root.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
      } catch (_) { /* cai no cálculo em JS */ }
    }
    return pbkdf2Js(enc(pw), salt, iter);
  }
  /** Senha -> "pbkdf2$iter$salt$hash" (igual em qualquer aparelho). */
  async function hashPassword(pw) {
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${ITER}$${toHex(salt)}$${toHex(await pbkdf2(pw, salt, ITER))}`;
  }
  async function checkPassword(stored, pw) {
    const p = String(stored || "").split("$");
    if (p[0] !== "pbkdf2" || p.length !== 4) return false;
    const got = toHex(await pbkdf2(pw, fromHex(p[2]), +p[1]));
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ p[3].charCodeAt(i);
    return diff === 0 && got.length === p[3].length;
  }
  const uuid = () => toHex(root.crypto.getRandomValues(new Uint8Array(6)));

  root.NJUtil = { Rng, rnd, nowIso, nowSec, todayStr, daysBetween, local, hashPassword, checkPassword, uuid, sha256, pbkdf2Js, toHex };
})(typeof self !== "undefined" ? self : this);
