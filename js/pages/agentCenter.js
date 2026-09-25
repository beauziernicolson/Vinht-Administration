// Feature #35C — Centre Agent VinHT.
// Branché exclusivement sur agent_get_my_context_v1 / agent_list_my_merchants_v1 /
// agent_get_merchant_operational_context_v1 / agent_list_merchant_products_v2 (#35B.1,
// recherche serveur nom+SKU sur tout le catalogue) / agent_get_product_context_v1 /
// agent_create_product_v1 / agent_update_product_content_v1 / agent_set_product_stock_v1 /
// agent_replace_product_variants_v1 (structure) / agent_update_product_variant_inventory_v1
// (stock/actif d'une variante existante — jamais confondu avec le remplacement structurel) /
// agent_set_product_active_v1 (#35A/#35B).
// Aucune vérité métier (affectation, scope, approbation, éligibilité activation)
// n'est recalculée ici — le backend reste la seule source de vérité. Aucune
// surface financière n'est affichée ni appelée, même si elle n'est pas visible
// dans l'UI actuelle.

import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange, signInWithOtpToEmail } from "../services/auth.js";
import { getCategories } from "../services/catalog.js";
import { openAuthModal } from "../ui/authModal.js";
import { showToast } from "../ui/toast.js";
import {
  agentGetMyContext, agentListMyMerchants, agentGetMerchantOperationalContext,
  agentListMerchantProducts, agentGetProductContext, agentCreateProduct,
  agentUpdateProductContent, agentSetProductStock, agentReplaceProductVariants,
  agentUpdateProductVariantInventory, agentSetProductActive,
  agentCreateAssistedMerchantDossier, agentSaveAssistedMerchantDossier,
  agentMarkAssistedMerchantReady, agentGetAssistedMerchantDossier,
  agentListMyAssistedMerchantDossiers, agentIssueAssistedMerchantInvite,
  ASSISTED_DOSSIER_STATUS_FR,
  AGENT_STATUS_FR, agentErrorMessageFr, submitMyAgentApplication,
} from "../services/agentCenter.js";
import { invalidateAccessContext } from "../services/access.js";
import { attachGeoHints } from "../services/geoHints.js";
import { renderBulkCatalogModule } from "./agentBulkCatalog.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const loading = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;
const errorBox = (t) => `<div class="error-state">${esc(t)}</div>`;
const empty = (a, b) => `<div class="empty-state"><div class="empty-icon"><i data-lucide="package-search"></i></div><h3>${esc(a)}</h3><p>${esc(b)}</p></div>`;
const badge = (s, cls) => `<span class="badge ${cls || ""}">${esc(s ?? "—")}</span>`;
const approvalLabel = (s) => {
  const k = String(s || "").toLowerCase();
  return k === "approved" ? "Vérifié par VinHT" : k === "rejected" ? "Retiré par VinHT" : "À vérifier";
};
const approvalBadge = (s) => {
  const k = String(s || "").toLowerCase();
  const c = k === "approved" ? "green" : k === "rejected" ? "red" : "amber";
  return badge(approvalLabel(s), c);
};

function fmtDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// --- État module -------------------------------------------------------
let _acCtx = null;
let _acMerchantSearch = "";
let _acMerchants = [];
let _acMerchantsLoaded = false;
let _acCurrentMerchantId = null;
let _acCurrentMerchantCtx = null; // dernier contexte marchand chargé — réutilisé pour revenir du module #37 sans refetch
let _acMerchantSeq = 0; // bump à chaque changement de marchand — invalide toute réponse async en vol
let _acCategories = null;
let _acProductsRows = [];
let _acProductsOffset = 0;
let _acProductsHasMore = false;
let _acProductsSeq = 0;
let _acProductSearchTerm = ""; // terme réellement envoyé au serveur, utilisé pour la pagination "Charger plus"
const PRODUCTS_PAGE_SIZE = 20;
const PRODUCT_SEARCH_MAX_LENGTH = 120;

// --- État module — #36B onboarding assisté (dossiers marchands) ------------
let _acDossierRows = [];
let _acDossierOffset = 0;
let _acDossierHasMore = false;
let _acDossierSeq = 0;
let _acDossierStatusFilter = "";
const DOSSIER_PAGE_SIZE = 20;
// Garde anti-obsolescence dédiée au détail dossier (correction ChatGPT #3) :
// un clic dossier A puis dossier B, ou "Retour à la liste" pendant qu'une
// requête/mutation A est encore en vol, ne doit jamais réécrire l'écran
// courant avec une réponse tardive de A. Une mutation qui réussit après que
// l'utilisateur a quitté le dossier reste réussie — on n'écrit simplement
// plus rien à l'écran pour elle.
let _acDossierDetailSeq = 0;
let _acDossierDetailId = null;

function invalidateDossierDetail() {
  _acDossierDetailSeq += 1;
  _acDossierDetailId = null;
}

// #37 — Garde anti-obsolescence dédiée au cycle de vie du module bulk,
// indépendante de _acMerchantSeq/_acCurrentMerchantId : ceux-ci ne changent
// pas quand on fait "Retour au catalogue" ou "Nouveaux marchands" pour le
// MÊME marchand, alors qu'une requête bulk peut encore être en vol. Sans ce
// jeton dédié, une réponse bulk tardive pourrait réécrire #acContentHost
// après que l'utilisateur a quitté le module — jamais transformé en échec la
// mutation elle-même, seulement son affichage est bloqué.
let _acBulkModuleSeq = 0;

function invalidateBulkModule() {
  _acBulkModuleSeq += 1;
}

function gate(html) {
  const g = document.querySelector("[data-agent-gate]"), c = document.querySelector("[data-agent-content]");
  if (g) { g.hidden = false; g.innerHTML = html; }
  if (c) c.hidden = true;
  refreshIcons();
}
function showContent() {
  const g = document.querySelector("[data-agent-gate]"), c = document.querySelector("[data-agent-content]");
  if (g) g.hidden = true;
  if (c) c.hidden = false;
}

async function getCategoriesCached() {
  if (_acCategories) return _acCategories;
  try { _acCategories = await getCategories({ activeOnly: true }); }
  catch { _acCategories = []; }
  return _acCategories;
}

// --- En-tête Agent -------------------------------------------------------

function renderAgentHeader(ctx) {
  const host = document.querySelector("#acAgentHeader");
  if (!host) return;
  const p = ctx.profile || {};
  const statusCls = ctx.state === "active" ? "green" : ctx.state === "suspended" ? "red" : "blue";
  host.innerHTML = `
    <p class="ac-agent-name">${esc(p.display_name || "Agent VinHT")}</p>
    <div class="ac-agent-meta">
      ${badge(AGENT_STATUS_FR[ctx.state] || ctx.state, statusCls)}
      <span>${esc(ctx.assigned_merchants_count ?? 0)} marchand${(ctx.assigned_merchants_count || 0) > 1 ? "s" : ""} assigné${(ctx.assigned_merchants_count || 0) > 1 ? "s" : ""}</span>
      ${String(ctx.environment || "").toLowerCase() === "demo" ? badge("Demo", "amber") : ""}
    </div>
    ${p.commune || p.department ? `<p class="muted" style="font-size:11px;margin:4px 0 0">${esc([p.commune, p.department].filter(Boolean).join(", "))}</p>` : ""}
  `;
  // N'affiche jamais une action que le backend déclare indisponible.
  const onboardingBtn = document.querySelector("#acOpenOnboardingBtn");
  if (onboardingBtn) onboardingBtn.hidden = ctx.capabilities?.can_assist_onboarding === false;
}

// --- Liste des marchands assignés (sidebar) -------------------------------

function merchantInitial(name) {
  const n = String(name || "").trim();
  return n ? n.charAt(0).toUpperCase() : "?";
}

function merchantItemHtml(row) {
  const m = row.merchant || {};
  const active = m.id === _acCurrentMerchantId;
  return `<button type="button" class="ac-merchant-item${active ? " active" : ""}" data-merchant-id="${esc(m.id)}">
    <span class="ac-merchant-avatar">${m.logo_url ? `<img src="${esc(m.logo_url)}" alt="">` : esc(merchantInitial(m.shop_name))}</span>
    <span class="ac-merchant-info"><strong>${esc(m.shop_name || "Boutique")}</strong><small>${esc(m.merchant_type || "—")}</small></span>
  </button>`;
}

function renderMerchantList() {
  const host = document.querySelector("#acMerchantListHost");
  if (!host) return;
  const q = _acMerchantSearch.trim().toLowerCase();
  const rows = q ? _acMerchants.filter((r) => String(r.merchant?.shop_name || "").toLowerCase().includes(q)) : _acMerchants;
  if (!rows.length) {
    host.innerHTML = `<p class="muted" style="font-size:11px;padding:10px 4px">${q ? "Aucun marchand ne correspond à cette recherche." : "Aucun marchand assigné pour le moment."}</p>`;
    return;
  }
  host.innerHTML = rows.map(merchantItemHtml).join("");
  host.querySelectorAll("[data-merchant-id]").forEach((btn) => btn.addEventListener("click", () => selectMerchant(btn.dataset.merchantId)));
  refreshIcons();
}

