import { el } from "../util.js";
import { LOCATION_DEFAULT, resolveLocation } from "./location.js";
import { weatherIcon, weatherLabel } from "./weather-icons.js";

const DETAILS = [
  ["feels", "Ressenti"],
  ["humidity", "Humidité"],
  ["wind", "Vent"],
  ["precip", "Risque de pluie"],
  ["uv", "Indice UV"],
  ["pressure", "Pression"],
];
const CARDINAL = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export default {
  type: "weather",
  name: "Météo",
  description: "Conditions actuelles et prévisions (Open-Meteo), pour votre position ou une ville.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path d="M8.5 20h9a3.5 3.5 0 0 0 .4-6.97A5 5 0 0 0 8.4 12.4 3.8 3.8 0 0 0 8.5 20z"/></svg>`,
  size: { w: 12, h: 12 },
  minSize: { w: 4, h: 3 },
  options: [
    { key: "location", label: "Lieu", type: "location", default: LOCATION_DEFAULT },
    { key: "label", label: "Nom affiché", type: "text", default: "", hint: "Vide = nom du lieu" },
    { key: "units", label: "Unité", type: "select", default: "celsius", choices: [["celsius", "Degrés Celsius (°C)"], ["fahrenheit", "Degrés Fahrenheit (°F)"]] },
    { key: "details", label: "Détails", type: "checklist", default: ["feels", "humidity", "wind", "precip"], choices: DETAILS },
    { key: "hours", label: "Prévisions heure par heure", type: "number", default: 6, min: 0, max: 24, hint: "Nombre d'heures (0 = masquer)" },
    { key: "days", label: "Prévisions sur plusieurs jours", type: "number", default: 5, min: 0, max: 7, hint: "Nombre de jours (0 = masquer)" },
    { key: "refresh", label: "Actualisation (min)", type: "number", default: 20, min: 5, max: 360 },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: "weather" });
    body.append(root);
    const has = (k) => (o.details || []).includes(k);
    const unit = o.units === "fahrenheit" ? "°F" : "°";
    const t = (v) => (v == null ? "–" : `${nf0.format(v)}${unit}`);
    let timer;

    const render = (place, w) => {
      const c = w.current;
      const h = w.hourly;
      const d = w.daily;
      const night = c.is_day === 0;
      const today = 0;
      const head = el(
        "div",
        { class: "wx-now" },
        el("div", { class: "wx-icon", html: weatherIcon(c.weather_code, night) }),
        el(
          "div",
          { class: "wx-main" },
          el("div", { class: "wx-place" }, o.label || place.name || "Météo"),
          el("div", { class: "wx-temp" }, t(c.temperature_2m)),
          el("div", { class: "wx-desc" }, weatherLabel(c.weather_code)),
          d ? el("div", { class: "wx-minmax" }, `↑ ${t(d.temperature_2m_max[today])}  ↓ ${t(d.temperature_2m_min[today])}`) : null,
        ),
      );
      const det = [];
      if (has("feels")) det.push(["Ressenti", t(c.apparent_temperature)]);
      if (has("humidity")) det.push(["Humidité", `${nf0.format(c.relative_humidity_2m)} %`]);
      if (has("wind"))
        det.push([
          "Vent",
          el(
            "span",
            {},
            el("span", { class: "wx-arrow", style: { transform: `rotate(${(c.wind_direction_10m + 180) % 360}deg)` } }, "↑"),
            ` ${nf0.format(c.wind_speed_10m)} km/h ${CARDINAL[Math.round(c.wind_direction_10m / 45) % 8]}`,
          ),
        ]);
      if (has("precip") && d) det.push(["Pluie", `${nf0.format(d.precipitation_probability_max[today] ?? 0)} %`]);
      if (has("uv") && d) det.push(["UV", nf0.format(d.uv_index_max[today] ?? 0)]);
      if (has("pressure")) det.push(["Pression", `${nf0.format(c.pressure_msl)} hPa`]);
      const details = det.length ? el("div", { class: "wx-details" }, ...det.map(([k, v]) => el("div", { class: "wx-det" }, el("span", { class: "wx-k" }, k), el("span", { class: "wx-v" }, v)))) : null;

      let hours = null;
      if (o.hours > 0 && h) {
        let i0 = h.time.findIndex((x) => x >= c.time.slice(0, 13));
        if (i0 < 0) i0 = 0;
        const cells = [];
        for (let i = i0 + 1; i <= i0 + o.hours && i < h.time.length; i++) {
          cells.push(
            el(
              "div",
              { class: "wx-hour" },
              el("div", { class: "wx-h" }, `${h.time[i].slice(11, 13)} h`),
              el("div", { class: "wx-hicon", html: weatherIcon(h.weather_code[i], h.is_day?.[i] === 0) }),
              el("div", { class: "wx-ht" }, t(h.temperature_2m[i])),
              h.precipitation_probability?.[i] >= 20 ? el("div", { class: "wx-hp" }, `${h.precipitation_probability[i]} %`) : el("div", { class: "wx-hp" }, " "),
            ),
          );
        }
        hours = el("div", { class: "wx-hours" }, ...cells);
      }

      let days = null;
      if (o.days > 0 && d) {
        const n = Math.min(o.days, d.time.length);
        const lo = Math.min(...d.temperature_2m_min.slice(0, n));
        const hi = Math.max(...d.temperature_2m_max.slice(0, n));
        const span = Math.max(1, hi - lo);
        const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
        days = el(
          "div",
          { class: "wx-days" },
          ...d.time.slice(0, n).map((day, i) => {
            const [y, m, dd] = day.split("-").map(Number);
            const name = i === 0 ? "Auj." : fmt.format(new Date(y, m - 1, dd)).replace(".", "");
            const a = ((d.temperature_2m_min[i] - lo) / span) * 100;
            const b = ((d.temperature_2m_max[i] - lo) / span) * 100;
            return el(
              "div",
              { class: "wx-day" },
              el("span", { class: "wx-dn" }, name.charAt(0).toUpperCase() + name.slice(1)),
              el("span", { class: "wx-dicon", html: weatherIcon(d.weather_code[i]) }),
              el("span", { class: "wx-dp" }, d.precipitation_probability_max[i] >= 20 ? `${d.precipitation_probability_max[i]} %` : ""),
              el("span", { class: "wx-dmin" }, t(d.temperature_2m_min[i])),
              el("span", { class: "wx-range" }, el("span", { class: "wx-range-fill", style: { left: `${a}%`, width: `${Math.max(4, b - a)}%` } })),
              el("span", { class: "wx-dmax" }, t(d.temperature_2m_max[i])),
            );
          }),
        );
      }
      root.replaceChildren(...[head, details, hours, days].filter(Boolean));
    };

    const refresh = async () => {
      try {
        const place = await resolveLocation(o.location, ctx.api);
        const q = new URLSearchParams({
          latitude: place.lat.toFixed(3),
          longitude: place.lon.toFixed(3),
          current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl",
          hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
          daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max",
          timezone: "auto",
          forecast_days: "8",
          wind_speed_unit: "kmh",
          temperature_unit: o.units === "fahrenheit" ? "fahrenheit" : "celsius",
        });
        const w = await ctx.api.httpJson(`https://api.open-meteo.com/v1/forecast?${q}`, 10 * 60);
        if (ctx.signal.aborted) return;
        if (w?.error) throw new Error(w.reason || "réponse invalide");
        render(place, w);
      } catch (e) {
        if (!root.querySelector(".wx-now")) root.replaceChildren(el("div", { class: "widget-empty" }, "Météo indisponible : " + (e.message || e)));
      }
    };
    root.append(el("div", { class: "widget-empty" }, "Chargement de la météo…"));
    refresh();
    timer = setInterval(refresh, Math.max(5, o.refresh) * 60 * 1000);
    return { destroy: () => clearInterval(timer) };
  },
};
