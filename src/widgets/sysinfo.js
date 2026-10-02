import { el, fmtBytes, fmtPct, fmtUptime } from "../util.js";

const SVGNS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** Températures CPU / GPU lues dans le JSON du serveur web de LibreHardwareMonitor. */
export function lhmTemps(root) {
  const cpu = [];
  const gpu = [];
  const walk = (node, hw) => {
    if (!node || typeof node !== "object") return;
    const img = (node.ImageURL || "").toLowerCase();
    if (/cpu/.test(img)) hw = "cpu";
    else if (/nvidia|ati|amd|gpu|intel/.test(img)) hw = "gpu";
    const id = (node.SensorId || "").toLowerCase();
    const v = typeof node.Value === "string" && node.Value.includes("°C") ? parseFloat(node.Value.replace(",", ".")) : NaN;
    if (Number.isFinite(v)) {
      const kind = /cpu/.test(id) && !/gpu/.test(id) ? "cpu" : /gpu/.test(id) ? "gpu" : hw;
      if (!id || id.includes("/temperature/")) (kind === "cpu" ? cpu : kind === "gpu" ? gpu : []).push([node.Text || "", v]);
    }
    for (const c of node.Children || []) walk(c, hw);
  };
  walk(root, null);
  const best = (list, re) => (list.find(([t]) => re.test(t)) || list.reduce((m, x) => (!m || x[1] > m[1] ? x : m), null))?.[1] ?? null;
  return { cpu: best(cpu, /package|tctl|tdie/i), gpu: best(gpu.filter(([t]) => !/hot ?spot|memory|junction/i.test(t)), /gpu core|^gpu$/i) ?? best(gpu, /gpu/i) };
}

const fmtTemp = (t) => (t == null ? "—" : `${Math.round(t)} °C`);

const METRICS = [
  ["cpu", "Processeur"],
  ["cores", "Cœurs (détail)"],
  ["ram", "Mémoire"],
  ["gpu", "Carte graphique (utilisation)"],
  ["vram", "Mémoire vidéo (VRAM)"],
  ["temps", "Températures CPU / GPU"],
  ["disk", "Disques"],
  ["net", "Réseau"],
  ["uptime", "Temps de fonctionnement"],
  ["host", "Machine & système"],
  ["procs", "Processus"],
];

/** Petite courbe d'historique (0–100 ou auto-échelle). */
function sparkline(cls = "") {
  const s = svg("svg", { class: "spark " + cls, viewBox: "0 0 100 30", preserveAspectRatio: "none" });
  const area = svg("path", { class: "spark-area" });
  const line = svg("polyline", { class: "spark-line", "vector-effect": "non-scaling-stroke" });
  s.append(area, line);
  return {
    node: s,
    set(values, max) {
      if (values.length < 2) return;
      const m = max || Math.max(1, ...values);
      const n = values.length - 1;
      const pts = values.map((v, i) => `${((i / n) * 100).toFixed(2)},${(30 - (v / m) * 28 - 1).toFixed(2)}`);
      line.setAttribute("points", pts.join(" "));
      area.setAttribute("d", `M0,30 L${pts.join(" L")} L100,30 Z`);
    },
  };
}

/** Jauge : barre horizontale ou anneau. */
function meter(kind, label) {
  const value = el("span", { class: "m-value" });
  const sub = el("span", { class: "m-sub" });
  if (kind === "rings") {
    const s = svg("svg", { class: "ring", viewBox: "0 0 40 40" });
    s.append(svg("circle", { class: "ring-track", cx: 20, cy: 20, r: 16, pathLength: 100 }));
    const arc = svg("circle", { class: "ring-arc", cx: 20, cy: 20, r: 16, pathLength: 100, "stroke-dasharray": "0 100" });
    s.append(arc);
    const node = el("div", { class: "m-ring" }, el("div", { class: "ring-wrap" }, s, value), el("div", { class: "m-label" }, label), sub);
    return {
      node,
      set(pct, v, subtext = "") {
        arc.setAttribute("stroke-dasharray", `${Math.max(0, Math.min(100, pct)).toFixed(1)} 100`);
        value.textContent = v;
        sub.textContent = subtext;
      },
    };
  }
  const fill = el("div", { class: "bar-fill" });
  const node = el("div", { class: "m-bar" }, el("div", { class: "m-head" }, el("span", { class: "m-label" }, label), value), el("div", { class: "bar" }, fill), sub);
  return {
    node,
    set(pct, v, subtext = "") {
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      value.textContent = v;
      sub.textContent = subtext;
    },
  };
}

