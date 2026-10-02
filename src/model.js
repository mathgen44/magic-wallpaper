// Modèle de configuration : grille, thème, fond, briques.
import { presetConfig } from "./themes.js";
import { WIDGETS } from "./widgets/index.js";
import { uid, clone } from "./util.js";

export const CONFIG_VERSION = 2;

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

/** Disposition par défaut (grille, thème, fond, briques). */
export function defaultLayout(name = "Principale", id = "main") {
  const { theme, background } = presetConfig("nuit");
  const place = (type, x, y, w, h, options = {}) => ({ ...makeWidget(type, x, y), w, h, options: { ...defaultsFor(type), ...options } });
  return {
    id,
    name,
    grid: { cols: 48, rows: 27, gap: 14 },
    theme,
    background,
    widgets: [
      place("clock", 2, 2, 15, 7),
      place("sysinfo", 36, 2, 10, 13),
      place("rss", 2, 14, 13, 11),
      place("carousel", 30, 17, 16, 8),
    ],
  };
}

/**
 * Configuration complète :
 * - `layouts` : dispositions nommées (au moins une) ;
 * - `screens` : affectation par nom d'écran → id de disposition, ou "none" (pas de fond).
 *   Un écran absent utilise la première disposition.
 */
export function defaultConfig() {
  return { version: CONFIG_VERSION, settings: {}, layouts: [defaultLayout()], screens: {} };
}

function normalizeWidgets(list) {
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    if (!WIDGETS[w.type]) continue; // type inconnu (brique supprimée)
    out.push({
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

export function normalizeLayout(l, fallbackName = "Disposition") {
  const d = defaultLayout();
  l = l && typeof l === "object" ? l : {};
  return {
    id: String(l.id || uid()),
    name: String(l.name || fallbackName),
    grid: { ...d.grid, ...(l.grid || {}) },
    theme: { ...d.theme, ...(l.theme || {}) },
    background: { ...d.background, ...(l.background || {}) },
    widgets: normalizeWidgets(l.widgets),
  };
}

/** Complète / répare une configuration chargée (anciennes versions, champs manquants). */
export function normalize(cfg) {
  if (!cfg || typeof cfg !== "object") return defaultConfig();
  let layouts;
  if (Array.isArray(cfg.layouts) && cfg.layouts.length) {
    layouts = cfg.layouts.map((l, i) => normalizeLayout(l, `Disposition ${i + 1}`));
  } else {
    // Version 1 : une seule disposition à la racine.
    layouts = [normalizeLayout({ ...cfg, id: "main", name: "Principale" })];
  }
  // Ids uniques.
  const ids = new Set();
  for (const l of layouts) {
    if (ids.has(l.id)) l.id = uid();
    ids.add(l.id);
  }
  const screens = {};
  for (const [name, v] of Object.entries(cfg.screens && typeof cfg.screens === "object" ? cfg.screens : {})) {
    if (v === "none" || ids.has(v)) screens[name] = v;
  }
  return { version: CONFIG_VERSION, settings: { ...(cfg.settings || {}) }, layouts, screens };
}

/** Disposition à afficher sur l'écran `name` (null = aucun fond). */
export function layoutForScreen(cfg, name) {
  const v = cfg.screens?.[name];
  if (v === "none") return null;
  return cfg.layouts.find((l) => l.id === v) || cfg.layouts[0];
}
