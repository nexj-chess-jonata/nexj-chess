/* NexFace — rostos ilustrados dos bots, gerados em SVG (sem internet, sem imagens).
 *
 * - O mesmo bot sempre tem o mesmo rosto (a "semente" é o id do bot).
 * - Gênero vem do bot (ou é deduzido pelo nome), personalidade influencia o estilo:
 *     agressivo → sobrancelhas franzidas · sólido/posicional → óculos e barba mais comuns
 *     tático → olhar concentrado · criativo → cabelo colorido, gorro, sardas
 * - Expressões: neutral, happy, sad, thinking, surprised, smug
 */
(function () {
  const SKIN = ["#f9d7b9", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a21"];
  const HAIR = ["#1b1b1b", "#2e1d12", "#5a3b22", "#8a5a2b", "#c9a063", "#e3c27a", "#9e9e9e", "#6d2e1e"];
  const DYED = ["#7c4dff", "#ff4f8b", "#1ec7c7", "#3fbf5f", "#ff8a1e"];
  const SHIRT = ["#2d5bd7", "#c0392b", "#16a085", "#8e44ad", "#d68910", "#34495e", "#e84393", "#27ae60"];
  const FEMALE_NAMES = new Set(["Mariana", "Beatriz", "Camila", "Júlia", "Larissa", "Fernanda", "Aline", "Letícia", "Renata",
    "Inês", "Mafalda", "Carolina", "Sofía", "Valentina", "Lucía", "Paula", "Marta", "Elena", "Emily", "Olivia", "Hannah",
    "Anastasia", "Ekaterina", "Olga", "Priya", "Ananya", "Kavya", "Ingrid", "Sigrid", "Camille", "Léa", "Lena", "Li Na", "Mei"]);

  // PRNG determinístico a partir de um texto
  function rng(seedText) {
    let h = 2166136261;
    for (const c of String(seedText)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  function genderOf(bot) {
    if (bot.gender) return bot.gender;
    const first = (bot.name || "").split(" ")[0];
    if (FEMALE_NAMES.has(first) || bot.name?.startsWith("Li Na")) return "f";
    return "m";
  }

  // traços fixos do bot (calculados uma vez)
  const cache = new Map();
  // rosto do JOGADOR: traços escolhidos no editor "Meu avatar" (Fase 5)
  function fromCustom(c) {
    const n = v => (v === "none" || v === false ? null : v);
    const femaleHair = ["long", "bun", "ponytail", "bob"].includes(c.hair);
    return {
      g: femaleHair || c.earrings ? "f" : "m", p: "custom", custom: true,
      skin: c.skin, hairColor: c.hairColor, face: c.face, hair: c.hair, eyeShape: c.eyeShape,
      beard: n(c.beard), glasses: n(c.glasses), hat: n(c.hat),
      shirt: c.shirt === "gold" ? "#d4a843" : c.shirt, goldShirt: c.shirt === "gold",
      bg: c.bg, freckles: !!c.freckles, earrings: !!c.earrings,
    };
  }

  function traits(bot) {
    if (bot.traits) return fromCustom(bot.traits);
    const key = bot.id + "|" + bot.name;
    if (cache.has(key)) return cache.get(key);
    const r = rng(key);
    const g = genderOf(bot), p = bot.personality || "solido";
    const t = {
      g, p,
      skin: pick(r, SKIN),
      hairColor: p === "criativo" && r() < 0.5 ? pick(r, DYED) : (r() < 0.12 ? "#9e9e9e" : pick(r, HAIR)),
      shirt: pick(r, SHIRT),
      face: pick(r, ["round", "oval", "square"]),
      hair: g === "f" ? pick(r, ["long", "long", "bun", "ponytail", "bob", "curly", "afro"])
        : pick(r, ["short", "short", "side", "buzz", "curly", "bald", "mohawk", "afro"]),
      glasses: r() < ({ solido: .45, posicional: .4, tatico: .3, agressivo: .1, criativo: .25 }[p] || .25) ? pick(r, ["round", "square"]) : null,
      beard: g === "m" && r() < ({ posicional: .5, solido: .35, agressivo: .35, tatico: .25, criativo: .3 }[p] || .3)
        ? pick(r, ["full", "goatee", "stubble", "mustache"]) : null,
      hat: p === "criativo" && r() < 0.4 ? pick(r, ["beanie", "cap"]) : (p === "agressivo" && r() < 0.15 ? "band" : null),
      freckles: r() < (p === "criativo" ? 0.5 : 0.15),
      earrings: g === "f" && r() < 0.5,
      eyeShape: p === "tatico" ? "focus" : pick(r, ["dot", "round", "round"]),
    };
    if (p === "professor") Object.assign(t, { glasses: "round", hairColor: "#8d8d8d", hair: "side", beard: "full", hat: null, shirt: "#2e7d5b" });
    cache.set(key, t);
    return t;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, v + amt));
    return "#" + ((c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, "0");
  }

  function headPath(face) {
    if (face === "square") return `<rect x="26" y="24" width="48" height="54" rx="18"/>`;
    if (face === "oval") return `<ellipse cx="50" cy="51" rx="23" ry="28.5"/>`;
    return `<ellipse cx="50" cy="51" rx="25" ry="27"/>`;
  }

  function hairBack(t) {
    const c = t.hairColor;
    switch (t.hair) {
      case "long": return `<path d="M22 44 Q22 20 50 18 Q78 20 78 44 L80 86 Q66 92 50 90 Q34 92 20 86 Z" fill="${c}"/>`;
      case "afro": return `<circle cx="50" cy="40" r="33" fill="${c}"/>`;
      case "ponytail": return `<path d="M70 36 Q88 44 82 70 Q78 60 72 52 Z" fill="${c}"/>`;
      case "bob": return `<path d="M23 46 Q22 20 50 19 Q78 20 77 46 L77 68 Q70 70 66 64 L34 64 Q30 70 23 68 Z" fill="${c}"/>`;
      case "curly": return t.g === "f" ? `<g fill="${c}">${[[26, 50], [24, 62], [76, 50], [78, 62], [30, 72], [70, 72]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join("")}</g>` : "";
      default: return "";
    }
  }

  function hairFront(t) {
    const c = t.hairColor, d = shade(c, -25);
    switch (t.hair) {
      case "short": return `<path d="M25 44 Q24 22 50 21 Q76 22 75 44 Q70 32 58 31 Q46 36 36 31 Q28 34 25 44 Z" fill="${c}"/>`;
      case "side": return `<path d="M25 46 Q23 20 52 20 Q77 22 76 44 Q72 30 60 29 Q42 30 32 38 Q28 40 25 46 Z" fill="${c}"/><path d="M52 21 Q44 26 40 33" stroke="${d}" stroke-width="1.5" fill="none"/>`;
      case "buzz": return `<path d="M26 42 Q26 23 50 22 Q74 23 74 42 Q68 30 50 29 Q32 30 26 42 Z" fill="${c}" opacity=".85"/>`;
      case "mohawk": return `<path d="M44 30 Q46 8 50 6 Q54 8 56 30 Z" fill="${c}"/><path d="M28 42 Q30 30 44 28 L44 31 Q34 33 28 42Z M72 42 Q70 30 56 28 L56 31 Q66 33 72 42Z" fill="${c}" opacity=".35"/>`;
      case "curly": return `<g fill="${c}">${[[30, 34], [38, 27], [48, 24], [58, 25], [67, 30], [72, 38], [27, 42]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5"/>`).join("")}</g>`;
      case "afro": return `<path d="M24 44 Q26 24 50 24 Q74 24 76 44 Q66 34 50 34 Q34 34 24 44Z" fill="${c}"/>`;
      case "long": case "bob": return `<path d="M24 48 Q22 21 50 20 Q78 21 76 48 Q70 30 54 30 Q48 38 30 36 Q26 40 24 48 Z" fill="${c}"/>`;
      case "bun": return `<circle cx="50" cy="15" r="9" fill="${c}"/><path d="M25 44 Q24 21 50 20 Q76 21 75 44 Q70 29 50 28 Q30 29 25 44 Z" fill="${c}"/>`;
      case "ponytail": return `<path d="M25 44 Q24 21 50 20 Q76 21 75 44 Q70 29 50 28 Q30 29 25 44 Z" fill="${c}"/><circle cx="72" cy="36" r="3" fill="${d}"/>`;
      case "bald": return `<ellipse cx="40" cy="30" rx="6" ry="3" fill="#fff" opacity=".22"/>`;
      default: return "";
    }
  }

  function hat(t) {
    if (t.hat === "crown") return `<path d="M27 30 L31 12 L40 24 L50 8 L60 24 L69 12 L73 30 Z" fill="#f2c230" stroke="#b8860b" stroke-width="1.4"/><rect x="26" y="28" width="48" height="6" rx="2" fill="#e0a800"/><circle cx="50" cy="19" r="2.6" fill="#e53935"/><circle cx="37" cy="24" r="1.8" fill="#1e88e5"/><circle cx="63" cy="24" r="1.8" fill="#43a047"/>`;
    if (t.hat === "tophat") return `<rect x="33" y="4" width="34" height="26" rx="3" fill="#1b1b1b"/><rect x="33" y="22" width="34" height="5" fill="#b71c1c"/><rect x="22" y="28" width="56" height="6" rx="3" fill="#111"/>`;
    if (t.hat === "wizard") return `<path d="M24 36 Q50 30 76 36 L54 -2 Q52 -4 50 0 Z" fill="#3949ab"/><path d="M20 36 Q50 28 80 36 Q80 41 50 40 Q20 41 20 36 Z" fill="#283593"/><text x="45" y="26" font-size="9" fill="#ffd54f">★</text><text x="55" y="15" font-size="6" fill="#ffd54f">✦</text>`;
    if (t.hat === "headphones") return `<path d="M24 50 Q24 18 50 17 Q76 18 76 50" stroke="#263238" stroke-width="5" fill="none"/><rect x="17" y="44" width="11" height="17" rx="5" fill="#e53935"/><rect x="72" y="44" width="11" height="17" rx="5" fill="#e53935"/>`;
    if (t.hat === "beanie") return `<path d="M24 40 Q24 14 50 13 Q76 14 76 40 Z" fill="${shade(t.shirt, 30)}"/><rect x="22" y="36" width="56" height="8" rx="4" fill="${shade(t.shirt, -10)}"/><circle cx="50" cy="11" r="5" fill="#fff"/>`;
    if (t.hat === "cap") return `<path d="M25 38 Q25 16 50 15 Q75 16 75 38 Z" fill="${t.shirt}"/><path d="M50 36 L86 38 Q84 43 50 42 Z" fill="${shade(t.shirt, -30)}"/>`;
    if (t.hat === "band") return `<rect x="24" y="31" width="52" height="6" rx="3" fill="#e53935"/><path d="M76 33 L86 28 L84 38 Z" fill="#e53935"/>`;
    return "";
  }

  function eyes(t, expr) {
    const lookX = expr === "thinking" ? 2 : 0, lookY = expr === "thinking" ? -2 : 0;
    const L = 40, R = 60, Y = 50;
    if (expr === "happy") {
      return `<path d="M${L - 4} ${Y + 1} Q${L} ${Y - 4} ${L + 4} ${Y + 1}" stroke="#222" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
        `<path d="M${R - 4} ${Y + 1} Q${R} ${Y - 4} ${R + 4} ${Y + 1}" stroke="#222" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    }
    const ry = expr === "surprised" ? 4.6 : t.eyeShape === "focus" || expr === "smug" ? 2.4 : 3.6;
    const one = (x) => t.eyeShape === "dot" && expr !== "surprised"
      ? `<circle cx="${x + lookX}" cy="${Y + lookY}" r="2.6" fill="#222"/>`
      : `<ellipse cx="${x}" cy="${Y}" rx="4.4" ry="${ry}" fill="#fff"/><circle cx="${x + lookX}" cy="${Y + lookY}" r="2.3" fill="#222"/><circle cx="${x + lookX + .8}" cy="${Y + lookY - .8}" r=".7" fill="#fff"/>`;
    return one(L) + one(R);
  }

  function brows(t, expr) {
    const c = t.hair === "bald" || t.hair === "buzz" ? shade(t.skin, -70) : shade(t.hairColor, -10);
    let l, r;
    const angry = t.p === "agressivo" && (expr === "neutral" || expr === "smug");
    if (expr === "sad") { l = "M35 42 L44 40"; r = "M56 40 L65 42"; }
    else if (expr === "surprised") { l = "M35 40 Q40 36 45 40"; r = "M55 40 Q60 36 65 40"; }
    else if (angry) { l = "M35 41 L45 44"; r = "M55 44 L65 41"; }
    else if (expr === "smug") { l = "M35 43 L45 43"; r = "M55 41 Q60 37 65 41"; }
    else if (expr === "thinking") { l = "M35 42 L45 42"; r = "M55 40 Q60 38 65 41"; }
    else { l = "M35 43 Q40 41 45 43"; r = "M55 43 Q60 41 65 43"; }
    return `<path d="${l}" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="${r}" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  }

  function mouth(t, expr) {
    const s = `stroke="#6b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"`;
    switch (expr) {
      case "happy": return `<path d="M41 64 Q50 74 59 64 Z" fill="#7a2323"/><path d="M43 65 Q50 69 57 65" stroke="#fff" stroke-width="1.6" fill="none"/>`;
      case "sad": return `<path d="M42 69 Q50 62 58 69" ${s}/>`;
      case "surprised": return `<ellipse cx="50" cy="67" rx="4" ry="5" fill="#7a2323"/>`;
      case "thinking": return `<path d="M45 67 Q51 65 56 68" ${s}/>`;
      case "smug": return `<path d="M42 66 Q52 70 59 63" ${s}/>`;
      default:
        if (t.p === "agressivo") return `<path d="M43 67 Q52 69 58 64" ${s}/>`;
        if (t.p === "criativo") return `<path d="M42 65 Q50 71 58 65" ${s}/>`;
        return `<path d="M43 66 Q50 69 57 66" ${s}/>`;
    }
  }

  function beard(t) {
    const c = t.hairColor;
    switch (t.beard) {
      case "full": return `<path d="M26 54 Q27 80 50 83 Q73 80 74 54 Q70 70 62 70 Q50 74 38 70 Q30 70 26 54 Z" fill="${c}"/>`;
      case "goatee": return `<path d="M44 71 Q50 80 56 71 Q50 74 44 71 Z" fill="${c}"/><path d="M42 62 Q50 59 58 62 Q50 61 42 62Z" fill="${c}" stroke="${c}" stroke-width="2"/>`;
      case "stubble": return `<path d="M28 58 Q30 79 50 81 Q70 79 72 58 Q66 74 50 75 Q34 74 28 58 Z" fill="${c}" opacity=".28"/>`;
      case "mustache": return `<path d="M41 62 Q46 58 50 61 Q54 58 59 62 Q54 63 50 62 Q46 63 41 62 Z" fill="${c}" stroke="${c}" stroke-width="1.6"/>`;
      default: return "";
    }
  }

  function glasses(t) {
    if (!t.glasses) return "";
    if (t.glasses === "sun") return `<path d="M30 45 L48 45 Q48 56 39 56 Q30 56 30 45 Z M52 45 L70 45 Q70 56 61 56 Q52 56 52 45 Z" fill="#111" stroke="#111" stroke-width="1.5"/><path d="M48 47 L52 47" stroke="#111" stroke-width="2"/><path d="M33 47 L37 47" stroke="#fff" stroke-width="1.2" opacity=".6"/>`;
    const st = `stroke="#222" stroke-width="1.8" fill="rgba(255,255,255,.12)"`;
    const lens = t.glasses === "round"
      ? `<circle cx="40" cy="50" r="7" ${st}/><circle cx="60" cy="50" r="7" ${st}/>`
      : `<rect x="32" y="45" width="15" height="10" rx="2.5" ${st}/><rect x="53" y="45" width="15" height="10" rx="2.5" ${st}/>`;
    return lens + `<path d="M47 50 L53 50" stroke="#222" stroke-width="1.8"/>`;
  }

  function svg(bot, expr = "neutral", opts = {}) {
    if (!bot || !bot.id) return "";
    const t = traits(bot);
    const skin = t.skin, sd = shade(skin, -22);
    const galaxy = t.bg === "galaxy";
    const bg = galaxy ? `url(#gx-${bot.id})` : opts.bg || t.bg || bot.avatar_color || "#34495e";
    const defs = (galaxy ? `<radialGradient id="gx-${bot.id}" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="#8e5cff"/><stop offset=".55" stop-color="#2a1b6b"/><stop offset="1" stop-color="#0b0620"/></radialGradient>` : "")
      + (t.goldShirt ? `<linearGradient id="gs-${bot.id}" x1="0" x2="1"><stop offset="0" stop-color="#b8860b"/><stop offset=".5" stop-color="#ffe082"/><stop offset="1" stop-color="#b8860b"/></linearGradient>` : "");
    const stars = galaxy ? [[14, 18], [84, 22], [20, 40], [80, 46], [12, 70], [88, 70], [30, 12], [70, 10]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? .8 : 1.3}" fill="#fff" opacity=".85"/>`).join("") : "";
    const blush = expr === "happy" || t.p === "criativo"
      ? `<ellipse cx="34" cy="60" rx="4" ry="2.4" fill="#ff7b7b" opacity=".35"/><ellipse cx="66" cy="60" rx="4" ry="2.4" fill="#ff7b7b" opacity=".35"/>` : "";
    const freckles = t.freckles ? [[35, 57], [38, 59], [41, 57], [59, 57], [62, 59], [65, 57]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".8" fill="${shade(skin, -60)}"/>`).join("") : "";
    const earrings = t.earrings ? `<circle cx="25" cy="60" r="2" fill="#f0c96a"/><circle cx="75" cy="60" r="2" fill="#f0c96a"/>` : "";
    const sweat = expr === "sad" ? `<path d="M70 38 Q72 43 70 45 Q68 43 70 38 Z" fill="#7fd3ff"/>` : "";
    const think = expr === "thinking" ? `<circle cx="84" cy="22" r="3" fill="#fff" opacity=".85"/><circle cx="90" cy="14" r="4.5" fill="#fff" opacity=".85"/>` : "";
    return `<svg viewBox="6 6 88 88" class="face" role="img" aria-label="${bot.name}">
      <defs><clipPath id="fc-${bot.id}"><circle cx="50" cy="50" r="50"/></clipPath>${defs}</defs>
      <g clip-path="url(#fc-${bot.id})">
        <rect width="100" height="100" fill="${bg}"/>${stars}
        ${hairBack(t)}
        <path d="M14 104 Q16 80 38 78 L62 78 Q84 80 86 104 Z" fill="${t.goldShirt ? `url(#gs-${bot.id})` : t.shirt}"/>
        <rect x="43" y="68" width="14" height="14" rx="4" fill="${sd}"/>
        <ellipse cx="25" cy="53" rx="4" ry="6" fill="${sd}"/><ellipse cx="75" cy="53" rx="4" ry="6" fill="${sd}"/>
        <g fill="${skin}">${headPath(t.face)}</g>
        ${earrings}${freckles}${blush}
        ${beard(t)}
        ${hairFront(t)}${hat(t)}
        ${brows(t, expr)}${eyes(t, expr)}
        <path d="M49 54 Q47 59 50 60" stroke="${shade(skin, -45)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        ${mouth(t, expr)}${glasses(t)}${sweat}
      </g>${think}
    </svg>`;
  }

  // rosto padrão do jogador (antes de ele montar o dele): sorteado pelo nome, sempre o mesmo
  function playerDefault(id, name) {
    const r = rng("player|" + id + "|" + name);
    const f = r() < 0.4;
    return {
      skin: pick(r, SKIN), face: pick(r, ["round", "oval", "square"]),
      hair: f ? pick(r, ["long", "bun", "ponytail", "bob", "curly"]) : pick(r, ["short", "side", "buzz", "curly"]),
      hairColor: pick(r, HAIR.slice(0, 6)), eyeShape: pick(r, ["round", "dot"]), beard: "none",
      glasses: r() < 0.25 ? "round" : "none", hat: "none", shirt: pick(r, SHIRT), bg: "#5c6f95",
      freckles: false, earrings: f && r() < 0.5,
    };
  }

  window.NexFace = { svg, traits, playerDefault };
})();
