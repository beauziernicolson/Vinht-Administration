// Admin Ownership enhancements — additive layer loaded only on Admin pages.
// Existing Admin modules remain untouched; every mutation stays server-authoritative.

import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";
import { formModal, confirmAction, adminErrorFr, esc, chip, onOff } from "../ui/adminUi.js";
import { getAdminProduct, getAdminMerchants, getAdminCategories } from "../services/admin.js?v=20260922-mega-a-v1";
import {
  agentGetProductContext, agentUpdateProductContent,
  agentSetProductStock, agentReplaceProductVariants, agentUpdateProductVariantInventory,
  agentSetProductActive, agentErrorMessageFr,
} from "../services/agentCenter.js";
import { renderBulkCatalogModule } from "./agentBulkCatalog.js";
import {
  adminReopenCourierApplication, adminCreateCatalogProduct, adminGetAdvancedControls,
  adminSetProfessionalPlanPricing, adminUpdateBillingPolicyControls,
  adminSetNotificationChannelRuntime, adminUpdateReputationSettings,
} from "../services/adminOwnership.js";

const page = () => document.body?.dataset?.adminPage || "";
const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const keywords = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30);
let advancedCache = null;

async function env() {
  if (advancedCache?.environment) return advancedCache.environment;
  try { advancedCache = await adminGetAdvancedControls(); return advancedCache.environment || null; }
  catch { return null; }
}

async function catalogReferenceData() {
  const [merchants, categories] = await Promise.all([getAdminMerchants({ limit: 200 }), getAdminCategories()]);
  return {
    merchants: (merchants || []).filter((m) => m.status !== "closed"),
    categories: (categories || []).filter((c) => c.is_active),
  };
}

async function createProductFromAdmin() {
  let ref;
  try { ref = await catalogReferenceData(); }
  catch (e) { showToast(adminErrorFr(e, "Référentiel catalogue indisponible."), "red"); return; }
  if (!ref.merchants.length || !ref.categories.length) {
    showToast("Un marchand ouvert et une catégorie active sont requis.", "red"); return;
  }
  const f = await formModal({
    title: "Créer un produit en tant qu’Admin",
    confirmLabel: "Créer le produit",
    intro: "Création server-authoritative. HTG et USD sont supportés ; le backend refuse USD si la politique de frais du plan marchand n’est pas prête. L’action est auditée avec actor_role=admin.",
    fields: [
      { name: "merchant", label: "Marchand", type: "select", required: true, options: ref.merchants.map((m) => ({ value: m.id, label: `${m.shop_name || m.id} · ${m.merchant_type || ""}` })) },
      { name: "category", label: "Catégorie", type: "select", required: true, options: ref.categories.map((c) => ({ value: c.id, label: c.name || c.slug })) },
      { name: "name", label: "Nom", required: true },
      { name: "sku", label: "SKU" },
      { name: "currency", label: "Devise", type: "select", required: true, value: "HTG", options: [{ value: "HTG", label: "HTG — Gourde" }, { value: "USD", label: "USD — Dollar US" }] },
      { name: "retail", label: "Prix détail (dans la devise choisie)", type: "number", min: 0, step: "any", required: true },
      { name: "stock", label: "Stock", type: "number", min: 0, step: 1, value: 0, required: true },
      { name: "wholesale", label: "Prix de gros (optionnel)", type: "number", min: 0, step: "any" },
      { name: "moq", label: "MOQ gros (avec prix de gros)", type: "number", min: 1, step: 1 },
      { name: "compare", label: "Prix barré", type: "number", min: 0, step: "any" },
      { name: "tagline", label: "Accroche" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "delivery", label: "Zone de livraison" },
      { name: "days", label: "Délai estimé (jours)", type: "number", min: 0, step: 1 },
      { name: "keywords", label: "Mots-clés (séparés par virgules)" },
    ],
  });
  if (!f) return;
  try {
    const r = await adminCreateCatalogProduct(f.values.merchant, {
      categoryId: f.values.category, name: f.values.name, sku: f.values.sku || null,
      currency: f.values.currency || "HTG",
      retailPrice: Number(f.values.retail), stock: Number(f.values.stock || 0),
      wholesalePrice: numOrNull(f.values.wholesale), wholesaleMinQty: numOrNull(f.values.moq),
      compareAtPrice: numOrNull(f.values.compare), tagline: f.values.tagline || null,
      description: f.values.description || null, deliveryZone: f.values.delivery || null,
      estimatedDeliveryDays: numOrNull(f.values.days), searchKeywords: keywords(f.values.keywords),
    });
    const id = r?.product?.id;
    showToast(`Produit ${String(f.values.currency || "HTG").toUpperCase()} créé par l’Admin ✓`);
    if (id) location.href = `product-detail.html?id=${encodeURIComponent(id)}`;
    else location.reload();
  } catch (e) { showToast(agentErrorMessageFr(e?.message, adminErrorFr(e, "Création produit refusée.")), "red"); }
}

