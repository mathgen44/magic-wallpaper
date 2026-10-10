// Champ d'édition du lanceur : catégories, classement des applications, favoris,
// applications ajoutées à la main.
import { api } from "../api.js";
import { clone, el, uid } from "../util.js";
import { allApps, catIcon, categoryOf, isDefaultCat, launcherConfig, newCategory } from "../widgets/launcher-data.js";

const SOURCES = { steam: "Steam", epic: "Epic", custom: "Ajoutée" };

export function launcherControl(value, emit, id) {
  let cfg = launcherConfig(value);
  let detected = null;
  let filter = "all";
  let query = "";
  const commit = () => emit(clone(cfg));

  const node = el("div", { class: "lf", id });
  const catsBox = el("div", { class: "lf-cats" });
  const listBox = el("div", { class: "lf-list" });
  const search = el("input", { type: "text", placeholder: "Rechercher une application…", spellcheck: false });
  const filterSel = el("select", {});
  const status = el("div", { class: "muted small" });
  const refresh = el("button", { class: "btn", title: "Relancer la détection des applications installées" }, "Actualiser");

  // ---- Catégories -------------------------------------------------------
  const renderCats = () => {
    catsBox.replaceChildren(
      ...cfg.cats.map((c, i) => {
        const vis = el("input", { type: "checkbox", checked: c.visible !== false, title: "Afficher cette catégorie" });
        vis.addEventListener("change", () => {
          c.visible = vis.checked;
          commit();
        });
        const name = el("input", { type: "text", value: c.label, "aria-label": "Nom de la catégorie" });
        name.addEventListener("change", () => {
          c.label = name.value.trim() || c.label;
          commit();
          renderList();
        });
        const color = el("input", { type: "color", value: c.color, title: "Couleur" });
        color.addEventListener("change", () => {
          c.color = color.value;
          commit();
        });
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= cfg.cats.length) return;
          [cfg.cats[i], cfg.cats[j]] = [cfg.cats[j], cfg.cats[i]];
          commit();
          renderCats();
        };
        const del = isDefaultCat(c.key)
          ? null
          : el("button", {
              class: "btn-icon danger-text",
              title: "Supprimer la catégorie (ses applications retournent dans leur catégorie d'origine)",
              onclick: () => {
                cfg.cats.splice(i, 1);
                for (const [k, v] of Object.entries(cfg.assign)) if (v === c.key) delete cfg.assign[k];
                commit();
                renderAll();
              },
            }, "×");
        return el(
          "div",
          { class: "lf-cat" },
          vis,
          el("span", { class: "lf-cat-ico", html: catIcon(c.key), style: { color: c.color } }),
          name,
          color,
          el("button", { class: "btn-icon", title: "Monter", onclick: () => move(-1) }, "↑"),
          el("button", { class: "btn-icon", title: "Descendre", onclick: () => move(1) }, "↓"),
          del,
        );
      }),
      el("div", { class: "insp-actions" }, el("button", { class: "btn", onclick: () => { cfg.cats.push(newCategory(cfg)); commit(); renderAll(); } }, "+ Catégorie")),
    );
  };

  // ---- Applications -------------------------------------------------------
  const catOptions = (sel) => [
    ...cfg.cats.filter((c) => c.key !== "favorites").map((c) => el("option", { value: c.key, selected: c.key === sel }, c.label)),
    el("option", { value: "hidden", selected: sel === "hidden" }, "— Masquée —"),
  ];

  const renderFilter = () => {
    const v = filter;
    filterSel.replaceChildren(
      el("option", { value: "all" }, "Toutes les catégories"),
      ...cfg.cats.map((c) => el("option", { value: c.key }, c.label)),
      el("option", { value: "hidden" }, "Masquées"),
      el("option", { value: "custom" }, "Ajoutées à la main"),
    );
    filterSel.value = v;
  };

  const renderList = () => {
    if (!detected) {
      listBox.replaceChildren(el("div", { class: "muted small" }, "Recherche des applications installées…"));
      return;
    }
    const apps = allApps(detected, cfg);
    const q = query.toLowerCase();
    const shown = apps
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .filter((a) => {
        if (filter === "all") return true;
        if (filter === "custom") return a.source === "custom";
        if (filter === "favorites") return cfg.favorites.includes(a.id);
        return categoryOf(a, cfg) === filter;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    status.textContent = `${apps.length} applications détectées ou ajoutées · ${shown.length} affichée${shown.length > 1 ? "s" : ""}`;
    listBox.replaceChildren(
      ...shown.slice(0, 300).map((a) => {
        const fav = cfg.favorites.includes(a.id);
        const star = el("button", { class: `btn-icon lf-star${fav ? " on" : ""}`, title: fav ? "Retirer des favoris" : "Ajouter aux favoris" }, fav ? "★" : "☆");
        star.addEventListener("click", () => {
          cfg.favorites = fav ? cfg.favorites.filter((x) => x !== a.id) : [...cfg.favorites, a.id];
          commit();
          renderList();
        });
        const sel = el("select", { class: "lf-sel" }, ...catOptions(categoryOf(a, cfg)));
        sel.addEventListener("change", () => {
          if (a.source === "custom") {
            const c = cfg.custom.find((x) => x.id === a.id);
            if (sel.value === "hidden") cfg.assign[a.id] = "hidden";
            else {
              delete cfg.assign[a.id];
              c.cat = sel.value;
            }
          } else if (sel.value === a.category) delete cfg.assign[a.id];
          else cfg.assign[a.id] = sel.value;
          commit();
          renderList();
        });
        const src = a.icon || (a.icon_path ? api.fileSrc(a.icon_path) : "");
        const del =
          a.source === "custom"
            ? el("button", {
                class: "btn-icon danger-text",
                title: "Supprimer",
                onclick: () => {
                  cfg.custom = cfg.custom.filter((x) => x.id !== a.id);
                  cfg.favorites = cfg.favorites.filter((x) => x !== a.id);
                  delete cfg.assign[a.id];
                  commit();
                  renderList();
                },
              }, "×")
            : null;
        return el(
          "div",
          { class: "lf-app" },
          src ? el("img", { class: "lf-ico", src, alt: "" }) : el("span", { class: "lf-ico lf-ico-empty" }, a.name.charAt(0)),
          el("span", { class: "lf-name", title: a.name }, a.name, SOURCES[a.source] ? el("span", { class: "lf-src" }, SOURCES[a.source]) : null),
          star,
          sel,
          del,
        );
      }),
      shown.length > 300 ? el("div", { class: "muted small" }, "Affinez la recherche pour voir les autres applications.") : null,
      shown.length ? null : el("div", { class: "muted small" }, "Aucune application."),
    );
  };

  // ---- Ajout manuel -------------------------------------------------------
  const addName = el("input", { type: "text", placeholder: "Nom" });
  const addTarget = el("input", { type: "text", placeholder: "Programme, raccourci ou adresse (https://, steam://…)", spellcheck: false });
  const addCat = el("select", {});
  const renderAddCat = () => addCat.replaceChildren(...catOptions("other").slice(0, -1));
  const browse = el("button", { class: "btn" }, "Parcourir…");
  browse.addEventListener("click", async () => {
    const p = await api.pickProgram();
    if (!p) return;
    addTarget.value = p;
    if (!addName.value) addName.value = p.split(/[\\/]/).pop().replace(/\.(exe|lnk|url|bat|cmd)$/i, "");
  });
  const add = el("button", { class: "btn" }, "Ajouter");
  add.addEventListener("click", () => {
    const target = addTarget.value.trim();
    if (!target) return addTarget.focus();
    const name = addName.value.trim() || target.split(/[\\/]/).pop();
    cfg.custom.push({ id: "custom:" + uid(), name, target, cat: addCat.value });
    addName.value = "";
    addTarget.value = "";
    commit();
    renderList();
  });

  const renderAll = () => {
    renderCats();
    renderFilter();
    renderAddCat();
    renderList();
  };

  search.addEventListener("input", () => {
    query = search.value;
    renderList();
  });
  filterSel.addEventListener("change", () => {
    filter = filterSel.value;
    renderList();
  });
  const load = async (force) => {
    detected = null;
    renderList();
    try {
      detected = await api.listApps(force);
    } catch (e) {
      detected = [];
      status.textContent = "Détection impossible : " + e;
    }
    renderList();
  };
  refresh.addEventListener("click", () => load(true));

  node.append(
    el("div", { class: "lf-title" }, "Catégories"),
    el("p", { class: "muted small" }, "Cochez celles à afficher, renommez-les, changez leur couleur ou leur ordre."),
    catsBox,
    el("div", { class: "lf-title" }, "Applications"),
    el("p", { class: "muted small" }, "La catégorie est devinée automatiquement ; changez-la ici, masquez une application ou ajoutez-la aux favoris (★)."),
    el("div", { class: "lf-tools" }, search, filterSel, refresh),
    status,
    listBox,
    el("div", { class: "lf-title" }, "Ajouter une application"),
    el("div", { class: "lf-add" }, addName, el("div", { class: "picker" }, addTarget, browse), el("div", { class: "lf-add-row" }, addCat, add)),
  );
  renderAll();
  load(false);

  return {
    node,
    set(v) {
      const next = launcherConfig(v);
      if (JSON.stringify(next) !== JSON.stringify(cfg)) {
        cfg = next;
        renderAll();
      }
    },
  };
}
