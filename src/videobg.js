// Fond vidéo : une vidéo en boucle, ou un thème vidéo (un dossier) : une seule vidéo jouée
// en permanence, ou une vidéo par moment de la journée (aube, journée, coucher de soleil, nuit)
// avec fondu enchaîné entre les ambiances.
import { sunTimes } from "./astro.js";
import { resolveLocation } from "./widgets/location.js";
import { el } from "./util.js";

/** Valeur de `videoTheme` pour choisir soi-même dossier ou fichiers. */
export const CUSTOM_THEME = "__custom";

export const PHASES = [
  ["dawn", "Aube"],
  ["day", "Journée"],
  ["dusk", "Coucher de soleil"],
  ["night", "Nuit"],
];

// Mots reconnus dans le nom des fichiers d'un dossier « pack » (sans accents, en minuscules).
// L'ordre compte : « minuit » doit donner la nuit, « journee » le jour…
const NAME_HINTS = [
  ["night", ["nuit", "night", "minuit"]],
  ["dusk", ["crepuscule", "coucher", "dusk", "sunset", "soir", "evening"]],
  ["dawn", ["aube", "dawn", "sunrise", "lever", "matin", "morning"]],
  ["day", ["jour", "day", "midi", "noon", "apres-midi", "afternoon"]],
];

// Si une ambiance manque, on prend la plus proche visuellement.
const FALLBACK = {
  dawn: ["dusk", "day", "night"],
  day: ["dawn", "dusk", "night"],
  dusk: ["dawn", "night", "day"],
  night: ["dusk", "dawn", "day"],
};

const MIN = 60_000;

const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Associe les vidéos d'un dossier aux ambiances d'après leur nom.
 * Une seule vidéo (ou aucun nom reconnu) : la même pour toute la journée.
 */
export function matchPack(files) {
  const out = {};
  for (const f of files) {
    const name = strip(f.split(/[\\/]/).pop().replace(/\.[^.]+$/, ""));
    const hit = NAME_HINTS.find(([, words]) => words.some((w) => name.includes(w)));
    if (hit && !out[hit[0]]) out[hit[0]] = f;
  }
  if (files.length && (files.length === 1 || !Object.keys(out).length)) {
    for (const [p] of PHASES) out[p] = files[0];
  }
  return out;
}

/** Thème choisi parmi ceux disponibles (le premier si le nom est vide ou introuvable). */
export function findTheme(themes, name) {
  return themes.find((t) => t.name.toLowerCase() === (name || "").toLowerCase()) || themes[0] || null;
}

const valid = (d) => d instanceof Date && !isNaN(d);

/**
 * Ambiance à l'instant `now`.
 * - `sun` : d'après les heures réelles du soleil au lieu choisi (`coords`) ;
 * - `fixed` : d'après les heures de début saisies (bg.dawnAt, dayAt, duskAt, nightAt).
 * Renvoie aussi la date du prochain changement pour programmer le fondu.
 */
export function phaseAt(now, bg, coords) {
  if (bg.schedule !== "fixed" && coords) {
    const t = sunTimes(now, coords.lat, coords.lon);
    const margin = (bg.margin ?? 45) * MIN;
    const dawn = t.dawn, rise = t.sunrise, set = t.sunset, dusk = t.dusk;
    if ([dawn, rise, set, dusk].every(valid)) {
      const bounds = [
        ["dawn", +dawn],
        ["day", +rise + margin],
        ["dusk", +set - margin],
        ["night", +dusk + 15 * MIN],
      ];
      return pick(now, bounds);
    }
    // Jour ou nuit polaire : heures fixes.
  }
  const h = (v, d) => {
    const n = Number.isFinite(+v) ? +v : d;
    return Math.round(((n % 24) + 24) % 24 * 60) * MIN;
  };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const bounds = [
    ["dawn", +midnight + h(bg.dawnAt, 6)],
    ["day", +midnight + h(bg.dayAt, 9)],
    ["dusk", +midnight + h(bg.duskAt, 18)],
    ["night", +midnight + h(bg.nightAt, 21)],
  ];
  return pick(now, bounds);
}

// Bornes d'une journée → ambiance courante et prochaine bascule (bornes répétées la veille / le lendemain).
function pick(now, bounds) {
  const DAY = 24 * 60 * MIN;
  const all = [-DAY, 0, DAY].flatMap((o) => bounds.map(([p, t]) => [p, t + o])).sort((a, b) => a[1] - b[1]);
  let cur = all[0];
  let next = null;
  for (const b of all) {
    if (b[1] <= +now) cur = b;
    else if (!next) next = b;
  }
  return { phase: cur[0], next: next ? new Date(next[1]) : new Date(+now + 30 * MIN) };
}

