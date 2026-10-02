// Icônes météo (SVG 24×24) et libellés des codes WMO utilisés par Open-Meteo.

const CLOUD = "M7.5 19h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 10.6 4.2 4.2 0 0 0 7.5 19z";
const CLOUD_UP = "M7.5 15h9.5a3.6 3.6 0 0 0 .6-7.15A5 5 0 0 0 7.4 7.1 3.8 3.8 0 0 0 7.5 15z";
const sun = (cx = 12, cy = 12, r = 4, rays = true) =>
  `<circle class="wi-sun" cx="${cx}" cy="${cy}" r="${r}"/>` +
  (rays
    ? Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        const p = (d) => `${(cx + Math.cos(a) * d).toFixed(2)} ${(cy + Math.sin(a) * d).toFixed(2)}`;
        return `<path class="wi-ray" d="M${p(r + 2.2)}L${p(r + 4.2)}"/>`;
      }).join("")
    : "");
const moon = (cx = 12, cy = 12, r = 5.5) =>
  `<path class="wi-moon" d="M${cx + r * 0.35} ${cy - r}a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.35}A${r * 0.9} ${r * 0.9} 0 0 1 ${cx + r * 0.35} ${cy - r}z"/>`;
const drops = (n, slant = true) =>
  Array.from({ length: n }, (_, i) => {
    const x = 8.5 + i * (7 / Math.max(1, n - 1));
    return `<path class="wi-rain" d="M${x.toFixed(1)} 17.5l${slant ? -1 : 0} 3"/>`;
  }).join("");
const flakes = (n) =>
  Array.from({ length: n }, (_, i) => `<circle class="wi-snow" cx="${(8.5 + i * (7 / Math.max(1, n - 1))).toFixed(1)}" cy="${i % 2 ? 20.5 : 18.5}" r="0.9"/>`).join("");

const ICONS = {
  clear: (night) => (night ? moon() : sun()),
  partly: (night) => (night ? moon(8.5, 8, 4) : sun(8.5, 8.5, 3.2)) + `<path class="wi-cloud" d="${CLOUD}" transform="translate(2 1) scale(.92)"/>`,
  cloudy: () => `<path class="wi-cloud wi-back" d="${CLOUD}" transform="translate(-2.5 -3.5) scale(.8)"/><path class="wi-cloud" d="${CLOUD}"/>`,
  fog: () => `<path class="wi-cloud" d="${CLOUD_UP}"/><path class="wi-fog" d="M5 18h14M7 21h10"/>`,
  drizzle: () => `<path class="wi-cloud" d="${CLOUD_UP}"/>` + drops(3, false),
  rain: () => `<path class="wi-cloud" d="${CLOUD_UP}"/>` + drops(4),
  freezing: () => `<path class="wi-cloud" d="${CLOUD_UP}"/>` + drops(2) + flakes(2),
  snow: () => `<path class="wi-cloud" d="${CLOUD_UP}"/>` + flakes(4),
  showers: (night) => (night ? moon(17, 6, 3.4) : sun(17, 6.5, 2.6, false)) + `<path class="wi-cloud" d="${CLOUD_UP}"/>` + drops(3),
  thunder: () => `<path class="wi-cloud" d="${CLOUD_UP}"/><path class="wi-bolt" d="M12.5 14.5l-2.5 4h3l-2 4"/>`,
};

const CODES = {
  0: ["clear", "Ciel dégagé"],
  1: ["clear", "Plutôt dégagé"],
  2: ["partly", "Partiellement nuageux"],
  3: ["cloudy", "Couvert"],
  45: ["fog", "Brouillard"],
  48: ["fog", "Brouillard givrant"],
  51: ["drizzle", "Bruine légère"],
  53: ["drizzle", "Bruine"],
  55: ["drizzle", "Bruine dense"],
  56: ["freezing", "Bruine verglaçante"],
  57: ["freezing", "Bruine verglaçante"],
  61: ["rain", "Pluie faible"],
  63: ["rain", "Pluie"],
  65: ["rain", "Pluie forte"],
  66: ["freezing", "Pluie verglaçante"],
  67: ["freezing", "Pluie verglaçante forte"],
  71: ["snow", "Neige faible"],
  73: ["snow", "Neige"],
  75: ["snow", "Neige forte"],
  77: ["snow", "Grains de neige"],
  80: ["showers", "Averses"],
  81: ["showers", "Averses"],
  82: ["showers", "Averses violentes"],
  85: ["snow", "Averses de neige"],
  86: ["snow", "Fortes averses de neige"],
  95: ["thunder", "Orage"],
  96: ["thunder", "Orage avec grêle"],
  99: ["thunder", "Orage avec forte grêle"],
};

export function weatherLabel(code) {
  return CODES[code]?.[1] || "—";
}

/** Balise SVG de l'icône correspondant au code WMO (night = nuit). */
export function weatherIcon(code, night = false, cls = "") {
  const kind = CODES[code]?.[0] || "cloudy";
  return `<svg class="wicon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind](night)}</svg>`;
}
