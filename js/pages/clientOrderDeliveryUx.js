import { getSupabase } from "../services/supabase.js";
import { showToast } from "../ui/toast.js";

const host = document.querySelector("#clientOrdersHost");
let activeOrderId = null;
let requestSeq = 0;
let refreshTimer = null;
// Le plaintext OTP n'existe que dans la mémoire de cette page. Il n'est jamais
// persisté (ni localStorage/sessionStorage) et n'est jamais relu du backend.
const issuedDeliveryCodes = new Map();

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[m]));

const STATUS_FR = {
  awaiting_fulfillment: "Le vendeur prépare votre colis",
  ready_waiting_dispatch: "Votre colis est prêt",
  awaiting_assignment: "Recherche d’un livreur",
  assigned: "Un livreur a été trouvé",
  accepted: "Le livreur se rend chez le vendeur",
  at_pickup: "Le livreur est au point de retrait",
  handoff_pending_merchant: "Remise du colis au livreur",
  picked_up: "Le livreur a récupéré votre colis",
  in_transit: "Livraison en cours",
  arrived_destination: "Le livreur est arrivé",
  delivered: "Livrée",
  issue: "Un problème a été signalé",
  cancelled: "Livraison annulée",
};

function statusFr(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_FR[key] || "Livraison en cours de traitement";
}

function isLiveStatus(status) {
  return !["delivered", "cancelled"].includes(String(status || "").toLowerCase());
}

async function getOrderDelivery(orderId) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_my_order_delivery_v1", { p_order_id: orderId });
  if (error) throw error;
  return data || {};
}

async function issueDeliveryConfirmationCode(taskId, rotate = false) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("issue_my_delivery_confirmation_code_v1", {
    p_delivery_task_id: taskId,
    p_rotate: !!rotate,
  });
  if (error) throw error;
  return data || {};
}

async function getDeliveryConfirmationStatus(taskId) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_my_delivery_confirmation_status_v1", {
    p_delivery_task_id: taskId,
  });
  if (error) throw error;
  return data || {};
}

function deliveryCodeErrorFr(err) {
  const raw = String(err?.message || err || "").toLowerCase();
  if (raw.includes("delivery_confirmation_available_only_at_arrival")) return "Le code devient disponible uniquement lorsque le livreur est arrivé.";
  if (raw.includes("delivery_confirmation_code_locked")) return "Le code est verrouillé après plusieurs essais incorrects. Attendez son expiration ou contactez VinHT.";
  if (raw.includes("confirmation_code_rotation_locked_after_attempt")) return "Un essai a déjà été effectué : ce code ne peut plus être remplacé avant son expiration.";
  if (raw.includes("delivery_confirmation_customer_required")) return "Seul le client de cette commande peut générer ce code.";
  if (raw.includes("authentication_required")) return "Reconnectez-vous puis réessayez.";
  return "Impossible de générer le code pour le moment. Réessayez dans un instant.";
}

// Signaux de présence : n'existent que si l'admin les a activés
// (logistics_runtime_settings.customer_presence_signals_enabled). Le backend
// refuse de toute façon si désactivé ; on évite d'afficher un bouton mort.
const PRESENCE_FR = {
  on_the_way: "Je suis en route",
  arrived: "Je suis sur place",
  cannot_attend: "Je ne peux pas recevoir maintenant",
  unsafe: "Ce lieu ne me paraît pas sûr",
};
let _presenceEnabled = null;
async function presenceEnabled() {
  if (_presenceEnabled !== null) return _presenceEnabled;
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("get_logistics_runtime_capabilities_v1");
    _presenceEnabled = !error && data?.customer_presence_signals_enabled === true;
  } catch {
    _presenceEnabled = false;
  }
  return _presenceEnabled;
}

