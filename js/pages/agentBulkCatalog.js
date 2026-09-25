import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "../ui/toast.js";
import { agentListMerchantProducts, agentErrorMessageFr } from "../services/agentCenter.js";
import {
  agentPreviewBulkCatalogImport, agentCommitBulkCatalogImport,
  agentPreviewBulkInventory, agentCommitBulkInventory,
  agentPreviewBulkCatalogStatus, agentCommitBulkCatalogStatus,
  bulkCatalogErrorMessageFr, generateIdempotencyKey, bulkMaxRows,
} from "../services/bulkCatalog.js";
import { parseTabularFile, isXlsxSupportAvailable } from "../services/fileParsing.js";

// Feature #37 — Centre Agent : Catalogue en masse (import / stock / archive-
// restauration). Module merchant-scope, appelé uniquement pour le marchand
// actuellement sélectionné dans le Centre Agent. Aucune IA, aucune finance,
// aucun hard-delete : ce module ne fait qu'appeler les RPC #37A/#37B/#37C et
// afficher fidèlement leurs réponses — preview puis commit, jamais l'inverse.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const loading = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;
const errorBox = (t) => `<div class="error-state">${esc(t)}</div>`;
const badge = (s, cls) => `<span class="badge ${cls || ""}">${esc(s ?? "—")}</span>`;
const MAX_ROWS = bulkMaxRows();

