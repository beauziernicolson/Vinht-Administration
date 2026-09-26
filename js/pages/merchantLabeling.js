import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "../ui/toast.js";
import {
  getMyLabelingServiceContext,
  searchMyLabelingTargets,
  ensureMyProductIdentifier,
  setMyProductIdentifier,
  quoteMyLabelingServiceOrder,
  createMyLabelingServiceOrder,
  listMyLabelingServiceOrders,
  getMyLabelingServiceOrder,
  newLabelingRequestKey,
} from "../services/merchantLabeling.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const money = (v) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(v) || 0)} HTG`;
const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
};
const optionsText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Produit simple";
const keyOf = (productId, variantId) => `${productId}:${variantId || "parent"}`;

let ctx = null;
let products = [];
let requestLines = new Map();
let quote = null;
let requestKey = null;
let ordersOffset = 0;
const ordersLimit = 20;

function gateHtml(html) {
  const gate = document.querySelector("[data-labeling-gate]");
  const content = document.querySelector("[data-labeling-content]");
  if (gate) { gate.hidden = false; gate.innerHTML = html; }
  if (content) content.hidden = true;
  refreshIcons();
}
function showContent() {
  const gate = document.querySelector("[data-labeling-gate]");
  const content = document.querySelector("[data-labeling-content]");
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;
}
function fillIdentity() {
  const m = ctx?.merchant || {};
  document.querySelectorAll("[data-merchant-name]").forEach((x) => x.textContent = m.shop_name || "Ma boutique");
  document.querySelectorAll("[data-merchant-type]").forEach((x) => x.textContent = "Marchand VinHT");
  document.querySelectorAll("[data-merchant-initial]").forEach((x) => x.textContent = (m.shop_name || "V").charAt(0).toUpperCase());
}
function stateTone(state) {
  return state === "ready" ? "green" : state === "service_disabled" ? "red" : "amber";
}
function errorMessage(err, fallback = "L’opération a échoué.") {
  const m = String(err?.message || err?.details || err || "").toLowerCase();
  if (/not-authenticated|authentication_required|jwt/.test(m)) return "Reconnectez-vous pour continuer.";
  if (/invalid_gtin/.test(m)) return "GTIN / EAN / UPC invalide. Vérifiez les chiffres et la clé de contrôle.";
  if (/invalid_asin/.test(m)) return "ASIN invalide. Il doit contenir exactement 10 lettres ou chiffres.";
  if (/variant_id_required/.test(m)) return "Choisissez la variante exacte de ce produit.";
  if (/minimum.*not.*met|minimum_not_met/.test(m)) return "La quantité minimale du service n’est pas atteinte.";
  if (/pricing_not_configured/.test(m)) return "Le tarif du service n’est pas encore configuré par VinHT.";
  if (/service_disabled/.test(m)) return "Le service d’étiquetage est temporairement indisponible.";
  if (/idempotency_conflict/.test(m)) return "Cette soumission a changé après un premier envoi. Recommencez avec une nouvelle demande.";
  if (/product_not_found|variant_not_found/.test(m)) return "Ce produit ou cette variante n’est plus disponible pour cette opération.";
  return fallback;
}

function renderServiceCard() {
  const host = document.querySelector("#labelingServiceCard");
  if (!host || !ctx) return;
  const s = ctx.service || {};
  const canCreate = ctx.capabilities?.can_create_request === true;
  host.innerHTML = `
    <div class="toolbar"><div><h2 style="margin:0">Service d’étiquetage VinHT</h2><p class="muted" style="margin:4px 0 0">Dépôt physique → étiquetage → contrôle qualité → récupération.</p></div><span class="badge ${stateTone(ctx.state)}">${esc(ctx.state === "ready" ? "Disponible" : ctx.state === "service_disabled" ? "Indisponible" : "Configuration en cours")}</span></div>
    <div class="stat-grid" style="margin-top:16px">
      <div class="stat-card blue-stat"><div class="label">Prix par unité</div><div class="value" style="font-size:20px">${s.pricing_ready ? money(s.price_per_unit_htg) : "—"}</div><div class="delta">Tarif géré par VinHT</div></div>
      <div class="stat-card amber-stat"><div class="label">Minimum</div><div class="value">${esc(s.minimum_units ?? "—")}</div><div class="delta">unités par demande</div></div>
      <div class="stat-card green-stat"><div class="label">Demandes ouvertes</div><div class="value">${esc(ctx.open_requests_count ?? 0)}</div><div class="delta">en cours de traitement</div></div>
      <div class="stat-card"><div class="label">Modèle</div><div class="value" style="font-size:18px">${esc(s.label_template || "—")}</div><div class="delta">Code interne VinHT : CODE128</div></div>
    </div>
    <div class="${canCreate ? "green-note" : "error-state"}" style="margin-top:14px">${esc(ctx.message_fr || "")}${s.customer_instructions ? `<br><small>${esc(s.customer_instructions)}</small>` : ""}</div>`;
}

