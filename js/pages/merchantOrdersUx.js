import { refreshIcons } from "../lib/icons.js";
import { getSession } from "../services/auth.js";
import { getSupabase } from "../services/supabase.js";
import {
  getMyMerchant,
  getMerchantOrders,
  getMerchantOrderItems,
  getOrdersByIds,
  updateMerchantOrderStatus,
} from "../services/merchantCenter.js";
import { showToast } from "../ui/toast.js";
import { describePublishResult, publishErrorFr, dispatchBlockReasonFr } from "../services/merchantDispatch.js";
import { attachGeoHints } from "../services/geoHints.js";
import { getDeliveryStateMachineContract, DELIVERY_STATUS_FR } from "../services/deliveryContract.js";
import {
  groupTasksByMyMerchantOrder, taskItems, optionsLabel, amountOf, formatAmount, merchantTaskActions,
  fulfillmentReadinessMessageFr, readinessMapFrom, isFulfillmentReady, readinessReasonFor,
  PAYOUT_STATUS_FR, isPayoutReversalRequired, payoutErrorMessageFr,
} from "../services/merchantFulfillment.js";

// Espace Commandes marchand — modèle multi-fulfillment.
//  * Les actions de livraison se font TOUJOURS par delivery_task_id
//    (merchant_publish_fulfillment_task_v1, merchant_set_fulfillment_pickup_contact_v1,
//    merchant_confirm_delivery_handoff_v1), jamais via le merchant_order vendeur.
//  * Une task se rattache à la commande du marchand connecté par
//    task.my_merchant_order_id (et non task.merchant_order_id = vendeur).
//  * Autorisation d'une action de livraison : contrat backend
//    get_delivery_state_machine_contract_v1 ; aucune règle paiement/COD locale.
//  * Autorisation de PROGRESSION commande (accepter/préparer/publier) : readiness
//    backend (merchant_list_fulfillment_readiness_v1 → order_fulfillment_readiness_v1),
//    jamais payment_status==="paid" ni payment_method==="cod" recalculés ici.

const host = document.querySelector("#merchantOrdersHost");
const gate = document.querySelector("[data-merchant-gate]");
const content = document.querySelector("[data-merchant-content]");

let currentMerchant = null;
let defaultPhone = "";
let rendering = false;
let refreshTimer = null;
let observer = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[m]));

const fmtDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};

const cleanPhone = (v) => String(v || "").trim();
const validPhone = (v) => {
  const s = cleanPhone(v);
  return s.length >= 7 && s.length <= 32 && /^[0-9+() .-]+$/.test(s);
};

const PAYMENT_FR = { pending: "en attente", authorized: "autorisé", paid: "payé", failed: "échoué", cancelled: "annulé", refunded: "remboursé", partially_refunded: "partiellement remboursé" };
const RELATION_FR = { seller: "Vendeur", source_supplier: "Fournisseur" };
// Statut de la commande parente (orders.status) : uniquement pour choisir un
// libellé de présentation (annulée vs remboursée). Ne conditionne aucune action.
const PARENT_TERMINAL = new Set(["cancelled", "refunded"]);

async function listMerchantDeliveryReturns() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_list_delivery_returns_v1", { p_status: null, p_limit: 100, p_offset: 0 });
  if (error) throw error;
  if (!data || data.state !== "ready" || !Array.isArray(data.rows)) throw new Error("merchant_returns_malformed_response");
  return data.rows;
}
async function confirmMerchantDeliveryReturn(taskId, proofReference, note = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_confirm_delivery_return_received_v1", {
    p_delivery_task_id: taskId,
    p_proof_reference: String(proofReference || "").trim(),
    p_note: String(note || "").trim() || null,
  });
  if (error) throw error;
  return data;
}
function returnCardsHtml(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return `<div class="portal-card"><h3>Retours de colis attendus</h3><p class="muted">Ces retours viennent du moteur de custody VinHT. Confirmez seulement après réception physique.</p>
    ${rows.map((r) => `<div class="settings-section" data-return-task="${esc(r.delivery_task_id)}" style="align-items:stretch;flex-direction:column">
      <div style="min-width:0;flex:1"><strong>Mission ${esc(String(r.delivery_task_id).slice(0,8))}</strong>
        <p>Recovery : ${esc(r.recovery_status)} · livraison : ${esc(DELIVERY_STATUS_FR[r.delivery_status] || r.delivery_status || "—")}</p>
        ${r.recovery_status === "required" ? '<p class="muted">Le retour est demandé. En attente du démarrage par le livreur détenteur.</p>' : ""}
        ${r.recovery_status === "returning" ? `<div class="field"><label>Référence de preuve *</label><input class="input" data-return-proof aria-label="Référence de preuve du retour" maxlength="200" placeholder="Référence reçu / contrôle"></div><div class="field"><label>Note</label><textarea class="input" rows="2" data-return-note aria-label="Note facultative sur le retour"></textarea></div>` : ""}
        ${r.recovery_status === "completed" ? '<span class="badge green">Retour reçu</span>' : ""}
      </div>
      ${r.recovery_status === "returning" ? `<button class="btn btn-blue btn-sm" type="button" data-return-confirm="${esc(r.delivery_task_id)}">Confirmer la réception</button>` : ""}
    </div>`).join("")}</div>`;
}

