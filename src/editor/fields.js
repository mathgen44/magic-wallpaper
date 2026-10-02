// Générateur de formulaires à partir des descriptions de champs des briques.
import { api } from "../api.js";
import { el } from "../util.js";
import { searchPlaces } from "../widgets/location.js";

let seq = 0;

/**
 * Construit un formulaire.
 * @param defs     liste de champs ({ key, label, type, … })
 * @param values   objet de valeurs courant (lu à la construction et par showIf)
 * @param onChange (key, value, { live }) — live=true pendant la frappe / le glissement
 * @returns { node, refresh(values) }
 */
export function buildForm(defs, values, onChange) {
  const rows = [];
  const node = el("div", { class: "form" });
  for (const def of defs) {
    const id = `f${++seq}`;
    const input = control(def, values[def.key], (v, live = false) => onChange(def.key, v, { live }), id);
    const row = el(
      "div",
      { class: `field field-${def.type}` },
      def.type === "toggle" ? null : el("label", { class: "field-label", for: id }, def.label),
      input.node,
      def.hint && el("div", { class: "field-hint" }, def.hint),
    );
    rows.push({ def, row, input });
    node.append(row);
  }
  const refresh = (vals) => {
    for (const { def, row, input } of rows) {
      row.hidden = def.showIf ? !def.showIf(vals) : false;
      input.set?.(vals[def.key]);
    }
  };
  refresh(values);
  return { node, refresh };
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

const notFocused = (n) => document.activeElement !== n;

function control(def, value, emit, id) {
  switch (def.type) {
    case "toggle": {
      const cb = el("input", { type: "checkbox", id, checked: !!value });
      cb.addEventListener("change", () => emit(cb.checked));
      return {
        node: el("label", { class: "toggle", for: id }, cb, el("span", { class: "toggle-ui" }), el("span", {}, def.label)),
        set: (v) => (cb.checked = !!v),
      };
    }
    case "select": {
      const s = el("select", { id }, ...def.choices.map(([v, l]) => el("option", { value: v }, l)));
      s.value = value;
      s.addEventListener("change", () => emit(s.value));
      return { node: s, set: (v) => notFocused(s) && (s.value = v) };
    }
    case "number": {
      const n = el("input", { type: "number", id, min: def.min, max: def.max, step: def.step || 1, value });
      const commit = () => {
        let v = parseFloat(n.value);
        if (Number.isNaN(v)) return;
        if (def.min != null) v = Math.max(def.min, v);
        if (def.max != null) v = Math.min(def.max, v);
        emit(v);
      };
      n.addEventListener("input", debounce(commit, 500));
      n.addEventListener("change", commit);
      return { node: n, set: (v) => notFocused(n) && (n.value = v) };
    }
    case "range": {
      const r = el("input", { type: "range", id, min: def.min, max: def.max, step: def.step || 1, value });
      const out = el("output", {}, fmt(value));
      r.addEventListener("input", () => {
        out.textContent = fmt(r.value);
        emit(parseFloat(r.value), true);
      });
      r.addEventListener("change", () => emit(parseFloat(r.value)));
      return {
        node: el("div", { class: "range" }, r, out),
        set: (v) => {
          if (notFocused(r)) r.value = v;
          out.textContent = fmt(v);
        },
      };
    }
    case "color": {
      const c = el("input", { type: "color", id, value: value || "#000000" });
      const t = el("input", { type: "text", class: "hex", value: value || "", spellcheck: false, placeholder: def.placeholder || "" });
      c.addEventListener("input", () => {
        t.value = c.value;
        emit(c.value, true);
      });
      c.addEventListener("change", () => emit(c.value));
      t.addEventListener("change", () => {
        if (/^#[0-9a-f]{6}$/i.test(t.value)) c.value = t.value;
        emit(t.value.trim());
      });
      const reset = def.resettable
        ? el("button", { class: "btn-icon", title: "Utiliser la couleur du thème", onclick: () => { t.value = ""; emit(""); } }, "↺")
        : null;
      return {
        node: el("div", { class: "color" }, c, t, reset),
        set: (v) => {
          if (notFocused(t)) t.value = v || "";
          if (/^#[0-9a-f]{6}$/i.test(v || "")) c.value = v;
        },
      };
    }
    case "textarea":
    case "list": {
      const isList = def.type === "list";
      const toText = (v) => (isList ? (v || []).join("\n") : v ?? "");
      const parse = () => (isList ? ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : ta.value);
      const ta = el("textarea", { id, rows: isList ? 4 : 3, spellcheck: !isList });
      ta.value = toText(value);
      ta.addEventListener("input", debounce(() => emit(parse()), 700));
      ta.addEventListener("change", () => emit(parse()));
      return { node: ta, set: (v) => notFocused(ta) && (ta.value = toText(v)) };
    }
    case "checklist": {
      const current = new Set(value || []);
      const boxes = def.choices.map(([v, l]) => {
        const cb = el("input", { type: "checkbox", checked: current.has(v) });
        cb.addEventListener("change", () => {
          // conserve l'ordre déclaré
          emit(def.choices.map(([k]) => k).filter((k, i) => boxes[i].cb.checked));
        });
        return { cb, node: el("label", { class: "check" }, cb, l) };
      });
      return {
        node: el("div", { class: "checklist", id }, ...boxes.map((b) => b.node)),
        set: (vals) => boxes.forEach((b, i) => (b.cb.checked = (vals || []).includes(def.choices[i][0]))),
      };
    }
    case "location": {
      let cur = value || { mode: "auto" };
      const mode = el("select", { id }, el("option", { value: "auto" }, "Automatique (selon la connexion internet)"), el("option", { value: "city" }, "Choisir une ville…"));
      const q = el("input", { type: "text", placeholder: "Nom de la ville", spellcheck: false });
      const go = el("button", { class: "btn" }, "Rechercher");
      const results = el("div", { class: "loc-results" });
      const box = el("div", { class: "loc-search" }, el("div", { class: "picker" }, q, go), results);
      const current = el("div", { class: "field-hint" });
      const sync = () => {
        mode.value = cur.mode === "city" ? "city" : "auto";
        box.hidden = mode.value !== "city";
        current.textContent = mode.value === "city" ? (cur.name ? `Lieu choisi : ${cur.name}` : "Recherchez puis choisissez une ville.") : "Position approximative déduite de l'adresse IP.";
      };
      mode.addEventListener("change", () => {
        cur = mode.value === "auto" ? { mode: "auto" } : { ...cur, mode: "city" };
        sync();
        if (cur.mode === "auto" || Number.isFinite(cur.lat)) emit(cur);
      });
      const search = async () => {
        const text = q.value.trim();
        if (!text) return;
        results.replaceChildren(el("div", { class: "muted small" }, "Recherche…"));
        try {
          const list = await searchPlaces(text, api);
          results.replaceChildren(
            ...(list.length
              ? list.map((p) => el("button", { class: "loc-item", onclick: () => { cur = p; results.replaceChildren(); q.value = ""; sync(); emit(cur); } }, p.name))
              : [el("div", { class: "muted small" }, "Aucun résultat.")]),
          );
        } catch (e) {
          results.replaceChildren(el("div", { class: "muted small" }, "Recherche impossible : " + e));
        }
      };
      go.addEventListener("click", search);
      q.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), search()));
      sync();
      return {
        node: el("div", { class: "loc" }, mode, box, current),
        set: (v) => {
          if (JSON.stringify(v || { mode: "auto" }) !== JSON.stringify(cur)) {
            cur = v || { mode: "auto" };
            sync();
          }
        },
      };
    }
    case "folder":
    case "image": {
      const t = el("input", { type: "text", id, value: value || "", placeholder: def.type === "folder" ? "C:\\Users\\…\\Images" : "Fichier ou URL" });
      t.addEventListener("change", () => emit(t.value.trim()));
      const b = el("button", {
        class: "btn",
        onclick: async () => {
          const p = def.type === "folder" ? await api.pickFolder() : await api.pickImage();
          if (p) {
            t.value = p;
            emit(p);
          }
        },
      }, "Parcourir…");
      return { node: el("div", { class: "picker" }, t, b), set: (v) => notFocused(t) && (t.value = v || "") };
    }
    default: {
      const t = el("input", { type: "text", id, value: value ?? "", placeholder: def.placeholder || "" });
      t.addEventListener("input", debounce(() => emit(t.value), 600));
      t.addEventListener("change", () => emit(t.value));
      return { node: t, set: (v) => notFocused(t) && (t.value = v ?? "") };
    }
  }
}

function fmt(v) {
  const n = parseFloat(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