// Rendu + branchement du bouton "Charger plus" marchands, réutilisé après
// chaque page — sinon seul le tout premier clic fonctionne (correctif 5).
function renderMerchantLoadMore(hasMore) {
  const wrap = document.querySelector("#acMerchantLoadMoreWrap");
  if (!wrap) return;
  wrap.innerHTML = hasMore ? `<button class="btn btn-ghost btn-sm" id="acMerchantLoadMore" type="button">Charger plus</button>` : "";
  wrap.querySelector("#acMerchantLoadMore")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const more = await agentListMyMerchants({ limit: 100, offset: _acMerchants.length });
      const seen = new Set(_acMerchants.map((r) => r.merchant?.id));
      _acMerchants = _acMerchants.concat(more.rows.filter((r) => !seen.has(r.merchant?.id)));
      renderMerchantList();
      renderMerchantLoadMore(more.hasMore);
    } catch (err) {
      showToast(agentErrorMessageFr(err?.message, "Impossible de charger plus de marchands."), "red");
      btn.disabled = false;
    }
  });
}

async function loadMerchants() {
  const host = document.querySelector("#acMerchantListHost");
  if (host) host.innerHTML = loading("Chargement des marchands…");
  try {
    // La RPC ne propose pas de recherche serveur ; elle plafonne à 100 lignes
    // par appel, ce qui couvre déjà largement un portefeuille de 20-50
    // marchands en un seul chargement pour une recherche locale instantanée.
    const result = await agentListMyMerchants({ limit: 100, offset: 0 });
    _acMerchants = result.rows;
    _acMerchantsLoaded = true;
    renderMerchantList();
    renderMerchantLoadMore(result.hasMore);
  } catch (err) {
    if (host) host.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger vos marchands — Réessayer"));
  }
}

// --- Sélection marchand : recharge propre, garde anti-obsolescence --------

async function selectMerchant(merchantId) {
  if (!merchantId) return;
  invalidateDossierDetail();
  invalidateBulkModule();
  _acCurrentMerchantId = merchantId;
  const seq = ++_acMerchantSeq;
  renderMerchantList();
  const contentHost = document.querySelector("#acContentHost");
  if (contentHost) contentHost.innerHTML = loading("Chargement du marchand…");
  let ctx;
  try {
    ctx = await agentGetMerchantOperationalContext(merchantId);
  } catch (err) {
    if (seq !== _acMerchantSeq) return;
    if (contentHost) contentHost.innerHTML = `<div class="portal-card">${errorBox(agentErrorMessageFr(err?.message, "Impossible de charger ce marchand."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="acMerchantRetry">Réessayer</button></div></div>`;
    document.querySelector("#acMerchantRetry")?.addEventListener("click", () => selectMerchant(merchantId));
    return;
  }
  if (seq !== _acMerchantSeq) return; // un autre marchand a été sélectionné entre-temps
  _acCurrentMerchantCtx = ctx;
  renderCatalogShell(ctx, seq);
  await runProductsListSearch(true, seq);
}

// --- Vue catalogue ---------------------------------------------------------

function placementsRow(label, value) {
  return `<div class="settings-section"><div><strong>${esc(label)}</strong></div><span>${esc(value ?? "—")}</span></div>`;
}

// #37 — Catalogue en masse : le module fonctionne uniquement pour le marchand
// sélectionné au moment de son ouverture ; une réponse arrivant après un
// changement de marchand ne doit jamais s'afficher (isStale couvre les deux :
// changement de marchand ET sortie du module vers un autre écran Agent).
function openBulkCatalogModule(merchantId, seq) {
  const host = document.querySelector("#acContentHost");
  if (!host) return;
  const bulkSeq = ++_acBulkModuleSeq;
  renderBulkCatalogModule(host, merchantId, {
    isStale: () => bulkSeq !== _acBulkModuleSeq || seq !== _acMerchantSeq || _acCurrentMerchantId !== merchantId,
    onBack: () => {
      if (bulkSeq !== _acBulkModuleSeq || seq !== _acMerchantSeq || _acCurrentMerchantId !== merchantId || !_acCurrentMerchantCtx) return;
      invalidateBulkModule();
      renderCatalogShell(_acCurrentMerchantCtx, seq);
      runProductsListSearch(true, seq);
    },
  });
}