function presenceErrorFr(err) {
  const raw = String(err?.message || err || "").toLowerCase();
  if (raw.includes("customer_presence_signals_disabled")) return "Les signaux de présence ne sont pas activés pour le moment.";
  if (raw.includes("delivery_already_closed")) return "Cette livraison est déjà terminée.";
  if (raw.includes("delivery_task_not_owned_by_client")) return "Cette livraison n'est pas rattachée à votre compte.";
  if (raw.includes("authentication_required")) return "Reconnectez-vous puis réessayez.";
  return "Impossible d'envoyer ce signal pour le moment. Réessayez dans un instant.";
}

async function setPresence(taskId, state) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("client_set_delivery_presence_v1", {
    p_delivery_task_id: taskId, p_state: state, p_note: null,
  });
  if (error) throw error;
  return data;
}

function presenceHtml(delivery) {
  const status = String(delivery?.status || "").toLowerCase();
  const kind = String(delivery?.delivery_kind || "");
  if (!["customer", "secure_meeting"].includes(kind)) return "";
  if (!["accepted", "at_pickup", "handoff_pending_merchant", "picked_up", "in_transit", "arrived_destination"].includes(status)) return "";
  const current = String(delivery?.customer_presence_state || "");
  const btn = (state, cls) => `<button type="button" class="btn ${cls} btn-sm" data-presence="${esc(state)}" data-task="${esc(delivery.delivery_task_id)}"${current === state ? " disabled" : ""}>${esc(PRESENCE_FR[state])}</button>`;
  return `<div data-client-presence style="margin-top:12px">
    <div style="font-size:12px;font-weight:800;color:#17284f;margin-bottom:6px">Prévenir le livreur${current && PRESENCE_FR[current] ? ` <span class="muted" style="font-weight:600">· dernier signal : ${esc(PRESENCE_FR[current])}</span>` : ""}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${btn("on_the_way", "btn-outline-blue")}${btn("arrived", "btn-outline-blue")}${btn("cannot_attend", "btn-ghost")}${btn("unsafe", "btn-ghost")}</div>
  </div>`;
}

const EVENT_FR = {
  fulfillment_ready: "Colis prêt",
  courier_assigned: "Livreur assigné",
  client_presence_updated: "Signal de présence",
  client_safety_alert: "Alerte de sécurité signalée",
  source_location_updated: "Point de retrait mis à jour",
  commercial_cancel_recovery_required: "Incident : récupération du colis requise",
};
// Bloc 2 — le colis peut rester physiquement pris en charge après une annulation/
// remboursement commercial (custody déjà transférée) : le backend le représente en
// laissant la task en statut "issue" et en posant un événement dédié. On lit
// uniquement la note déjà écrite par le serveur ; jamais de workflow de retour local.
const CANCEL_RECOVERY_EVENT = "commercial_cancel_recovery_required";
function recoveryNoteFrom(delivery) {
  const events = Array.isArray(delivery?.timeline) ? delivery.timeline : [];
  const ev = [...events].reverse().find((e) => e?.event_type === CANCEL_RECOVERY_EVENT);
  return ev?.note ? String(ev.note) : null;
}
function timelineLabel(e) {
  const to = String(e?.to_status || "");
  if (to && STATUS_FR[to]) return STATUS_FR[to];
  return EVENT_FR[e?.event_type] || "";
}
function timelineHtml(delivery) {
  const events = Array.isArray(delivery?.timeline) ? delivery.timeline : [];
  const rows = events.map((e) => ({ label: timelineLabel(e), at: e?.created_at })).filter((r) => r.label);
  if (!rows.length) return "";
  return `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;font-weight:800;color:#38508a">Historique de la livraison</summary>
    <ol style="margin:8px 0 0;padding-left:18px;font-size:12px;color:#38508a;line-height:1.7">${rows.map((r) => `<li>${esc(r.label)}${r.at ? ` <span style="color:#98a2b3">· ${esc(new Date(r.at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }))}</span>` : ""}</li>`).join("")}</ol>
  </details>`;
}

