// Pont vers le backend Rust (Tauri). Hors Tauri (navigateur, `npm run dev`),
// des données simulées permettent de travailler sur l'interface.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

const LS_KEY = "dynamic-background:config";

// ---------------------------------------------------------------- mocks ----
const mock = {
  cpuHist: 20,
  sys() {
    this.cpuHist = Math.max(2, Math.min(98, this.cpuHist + (Math.random() - 0.5) * 18));
    const cores = Array.from({ length: 8 }, () => Math.round(Math.random() * this.cpuHist * 1.5) % 100);
    return {
      cpu_usage: this.cpuHist,
      cpu_cores: cores,
      cpu_brand: "AMD Ryzen 7 5800X3D 8-Core Processor",
      cpu_freq_mhz: 3400,
      mem_total: 32 * 1024 ** 3,
      mem_used: (12 + Math.random() * 2) * 1024 ** 3,
      swap_total: 4 * 1024 ** 3,
      swap_used: 0.4 * 1024 ** 3,
      disks: [
        { name: "Système", mount: "C:\\", total: 1000e9, used: 612e9 },
        { name: "Jeux", mount: "D:\\", total: 2000e9, used: 1530e9 },
      ],
      net_rx: Math.random() * 4e6,
      net_tx: Math.random() * 4e5,
      uptime: 3 * 86400 + 4 * 3600 + 720 + Math.floor(performance.now() / 1000),
      host: "DESKTOP-DEMO",
      os: "Windows 11 Professionnel 24H2",
      processes: 287,
      gpus: [{ name: "NVIDIA GeForce RTX 4070", usage: Math.min(100, this.cpuHist * 1.4), vram_used: (5 + Math.random()) * 1024 ** 3, vram_total: 12 * 1024 ** 3, temp: 52 + this.cpuHist / 5, fan_rpm: 1100 }],
      cpu_temp: 48 + this.cpuHist / 4,
    };
  },
  images() {
    const hues = [210, 260, 330, 20, 150, 190];
    return hues.map((h, i) => {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h},70%,55%)'/><stop offset='1' stop-color='hsl(${h + 40},60%,25%)'/></linearGradient></defs><rect width='1600' height='900' fill='url(%23g)'/><circle cx='${300 + i * 180}' cy='420' r='260' fill='white' fill-opacity='.12'/><text x='80' y='820' font-family='Segoe UI,sans-serif' font-size='64' fill='white' fill-opacity='.7'>Image de démonstration ${i + 1}</text></svg>`;
      return "data:image/svg+xml;utf8," + svg.replace(/#/g, "%23");
    });
  },
  feeds() {
    const now = Date.now();
    const t = [
      "Les processeurs de nouvelle génération gagnent 20 % d'efficacité énergétique",
      "Proxmox VE : une mise à jour majeure simplifie le passthrough GPU",
      "Le patrimoine fluvial de la Loire mis à l'honneur cet été",
      "Windows 11 : ce qui change avec la dernière mise à jour cumulative",
      "Auto-hébergement : comment surveiller son homelab avec Zabbix",
      "Les cartes graphiques baissent enfin de prix",
      "Open source : un nouveau gestionnaire de fonds d'écran fait parler de lui",
    ];
    return {
      items: t.map((title, i) => ({
        title,
        link: "https://example.org/" + i,
        date: now - i * 47 * 60 * 1000,
        summary: "Résumé de démonstration de l'article, affiché lorsque le mode le permet.",
        image: i % 2 ? null : mock.images()[i % 6],
        source: i % 3 ? "Démo Tech" : "Démo Actu",
      })),
      errors: [],
    };
  },
};

