/* Nex-J Chess — Fase 7: escudos dos clubes (SVG gerado na hora a partir das cores e do estilo). */
(function () {
  let uid = 0;
  const SHIELD = "M8 6 H92 V62 C92 92 66 110 50 116 C34 110 8 92 8 62 Z";

  function pattern(style, c2) {
    switch (style) {
      case "stripes": return `<rect x="26" y="0" width="14" height="130" fill="${c2}"/><rect x="60" y="0" width="14" height="130" fill="${c2}"/>`;
      case "diag": return `<polygon points="0,70 0,40 100,90 100,120" fill="${c2}"/>`;
      case "chevron": return `<polyline points="0,38 50,78 100,38" fill="none" stroke="${c2}" stroke-width="16"/>`;
      case "cross": return `<rect x="42" y="0" width="16" height="130" fill="${c2}"/><rect x="0" y="48" width="100" height="16" fill="${c2}"/>`;
      case "rings": return `<circle cx="50" cy="60" r="44" fill="none" stroke="${c2}" stroke-width="6"/><circle cx="50" cy="60" r="30" fill="none" stroke="${c2}" stroke-width="5"/>`;
      case "star": return `<polygon points="50,14 59,42 88,42 65,59 74,88 50,71 26,88 35,59 12,42 41,42" fill="${c2}" opacity=".9"/>`;
      case "laurel": return `<path d="M22 100 C6 74 8 42 28 20" fill="none" stroke="${c2}" stroke-width="7" stroke-linecap="round"/>` +
        `<path d="M78 100 C94 74 92 42 72 20" fill="none" stroke="${c2}" stroke-width="7" stroke-linecap="round"/>` +
        [30, 52, 74].map(y => `<circle cx="${15 + (y - 30) * 0.05}" cy="${y}" r="5" fill="${c2}"/><circle cx="${85 - (y - 30) * 0.05}" cy="${y}" r="5" fill="${c2}"/>`).join("");
      default: return `<rect x="50" y="0" width="60" height="130" fill="${c2}"/>`;   // half
    }
  }

  function svg(club, size = 40) {
    if (!club) return "";
    const id = "cr" + (++uid);
    const gold = club.style === "laurel";
    return `<svg class="crest" viewBox="0 0 100 124" width="${size}" height="${Math.round(size * 1.24)}" role="img" aria-label="${(club.name || "").replace(/"/g, "")}">` +
      `<defs><clipPath id="${id}"><path d="${SHIELD}"/></clipPath></defs>` +
      `<path d="${SHIELD}" fill="${club.c1}"/>` +
      `<g clip-path="url(#${id})">${pattern(club.style, club.c2)}</g>` +
      `<text x="50" y="76" text-anchor="middle" font-size="50" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width="2.5" paint-order="stroke" style="font-family:'Segoe UI Symbol','Noto Sans Symbols 2',serif">${club.glyph || "♞"}</text>` +
      `<path d="${SHIELD}" fill="none" stroke="${gold ? "#f0c96a" : "rgba(0,0,0,.45)"}" stroke-width="${gold ? 5 : 3}"/></svg>`;
  }

  window.NexCrest = { svg };
})();
