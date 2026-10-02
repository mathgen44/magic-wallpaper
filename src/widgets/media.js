import { el } from "../util.js";

const ICONS = {
  prev: `<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9.5 12z"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>`,
};

/** Nom lisible de l'application à partir de son identifiant Windows. */
export function prettyApp(id) {
  const s = (id || "").toLowerCase();
  const known = [
    ["spotify", "Spotify"], ["chrome", "Chrome"], ["msedge", "Edge"], ["firefox", "Firefox"], ["opera", "Opera"], ["brave", "Brave"],
    ["zunemusic", "Lecteur multimédia"], ["zunevideo", "Films et TV"], ["vlc", "VLC"], ["deezer", "Deezer"], ["applemusic", "Apple Music"],
    ["itunes", "iTunes"], ["foobar", "foobar2000"], ["musicbee", "MusicBee"], ["tidal", "TIDAL"], ["amazon", "Amazon Music"], ["plex", "Plex"],
  ];
  const hit = known.find(([k]) => s.includes(k));
  if (hit) return hit[1];
  return (id || "").split(/[\\/!]/).pop().replace(/\.exe$/i, "");
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? h + ":" + String(m).padStart(2, "0") : m}:${String(s % 60).padStart(2, "0")}`;
};

export default {
  type: "media",
  name: "Média en cours",
  description: "Titre, artiste et pochette de ce qui est en lecture (Spotify, navigateur…), avec commandes.",
  icon: ICONS.note,
  size: { w: 13, h: 5 },
  minSize: { w: 5, h: 2 },
  options: [
    { key: "layout", label: "Disposition", type: "select", default: "row", choices: [["row", "Pochette à gauche"], ["column", "Pochette au-dessus"]] },
    { key: "cover", label: "Afficher la pochette", type: "toggle", default: true },
    { key: "backdrop", label: "Pochette floutée en fond", type: "toggle", default: true },
    { key: "progress", label: "Barre de progression", type: "toggle", default: true },
    { key: "app", label: "Afficher l'application", type: "toggle", default: true },
    { key: "controls", label: "Boutons de lecture sur le bureau", type: "select", default: "click", choices: [["click", "Clic"], ["dblclick", "Double-clic"], ["none", "Masquer"]] },
    { key: "idle", label: "Quand rien ne joue", type: "select", default: "message", choices: [["message", "Afficher « Aucune lecture »"], ["hide", "Masquer la brique"]] },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: `media media-${o.layout}` });
    body.append(root);
    const cell = body.closest(".cell");
    let info = null;
    let key = "";
    let poll;
    let tick;
    const parts = {};

    const build = () => {
      parts.backdrop = el("div", { class: "media-backdrop" });
      parts.img = el("div", { class: "media-cover" });
      parts.title = el("div", { class: "media-title" });
      parts.artist = el("div", { class: "media-artist" });
      parts.app = el("div", { class: "media-app" });
      parts.fill = el("div", { class: "media-fill" });
      parts.pos = el("span", {});
      parts.dur = el("span", {});
      const btn = (act, icon) => el("button", { class: `media-btn media-${act}`, "data-action": `media:${act}`, "data-open": o.controls, tabindex: -1, html: icon });
      parts.play = btn("playpause", ICONS.pause);
      const controls = o.controls !== "none" ? el("div", { class: "media-controls" }, btn("prev", ICONS.prev), parts.play, btn("next", ICONS.next)) : null;
      root.replaceChildren(...[
        o.backdrop ? parts.backdrop : null,
        el(
          "div",
          { class: "media-inner" },
          o.cover ? parts.img : null,
          el(
            "div",
            { class: "media-text" },
            o.app ? parts.app : null,
            parts.title,
            parts.artist,
            o.progress ? el("div", { class: "media-progress" }, el("div", { class: "media-bar" }, parts.fill), el("div", { class: "media-times" }, parts.pos, parts.dur)) : null,
            controls,
          ),
        ),
      ].filter(Boolean));
    };

    const position = () => {
      if (!info) return 0;
      const p = info.position_ms + (info.playing && info.updated_ms ? Date.now() - info.updated_ms : 0);
      return info.duration_ms ? Math.min(p, info.duration_ms) : p;
    };
    const updateProgress = () => {
      if (!info?.available || !o.progress) return;
      const p = position();
      parts.fill.style.width = info.duration_ms ? `${(p / info.duration_ms) * 100}%` : "0";
      parts.pos.textContent = fmtTime(p);
      parts.dur.textContent = info.duration_ms ? fmtTime(info.duration_ms) : "";
    };

    const render = () => {
      const idle = !info?.available || !info.title;
      if (cell) cell.classList.toggle("media-hidden", idle && o.idle === "hide" && !ctx.editing);
      if (idle) {
        key = "";
        root.replaceChildren(el("div", { class: "media-idle" }, el("span", { class: "media-idle-icon", html: ICONS.note }), "Aucune lecture en cours"));
        return;
      }
      if (!parts.title || !root.querySelector(".media-inner")) build();
      const k = info.title + "|" + info.artist + "|" + (info.thumbnail ? info.thumbnail.length : 0);
      if (k !== key) {
        key = k;
        const bg = info.thumbnail ? `url("${info.thumbnail}")` : "";
        parts.img.style.backgroundImage = bg;
        parts.img.classList.toggle("empty", !info.thumbnail);
        parts.img.innerHTML = info.thumbnail ? "" : ICONS.note;
        parts.backdrop.style.backgroundImage = bg;
        parts.title.textContent = info.title;
        parts.artist.textContent = [info.artist, info.album].filter(Boolean).join(" · ");
        parts.app.textContent = prettyApp(info.app);
      }
      parts.play.innerHTML = info.playing ? ICONS.pause : ICONS.play;
      root.classList.toggle("paused", !info.playing);
      updateProgress();
    };

    const refresh = async () => {
      try {
        info = await ctx.api.mediaInfo();
      } catch {
        info = null;
      }
      if (!ctx.signal.aborted) render();
    };
    refresh();
    poll = setInterval(refresh, 1000);
    tick = setInterval(updateProgress, 250);
    return {
      destroy() {
        clearInterval(poll);
        clearInterval(tick);
        cell?.classList.remove("media-hidden");
      },
    };
  },
};
