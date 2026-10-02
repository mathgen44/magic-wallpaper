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
    return [{ name: "Écran principal", width: Math.round(screen.width * dpr), height: Math.round(screen.height * dpr), scale: dpr, primary: true }];
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