export default {
  type: "sysinfo",
  name: "Infos système",
  description: "CPU, mémoire, disques, réseau… à la manière de Rainmeter.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`,
  size: { w: 10, h: 13 },
  minSize: { w: 4, h: 3 },
  options: [
    { key: "title", label: "Titre", type: "text", default: "Système" },
    { key: "metrics", label: "Informations affichées", type: "checklist", default: ["cpu", "ram", "disk", "net", "uptime"], choices: METRICS },
    { key: "disks", label: "Disques à afficher", type: "text", default: "", hint: "Ex. : C: D:  — vide = tous", showIf: (o) => (o.metrics || []).includes("disk") },
    { key: "style", label: "Style", type: "select", default: "bars", choices: [["bars", "Barres"], ["rings", "Anneaux"], ["minimal", "Texte compact"]] },
    { key: "history", label: "Courbes d'historique (CPU, réseau)", type: "toggle", default: true, showIf: (o) => o.style !== "minimal" },
    { key: "lhm", label: "Températures via LibreHardwareMonitor", type: "toggle", default: false, hint: "Windows n'expose souvent pas la température du processeur : lancez LibreHardwareMonitor avec « Remote Web Server » activé.", showIf: (o) => (o.metrics || []).includes("temps") },
    { key: "lhmUrl", label: "Adresse de LibreHardwareMonitor", type: "text", default: "http://localhost:8085/data.json", showIf: (o) => o.lhm && (o.metrics || []).includes("temps") },
    { key: "refresh", label: "Actualisation (s)", type: "number", default: 2, min: 1, max: 60 },
  ],
  mount(body, o, ctx) {
    const has = (k) => (o.metrics || []).includes(k);
    const wanted = (o.disks || "").toUpperCase().split(/[\s,;]+/).map((s) => s.replace(/[\\/]+$/, "")).filter(Boolean);
    const pickDisks = (list) => (wanted.length ? list.filter((d) => wanted.includes(d.mount.toUpperCase().replace(/[\\/]+$/, ""))) : list);
    const kind = o.style;
    const root = el("div", { class: `sysinfo sys-${kind}` });
    if (o.title) root.append(el("div", { class: "widget-title" }, o.title));
    const grid = el("div", { class: "sys-grid" });
    const extra = el("div", { class: "sys-extra" });
    root.append(grid, extra);
    body.append(root);

    const histCpu = [];
    const histRx = [];
    const histTx = [];
    const H = 60;
    const push = (a, v) => {
      a.push(v);
      if (a.length > H) a.shift();
    };

    let built = false;
    const parts = {};

    const build = (d) => {
      const m = kind === "minimal" ? null : kind;
      const line = (label) => {
        const v = el("span", { class: "kv-v" });
        const row = el("div", { class: "kv" }, el("span", { class: "kv-k" }, label), v);
        return { row, v };
      };
      if (has("cpu")) {
        if (m) {
          parts.cpu = meter(m, "CPU");
          grid.append(parts.cpu.node);
          if (o.history && m === "bars") {
            parts.cpuSpark = sparkline();
            parts.cpu.node.append(parts.cpuSpark.node);
          }
        } else grid.append((parts.cpu = line("CPU")).row);
      }
      if (has("cores")) {
        parts.cores = el("div", { class: "cores" }, ...d.cpu_cores.map(() => el("div", { class: "core" }, el("div", { class: "core-fill" }))));
        (m === "rings" ? extra : grid).append(parts.cores);
      }
      if (has("ram")) {
        if (m) grid.append((parts.ram = meter(m, "RAM")).node);
        else grid.append((parts.ram = line("RAM")).row);
      }
      // Cartes graphiques : on ignore les petites puces intégrées s'il y a une carte dédiée.
      const big = d.gpus.filter((g) => g.vram_total >= 1024 ** 3);
      const gpus = big.length ? big : d.gpus;
      const gpuLabel = (g) => (gpus.length > 1 ? g.name.replace(/^(NVIDIA|AMD|Intel\(R\))\s+(GeForce\s+|Radeon\s+)?/i, "") : "GPU");
      parts.gpuList = gpus;
      if (has("gpu")) parts.gpu = gpus.map((g) => (m ? meter(m, gpuLabel(g)) : line(gpuLabel(g))));
      if (has("vram")) parts.vram = gpus.map((g) => (m ? meter(m, gpus.length > 1 ? `VRAM ${gpuLabel(g)}` : "VRAM") : line("VRAM")));
      for (const x of [...(parts.gpu || []), ...(parts.vram || [])]) grid.append(x.node || x.row);
      if (has("temps")) {
        parts.tcpu = m ? meter(m, "CPU °C") : line("CPU");
        parts.tgpu = m ? meter(m, "GPU °C") : line("GPU");
        for (const x of [parts.tcpu, parts.tgpu]) grid.append(x.node || x.row);
      }
      if (has("disk")) {
        parts.disks = pickDisks(d.disks).map((dk) => {
          const label = dk.mount.replace(/\\$/, "") || dk.name;
          if (m) {
            const x = meter(m, label);
            grid.append(x.node);
            return x;
          }
          const x = line(label);
          grid.append(x.row);
          return x;
        });
      }
      if (has("net")) {
        const rx = el("span", { class: "net-v" });
        const tx = el("span", { class: "net-v" });
        const node = el("div", { class: "net" }, el("div", { class: "net-row" }, el("span", { class: "net-k" }, "↓"), rx, el("span", { class: "net-k" }, "↑"), tx));
        parts.net = { rx, tx };
        if (o.history && m) {
          parts.rxSpark = sparkline("rx");
          parts.txSpark = sparkline("tx");
          node.append(el("div", { class: "net-sparks" }, parts.rxSpark.node, parts.txSpark.node));
        }
        extra.append(node);
      }
      if (has("uptime")) extra.append((parts.uptime = line("En marche depuis")).row);
      if (has("procs")) extra.append((parts.procs = line("Processus")).row);
      if (has("host")) {
        parts.host = el("div", { class: "host" });
        extra.append(parts.host);
      }
      built = true;
    };

    const update = (d) => {
      if (!built) build(d);
      const set = (p, pct, v, sub) => (p.set ? p.set(pct, v, sub) : (p.v.textContent = sub ? `${v} · ${sub}` : v));
      push(histCpu, d.cpu_usage);
      push(histRx, d.net_rx);
      push(histTx, d.net_tx);
      if (parts.cpu) set(parts.cpu, d.cpu_usage, fmtPct(d.cpu_usage), kind === "rings" ? "" : d.cpu_freq_mhz ? `${(d.cpu_freq_mhz / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} GHz` : "");
      parts.cpuSpark?.set(histCpu, 100);
      if (parts.cores) [...parts.cores.children].forEach((c, i) => (c.firstChild.style.height = `${d.cpu_cores[i] ?? 0}%`));
      if (parts.ram) set(parts.ram, (d.mem_used / d.mem_total) * 100, fmtPct((d.mem_used / d.mem_total) * 100), `${fmtBytes(d.mem_used)} / ${fmtBytes(d.mem_total)}`);
      parts.gpu?.forEach((p, i) => {
        const g = d.gpus.find((x) => x.name === parts.gpuList[i]?.name);
        if (!g) return;
        const sub = [g.temp != null && fmtTemp(g.temp), g.fan_rpm && `${g.fan_rpm} tr/min`].filter(Boolean).join(" · ");
        set(p, g.usage ?? 0, g.usage == null ? "—" : fmtPct(g.usage), kind === "rings" ? "" : sub);
      });
      parts.vram?.forEach((p, i) => {
        const g = d.gpus.find((x) => x.name === parts.gpuList[i]?.name);
        if (!g || !g.vram_total) return;
        const used = g.vram_used ?? 0;
        set(p, (used / g.vram_total) * 100, fmtPct((used / g.vram_total) * 100), `${fmtBytes(used)} / ${fmtBytes(g.vram_total)}`);
      });
      if (parts.tcpu) {
        const g = d.gpus.find((x) => x.name === parts.gpuList[0]?.name);
        const tc = lhm.cpu ?? d.cpu_temp;
        const tg = g?.temp ?? lhm.gpu;
        set(parts.tcpu, tc ?? 0, fmtTemp(tc), tc == null && !o.lhm ? "indisponible : voir réglages" : "");
        set(parts.tgpu, tg ?? 0, fmtTemp(tg), "");
      }
      parts.disks?.forEach((p, i) => {
        const dk = pickDisks(d.disks)[i];
        if (dk) set(p, (dk.used / dk.total) * 100, fmtPct((dk.used / dk.total) * 100), `${fmtBytes(dk.total - dk.used)} libres`);
      });
      if (parts.net) {
        parts.net.rx.textContent = fmtBytes(d.net_rx, true);
        parts.net.tx.textContent = fmtBytes(d.net_tx, true);
        const max = Math.max(1, ...histRx, ...histTx);
        parts.rxSpark?.set(histRx, max);
        parts.txSpark?.set(histTx, max);
      }
      if (parts.uptime) parts.uptime.v.textContent = fmtUptime(d.uptime);
      if (parts.procs) parts.procs.v.textContent = String(d.processes);
      if (parts.host) parts.host.replaceChildren(el("div", { class: "host-name" }, d.host), el("div", { class: "host-os" }, d.os), has("cpu") ? el("div", { class: "host-os" }, d.cpu_brand) : "");
    };

    let lhm = { cpu: null, gpu: null };
    let lhmAt = 0;
    const readLhm = async () => {
      if (!o.lhm || !has("temps") || Date.now() - lhmAt < 2000) return;
      lhmAt = Date.now();
      try {
        lhm = lhmTemps(await ctx.api.httpJson(o.lhmUrl || "http://localhost:8085/data.json", 2));
      } catch {
        lhm = { cpu: null, gpu: null };
      }
    };

    let timer;
    const tick = async () => {
      await readLhm();
      try {
        const d = await ctx.api.systemInfo();
        if (!ctx.signal.aborted) update(d);
      } catch (e) {
        if (!built) grid.replaceChildren(el("div", { class: "widget-empty" }, "Infos indisponibles : " + e));
      }
      if (!ctx.signal.aborted) timer = setTimeout(tick, Math.max(1, o.refresh) * 1000);
    };
    tick();
    return { destroy: () => clearTimeout(timer) };
  },
};