async function openBulkForAdmin() {
  let merchants;
  try { merchants = (await getAdminMerchants({ limit: 200 })).filter((m) => m.status !== "closed"); }
  catch (e) { showToast(adminErrorFr(e, "Marchands indisponibles."), "red"); return; }
  if (!merchants.length) { showToast("Aucun marchand disponible.", "red"); return; }
  const f = await formModal({
    title: "Catalogue en masse — Admin",
    confirmLabel: "Ouvrir",
    intro: "Choisissez une devise par défaut. Si votre fichier contient une colonne Devise/Currency, sa valeur HTG ou USD remplacera ce défaut ligne par ligne.",
    fields: [
      { name: "merchant", label: "Marchand", type: "select", required: true, options: merchants.map((m) => ({ value: m.id, label: m.shop_name || m.id })) },
      { name: "currency", label: "Devise par défaut", type: "select", required: true, value: "HTG", options: [{ value: "HTG", label: "HTG — Gourde" }, { value: "USD", label: "USD — Dollar US" }] },
    ],
  });
  if (!f) return;
  const base = document.querySelector("#adminProductsHost");
  if (!base) return;
  let host = document.querySelector("#adminOwnershipBulkHost");
  if (!host) { host = document.createElement("div"); host.id = "adminOwnershipBulkHost"; base.after(host); }
  base.hidden = true; host.hidden = false;
  renderBulkCatalogModule(host, f.values.merchant, {
    defaultCurrency: String(f.values.currency || "HTG").toUpperCase(),
    isStale: () => page() !== "products",
    onBack: () => { host.hidden = true; host.innerHTML = ""; base.hidden = false; },
  });
}

function enhanceProductsList() {
  const host = document.querySelector("#adminProductsHost");
  if (!host || host.dataset.ownershipReady === "1") return;
  const toolbar = host.querySelector(".toolbar");
  if (!toolbar) return;
  host.dataset.ownershipReady = "1";
  const actions = document.createElement("div");
  actions.className = "toolbar-group";
  actions.innerHTML = `<button class="btn btn-blue btn-sm" type="button" data-admin-create-product>Créer un produit</button><button class="btn btn-outline-blue btn-sm" type="button" data-admin-bulk>Catalogue en masse</button>`;
  toolbar.append(actions);
  actions.querySelector("[data-admin-create-product]")?.addEventListener("click", createProductFromAdmin);
  actions.querySelector("[data-admin-bulk]")?.addEventListener("click", openBulkForAdmin);
  refreshIcons();
}

async function loadProductContext() {
  const id = new URL(location.href).searchParams.get("id") || "";
  const p = await getAdminProduct(id);
  if (!p) throw new Error("product_not_found");
  const ctx = await agentGetProductContext(p.merchant_id, p.id);
  return { adminProduct: p, ctx, product: ctx.product || {}, variants: Array.isArray(ctx.variants) ? ctx.variants : [] };
}