const isParentRefunded = (parent) => String(parent?.status || "").toLowerCase() === "refunded" || String(parent?.payment_status || "").toLowerCase() === "refunded";
const isParentTerminal = (parent) => PARENT_TERMINAL.has(String(parent?.status || "").toLowerCase()) || ["cancelled", "refunded"].includes(String(parent?.payment_status || "").toLowerCase());

function installStyles() {
  if (document.querySelector("#merchantOrdersUxStyles")) return;
  const style = document.createElement("style");
  style.id = "merchantOrdersUxStyles";
  style.textContent = `
    .order-ux-card{margin-bottom:18px;overflow:hidden}
    .order-ux-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}
    .order-ux-title{font-size:15px;font-weight:850;color:var(--ink,#14213d)}
    .order-ux-meta{font-size:12px;color:var(--muted,#6f7891);margin-top:4px}
    .order-ux-status{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;font-size:11px;font-weight:800;background:#eef3ff;color:#2447b8}
    .order-ux-status.green{background:#edf9f0;color:#167a35}
    .order-ux-status.amber{background:#fff7e8;color:#996000}
    .order-ux-status.blue{background:#eef3ff;color:#2447b8}
    .order-ux-status.gray{background:#f3f5f8;color:#596275}
    .order-ux-status.red{background:#fdecee;color:#b0122a}
    .order-ux-progress{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:18px 0 16px}
    .order-ux-step{position:relative;text-align:center;font-size:10px;color:#596275;padding-top:31px;line-height:1.25}
    .order-ux-step:before{content:attr(data-n);position:absolute;top:0;left:50%;transform:translateX(-50%);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#eef1f5;color:#7b8495;font-weight:850;z-index:2}
    .order-ux-step:after{content:"";position:absolute;height:3px;top:11px;left:calc(-50% + 16px);right:calc(50% + 16px);background:#e8ebf1;z-index:1}
    .order-ux-step:first-child:after{display:none}
    .order-ux-step.done,.order-ux-step.active{color:#19356f;font-weight:750}
    .order-ux-step.done:before{content:"✓";background:#dff5e5;color:#167a35}
    .order-ux-step.active:before{background:#1747d1;color:white;box-shadow:0 0 0 4px #e8efff}
    .order-ux-step.done:after,.order-ux-step.active:after{background:#9eb5f4}
    .order-ux-guidance{border:1px solid #e4e9f4;background:#f8faff;border-radius:14px;padding:14px 16px;margin:10px 0 14px}
    .order-ux-guidance strong{display:block;font-size:13px;margin-bottom:5px;color:#17284f}
    .order-ux-guidance p{margin:0;color:#606a7d;font-size:12px;line-height:1.55}
    .order-ux-guidance.incident{border-color:#f6c6cc;background:#fdecee}
    .order-ux-guidance.incident strong{color:#7a2222}
    .order-ux-guidance.incident p{color:#7a2222}
    .order-ux-items{border-top:1px solid #edf0f5;margin-top:12px}
    .order-ux-item{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #edf0f5;font-size:12px}
    .order-ux-task{border:1px solid #dfe6f5;border-radius:14px;padding:12px 14px;margin-top:12px;background:#fff}
    .order-ux-task-head{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
    .order-ux-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px}
    .order-ux-pickup{margin-top:12px;border:1px solid #dfe6f5;border-radius:14px;padding:14px;background:white}
    .order-ux-pickup[hidden]{display:none}
    .order-ux-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-top:10px}
    .order-ux-grid .input{width:100%}
    .order-ux-help{font-size:11px;color:#6f7891;line-height:1.5;margin-top:6px}
    .order-ux-auto{font-size:10px;color:#596275;display:flex;align-items:center;gap:5px}
    .order-ux-contact{margin:12px 0;padding:12px 14px;border:1px solid #cfe8d6;background:#f3faf5;border-radius:12px}
    .order-ux-contact.needs{border-color:#f1d79b;background:#fff8e7}
    .order-ux-payout-alert{margin-top:8px;border:1px solid #f6c6cc;background:#fdecee;border-radius:12px;padding:10px 12px;font-size:12px;color:#7a2222;line-height:1.5}
    .order-ux-payout-alert strong{display:block;margin-bottom:2px}
    @media(max-width:760px){.order-ux-progress{grid-template-columns:1fr}.order-ux-step{text-align:left;padding:0 0 0 34px;min-height:28px}.order-ux-step:before{left:0;transform:none}.order-ux-step:after{display:none}.order-ux-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function showMerchantIdentity(m) {
  document.querySelectorAll("[data-merchant-name]").forEach((x) => { x.textContent = m.shop_name || "Ma boutique"; });
  document.querySelectorAll("[data-merchant-type]").forEach((x) => { x.textContent = m.merchant_type || "Marchand VinHT"; });
  document.querySelectorAll("[data-merchant-initial]").forEach((x) => { x.textContent = (m.shop_name || "V").charAt(0).toUpperCase(); });
}

function showContent() {
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;
}

function showGate(title, text) {
  if (!gate || !content) return;
  content.hidden = true;
  gate.hidden = false;
  gate.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  refreshIcons();
}

// --- Accès backend ---------------------------------------------------------

async function listFulfillmentTasks() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const all = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const { data, error } = await sb.rpc("list_my_fulfillment_deliveries_v1", { p_status: null, p_limit: 100, p_offset: offset });
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

// Bloc 2 : readiness paiement en un seul appel batch pour TOUS les merchant_orders
// du marchand connecté dans son environnement courant (aucune boucle par commande).
// merchant_list_fulfillment_readiness_v1 est limité à authenticated, au marchand
// connecté et à son environnement ; il ne fait qu'exposer
// app_private.order_fulfillment_readiness_v1 — jamais appelé directement ici.
async function listFulfillmentReadiness() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_list_fulfillment_readiness_v1", { p_merchant_order_ids: null });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function publishFulfillmentTask(deliveryTaskId, location) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_publish_fulfillment_task_v1", {
    p_delivery_task_id: deliveryTaskId,
    p_pickup_location: location,
  });
  if (error) throw error;
  return data;
}

async function setFulfillmentPickupContact(deliveryTaskId, phone) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_set_fulfillment_pickup_contact_v1", {
    p_delivery_task_id: deliveryTaskId,
    p_contact_phone: phone,
  });
  if (error) throw error;
  return data;
}

async function confirmHandoff(deliveryTaskId) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("merchant_confirm_delivery_handoff_v1", {
    p_delivery_task_id: deliveryTaskId,
    p_note: "Colis remis au livreur par le marchand",
  });
  if (error) throw error;
  return data;
}

function errorMessageFr(error) {
  const known = publishErrorFr(error);
  if (known) return known;
  const raw = String(error?.message || error || "").toLowerCase();
  if (raw.includes("authentication")) return "Votre session marchand a expiré. Reconnectez-vous puis réessayez.";
  return "L’action n’a pas pu être terminée. Rien n’a été perdu : réessayez dans quelques secondes.";
}

// --- Présentation (libellés uniquement ; aucune autorisation ici) ----------

const TASK_GUIDANCE = {
  awaiting_fulfillment: { tone: "blue", text: "Préparez le colis, puis indiquez le point de retrait pour le proposer aux livreurs." },
  ready_waiting_dispatch: { tone: "amber", text: "Le colis est prêt mais la mission n’est pas visible des livreurs." },
  awaiting_assignment: { tone: "blue", text: "Mission publiée : les livreurs éligibles de la zone peuvent la voir." },
  assigned: { tone: "green", text: "Un livreur est assigné et doit confirmer. Gardez le colis prêt." },
  accepted: { tone: "green", text: "Le livreur se dirige vers votre point de retrait. Gardez le colis prêt." },
  at_pickup: { tone: "amber", text: "Le livreur est au point de retrait." },
  handoff_pending_merchant: { tone: "amber", text: "Le livreur attend votre confirmation de remise." },
  picked_up: { tone: "blue", text: "Le colis est avec le livreur." },
  in_transit: { tone: "blue", text: "Livraison en cours." },
  arrived_destination: { tone: "blue", text: "Le livreur est arrivé chez le client." },
  delivered: { tone: "green", text: "Livraison terminée." },
  issue: { tone: "red", text: "Incident logistique — intervention requise." },
  cancelled: { tone: "gray", text: "Livraison annulée." },
};

// Texte d'incident enrichi : uniquement de la présentation (choix de phrase selon
// des champs déjà lus), jamais une permission. Si la commande parente est
// commercialement terminale (annulée/remboursée) alors qu'une task reste en
// `issue`, le colis peut être physiquement déjà pris en charge : on l'explique
// sans jamais prétendre connaître une destination de retour. Le moteur backend
// Incident/Custody/Retour est autoritaire ; ce Bloc 2 ne déduit aucune recovery.
function incidentGuidanceFr(parent) {
  if (isParentTerminal(parent)) {
    return "La commande commerciale a été annulée ou remboursée alors que le colis était déjà pris en charge. Le colis doit suivre le processus de récupération/retour. VinHT traite cet incident.";
  }
  return "Incident logistique — intervention requise. VinHT traite cette mission.";
}

function deliveryStage(task) {
  const s = String(task?.status || "");
  if (["awaiting_assignment", "assigned", "accepted", "at_pickup", "handoff_pending_merchant"].includes(s)) return 3;
  if (["picked_up", "in_transit", "arrived_destination"].includes(s)) return 4;
  if (s === "delivered") return 5;
  return 0; // dont ready_waiting_dispatch : prête mais NON publiée ; issue/cancelled : pas d'étape franchie en plus
}

function merchantStage(order, tasks) {
  const stages = tasks.map(deliveryStage);
  if (stages.length && stages.every(Boolean)) return Math.min(...stages);
  if (order.status === "new") return 0;
  if (order.status === "accepted") return 1;
  if (order.status === "preparing" || order.status === "ready") return 2;
  if (order.status === "handed_off") return 4;
  if (order.status === "delivered") return 5;
  return 0;
}

const STEPS = ["Commande acceptée", "Préparation", "Mission publiée", "Colis remis", "Livrée"];

function progressHtml(stage) {
  return `<div class="order-ux-progress" aria-label="Avancement de la commande">${STEPS.map((label, i) => {
    const n = i + 1;
    const cls = stage > n ? "done" : stage === n ? "active" : "";
    return `<div class="order-ux-step ${cls}" data-n="${n}">${esc(label)}</div>`;
  }).join("")}</div>`;
}

// order = merchant_order du marchand connecté ; parent = orders (commande globale) ;
// tasks = tasks de livraison rattachées à CE merchant_order (my_merchant_order_id) ;
// readinessMap/readinessOk = merchant_list_fulfillment_readiness_v1 (batch, backend).
function orderView(order, tasks, parent, readinessMap, readinessOk) {

  // Un incident logistique (task en `issue`, éventuellement après annulation/
  // remboursement commercial post-custody) prime sur le statut générique de la
  // commande marchand : on ne doit jamais afficher « annulée, terminé » alors que
  // le colis reste physiquement en cours de traitement.
  if (tasks.some((t) => String(t?.status || "") === "issue")) {
    return { badge: "Incident", tone: "red", title: "Incident logistique — intervention requise",
      text: incidentGuidanceFr(parent), action: null, autoRefresh: true, incident: true };
  }
  if (order.status === "cancelled") {
    return { badge: isParentRefunded(parent) ? "Remboursée" : "Annulée", tone: "gray",
      title: isParentRefunded(parent) ? "Commande remboursée" : "Commande annulée",
      text: "Cette commande est terminée côté commercial. Aucune action de préparation ou de livraison n’est attendue de votre part.", action: null };
  }
  if (order.status === "delivered") return { badge: "Livrée", tone: "green", title: "Commande livrée", text: "VinHT poursuit le traitement de la protection et du paiement.", action: null };
  if (order.status === "new") {
    if (!readinessOk) return { badge: "Vérification en cours", tone: "gray", title: "Vérification du paiement momentanément indisponible",
      text: "Impossible de vérifier l’autorisation de préparation pour le moment. Réessayez dans un instant.", action: null, autoRefresh: true };
    if (!isFulfillmentReady(readinessMap, order.id)) {
      return { badge: "Paiement en attente", tone: "amber", title: "Nouvelle commande — paiement à confirmer",
        text: fulfillmentReadinessMessageFr(readinessReasonFor(readinessMap, order.id)), action: null, autoRefresh: true };
    }
    return { badge: "Nouvelle commande", tone: "amber", title: "Une nouvelle commande vous attend", text: "Vérifiez les articles. Si vous pouvez la traiter, acceptez-la.", action: "accept" };
  }
  if (order.status === "accepted") {
    if (!readinessOk) return { badge: "Vérification en cours", tone: "gray", title: "Vérification du paiement momentanément indisponible",
      text: "Impossible de vérifier l’autorisation de préparation pour le moment. Réessayez dans un instant.", action: null, autoRefresh: true };
    if (!isFulfillmentReady(readinessMap, order.id)) {
      return { badge: "Paiement en attente", tone: "amber", title: "Commande acceptée — paiement à confirmer",
        text: fulfillmentReadinessMessageFr(readinessReasonFor(readinessMap, order.id)), action: null, autoRefresh: true };
    }
    return { badge: "Commande acceptée", tone: "blue", title: "Vous avez accepté cette commande", text: "Rassemblez les articles et commencez la préparation.", action: "prepare" };
  }
  if (!tasks.length && ["preparing", "ready", "handed_off"].includes(order.status)) {
    return { badge: "Livraison non rattachée", tone: "gray", title: "Aucune livraison à gérer de votre côté",
      text: "Cette commande n’a pas de livraison qui vous soit confiée : elle est assurée par un autre marchand, ou n’est pas encore créée. Aucune action de livraison n’est possible ici.", action: null, autoRefresh: true };
  }
  if (order.status === "preparing") return { badge: "En préparation", tone: "amber", title: "Préparez et emballez le colis", text: "Quand le colis est prêt, publiez la livraison depuis le bloc ci-dessous.", action: null };
  if (order.status === "handed_off") return { badge: "Colis remis", tone: "blue", title: "Le colis a été remis au livreur", text: "Suivez l’avancement de la livraison ci-dessous ; VinHT met cet écran à jour automatiquement.", action: null, autoRefresh: true };
  return { badge: "En traitement", tone: "blue", title: "Suivi de la livraison", text: "Suivez l’avancement ci-dessous ; VinHT met cet écran à jour automatiquement.", action: null, autoRefresh: true };
}

function itemsHtml(order, tasks, orderItems) {
  // Articles physiques : task.items (jamais order_items.merchant_order_id === MO fournisseur).
  const blocks = [];
  for (const t of tasks) {
    const list = taskItems(t);
    if (!list.length) continue;
    blocks.push(list.map((it) => `<div class="order-ux-item"><div><strong>${esc(it.name)}</strong><div class="order-ux-meta">${[it.sku && `SKU ${esc(it.sku)}`, esc(optionsLabel(it.options))].filter(Boolean).join(" · ") || "&nbsp;"}</div></div><strong>× ${esc(it.quantity)}</strong></div>`).join(""));
  }
  if (blocks.length) return `<div class="order-ux-items">${blocks.join("")}</div>`;
  if (tasks.length) return `<div class="order-ux-items"><div class="order-ux-help">Le détail des articles à préparer sera disponible avec la livraison.</div></div>`;
  // Aucune task : lignes financières de CE merchant_order (currency-aware).
  if (!orderItems.length) return "";
  return `<div class="order-ux-items">${orderItems.map((it) => `<div class="order-ux-item"><div><strong>${esc(it.product_name)}</strong><div class="order-ux-meta">Quantité : ${esc(it.quantity)} · ${it.pricing_tier === "wholesale" ? "Gros" : "Détail"}</div></div><strong>${esc(formatAmount(amountOf(it, "line_total_amount", "line_total_htg")))}</strong></div>`).join("")}</div>`;
}

// Versement : lecture directe de payout_status/payout_error (currency-aware).
// Ne jamais afficher « payé » comme « annulé » ni l'inverse : on reflète
// exactement ce que le backend a écrit, y compris le marqueur reversal_required
// lorsqu'un versement déjà effectué doit être régularisé après coup.
function totalsHtml(order) {
  const sub = amountOf(order, "subtotal_amount", "subtotal_htg");
  const payout = amountOf(order, "payout_amount", "payout_amount_htg");
  const rows = [`<div class="order-ux-item"><div><strong>Total de vos articles</strong><div class="order-ux-meta">Montants fixés par VinHT ; frais et protections gérés automatiquement.</div></div><strong>${esc(formatAmount(sub))}</strong></div>`];
  const payoutStatus = order.payout_status || null;
  if (payoutStatus) {
    rows.push(`<div class="order-ux-item"><div><strong>Versement</strong><div class="order-ux-meta">${esc(PAYOUT_STATUS_FR[payoutStatus] || payoutStatus)}</div></div><strong>${esc(formatAmount(payout))}</strong></div>`);
  } else if (payout.value !== null) {
    rows.push(`<div class="order-ux-item"><div><strong>Versement prévu</strong><div class="order-ux-meta">Calculé par le serveur.</div></div><strong>${esc(formatAmount(payout))}</strong></div>`);
  }
  let alert = "";
  if (isPayoutReversalRequired(payoutStatus, order.payout_error)) {
    alert = `<div class="order-ux-payout-alert"><strong>Versement déjà effectué — vérification en cours</strong>${esc(payoutErrorMessageFr(order.payout_error))} Le statut « Payé » reste inchangé tant que VinHT n’a pas traité la régularisation ; aucune somme n’a été reprise automatiquement.</div>`;
  } else if (payoutStatus === "cancelled" && order.payout_error) {
    alert = `<div class="order-ux-help">${esc(payoutErrorMessageFr(order.payout_error))}</div>`;
  }
  return rows.join("") + alert;
}

function pickupPanelHtml(task) {
  const loc = task.source_location || {};
  const taskId = esc(task.delivery_task_id);
  return `<div class="order-ux-pickup" data-pickup-panel="${taskId}" hidden>
    <strong>Où le livreur doit-il récupérer le colis ?</strong>
    <div class="order-ux-help">Cette adresse sert uniquement au retrait de cette livraison. Le livreur la verra après avoir pris la mission.</div>
    <div class="order-ux-grid">
      <input class="input" data-pickup-address placeholder="Adresse de retrait (ex. rue, numéro, repère)" value="${esc(loc.address || loc.address_line1 || "")}" required>
      <input class="input" data-pickup-commune data-geo="commune" autocomplete="off" placeholder="Commune" value="${esc(loc.commune || currentMerchant?.delivery_zone || "")}" required>
      <input class="input" data-pickup-department data-geo="department" autocomplete="off" placeholder="Département" value="${esc(loc.department || "")}" required>
    </div>
    <div style="margin-top:10px">
      <label style="display:block;font-size:12px;font-weight:800;margin-bottom:6px;color:#17284f">Numéro de contact (appel & WhatsApp) *</label>
      <input class="input" data-pickup-contact inputmode="tel" autocomplete="tel" placeholder="Ex. 37 00 00 00" value="${esc(cleanPhone(loc.contact_phone) || defaultPhone)}" style="width:100%" required>
      <div class="order-ux-help">Le livreur pourra vous appeler ou vous écrire sur WhatsApp. Ce numéro n’est visible qu’au livreur qui prend réellement la mission.</div>
    </div>
    <input class="input" style="width:100%;margin-top:10px" data-pickup-instructions placeholder="Instructions facultatives pour trouver le point de retrait">
    <div class="order-ux-actions">
      <button class="btn btn-blue btn-sm" type="button" data-ux-action="confirm-publish" data-task="${taskId}">Publier la mission aux livreurs</button>
      <button class="btn btn-ghost btn-sm" type="button" data-ux-action="cancel-pickup" data-task="${taskId}">Annuler</button>
    </div>
  </div>`;
}

const CONTACT_EDITABLE = ["awaiting_assignment", "assigned", "accepted", "at_pickup", "handoff_pending_merchant"];

function contactEditorHtml(task) {
  const phone = cleanPhone(task?.source_location?.contact_phone);
  return `<div class="order-ux-contact${phone ? "" : " needs"}" data-contact-editor="${esc(task.delivery_task_id)}">
    <strong style="display:block;font-size:12px;color:#17284f">${phone ? "Numéro transmis au livreur" : "Ajoutez un numéro pour que le livreur puisse vous joindre"}</strong>
    <p style="font-size:11px;color:#667085;margin:5px 0 9px;line-height:1.5">${phone ? `Le livreur peut vous appeler ou vous écrire sur WhatsApp au ${esc(phone)}.` : "Seul le livreur qui a pris la mission pourra voir ce numéro."}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input class="input" data-active-pickup-contact inputmode="tel" autocomplete="tel" placeholder="Ex. 37 00 00 00" value="${esc(phone || defaultPhone)}" style="max-width:240px">
      <button class="btn btn-outline-blue btn-sm" type="button" data-ux-action="save-contact" data-task="${esc(task.delivery_task_id)}">${phone ? "Modifier le numéro" : "Enregistrer le numéro"}</button>
    </div>
  </div>`;
}

function taskBlockHtml(task, contract, contractOk, readinessMap, readinessOk) {
  const status = String(task.status || "");
  const guide = TASK_GUIDANCE[status] || { tone: "gray", text: "" };
  const acts = merchantTaskActions(contract, task);
  const blockWhy = status === "ready_waiting_dispatch" ? dispatchBlockReasonFr(task.dispatch_block_reason || task.dispatch_readiness?.reason) : "";
  // Capacité Livraison = contrat backend (acts.canPublish) ET readiness paiement
  // backend pour LE merchant_order de ce fournisseur (task.my_merchant_order_id).
  // merchant_publish_fulfillment_task_v1 revalide lui-même la readiness ; on ne
  // fait qu'anticiper son refus pour ne pas envoyer un appel qu'on sait déjà
  // condamné. Le statut du merchant_order n'est JAMAIS lu ici comme permission.
  const myReady = readinessOk && isFulfillmentReady(readinessMap, task.my_merchant_order_id);
  const showPublish = acts.canPublish && myReady;
  const readinessBlockedForPublish = acts.canPublish && !showPublish;
  const readinessNote = readinessBlockedForPublish
    ? (readinessOk
      ? fulfillmentReadinessMessageFr(readinessReasonFor(readinessMap, task.my_merchant_order_id))
      : "Vérification du paiement momentanément indisponible : réessayez dans un instant.")
    : "";
  const taskId = esc(task.delivery_task_id);
  const relation = RELATION_FR[task.my_relation_role] || "";
  return `<div class="order-ux-task" data-task-block="${taskId}">
    <div class="order-ux-task-head">
      <strong style="font-size:12px;color:#17284f">Livraison · ${esc(String(task.delivery_task_id).slice(0, 8))}${relation ? ` · ${esc(relation)}` : ""}</strong>
      <span class="order-ux-status ${esc(guide.tone)}">${esc(DELIVERY_STATUS_FR[status] || status)}</span>
    </div>
    <p class="order-ux-help">${esc(guide.text)}${blockWhy ? ` ${esc(blockWhy)}` : ""}</p>
    ${readinessNote ? `<p class="order-ux-help" style="color:#996000">${esc(readinessNote)}</p>` : ""}
    ${!contractOk ? '<p class="order-ux-help" style="color:#996000">Règles de livraison momentanément indisponibles : aucune action de livraison n’est proposée.</p>' : ""}
    ${CONTACT_EDITABLE.includes(status) ? contactEditorHtml(task) : ""}
    <div class="order-ux-actions">
      ${showPublish ? `<button class="btn btn-blue" type="button" data-ux-action="show-pickup" data-task="${taskId}">${status === "ready_waiting_dispatch" ? "Vérifier le retrait et republier" : "Commande prête pour livraison"}</button>` : ""}
      ${acts.canConfirmHandoff ? `<button class="btn btn-blue" type="button" data-ux-action="handoff" data-task="${taskId}">J’ai remis le colis au livreur</button>` : ""}
    </div>
    ${showPublish ? pickupPanelHtml(task) : ""}
  </div>`;
}

function cardHtml(order, parent, orderItems, tasks, contract, contractOk, readinessMap, readinessOk) {
  const view = orderView(order, tasks, parent, readinessMap, readinessOk);
  const stage = merchantStage(order, tasks);
  const customerName = parent?.full_name || "Client VinHT";
  const demo = String(order.environment || "").toLowerCase() === "demo" ? '<span class="badge amber">MODE DEMO</span>' : "";
  const roles = [...new Set(tasks.map((t) => RELATION_FR[t.my_relation_role]).filter(Boolean))];
  const pay = parent?.payment_status ? `Paiement ${PAYMENT_FR[parent.payment_status] || parent.payment_status}` : "";
  return `<article class="portal-card order-ux-card" data-ux-order="${esc(order.id)}">
    <div class="order-ux-head">
      <div>
        <div class="order-ux-title">Commande #${esc(String(order.order_id).slice(0, 8))} ${demo}${roles.length ? `<span class="badge">${esc(roles.join(" + "))}</span>` : ""}</div>
        <div class="order-ux-meta">${esc(customerName)} · ${esc(fmtDate(order.created_at))}${pay ? ` · ${esc(pay)}` : ""}</div>
      </div>
      <span class="order-ux-status ${esc(view.tone)}">${esc(view.badge)}</span>
    </div>
    ${progressHtml(stage)}
    <div class="order-ux-guidance${view.incident ? " incident" : ""}"><strong>${esc(view.title)}</strong><p>${esc(view.text)}</p></div>
    ${itemsHtml(order, tasks, orderItems)}
    <div class="order-ux-items">${totalsHtml(order)}</div>
    ${tasks.map((t) => taskBlockHtml(t, contract, contractOk, readinessMap, readinessOk)).join("")}
    <div class="order-ux-actions">
      ${view.action === "accept" ? `<button class="btn btn-blue" type="button" data-ux-action="accept" data-mo="${esc(order.id)}">Accepter la commande</button>` : ""}
      ${view.action === "prepare" ? `<button class="btn btn-blue" type="button" data-ux-action="prepare" data-mo="${esc(order.id)}">Commencer la préparation</button>` : ""}
      ${view.autoRefresh ? '<span class="order-ux-auto"><i data-lucide="refresh-cw"></i> Mise à jour automatique</span>' : ""}
    </div>
  </article>`;
}

function orphanTaskHtml(task, contract, contractOk, readinessMap, readinessOk) {
  // Livraison sans commande "mine" rattachée : jamais masquée silencieusement.
  return `<article class="portal-card order-ux-card" data-ux-orphan="${esc(task.delivery_task_id)}">
    <div class="order-ux-title">Livraison ${esc(String(task.delivery_task_id).slice(0, 8))} <span class="badge">Sans commande associée</span></div>
    <div class="order-ux-help">Cette livraison vous est confiée mais aucune de vos commandes ne lui est rattachée (portée financière absente). Contactez VinHT si elle persiste.</div>
    ${taskBlockHtml(task, contract, contractOk, readinessMap, readinessOk)}
  </article>`;
}

const LIVE = ["awaiting_fulfillment", "ready_waiting_dispatch", "awaiting_assignment", "assigned", "accepted", "at_pickup", "handoff_pending_merchant", "picked_up", "in_transit", "arrived_destination", "issue"];

function scheduleRefresh(tasks) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (tasks.some((t) => LIVE.includes(String(t.status || ""))) && currentMerchant) {
    refreshTimer = setTimeout(() => {
      // Ne recharge pas sous les doigts du marchand pendant une saisie.
      if (host.contains(document.activeElement) && document.activeElement?.matches?.("input,textarea")) { scheduleRefresh(tasks); return; }
      renderOrders(currentMerchant, { quiet: true });
    }, 12000);
  }
}

async function renderOrders(merchant, { quiet = false } = {}) {
  if (!host || !merchant || rendering) return;
  rendering = true;
  try {
    if (!quiet) host.innerHTML = '<div class="loading-state">Chargement de vos commandes…</div>';
    const orders = await getMerchantOrders(merchant.id);
    const [items, parents, tasks, contractRes, readinessRes, returns] = await Promise.all([
      getMerchantOrderItems(orders.map((o) => o.id)),
      getOrdersByIds(orders.map((o) => o.order_id)),
      listFulfillmentTasks(),
      getDeliveryStateMachineContract().then((c) => ({ contract: c, ok: true }), () => ({ contract: null, ok: false })),
      listFulfillmentReadiness().then((rows) => ({ map: readinessMapFrom(rows), ok: true }), () => ({ map: readinessMapFrom([]), ok: false })),
      listMerchantDeliveryReturns(),
    ]);
    if (!orders.length && !tasks.length && !returns.length) {
      host.innerHTML = '<div data-orders-ux-root class="empty-state"><div class="empty-icon"><i data-lucide="clipboard-list"></i></div><h3>Aucune commande</h3><p>Les nouvelles commandes apparaîtront ici avec les prochaines étapes à suivre.</p></div>';
      refreshIcons();
      return;
    }
    const pmap = new Map(parents.map((o) => [o.id, o]));
    const imap = new Map();
    for (const it of items) {
      if (!imap.has(it.merchant_order_id)) imap.set(it.merchant_order_id, []);
      imap.get(it.merchant_order_id).push(it);
    }
    const { byMo, unlinked } = groupTasksByMyMerchantOrder(tasks);
    const known = new Set(orders.map((o) => String(o.id)));
    const orphans = [...unlinked, ...[...byMo.entries()].filter(([k]) => !known.has(k)).flatMap(([, v]) => v)];
    host.innerHTML = `<div data-orders-ux-root>${returnCardsHtml(returns)}${orders.map((o) => cardHtml(
      o, pmap.get(o.order_id), imap.get(o.id) || [], byMo.get(String(o.id)) || [], contractRes.contract, contractRes.ok, readinessRes.map, readinessRes.ok,
    )).join("")}${orphans.map((t) => orphanTaskHtml(t, contractRes.contract, contractRes.ok, readinessRes.map, readinessRes.ok)).join("")}</div>`;
    wireActions(merchant);
    wireReturnActions(merchant);
    attachGeoHints(host);
    refreshIcons();
    scheduleRefresh(tasks);
  } catch (error) {
    console.error("merchant orders UX load failed", error);
    host.innerHTML = `<div data-orders-ux-root class="error-state"><strong>Nous n’arrivons pas à afficher vos commandes pour le moment.</strong><br><span style="font-size:12px">Vos commandes ne sont pas perdues. Vérifiez votre connexion puis réessayez.</span><br><button class="btn btn-ghost btn-sm" type="button" data-ux-retry style="margin-top:10px">Réessayer</button></div>`;
    host.querySelector("[data-ux-retry]")?.addEventListener("click", () => renderOrders(merchant));
  } finally {
    rendering = false;
  }
}


function wireReturnActions(merchant) {
  host.querySelectorAll("[data-return-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-return-task]");
      const proof = card?.querySelector("[data-return-proof]")?.value.trim() || "";
      const note = card?.querySelector("[data-return-note]")?.value.trim() || null;
      if (!proof) { showToast("Ajoutez la référence de preuve avant de confirmer la réception.", "red"); card?.querySelector("[data-return-proof]")?.focus(); return; }
      button.disabled = true;
      try {
        await confirmMerchantDeliveryReturn(button.dataset.returnConfirm, proof, note);
        showToast("Retour marchand confirmé ✓ La custody est maintenant clôturée.");
        await renderOrders(merchant);
      } catch (error) {
        button.disabled = false;
        showToast(publishErrorFr(error) || String(error?.message || "Confirmation du retour impossible."), "red");
      }
    });
  });
}

function panelFor(taskId) {
  return host.querySelector(`[data-pickup-panel="${CSS.escape(taskId)}"]`);
}

function wireActions(merchant) {
  host.querySelectorAll("[data-ux-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.uxAction;
      const mo = button.dataset.mo;
      const taskId = button.dataset.task;

      if (action === "show-pickup") { const p = panelFor(taskId); if (p) p.hidden = false; return; }
      if (action === "cancel-pickup") { const p = panelFor(taskId); if (p) p.hidden = true; return; }

      button.disabled = true;
      try {
        if (action === "accept") {
          await updateMerchantOrderStatus(mo, "accepted");
          showToast("Commande acceptée ✓ Prochaine étape : commencez la préparation.");
        } else if (action === "prepare") {
          await updateMerchantOrderStatus(mo, "preparing");
          showToast("Préparation commencée ✓ Emballez le colis puis indiquez quand il est prêt.");
        } else if (action === "confirm-publish") {
          const panel = button.closest("[data-pickup-panel]");
          const address = panel?.querySelector("[data-pickup-address]")?.value.trim() || "";
          const commune = panel?.querySelector("[data-pickup-commune]")?.value.trim() || "";
          const department = panel?.querySelector("[data-pickup-department]")?.value.trim() || "";
          const instructions = panel?.querySelector("[data-pickup-instructions]")?.value.trim() || "";
          const phoneInput = panel?.querySelector("[data-pickup-contact]");
          const phone = cleanPhone(phoneInput?.value);
          if (!address || !commune || !department) {
            showToast("Indiquez l’adresse, la commune et le département du point de retrait.", "red");
            button.disabled = false;
            return;
          }
          if (!validPhone(phone)) {
            showToast("Ajoutez un numéro valide pour que le livreur puisse vous appeler ou vous écrire sur WhatsApp.", "red");
            phoneInput?.focus();
            button.disabled = false;
            return;
          }
          const published = await publishFulfillmentTask(taskId, {
            address, commune, city: commune, department,
            instructions: instructions || null,
            contact_phone: phone, contact_whatsapp_phone: phone,
          });
          defaultPhone = phone;
          const outcome = describePublishResult(published);
          showToast(outcome.message, outcome.published ? "green" : "amber");
        } else if (action === "save-contact") {
          const editor = button.closest("[data-contact-editor]");
          const input = editor?.querySelector("[data-active-pickup-contact]");
          const phone = cleanPhone(input?.value);
          if (!validPhone(phone)) {
            showToast("Entrez un numéro valide pour les appels et WhatsApp.", "red");
            input?.focus();
            button.disabled = false;
            return;
          }
          await setFulfillmentPickupContact(taskId, phone);
          defaultPhone = phone;
          showToast("Numéro enregistré ✓ Le livreur peut maintenant vous joindre.");
        } else if (action === "handoff") {
          await confirmHandoff(taskId);
          showToast("Remise confirmée ✓ Le livreur peut poursuivre la livraison.");
        }
        await renderOrders(merchant);
      } catch (error) {
        console.error("merchant order action failed", error);
        showToast(errorMessageFr(error), "red");
        button.disabled = false;
      }
    });
  });
}

async function init() {
  if (!host) return;
  installStyles();
  try {
    const session = await getSession();
    if (!session?.user) {
      showGate("Connexion requise", "Connectez-vous avec votre compte marchand pour gérer vos commandes.");
      return;
    }
    const merchant = await getMyMerchant();
    if (!merchant) {
      showGate("Espace marchand non activé", "Ce compte n’est pas encore lié à une boutique active.");
      return;
    }
    currentMerchant = merchant;
    defaultPhone = cleanPhone(merchant.whatsapp_number);
    showMerchantIdentity(merchant);
    showContent();
    await renderOrders(merchant);

    if (!observer) {
      observer = new MutationObserver(() => {
        if (!rendering && currentMerchant && !host.querySelector("[data-orders-ux-root]")) {
          setTimeout(() => renderOrders(currentMerchant, { quiet: true }), 0);
        }
      });
      observer.observe(host, { childList: true });
    }
  } catch (error) {
    console.error("merchant orders UX init failed", error);
    showGate("Commandes momentanément indisponibles", "Votre commande reste enregistrée. Actualisez la page dans quelques instants.");
  }
}

window.addEventListener("load", () => setTimeout(init, 120));
