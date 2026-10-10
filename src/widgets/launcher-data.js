// Catégories et réglages du lanceur d'applications (partagés par la brique et l'éditeur).
import { uid } from "../util.js";

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const CAT_ICONS = {
  favorites: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/>'),
  games: svg('<path d="M7 8h10a4 4 0 0 1 3.9 4.8l-.8 4a2.3 2.3 0 0 1-4 1L14.5 16h-5l-1.6 1.8a2.3 2.3 0 0 1-4-1l-.8-4A4 4 0 0 1 7 8z"/><path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/>'),
  media: svg('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  creative: svg('<path d="M14.5 4.5 19.5 9.5 10 19H5v-5z"/><path d="m12.5 6.5 5 5"/>'),
  office: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  internet: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  dev: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  utils: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  other: svg('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'),
  folder: svg('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
};

export const DEFAULT_CATS = [
  { key: "favorites", label: "Favoris", color: "#f5b84a" },
  { key: "games", label: "Jeux", color: "#ff6b6b" },
  { key: "media", label: "Musique & vidéo", color: "#3ecf8e" },
  { key: "creative", label: "Créativité", color: "#c86fff" },
  { key: "office", label: "Bureautique", color: "#4a9fff" },
  { key: "internet", label: "Internet", color: "#4ac7f5" },
  { key: "dev", label: "Développement", color: "#8f9bff" },
  { key: "utils", label: "Utilitaires", color: "#9aa5b1" },
  { key: "other", label: "Autres", color: "#c9a27a" },
];

const PALETTE = ["#ff8a4a", "#5fd0b0", "#e86fd0", "#a3d65c", "#6fa8ff"];

/** Réglages complets (valeurs par défaut + catégories manquantes ajoutées). */
export function launcherConfig(v) {
  const cfg = {
    cats: Array.isArray(v?.cats) ? v.cats.map((c) => ({ visible: true, ...c })) : [],
    assign: { ...(v?.assign || {}) },
    favorites: Array.isArray(v?.favorites) ? [...v.favorites] : [],
    custom: Array.isArray(v?.custom) ? v.custom.map((a) => ({ ...a })) : [],
  };
  for (const d of DEFAULT_CATS) if (!cfg.cats.some((c) => c.key === d.key)) cfg.cats.push({ ...d, visible: true });
  for (const c of cfg.cats) {
    const d = DEFAULT_CATS.find((x) => x.key === c.key);
    c.label ||= d?.label || "Catégorie";
    c.color ||= d?.color || PALETTE[0];
  }
  return cfg;
}

export function newCategory(cfg, label = "Nouvelle catégorie") {
  const n = cfg.cats.filter((c) => !DEFAULT_CATS.some((d) => d.key === c.key)).length;
  return { key: "c_" + uid(), label, color: PALETTE[n % PALETTE.length], visible: true };
}

export const isDefaultCat = (key) => DEFAULT_CATS.some((d) => d.key === key);
export const catIcon = (key) => CAT_ICONS[key] || CAT_ICONS.folder;

/** Catégorie effective d'une application (« hidden » = masquée). */
export function categoryOf(app, cfg) {
  const a = cfg.assign[app.id];
  if (a === "hidden") return "hidden";
  const key = a || app.category || "other";
  return cfg.cats.some((c) => c.key === key) ? key : "other";
}

/** Applications détectées + personnalisées. */
export function allApps(detected, cfg) {
  return [...(detected || []), ...cfg.custom.map((a) => ({ ...a, source: "custom", category: a.cat || "other" }))];
}

/** Applications d'une catégorie, triées par nom. */
export function appsIn(key, apps, cfg) {
  if (key === "favorites") {
    return cfg.favorites.map((id) => apps.find((a) => a.id === id)).filter((a) => a && categoryOf(a, cfg) !== "hidden");
  }
  return apps.filter((a) => categoryOf(a, cfg) === key).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