async function editProductContent(state) {
  let categories;
  try { categories = (await getAdminCategories()).filter((c) => c.is_active); }
  catch (e) { showToast(adminErrorFr(e, "Catégories indisponibles."), "red"); return; }
  const p = state.product;
  const currency = String(p.currency || "HTG").toUpperCase();
  const f = await formModal({
    title: "Modifier le produit — Admin",
    confirmLabel: "Continuer",
    intro: `Devise du produit : ${currency}. Toute modification de contenu d’un produit approuvé le repasse en révision et le met hors ligne jusqu’à nouvelle validation.`,
    fields: [
      { name: "category", label: "Catégorie", type: "select", value: p.category_id, options: categories.map((c) => ({ value: c.id, label: c.name || c.slug })) },
      { name: "name", label: "Nom", value: p.name, required: true },
      { name: "sku", label: "SKU", value: p.sku || "" },
      { name: "retail", label: `Prix détail (${currency})`, type: "number", min: 0, step: "any", value: p.retail_price, required: true },
      { name: "wholesale", label: `Prix de gros (${currency})`, type: "number", min: 0, step: "any", value: p.wholesale_price ?? "" },
      { name: "moq", label: "MOQ gros", type: "number", min: 1, step: 1, value: p.wholesale_min_qty ?? "" },
      { name: "compare", label: `Prix barré (${currency})`, type: "number", min: 0, step: "any", value: p.compare_at_price ?? "" },
      { name: "tagline", label: "Accroche", value: p.tagline || "" },
      { name: "description", label: "Description", type: "textarea", value: p.description || "" },
      { name: "delivery", label: "Zone de livraison", value: p.delivery_zone || "" },
      { name: "days", label: "Délai estimé (jours)", type: "number", min: 0, step: 1, value: p.estimated_delivery_days ?? "" },
      { name: "keywords", label: "Mots-clés (virgules)", value: Array.isArray(p.search_keywords) ? p.search_keywords.join(", ") : "" },
    ],
  });
  if (!f) return;
  const ok = await confirmAction({ title: "Enregistrer cette modification Admin ?", env: await env(), danger: p.approval_status === "approved", confirmLabel: "Enregistrer",
    consequences: p.approval_status === "approved" ? ["Le produit repassera en révision.", "Il sera mis hors ligne jusqu’à validation Admin.", "L’action sera auditée avec actor_role=admin."] : ["L’action sera auditée avec actor_role=admin."] });
  if (!ok) return;
  try {
    await agentUpdateProductContent(p.merchant_id, p.id, {
      categoryId: f.values.category, name: f.values.name, sku: f.values.sku || null,
      retailPrice: Number(f.values.retail), wholesalePrice: numOrNull(f.values.wholesale),
      wholesaleMinQty: numOrNull(f.values.moq), compareAtPrice: numOrNull(f.values.compare),
      tagline: f.values.tagline || null, description: f.values.description || null,
      deliveryZone: f.values.delivery || null, estimatedDeliveryDays: numOrNull(f.values.days), searchKeywords: keywords(f.values.keywords),
    });
    showToast("Produit modifié par l’Admin ✓"); location.reload();
  } catch (e) { showToast(agentErrorMessageFr(e?.message, "Modification refusée."), "red"); }
}

async function editSimpleStock(state) {
  const p = state.product;
  const f = await formModal({ title: "Corriger le stock — Admin", confirmLabel: "Enregistrer", fields: [{ name: "stock", label: "Stock", type: "number", min: 0, step: 1, value: p.stock, required: true }] });
  if (!f) return;
  try { await agentSetProductStock(p.merchant_id, p.id, Number(f.values.stock)); showToast("Stock mis à jour ✓"); location.reload(); }
  catch (e) { showToast(agentErrorMessageFr(e?.message, "Stock refusé."), "red"); }
}

async function editVariant(state, variant) {
  const f = await formModal({ title: `Stock variante ${variant.sku || ""}`, confirmLabel: "Enregistrer", fields: [
    { name: "stock", label: "Stock", type: "number", min: 0, step: 1, value: variant.stock, required: true },
    { name: "active", label: "Variante active", type: "checkbox", value: variant.is_active },
  ] });
  if (!f) return;
  try { await agentUpdateProductVariantInventory(state.product.merchant_id, variant.id, Number(f.values.stock), !!f.values.active); showToast("Variante mise à jour ✓"); location.reload(); }
  catch (e) { showToast(agentErrorMessageFr(e?.message, "Variante refusée."), "red"); }
}