function renderCatalogShell(merchantCtx, seq) {
  const host = document.querySelector("#acContentHost");
  if (!host) return;
  _acProductSearchTerm = ""; // nouveau marchand = recherche repartie à zéro
  const m = merchantCtx.merchant || {};
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><div><h3 style="margin:0">${esc(m.shop_name || "Marchand")}</h3><p class="muted" style="font-size:10px;margin:3px 0 0">${esc(m.merchant_type || "—")} · ${badge(m.status, m.status === "active" ? "green" : "amber")}</p></div>
        <div class="toolbar-group">
          <button class="btn btn-outline-blue btn-sm" type="button" id="acBulkCatalogBtn"><i data-lucide="layers"></i> Catalogue en masse</button>
          <button class="btn btn-dark btn-sm" type="button" id="acAddProductBtn"><i data-lucide="package-plus"></i> Ajouter un produit</button>
        </div>
      </div>
    </div>
    <div class="portal-card">
      <div class="ac-catalog-toolbar">
        <input class="input" type="search" id="acProductSearch" maxlength="200" placeholder="Rechercher un produit ou un SKU (dans tout le catalogue)…">
      </div>
      <div id="acProductSearchMsg" style="font-size:11px;color:var(--red,#b0122a);display:none;margin-bottom:8px"></div>
      <div id="acProductListHost">${loading("Chargement du catalogue…")}</div>
      <div id="acProductLoadMoreWrap" style="margin-top:10px;text-align:center"></div>
    </div>
    <div id="acDetailHost"></div>
  `;
  refreshIcons();
  document.querySelector("#acAddProductBtn")?.addEventListener("click", () => showCreateProductForm(seq));
  document.querySelector("#acBulkCatalogBtn")?.addEventListener("click", () => openBulkCatalogModule(m.id, seq));
  const searchInput = document.querySelector("#acProductSearch");
  const searchMsg = document.querySelector("#acProductSearchMsg");
  const showSearchError = (t) => { if (searchMsg) { searchMsg.textContent = t; searchMsg.style.display = t ? "" : "none"; } };
  let searchTimer = null;
  // Debounce : chaque nouvelle frappe reset offset=0 et repart d'une recherche
  // serveur fraîche — jamais un filtrage local qui ne verrait que la page
  // déjà chargée (#35B.1 correctif 1).
  searchInput?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const raw = e.target.value || "";
    if (raw.length > PRODUCT_SEARCH_MAX_LENGTH) {
      showSearchError(`Recherche trop longue (${raw.length}/${PRODUCT_SEARCH_MAX_LENGTH} caractères maximum) — raccourcissez le texte.`);
      return; // jamais de troncature silencieuse : on n'envoie rien tant que c'est trop long
    }
    showSearchError("");
    searchTimer = setTimeout(() => {
      _acProductSearchTerm = raw.trim();
      runProductsListSearch(true, seq);
    }, 300);
  });
}

function productRowHtml(p) {
  const canStock = !p.has_variants;
  return `<div class="ac-product-row" data-product-id="${esc(p.id)}">
    <div class="ac-product-thumb"><i data-lucide="package"></i></div>
    <div class="ac-product-main">
      <strong>${esc(p.name)}</strong>
      <small>${esc(p.sku || "Sans SKU")} · ${money(p.retail_price)}${p.stock != null && !p.has_variants ? ` · Stock ${esc(p.stock)}` : ""}</small>
      <div class="ac-product-badges" style="margin-top:5px">
        ${approvalBadge(p.approval_status)}
        ${badge(p.is_active ? "Actif" : "Inactif", p.is_active ? "green" : "")}
        ${p.has_variants ? badge(`${p.variant_count} variante${p.variant_count > 1 ? "s" : ""}`, "blue") : ""}
      </div>
    </div>
    <div class="ac-product-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-action="edit">Modifier</button>
      ${canStock ? `<button class="btn btn-ghost btn-sm" type="button" data-action="stock">Stock</button>` : `<button class="btn btn-ghost btn-sm" type="button" data-action="variants">Variantes</button>`}
      ${p.is_active
        ? `<button class="btn btn-outline-red btn-sm" type="button" data-action="archive">Archiver</button>`
        : `<button class="btn btn-outline-blue btn-sm" type="button" data-action="activate">Activer</button>`}
    </div>
  </div>`;
}

function renderProductList(seq) {
  if (seq !== _acMerchantSeq) return;
  const host = document.querySelector("#acProductListHost");
  if (!host) return;
  // La recherche est désormais entièrement serveur (#35B.1) : _acProductsRows
  // contient déjà exactement le résultat de la recherche en cours, jamais
  // filtré une seconde fois côté client sur la seule page chargée.
  const rows = _acProductsRows;
  const hasSearch = !!_acProductSearchTerm;
  if (!rows.length) {
    host.innerHTML = empty(hasSearch ? "Aucun résultat" : "Aucun produit", hasSearch ? "Aucun produit ne correspond à cette recherche dans tout le catalogue." : "Ce marchand n'a pas encore de produit — ajoutez-en un.");
    refreshIcons();
    return;
  }
  host.innerHTML = rows.map(productRowHtml).join("");
  refreshIcons();
  host.querySelectorAll("[data-product-id]").forEach((row) => {
    const productId = row.dataset.productId;
    row.querySelector('[data-action="edit"]')?.addEventListener("click", () => showProductDetail(productId, seq));
    row.querySelector('[data-action="stock"]')?.addEventListener("click", () => showStockEditor(productId, seq));
    row.querySelector('[data-action="variants"]')?.addEventListener("click", () => showVariantsEditor(productId, seq));
    row.querySelector('[data-action="archive"]')?.addEventListener("click", () => toggleProductActive(productId, false, seq));
    row.querySelector('[data-action="activate"]')?.addEventListener("click", () => toggleProductActive(productId, true, seq));
  });
}

// Retourne true/false (succès/échec) plutôt que d'avaler l'erreur : un
// appelant qui vient de réussir une mutation doit pouvoir distinguer
// "mutation réussie mais refresh échoué" d'un vrai échec (correctif 4).
// L'échec reste aussi affiché ici même pour un appel autonome (recherche/
// pagination directe), qui n'a pas d'autre message à montrer.
async function runProductsListSearch(reset, seq) {
  if (seq !== _acMerchantSeq) return false;
  const localSeq = ++_acProductsSeq;
  const searchTerm = _acProductSearchTerm; // capturé dans la séquence de requête
  const host = document.querySelector("#acProductListHost");
  const wrap = document.querySelector("#acProductLoadMoreWrap");
  const offset = reset ? 0 : _acProductsOffset;
  if (reset) { _acProductsOffset = 0; _acProductsRows = []; if (host) host.innerHTML = loading("Chargement du catalogue…"); }
  try {
    const result = await agentListMerchantProducts(_acCurrentMerchantId, { search: searchTerm || null, limit: PRODUCTS_PAGE_SIZE, offset });
    if (seq !== _acMerchantSeq || localSeq !== _acProductsSeq) return true; // réponse obsolète ignorée, pas un échec
    const merged = reset ? result.rows : _acProductsRows.concat(result.rows);
    const seen = new Set();
    _acProductsRows = merged.filter((p) => { const id = String(p?.id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _acProductsHasMore = result.hasMore;
    _acProductsOffset = offset + result.rows.length;
    renderProductList(seq);
    if (wrap) {
      const total = result.total != null ? ` (${_acProductsRows.length} sur ${result.total})` : "";
      wrap.innerHTML = _acProductsHasMore ? `<button class="btn btn-outline-blue btn-sm" id="acProductLoadMore" type="button">Charger plus${esc(total)}</button>` : "";
      wrap.querySelector("#acProductLoadMore")?.addEventListener("click", (e) => {
        e.currentTarget.disabled = true;
        runProductsListSearch(false, seq);
      });
    }
    return true;
  } catch (err) {
    if (seq !== _acMerchantSeq || localSeq !== _acProductsSeq) return true; // une recherche plus récente a pris le relais
    if (host) host.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger les produits — Réessayer"));
    if (wrap) wrap.innerHTML = "";
    return false;
  }
}

// À appeler après une mutation réussie. Ne masque jamais un échec de
// rafraîchissement : l'appelant reste responsable d'afficher "action réussie,
// actualisation échouée" plutôt que de laisser croire à un échec de l'action.
async function refreshCurrentCatalog(seq) {
  const ok = await runProductsListSearch(true, seq);
  if (!ok) throw new Error("catalog_refresh_failed");
}

// --- Activer / Archiver ----------------------------------------------------

async function toggleProductActive(productId, nextActive, seq) {
  if (seq !== _acMerchantSeq) return;
  try {
    await agentSetProductActive(_acCurrentMerchantId, productId, nextActive);
  } catch (err) {
    showToast(agentErrorMessageFr(err?.message, nextActive ? "Impossible d'activer ce produit." : "Impossible d'archiver ce produit."), "red");
    return;
  }
  showToast(nextActive ? "Produit activé ✓" : "Produit archivé ✓ (réversible)");
  try { await refreshCurrentCatalog(seq); }
  catch { showToast("Action effectuée, mais l'actualisation du catalogue a échoué.", "red"); }
}

// --- Formulaire produit partagé (création + modification) ------------------

function productFormFieldsHtml(categories, p) {
  const keywords = Array.isArray(p?.search_keywords) ? p.search_keywords.join(", ") : "";
  return `
    <div class="customer-grid">
      <div class="field"><label>Catégorie *</label><select class="input" name="category_id" required>${categories.map((c) => `<option value="${esc(c.id)}" ${p && p.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Nom du produit * (1-240 caractères)</label><input class="input" name="name" maxlength="240" required value="${esc(p?.name || "")}"></div>
      <div class="field"><label>SKU (facultatif, 80 caractères max)</label><input class="input" name="sku" maxlength="80" value="${esc(p?.sku || "")}"></div>
    </div>
    <div class="field"><label>Accroche (facultatif)</label><input class="input" name="tagline" value="${esc(p?.tagline || "")}"></div>
    <div class="field"><label>Description (facultatif)</label><textarea class="input" name="description" rows="3">${esc(p?.description || "")}</textarea></div>
    <div class="customer-grid">
      <div class="field"><label>Prix détail (HTG) *</label><input class="input" type="number" name="retail_price" min="0" step="0.01" required value="${esc(p?.retail_price ?? "")}"></div>
      <div class="field"><label>Prix comparé (facultatif)</label><input class="input" type="number" name="compare_at_price" min="0" step="0.01" value="${esc(p?.compare_at_price ?? "")}"></div>
      ${p ? "" : `<div class="field"><label>Stock initial</label><input class="input" type="number" name="stock" min="0" step="1" value="0"></div>`}
    </div>
    <p class="muted" style="font-size:11px">Prix de gros et quantité minimum de gros doivent être renseignés ensemble, ou laissés vides tous les deux.</p>
    <div class="customer-grid">
      <div class="field"><label>Prix de gros (facultatif)</label><input class="input" type="number" name="wholesale_price" min="0" step="0.01" value="${esc(p?.wholesale_price ?? "")}"></div>
      <div class="field"><label>Quantité minimum de gros</label><input class="input" type="number" name="wholesale_min_qty" min="1" step="1" value="${esc(p?.wholesale_min_qty ?? "")}"></div>
    </div>
    <div class="customer-grid">
      <div class="field"><label>Zone de livraison (facultatif)</label><input class="input" name="delivery_zone" value="${esc(p?.delivery_zone || "")}"></div>
      <div class="field"><label>Délai de livraison estimé (jours, facultatif)</label><input class="input" type="number" name="estimated_delivery_days" min="0" step="1" value="${esc(p?.estimated_delivery_days ?? "")}"></div>
    </div>
    <div class="field"><label>Mots-clés de recherche (séparés par des virgules, 30 maximum)</label><input class="input" name="search_keywords" value="${esc(keywords)}"></div>
  `;
}

function readProductForm(form) {
  const fd = new FormData(form);
  const num = (v) => (v === null || v === "" ? null : Number(v));
  const keywordsRaw = String(fd.get("search_keywords") || "").trim();
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    categoryId: fd.get("category_id"),
    name: String(fd.get("name") || "").trim(),
    retailPrice: num(fd.get("retail_price")),
    stock: fd.has("stock") ? num(fd.get("stock")) ?? 0 : undefined,
    sku: String(fd.get("sku") || "").trim() || null,
    tagline: String(fd.get("tagline") || "").trim() || null,
    description: String(fd.get("description") || "").trim() || null,
    wholesalePrice: num(fd.get("wholesale_price")),
    wholesaleMinQty: num(fd.get("wholesale_min_qty")),
    compareAtPrice: num(fd.get("compare_at_price")),
    deliveryZone: String(fd.get("delivery_zone") || "").trim() || null,
    estimatedDeliveryDays: num(fd.get("estimated_delivery_days")),
    searchKeywords: keywords,
    _keywordsCount: keywords.length,
  };
}

// --- Créer un produit --------------------------------------------------

async function showCreateProductForm(seq) {
  if (seq !== _acMerchantSeq) return;
  const detailHost = document.querySelector("#acDetailHost");
  if (!detailHost) return;
  detailHost.innerHTML = loading("Préparation du formulaire…");
  const categories = await getCategoriesCached();
  if (seq !== _acMerchantSeq) return;
  if (!categories.length) { detailHost.innerHTML = errorBox("Impossible de charger les catégories — Réessayer"); return; }
  detailHost.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>Nouveau produit</h3><button class="btn btn-ghost btn-sm" type="button" id="acCancelCreate">Retour au catalogue</button></div>
      <p class="muted" style="font-size:11px">Le produit est publié immédiatement avec le statut « À vérifier ». VinHT peut ensuite le vérifier ou le retirer du catalogue en cas de problème.</p>
      <form id="acCreateProductForm" style="display:flex;flex-direction:column;gap:10px">
        ${productFormFieldsHtml(categories, null)}
        <div id="acCreateMsg" style="font-size:12px;display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="submit">Publier le produit</button></div>
      </form>
    </div>
  `;
  document.querySelector("#acCancelCreate")?.addEventListener("click", () => renderProductList(seq));
  const form = document.querySelector("#acCreateProductForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgBox = document.querySelector("#acCreateMsg");
    const showMsg = (t, ok) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const values = readProductForm(form);
    if (!values.name) { showMsg("Le nom du produit est requis.", false); return; }
    if (values.retailPrice == null) { showMsg("Le prix de détail est requis.", false); return; }
    if (values._keywordsCount > 30) { showMsg(`Trop de mots-clés (${values._keywordsCount}/30 maximum) — retirez-en avant de continuer.`, false); return; }
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let result;
    try {
      result = await agentCreateProduct(_acCurrentMerchantId, values);
    } catch (err) {
      showMsg(agentErrorMessageFr(err?.message, "Impossible de créer ce produit."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    const created = result?.product;
    showToast("Produit publié — contrôle VinHT à venir ✓");
    try {
      await refreshCurrentCatalog(seq);
      if (seq === _acMerchantSeq) renderProductList(seq);
    } catch {
      showMsg(`Produit créé (ID ${esc(created?.id || "")}), mais l'actualisation du catalogue a échoué. Rechargez la page pour le retrouver.`, false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
  });
}