function courierLine(courier) {
  if (!courier || typeof courier !== "object") return "";
  const vehicle = [courier.vehicle_make, courier.vehicle_model, courier.vehicle_color]
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" · ");
  return `<div style="margin-top:7px;font-size:12px;color:#667085"><strong>Livreur :</strong> ${esc(courier.name || "Livreur VinHT")}${vehicle ? ` · ${esc(vehicle)}` : ""}</div>`;
}

function codeBlock(code, expiresAt = null) {
  const value = String(code || "").trim();
  if (!value) return "";
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expiryText = expiry && !Number.isNaN(expiry.getTime())
    ? ` · expire vers ${expiry.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  return `
    <div style="margin-top:14px;border:1px solid #f0c36a;background:#fff8e8;border-radius:14px;padding:14px 16px">
      <div style="font-size:12px;font-weight:850;color:#7b4d00;margin-bottom:6px">Code de confirmation de livraison</div>
      <div style="font-size:30px;line-height:1;font-weight:900;letter-spacing:6px;color:#17284f;margin:8px 0 10px" aria-label="Code de confirmation">${esc(value)}</div>
      <div style="font-size:12px;line-height:1.55;color:#735a2c"><strong>Important :</strong> donnez ce code au livreur uniquement après avoir reçu et vérifié votre colis${esc(expiryText)}. Ne l’envoyez pas à l’avance.</div>
    </div>`;
}

function deliveryConfirmationHtml(delivery) {
  const status = String(delivery?.status || "").toLowerCase();
  const kind = String(delivery?.delivery_kind || "");
  const taskId = String(delivery?.delivery_task_id || "");
  if (status !== "arrived_destination" || !["customer", "secure_meeting"].includes(kind) || !taskId) {
    issuedDeliveryCodes.delete(taskId);
    return "";
  }

  const confirmation = delivery?.confirmation && typeof delivery.confirmation === "object"
    ? delivery.confirmation
    : { state: "not_issued", can_issue: true };
  const state = String(confirmation.state || "not_issued");
  const challengeId = confirmation.challenge_id ? String(confirmation.challenge_id) : "";
  const local = issuedDeliveryCodes.get(taskId);
  const localMatches = !!local && !!challengeId && String(local.challengeId) === challengeId;

  if (local && !localMatches) issuedDeliveryCodes.delete(taskId);

  if (state === "active" && localMatches) {
    return codeBlock(local.code, confirmation.expires_at || local.expiresAt);
  }
  if (state === "verified") {
    issuedDeliveryCodes.delete(taskId);
    return '<div style="margin-top:12px;padding:11px 13px;border:1px solid #cce8d3;background:#edf9f0;border-radius:12px;font-size:12px;color:#167a35"><strong>Code vérifié.</strong> La confirmation de livraison a été enregistrée.</div>';
  }
  if (state === "locked") {
    issuedDeliveryCodes.delete(taskId);
    return `<div style="margin-top:12px;padding:11px 13px;border:1px solid #f6c6cc;background:#fdecee;border-radius:12px;font-size:12px;color:#7a2222"><strong>Code verrouillé.</strong> Trop d’essais incorrects ont été effectués. Attendez l’expiration du challenge ou contactez VinHT.</div>`;
  }
  if (state === "active") {
    const attempts = Number(confirmation.attempt_count) || 0;
    const maxAttempts = Number(confirmation.max_attempts) || 5;
    const cooldown = confirmation.cooldown_until
      ? new Date(confirmation.cooldown_until).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : null;
    if (attempts === 0) {
      return `<div style="margin-top:12px;padding:12px 14px;border:1px solid #f0c36a;background:#fff8e8;border-radius:12px;font-size:12px;color:#735a2c">
        <strong>Un code actif existe, mais il n’est plus visible sur cet appareil.</strong>
        <div style="margin-top:5px">Pour votre sécurité, VinHT ne peut pas relire le code précédent.</div>
        <button type="button" class="btn btn-outline-blue btn-sm" style="margin-top:9px" data-delivery-code-action="rotate" data-task="${esc(taskId)}">Générer un nouveau code</button>
      </div>`;
    }
    return `<div style="margin-top:12px;padding:12px 14px;border:1px solid #f0c36a;background:#fff8e8;border-radius:12px;font-size:12px;color:#735a2c">
      <strong>Code actif non relisible.</strong>
      <div style="margin-top:5px">${attempts}/${maxAttempts} essai(s) utilisé(s).${cooldown ? ` Nouvel essai possible après ${esc(cooldown)}.` : ""} Comme un essai a déjà été effectué, le code ne peut plus être remplacé avant son expiration.</div>
    </div>`;
  }

  // not_issued / expired / revoked : le serveur décide si l'émission est autorisée.
  if (confirmation.can_issue === false) return "";
  const label = state === "expired" ? "Générer un nouveau code" : "Générer mon code de livraison";
  return `<div style="margin-top:12px;padding:12px 14px;border:1px solid #bfd0ff;background:#eef4ff;border-radius:12px;font-size:12px;color:#38508a">
    <strong>Votre colis est arrivé.</strong>
    <div style="margin-top:5px">Après avoir vérifié votre colis, générez le code à communiquer au livreur.</div>
    <button type="button" class="btn btn-blue btn-sm" style="margin-top:9px" data-delivery-code-action="issue" data-task="${esc(taskId)}">${esc(label)}</button>
  </div>`;
}

function deliveryHtml(delivery, index, total) {
  const status = String(delivery?.status || "").toLowerCase();
  const title = total > 1
    ? `Livraison ${index + 1} · ${delivery?.merchant_shop_name || delivery?.fulfillment_shop_name || "VinHT"}`
    : "Suivi de la livraison";
  const delivered = status === "delivered";
  const isIssue = status === "issue";
  // Bloc 2 : un incident (task en "issue") n'est ni "livrée" ni "annulée" — on
  // le distingue visuellement sans jamais inventer un statut local.
  const tone = delivered ? "#edf9f0" : isIssue ? "#fdecee" : status === "arrived_destination" ? "#eef4ff" : "#f8faff";
  const border = delivered ? "#cce8d3" : isIssue ? "#f6c6cc" : status === "arrived_destination" ? "#bfd0ff" : "#dfe6f5";
  const badgeTone = delivered ? "green" : isIssue ? "red" : "blue";
  return `
    <section data-client-delivery-card style="margin-top:14px;border:1px solid ${border};background:${tone};border-radius:14px;padding:15px 16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <strong style="font-size:13px;color:#17284f">${esc(title)}</strong>
          <div style="font-size:12px;color:#667085;margin-top:5px">${esc(statusFr(status))}</div>
          ${courierLine(delivery?.courier)}
        </div>
        <span class="badge ${badgeTone}">${esc(delivered ? "Livrée" : statusFr(status))}</span>
      </div>
      ${status === "arrived_destination" ? `<div style="margin-top:11px;font-size:12px;line-height:1.55;color:#38508a"><strong>Le livreur est arrivé.</strong> Recevez et vérifiez votre colis avant de lui communiquer le code ci-dessous.</div>` : ""}
      ${isIssue ? `<div style="margin-top:11px;font-size:12px;line-height:1.55;color:#7a2222"><strong>Incident logistique — intervention requise.</strong><br>${esc(recoveryNoteFrom(delivery) || "VinHT traite cet incident. Aucune action n’est attendue de votre part pour le moment.")}</div>` : ""}
      ${deliveryConfirmationHtml(delivery)}
      ${_presenceEnabled === true ? presenceHtml(delivery) : ""}
      ${timelineHtml(delivery)}
    </section>`;
}

function renderIntoDetail(result) {
  const box = host?.querySelector("#clientOrderDetail");
  if (!box || box.hidden || box.querySelector(".loading-state")) return false;
  box.querySelector("[data-client-delivery-ux]")?.remove();
  const deliveries = Array.isArray(result?.deliveries) ? result.deliveries : [];
  const wrap = document.createElement("div");
  wrap.setAttribute("data-client-delivery-ux", "");
  if (!deliveries.length) {
    wrap.innerHTML = `<div style="margin-top:14px;padding:12px 14px;border:1px solid #e4e9f4;border-radius:12px;color:#667085;font-size:12px">Le suivi de livraison apparaîtra ici dès qu’une mission de livraison sera créée.</div>`;
  } else {
    wrap.innerHTML = deliveries.map((d, i) => deliveryHtml(d, i, deliveries.length)).join("");
  }
  box.appendChild(wrap);
  window.lucide?.createIcons?.();
  return true;
}

async function refreshDelivery(orderId, { schedule = true } = {}) {
  const seq = ++requestSeq;
  try {
    const [result] = await Promise.all([getOrderDelivery(orderId), presenceEnabled()]);
    if (seq !== requestSeq || activeOrderId !== orderId) return;
    let attempts = 0;
    const place = () => {
      if (seq !== requestSeq || activeOrderId !== orderId) return;
      if (renderIntoDetail(result)) return;
      if (++attempts < 50) setTimeout(place, 100);
    };
    place();

    if (refreshTimer) clearTimeout(refreshTimer);
    const deliveries = Array.isArray(result?.deliveries) ? result.deliveries : [];
    if (schedule && deliveries.some((d) => isLiveStatus(d?.status))) {
      refreshTimer = setTimeout(() => refreshDelivery(orderId), 10000);
    }
  } catch (error) {
    console.warn("client delivery tracking unavailable", error);
  }
}

export function initClientOrderDeliveryUx() {
  if (!host) return;
  host.addEventListener("click", async (event) => {
    const btn = event.target.closest?.("[data-delivery-code-action]");
    if (!btn || btn.disabled) return;
    const taskId = String(btn.dataset.task || "");
    if (!taskId) return;
    btn.disabled = true;
    try {
      const rotate = btn.dataset.deliveryCodeAction === "rotate";
      const result = await issueDeliveryConfirmationCode(taskId, rotate);
      const code = String(result?.code || "").trim();
      if (result?.issued === true && code) {
        issuedDeliveryCodes.set(taskId, {
          code,
          challengeId: String(result.challenge_id || ""),
          rotationNo: Number(result.rotation_no) || null,
          expiresAt: result.expires_at || null,
        });
        showToast("Code généré ✓ Ne le communiquez qu’après avoir vérifié votre colis.", "green");
      } else {
        showToast("Un code est déjà actif. VinHT ne peut pas réafficher son plaintext.", "amber");
      }
      if (activeOrderId) await refreshDelivery(activeOrderId, { schedule: false });
    } catch (err) {
      showToast(deliveryCodeErrorFr(err), "red");
      btn.disabled = false;
    }
  });
  host.addEventListener("click", async (event) => {
    const btn = event.target.closest?.("[data-presence]");
    if (!btn || btn.disabled) return;
    const state = btn.dataset.presence;
    // « Pas sûr » bascule la livraison en incident côté backend : confirmation explicite.
    if (state === "unsafe" && !window.confirm("Signaler que ce lieu ne vous paraît pas sûr ?\n\nLa livraison sera suspendue et signalée à VinHT comme incident.")) return;
    btn.disabled = true;
    try {
      await setPresence(btn.dataset.task, state);
      showToast(state === "unsafe" ? "Alerte envoyée. VinHT a été prévenu." : "Signal envoyé au livreur ✓", state === "unsafe" ? "amber" : "green");
      if (activeOrderId) refreshDelivery(activeOrderId);
    } catch (err) {
      showToast(presenceErrorFr(err), "red");
      btn.disabled = false;
    }
  });
  host.addEventListener("click", (event) => {
    const btn = event.target.closest?.("[data-order-detail]");
    if (!btn?.dataset.orderDetail) return;
    activeOrderId = btn.dataset.orderDetail;
    if (refreshTimer) clearTimeout(refreshTimer);
    setTimeout(() => refreshDelivery(activeOrderId), 80);
  });
}