async function replaceVariants(state) {
  const normalized = state.variants.map((v, i) => ({ sku: v.sku, options: v.options || {}, stock: v.stock, is_active: v.is_active, position: v.position ?? i }));
  const f = await formModal({ title: "Structure des variantes — Admin", confirmLabel: "Continuer", intro: "Format JSON avancé. Une modification structurelle d’un produit approuvé déclenche une nouvelle révision.", fields: [
    { name: "json", label: "Variantes JSON", type: "textarea", value: JSON.stringify(normalized, null, 2), required: true },
  ] });
  if (!f) return;
  let rows;
  try { rows = JSON.parse(f.values.json); if (!Array.isArray(rows)) throw new Error("array"); }
  catch { showToast("JSON de variantes invalide.", "red"); return; }
  const ok = await confirmAction({ title: "Remplacer la structure des variantes ?", env: await env(), danger: true, confirmLabel: "Remplacer",
    consequences: ["Les variantes actives actuelles sont remplacées par cette structure.", "Si le produit était approuvé, il repassera en révision et hors ligne.", "Aucune suppression définitive de l’historique n’est effectuée."] });
  if (!ok) return;
  try { await agentReplaceProductVariants(state.product.merchant_id, state.product.id, rows); showToast("Variantes remplacées ✓"); location.reload(); }
  catch (e) { showToast(agentErrorMessageFr(e?.message, "Variantes refusées."), "red"); }
}

async function toggleProductActive(state) {
  const p = state.product;
  const next = !p.is_active;
  const ok = await confirmAction({ title: `${next ? "Activer" : "Désactiver"} ce produit ?`, env: await env(), danger: !next, confirmLabel: next ? "Activer" : "Désactiver",
    consequences: next ? ["Le backend n’autorise l’activation que si le produit est approuvé."] : ["Le produit disparaîtra du catalogue public, sans suppression définitive."] });
  if (!ok) return;
  try { await agentSetProductActive(p.merchant_id, p.id, next); showToast(next ? "Produit activé ✓" : "Produit désactivé ✓"); location.reload(); }
  catch (e) { showToast(agentErrorMessageFr(e?.message, "Changement d’état refusé."), "red"); }
}

async function enhanceProductDetail() {
  const host = document.querySelector("#adminProductDetailHost");
  if (!host || host.dataset.ownershipReady === "1" || !host.querySelector(".portal-card")) return;
  host.dataset.ownershipReady = "1";
  let state;
  try { state = await loadProductContext(); }
  catch (e) { host.dataset.ownershipReady = "0"; return; }
  const p = state.product;
  const card = document.createElement("div");
  card.className = "portal-card";
  card.id = "adminOwnershipProductTools";
  card.innerHTML = `<div class="toolbar"><div><h3 style="margin:0">Contrôle propriétaire — catalogue</h3><p class="muted" style="margin:3px 0 0">L’Admin utilise les mêmes validations serveur que l’Agent. Toutes les opérations sont auditées comme Admin.</p></div><div class="toolbar-group">${chip(String(p.currency || "HTG").toUpperCase(), "blue")}${chip("ADMIN", "red")}</div></div>
    <div class="toolbar-group" style="margin-top:12px"><button class="btn btn-blue btn-sm" type="button" data-own-edit>Modifier contenu</button>${state.variants.length ? "" : '<button class="btn btn-outline-blue btn-sm" type="button" data-own-stock>Corriger stock</button>'}<button class="btn btn-outline-blue btn-sm" type="button" data-own-variants>Structure variantes</button><button class="btn btn-ghost btn-sm" type="button" data-own-active>${p.is_active ? "Désactiver" : "Activer"}</button></div>
    ${state.variants.length ? `<h4 style="margin-bottom:6px">Inventaire des variantes</h4><div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>SKU</th><th>Options</th><th>Stock</th><th>Actif</th><th></th></tr></thead><tbody>${state.variants.map((v) => `<tr><td>${esc(v.sku || "—")}</td><td>${esc(Object.entries(v.options || {}).map(([k,val]) => `${k}: ${val}`).join(" · ") || "—")}</td><td>${esc(v.stock)}</td><td>${onOff(!!v.is_active)}</td><td><button class="btn btn-ghost btn-sm" type="button" data-own-variant="${esc(v.id)}">Modifier</button></td></tr>`).join("")}</tbody></table></div>` : ""}`;
  host.append(card);
  card.querySelector("[data-own-edit]")?.addEventListener("click", () => editProductContent(state));
  card.querySelector("[data-own-stock]")?.addEventListener("click", () => editSimpleStock(state));
  card.querySelector("[data-own-variants]")?.addEventListener("click", () => replaceVariants(state));
  card.querySelector("[data-own-active]")?.addEventListener("click", () => toggleProductActive(state));
  card.querySelectorAll("[data-own-variant]").forEach((b) => b.addEventListener("click", () => editVariant(state, state.variants.find((v) => v.id === b.dataset.ownVariant))));
  refreshIcons();
}

