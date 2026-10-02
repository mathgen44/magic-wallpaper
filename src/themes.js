// Thèmes de couleurs : variables CSS appliquées à tout le fond d'écran.
import { api } from "./api.js";
import { hexToRgba } from "./util.js";

export const FONTS = [
  ["Segoe UI Variable Display, Segoe UI, system-ui, sans-serif", "Segoe UI"],
  ["Bahnschrift, Segoe UI, sans-serif", "Bahnschrift"],
  ["Cascadia Code, Consolas, monospace", "Cascadia Code"],
  ["Consolas, monospace", "Consolas"],
  ["Georgia, serif", "Georgia"],
  ["Trebuchet MS, sans-serif", "Trebuchet MS"],
  ["Arial, Helvetica, sans-serif", "Arial"],
];

const base = { cardOpacity: 0.55, blur: 14, radius: 18, border: 0.08, font: FONTS[0][0], shadow: true };

export const PRESETS = {
  nuit: {
    label: "Nuit",
    theme: { ...base, fg: "#e8ecf8", muted: "#9aa6c8", accent: "#7c9cff", accent2: "#48e0c4", card: "#121a30" },
    background: { type: "gradient", from: "#1e2a4a", to: "#070a14", angle: 145 },
  },
  aurore: {
    label: "Aurore",
    theme: { ...base, fg: "#1d2433", muted: "#5d6880", accent: "#4f5bd5", accent2: "#e2557b", card: "#ffffff", cardOpacity: 0.62, border: 0.0 },
    background: { type: "gradient", from: "#fde2e4", to: "#c9d8ff", angle: 135 },
  },
  foret: {
    label: "Forêt",
    theme: { ...base, fg: "#e6f0e6", muted: "#9bb39d", accent: "#7fd18b", accent2: "#e8c46a", card: "#0f1f17" },
    background: { type: "gradient", from: "#1f3a2b", to: "#08120d", angle: 160 },
  },
  neon: {
    label: "Néon",
    theme: { ...base, fg: "#f4ecff", muted: "#b19cd9", accent: "#ff4fd8", accent2: "#3ef2ff", card: "#1a0b2e", cardOpacity: 0.5, radius: 8, border: 0.18, font: FONTS[1][0] },
    background: { type: "gradient", from: "#2b0a4a", to: "#05010d", angle: 180 },
  },
  graphite: {
    label: "Graphite",
    theme: { ...base, fg: "#f1f1f1", muted: "#a0a0a0", accent: "#f1f1f1", accent2: "#8a8a8a", card: "#1b1b1b", radius: 6, blur: 0, cardOpacity: 0.7 },
    background: { type: "color", color: "#0e0e0e" },
  },
  ocean: {
    label: "Océan",
    theme: { ...base, fg: "#e4f4fb", muted: "#8fb6c8", accent: "#3ec1f0", accent2: "#ffb86b", card: "#082233" },
    background: { type: "gradient", from: "#0d4a6b", to: "#03121d", angle: 200 },
  },
  terminal: {
    label: "Terminal",
    theme: { ...base, fg: "#b8f5c0", muted: "#5c9c66", accent: "#39ff6a", accent2: "#ffd84a", card: "#000000", cardOpacity: 0.65, radius: 2, blur: 0, border: 0.25, font: FONTS[2][0], shadow: false },
    background: { type: "color", color: "#020803" },
  },
};

export const DEFAULT_BACKGROUND = { type: "gradient", color: "#0d1222", from: "#1e2a4a", to: "#070a14", angle: 145, image: "", fit: "cover", dim: 0.2, blurImg: 0 };

export function presetConfig(key) {
  const p = PRESETS[key] || PRESETS.nuit;
  return { theme: { preset: key, ...p.theme }, background: { ...DEFAULT_BACKGROUND, ...p.background } };
}

/** Applique les variables du thème à un élément racine. */
export function applyTheme(root, t) {
  const s = root.style;
  s.setProperty("--fg", t.fg);
  s.setProperty("--muted", t.muted);
  s.setProperty("--accent", t.accent);
  s.setProperty("--accent2", t.accent2);
  s.setProperty("--card", hexToRgba(t.card, t.cardOpacity));
  s.setProperty("--card-solid", t.card);
  s.setProperty("--track", hexToRgba(t.fg, 0.12));
  s.setProperty("--border", hexToRgba(t.fg, t.border));
  s.setProperty("--blur", `${t.blur}px`);
  s.setProperty("--radius", `${t.radius}px`);
  s.setProperty("--font", t.font);
  s.setProperty("--shadow", t.shadow ? "0 10px 40px rgba(0,0,0,.28)" : "none");
}

/** Dessine le fond (couleur, dégradé ou image) dans `layer`. */
export async function applyBackground(layer, bg) {
  const s = layer.style;
  s.backgroundImage = "";
  s.backgroundColor = bg.color || "#000";
  s.filter = "";
  if (bg.type === "gradient") {
    s.backgroundImage = `linear-gradient(${bg.angle ?? 135}deg, ${bg.from}, ${bg.to})`;
  } else if (bg.type === "image" && bg.image) {
    const url = await api.fileUrl(bg.image).catch(() => "");
    if (url) {
      s.backgroundImage = `url("${url}")`;
      s.backgroundSize = bg.fit === "contain" ? "contain" : bg.fit === "tile" ? "auto" : "cover";
      s.backgroundRepeat = bg.fit === "tile" ? "repeat" : "no-repeat";
      s.backgroundPosition = "center";
      if (bg.blurImg) s.filter = `blur(${bg.blurImg}px)`;
    }
  }
  layer.parentElement?.style.setProperty("--dim", bg.type === "image" ? bg.dim ?? 0 : 0);
}