function flattenTargets() {
  const rows = [];
  for (const p of products) {
    if (p.has_variants) {
      for (const v of p.variants || []) rows.push({
        product_id: p.product_id, variant_id: v.variant_id, product_name: p.name,
        sku: v.sku || p.sku || "", options: v.options || {}, stock: v.stock,
        is_active: v.is_active, identifier: v.identifier || null,
      });
    } else rows.push({
      product_id: p.product_id, variant_id: null, product_name: p.name,
      sku: p.sku || "", options: {}, stock: null, is_active: p.is_active,
      identifier: p.simple_target_identifier || null,
    });
  }
  return rows;
}
function updateTargetIdentifier(productId, variantId, identifier) {
  const p = products.find((x) => x.product_id === productId);
  if (!p) return;
  if (variantId) {
    const v = (p.variants || []).find((x) => x.variant_id === variantId);
    if (v) v.identifier = identifier;
  } else p.simple_target_identifier = identifier;
}

function renderTargets() {
  const host = document.querySelector("#labelingTargets");
  if (!host) return;
  const rows = flattenTargets();
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state"><h3>Aucun produit</h3><p>Créez d’abord un produit dans votre espace marchand.</p></div>';
    return;
  }
  host.innerHTML = rows.map((t) => {
    const id = t.identifier || {};
    const k = keyOf(t.product_id, t.variant_id);
    const canCreate = ctx?.capabilities?.can_create_request === true;
    return `<div class="surface" data-label-target="${esc(k)}" style="padding:14px;margin-bottom:10px">
      <div class="toolbar"><div><strong>${esc(t.product_name)}</strong><div class="table-secondary">${esc(optionsText(t.options))}${t.sku ? ` · SKU ${esc(t.sku)}` : ""}</div></div>${t.variant_id ? '<span class="badge blue">Variante</span>' : '<span class="badge">Produit</span>'}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px">
        <div><small class="muted">Code VinHT</small><div data-internal-code style="font-weight:800;word-break:break-all">${esc(id.internal_code || "Non généré")}</div></div>
        <label class="field"><span>GTIN / EAN / UPC officiel</span><input data-gtin value="${esc(id.gtin || "")}" placeholder="Optionnel"></label>
        <label class="field"><span>ASIN existant</span><input data-asin value="${esc(id.asin || "")}" maxlength="10" placeholder="Optionnel"></label>
      </div>
      <div class="toolbar" style="margin-top:10px"><div class="toolbar-group">
        ${id.internal_code ? "" : '<button class="btn btn-ghost btn-sm" type="button" data-generate-code>Générer code VinHT</button>'}
        <button class="btn btn-ghost btn-sm" type="button" data-save-identifier>Enregistrer les références</button>
      </div>
      ${canCreate ? `<div class="toolbar-group"><input class="input" data-request-qty type="number" min="1" step="1" value="1" style="width:84px"><button class="btn btn-blue btn-sm" type="button" data-add-request>Ajouter à la demande</button></div>` : ""}</div>
      <div data-target-msg class="table-secondary" style="margin-top:8px"></div>
    </div>`;
  }).join("");

  host.querySelectorAll("[data-label-target]").forEach((card) => {
    const t = rows.find((x) => keyOf(x.product_id, x.variant_id) === card.dataset.labelTarget);
    const msg = card.querySelector("[data-target-msg]");
    card.querySelector("[data-generate-code]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const out = await ensureMyProductIdentifier(t.product_id, t.variant_id);
        updateTargetIdentifier(t.product_id, t.variant_id, out.identifier || null);
        renderTargets(); showToast("Code VinHT généré ✓");
      } catch (err) { msg.textContent = errorMessage(err, "Impossible de générer le code VinHT."); btn.disabled = false; }
    });
    card.querySelector("[data-save-identifier]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; msg.textContent = "";
      try {
        const out = await setMyProductIdentifier(t.product_id, t.variant_id, card.querySelector("[data-gtin]").value, card.querySelector("[data-asin]").value);
        updateTargetIdentifier(t.product_id, t.variant_id, out.identifier || null);
        renderTargets(); showToast("Références enregistrées ✓");
      } catch (err) { msg.textContent = errorMessage(err, "Impossible d’enregistrer les références."); btn.disabled = false; }
    });
    card.querySelector("[data-add-request]")?.addEventListener("click", () => {
      const q = parseInt(card.querySelector("[data-request-qty]").value, 10);
      if (!Number.isInteger(q) || q <= 0) { msg.textContent = "Saisissez une quantité supérieure à zéro."; return; }
      requestLines.set(keyOf(t.product_id, t.variant_id), { ...t, quantity: q });
      invalidateSubmission(); renderRequest();
      document.querySelector("#labelingRequest")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  refreshIcons();
}

function invalidateSubmission() { quote = null; requestKey = null; }
function requestPayload() {
  return Array.from(requestLines.values()).map((x) => ({ product_id: x.product_id, variant_id: x.variant_id || null, quantity: x.quantity }));
}
function renderRequest() {
  const host = document.querySelector("#labelingRequestLines");
  const quoteHost = document.querySelector("#labelingQuote");
  const quoteBtn = document.querySelector("#labelingQuoteBtn");
  const submitBtn = document.querySelector("#labelingSubmitBtn");
  if (!host) return;
  const rows = Array.from(requestLines.values());
  host.innerHTML = rows.length ? rows.map((x) => `<div class="settings-section" data-request-line="${esc(keyOf(x.product_id, x.variant_id))}"><div><strong>${esc(x.product_name)}</strong><p>${esc(optionsText(x.options))}${x.sku ? ` · SKU ${esc(x.sku)}` : ""}</p></div><div class="toolbar-group"><input class="input" data-line-qty type="number" min="1" step="1" value="${esc(x.quantity)}" style="width:82px"><button class="btn btn-ghost btn-sm" data-remove-line type="button">Retirer</button></div></div>`).join("") : '<p class="muted">Ajoutez un produit ou une variante depuis la liste ci-dessus.</p>';
  host.querySelectorAll("[data-request-line]").forEach((row) => {
    const k = row.dataset.requestLine;
    row.querySelector("[data-line-qty]")?.addEventListener("change", (e) => {
      const q = parseInt(e.target.value, 10); const line = requestLines.get(k);
      if (line && Number.isInteger(q) && q > 0) line.quantity = q; else e.target.value = line?.quantity || 1;
      invalidateSubmission(); renderRequest();
    });
    row.querySelector("[data-remove-line]")?.addEventListener("click", () => { requestLines.delete(k); invalidateSubmission(); renderRequest(); });
  });
  if (quoteHost) quoteHost.innerHTML = quote ? (quote.state === "ready" ? `<div class="green-note"><strong>Devis serveur : ${money(quote.quoted_total_htg)}</strong><br>${esc(quote.total_units)} unité(s) × ${money(quote.unit_price_htg)}.</div>` : `<div class="error-state">${esc(quote.message_fr || "Demande non disponible.")}</div>`) : "";
  if (quoteBtn) quoteBtn.disabled = !rows.length || ctx?.capabilities?.can_create_request !== true;
  if (submitBtn) submitBtn.disabled = !quote || quote.state !== "ready" || !rows.length;
}

async function loadTargets() {
  const host = document.querySelector("#labelingTargets");
  if (host) host.innerHTML = '<div class="loading-state">Chargement des produits…</div>';
  try {
    const q = document.querySelector("#labelingSearch")?.value || "";
    const out = await searchMyLabelingTargets(q, 50, 0);
    products = Array.isArray(out.products) ? out.products : [];
    renderTargets();
  } catch (err) {
    if (host) host.innerHTML = `<div class="error-state">${esc(errorMessage(err, "Impossible de charger vos produits."))}</div>`;
  }
}

function renderOrdersList(out) {
  const host = document.querySelector("#labelingOrdersList");
  if (!host) return;
  const labels = ctx?.status_labels || {};
  const rows = Array.isArray(out.rows) ? out.rows : [];
  host.innerHTML = rows.length ? rows.map((o) => `<div class="surface" data-label-order="${esc(o.id)}" style="padding:14px;margin-bottom:10px"><div class="toolbar"><div><strong>${esc(o.order_number)}</strong><div class="table-secondary">${esc(fmtDate(o.created_at))}</div></div><span class="badge ${/completed|ready/.test(o.status) ? "green" : o.status === "cancelled" ? "red" : "amber"}">${esc(labels[o.status] || o.status)}</span></div><div class="settings-section"><div><strong>${esc(o.requested_units)} unité(s)</strong><p>${money(o.price_per_unit_htg)} / unité</p></div><strong>${money(o.quoted_total_htg)}</strong></div><button class="btn btn-ghost btn-sm" type="button" data-order-detail>Voir le détail</button></div>`).join("") : '<div class="empty-state"><h3>Aucune demande</h3><p>Vos demandes d’étiquetage apparaîtront ici.</p></div>';
  host.querySelectorAll("[data-order-detail]").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest("[data-label-order]"); btn.disabled = true;
    try { await showOrderDetail(card.dataset.labelOrder); } catch (err) { showToast(errorMessage(err, "Impossible de charger le détail."), "red"); } finally { btn.disabled = false; }
  }));
  const prev = document.querySelector("#labelingOrdersPrev"); const next = document.querySelector("#labelingOrdersNext");
  if (prev) prev.disabled = ordersOffset <= 0;
  if (next) next.disabled = !out.has_more;
  const meta = document.querySelector("#labelingOrdersMeta");
  if (meta) meta.textContent = `${out.total || 0} demande(s)`;
}
async function loadOrders() {
  const host = document.querySelector("#labelingOrdersList");
  if (host) host.innerHTML = '<div class="loading-state">Chargement des demandes…</div>';
  try {
    const status = document.querySelector("#labelingStatusFilter")?.value || null;
    const out = await listMyLabelingServiceOrders(status, ordersLimit, ordersOffset);
    renderOrdersList(out);
  } catch (err) { if (host) host.innerHTML = `<div class="error-state">${esc(errorMessage(err, "Impossible de charger les demandes."))}</div>`; }
}
async function showOrderDetail(id) {
  const host = document.querySelector("#labelingOrderDetail");
  if (!host) return;
  host.hidden = false; host.innerHTML = '<div class="loading-state">Chargement du détail…</div>';
  const out = await getMyLabelingServiceOrder(id);
  if (out.state !== "ready") { host.innerHTML = `<div class="error-state">${esc(out.message_fr || "Demande introuvable.")}</div>`; return; }
  const o = out.order || {}; const labels = ctx?.status_labels || {};
  host.innerHTML = `<div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">${esc(o.order_number)}</h3><p class="muted" style="margin:4px 0 0">Créée le ${esc(fmtDate(o.created_at))}</p></div><span class="badge ${/completed|ready/.test(o.status) ? "green" : o.status === "cancelled" ? "red" : "amber"}">${esc(labels[o.status] || o.status)}</span></div>
    <div class="stat-grid" style="margin-top:14px"><div class="stat-card"><div class="label">Demandé</div><div class="value">${esc(o.requested_units)}</div></div><div class="stat-card"><div class="label">Reçu</div><div class="value">${esc(o.received_units)}</div></div><div class="stat-card"><div class="label">Étiqueté</div><div class="value">${esc(o.labeled_units)}</div></div><div class="stat-card"><div class="label">QA validé</div><div class="value">${esc(o.qa_passed_units)}</div></div></div>
    <div class="settings-section"><div><strong>Devis</strong><p>${money(o.price_per_unit_htg)} / unité · modèle ${esc(o.label_template || "—")}</p></div><strong>${money(o.quoted_total_htg)}</strong></div>
    ${(out.items || []).map((i) => `<div class="settings-section"><div><strong>${esc(i.product_name)}</strong><p>${esc(optionsText(i.variant_options))}${i.sku ? ` · SKU ${esc(i.sku)}` : ""}<br>Code VinHT ${esc(i.internal_code)}${i.gtin ? ` · ${esc(i.gtin_type || "GTIN")} ${esc(i.gtin)}` : ""}${i.asin ? ` · ASIN ${esc(i.asin)}` : ""}</p></div><strong>${esc(i.requested_qty)} u.</strong></div>`).join("")}
    <div style="margin-top:12px"><strong>Progression</strong>${(out.events || []).map((e) => `<div class="table-secondary" style="padding:5px 0">${esc(fmtDate(e.created_at))} — ${esc(e.to_status ? (labels[e.to_status] || e.to_status) : e.event_type)}</div>`).join("") || '<p class="muted">Aucun événement.</p>'}</div>
    <button class="btn btn-ghost btn-sm" type="button" data-close-detail style="margin-top:12px">Fermer</button></div>`;
  host.querySelector("[data-close-detail]")?.addEventListener("click", () => { host.hidden = true; host.innerHTML = ""; });
  refreshIcons();
}