// --- Modifier un produit -------------------------------------------------

async function showProductDetail(productId, seq) {
  if (seq !== _acMerchantSeq) return;
  const detailHost = document.querySelector("#acDetailHost");
  if (!detailHost) return;
  detailHost.innerHTML = loading("Chargement du produit…");
  let ctx, categories;
  try {
    [ctx, categories] = await Promise.all([agentGetProductContext(_acCurrentMerchantId, productId), getCategoriesCached()]);
  } catch (err) {
    if (seq !== _acMerchantSeq) return;
    detailHost.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger ce produit — Réessayer"));
    return;
  }
  if (seq !== _acMerchantSeq) return;
  const p = ctx.product;
  detailHost.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>${esc(p.name)}</h3><button class="btn btn-ghost btn-sm" type="button" id="acCancelEdit">Retour au catalogue</button></div>
      <div class="ac-product-badges" style="margin-bottom:10px">${approvalBadge(p.approval_status)}${badge(p.is_active ? "Actif" : "Inactif", p.is_active ? "green" : "")}</div>
      <div class="empty-state" style="padding:14px;text-align:left;background:#fff8f0;border-color:#f5dfc0">
        <p style="margin:0;font-size:11px">Les modifications seront signalées à VinHT pour un nouveau contrôle. Le produit reste visible s’il était déjà publié, sauf s’il avait précédemment été retiré par VinHT.</p>
      </div>
      <form id="acEditProductForm" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        ${productFormFieldsHtml(categories, p)}
        <div id="acEditMsg" style="font-size:12px;display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="submit">Enregistrer les modifications</button></div>
      </form>
    </div>
  `;
  document.querySelector("#acCancelEdit")?.addEventListener("click", () => renderProductList(seq));
  const form = document.querySelector("#acEditProductForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msgBox = document.querySelector("#acEditMsg");
    const showMsg = (t, ok) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const values = readProductForm(form);
    if (!values.name) { showMsg("Le nom du produit est requis.", false); return; }
    if (values.retailPrice == null) { showMsg("Le prix de détail est requis.", false); return; }
    if (values._keywordsCount > 30) { showMsg(`Trop de mots-clés (${values._keywordsCount}/30 maximum) — retirez-en avant de continuer.`, false); return; }
    if (!window.confirm("Les modifications seront signalées à VinHT pour un nouveau contrôle. Le produit reste visible s’il était déjà publié, sauf s’il avait précédemment été retiré par VinHT.")) return;
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let result;
    try {
      result = await agentUpdateProductContent(_acCurrentMerchantId, productId, values);
    } catch (err) {
      showMsg(agentErrorMessageFr(err?.message, "Impossible d'enregistrer ces modifications."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast(`Produit mis à jour — ${approvalLabel(result?.product?.approval_status || "pending")} ✓`);
    btn.dataset.submitting = ""; btn.disabled = false;
    try {
      await refreshCurrentCatalog(seq);
      if (seq === _acMerchantSeq) showProductDetail(productId, seq);
    } catch {
      showMsg("Modifications enregistrées, mais l'actualisation a échoué. Rechargez la page.", false);
    }
  });
}

// --- Stock simple (produit sans variantes) --------------------------------

async function showStockEditor(productId, seq) {
  if (seq !== _acMerchantSeq) return;
  const detailHost = document.querySelector("#acDetailHost");
  if (!detailHost) return;
  detailHost.innerHTML = loading("Chargement du stock…");
  let ctx;
  try { ctx = await agentGetProductContext(_acCurrentMerchantId, productId); }
  catch (err) {
    if (seq !== _acMerchantSeq) return;
    detailHost.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger ce produit — Réessayer"));
    return;
  }
  if (seq !== _acMerchantSeq) return;
  const p = ctx.product;
  if (p.has_variants) {
    // État obsolète (le produit a acquis des variantes entre-temps) : rediriger
    // proprement plutôt que d'appeler la mauvaise RPC.
    showVariantsEditor(productId, seq);
    return;
  }
  detailHost.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>${esc(p.name)}</h3><button class="btn btn-ghost btn-sm" type="button" id="acCancelStock">Retour au catalogue</button></div>
      <p class="muted" style="font-size:11px">Stock actuel : ${esc(p.stock)}</p>
      <div class="ac-stock-stepper">
        <button type="button" id="acStockMinus" aria-label="Diminuer">−</button>
        <input type="number" id="acStockValue" min="0" step="1" value="${esc(p.stock)}">
        <button type="button" id="acStockPlus" aria-label="Augmenter">+</button>
      </div>
      <div id="acStockMsg" style="font-size:12px;display:none;text-align:center"></div>
      <div class="toolbar-group" style="justify-content:center"><button class="btn btn-dark btn-sm" type="button" id="acStockSave">Enregistrer</button></div>
    </div>
  `;
  const input = document.querySelector("#acStockValue");
  document.querySelector("#acCancelStock")?.addEventListener("click", () => renderProductList(seq));
  document.querySelector("#acStockMinus")?.addEventListener("click", () => { input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1); });
  document.querySelector("#acStockPlus")?.addEventListener("click", () => { input.value = (parseInt(input.value, 10) || 0) + 1; });
  document.querySelector("#acStockSave")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const msgBox = document.querySelector("#acStockMsg");
    const showMsg = (t, ok) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const nextStock = parseInt(input.value, 10);
    if (!Number.isFinite(nextStock) || nextStock < 0) { showMsg("Stock invalide.", false); return; }
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    try {
      await agentSetProductStock(_acCurrentMerchantId, productId, nextStock);
    } catch (err) {
      showMsg(agentErrorMessageFr(err?.message, "Impossible d'enregistrer ce stock."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast("Stock mis à jour ✓");
    btn.dataset.submitting = ""; btn.disabled = false;
    try { await refreshCurrentCatalog(seq); } catch { showMsg("Stock enregistré, mais l'actualisation du catalogue a échoué.", false); }
  });
}

// --- Variantes ---------------------------------------------------------
// Deux opérations distinctes, jamais mélangées (correctif 2) :
//  - stock/actif d'une variante EXISTANTE -> agent_update_product_variant_inventory_v1
//  - ajouter/retirer/renommer une combinaison (structure) -> agent_replace_product_variants_v1
// Le stock rapide ne doit jamais passer par le remplacement structurel.

function optionsSummary(options) {
  const entries = Object.entries(options || {}).filter(([, v]) => v);
  return entries.length ? entries.map(([k, v]) => `${k} : ${esc(v)}`).join(" · ") : "Variante";
}

function variantInventoryRowHtml(v) {
  return `<div class="ac-variant-row" data-variant-id="${esc(v.id)}">
    <div><strong>${optionsSummary(v.options)}</strong><br><small class="muted">SKU ${esc(v.sku || "—")}</small></div>
    <div class="ac-variant-fields" style="grid-template-columns:110px auto auto">
      <div class="field"><label>Stock</label><input class="input variant-inv-stock" type="number" min="0" step="1" value="${esc(v.stock ?? 0)}"></div>
      <label style="font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" class="variant-inv-active" ${v.is_active !== false ? "checked" : ""}> Actif</label>
      <button type="button" class="btn btn-dark btn-sm variant-inv-save">Enregistrer le stock</button>
    </div>
    <div class="variant-inv-msg" style="font-size:11px;display:none"></div>
  </div>`;
}

