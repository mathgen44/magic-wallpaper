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
// folder, image, checklist, location (lieu : automatique ou ville). Propriétés : key, label, default, min, max, step, choices,
// hint, showIf(options) → bool.
// ctx : { api, editing, signal } — `signal` (AbortSignal) est déclenché au démontage.
//
// Puis l'importer ci-dessous.

import clock from "./clock.js";
import carousel from "./carousel.js";
import rss from "./rss.js";
import sysinfo from "./sysinfo.js";
import text from "./text.js";
import weather from "./weather.js";
import sun from "./sun.js";
import moon from "./moon.js";
import media from "./media.js";
import calendar from "./calendar.js";
import visualizer from "./visualizer.js";

export const WIDGET_LIST = [clock, weather, calendar, media, visualizer, sysinfo, rss, carousel, sun, moon, text];
export const WIDGETS = Object.fromEntries(WIDGET_LIST.map((w) => [w.type, w]));
