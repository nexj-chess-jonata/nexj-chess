/* Nex-J Chess — Fase 6: preferências, tema, sons e efeitos.
 *
 * NexPrefs ... preferências deste navegador (tema, sons, animações, tabuleiro...)
 * NexSound ... sons sintetizados na hora (Web Audio, sem arquivos) + voz do xeque
 * NexFx ...... confete e moedas voando
 */
(function () {
  const KEY = "nexj.";
  const DEFAULTS = {
    theme: "dark",       // dark | light | auto
    motion: "full",      // full | reduced
    coords: true,        // letras e números nas bordas do tabuleiro
    hints: true,         // pontinhos dos lances possíveis
    autoQueen: false,    // promoção vira dama direto
    premove: true,       // pré-movimento: marcar seu lance enquanto o adversário pensa
    sound: true,
    volume: 0.7,
    voice: true,         // voz "Xeque!"
    lowTime: true,       // aviso de tempo acabando
    coach: true,         // treinador nas partidas
  };
  const listeners = [];

  function get(k) {
    try {
      const v = localStorage.getItem(KEY + k);
      return v === null ? DEFAULTS[k] : JSON.parse(v);
    } catch (_) { return DEFAULTS[k]; }
  }
  function set(k, v) {
    try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (_) {}
    apply();
    listeners.forEach(fn => { try { fn(k, v); } catch (_) {} });
  }
  function all() { const o = {}; Object.keys(DEFAULTS).forEach(k => { o[k] = get(k); }); return o; }

  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const mqMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function effectiveTheme() {
    const t = get("theme");
    return t === "auto" ? (mq && mq.matches ? "light" : "dark") : t;
  }
  function apply() {
    const html = document.documentElement;
    html.dataset.theme = effectiveTheme();
    html.dataset.motion = get("motion") === "reduced" || (mqMotion && mqMotion.matches) ? "reduced" : "full";
    html.dataset.coords = get("coords") ? "on" : "off";
    html.dataset.hints = get("hints") ? "on" : "off";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = html.dataset.theme === "light" ? "#f4f1ea" : "#0b1220";
    if (window.NexusBoard) window.NexusBoard.autoQueen = !!get("autoQueen");
  }
  if (mq && mq.addEventListener) mq.addEventListener("change", apply);
  apply();

  window.NexPrefs = { get, set, all, apply, effectiveTheme, onChange: fn => listeners.push(fn), DEFAULTS };

  /* ------------------------------------------------------------------ sons */
  let ctx = null, master = null, noiseBuf = null;
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      // ruído branco para os "toques de madeira"
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    master.gain.value = Math.max(0, Math.min(1, get("volume"))) * 0.9;
    return ctx;
  }

  function tone(freq, at, dur, { type = "sine", gain = 0.25, attack = 0.005, glide = null } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(master);
    o.start(at); o.stop(at + dur + 0.05);
  }
  function bell(freq, at, dur = 0.6, gain = 0.18) {
    tone(freq, at, dur, { gain, attack: 0.004 });
    tone(freq * 2.01, at, dur * 0.6, { gain: gain * 0.35, attack: 0.004 });
    tone(freq * 3.02, at, dur * 0.3, { gain: gain * 0.12, attack: 0.004 });
  }
  function knock(at, { freq = 1900, q = 1.6, gain = 0.55, thump = 170, dur = 0.07 } = {}) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noiseBuf;
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    n.connect(f).connect(g).connect(master);
    n.start(at); n.stop(at + dur + 0.02);
    tone(thump, at, dur * 1.4, { gain: gain * 0.45, attack: 0.002, glide: thump * 0.6 });
  }

  const SOUNDS = {
    move: t => knock(t),
    capture: t => { knock(t, { freq: 1500, gain: 0.75, thump: 130, dur: 0.09 }); knock(t + 0.045, { freq: 2600, gain: 0.3, thump: 220, dur: 0.05 }); },
    castle: t => { knock(t); knock(t + 0.11, { freq: 1700 }); },
    check: t => { bell(988, t, 0.35, 0.16); bell(1319, t + 0.11, 0.45, 0.16); },
    start: t => { bell(523, t, 0.5, 0.14); bell(784, t + 0.12, 0.7, 0.14); },
    win: t => { [523, 659, 784, 1047].forEach((f, i) => bell(f, t + i * 0.11, 0.8, 0.15)); },
    loss: t => { [392, 311, 262].forEach((f, i) => tone(f, t + i * 0.16, 0.6, { type: "triangle", gain: 0.14, attack: 0.02 })); },
    draw: t => { bell(523, t, 0.5, 0.12); bell(523, t + 0.18, 0.6, 0.1); },
    tick: t => tone(1800, t, 0.05, { type: "square", gain: 0.06, attack: 0.001 }),
    correct: t => { bell(784, t, 0.3, 0.13); bell(1175, t + 0.08, 0.45, 0.13); },
    wrong: t => { tone(196, t, 0.22, { type: "square", gain: 0.07, attack: 0.005 }); tone(185, t + 0.02, 0.22, { type: "square", gain: 0.05 }); },
    solved: t => { [659, 784, 988, 1319].forEach((f, i) => bell(f, t + i * 0.08, 0.7, 0.13)); },
    coin: t => { bell(1319, t, 0.25, 0.12); bell(1976, t + 0.07, 0.5, 0.12); },
    buy: t => { [1047, 1319, 1568, 2093].forEach((f, i) => bell(f, t + i * 0.05, 0.4, 0.1)); },
    click: t => tone(1200, t, 0.03, { type: "triangle", gain: 0.05, attack: 0.001 }),
  };

  function play(kind) {
    if (!get("sound")) return;
    try {
      if (!ac()) return;
      (SOUNDS[kind] || SOUNDS.move)(ctx.currentTime + 0.01);
    } catch (_) { /* sem áudio, sem problema */ }
  }

  // voz em português (no Windows usa a voz "Maria", sem internet)
  let ptVoice = null;
  function pickVoice() {
    try {
      const voices = speechSynthesis.getVoices();
      ptVoice = voices.find(v => /pt-BR/i.test(v.lang)) || voices.find(v => /^pt/i.test(v.lang)) || null;
    } catch (_) { ptVoice = null; }
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!get("voice") || !get("sound") || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      if (ptVoice) u.voice = ptVoice;
      u.rate = 1.05; u.volume = Math.max(0.2, get("volume"));
      speechSynthesis.speak(u);
    } catch (_) {}
  }

  window.NexSound = { play, speak, kinds: Object.keys(SOUNDS) };

  /* ------------------------------------------------------------------ efeitos */
  function reduced() { return document.documentElement.dataset.motion === "reduced"; }

  function confetti(amount = 140) {
    if (reduced()) return;
    const c = document.createElement("canvas");
    c.className = "fx-confetti";
    document.body.appendChild(c);
    const W = c.width = window.innerWidth, H = c.height = window.innerHeight;
    const g = c.getContext("2d");
    const colors = ["#f0c96a", "#d4a843", "#3ccf8e", "#5c8bb0", "#ef5b5b", "#ffffff", "#b388ff"];
    const parts = Array.from({ length: amount }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: colors[(Math.random() * colors.length) | 0],
    }));
    let frame = 0;
    (function tick() {
      g.clearRect(0, 0, W, H);
      parts.forEach(p => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c;
        g.globalAlpha = Math.max(0, 1 - frame / 160);
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        g.restore();
      });
      if (++frame < 170) requestAnimationFrame(tick); else c.remove();
    })();
  }

  function coinFloat(target, amount) {
    if (!target) return;
    target.classList.remove("bump"); void target.offsetWidth; target.classList.add("bump");
    if (reduced() || !amount) return;
    const r = target.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "fx-coin";
    el.textContent = `+${amount} 🪙`;
    el.style.left = r.left + r.width / 2 + "px";
    el.style.top = r.bottom + 4 + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // ---- Fase 7: efeitos comprados na loja (explosão de captura e comemoração) ----
  const cfg = { burst: "none", victory: "classic" };
  const EMOJI = { stars: ["⭐", "✨", "🌟"], hearts: ["💖", "💗", "💕"], coins: ["🪙"], fire: ["🔥", "🧨"] };

  function burst(sqEl, kind = cfg.burst) {
    if (!sqEl || !kind || kind === "none" || reduced() || !sqEl.animate) return;
    const r = sqEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const count = kind === "smoke" ? 6 : kind === "sparks" ? 16 : 9;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "fx-p";
      const ang = Math.random() * Math.PI * 2, dist = r.width * (0.7 + Math.random() * 1.1);
      let dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist, dur = 650 + Math.random() * 350, rot = (Math.random() - 0.5) * 300;
      if (EMOJI[kind]) { el.textContent = EMOJI[kind][i % EMOJI[kind].length]; el.style.fontSize = r.width * 0.42 + "px"; }
      else if (kind === "sparks") { el.style.cssText += `width:5px;height:5px;border-radius:50%;background:${["#ffd24a", "#ff8a3d", "#fff3b0"][i % 3]};box-shadow:0 0 6px #ffb347`; }
      else if (kind === "smoke") { const s = r.width * 0.7; el.style.cssText += `width:${s}px;height:${s}px;border-radius:50%;background:rgba(150,150,160,.55);filter:blur(5px)`; dy -= r.width * 0.8; dur = 900; }
      if (kind === "coins") dy += r.width * 1.2;     // moedas caem
      el.style.left = cx + "px"; el.style.top = cy + "px";
      document.body.appendChild(el);
      el.animate([
        { transform: "translate(-50%,-50%) scale(.4) rotate(0)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${kind === "smoke" ? 1.8 : 1}) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: dur, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => el.remove();
    }
  }

  function emojiRain(list, count) {
    const box = document.createElement("div");
    box.className = "fx-rain";
    document.body.appendChild(box);
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.textContent = list[i % list.length];
      s.style.left = Math.random() * 100 + "%";
      s.style.fontSize = 18 + Math.random() * 22 + "px";
      s.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      s.style.animationDelay = Math.random() * 1.2 + "s";
      box.appendChild(s);
    }
    setTimeout(() => box.remove(), 5600);
  }

  function fireworks() {
    const c = document.createElement("canvas");
    c.className = "fx-confetti";
    document.body.appendChild(c);
    const W = c.width = window.innerWidth, H = c.height = window.innerHeight, g = c.getContext("2d");
    const parts = [];
    const colors = ["#ffd24a", "#ff5a7a", "#5ad1ff", "#7dff9a", "#c58bff", "#ffffff"];
    const boom = () => {
      const x = W * (0.15 + Math.random() * 0.7), y = H * (0.15 + Math.random() * 0.4), col = colors[(Math.random() * colors.length) | 0];
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5;
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, col });
      }
    };
    let frame = 0;
    (function tick() {
      g.clearRect(0, 0, W, H);
      if (frame % 28 === 0 && frame < 150) boom();
      parts.forEach(p => {
        p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.011;
        g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.col;
        g.beginPath(); g.arc(p.x, p.y, 2.4, 0, 7); g.fill();
      });
      if (++frame < 260) requestAnimationFrame(tick); else c.remove();
    })();
  }

  // comemoração da vitória: usa o efeito que o jogador comprou
  function victory(amount = 140, kind = cfg.victory) {
    if (reduced()) return;
    if (EMOJI[kind]) { emojiRain(EMOJI[kind], Math.round(amount / 5)); confetti(Math.round(amount / 3)); }
    else if (kind === "fireworks") { fireworks(); confetti(Math.round(amount / 3)); }
    else confetti(amount);
  }

  window.NexFx = { confetti, coinFloat, burst, victory, cfg };
})();