function renderInventoryRows(host, merchantId, variants, seq) {
  if (!variants.length) { host.innerHTML = `<p class="muted" style="font-size:12px">Aucune variante existante — utilisez "Modifier la structure des variantes" pour en créer.</p>`; return; }
  host.innerHTML = variants.map(variantInventoryRowHtml).join("");
  let saving = false; // sérialise les sauvegardes stock sur ce produit — jamais deux mutations inventory concurrentes
  host.querySelectorAll(".ac-variant-row").forEach((row) => {
    const variantId = row.dataset.variantId;
    const saveBtn = row.querySelector(".variant-inv-save");
    const msgEl = row.querySelector(".variant-inv-msg");
    const showMsg = (t, ok) => { if (msgEl) { msgEl.textContent = t; msgEl.style.display = ""; msgEl.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    saveBtn?.addEventListener("click", async () => {
      if (saving) return;
      const stock = parseInt(row.querySelector(".variant-inv-stock")?.value, 10);
      const isActive = !!row.querySelector(".variant-inv-active")?.checked;
      if (!Number.isFinite(stock) || stock < 0) { showMsg("Stock invalide.", false); return; }
      saving = true;
      const allSaveBtns = host.querySelectorAll(".variant-inv-save");
      allSaveBtns.forEach((b) => { b.disabled = true; });
      let result;
      try {
        result = await agentUpdateProductVariantInventory(merchantId, variantId, stock, isActive);
      } catch (err) {
        showMsg(agentErrorMessageFr(err?.message, "Impossible d'enregistrer ce stock."), false);
        saving = false;
        allSaveBtns.forEach((b) => { b.disabled = false; });
        return;
      }
      showMsg(`Enregistré ✓ (stock total produit : ${result?.variant?.product_total_stock ?? "—"})`, true);
      saving = false;
      allSaveBtns.forEach((b) => { b.disabled = false; });
      // Le stock total du produit a changé côté serveur : le catalogue
      // (déjà chargé) reste obsolète tant qu'il n'est pas rechargé via le
      // mécanisme officiel — jamais un second appel concurrent si l'Agent
      // reclique vite (le flag `saving` par ligne protège déjà la mutation
      // elle-même ; ce refresh est lui-même toujours single-flight via la
      // séquence produits de runProductsListSearch).
      try {
        await refreshCurrentCatalog(seq);
      } catch {
        showMsg("Stock enregistré, mais l'actualisation du catalogue a échoué.", false);
      }
    });
  });
}

function variantStructureRowHtml(v, optionNames, index) {
  const opts = v.options || {};
  return `<div class="ac-variant-row" data-variant-index="${index}" data-variant-id="${esc(v.id || "")}">
    <div class="ac-variant-options">
      ${optionNames.map((name) => `<div class="field"><label>${esc(name)}</label><input class="input variant-option-input" data-option-name="${esc(name)}" value="${esc(opts[name] || "")}"></div>`).join("")}
    </div>
    <div class="ac-variant-fields">
      <div class="field"><label>SKU</label><input class="input variant-sku-input" value="${esc(v.sku || "")}"></div>
      <div class="field"><label>Stock</label><input class="input variant-stock-input" type="number" min="0" step="1" value="${esc(v.stock ?? 0)}"></div>
      <label style="font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" class="variant-active-input" ${v.is_active !== false ? "checked" : ""}> Actif</label>
      <button type="button" class="btn btn-outline-red btn-sm variant-remove-btn">Retirer</button>
    </div>
  </div>`;
}

function collectOptionNames(variants) {
  for (const v of variants) {
    const keys = Object.keys(v.options || {});
    if (keys.length) return keys;
  }
  return ["Option 1"];
}

function renderVariantStructureRows(host, variants, optionNames) {
  host.innerHTML = variants.map((v, i) => variantStructureRowHtml(v, optionNames, i)).join("") || `<p class="muted" style="font-size:12px">Aucune variante — ajoutez-en une.</p>`;
  host.querySelectorAll(".variant-remove-btn").forEach((btn) => btn.addEventListener("click", () => { btn.closest(".ac-variant-row")?.remove(); }));
}

async function showVariantsEditor(productId, seq) {
  if (seq !== _acMerchantSeq) return;
  const detailHost = document.querySelector("#acDetailHost");
  if (!detailHost) return;
  detailHost.innerHTML = loading("Chargement des variantes…");
  let ctx;
  try { ctx = await agentGetProductContext(_acCurrentMerchantId, productId); }
  catch (err) {
    if (seq !== _acMerchantSeq) return;
    detailHost.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger ce produit — Réessayer"));
    return;
  }
  if (seq !== _acMerchantSeq) return;
  const p = ctx.product;
  let variants = (ctx.variants || []).map((v) => ({ id: v.id, sku: v.sku, stock: v.stock, is_active: v.is_active, options: v.options }));
  let optionNames = collectOptionNames(variants);
  const merchantId = _acCurrentMerchantId;

  detailHost.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>${esc(p.name)} — Stock des variantes</h3><button class="btn btn-ghost btn-sm" type="button" id="acCancelVariants">Retour au catalogue</button></div>
      <p class="muted" style="font-size:11px">Modifiez rapidement le stock ou l'état actif d'une combinaison existante. Pour ajouter/retirer une combinaison ou changer un SKU/des options, utilisez « Modifier la structure des variantes » ci-dessous.</p>
      <div id="acVariantInventoryHost"></div>
    </div>
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">Structure des variantes</h3><button class="btn btn-outline-blue btn-sm" type="button" id="acToggleStructure">Modifier la structure des variantes</button></div>
      <div id="acVariantStructureHost" hidden>
        <p class="muted" style="font-size:11px">Toutes les variantes d'un même produit doivent utiliser les mêmes noms d'options (ex. Taille, Couleur). Les changements de structure seront signalés à VinHT pour un nouveau contrôle. Le produit reste visible s’il était déjà publié, sauf s’il avait précédemment été retiré par VinHT.</p>
        <div class="field" style="max-width:320px"><label>Noms des options (séparés par des virgules, 1 à 3 maximum)</label><input class="input" id="acVariantOptionNames" value="${esc(optionNames.join(", "))}"></div>
        <div id="acVariantOptionNamesMsg" style="font-size:11px;color:var(--red,#b0122a);display:none;margin-top:4px"></div>
        <div id="acVariantRowsHost" style="margin-top:10px"></div>
        <div class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" id="acAddVariantRow">Ajouter une variante</button></div>
        <div id="acVariantsMsg" style="font-size:12px;display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="button" id="acSaveVariants">Enregistrer la structure</button></div>
      </div>
    </div>
  `;
  renderInventoryRows(document.querySelector("#acVariantInventoryHost"), merchantId, variants, seq);

  document.querySelector("#acCancelVariants")?.addEventListener("click", () => renderProductList(seq));

  const structureHost = document.querySelector("#acVariantStructureHost");
  const toggleBtn = document.querySelector("#acToggleStructure");
  let structureRendered = false;
  toggleBtn?.addEventListener("click", () => {
    const nowHidden = !structureHost.hidden;
    structureHost.hidden = nowHidden;
    toggleBtn.textContent = nowHidden ? "Modifier la structure des variantes" : "Masquer la structure";
    if (!nowHidden && !structureRendered) {
      structureRendered = true;
      renderVariantStructureRows(document.querySelector("#acVariantRowsHost"), variants, optionNames);
    }
  });

  const rowsHost = document.querySelector("#acVariantRowsHost");
  document.querySelector("#acVariantOptionNames")?.addEventListener("change", (e) => {
    const namesMsgEl = document.querySelector("#acVariantOptionNamesMsg");
    const showNamesMsg = (t) => { if (namesMsgEl) { namesMsgEl.textContent = t; namesMsgEl.style.display = t ? "" : "none"; } };
    const raw = String(e.target.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (raw.length > 3) {
      // Jamais de troncature silencieuse (correctif 3) : on refuse le
      // changement et on revient à la dernière liste valide.
      showNamesMsg("Maximum 3 options par variante — retirez-en avant de continuer.");
      e.target.value = optionNames.join(", ");
      return;
    }
    showNamesMsg("");
    const newNames = raw.length ? raw : ["Option 1"];
    // Les inputs du DOM portent encore les data-option-name DE L'ANCIENNE
    // liste : il faut lire leurs valeurs avec les anciens noms AVANT de
    // remplacer optionNames, sinon chaque valeur se retrouve associée à un
    // nom qui n'existe pas encore et disparaît silencieusement.
    const previousNames = optionNames;
    const rowsWithOldNames = collectRowsFromDom(rowsHost, previousNames);
    const remapped = remapVariantRowsOptions(rowsWithOldNames, previousNames, newNames);
    optionNames = newNames;
    renderVariantStructureRows(rowsHost, remapped, optionNames);
  });
  document.querySelector("#acAddVariantRow")?.addEventListener("click", () => {
    const current = collectRowsFromDom(rowsHost, optionNames);
    current.push({ sku: "", stock: 0, is_active: true, options: {} });
    renderVariantStructureRows(rowsHost, current, optionNames);
  });

  document.querySelector("#acSaveVariants")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const msgBox = document.querySelector("#acVariantsMsg");
    const showMsg = (t, ok) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const rows = collectRowsFromDom(rowsHost, optionNames);
    if (!rows.length) { showMsg("Ajoutez au moins une variante, ou retirez toutes les combinaisons via une nouvelle demande si le produit ne doit plus avoir de variantes.", false); return; }
    for (const r of rows) {
      if (!r.sku) { showMsg("Chaque variante doit avoir un SKU.", false); return; }
      if (!Number.isFinite(r.stock) || r.stock < 0) { showMsg("Chaque variante doit avoir un stock valide.", false); return; }
    }
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let result;
    try {
      result = await agentReplaceProductVariants(merchantId, productId, rows.map((r, i) => ({ sku: r.sku, stock: r.stock, isActive: r.is_active, position: i, options: r.options })));
    } catch (err) {
      showMsg(agentErrorMessageFr(err?.message, "Impossible d'enregistrer cette structure."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast(`Structure enregistrée — stock total ${result?.total_stock ?? "—"} ✓`);
    btn.dataset.submitting = ""; btn.disabled = false;
    try {
      await refreshCurrentCatalog(seq);
      if (seq === _acMerchantSeq) showVariantsEditor(productId, seq);
    } catch {
      showMsg("Structure enregistrée, mais l'actualisation du catalogue a échoué. Rechargez la page.", false);
    }
  });
}

// Renommer/ajouter/retirer une dimension d'option ne doit jamais faire
// disparaître silencieusement les valeurs déjà saisies (correctif 2, second
// bug) : on préserve chaque valeur PAR POSITION entre l'ancienne et la
// nouvelle liste de noms. Une dimension ajoutée à la fin part vide ; une
// dimension retirée à la fin est simplement abandonnée (l'utilisateur vient
// de le demander explicitement en éditant le champ des noms).
function remapVariantRowsOptions(rows, oldNames, newNames) {
  return rows.map((r) => {
    const oldOptions = r.options || {};
    const newOptions = {};
    newNames.forEach((name, i) => {
      const oldName = oldNames[i];
      newOptions[name] = oldName != null ? (oldOptions[oldName] ?? "") : "";
    });
    return { ...r, options: newOptions };
  });
}

function collectRowsFromDom(rowsHost, optionNames) {
  return [...rowsHost.querySelectorAll(".ac-variant-row")].map((row) => {
    const options = {};
    row.querySelectorAll(".variant-option-input").forEach((input) => {
      const name = input.dataset.optionName;
      if (name) options[name] = input.value.trim();
    });
    // Si les noms d'options ont changé et que la ligne n'a pas encore ces
    // champs (nouvelle ligne ajoutée après renommage), garantir les clés.
    optionNames.forEach((name) => { if (!(name in options)) options[name] = options[name] || ""; });
    return {
      sku: (row.querySelector(".variant-sku-input")?.value || "").trim(),
      stock: parseInt(row.querySelector(".variant-stock-input")?.value, 10),
      is_active: !!row.querySelector(".variant-active-input")?.checked,
      options,
    };
  });
}

// --- Auth / gate / boot --------------------------------------------------

function authGateHtml() {
  return `<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous avec votre compte Agent VinHT pour accéder au Centre Agent.</p><button class="btn btn-dark" type="button" id="acLoginBtn">Se connecter</button></div>`;
}
function notAgentGateHtml(state) {
  const text = state === "suspended" ? "Votre compte Agent est actuellement suspendu."
    : state === "closed" ? "Votre compte Agent est fermé."
    : "Cet espace est réservé aux Agents VinHT actifs. Votre compte n'a pas ce rôle actuellement.";
  return `<div class="empty-state"><div class="empty-icon"><i data-lucide="shield-off"></i></div><h3>Accès Agent requis</h3><p>${esc(text)}</p></div>`;
}

// Candidature Agent : l'état vient du backend (agent_get_my_context_v1 →
// state, application, capabilities). Le front n'invente aucune règle
// d'éligibilité : il n'offre le formulaire que si capabilities.can_apply === true.
function agentApplicationFormHtml(_ctx, prefill = {}) {
  return `<div class="portal-card" style="max-width:560px;margin:0 auto;text-align:left">
    <h3 style="margin-top:0">Devenir Agent VinHT</h3>
    <p class="muted" style="font-size:12px">Un Agent accompagne des commerçants : création de dossiers, catalogue, invitation. Votre candidature est examinée par l'équipe VinHT.</p>
    <form id="acApplyForm" style="display:flex;flex-direction:column;gap:8px">
      <div class="field"><label>Nom affiché *</label><input class="input" name="display_name" required maxlength="120" value="${esc(prefill.display_name || "")}"></div>
      <div class="field"><label>Téléphone *</label><input class="input" name="phone" required maxlength="40" value="${esc(prefill.phone || "")}"></div>
      <div class="field"><label>Adresse *</label><input class="input" name="address_line1" required maxlength="240" placeholder="Rue, numéro, repère" value="${esc(prefill.address_line1 || "")}"></div>
      <div class="customer-grid">
        <div class="field"><label>Département *</label><input class="input" name="department" required data-geo="department" maxlength="80" autocomplete="off" value="${esc(prefill.department || "")}"></div>
        <div class="field"><label>Commune *</label><input class="input" name="commune" required data-geo="commune" maxlength="80" autocomplete="off" value="${esc(prefill.commune || "")}"></div>
      </div>
      <div id="acApplyMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-blue" type="submit">Envoyer ma candidature</button></div>
    </form>
  </div>`;
}

function agentApplicationGate(ctx) {
  const latest = ctx.application || null;
  const status = String(latest?.status || "");
  const reason = String(latest?.review_reason || "").trim();
  const canApply = ctx.capabilities?.can_apply === true;
  const back = () => `<div class="toolbar-group" style="justify-content:center;margin-top:10px"><a class="btn btn-ghost btn-sm" href="../account.html">Retour à mon compte</a></div>`;
  if (ctx.state === "active") return null;
  if (status === "pending_review" || ctx.state === "application_pending_review") {
    return `<div class="empty-state"><div class="empty-icon"><i data-lucide="hourglass"></i></div><h3>Candidature en cours d'examen</h3><p>Votre candidature Agent a bien été reçue. L'équipe VinHT l'examine ; vous pourrez utiliser le Centre Agent dès son approbation.</p>${back()}</div>`;
  }
  if (canApply) {
    const rejected = status === "rejected";
    const intro = rejected
      ? `<div class="empty-state" style="padding-bottom:0"><h3>Candidature non retenue</h3><p>${esc(reason || "Votre précédente candidature n'a pas été retenue.")}</p><p class="muted" style="font-size:12px">Vous pouvez corriger vos informations et déposer une nouvelle candidature.</p></div>`
      : "";
    return intro + agentApplicationFormHtml(ctx, latest || {});
  }
  if (status === "approved") {
    return `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Candidature approuvée, accès en cours d'activation</h3><p>Votre candidature est approuvée mais votre profil Agent n'est pas encore actif. Contactez le support VinHT si cela persiste.</p>${back()}</div>`;
  }
  return null;
}

function mountAgentApplication(ctx) {
  const html = agentApplicationGate(ctx);
  if (!html) return false;
  gate(html);
  attachGeoHints(document.querySelector("[data-agent-gate]"));
  const form = document.querySelector("#acApplyForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const msg = document.querySelector("#acApplyMsg");
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true; msg.style.display = "none";
    try {
      await submitMyAgentApplication({
        displayName: (fd.get("display_name") || "").trim(),
        phone: (fd.get("phone") || "").trim(),
        addressLine1: (fd.get("address_line1") || "").trim(),
        department: (fd.get("department") || "").trim(),
        commune: (fd.get("commune") || "").trim(),
      });
      showToast("Candidature envoyée ✓");
      invalidateAccessContext();
      await boot();
    } catch (err) {
      msg.textContent = agentErrorMessageFr(err?.message, "Impossible d'envoyer votre candidature.");
      msg.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
    }
  });
  return true;
}