/** Pilote une ou deux balises <video> dans le calque de fond. */
export class VideoBackground {
  constructor(layer, bg, api) {
    this.layer = layer;
    this.bg = bg;
    this.api = api;
    this.current = null; // { video, src }
    this.timer = 0;
    this.dead = false;
    this.onVisibility = () => this.current?.video[document.hidden ? "pause" : "play"]()?.catch?.(() => {});
    document.addEventListener("visibilitychange", this.onVisibility);
    this.start().catch((e) => console.error("Fond vidéo :", e));
  }

  async start() {
    const bg = this.bg;
    if (bg.type === "video") {
      await this.show(bg.video);
      return;
    }
    if (bg.schedule !== "fixed") {
      this.coords = await resolveLocation(bg.location, this.api).catch(() => null);
    }
    if (!this.dead) this.tick();
  }

  /** Vidéos par ambiance : celles du thème, ou (personnalisé) du dossier et des champs. */
  async loadSources() {
    const bg = this.bg;
    let sources = {};
    try {
      if (bg.videoTheme === CUSTOM_THEME) {
        if (bg.pack) sources = matchPack(await this.api.listVideos(bg.pack));
        for (const [p] of PHASES) if (bg[`video_${p}`]) sources[p] = bg[`video_${p}`];
      } else {
        const theme = findTheme((await this.api.videoThemes()).themes, bg.videoTheme);
        if (theme) sources = matchPack(theme.videos);
        this.layer.dataset.theme = theme?.name || "";
      }
    } catch (e) {
      console.error("Thème vidéo :", e);
      return this.sources || {};
    }
    return sources;
  }

  async tick() {
    clearTimeout(this.timer);
    if (this.dead) return;
    // Relu à chaque passage : un thème ajouté ou complété est pris en compte sans redémarrer.
    this.sources = await this.loadSources();
    if (this.dead) return;
    const now = new Date();
    let phase, next;
    if (this.bg.forcePhase && this.bg.forcePhase !== "auto") {
      phase = this.bg.forcePhase;
      next = new Date(+now + 60 * MIN);
    } else {
      ({ phase, next } = phaseAt(now, this.bg, this.coords));
    }
    const p = [phase, ...FALLBACK[phase]].find((k) => this.sources[k]);
    if (p) this.show(this.sources[p]);
    this.layer.dataset.phase = phase;
    // Re-vérifie au plus tard toutes les 10 min (mise en veille, changement d'heure…).
    const wait = Math.min(Math.max(+next - +now + 1000, 5000), 10 * MIN);
    this.timer = setTimeout(() => this.tick(), wait);
  }

  /** Affiche `src`, en fondu par-dessus la vidéo précédente. */
  async show(src) {
    if (!src || this.current?.src === src) return;
    const url = await this.api.fileUrl(src).catch(() => "");
    if (!url || this.dead) return;
    const bg = this.bg;
    const video = el("video", { class: "bg-video", muted: true, loop: true, playsInline: true, autoplay: true, preload: "auto" });
    video.muted = true; // indispensable pour la lecture automatique
    video.style.objectFit = bg.fit === "contain" ? "contain" : "cover";
    video.style.transitionDuration = `${bg.fade ?? 4}s`;
    video.src = url;
    const prev = this.current;
    this.current = { video, src };
    this.layer.append(video);
    const ready = await new Promise((resolve) => {
      video.addEventListener("loadeddata", () => resolve(true), { once: true });
      video.addEventListener("error", () => resolve(false), { once: true });
    });
    if (this.dead || this.current?.video !== video) return video.remove();
    if (!ready) {
      console.error("Vidéo illisible :", src, video.error?.message || "");
      video.remove();
      this.current = prev;
      return;
    }
    video.playbackRate = bg.speed || 1;
    if (!document.hidden) video.play().catch(() => {});
    void video.offsetWidth; // applique l'opacité 0 avant la transition (rAF ne tourne pas fenêtre masquée)
    video.classList.add("shown");
    if (prev) {
      // L'ancienne vidéo disparaît une fois la nouvelle entièrement visible.
      setTimeout(() => {
        prev.video.pause();
        prev.video.removeAttribute("src");
        prev.video.load(); // libère le décodeur
        prev.video.remove();
      }, (bg.fade ?? 4) * 1000 + 300);
    }
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const v of this.layer.querySelectorAll("video")) {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.remove();
    }
    this.current = null;
  }
}