function bindActions() {
  document.querySelector("#labelingSearchBtn")?.addEventListener("click", loadTargets);
  document.querySelector("#labelingSearch")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); loadTargets(); } });
  document.querySelector("#labelingQuoteBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { quote = await quoteMyLabelingServiceOrder(requestPayload()); renderRequest(); }
    catch (err) { showToast(errorMessage(err, "Impossible d’obtenir le devis."), "red"); }
    finally { if (!quote || quote.state !== "ready") btn.disabled = false; }
  });
  document.querySelector("#labelingNotes")?.addEventListener("input", () => { requestKey = null; });
  document.querySelector("#labelingSubmitBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    if (!requestKey) requestKey = newLabelingRequestKey();
    try {
      const out = await createMyLabelingServiceOrder(requestPayload(), document.querySelector("#labelingNotes")?.value || "", requestKey);
      if (out.state !== "ready") throw new Error(out.message_fr || out.state || "request-failed");
      showToast(out.idempotent ? "Demande déjà reçue — aucun doublon créé." : "Demande d’étiquetage créée ✓");
      requestLines.clear(); quote = null; requestKey = null;
      const notes = document.querySelector("#labelingNotes"); if (notes) notes.value = "";
      renderRequest(); ordersOffset = 0; await Promise.all([loadOrders(), refreshContext()]);
    } catch (err) { showToast(errorMessage(err, "Impossible d’envoyer la demande."), "red"); btn.disabled = false; }
  });
  document.querySelector("#labelingStatusFilter")?.addEventListener("change", () => { ordersOffset = 0; loadOrders(); });
  document.querySelector("#labelingOrdersPrev")?.addEventListener("click", () => { ordersOffset = Math.max(0, ordersOffset - ordersLimit); loadOrders(); });
  document.querySelector("#labelingOrdersNext")?.addEventListener("click", () => { ordersOffset += ordersLimit; loadOrders(); });
}