// --- #36B — Nouveaux marchands (dossiers assistés par un Agent) ------------
// Module indépendant de la sélection marchand : un dossier n'a pas encore de
// marchand tant qu'il n'est pas réclamé (claim), le déclenchement (trigger
// backend) rattache alors l'Agent automatiquement — le frontend ne recrée
// jamais cette affectation lui-même.

function dossierRowHtml(d) {
  const p = d.profile || {};
  const cls = d.status === "claimed" ? "green" : d.status === "cancelled" ? "red" : d.status === "invited" ? "blue" : d.status === "ready_for_invite" ? "amber" : "";
  return `<div class="settings-section" data-dossier-id="${esc(d.id)}" style="cursor:pointer">
    <div><strong>${esc(p.full_name || "—")}</strong><p>${esc(p.shop_name || "—")} · ${esc(p.merchant_type || "—")}</p></div>
    ${badge(ASSISTED_DOSSIER_STATUS_FR[d.status] || d.status, cls)}
  </div>`;
}

function renderDossierLoadMore() {
  const wrap = document.querySelector("#acDossierLoadMoreWrap");
  if (!wrap) return;
  wrap.innerHTML = _acDossierHasMore ? `<button class="btn btn-ghost btn-sm" id="acDossierLoadMore" type="button">Charger plus</button>` : "";
  wrap.querySelector("#acDossierLoadMore")?.addEventListener("click", () => runDossiersListSearch(false));
}