mock.json = (url) => {
  if (url.includes("geocoding-api")) {
    const q = new URL(url).searchParams.get("name") || "";
    return { results: [{ name: q.charAt(0).toUpperCase() + q.slice(1), admin1: "Pays de la Loire", country: "France", latitude: 47.218, longitude: -1.553 }, { name: q + "-sur-Mer", admin1: "Bretagne", country: "France", latitude: 48.1, longitude: -2.8 }] };
  }
  if (url.includes("ipwho.is") || url.includes("geojs")) return { success: true, latitude: 47.218, longitude: -1.553, city: "Nantes" };
  if (url.includes("open-meteo.com/v1/forecast")) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const hours = Array.from({ length: 8 * 24 }, (_, i) => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setHours(i);
      return `${iso(d)}T${pad(d.getHours())}:00`;
    });
    const codes = [0, 1, 2, 3, 61, 80, 95, 71, 45, 2];
    return {
      current: { time: `${iso(now)}T${pad(now.getHours())}:00`, temperature_2m: 16.4, relative_humidity_2m: 72, apparent_temperature: 15.1, is_day: now.getHours() > 7 && now.getHours() < 20 ? 1 : 0, weather_code: 2, wind_speed_10m: 18, wind_direction_10m: 250, pressure_msl: 1016 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => 12 + 6 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI)), weather_code: hours.map((_, i) => codes[(i >> 2) % codes.length]), precipitation_probability: hours.map((_, i) => (i * 13) % 90), is_day: hours.map((_, i) => (i % 24 > 7 && i % 24 < 20 ? 1 : 0)) },
      daily: { time: Array.from({ length: 8 }, (_, i) => iso(new Date(now.valueOf() + i * 864e5))), weather_code: [2, 61, 80, 3, 0, 95, 71, 1], temperature_2m_max: [18, 15, 14, 17, 20, 19, 9, 12], temperature_2m_min: [9, 10, 8, 7, 9, 11, 2, 4], precipitation_probability_max: [10, 80, 60, 20, 0, 70, 50, 5], uv_index_max: [3, 2, 2, 3, 4, 3, 1, 2] },
    };
  }
  if (url.includes("localhost")) {
    const t = (v) => `${v.toFixed(1)} °C`;
    return { Text: "Sensor", Children: [{ Text: "PC", Children: [
      { Text: "AMD Ryzen 7 5800X3D", ImageURL: "images_icon/cpu.png", Children: [{ Text: "Temperatures", Children: [{ Text: "Core (Tctl/Tdie)", Value: t(55 + Math.random() * 5), SensorId: "/amdcpu/0/temperature/2" }] }] },
      { Text: "NVIDIA GeForce RTX 4070", ImageURL: "images_icon/nvidia.png", Children: [{ Text: "Temperatures", Children: [{ Text: "GPU Core", Value: t(60), SensorId: "/gpu-nvidia/0/temperature/0" }, { Text: "GPU Hot Spot", Value: t(71), SensorId: "/gpu-nvidia/0/temperature/2" }] }] },
    ] }] };
  }
  throw new Error("hors ligne (mode navigateur)");
};

// Lecture simulée : un morceau de 3 min 30 en boucle.
mock.media = { playing: true, t0: Date.now() - 42000, track: 0 };
mock.mediaInfo = () => {
  const m = mock.media;
  const tracks = [["Clair de lune", "Claude Debussy", "Suite bergamasque"], ["Gymnopédie n° 1", "Erik Satie", "Gymnopédies"]];
  const [title, artist, album] = tracks[m.track % tracks.length];
  const hue = m.track % 2 ? 330 : 210;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},70%,60%)'/><stop offset='1' stop-color='hsl(${hue + 50},60%,25%)'/></linearGradient></defs><rect width='300' height='300' fill='url(%23g)'/><circle cx='150' cy='150' r='70' fill='none' stroke='white' stroke-opacity='.5' stroke-width='6'/></svg>`;
  const pos = m.playing ? (Date.now() - m.t0) % 210000 : m.paused || 0;
  return { available: true, app: "Spotify.exe", title, artist, album, playing: m.playing, position_ms: pos, duration_ms: 210000, updated_ms: Date.now(), thumbnail: "data:image/svg+xml;utf8," + svg, can_prev: true, can_next: true, can_play_pause: true };
};