async function refreshContext() {
  ctx = await getMyLabelingServiceContext();
  if (ctx.state === "merchant_required") {
    gateHtml(`<div class="empty-state"><div class="empty-icon"><i data-lucide="store"></i></div><h3>Espace marchand requis</h3><p>${esc(ctx.message_fr || "Activez votre espace marchand pour utiliser ce service.")}</p><a class="btn btn-blue" href="../merchant.html">Devenir marchand</a></div>`);
    return false;
  }
  fillIdentity(); renderServiceCard(); showContent(); return true;
}

async function boot() {
  if (!document.querySelector("#merchantLabelingHost")) return;
  const session = await getSession();
  if (!session?.user) {
    gateHtml('<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour gérer vos étiquettes et vos demandes.</p><button class="btn btn-blue" type="button" data-label-login>Se connecter</button></div>');
    document.querySelector("[data-label-login]")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }
  gateHtml('<div class="loading-state">Chargement du service d’étiquetage…</div>');
  try {
    const ok = await refreshContext(); if (!ok) return;
    bindActions(); renderRequest(); await Promise.all([loadTargets(), loadOrders()]); refreshIcons();
  } catch (err) {
    gateHtml(`<div class="error-state">${esc(errorMessage(err, "Impossible de charger le service d’étiquetage."))}</div>`);
  }
}

let lastUid = undefined;
onAuthChange((session) => {
  const uid = session?.user?.id || null;
  if (uid === lastUid) return;
  lastUid = uid;
  boot();
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