async function runDossiersListSearch(reset) {
  const host = document.querySelector("#acDossierListHost");
  if (!host) return false;
  const seq = ++_acDossierSeq;
  const offset = reset ? 0 : _acDossierOffset;
  if (reset) { _acDossierOffset = 0; _acDossierRows = []; host.innerHTML = loading("Chargement des dossiers…"); }
  else { const b = document.querySelector("#acDossierLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await agentListMyAssistedMerchantDossiers({ status: _acDossierStatusFilter || null, limit: DOSSIER_PAGE_SIZE, offset });
    if (seq !== _acDossierSeq) return true;
    const merged = reset ? result.rows : _acDossierRows.concat(result.rows);
    const seen = new Set();
    _acDossierRows = merged.filter((r) => { const id = String(r?.id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _acDossierHasMore = result.hasMore;
    _acDossierOffset = offset + result.rows.length;
    if (!_acDossierRows.length) { host.innerHTML = empty("Aucun dossier", "Créez votre premier dossier marchand assisté."); renderDossierLoadMore(); refreshIcons(); return true; }
    host.innerHTML = _acDossierRows.map(dossierRowHtml).join("");
    host.querySelectorAll("[data-dossier-id]").forEach((row) => row.addEventListener("click", () => showDossierDetail(row.dataset.dossierId)));
    refreshIcons();
    renderDossierLoadMore();
    return true;
  } catch (err) {
    if (seq !== _acDossierSeq) return true;
    host.innerHTML = errorBox(agentErrorMessageFr(err?.message, "Impossible de charger vos dossiers marchands."));
    renderDossierLoadMore();
    return false;
  }
}

function dossierFormFieldsHtml(prefill = {}) {
  return `
    <div class="field"><label>Nom du commerçant *</label><input class="input" name="full_name" required maxlength="160" value="${esc(prefill.full_name || "")}"></div>
    <div class="field"><label>Nom de la boutique *</label><input class="input" name="shop_name" required maxlength="160" value="${esc(prefill.shop_name || "")}"></div>
    <div class="field"><label>Type de marchand *</label><select class="input" name="merchant_type" required>
      <option value="">Choisir…</option>
      <option value="producteur" ${prefill.merchant_type === "producteur" ? "selected" : ""}>Producteur</option>
      <option value="revendeur" ${prefill.merchant_type === "revendeur" ? "selected" : ""}>Revendeur</option>
      <option value="vendeur" ${prefill.merchant_type === "vendeur" ? "selected" : ""}>Vendeur</option>
    </select></div>
    <div class="customer-grid">
      <div class="field"><label>Téléphone</label><input class="input" name="phone" maxlength="40" value="${esc(prefill.phone || "")}"></div>
      <div class="field"><label>WhatsApp</label><input class="input" name="whatsapp_number" maxlength="40" value="${esc(prefill.whatsapp_number || "")}"></div>
    </div>
    <div class="field"><label>Email (nécessaire pour l'invitation)</label><input class="input" type="email" name="email" maxlength="254" value="${esc(prefill.email || "")}"></div>
    <div class="field"><label>Adresse du commerce *</label><input class="input" name="business_address_line1" maxlength="240" placeholder="Rue, numéro, repère" value="${esc(prefill.business_address_line1 || "")}"></div>
    <div class="customer-grid">
      <div class="field"><label>Département *</label><input class="input" name="business_department" data-geo="department" maxlength="80" autocomplete="off" value="${esc(prefill.business_department || "")}"></div>
      <div class="field"><label>Commune *</label><input class="input" name="business_commune" data-geo="commune" maxlength="80" autocomplete="off" value="${esc(prefill.business_commune || "")}"></div>
    </div>
    <p class="muted" style="font-size:11px">Téléphone ou WhatsApp obligatoire (au moins un des deux). L'adresse complète du commerce (adresse, département, commune) est nécessaire pour marquer le dossier prêt. Aucun mot de passe ni code n'est jamais saisi ici.</p>
  `;
}

function renderOnboardingShell() {
  const host = document.querySelector("#acContentHost");
  if (!host) return;
  invalidateDossierDetail();
  invalidateBulkModule();
  _acDossierStatusFilter = "";
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar">
        <div><h3 style="margin:0">Nouveaux marchands</h3><p class="muted" style="font-size:10px;margin:3px 0 0">Onboarding assisté par Agent — aucune finance, aucun document KYC, aucun mot de passe.</p></div>
        <button class="btn btn-dark btn-sm" type="button" id="acNewDossierBtn"><i data-lucide="user-plus"></i> Nouveau marchand</button>
      </div>
      <div class="toolbar-group" style="margin-top:6px">
        <select class="input" id="acDossierStatusFilter">
          <option value="">Tous statuts</option>
          <option value="draft">Brouillon</option>
          <option value="ready_for_invite">Prêt pour invitation</option>
          <option value="invited">Invité</option>
          <option value="claimed">Réclamé</option>
          <option value="cancelled">Annulé</option>
        </select>
      </div>
    </div>
    <div class="portal-card">
      <div id="acDossierListHost"></div>
      <div id="acDossierLoadMoreWrap" style="margin-top:8px"></div>
    </div>
  `;
  refreshIcons();
  document.querySelector("#acNewDossierBtn")?.addEventListener("click", showCreateDossierForm);
  document.querySelector("#acDossierStatusFilter")?.addEventListener("change", (e) => {
    _acDossierStatusFilter = e.target.value || "";
    runDossiersListSearch(true);
  });
  runDossiersListSearch(true);
}

function openOnboardingModule() {
  _acCurrentMerchantId = null;
  renderMerchantList();
  renderOnboardingShell();
}

function showCreateDossierForm() {
  const host = document.querySelector("#acContentHost");
  if (!host) return;
  invalidateDossierDetail();
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">Nouveau marchand</h3><button class="btn btn-ghost btn-sm" type="button" id="acDossierBack">Retour à la liste</button></div>
      <form id="acDossierCreateForm" style="display:flex;flex-direction:column;gap:8px">
        ${dossierFormFieldsHtml()}
        <div id="acDossierCreateMsg" class="error-state" style="display:none"></div>
        <div class="toolbar-group"><button class="btn btn-blue" type="submit">Créer le dossier</button></div>
      </form>
    </div>
  `;
  refreshIcons();
  attachGeoHints(host);
  document.querySelector("#acDossierBack")?.addEventListener("click", renderOnboardingShell);
  const form = document.querySelector("#acDossierCreateForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const msgBox = document.querySelector("#acDossierCreateMsg");
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    msgBox.style.display = "none";
    try {
      const result = await agentCreateAssistedMerchantDossier({
        fullName: (fd.get("full_name") || "").trim(),
        shopName: (fd.get("shop_name") || "").trim(),
        merchantType: fd.get("merchant_type"),
        phone: (fd.get("phone") || "").trim(),
        whatsappNumber: (fd.get("whatsapp_number") || "").trim(),
        email: (fd.get("email") || "").trim(),
        businessAddressLine1: (fd.get("business_address_line1") || "").trim(),
        businessDepartment: (fd.get("business_department") || "").trim(),
        businessCommune: (fd.get("business_commune") || "").trim(),
      });
      showToast(result?.mutation?.reused ? "Dossier existant réutilisé ✓" : "Dossier créé ✓");
      await showDossierDetail(result.dossier.id);
    } catch (err) {
      msgBox.textContent = agentErrorMessageFr(err?.message, "Impossible de créer ce dossier.");
      msgBox.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
    }
  });
}

function dossierProgressHtml(d) {
  const pr = d.progress || {};
  const rows = [
    ["Contact complet", pr.contact_complete],
    ["Boutique complète", pr.shop_complete],
    ...(pr.address_complete === undefined ? [] : [["Adresse du commerce complète", pr.address_complete]]),
    ["Prêt pour invitation", pr.ready_for_invite],
    ["Compte réclamé", pr.account_claimed],
  ];
  return `<div class="portal-card"><h3>Progression</h3>${rows.map(([label, val]) => `<div class="settings-section"><div><strong>${esc(label)}</strong></div>${badge(val ? "Oui" : "Non", val ? "green" : "")}</div>`).join("")}
    ${d.capabilities?.agent_can_view_kyc_status && pr.kyc_status ? `<div class="settings-section"><div><strong>Statut KYC</strong></div>${badge(pr.kyc_status)}</div>` : ""}
  </div>`;
}

function dossierActivationHtml(d) {
  const a = d.activation || {};
  const caps = d.capabilities || {};
  const canInvite = (d.status === "ready_for_invite" || d.status === "invited") && a.email_available;
  return `<div class="portal-card">
    <h3>Activation</h3>
    <div class="settings-section"><div><strong>Email disponible</strong></div>${badge(a.email_available ? "Oui" : "Non", a.email_available ? "green" : "red")}</div>
    ${a.invited_at ? `<div class="settings-section"><div><strong>Invité le</strong><p>${esc(fmtDate(a.invited_at))}</p></div>${a.claimed_at ? badge("Réclamé", "green") : badge("En attente", "amber")}</div>` : ""}
    ${!a.email_available ? `<p class="muted" style="font-size:11px">Ajoutez un e-mail dans les informations du dossier pour pouvoir envoyer l'invitation.</p>` : ""}
    <div id="acDossierInviteMsg" style="font-size:12px;display:none;margin-top:6px"></div>
    <div class="toolbar-group" style="margin-top:8px;flex-wrap:wrap">
      ${caps.agent_can_mark_ready && d.status === "draft" ? `<button class="btn btn-outline-blue btn-sm" type="button" id="acDossierMarkReady">Marquer prêt</button>` : ""}
      ${canInvite ? `<button class="btn btn-dark btn-sm" type="button" id="acDossierInvite">${d.status === "invited" ? "Renvoyer l'invitation" : "Envoyer l'invitation"}</button>` : ""}
    </div>
    <p class="muted" style="font-size:10px;margin-top:8px">L'Agent ne définit jamais de mot de passe et ne réclame jamais le compte à la place du marchand.</p>
  </div>`;
}

async function showDossierDetail(dossierId) {
  const host = document.querySelector("#acContentHost");
  if (!host) return;
  const seq = ++_acDossierDetailSeq;
  _acDossierDetailId = dossierId;
  const stale = () => seq !== _acDossierDetailSeq || _acDossierDetailId !== dossierId;
  host.innerHTML = loading("Chargement du dossier…");
  let ctx;
  try {
    ctx = await agentGetAssistedMerchantDossier(dossierId);
  } catch (err) {
    if (stale()) return;
    host.innerHTML = `<div class="portal-card">${errorBox(agentErrorMessageFr(err?.message, "Impossible de charger ce dossier."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="acDossierRetry">Réessayer</button><button class="btn btn-ghost btn-sm" type="button" id="acDossierBack2">Retour à la liste</button></div></div>`;
    document.querySelector("#acDossierRetry")?.addEventListener("click", () => showDossierDetail(dossierId));
    document.querySelector("#acDossierBack2")?.addEventListener("click", renderOnboardingShell);
    return;
  }
  if (stale()) return;
  const d = ctx.dossier || {};
  const p = d.profile || {};
  const canEdit = !!d.capabilities?.agent_can_edit;
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">${esc(p.full_name || "Dossier")}</h3><button class="btn btn-ghost btn-sm" type="button" id="acDossierBack">Retour à la liste</button></div>
      <div class="settings-section"><div><strong>${esc(p.shop_name || "—")}</strong><p>${esc(p.merchant_type || "—")}</p></div>${badge(ASSISTED_DOSSIER_STATUS_FR[d.status] || d.status)}</div>
    </div>
    <div class="portal-card">
      <h3>Informations</h3>
      <form id="acDossierEditForm" style="display:flex;flex-direction:column;gap:8px;${canEdit ? "" : "opacity:.6;pointer-events:none"}">
        ${dossierFormFieldsHtml(p)}
        <div class="field"><label>Description boutique</label><textarea class="input" name="shop_description" maxlength="2000">${esc(p.shop_description || "")}</textarea></div>
        <div class="field"><label>Catégories de produits (séparées par des virgules, 20 maximum)</label><input class="input" name="product_categories" value="${esc((p.product_categories || []).join(", "))}"></div>
        <div id="acDossierEditMsg" class="error-state" style="display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="submit" ${canEdit ? "" : "disabled"}>Enregistrer</button></div>
      </form>
      ${!canEdit ? `<p class="muted" style="font-size:11px">Ce dossier n'est plus modifiable dans son état actuel.</p>` : ""}
    </div>
    ${dossierProgressHtml(d)}
    ${dossierActivationHtml(d)}
  `;
  refreshIcons();
  attachGeoHints(host);
  document.querySelector("#acDossierBack")?.addEventListener("click", renderOnboardingShell);

  const editForm = document.querySelector("#acDossierEditForm");
  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const fd = new FormData(editForm);
    const msgBox = document.querySelector("#acDossierEditMsg");
    const btn = editForm.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    msgBox.style.display = "none";
    const categories = (fd.get("product_categories") || "").split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await agentSaveAssistedMerchantDossier(dossierId, {
        fullName: (fd.get("full_name") || "").trim(),
        shopName: (fd.get("shop_name") || "").trim(),
        merchantType: fd.get("merchant_type"),
        phone: (fd.get("phone") || "").trim(),
        whatsappNumber: (fd.get("whatsapp_number") || "").trim(),
        email: (fd.get("email") || "").trim(),
        businessAddressLine1: (fd.get("business_address_line1") || "").trim(),
        businessDepartment: (fd.get("business_department") || "").trim(),
        businessCommune: (fd.get("business_commune") || "").trim(),
        shopDescription: (fd.get("shop_description") || "").trim(),
        productCategories: categories,
      });
      showToast("Dossier enregistré ✓");
      // La mutation a réussi même si l'utilisateur a quitté ce dossier entre
      // temps — on se contente alors de ne pas réécrire l'écran courant.
      if (stale()) return;
      await showDossierDetail(dossierId);
    } catch (err) {
      if (stale()) return;
      msgBox.textContent = agentErrorMessageFr(err?.message, "Impossible d'enregistrer ce dossier.");
      msgBox.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
    }
  });

  document.querySelector("#acDossierMarkReady")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await agentMarkAssistedMerchantReady(dossierId);
      showToast("Dossier marqué prêt ✓");
      if (stale()) return;
      await showDossierDetail(dossierId);
    } catch (err) {
      if (stale()) return;
      showToast(agentErrorMessageFr(err?.message, "Impossible de marquer ce dossier prêt."), "red");
      btn.disabled = false;
    }
  });

  document.querySelector("#acDossierInvite")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const msgBox = document.querySelector("#acDossierInviteMsg");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let issued;
    try {
      issued = await agentIssueAssistedMerchantInvite(dossierId);
    } catch (err) {
      if (stale()) return;
      showMsg(agentErrorMessageFr(err?.message, "Impossible de préparer l'invitation."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    // Distinction stricte : la préparation backend (dossier -> invited) a
    // réussi indépendamment de l'envoi effectif de l'e-mail par Supabase Auth.
    // Un échec ici ne doit jamais laisser croire que l'invitation n'existe pas.
    const delivery = issued?.delivery || {};
    // #36C v2 — le backend est désormais l'unique source du chemin de retour
    // du Magic Link (delivery.redirect_path). On ne reconstruit jamais
    // dossier_id ni la route côté frontend : un contrat backend incomplet
    // doit échouer visiblement (fail-closed), jamais silencieusement deviner.
    const redirectPath = String(delivery.redirect_path || "").trim();
    const authAction = String(delivery.auth_action || "").trim();
    if (!redirectPath) {
      if (stale()) return;
      showMsg("Le dossier est prêt, mais le backend n'a pas fourni de chemin de retour (redirect_path) — invitation non envoyée.", false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    if (authAction && authAction !== "supabase.auth.signInWithOtp") {
      if (stale()) return;
      showMsg(`Mécanisme d'authentification d'invitation inattendu (${authAction}) — invitation non envoyée.`, false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    const redirectTo = new URL(redirectPath, window.location.origin).toString();
    try {
      await signInWithOtpToEmail(delivery.email, { redirectTo, shouldCreateUser: delivery.should_create_user !== false });
      showToast("Invitation envoyée ✓");
      btn.dataset.submitting = "";
      if (stale()) return;
      await showDossierDetail(dossierId); // reflète le nouveau statut "invited" + bouton "Renvoyer"
    } catch (err) {
      // Le dossier backend est déjà en statut "invited" (issue a réussi) :
      // ne jamais afficher "l'invitation n'existe pas". On garde ce même
      // écran (pas de re-render) pour que le message reste visible, et le
      // bouton reste actionnable pour un nouvel essai sans créer de dossier.
      btn.dataset.submitting = "";
      if (stale()) return;
      showMsg("Le dossier est prêt, mais l'e-mail n'a pas pu être envoyé. Réessayez l'envoi.", false);
      btn.disabled = false;
      btn.textContent = "Réessayer l'envoi";
    }
  });
}

async function boot() {
  invalidateDossierDetail();
  invalidateBulkModule();
  let session;
  try { session = await getSession(); } catch { session = null; }
  if (!session?.user) {
    gate(authGateHtml());
    document.querySelector("#acLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }
  gate(loading("Vérification de votre accès Agent…"));
  let ctx;
  try {
    ctx = await agentGetMyContext();
  } catch (err) {
    gate(`<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Impossible de vérifier votre accès Agent</h3><p>${esc(agentErrorMessageFr(err?.message, "Réessayez dans un instant."))}</p><button class="btn btn-outline-blue btn-sm" type="button" id="acGateRetry">Réessayer</button></div>`);
    document.querySelector("#acGateRetry")?.addEventListener("click", boot);
    return;
  }
  if (ctx.state !== "active") {
    // Suspendu / fermé : message direct. Sinon (pas encore Agent), le contexte
    // d'accès décide entre candidature, attente d'examen, refus (avec motif).
    if (ctx.state !== "suspended" && ctx.state !== "closed" && mountAgentApplication(ctx)) return;
    gate(notAgentGateHtml(ctx.state));
    return;
  }
  _acCtx = ctx;
  showContent();
  renderAgentHeader(ctx);
  document.querySelector("#acMerchantSearch")?.addEventListener("input", (e) => {
    _acMerchantSearch = e.target.value || "";
    renderMerchantList();
  });
  document.querySelector("#acOpenOnboardingBtn")?.addEventListener("click", openOnboardingModule);
  const contentHost = document.querySelector("#acContentHost");
  if (contentHost) contentHost.innerHTML = empty("Sélectionnez un marchand", "Choisissez un marchand assigné dans la liste à gauche pour gérer son catalogue.");
  await loadMerchants();
}

export async function initAgentCenter() {
  if (document.body?.dataset?.agentPage !== "center") return;
  await boot();
  onAuthChange(() => boot());
}