async function reopenRejectedCourier(detail) {
  const id = detail?.dataset?.courierDetail;
  if (!id) return;
  const e = await env();
  const ok = await confirmAction({ title: "Rouvrir cette candidature livreur ?", env: e, requireReason: true, minReason: 5, confirmLabel: "Rouvrir pour examen",
    consequences: ["Le statut passe de Refusé à À examiner.", "Le rôle livreur n’est PAS réaccordé automatiquement.", "Une nouvelle approbation Admin restera obligatoire."] });
  if (!ok) return;
  try { await adminReopenCourierApplication(id, ok.reason); showToast("Candidature rouverte ✓"); location.reload(); }
  catch (err) { showToast(adminErrorFr(err, "Réouverture refusée."), "red"); }
}

function enhanceRejectedCourier() {
  document.querySelectorAll(".cc-detail[data-courier-detail]").forEach((detail) => {
    if (detail.dataset.reopenReady === "1") return;
    const rejected = detail.textContent.includes("Refusé") && detail.textContent.includes("Motif du refus");
    if (!rejected) return;
    detail.dataset.reopenReady = "1";
    const row = detail.querySelector(".toolbar-group:last-child") || detail;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn btn-outline-blue btn-sm"; btn.textContent = "Rouvrir pour examen…";
    btn.addEventListener("click", () => reopenRejectedCourier(detail));
    row.append(btn);
  });
}

async function editAdvancedPricing(data, reload) {
  const p = data.professional_plan || {};
  const f = await formModal({ title: "Tarifs du plan Professionnel", confirmLabel: "Continuer", fields: [
    { name: "monthly", label: "Abonnement mensuel HTG", type: "number", min: 0, step: "any", value: p.monthly_fee_htg, required: true },
    { name: "commission", label: "Commission %", type: "number", min: 0, max: 100, step: "any", value: p.commission_rate, required: true },
  ] });
  if (!f) return;
  const ok = await confirmAction({ title: "Modifier les tarifs Professionnel ?", env: data.environment, requireReason: true, danger: data.environment === "production", confirmLabel: "Enregistrer",
    consequences: ["Le plan Professionnel conserve 0 frais fixes par article.", "L’offre de lancement et ses dates ne sont pas modifiées par cette action."] });
  if (!ok) return;
  try { await adminSetProfessionalPlanPricing({ monthlyFeeHtg: f.values.monthly, commissionRate: f.values.commission, reason: ok.reason }); showToast("Tarifs Pro enregistrés ✓"); reload(); }
  catch (e) { showToast(adminErrorFr(e, "Tarifs Pro refusés."), "red"); }
}

async function editBilling(data, reload) {
  const p = data.billing_policy || {};
  const f = await formModal({ title: "Politique de facturation Pro", confirmLabel: "Continuer", fields: [
    { name: "grace", label: "Jours de grâce", type: "number", min: 0, max: 30, step: 1, value: p.grace_days, required: true },
    { name: "suspend", label: "Suspendre automatiquement les impayés", type: "checkbox", value: p.auto_suspend_unpaid },
    { name: "reactivate", label: "Réactiver après paiement", type: "checkbox", value: p.reactivate_on_payment },
    { name: "pause", label: "Mettre les frais fixes en pause", type: "checkbox", value: p.fixed_fees_paused },
  ] });
  if (!f) return;
  const ok = await confirmAction({ title: "Modifier la politique Pro ?", env: data.environment, requireReason: true, danger: data.environment === "production", confirmLabel: "Enregistrer",
    consequences: ["Le kill-switch des paiements Production reste géré séparément dans l’onglet Paiements.", "Les dates de l’offre de lancement ne sont pas modifiées ici."] });
  if (!ok) return;
  try { await adminUpdateBillingPolicyControls({ graceDays: f.values.grace, autoSuspendUnpaid: f.values.suspend, reactivateOnPayment: f.values.reactivate, fixedFeesPaused: f.values.pause, reason: ok.reason }); showToast("Politique Pro enregistrée ✓"); reload(); }
  catch (e) { showToast(adminErrorFr(e, "Politique Pro refusée."), "red"); }
}

