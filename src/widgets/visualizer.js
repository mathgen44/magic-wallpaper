import { el } from "../util.js";

export default {
  type: "visualizer",
  name: "Visualiseur audio",
  description: "Spectre animé du son joué par le PC (musique, vidéos…).",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 8v8"/></svg>`,
  size: { w: 20, h: 6 },
  minSize: { w: 3, h: 2 },
  options: [
    { key: "style", label: "Style", type: "select", default: "bars", choices: [["bars", "Barres"], ["mirror", "Barres en miroir"], ["wave", "Courbe"], ["circle", "Cercle"]] },
    { key: "bars", label: "Nombre de barres", type: "range", default: 48, min: 8, max: 64, step: 1 },
    { key: "color", label: "Couleurs", type: "select", default: "gradient", choices: [["gradient", "Dégradé du thème"], ["accent", "Couleur d'accent"], ["text", "Couleur du texte"]] },
    { key: "sensitivity", label: "Sensibilité", type: "range", default: 1, min: 0.4, max: 2.5, step: 0.05 },
    { key: "smoothing", label: "Lissage", type: "range", default: 0.55, min: 0, max: 0.9, step: 0.05 },
    { key: "peaks", label: "Crêtes", type: "toggle", default: true, showIf: (o) => o.style === "bars" },
    { key: "gap", label: "Espacement des barres", type: "range", default: 0.3, min: 0, max: 0.8, step: 0.05, showIf: (o) => o.style !== "wave" },
  ],
  mount(body, o, ctx) {
    const canvas = el("canvas", { class: "viz" });
    body.append(canvas);
    const g = canvas.getContext("2d");
    const n = Math.round(o.bars);
    const cur = new Float32Array(n);
    const peaks = new Float32Array(n);
    let target = new Float32Array(n);
    let lastData = 0;
    let raf = 0;
    let unlisten = null;
    let colors = { a: "#6f8bff", b: "#c86fff", fg: "#fff" };

    const readColors = () => {
      const cs = getComputedStyle(body);
      const pick = (v, d) => cs.getPropertyValue(v).trim() || d;
      const accent = pick("--w-accent", "") || pick("--accent", "#6f8bff");
      colors = { a: accent.startsWith("var(") ? pick("--accent", "#6f8bff") : accent, b: pick("--accent2", "#c86fff"), fg: pick("--fg", "#fff") };
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      readColors();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // 64 bandes reçues → n barres
    const resample = (bands) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * bands.length;
        const b = ((i + 1) / n) * bands.length;
        let s = 0;
        let c = 0;
        for (let k = Math.floor(a); k < Math.max(Math.floor(a) + 1, Math.ceil(b)); k++) {
          s += bands[Math.min(bands.length - 1, k)];
          c++;
        }
        out[i] = Math.min(1, (s / c) * o.sensitivity);
      }
      return out;
    };

    const fill = (x0, y0, x1, y1) => {
      if (o.color === "accent") return colors.a;
      if (o.color === "text") return colors.fg;
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, colors.a);
      grad.addColorStop(1, colors.b);
      return grad;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      const k = 1 - o.smoothing;
      let energy = 0;
      for (let i = 0; i < n; i++) {
        const t = performance.now() - lastData > 600 ? 0 : target[i];
        cur[i] += (t - cur[i]) * (t > cur[i] ? Math.min(1, k * 1.6) : k * 0.6);
        peaks[i] = Math.max(cur[i], peaks[i] - 0.008);
        energy += cur[i] + peaks[i];
      }
      g.clearRect(0, 0, W, H);
      if (energy < 0.001 && performance.now() - lastData > 1500) {
        // silence : ligne de repos, puis pause de l'animation
        g.globalAlpha = 0.35;
        g.fillStyle = fill(0, 0, W, 0);
        if (o.style === "circle") {
          g.beginPath();
          g.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, Math.PI * 2);
          g.lineWidth = Math.max(1, H * 0.01);
          g.strokeStyle = g.fillStyle;
          g.stroke();
        } else g.fillRect(0, o.style === "mirror" || o.style === "wave" ? H / 2 - 1 : H - 2, W, 2);
        g.globalAlpha = 1;
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      const slot = W / n;
      const bw = Math.max(1, slot * (1 - o.gap));
      if (o.style === "bars" || o.style === "mirror") {
        g.fillStyle = fill(0, H, 0, 0);
        for (let i = 0; i < n; i++) {
          const x = i * slot + (slot - bw) / 2;
          const h = Math.max(2, cur[i] * H * (o.style === "mirror" ? 1 : 0.96));
          if (o.style === "bars") g.fillRect(x, H - h, bw, h);
          else g.fillRect(x, (H - h) / 2, bw, h);
          if (o.peaks && o.style === "bars") g.fillRect(x, H - peaks[i] * H * 0.96 - 3, bw, 2);
        }
      } else if (o.style === "wave") {
        g.beginPath();
        g.moveTo(0, H);
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) * slot;
          const y = H - cur[i] * H * 0.95;
          const px = (i - 0.5) * slot;
          const py = i ? H - cur[i - 1] * H * 0.95 : H;
          g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
        g.lineTo(W, H);
        g.closePath();
        g.globalAlpha = 0.45;
        g.fillStyle = fill(0, H, 0, 0);
        g.fill();
        g.globalAlpha = 1;
        g.lineWidth = Math.max(1.5, H * 0.012);
        g.strokeStyle = fill(0, 0, W, 0);
        g.stroke();
      } else {
        const cx = W / 2;
        const cy = H / 2;
        const r0 = Math.min(W, H) * 0.22;
        const len = Math.min(W, H) * 0.26;
        g.lineCap = "round";
        g.lineWidth = Math.max(1.5, ((2 * Math.PI * r0) / n) * (1 - o.gap));
        g.strokeStyle = fill(cx - r0, cy - r0, cx + r0, cy + r0);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          const l = 2 + cur[i] * len;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.lineTo(cx + Math.cos(a) * (r0 + l), cy + Math.sin(a) * (r0 + l));
          g.stroke();
        }
      }
    };

    ctx.api.onAudioSpectrum((bands) => {
      target = resample(bands);
      lastData = performance.now();
      if (!raf && target.some((v) => v > 0.01)) raf = requestAnimationFrame(draw);
    }).then((u) => {
      if (ctx.signal.aborted) u?.();
      else unlisten = u;
    });
    const keep = () => ctx.api.audioKeepalive().catch(() => {});
    keep();
    const ka = setInterval(keep, 2000);
    resize();
    raf = requestAnimationFrame(draw);
    return {
      destroy() {
        clearInterval(ka);
        cancelAnimationFrame(raf);
        ro.disconnect();
        unlisten?.();
      },
    };
  },
};
