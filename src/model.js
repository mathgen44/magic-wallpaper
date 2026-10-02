// Modèle de configuration : grille, thème, fond, briques.
import { presetConfig } from "./themes.js";
import { WIDGETS } from "./widgets/index.js";
import { uid, clone } from "./util.js";

export const CONFIG_VERSION = 1;

export const DEFAULT_STYLE = { card: true, accent: "", scale: 1, opacity: 1 };

export function defaultsFor(type) {
  const w = WIDGETS[type];
  const o = {};
  for (const f of w?.options || []) if ("default" in f) o[f.key] = clone(f.default);
  return o;
}

export function makeWidget(type, x = 0, y = 0) {
  const w = WIDGETS[type];
  return { id: uid(), type, x, y, w: w.size.w, h: w.size.h, options: defaultsFor(type), style: { ...DEFAULT_STYLE } };
}

export function defaultConfig() {
  const { theme, background } = presetConfig("nuit");
  const place = (type, x, y, w, h, options = {}) => ({ ...makeWidget(type, x, y), w, h, options: { ...defaultsFor(type), ...options } });
  return {
    version: CONFIG_VERSION,
    grid: { cols: 48, rows: 27, gap: 14 },
    theme,
    background,
    settings: { monitors: "all" },
    widgets: [
      place("clock", 2, 2, 15, 7),
      place("sysinfo", 36, 2, 10, 13),
      place("rss", 2, 14, 13, 11),
      place("carousel", 30, 17, 16, 8),
    ],
  };
}

/** Complète / répare une configuration chargée (anciennes versions, champs manquants). */
export function normalize(cfg) {
  const d = defaultConfig();
  if (!cfg || typeof cfg !== "object") return d;
  const out = {
    version: CONFIG_VERSION,
    grid: { ...d.grid, ...(cfg.grid || {}) },
    theme: { ...d.theme, ...(cfg.theme || {}) },
    background: { ...d.background, ...(cfg.background || {}) },
    settings: { ...d.settings, ...(cfg.settings || {}) },
    widgets: [],
  };
  for (const w of Array.isArray(cfg.widgets) ? cfg.widgets : []) {
    if (!WIDGETS[w.type]) continue; // type inconnu (brique supprimée)
    out.widgets.push({
      id: w.id || uid(),
      type: w.type,
      x: +w.x || 0,
      y: +w.y || 0,
      w: Math.max(1, +w.w || 4),
      h: Math.max(1, +w.h || 4),
      options: { ...defaultsFor(w.type), ...(w.options || {}) },
      style: { ...DEFAULT_STYLE, ...(w.style || {}) },
    });
  }
  return out;
}