async function editReputation(data, reload) {
  const r = data.reputation || {};
  const f = await formModal({ title: "Paramètres Seller Health", confirmLabel: "Continuer", fields: [
    { name: "evaluation", label: "Fenêtre d’évaluation (jours)", type: "number", min: 30, max: 365, step: 1, value: r.evaluation_days },
    { name: "fallback", label: "Fenêtre de repli (jours)", type: "number", min: 90, max: 730, step: 1, value: r.fallback_days },
    { name: "provisional", label: "Commandes min. provisoire", type: "number", min: 1, max: 100, step: 1, value: r.provisional_min_orders },
    { name: "established", label: "Commandes min. établi", type: "number", min: 5, max: 1000, step: 1, value: r.established_min_orders },
    { name: "reviewWindow", label: "Fenêtre avis (jours)", type: "number", min: 7, max: 365, step: 1, value: r.review_window_days },
    { name: "reviewEdit", label: "Modification avis (jours)", type: "number", min: 1, max: 90, step: 1, value: r.review_edit_days },
    { name: "satisfaction", label: "Poids satisfaction", type: "number", min: 0, max: 1, step: "0.01", value: r.satisfaction_weight },
    { name: "success", label: "Poids succès", type: "number", min: 0, max: 1, step: "0.01", value: r.success_weight },
    { name: "cancellation", label: "Poids annulation", type: "number", min: 0, max: 1, step: "0.01", value: r.cancellation_weight },
    { name: "dispute", label: "Poids litiges", type: "number", min: 0, max: 1, step: "0.01", value: r.dispute_weight },
    { name: "delivery", label: "Poids livraison", type: "number", min: 0, max: 1, step: "0.01", value: r.delivery_weight },
    { name: "excellent", label: "Seuil Excellent", type: "number", step: "0.01", value: r.excellent_threshold },
    { name: "good", label: "Seuil Bon", type: "number", step: "0.01", value: r.good_threshold },
    { name: "watch", label: "Seuil Surveillance", type: "number", step: "0.01", value: r.watch_threshold },
  ] });
  if (!f) return;
  const ok = await confirmAction({ title: "Modifier Seller Health ?", env: data.environment, requireReason: true, danger: data.environment === "production", confirmLabel: "Enregistrer",
    consequences: ["La somme des 5 poids doit rester exactement égale à 1.", "Excellent > Bon > Surveillance.", "Le changement affecte les évaluations futures dans cet environnement."] });
  if (!ok) return;
  try { await adminUpdateReputationSettings({ evaluationDays:f.values.evaluation, fallbackDays:f.values.fallback, provisionalMinOrders:f.values.provisional, establishedMinOrders:f.values.established, reviewWindowDays:f.values.reviewWindow, reviewEditDays:f.values.reviewEdit, satisfactionWeight:f.values.satisfaction, successWeight:f.values.success, cancellationWeight:f.values.cancellation, disputeWeight:f.values.dispute, deliveryWeight:f.values.delivery, excellentThreshold:f.values.excellent, goodThreshold:f.values.good, watchThreshold:f.values.watch, reason:ok.reason }); showToast("Seller Health enregistré ✓"); reload(); }
  catch (e) { showToast(adminErrorFr(e, "Paramètres Seller Health refusés."), "red"); }
}