// ------------------------------------------------------------------ API ----
export const api = {
  async getConfig() {
    if (isTauri) return invoke("get_config");
    try {
      return JSON.parse(localStorage.getItem(LS_KEY));
    } catch {
      return null;
    }
  },
  async saveConfig(config) {
    if (isTauri) return invoke("save_config", { config });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
    } catch {}
    window.dispatchEvent(new CustomEvent("mock-config-changed", { detail: config }));
  },
  async onConfigChanged(cb) {
    if (isTauri) return listen("config-changed", (e) => cb(e.payload));
    const h = (e) => cb(e.detail);
    window.addEventListener("mock-config-changed", h);
    return () => window.removeEventListener("mock-config-changed", h);
  },
  async getMonitors() {
    if (isTauri) return invoke("get_monitors");
    const dpr = window.devicePixelRatio || 1;
    const list = [{ name: "\\\\.\\DISPLAY1", width: Math.round(screen.width * dpr), height: Math.round(screen.height * dpr), scale: dpr, primary: true }];
    // `?ecrans=2` dans l'URL simule un second écran (test de l'interface multi-écrans).
    if (new URLSearchParams(location.search).get("ecrans") === "2") list.push({ name: "\\\\.\\DISPLAY2", width: 3840, height: 2160, scale: 1.5, primary: false });
    return list;
  },
  async listImages(folder, recursive) {
    if (isTauri) return (await invoke("list_images", { folder, recursive })).map((p) => convertFileSrc(p));
    return mock.images();
  },
  async fileUrl(path) {
    if (!path) return "";
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    if (isTauri) {
      await invoke("allow_file", { path });
      return convertFileSrc(path);
    }
    return path;
  },
  async fetchFeeds(urls, limit) {
    if (isTauri) return invoke("fetch_feeds", { urls, limit });
    await new Promise((r) => setTimeout(r, 200));
    const r = mock.feeds();
    r.items = r.items.slice(0, limit);
    return r;
  },
  async systemInfo() {
    if (isTauri) return invoke("system_info");
    return mock.sys();
  },
  async exportConfig(path, config) {
    if (isTauri) return invoke("export_config", { path, config });
  },
  async importConfig(path) {
    if (isTauri) return invoke("import_config", { path });
  },
  async openUrl(url) {
    if (isTauri) return invoke("open_url", { url });
    window.open(url, "_blank", "noopener");
  },
  async onDesktopClick(cb) {
    if (isTauri) return listen("desktop-click", (e) => cb(e.payload));
  },
  async httpJson(url, ttl = 60) {
    if (isTauri) return invoke("http_json", { url, ttl });
    await new Promise((r) => setTimeout(r, 80));
    return mock.json(url);
  },
  async mediaInfo() {
    if (isTauri) return invoke("media_info");
    return mock.mediaInfo();
  },
  async mediaControl(action) {
    if (isTauri) return invoke("media_control", { action });
    const m = mock.media;
    if (action === "playpause") {
      if (m.playing) m.paused = (Date.now() - m.t0) % 210000;
      else m.t0 = Date.now() - (m.paused || 0);
      m.playing = !m.playing;
    } else {
      m.track++; // deux morceaux en alternance : suivant = précédent
      m.t0 = Date.now();
    }
  },
  async calendarEvents(urls, days) {
    if (isTauri) return invoke("calendar_events", { urls, days });
    const at = (d, h, m = 0) => {
      const x = new Date();
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() + d);
      x.setHours(h, m);
      return x.valueOf();
    };
    const ev = (d, h, dur, title, cal = 0, location = "") => ({ title, start: at(d, h), end: at(d, h) + dur * 60000, all_day: false, location, calendar: cal });
    const allDay = (d, title, cal = 1) => ({ title, start: at(d, 0), end: at(d + 1, 0), all_day: true, location: "", calendar: cal });
    const events = [
      ev(0, 9, 30, "Point d'équipe", 0, "Teams"),
      ev(0, new Date().getHours(), 90, "Revue du projet", 0, "Salle Loire"),
      ev(0, 18, 60, "Sport"),
      allDay(1, "Anniversaire de Léa"),
      ev(1, 14, 60, "Rendez-vous banque", 1, "Centre-ville"),
      ev(3, 10, 120, "Atelier Proxmox", 0),
      ev(5, 20, 150, "Cinéma", 1),
      allDay(9, "Vacances", 1),
      ev(12, 9, 60, "Dentiste", 1),
    ].filter((e) => e.start < at(days, 0));
    return { events, names: urls.map((_, i) => ["Travail", "Perso"][i] || ""), errors: [] };
  },
  async audioKeepalive() {
    if (isTauri) return invoke("audio_keepalive");
    if (mock.audioTimer) return;
    // Spectre simulé (~ musique) pour travailler l'interface dans le navigateur.
    mock.audioTimer = setInterval(() => {
      const t = performance.now() / 1000;
      const beat = Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)) ** 6;
      const bands = Array.from({ length: 64 }, (_, i) => {
        const base = 0.75 - (i / 64) * 0.45;
        const wob = 0.15 * Math.sin(t * 3 + i * 0.4) + 0.1 * Math.sin(t * 7.3 + i * 1.7);
        return Math.max(0, Math.min(1, base + wob + (i < 8 ? beat * 0.3 : 0) - Math.random() * 0.08));
      });
      window.dispatchEvent(new CustomEvent("mock-audio", { detail: bands }));
    }, 33);
  },
  async onAudioSpectrum(cb) {
    if (isTauri) return listen("audio-spectrum", (e) => cb(e.payload));
    const h = (e) => cb(e.detail);
    window.addEventListener("mock-audio", h);
    return () => window.removeEventListener("mock-audio", h);
  },
  async reloadWallpapers() {
    if (isTauri) return invoke("reload_wallpapers");
  },
  async readLog() {
    if (isTauri) return invoke("read_log");
    return "(journal disponible uniquement dans l'application)";
  },
  // ---- dialogues & démarrage auto (plugins) ----
  async pickFolder(title = "Choisir un dossier") {
    if (!isTauri) return prompt("Chemin du dossier :", "C:\\Users\\Public\\Pictures");
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ directory: true, title });
  },
  async pickImage() {
    if (!isTauri) return prompt("Chemin ou URL de l'image :", "");
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ title: "Choisir une image", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"] }] });
  },
  async pickSavePath() {
    if (!isTauri) return null;
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ title: "Exporter la disposition", defaultPath: "mon-fond.dynbg.json", filters: [{ name: "Disposition", extensions: ["json"] }] });
  },
  async pickOpenPath() {
    if (!isTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ title: "Importer une disposition", filters: [{ name: "Disposition", extensions: ["json"] }] });
  },
  async autostart(value) {
    if (!isTauri) return value ?? false;
    const m = await import("@tauri-apps/plugin-autostart");
    if (value === true) await m.enable();
    if (value === false) await m.disable();
    return m.isEnabled();
  },
};