function normalizeHeaderKey(h) {
  return String(h || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const IMPORT_FIELD_DEFS = [
  { key: "name", label: "Nom du produit", required: true, synonyms: ["name", "nom", "nomproduit", "productname", "titre"] },
  { key: "category", label: "Catégorie", required: true, synonyms: ["category", "categorie", "catégorie"] },
  { key: "sku", label: "SKU", synonyms: ["sku", "reference", "référence", "ref"] },
  { key: "currency", label: "Devise (HTG/USD)", synonyms: ["currency", "devise", "monnaie"] },
  { key: "retail_price", label: "Prix de détail", required: true, synonyms: ["retailprice", "prix", "prixdedetail", "prixdedétail", "price"] },
  { key: "stock", label: "Stock", synonyms: ["stock", "quantite", "quantité", "qty", "quantity"] },
  { key: "tagline", label: "Accroche", synonyms: ["tagline", "accroche"] },
  { key: "description", label: "Description", synonyms: ["description", "desc"] },
  { key: "wholesale_price", label: "Prix de gros", synonyms: ["wholesaleprice", "prixdegros"] },
  { key: "wholesale_min_qty", label: "Quantité min. gros", synonyms: ["wholesaleminqty", "qtyminimumgros", "moq"] },
  { key: "compare_at_price", label: "Prix barré", synonyms: ["compareatprice", "prixbarre", "prixbarré", "ancienprix"] },
  { key: "delivery_zone", label: "Zone de livraison", synonyms: ["deliveryzone", "zonedelivraison"] },
  { key: "estimated_delivery_days", label: "Délai livraison (jours)", synonyms: ["estimateddeliverydays", "delailivraison", "delaijours"] },
  { key: "search_keywords", label: "Mots-clés", synonyms: ["searchkeywords", "motscles", "motsclés", "keywords"] },
];

const STOCK_FIELD_DEFS = [
  { key: "target_type", label: "Type (product/variant)", synonyms: ["targettype", "type"] },
  { key: "product_id", label: "ID Produit", synonyms: ["productid", "idproduit"] },
  { key: "variant_id", label: "ID Variante", synonyms: ["variantid", "idvariante"] },
  { key: "sku", label: "SKU", synonyms: ["sku", "reference", "référence", "ref"] },
  { key: "stock", label: "Nouveau stock", required: true, synonyms: ["stock", "newstock", "nouveaustock", "quantite", "quantité", "qty"] },
  { key: "is_active", label: "Actif (variante seulement)", synonyms: ["isactive", "actif"] },
];

function parseOptionalBooleanForBackend(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (["true", "1", "oui", "yes", "vrai"].includes(v)) return true;
  if (["false", "0", "non", "no", "faux"].includes(v)) return false;
  return raw;
}

function autoGuessMapping(headers, fieldDefs) {
  const mapping = new Array(headers.length).fill(null);
  const used = new Set();
  headers.forEach((h, i) => {
    const norm = normalizeHeaderKey(h);
    const def = fieldDefs.find((f) => !used.has(f.key) && f.synonyms.includes(norm));
    if (def) { mapping[i] = def.key; used.add(def.key); }
  });
  return mapping;
}

function renderMappingUI(host, { headers, sampleRow, fieldDefs, onBack, onContinue }) {
  const rowsHtml = headers.map((h, i) => `
    <div class="settings-section" data-map-col="${i}">
      <div><strong>${esc(h || `Colonne ${i + 1}`)}</strong><p class="muted" style="font-size:11px">Exemple : ${esc(sampleRow?.[i] ?? "—")}</p></div>
      <select class="input" data-map-select>
        <option value="">Ignorer cette colonne</option>
        ${fieldDefs.map((f) => `<option value="${esc(f.key)}">${esc(f.label)}${f.required ? " *" : ""}</option>`).join("")}
      </select>
    </div>`).join("");
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">Correspondance des colonnes</h3><button class="btn btn-ghost btn-sm" type="button" data-map-back>Retour</button></div>
      <p class="muted" style="font-size:12px">Associez chaque colonne de votre fichier à un champ VinHT. Les colonnes non reconnues sont ignorées par défaut.</p>
      ${rowsHtml}
      <div id="bcMapMsg" class="error-state" style="display:none;margin-top:8px"></div>
      <div class="toolbar-group" style="margin-top:10px"><button class="btn btn-blue btn-sm" type="button" data-map-continue>Continuer</button></div>
    </div>`;
  refreshIcons();
  host.querySelector("[data-map-back]")?.addEventListener("click", onBack);
  const guess = autoGuessMapping(headers, fieldDefs);
  host.querySelectorAll("[data-map-col]").forEach((row) => {
    const i = Number(row.dataset.mapCol);
    const sel = row.querySelector("[data-map-select]");
    if (guess[i]) sel.value = guess[i];
  });
  host.querySelector("[data-map-continue]")?.addEventListener("click", () => {
    const mapping = {};
    const assigned = new Map();
    let duplicate = null;
    host.querySelectorAll("[data-map-col]").forEach((row) => {
      const i = Number(row.dataset.mapCol);
      const val = row.querySelector("[data-map-select]").value || null;
      if (val) {
        if (assigned.has(val)) duplicate = val;
        assigned.set(val, i);
      }
      mapping[i] = val;
    });
    const msgBox = host.querySelector("#bcMapMsg");
    if (duplicate) {
      msgBox.textContent = `Plusieurs colonnes sont associées au même champ (${fieldDefs.find((f) => f.key === duplicate)?.label || duplicate}). Corrigez avant de continuer.`;
      msgBox.style.display = "";
      return;
    }
    const missingRequired = fieldDefs.filter((f) => f.required && !assigned.has(f.key));
    if (missingRequired.length) {
      msgBox.textContent = `Champ(s) obligatoire(s) non associé(s) : ${missingRequired.map((f) => f.label).join(", ")}.`;
      msgBox.style.display = "";
      return;
    }
    msgBox.style.display = "none";
    onContinue(mapping);
  });
}

function buildRowsFromMapping(fileRows, mapping) {
  return fileRows.map((r) => {
    const obj = {};
    Object.entries(mapping).forEach(([idxStr, field]) => {
      if (!field) return;
      const raw = r[Number(idxStr)];
      const v = String(raw ?? "").trim();
      if (v !== "") obj[field] = v;
    });
    return obj;
  });
}

function renderFileUploadUI(host, { title, hint, onBack, onParsed }) {
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">${esc(title)}</h3><button class="btn btn-ghost btn-sm" type="button" data-upload-back>Retour</button></div>
      <p class="muted" style="font-size:12px">${esc(hint)}</p>
      <input type="file" id="bcFileInput" accept=".csv,.xlsx,text/csv">
      ${!isXlsxSupportAvailable() ? `<p class="muted" style="font-size:11px;color:var(--red,#b0122a)">Support Excel (.xlsx) indisponible pour le moment — utilisez un fichier .csv.</p>` : ""}
      <div id="bcUploadMsg" class="error-state" style="display:none;margin-top:8px"></div>
    </div>`;
  refreshIcons();
  host.querySelector("[data-upload-back]")?.addEventListener("click", onBack);
  host.querySelector("#bcFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const msgBox = host.querySelector("#bcUploadMsg");
    msgBox.style.display = "none";
    try {
      const parsed = await parseTabularFile(file);
      if (!parsed.headers.length || !parsed.rows.length) {
        msgBox.textContent = "Fichier vide ou illisible.";
        msgBox.style.display = "";
        return;
      }
      if (parsed.rows.length > MAX_ROWS) {
        msgBox.textContent = `Ce fichier contient ${parsed.rows.length} lignes — maximum ${MAX_ROWS} par opération. Réduisez le fichier avant de continuer.`;
        msgBox.style.display = "";
        return;
      }
      onParsed(parsed);
    } catch (err) {
      const m = String(err?.message || "");
      msgBox.textContent = m === "xlsx_support_unavailable" ? "Support Excel indisponible — utilisez un fichier .csv."
        : m === "unsupported_file_type" ? "Format non supporté — utilisez .csv ou .xlsx."
        : "Impossible de lire ce fichier.";
      msgBox.style.display = "";
    }
  });
}

function previewRowCard(row, renderNormalized) {
  const cls = !row.valid ? "red" : (row.warnings || []).length ? "amber" : "green";
  return `<div class="settings-section" style="align-items:flex-start;border-left:3px solid var(--${cls === "red" ? "red" : cls === "amber" ? "amber" : "green"},#ccc);padding-left:10px">
    <div style="flex:1">
      <strong>Ligne ${esc(row.row_number)}</strong>
      ${renderNormalized(row.normalized || {})}
      ${(row.errors || []).length ? `<p style="color:var(--red,#b0122a);font-size:12px;margin:4px 0 0">❌ ${row.errors.map((e) => esc(bulkCatalogErrorMessageFr(e, e))).join(" · ")}</p>` : ""}
      ${(row.warnings || []).length ? `<p style="color:var(--amber,#9a6b00);font-size:12px;margin:4px 0 0">⚠ ${row.warnings.map((w) => esc(bulkCatalogErrorMessageFr(w, w))).join(" · ")}</p>` : ""}
    </div>
    ${badge(row.valid ? "Valide" : "Invalide", row.valid ? "green" : "red")}
  </div>`;
}

export function renderBulkCatalogModule(host, merchantId, { isStale, onBack, defaultCurrency = "HTG" } = {}) {
  const staleCheck = typeof isStale === "function" ? isStale : () => false;
  const defaultCurrencyCode = ["HTG", "USD"].includes(String(defaultCurrency || "").toUpperCase()) ? String(defaultCurrency).toUpperCase() : "HTG";

  function menu() {
    if (staleCheck()) return;
    host.innerHTML = `
      <div class="portal-card">
        <div class="toolbar"><h3 style="margin:0">Catalogue en masse</h3><button class="btn btn-ghost btn-sm" type="button" id="bcBackToCatalog">Retour au catalogue</button></div>
        <p class="muted" style="font-size:12px">Outils groupés pour ce marchand : import de catalogue, mise à jour de stock et archivage/restauration en masse. Chaque opération passe par un aperçu serveur avant confirmation.</p>
        <div class="quick-grid">
          <button class="quick-card" type="button" id="bcOpenImport"><div class="quick-icon"><i data-lucide="upload"></i></div><div><strong>Import catalogue</strong><small>CSV ou Excel · HTG/USD · jusqu'à ${MAX_ROWS} lignes</small></div></button>
          <button class="quick-card" type="button" id="bcOpenStock"><div class="quick-icon"><i data-lucide="boxes"></i></div><div><strong>Stock en masse</strong><small>Tableau ou import CSV</small></div></button>
          <button class="quick-card" type="button" id="bcOpenArchive"><div class="quick-icon"><i data-lucide="archive"></i></div><div><strong>Archive / restauration</strong><small>Aucune suppression définitive</small></div></button>
        </div>
      </div>`;
    refreshIcons();
    host.querySelector("#bcBackToCatalog")?.addEventListener("click", () => onBack?.());
    host.querySelector("#bcOpenImport")?.addEventListener("click", importFlow.start);
    host.querySelector("#bcOpenStock")?.addEventListener("click", stockFlow.start);
    host.querySelector("#bcOpenArchive")?.addEventListener("click", archiveFlow.start);
  }

  const importFlow = (() => {
    let mapping = null, fileHeaders = [], fileRows = [], builtRows = [];
    let lastSignature = null, idemKey = null;
    let previewResult = null;
    let submitting = false;

    function start() {
      if (staleCheck()) return;
      renderFileUploadUI(host, {
        title: "Import catalogue — 1. Fichier",
        hint: `Formats acceptés : .csv, .xlsx. Colonnes supportées : nom, catégorie, SKU, devise, prix, stock, description, etc. Devise par défaut : ${defaultCurrencyCode}. Maximum ${MAX_ROWS} lignes.`,
        onBack: menu,
        onParsed: (parsed) => { fileHeaders = parsed.headers; fileRows = parsed.rows; showMapping(); },
      });
    }

    function showMapping() {
      if (staleCheck()) return;
      renderMappingUI(host, {
        headers: fileHeaders, sampleRow: fileRows[0], fieldDefs: IMPORT_FIELD_DEFS,
        onBack: start,
        onContinue: (m) => {
          mapping = m;
          builtRows = buildRowsFromMapping(fileRows, mapping).map((row) => ({
            ...row,
            currency: String(row.currency || defaultCurrencyCode).trim().toUpperCase(),
          }));
          runPreview();
        },
      });
    }

    async function runPreview() {
      if (staleCheck()) return;
      const sig = JSON.stringify(builtRows);
      if (sig !== lastSignature) { idemKey = generateIdempotencyKey(); lastSignature = sig; }
      host.innerHTML = `<div class="portal-card">${loading("Vérification du fichier côté serveur…")}</div>`;
      let result;
      try {
        result = await agentPreviewBulkCatalogImport(merchantId, builtRows);
      } catch (err) {
        if (staleCheck()) return;
        host.innerHTML = `<div class="portal-card">${errorBox(bulkCatalogErrorMessageFr(err?.message, "Impossible de vérifier ce fichier."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="bcRetryPreview">Réessayer</button><button class="btn btn-ghost btn-sm" type="button" id="bcBackMap">Modifier le mapping</button></div></div>`;
        host.querySelector("#bcRetryPreview")?.addEventListener("click", runPreview);
        host.querySelector("#bcBackMap")?.addEventListener("click", showMapping);
        return;
      }
      if (staleCheck()) return;
      previewResult = result;
      renderPreview();
    }

    function renderPreview() {
      if (staleCheck()) return;
      const s = previewResult.summary || {};
      const rowsHtml = (previewResult.rows || []).map((r) => previewRowCard(r, (n) => `
        <p style="font-size:12px;margin:2px 0 0">${esc(n.name || "—")} ${n.sku ? `· SKU ${esc(n.sku)}` : ""} · ${n.retail_price == null ? "Prix —" : money(n.retail_price, n.currency || defaultCurrencyCode)}${n.stock != null ? ` · Stock ${esc(n.stock)}` : ""}${n.category_name ? ` · ${esc(n.category_name)}` : ""}</p>
      `)).join("");
      host.innerHTML = `
        <div class="portal-card">
          <div class="toolbar"><h3 style="margin:0">Import catalogue — 2. Aperçu</h3><button class="btn btn-ghost btn-sm" type="button" id="bcBackMap2">Modifier le mapping</button></div>
          <div class="stat-grid">
            <div class="stat-card blue-stat"><div class="label">Total</div><div class="value">${esc(s.total ?? 0)}</div></div>
            <div class="stat-card green-stat"><div class="label">Valides</div><div class="value">${esc(s.valid ?? 0)}</div></div>
            <div class="stat-card red-stat"><div class="label">Invalides</div><div class="value">${esc(s.invalid ?? 0)}</div></div>
            <div class="stat-card amber-stat"><div class="label">Avertissements</div><div class="value">${esc(s.warning_rows ?? 0)}</div></div>
          </div>
        </div>
        <div class="portal-card">${rowsHtml || "<p class=\"muted\">Aucune ligne.</p>"}</div>
        <div class="portal-card">
          <div id="bcCommitMsg" style="font-size:12px;display:none;margin-bottom:8px"></div>
          <div class="toolbar-group">
            ${(s.invalid ?? 0) === 0
              ? `<button class="btn btn-blue btn-sm" type="button" id="bcCommitImport">Confirmer l'import (${esc(s.valid ?? 0)} produits)</button>`
              : `<button class="btn btn-outline-blue btn-sm" type="button" id="bcFixFile">Changer de fichier</button>`}
          </div>
          ${(s.invalid ?? 0) === 0 ? `<p class="muted" style="font-size:11px;margin-top:6px">Les produits seront créés en attente de validation VinHT et inactifs jusqu'à approbation.</p>` : ""}
        </div>`;
      refreshIcons();
      host.querySelector("#bcBackMap2")?.addEventListener("click", showMapping);
      host.querySelector("#bcFixFile")?.addEventListener("click", start);
      host.querySelector("#bcCommitImport")?.addEventListener("click", commit);
    }

    async function commit() {
      if (submitting || staleCheck()) return;
      submitting = true;
      const btn = host.querySelector("#bcCommitImport");
      if (btn) btn.disabled = true;
      let result;
      try {
        result = await agentCommitBulkCatalogImport(merchantId, builtRows, idemKey);
      } catch (err) {
        submitting = false;
        if (staleCheck()) return;
        const msgBox = host.querySelector("#bcCommitMsg");
        if (msgBox) { msgBox.textContent = bulkCatalogErrorMessageFr(err?.message, "Impossible de créer ces produits."); msgBox.style.display = ""; }
        if (btn) btn.disabled = false;
        return;
      }
      submitting = false;
      if (staleCheck()) return;
      const mutation = result?.mutation || {};
      if (mutation.committed === false && mutation.reason === "validation_failed") {
        previewResult = result;
        renderPreview();
        showToast("Ce lot n'est plus valide — vérifiez les erreurs ci-dessous.", "red");
        return;
      }
      const s = result?.summary || {};
      host.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="circle-check"></i></div><h3>${esc(s.created ?? 0)} produit(s) créé(s)</h3><p>Statut : <strong>${esc(s.approval_status || "pending")}</strong>${s.is_active === false ? " · inactifs" : ""} jusqu'à validation VinHT.${mutation.reused ? " (tentative déjà appliquée précédemment)" : ""}</p><div class="toolbar-group" style="justify-content:center;margin-top:10px"><button class="btn btn-blue btn-sm" type="button" id="bcImportAnother">Nouvel import</button><button class="btn btn-ghost btn-sm" type="button" id="bcBackMenu">Retour au menu</button></div></div></div>`;
      refreshIcons();
      host.querySelector("#bcImportAnother")?.addEventListener("click", () => { mapping = null; fileHeaders = []; fileRows = []; builtRows = []; lastSignature = null; idemKey = null; previewResult = null; start(); });
      host.querySelector("#bcBackMenu")?.addEventListener("click", menu);
    }

    return { start };
  })();

  const stockFlow = (() => {
    let searchTerm = "", rows = [], offset = 0, hasMore = false, seq = 0;
    const PAGE_SIZE = 20;
    const edits = new Map();
    let builtRows = [], lastSignature = null, idemKey = null, previewResult = null, confirmationToken = null;
    let submitting = false;

    function start() {
      if (staleCheck()) return;
      edits.clear();
      host.innerHTML = `
        <div class="portal-card">
          <div class="toolbar"><h3 style="margin:0">Stock en masse</h3><button class="btn btn-ghost btn-sm" type="button" id="bcBackMenuS">Retour au menu</button></div>
          <div class="toolbar-group">
            <button class="btn btn-outline-blue btn-sm" type="button" id="bcStockTableMode">Mode tableau</button>
            <button class="btn btn-outline-blue btn-sm" type="button" id="bcStockCsvMode">Import CSV (sku, new_stock)</button>
          </div>
        </div>`;
      refreshIcons();
      host.querySelector("#bcBackMenuS")?.addEventListener("click", menu);
      host.querySelector("#bcStockTableMode")?.addEventListener("click", startTable);
      host.querySelector("#bcStockCsvMode")?.addEventListener("click", startCsv);
    }

    function startTable() {
      if (staleCheck()) return;
      searchTerm = ""; rows = []; offset = 0; hasMore = false;
      renderTableShell();
      runTableSearch(true);
    }

    function renderTableShell() {
      host.innerHTML = `
        <div class="portal-card">
          <div class="toolbar"><h3 style="margin:0">Stock en masse — Tableau</h3><button class="btn btn-ghost btn-sm" type="button" id="bcStockBack">Retour</button></div>
          <input class="input" id="bcStockSearch" placeholder="Rechercher un produit ou SKU…">
        </div>
        <div class="portal-card"><div id="bcStockTableHost"></div><div id="bcStockLoadMoreWrap" style="margin-top:8px"></div></div>
        <div class="portal-card">
          <div id="bcStockEditCount" class="muted" style="font-size:12px">Aucune modification.</div>
          <div class="toolbar-group" style="margin-top:8px"><button class="btn btn-blue btn-sm" type="button" id="bcStockPreviewBtn" disabled>Aperçu du lot</button></div>
        </div>`;
      refreshIcons();
      host.querySelector("#bcStockBack")?.addEventListener("click", start);
      let debounceT = null;
      host.querySelector("#bcStockSearch")?.addEventListener("input", (e) => {
        searchTerm = e.target.value || "";
        clearTimeout(debounceT);
        debounceT = setTimeout(() => runTableSearch(true), 300);
      });
      host.querySelector("#bcStockPreviewBtn")?.addEventListener("click", () => {
        builtRows = Array.from(edits.entries()).map(([productId, stock]) => ({ target_type: "product", product_id: productId, stock: String(stock) }));
        runPreview();
      });
    }

    function renderTableRows() {
      const tHost = document.querySelector("#bcStockTableHost");
      if (!tHost) return;
      if (!rows.length) { tHost.innerHTML = `<p class="muted" style="font-size:12px">Aucun produit.</p>`; return; }
      tHost.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>SKU</th><th>Stock actuel</th><th>Nouveau stock</th></tr></thead><tbody>${rows.map((p) => `
        <tr data-pid="${esc(p.id)}">
          <td>${esc(p.name)}</td>
          <td>${esc(p.sku || "—")}</td>
          <td>${p.has_variants ? badge(`${p.variant_count || 0} variante(s)`, "blue") : esc(p.stock ?? 0)}</td>
          <td>${p.has_variants ? `<span class="muted" style="font-size:11px">Utilisez l'import CSV avec les SKU de variante</span>` : `<input class="input bc-stock-input" type="number" min="0" step="1" placeholder="${esc(p.stock ?? 0)}" style="width:100px" value="${edits.has(p.id) ? esc(edits.get(p.id)) : ""}">`}</td>
        </tr>`).join("")}</tbody></table></div>`;
      tHost.querySelectorAll("tr[data-pid]").forEach((tr) => {
        const input = tr.querySelector(".bc-stock-input");
        if (!input) return;
        input.addEventListener("input", () => {
          const pid = tr.dataset.pid;
          const v = input.value.trim();
          if (v === "") edits.delete(pid); else edits.set(pid, v);
          updateEditCount();
        });
      });
    }

    function updateEditCount() {
      const el = document.querySelector("#bcStockEditCount");
      const btn = document.querySelector("#bcStockPreviewBtn");
      if (el) el.textContent = edits.size ? `${edits.size} modification(s) prête(s) pour l'aperçu.` : "Aucune modification.";
      if (btn) btn.disabled = edits.size === 0;
    }

    function renderLoadMore() {
      const wrap = document.querySelector("#bcStockLoadMoreWrap");
      if (!wrap) return;
      wrap.innerHTML = hasMore ? `<button class="btn btn-ghost btn-sm" id="bcStockLoadMore" type="button">Charger plus</button>` : "";
      wrap.querySelector("#bcStockLoadMore")?.addEventListener("click", () => runTableSearch(false));
    }

    async function runTableSearch(reset) {
      if (staleCheck()) return;
      const localSeq = ++seq;
      const off = reset ? 0 : offset;
      const tHost = document.querySelector("#bcStockTableHost");
      if (reset) { rows = []; offset = 0; if (tHost) tHost.innerHTML = loading("Recherche…"); }
      else { const b = document.querySelector("#bcStockLoadMore"); if (b) b.disabled = true; }
      try {
        const result = await agentListMerchantProducts(merchantId, { search: searchTerm || null, limit: PAGE_SIZE, offset: off });
        if (staleCheck() || localSeq !== seq) return;
        const merged = reset ? result.rows : rows.concat(result.rows);
        const seen = new Set();
        rows = merged.filter((r) => { if (!r?.id || seen.has(r.id)) return false; seen.add(r.id); return true; });
        hasMore = result.hasMore;
        offset = off + result.rows.length;
        renderTableRows();
        renderLoadMore();
      } catch (err) {
        if (staleCheck() || localSeq !== seq) return;
        if (tHost) tHost.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger le catalogue."));
        renderLoadMore();
      }
    }

    let globalTargetType = "product";

    function startCsv() {
      if (staleCheck()) return;
      renderFileUploadUI(host, {
        title: "Stock en masse — Import CSV",
        hint: `Colonnes minimales : sku, new_stock. Colonnes avancées optionnelles : product_id, variant_id, target_type, is_active. Maximum ${MAX_ROWS} lignes.`,
        onBack: start,
        onParsed: (parsed) => showCsvTargetChoice(parsed),
      });
    }

    function showCsvTargetChoice(parsed) {
      if (staleCheck()) return;
      const hasTargetTypeCol = parsed.headers.some((h) => normalizeHeaderKey(h) === "targettype" || normalizeHeaderKey(h) === "type");
      if (hasTargetTypeCol) { showCsvMapping(parsed); return; }
      host.innerHTML = `
        <div class="portal-card">
          <h3>Ces lignes concernent :</h3>
          <div class="toolbar-group">
            <label style="display:flex;align-items:center;gap:6px"><input type="radio" name="bcTargetType" value="product" checked> Produits (SKU produit)</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="radio" name="bcTargetType" value="variant"> Variantes (SKU variante)</label>
          </div>
          <div class="toolbar-group" style="margin-top:10px"><button class="btn btn-blue btn-sm" type="button" id="bcTargetContinue">Continuer</button></div>
        </div>`;
      host.querySelector("#bcTargetContinue")?.addEventListener("click", () => {
        globalTargetType = host.querySelector('input[name="bcTargetType"]:checked')?.value || "product";
        showCsvMapping(parsed);
      });
    }

    function showCsvMapping(parsed) {
      if (staleCheck()) return;
      renderMappingUI(host, {
        headers: parsed.headers, sampleRow: parsed.rows[0], fieldDefs: STOCK_FIELD_DEFS,
        onBack: () => startCsv(),
        onContinue: (mapping) => {
          builtRows = buildRowsFromMapping(parsed.rows, mapping).map((r) => ({
            target_type: r.target_type || globalTargetType,
            ...(r.product_id ? { product_id: r.product_id } : {}),
            ...(r.variant_id ? { variant_id: r.variant_id } : {}),
            ...(r.sku ? { sku: r.sku } : {}),
            stock: r.stock,
            ...(r.is_active !== undefined ? { is_active: parseOptionalBooleanForBackend(r.is_active) } : {}),
          }));
          runPreview();
        },
      });
    }

    async function runPreview() {
      if (staleCheck()) return;
      const sig = JSON.stringify(builtRows);
      if (sig !== lastSignature) { idemKey = generateIdempotencyKey(); lastSignature = sig; confirmationToken = null; }
      host.innerHTML = `<div class="portal-card">${loading("Vérification du lot côté serveur…")}</div>`;
      let result;
      try {
        result = await agentPreviewBulkInventory(merchantId, builtRows);
      } catch (err) {
        if (staleCheck()) return;
        host.innerHTML = `<div class="portal-card">${errorBox(bulkCatalogErrorMessageFr(err?.message, "Impossible de vérifier ce lot."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="bcRetryPreviewS">Réessayer</button></div></div>`;
        host.querySelector("#bcRetryPreviewS")?.addEventListener("click", runPreview);
        return;
      }
      if (staleCheck()) return;
      previewResult = result;
      renderPreview();
    }

    function renderPreview() {
      if (staleCheck()) return;
      const s = previewResult.summary || {};
      const rowsHtml = (previewResult.rows || []).map((r) => previewRowCard(r, (n) => `
        <p style="font-size:12px;margin:2px 0 0">${esc(n.sku || n.product_id || n.variant_id || "—")} · ${esc(n.current_stock ?? "—")} → <strong>${esc(n.stock ?? "—")}</strong>${n.destructive ? " " + badge("Sensible", "red") : ""}</p>
      `)).join("");
      const confirmation = previewResult.confirmation;
      host.innerHTML = `
        <div class="portal-card">
          <h3>Aperçu du stock</h3>
          <div class="stat-grid">
            <div class="stat-card blue-stat"><div class="label">Total</div><div class="value">${esc(s.total ?? 0)}</div></div>
            <div class="stat-card green-stat"><div class="label">Changements</div><div class="value">${esc(s.changed_rows ?? 0)}</div></div>
            <div class="stat-card red-stat"><div class="label">Invalides</div><div class="value">${esc(s.invalid ?? 0)}</div></div>
            <div class="stat-card amber-stat"><div class="label">Mise à zéro</div><div class="value">${esc(s.zeroing_rows ?? 0)}</div></div>
          </div>
        </div>
        <div class="portal-card">${rowsHtml || "<p class=\"muted\">Aucune ligne.</p>"}</div>
        ${confirmation ? `<div class="portal-card" style="border-color:var(--red,#b0122a)">
          <h3>Confirmation requise</h3>
          <p>${esc(confirmation.message)}</p>
          <p style="font-size:13px">${esc(s.changed_rows ?? 0)} produit(s)/variante(s) seront affecté(s).</p>
          <div class="toolbar-group"><button class="btn btn-outline-red btn-sm" type="button" id="bcStockConfirmYes">Confirmer la mise à jour</button><button class="btn btn-ghost btn-sm" type="button" id="bcStockConfirmNo">Annuler</button></div>
        </div>` : ""}
        <div class="portal-card">
          <div id="bcStockCommitMsg" style="font-size:12px;display:none;margin-bottom:8px"></div>
          <div class="toolbar-group">
            ${(s.invalid ?? 0) > 0 ? `<button class="btn btn-outline-blue btn-sm" type="button" id="bcStockFix">Revenir en arrière</button>`
              : confirmation ? "" : `<button class="btn btn-blue btn-sm" type="button" id="bcStockCommit">Confirmer la mise à jour (${esc(s.changed_rows ?? 0)})</button>`}
          </div>
        </div>`;
      refreshIcons();
      host.querySelector("#bcStockFix")?.addEventListener("click", start);
      host.querySelector("#bcStockCommit")?.addEventListener("click", () => commit(null));
      host.querySelector("#bcStockConfirmYes")?.addEventListener("click", () => commit(confirmation.token));
      host.querySelector("#bcStockConfirmNo")?.addEventListener("click", start);
    }

    async function commit(token) {
      if (submitting || staleCheck()) return;
      submitting = true;
      const btns = host.querySelectorAll("#bcStockCommit,#bcStockConfirmYes,#bcStockConfirmNo");
      btns.forEach((b) => { b.disabled = true; });
      let result;
      try {
        result = await agentCommitBulkInventory(merchantId, builtRows, idemKey, token);
      } catch (err) {
        submitting = false;
        if (staleCheck()) return;
        const msgBox = host.querySelector("#bcStockCommitMsg");
        if (msgBox) { msgBox.textContent = bulkCatalogErrorMessageFr(err?.message, "Impossible d'appliquer ce lot."); msgBox.style.display = ""; }
        btns.forEach((b) => { b.disabled = false; });
        return;
      }
      submitting = false;
      if (staleCheck()) return;
      const mutation = result?.mutation || {};
      if (mutation.reused === true) { renderStockSuccess(result, { reused: true }); return; }
      if (mutation.committed === false) {
        previewResult = result;
        renderPreview();
        showToast(bulkCatalogErrorMessageFr(mutation.reason, "Ce lot n'est plus valide — un nouvel aperçu est nécessaire."), "red");
        return;
      }
      renderStockSuccess(result, { reused: false });
    }

    function renderStockSuccess(result, { reused }) {
      if (staleCheck()) return;
      const s = result?.summary || {};
      host.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="circle-check"></i></div><h3>${esc(s.committed_rows ?? 0)} ligne(s) mise(s) à jour</h3><p>${esc(s.unchanged_rows ?? 0)} ligne(s) inchangée(s).${reused ? "<br>Cette opération avait déjà été appliquée précédemment. Aucune modification supplémentaire n'a été effectuée." : ""}</p><div class="toolbar-group" style="justify-content:center;margin-top:10px"><button class="btn btn-blue btn-sm" type="button" id="bcStockAnother">Nouveau lot</button><button class="btn btn-ghost btn-sm" type="button" id="bcBackMenu2">Retour au menu</button></div></div></div>`;
      refreshIcons();
      host.querySelector("#bcStockAnother")?.addEventListener("click", () => { builtRows = []; lastSignature = null; idemKey = null; confirmationToken = null; previewResult = null; start(); });
      host.querySelector("#bcBackMenu2")?.addEventListener("click", menu);
    }

    return { start };
  })();

  const archiveFlow = (() => {
    let searchTerm = "", rows = [], offset = 0, hasMore = false, seq = 0;
    const PAGE_SIZE = 20;
    const selected = new Set();
    let action = "archive";
    let builtRows = [], lastSignature = null, idemKey = null, previewResult = null;
    let submitting = false;

    function start() {
      if (staleCheck()) return;
      selected.clear(); searchTerm = ""; rows = []; offset = 0;
      renderShell();
      runSearch(true);
    }

    function renderShell() {
      host.innerHTML = `
        <div class="portal-card">
          <div class="toolbar"><h3 style="margin:0">Archive / restauration en masse</h3><button class="btn btn-ghost btn-sm" type="button" id="bcArchBack">Retour au menu</button></div>
          <div class="toolbar-group">
            <label style="display:flex;align-items:center;gap:6px"><input type="radio" name="bcArchAction" value="archive" checked> Archiver</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="radio" name="bcArchAction" value="restore"> Restaurer</label>
          </div>
          <input class="input" id="bcArchSearch" placeholder="Rechercher un produit ou SKU…" style="margin-top:8px">
        </div>
        <div class="portal-card"><div id="bcArchListHost"></div><div id="bcArchLoadMoreWrap" style="margin-top:8px"></div></div>
        <div class="portal-card">
          <label style="font-size:12px">Ajouter par SKU (un par ligne ou séparés par des virgules)</label>
          <textarea class="input" id="bcArchSkuList" rows="2" placeholder="SKU-1, SKU-2"></textarea>
        </div>
        <div class="portal-card">
          <div id="bcArchCount" class="muted" style="font-size:12px">Aucune sélection.</div>
          <div class="toolbar-group" style="margin-top:8px"><button class="btn btn-blue btn-sm" type="button" id="bcArchPreviewBtn">Aperçu</button></div>
        </div>`;
      refreshIcons();
      host.querySelector("#bcArchBack")?.addEventListener("click", menu);
      host.querySelectorAll('input[name="bcArchAction"]').forEach((r) => r.addEventListener("change", (e) => { action = e.target.value; }));
      let debounceT = null;
      host.querySelector("#bcArchSearch")?.addEventListener("input", (e) => {
        searchTerm = e.target.value || "";
        clearTimeout(debounceT);
        debounceT = setTimeout(() => runSearch(true), 300);
      });
      host.querySelector("#bcArchPreviewBtn")?.addEventListener("click", () => {
        const skuText = host.querySelector("#bcArchSkuList")?.value || "";
        const skus = skuText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        const idRows = Array.from(selected).map((productId) => ({ action, product_id: productId }));
        const skuRows = skus.map((sku) => ({ action, sku }));
        builtRows = idRows.concat(skuRows);
        if (!builtRows.length) { showToast("Sélectionnez au moins un produit ou saisissez un SKU.", "red"); return; }
        runPreview();
      });
    }

    function renderRows() {
      const lHost = document.querySelector("#bcArchListHost");
      if (!lHost) return;
      if (!rows.length) { lHost.innerHTML = `<p class="muted" style="font-size:12px">Aucun produit.</p>`; return; }
      lHost.innerHTML = rows.map((p) => `
        <div class="settings-section" data-pid="${esc(p.id)}">
          <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
            <input type="checkbox" class="bc-arch-check" ${selected.has(p.id) ? "checked" : ""}>
            <span><strong>${esc(p.name)}</strong><br><small class="muted">${esc(p.sku || "—")}</small></span>
          </label>
          ${badge(p.is_active ? "Actif" : "Archivé/Inactif", p.is_active ? "green" : "")}
          ${badge(p.approval_status, p.approval_status === "approved" ? "green" : p.approval_status === "rejected" ? "red" : "amber")}
        </div>`).join("");
      lHost.querySelectorAll("[data-pid]").forEach((row) => {
        row.querySelector(".bc-arch-check")?.addEventListener("change", (e) => {
          const pid = row.dataset.pid;
          if (e.target.checked) selected.add(pid); else selected.delete(pid);
          updateCount();
        });
      });
    }

    function updateCount() {
      const el = document.querySelector("#bcArchCount");
      if (el) el.textContent = selected.size ? `${selected.size} produit(s) sélectionné(s).` : "Aucune sélection.";
    }

    function renderLoadMore() {
      const wrap = document.querySelector("#bcArchLoadMoreWrap");
      if (!wrap) return;
      wrap.innerHTML = hasMore ? `<button class="btn btn-ghost btn-sm" id="bcArchLoadMore" type="button">Charger plus</button>` : "";
      wrap.querySelector("#bcArchLoadMore")?.addEventListener("click", () => runSearch(false));
    }

    async function runSearch(reset) {
      if (staleCheck()) return;
      const localSeq = ++seq;
      const off = reset ? 0 : offset;
      const lHost = document.querySelector("#bcArchListHost");
      if (reset) { rows = []; offset = 0; if (lHost) lHost.innerHTML = loading("Recherche…"); }
      else { const b = document.querySelector("#bcArchLoadMore"); if (b) b.disabled = true; }
      try {
        const result = await agentListMerchantProducts(merchantId, { search: searchTerm || null, limit: PAGE_SIZE, offset: off });
        if (staleCheck() || localSeq !== seq) return;
        const merged = reset ? result.rows : rows.concat(result.rows);
        const seen = new Set();
        rows = merged.filter((r) => { if (!r?.id || seen.has(r.id)) return false; seen.add(r.id); return true; });
        hasMore = result.hasMore;
        offset = off + result.rows.length;
        renderRows();
        renderLoadMore();
      } catch (err) {
        if (staleCheck() || localSeq !== seq) return;
        if (lHost) lHost.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger le catalogue."));
        renderLoadMore();
      }
    }

    async function runPreview() {
      if (staleCheck()) return;
      const sig = JSON.stringify(builtRows);
      if (sig !== lastSignature) { idemKey = generateIdempotencyKey(); lastSignature = sig; }
      host.innerHTML = `<div class="portal-card">${loading("Vérification du lot côté serveur…")}</div>`;
      let result;
      try {
        result = await agentPreviewBulkCatalogStatus(merchantId, builtRows);
      } catch (err) {
        if (staleCheck()) return;
        host.innerHTML = `<div class="portal-card">${errorBox(bulkCatalogErrorMessageFr(err?.message, "Impossible de vérifier ce lot."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="bcArchRetry">Réessayer</button></div></div>`;
        host.querySelector("#bcArchRetry")?.addEventListener("click", runPreview);
        return;
      }
      if (staleCheck()) return;
      previewResult = result;
      renderPreview();
    }

    function renderPreview() {
      if (staleCheck()) return;
      const s = previewResult.summary || {};
      const rowsHtml = (previewResult.rows || []).map((r) => previewRowCard(r, (n) => `
        <p style="font-size:12px;margin:2px 0 0">${esc(n.name || n.sku || n.product_id || "—")} ${n.sku ? `· SKU ${esc(n.sku)}` : ""} · ${esc(n.action === "archive" ? "Archiver" : "Restaurer")}${n.approval_status ? ` · ${esc(n.approval_status)}` : ""}</p>
      `)).join("");
      const confirmation = previewResult.confirmation;
      const verb = action === "archive" ? "archivés" : "restaurés";
      host.innerHTML = `
        <div class="portal-card">
          <h3>Aperçu ${action === "archive" ? "archivage" : "restauration"}</h3>
          <div class="stat-grid">
            <div class="stat-card blue-stat"><div class="label">Total</div><div class="value">${esc(s.total ?? 0)}</div></div>
            <div class="stat-card green-stat"><div class="label">Changements</div><div class="value">${esc(s.changed_rows ?? 0)}</div></div>
            <div class="stat-card red-stat"><div class="label">Invalides</div><div class="value">${esc(s.invalid ?? 0)}</div></div>
          </div>
        </div>
        <div class="portal-card">${rowsHtml || "<p class=\"muted\">Aucune ligne.</p>"}</div>
        ${confirmation ? `<div class="portal-card" style="border-color:var(--red,#b0122a)">
          <h3>Confirmation requise</h3>
          <p>${esc(s.changed_rows ?? 0)} produits vont être ${esc(verb)}. Ils ${action === "archive" ? "ne seront plus actifs dans le catalogue" : "redeviendront actifs dans le catalogue"}. Aucune donnée ne sera supprimée définitivement.</p>
          <div class="toolbar-group"><button class="btn btn-outline-red btn-sm" type="button" id="bcArchConfirmYes">Confirmer</button><button class="btn btn-ghost btn-sm" type="button" id="bcArchConfirmNo">Annuler</button></div>
        </div>` : ""}
        <div class="portal-card">
          <div id="bcArchCommitMsg" style="font-size:12px;display:none;margin-bottom:8px"></div>
          <div class="toolbar-group">
            ${(s.invalid ?? 0) > 0 ? `<button class="btn btn-outline-blue btn-sm" type="button" id="bcArchFix">Revenir en arrière</button>`
              : confirmation ? "" : `<button class="btn btn-blue btn-sm" type="button" id="bcArchCommit">Confirmer (${esc(s.changed_rows ?? 0)})</button>`}
          </div>
        </div>`;
      refreshIcons();
      host.querySelector("#bcArchFix")?.addEventListener("click", start);
      host.querySelector("#bcArchCommit")?.addEventListener("click", () => commit(null));
      host.querySelector("#bcArchConfirmYes")?.addEventListener("click", () => commit(confirmation.token));
      host.querySelector("#bcArchConfirmNo")?.addEventListener("click", start);
    }

    async function commit(token) {
      if (submitting || staleCheck()) return;
      submitting = true;
      const btns = host.querySelectorAll("#bcArchCommit,#bcArchConfirmYes,#bcArchConfirmNo");
      btns.forEach((b) => { b.disabled = true; });
      let result;
      try {
        result = await agentCommitBulkCatalogStatus(merchantId, builtRows, idemKey, token);
      } catch (err) {
        submitting = false;
        if (staleCheck()) return;
        const msgBox = host.querySelector("#bcArchCommitMsg");
        if (msgBox) { msgBox.textContent = bulkCatalogErrorMessageFr(err?.message, "Impossible d'appliquer ce lot."); msgBox.style.display = ""; }
        btns.forEach((b) => { b.disabled = false; });
        return;
      }
      submitting = false;
      if (staleCheck()) return;
      const mutation = result?.mutation || {};
      if (mutation.reused === true) { renderArchiveSuccess(result, { reused: true }); return; }
      if (mutation.committed === false) {
        previewResult = result;
        renderPreview();
        showToast(bulkCatalogErrorMessageFr(mutation.reason, "Ce lot n'est plus valide — un nouvel aperçu est nécessaire."), "red");
        return;
      }
      renderArchiveSuccess(result, { reused: false });
    }

    function renderArchiveSuccess(result, { reused }) {
      if (staleCheck()) return;
      const s = result?.summary || {};
      host.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="circle-check"></i></div><h3>${esc(s.committed_rows ?? 0)} produit(s) mis à jour</h3><p>${esc(s.unchanged_rows ?? 0)} inchangé(s).${reused ? "<br>Cette opération avait déjà été appliquée précédemment. Aucune modification supplémentaire n'a été effectuée." : ""}</p><div class="toolbar-group" style="justify-content:center;margin-top:10px"><button class="btn btn-blue btn-sm" type="button" id="bcArchAnother">Nouveau lot</button><button class="btn btn-ghost btn-sm" type="button" id="bcBackMenu3">Retour au menu</button></div></div></div>`;
      refreshIcons();
      host.querySelector("#bcArchAnother")?.addEventListener("click", () => { builtRows = []; lastSignature = null; idemKey = null; previewResult = null; start(); });
      host.querySelector("#bcBackMenu3")?.addEventListener("click", menu);
    }

    return { start };
  })();

  menu();
}
