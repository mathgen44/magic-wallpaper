// Registre des briques.
//
// Ajouter une brique = créer un fichier dans ce dossier qui exporte par défaut :
// {
//   type: "identifiant",            // unique, stocké dans la config
//   name: "Nom affiché",
//   description: "…",
//   icon: "<svg…>",                 // 24×24, currentColor
//   size: { w, h },                 // taille par défaut, en cases de grille
//   minSize: { w, h },              // optionnel
//   options: [ champ, … ],          // génère automatiquement le panneau de réglages
//   mount(body, options, ctx) → { destroy() }
// }
// Types de champs : text, textarea, list, number, range, toggle, select, color,
// folder, checklist. Propriétés : key, label, default, min, max, step, choices,
// hint, showIf(options) → bool.
// ctx : { api, editing, signal } — `signal` (AbortSignal) est déclenché au démontage.
//
// Puis l'importer ci-dessous.

import clock from "./clock.js";
import carousel from "./carousel.js";
import rss from "./rss.js";
import sysinfo from "./sysinfo.js";
import text from "./text.js";

export const WIDGET_LIST = [clock, carousel, rss, sysinfo, text];
export const WIDGETS = Object.fromEntries(WIDGET_LIST.map((w) => [w.type, w]));
