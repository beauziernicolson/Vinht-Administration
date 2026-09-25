// Éditeur de variantes produit du Merchant Center (Feature #5).
//
// Deux niveaux d'action, alignés sur le backend :
//  1. Structure des combinaisons  -> merchant_replace_product_variants_v1
//     Peut renvoyer un produit vérifié au statut `pending` pour un nouveau
//     contrôle. Le backend décide s'il reste visible (rejeté = hors ligne).
//  2. Stock / activation d'une combinaison existante
//     -> merchant_update_product_variant_inventory_v1  (aucune revalidation).
//
// Le frontend ne fabrique jamais de variantes "virtuelles" : la grille de
// combinaisons est un brouillon d'édition ; seules les lignes enregistrées via
// le backend deviennent des variantes réelles avec un variant_id.

import { getProductVariants, replaceProductVariants, updateVariantInventory } from "../services/merchantCenter.js";
import { showToast } from "./toast.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
const normKey = (s) => String(s || "").trim().toLowerCase();
const normVal = (s) => String(s || "").trim();
const comboKey = (opts) =>
  Object.keys(opts)
    .map(normKey)
    .sort()
    .map((k) => `${k}=${normVal(opts[k])}`)
    .join("|");

function parseValues(raw) {
  return [...new Set(String(raw || "").split(",").map((x) => x.trim()).filter(Boolean))];
}

function cartesian(groups) {
  // groups: [{name, values:[...]}, ...] -> [{name:value, ...}, ...]
  return groups.reduce(
    (acc, g) => {
      const out = [];
      acc.forEach((row) => g.values.forEach((v) => out.push({ ...row, [g.name]: v })));
      return out;
    },
    [{}]
  );
}

const mapErr = (err, fallback) => {
  const m = String((err && (err.message || err)) || "").toLowerCase();
  if (/authentication required|not-authenticated|jwt/.test(m)) return "Reconnectez-vous pour modifier les variantes.";
  if (/merchant account required|merchant-required/.test(m)) return "Compte marchand requis.";
  if (/not owned by merchant|product not found/.test(m)) return "Ce produit n'est pas rattaché à votre boutique.";
  if (/more than 100 variants/.test(m)) return "Un produit ne peut pas dépasser 100 variantes.";
  if (/requires a sku|variant-sku-required/.test(m)) return "Chaque variante doit avoir un SKU.";
  if (/sku cannot exceed 80/.test(m)) return "Un SKU de variante ne peut pas dépasser 80 caractères.";
  if (/duplicate variant sku/.test(m)) return "Deux variantes utilisent le même SKU.";
  if (/duplicate variant combination/.test(m)) return "Deux variantes ont la même combinaison d'options.";
  if (/same option names/.test(m)) return "Toutes les variantes doivent utiliser les mêmes noms d'options.";
  if (/between 1 and 3 options|options object|variant-options-required/.test(m))
    return "Chaque variante doit avoir entre 1 et 3 options renseignées.";
  if (/option names must contain 1 to 40/.test(m)) return "Un nom d'option doit faire 1 à 40 caractères.";
  if (/option values must contain 1 to 80/.test(m)) return "Une valeur d'option doit faire 1 à 80 caractères.";
  if (/stock must be zero or greater|stock-invalid/.test(m)) return "Le stock doit être un entier ≥ 0.";
  if (/variant not found for merchant/.test(m)) return "Cette variante est introuvable pour votre boutique.";
  return fallback;
};