async function renderAdvancedControls(host) {
  host.innerHTML = `<div class="loading-state">Chargement des contrôles propriétaire…</div>`;
  let data;
  try { data = await adminGetAdvancedControls(); advancedCache = data; }
  catch (e) { host.innerHTML = `<div class="error-state">${esc(adminErrorFr(e, "Contrôles avancés indisponibles."))}</div>`; return; }
  const pro = data.professional_plan || {}, pol = data.billing_policy || {}, rep = data.reputation || {}, channels = data.notification_channels || [];
  host.innerHTML = `<div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Contrôles propriétaire — avancés</h3><p class="muted" style="margin:3px 0 0">Réglages bornés par le backend et audités. Aucun accès direct aux tables critiques.</p></div>${chip("ADMIN OWNER", "red")}</div>
    <div class="settings-section"><div><strong>Plan Professionnel</strong><p>${esc(pro.monthly_fee_htg ?? "—")} HTG/mois · ${esc(pro.commission_rate ?? "—")}% · frais/article ${esc(pro.per_item_fee_htg ?? 0)} HTG</p></div><button class="btn btn-outline-blue btn-sm" type="button" data-own-pricing>Modifier</button></div>
    <div class="settings-section"><div><strong>Politique de facturation Pro</strong><p>Grâce ${esc(pol.grace_days ?? "—")} j · suspension auto ${pol.auto_suspend_unpaid ? "oui" : "non"} · réactivation ${pol.reactivate_on_payment ? "oui" : "non"} · frais fixes en pause ${pol.fixed_fees_paused ? "oui" : "non"}</p></div><button class="btn btn-outline-blue btn-sm" type="button" data-own-billing>Modifier</button></div>
    <div class="settings-section" style="align-items:flex-start"><div><strong>Canaux de notification</strong><p>${channels.map((c) => `${esc(c.channel)}: ${c.enabled ? "ON" : "OFF"} (${esc(c.provider_status)})`).join(" · ") || "—"}</p></div></div>
    <div class="toolbar-group" data-own-channels>${channels.map((c) => `<button class="btn ${c.enabled ? "btn-outline-red" : "btn-ghost"} btn-sm" type="button" data-channel="${esc(c.channel)}" data-enabled="${c.enabled ? "1" : "0"}" ${!c.enabled && c.provider_status !== "ready" ? "disabled title=\"Provider non prêt\"" : ""}>${c.enabled ? "Désactiver" : "Activer"} ${esc(c.channel)}</button>`).join("")}</div>
    <div class="settings-section"><div><strong>Seller Health / réputation</strong><p>Fenêtre ${esc(rep.evaluation_days ?? "—")} j · provisoire ${esc(rep.provisional_min_orders ?? "—")} commandes · établi ${esc(rep.established_min_orders ?? "—")} commandes · seuils ${esc(rep.excellent_threshold ?? "—")} / ${esc(rep.good_threshold ?? "—")} / ${esc(rep.watch_threshold ?? "—")}</p></div><button class="btn btn-outline-blue btn-sm" type="button" data-own-reputation>Modifier</button></div>
  </div>`;
  const reload = () => renderAdvancedControls(host);
  host.querySelector("[data-own-pricing]")?.addEventListener("click", () => editAdvancedPricing(data, reload));
  host.querySelector("[data-own-billing]")?.addEventListener("click", () => editBilling(data, reload));
  host.querySelector("[data-own-reputation]")?.addEventListener("click", () => editReputation(data, reload));
  host.querySelectorAll("[data-channel]").forEach((b) => b.addEventListener("click", async () => {
    const next = b.dataset.enabled !== "1";
    const ok = await confirmAction({ title: `${next ? "Activer" : "Désactiver"} ${b.dataset.channel} ?`, env: data.environment, requireReason: true, danger: data.environment === "production", confirmLabel: next ? "Activer" : "Désactiver",
      consequences: next ? ["Le backend refuse l’activation si le provider n’est pas READY."] : ["Les nouvelles notifications ne seront plus envoyées sur ce canal."] });
    if (!ok) return;
    try { await adminSetNotificationChannelRuntime(b.dataset.channel, next, ok.reason); showToast("Canal mis à jour ✓"); reload(); }
    catch (e) { showToast(adminErrorFr(e, "Canal refusé."), "red"); }
  }));
  refreshIcons();
}

function enhanceCommerceAdvancedControls() {
  const settingsHost = document.querySelector("#adminSettingsHost");
  if (!settingsHost) return;
  const body = settingsHost.parentElement?.parentElement;
  if (!body || body.querySelector("#adminOwnershipAdvancedControls")) return;
  [...body.querySelectorAll(".portal-card")].forEach((card) => {
    if (card.textContent.includes("Réglages avancés — post-lancement")) card.hidden = true;
  });
  const host = document.createElement("div"); host.id = "adminOwnershipAdvancedControls"; body.append(host);
  renderAdvancedControls(host);
}

export function initAdminOwnershipEnhancements() {
  if (!page()) return;
  const run = () => {
    if (page() === "products") enhanceProductsList();
    if (page() === "product-detail") enhanceProductDetail();
    if (page() === "control-center") { enhanceRejectedCourier(); enhanceCommerceAdvancedControls(); }
  };
  run();
  const observer = new MutationObserver(() => queueMicrotask(run));
  observer.observe(document.body, { childList: true, subtree: true });
}