export function renderProductVariantsEditor(host, product, { onChange } = {}) {
  if (!host || !product?.id) return;
  host.innerHTML = `<div style="font-size:12px;color:var(--muted,#6f7891)">Chargement des variantes…</div>`;

  let ctx = null;
  // Brouillon d'options : 3 lignes max (nom + valeurs).
  let optionRows = [
    { name: "", values: "" },
    { name: "", values: "" },
    { name: "", values: "" },
  ];
  // Grille de combinaisons courante : [{ id?, options:{}, sku, stock, is_active }]
  let grid = [];

  function seedFromContext() {
    const names = ctx.option_names.length
      ? ctx.option_names
      : [...new Set(ctx.variants.flatMap((v) => Object.keys(v.options)))];
    const valuesByName = {};
    names.forEach((n) => (valuesByName[n] = []));
    ctx.variants.forEach((v) =>
      names.forEach((n) => {
        const val = v.options[n];
        if (val != null && !valuesByName[n].includes(val)) valuesByName[n].push(val);
      })
    );
    optionRows = [0, 1, 2].map((i) => ({
      name: names[i] ? cap(names[i]) : "",
      values: names[i] ? (valuesByName[names[i]] || []).join(", ") : "",
    }));
    grid = ctx.variants.map((v) => ({
      id: v.id,
      options: { ...v.options },
      sku: v.sku,
      stock: v.stock,
      is_active: v.is_active,
    }));
  }

  function activeGroups() {
    return optionRows
      .map((r) => ({ name: normKey(r.name), display: r.name.trim(), values: parseValues(r.values) }))
      .filter((g) => g.name && g.values.length);
  }

  function regenerateGrid() {
    const groups = activeGroups();
    if (!groups.length) {
      grid = [];
      paint();
      return;
    }
    const prev = new Map(grid.map((row) => [comboKey(row.options), row]));
    const combos = cartesian(groups.map((g) => ({ name: g.name, values: g.values })));
    const skuBase = (product.sku || product.slug || "SKU").toString().toUpperCase().replace(/\s+/g, "-").slice(0, 30);
    grid = combos.map((options) => {
      const k = comboKey(options);
      const old = prev.get(k);
      if (old) return { ...old, options };
      const suffix = Object.values(options).join("-").toUpperCase().replace(/[^A-Z0-9]+/g, "-");
      return { options, sku: `${skuBase}-${suffix}`.slice(0, 80), stock: 0, is_active: true };
    });
    paint();
  }

  function readGridInputs() {
    host.querySelectorAll("[data-vrow]").forEach((tr) => {
      const i = Number(tr.dataset.vrow);
      if (!grid[i]) return;
      const sku = tr.querySelector("[data-v-sku]");
      const st = tr.querySelector("[data-v-stock]");
      const ac = tr.querySelector("[data-v-active]");
      if (sku) grid[i].sku = sku.value.trim();
      if (st) grid[i].stock = Math.max(0, parseInt(st.value, 10) || 0);
      if (ac) grid[i].is_active = ac.checked;
    });
  }

  async function saveStructure() {
    readGridInputs();
    const wasApproved = product.approval_status === "approved";
    const confirmMsg = wasApproved
      ? "Les modifications seront signalées à VinHT pour un nouveau contrôle. Le produit reste visible pendant le contrôle. Continuer ?"
      : "Enregistrer la structure des variantes de ce produit ?";
    if (!window.confirm(confirmMsg)) return;
    const btn = host.querySelector("[data-v-save-structure]");
    if (btn) { btn.disabled = true; btn.textContent = "Enregistrement…"; }
    setMsg("");
    try {
      const payload = grid.map((row, idx) => ({
        sku: row.sku,
        options: row.options,
        stock: row.stock,
        is_active: row.is_active,
        position: idx,
      }));
      const res = await replaceProductVariants(product.id, payload);
      if (res?.requires_review) {
        showToast("Variantes enregistrées — nouveau contrôle VinHT demandé.", "amber");
      } else {
        showToast("Structure des variantes enregistrée ✓");
      }
      if (typeof onChange === "function") onChange(res);
      await reload();
      if (res?.requires_review) {
        setMsg(
          "Statut « À vérifier ». Le produit reste visible pendant le contrôle, sauf s'il avait déjà été retiré par VinHT.",
          "amber"
        );
      }
    } catch (err) {
      console.warn("[VinHT] variantes structure:", err && (err.message || err));
      setMsg(mapErr(err, "Enregistrement de la structure impossible."));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Enregistrer la structure des variantes"; }
    }
  }

  async function removeAll() {
    const wasApproved = product.approval_status === "approved";
    if (
      !window.confirm(
        wasApproved
          ? "La suppression sera signalée à VinHT pour un nouveau contrôle. Le produit reste visible pendant le contrôle. Continuer ?"
          : "Supprimer toutes les variantes de ce produit ?"
      )
    )
      return;
    setMsg("");
    try {
      const res = await replaceProductVariants(product.id, []);
      showToast(res?.requires_review ? "Variantes supprimées — nouveau contrôle VinHT demandé." : "Variantes supprimées ✓", res?.requires_review ? "amber" : "blue");
      if (typeof onChange === "function") onChange(res);
      await reload();
    } catch (err) {
      console.warn("[VinHT] variantes suppression:", err && (err.message || err));
      setMsg(mapErr(err, "Suppression impossible."));
    }
  }

  async function saveRowInventory(i) {
    readGridInputs();
    const row = grid[i];
    if (!row || !row.id) return;
    const tr = host.querySelector(`[data-vrow="${i}"]`);
    const btn = tr && tr.querySelector("[data-v-row-save]");
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    setMsg("");
    try {
      const res = await updateVariantInventory(row.id, row.stock, row.is_active);
      grid[i].stock = res.stock;
      grid[i].is_active = res.is_active;
      showToast("Stock de la variante mis à jour ✓");
      if (typeof onChange === "function") onChange(res);
    } catch (err) {
      console.warn("[VinHT] variante inventaire:", err && (err.message || err));
      setMsg(mapErr(err, "Mise à jour du stock de la variante impossible."));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Enregistrer"; }
    }
  }

  function setMsg(text, tone) {
    const m = host.querySelector("[data-v-msg]");
    if (!m) return;
    m.textContent = text || "";
    m.style.color = tone === "amber" ? "var(--amber,#b26b00)" : "var(--red,#f31938)";
    m.style.display = text ? "" : "none";
  }

  async function reload() {
    try {
      ctx = await getProductVariants(product.id);
      seedFromContext();
      paint();
    } catch (err) {
      host.innerHTML = `<div style="font-size:12px;color:var(--red,#f31938)">${esc(
        mapErr(err, "Impossible de charger les variantes.")
      )}</div>`;
    }
  }

  function paint() {
    const groups = activeGroups();
    const optionInputs = optionRows
      .map(
        (r, i) => `<div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <input data-opt-name data-i="${i}" placeholder="Option ${i + 1} (ex : Taille)" value="${esc(r.name)}"
          style="flex:1 1 130px;min-width:0;padding:6px 8px;border:1px solid var(--line,#e7eaf2);border-radius:8px;font-size:12px">
        <input data-opt-values data-i="${i}" placeholder="Valeurs séparées par des virgules (ex : S, M, L)" value="${esc(r.values)}"
          style="flex:2 1 220px;min-width:0;padding:6px 8px;border:1px solid var(--line,#e7eaf2);border-radius:8px;font-size:12px">
      </div>`
      )
      .join("");

    const rowsHtml = grid.length
      ? grid
          .map((row, i) => {
            const optLabel = Object.entries(row.options)
              .map(([k, v]) => `${cap(k)} : ${esc(v)}`)
              .join(" · ");
            return `<tr data-vrow="${i}" style="border-top:1px solid var(--line,#e7eaf2)">
          <td style="padding:6px 8px;font-size:12px">${optLabel}${
              row.id ? "" : ` <span style="color:var(--blue,#0b2edc);font-size:10px;font-weight:800">NOUVEAU</span>`
            }</td>
          <td style="padding:6px 8px"><input data-v-sku value="${esc(row.sku)}" maxlength="80"
            style="width:150px;max-width:100%;padding:5px 7px;border:1px solid var(--line,#e7eaf2);border-radius:7px;font-size:12px"></td>
          <td style="padding:6px 8px"><input data-v-stock type="number" min="0" step="1" value="${esc(row.stock)}"
            style="width:74px;padding:5px 7px;border:1px solid var(--line,#e7eaf2);border-radius:7px;font-size:12px"></td>
          <td style="padding:6px 8px;text-align:center"><input data-v-active type="checkbox" ${row.is_active ? "checked" : ""}></td>
          <td style="padding:6px 8px">${
            row.id
              ? `<button class="btn btn-outline-blue" type="button" data-v-row-save style="padding:5px 10px;font-size:11px">Enregistrer</button>`
              : `<span style="font-size:11px;color:var(--muted,#6f7891)">via structure</span>`
          }</td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" style="padding:10px 8px;font-size:12px;color:var(--muted,#6f7891)">Aucune variante. Définissez des options puis « Générer les combinaisons ».</td></tr>`;

    const structureDirty = true; // le bouton structure reste dispo dès qu'il y a une grille
    host.innerHTML = `
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">Variantes</div>
      <p style="font-size:11px;color:var(--muted,#6f7891);margin:0 0 8px">
        Une variante est une combinaison vendable réelle (ex : « Rouge / M ») avec son propre SKU et son propre stock.
        Modifier la <strong>structure</strong> d'un produit vérifié demande un nouveau contrôle VinHT, sans le masquer
        s'il était publié. Modifier seulement le <strong>stock</strong> ne déclenche aucun nouveau contrôle.
      </p>
      ${optionInputs}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px">
        <button class="btn btn-outline-blue" type="button" data-v-generate style="padding:6px 12px;font-size:12px">Générer les combinaisons</button>
        ${groups.length ? `<span style="font-size:11px;color:var(--muted,#6f7891);align-self:center">${groups.reduce((n, g) => n * g.values.length, 1)} combinaison(s)</span>` : ""}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="text-align:left;color:var(--muted,#6f7891)">
            <th style="padding:4px 8px;font-weight:700">Combinaison</th>
            <th style="padding:4px 8px;font-weight:700">SKU</th>
            <th style="padding:4px 8px;font-weight:700">Stock</th>
            <th style="padding:4px 8px;font-weight:700">Actif</th>
            <th style="padding:4px 8px"></th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${structureDirty ? `<button class="btn btn-blue" type="button" data-v-save-structure style="padding:7px 14px;font-size:12px">Enregistrer la structure des variantes</button>` : ""}
        ${ctx && ctx.has_variants ? `<button class="btn btn-outline-red" type="button" data-v-remove-all style="padding:7px 14px;font-size:12px">Supprimer toutes les variantes</button>` : ""}
      </div>
      <div data-v-msg style="display:none;font-size:12px;margin-top:8px"></div>`;

    host.querySelectorAll("[data-opt-name]").forEach((inp) =>
      inp.addEventListener("input", () => {
        optionRows[Number(inp.dataset.i)].name = inp.value;
      })
    );
    host.querySelectorAll("[data-opt-values]").forEach((inp) =>
      inp.addEventListener("input", () => {
        optionRows[Number(inp.dataset.i)].values = inp.value;
      })
    );
    host.querySelector("[data-v-generate]")?.addEventListener("click", regenerateGrid);
    host.querySelector("[data-v-save-structure]")?.addEventListener("click", saveStructure);
    host.querySelector("[data-v-remove-all]")?.addEventListener("click", removeAll);
    host.querySelectorAll("[data-v-row-save]").forEach((b) =>
      b.addEventListener("click", (e) => saveRowInventory(Number(e.target.closest("[data-vrow]").dataset.vrow)))
    );
  }

  reload();
}

// Brouillon du parcours « Nouveau produit ». Il génère exactement le payload
// attendu par replaceProductVariants() ; aucune variante parallèle ou locale
// n'est persistée. L'appelant enregistre ce payload après avoir obtenu product.id.
export function renderNewProductVariantsBuilder(host, { skuBase = "SKU", suggestions = [], onChange } = {}) {
  if (!host) return { getVariants: () => [] };
  let enabled = false;
  let groups = [{ name: suggestions[0] || "", values: "" }];
  let rows = [];
  const notify = () => { if (typeof onChange === "function") onChange(api.getVariants()); };
  const generate = () => {
    const active = groups.map((g) => ({ name: normKey(g.name), values: parseValues(g.values) })).filter((g) => g.name && g.values.length);
    rows = active.length ? cartesian(active).map((options, position) => {
      const suffix = Object.values(options).join("-").toUpperCase().replace(/[^A-Z0-9]+/g, "-");
      return { options, sku: `${String(skuBase || "SKU").toUpperCase().replace(/\s+/g, "-")}-${suffix}`.slice(0, 80), stock: 0, is_active: true, position };
    }) : [];
    paint(); notify();
  };
  const readRows = () => host.querySelectorAll("[data-new-vrow]").forEach((tr) => {
    const row = rows[Number(tr.dataset.newVrow)]; if (!row) return;
    row.sku = tr.querySelector("[data-new-vsku]").value.trim();
    row.stock = Math.max(0, parseInt(tr.querySelector("[data-new-vstock]").value, 10) || 0);
    row.is_active = tr.querySelector("[data-new-vactive]").checked;
  });
  function paint() {
    host.innerHTML = `<div class="field" style="grid-column:1/-1"><label>Ce produit a des variantes ?</label><div class="toolbar-group"><button class="btn ${!enabled ? "btn-blue" : "btn-ghost"} btn-sm" type="button" data-new-vtoggle="no">Non</button><button class="btn ${enabled ? "btn-blue" : "btn-ghost"} btn-sm" type="button" data-new-vtoggle="yes">Oui</button></div></div>${enabled ? `<div style="grid-column:1/-1"><p class="muted" style="font-size:11px">Jusqu'à 3 groupes libres. Exemples : Taille, Couleur, Pointure, Stockage, RAM, Teinte ou Volume.</p>${groups.map((g,i)=>`<div class="toolbar-group" style="margin-bottom:7px"><input class="input" data-new-vname="${i}" placeholder="Nom du groupe" value="${esc(g.name)}"><input class="input" data-new-vvalues="${i}" placeholder="Valeurs séparées par des virgules" value="${esc(g.values)}">${groups.length>1?`<button class="btn btn-ghost btn-sm" data-new-vremove="${i}" type="button">Retirer</button>`:""}</div>`).join("")}<div class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" data-new-vadd ${groups.length>=3?"disabled":""}>Ajouter un groupe</button><button class="btn btn-outline-blue btn-sm" type="button" data-new-vgenerate>Générer les combinaisons</button><span class="muted">${rows.length} combinaison(s)</span></div>${rows.length?`<div class="table-wrap" style="margin-top:8px"><table class="data-table"><thead><tr><th>Combinaison</th><th>SKU</th><th>Stock</th><th>Active</th></tr></thead><tbody>${rows.map((r,i)=>`<tr data-new-vrow="${i}"><td>${Object.entries(r.options).map(([k,v])=>`${esc(cap(k))} : ${esc(v)}`).join(" · ")}</td><td><input class="input" data-new-vsku value="${esc(r.sku)}" maxlength="80"></td><td><input class="input" data-new-vstock type="number" min="0" value="${esc(r.stock)}" style="width:88px"></td><td><input data-new-vactive type="checkbox" ${r.is_active?"checked":""}></td></tr>`).join("")}</tbody></table></div>`:""}</div>` : ""}`;
    host.querySelectorAll("[data-new-vtoggle]").forEach((b)=>b.onclick=()=>{enabled=b.dataset.newVtoggle==="yes";if(!enabled)rows=[];paint();notify();});
    host.querySelectorAll("[data-new-vname]").forEach((i)=>i.oninput=()=>{groups[Number(i.dataset.newVname)].name=i.value;});
    host.querySelectorAll("[data-new-vvalues]").forEach((i)=>i.oninput=()=>{groups[Number(i.dataset.newVvalues)].values=i.value;});
    host.querySelector("[data-new-vadd]")?.addEventListener("click",()=>{if(groups.length<3){groups.push({name:suggestions[groups.length]||"",values:""});paint();}});
    host.querySelectorAll("[data-new-vremove]").forEach((b)=>b.onclick=()=>{groups.splice(Number(b.dataset.newVremove),1);rows=[];paint();notify();});
    host.querySelector("[data-new-vgenerate]")?.addEventListener("click",generate);
    host.querySelectorAll("[data-new-vrow] input").forEach((i)=>i.addEventListener("change",()=>{readRows();notify();}));
  }
  const api = { getVariants: () => { readRows(); return enabled ? rows.map((r,i)=>({...r,position:i})) : []; }, isEnabled: () => enabled };
  paint(); return api;
}
