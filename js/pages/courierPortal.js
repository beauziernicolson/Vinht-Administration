import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { showToast } from "../ui/toast.js";
import {
  getMyCourierPortalContext, listMyDeliveryTasks, listAvailableDeliveryMissions, getMyDeliveryTask, getMyDeliveryCustodyContext,
  listMyDeliveryCustodyTransfers, courierConfirmCustodyTransferOut, courierConfirmCustodyTransferIn, courierStartDeliveryReturn,
  submitMyCourierProfile, setMyCourierAvailability, replaceMyCourierServiceAreas, updateMyCourierLocation,
  courierErrorMessageFr, VEHICLE_TYPE_FR, OPERATIONAL_STATUS_FR, AVAILABILITY_STATUS_FR,
  WAITING_FOR_FR, ALLOWED_ACTION_LABEL_FR, ACTION_DISPATCH,
  COMPENSATION_STATUS_FR, PROOF_TYPE_FR, PRESENCE_STATE_FR, DELIVERY_KIND_FR,
} from "../services/courierPortal.js";
import { DELIVERY_STATUS_FR, DELIVERY_STATUS_TONE } from "../services/deliveryContract.js";
import { attachGeoHints } from "../services/geoHints.js";
import { addressLabel, isManagedPointInput } from "../services/addressContract.js";
import { deliveryIssueNoticeFr } from "../services/deliveryTimeoutsRules.js";

// Feature #34 — Courier Portal. Le backend (get_my_courier_portal_context_v1 /
// list_my_delivery_tasks_v2 / list_available_delivery_missions_v2 /
// get_my_delivery_task_v1) reste l'unique source de vérité : allowed_actions
// décide seul quels boutons existent, waiting_for est affiché tel quel sans
// jamais être dérivé de status côté frontend, et aucune capability n'est
// recalculée depuis un statut.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const loading = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;
const errorBox = (t) => `<div class="error-state">${esc(t)}</div>`;
const empty = (a, b) => `<div class="empty-state"><div class="empty-icon"><i data-lucide="truck"></i></div><h3>${esc(a)}</h3><p>${esc(b)}</p></div>`;
const badge = (s, cls) => `<span class="badge ${cls || ""}">${esc(s ?? "—")}</span>`;
// Libellé français natif d'un statut de livraison (présentation seulement).
const statusBadge = (s) => badge(DELIVERY_STATUS_FR[s] || s, DELIVERY_STATUS_TONE[s] || "");
const TASK_PAGE_SIZE = 15;
const MISSION_PAGE_SIZE = 15;
const MAX_SERVICE_AREAS = 20;

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function areaLine(area) {
  if (!area) return "—";
  const parts = [area.name, area.commune, area.department].filter((x) => x != null && String(x).trim() !== "");
  return parts.length ? parts.join(" · ") : "—";
}

// --- Gate / shell ------------------------------------------------------------

function gate(html) {
  const g = document.querySelector("[data-courier-gate]"), c = document.querySelector("[data-courier-content]");
  if (g) { g.hidden = false; g.innerHTML = html; }
  if (c) c.hidden = true;
  refreshIcons();
}
function showContent() {
  const g = document.querySelector("[data-courier-gate]"), c = document.querySelector("[data-courier-content]");
  if (g) g.hidden = true;
  if (c) c.hidden = false;
}

function authGateHtml() {
  return `<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour ouvrir votre espace livreur.</p><button class="btn btn-blue" type="button" id="cpLoginBtn">Se connecter</button></div>`;
}

// --- État module -------------------------------------------------------------
let _cpCtx = null;
let _cpActiveTab = "active"; // active | history | missions | profile
let _cpViewSeq = 0; // bump à chaque changement d'onglet / retour depuis un détail

let _cpTasks = { rows: [], offset: 0, hasMore: false, seq: 0 };
let _cpMissions = { rows: [], offset: 0, hasMore: false, seq: 0, state: "ready", enabled: true, reason: null };

let _cpDetailSeq = 0;
let _cpDetailTaskId = null;

function invalidateDetail() { _cpDetailSeq += 1; _cpDetailTaskId = null; }
function invalidateView() { _cpViewSeq += 1; invalidateDetail(); }

// --- En-tête / compteurs -----------------------------------------------------

function availabilityHelp(ctx) {
  const p = ctx?.profile || {};
  const runtime = ctx?.runtime || {};
  const caps = ctx?.capabilities || {};

  if (p.operational_status === "pending_review") {
    return "Votre candidature est en cours d’examen par l’administration VinHT. Vous pourrez passer en ligne dès son approbation.";
  }
  if (p.operational_status === "paused") {
    return "Votre compte est en pause. Contactez l’administration VinHT pour être réactivé.";
  }
  if (p.operational_status !== "active") {
    return "Votre compte livreur doit être actif avant de pouvoir passer en ligne.";
  }
  if (p.availability_status === "busy") {
    return "Vous êtes occupé automatiquement parce que votre capacité de livraisons actives est atteinte.";
  }
  if (ctx?.readiness?.service_area_ready === false) {
    return "Ajoutez au moins une zone de service active dans votre profil avant de passer en ligne.";
  }
  if (p.availability_status === "available") {
    return "Vous êtes en ligne et disponible pour recevoir ou prendre des missions.";
  }
  if (!runtime.logistics_enabled) {
    return "La logistique VinHT est temporairement désactivée par l’administration.";
  }
  if (!runtime.operations_enabled) {
    return "Les opérations livreur sont temporairement désactivées par l’administration.";
  }
  if (!caps.can_go_available) {
    return "La mise en ligne n’est pas disponible pour le moment.";
  }
  return "Vous êtes hors ligne. Passez en ligne pour recevoir ou prendre des missions.";
}

function renderHeader(ctx) {
  const host = document.querySelector("#cpHeaderHost");
  if (!host) return;
  const p = ctx.profile || {};
  const caps = ctx.capabilities || {};
  const counts = ctx.counts || {};
  const statusCls = p.operational_status === "active" ? "green" : p.operational_status === "rejected" || p.operational_status === "suspended" ? "red" : "amber";
  const availCls = p.availability_status === "available" ? "green" : p.availability_status === "busy" ? "amber" : "";
  const online = p.availability_status === "available";
  const busy = p.availability_status === "busy";
  const canGoOnline = caps.can_go_available === true && !online && !busy;
  const canGoOffline = caps.can_set_offline === true && p.availability_status !== "offline";

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar" style="align-items:flex-start;gap:14px">
        <div style="min-width:0;flex:1">
          <h3 style="margin:0">${esc(p.full_name || "Livreur VinHT")}</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${badge(OPERATIONAL_STATUS_FR[p.operational_status] || p.operational_status, statusCls)}
            ${badge(AVAILABILITY_STATUS_FR[p.availability_status] || p.availability_status, availCls)}
          </div>
          <p id="cpAvailabilityHelp" class="muted" style="font-size:11px;margin:7px 0 0;max-width:430px">${esc(availabilityHelp(ctx))}</p>
        </div>
        <div id="cpAvailabilityActions" style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          ${online
            ? `<button class="btn btn-ghost btn-sm" type="button" id="cpGoOffline" aria-pressed="true"><i data-lucide="power"></i> Se mettre hors ligne</button>`
            : canGoOnline
              ? `<button class="btn btn-blue btn-sm" type="button" id="cpGoAvailable" aria-pressed="false"><i data-lucide="radio"></i> Passer en ligne</button>`
              : busy
                ? `<button class="btn btn-ghost btn-sm" type="button" disabled><i data-lucide="clock-3"></i> Occupé</button>`
                : `<button class="btn btn-outline-blue btn-sm" type="button" disabled title="${esc(availabilityHelp(ctx))}"><i data-lucide="radio"></i> Passer en ligne</button>`}
          ${canGoOffline && !online ? `<button class="btn btn-ghost btn-sm" type="button" id="cpGoOffline"><i data-lucide="power"></i> ${busy ? "Se mettre hors ligne" : "Rester hors ligne"}</button>` : ""}
        </div>
      </div>
      <div class="cp-count-grid">
        <div class="cp-count-card"><div class="value">${counts.active ?? "—"}${p.vehicle?.max_active_deliveries != null ? `<span class="muted" style="font-size:12px"> / ${esc(p.vehicle.max_active_deliveries)}</span>` : ""}</div><div class="label">Actives (capacité)</div></div>
        <div class="cp-count-card"><div class="value">${counts.waiting_response ?? "—"}</div><div class="label">En attente</div></div>
        <div class="cp-count-card"><div class="value">${counts.available_missions ?? "—"}</div><div class="label">Missions dispo.</div></div>
        <div class="cp-count-card"><div class="value">${counts.history ?? "—"}</div><div class="label">Historique</div></div>
      </div>
      ${p.operational_status === "pending_review" ? `<div class="cp-status-banner amber"><i data-lucide="clock-3"></i> Candidature en cours d’examen : l’administration VinHT vérifie votre dossier.</div>` : ""}
      ${p.operational_status === "paused" ? `<div class="cp-status-banner amber"><i data-lucide="pause"></i> Compte en pause : aucune nouvelle mission ne peut vous être proposée.</div>` : ""}
      ${p.operational_status === "rejected" && p.rejected_reason ? `<div class="cp-status-banner red"><i data-lucide="circle-x"></i> ${esc(p.rejected_reason)}</div>` : ""}
      ${p.operational_status === "suspended" && p.suspended_reason ? `<div class="cp-status-banner red"><i data-lucide="triangle-alert"></i> ${esc(p.suspended_reason)}</div>` : ""}
    </div>`;

  document.querySelector("#cpGoAvailable")?.addEventListener("click", (e) => setAvailability("available", e.currentTarget));
  document.querySelector("#cpGoOffline")?.addEventListener("click", (e) => setAvailability("offline", e.currentTarget));
  refreshIcons();
}

async function setAvailability(status, btn) {
  if (btn?.dataset.submitting === "1") return;
  if (btn) { btn.dataset.submitting = "1"; btn.disabled = true; }
  try {
    await setMyCourierAvailability(status);
  } catch (err) {
    showToast(courierErrorMessageFr(err?.message, "Impossible de changer votre disponibilité."), "red");
    if (btn) { btn.dataset.submitting = ""; btn.disabled = false; }
    return;
  }
  showToast(status === "available" ? "Vous êtes maintenant en ligne ✓" : "Vous êtes hors ligne ✓");
  try {
    await refreshContext();
  } catch {
    // La disponibilité ne repeint que l'en-tête (jamais l'onglet courant) :
    // aucun risque de voler la navigation, on signale juste le refresh raté.
    showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red");
  }
  if (btn) { btn.dataset.submitting = ""; btn.disabled = false; }
}

// Ne swallow plus jamais l'échec : lève si le contexte ne peut pas être
// rechargé, pour que chaque appelant décide explicitement comment le
// signaler (mutation réussie + refresh raté != mutation échouée).
async function refreshContext() {
  _cpCtx = await getMyCourierPortalContext();
  renderHeader(_cpCtx);
  return _cpCtx;
}

// --- Tabs ---------------------------------------------------------------------

function renderTabs() {
  const host = document.querySelector("#cpTabsHost");
  if (!host) return;
  const tabs = [
    ["active", "Mes livraisons"],
    ["missions", "Missions disponibles"],
    ["transfers", "Transferts de colis"],
    ["history", "Historique"],
    ["profile", "Profil"],
  ];
  host.innerHTML = tabs.map(([k, label]) => `<button type="button" class="cp-tab${_cpActiveTab === k ? " active" : ""}" data-cp-tab="${k}">${esc(label)}</button>`).join("");
  host.querySelectorAll("[data-cp-tab]").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.cpTab)));
}

function forceSwitchTab(tab) {
  _cpActiveTab = tab;
  invalidateView();
  renderTabs();
  renderTabBody();
}

function switchTab(tab) {
  if (_cpActiveTab === tab) return;
  forceSwitchTab(tab);
}

function renderTabBody() {
  if (_cpActiveTab === "active") { _cpTasks = { rows: [], offset: 0, hasMore: false, seq: 0 }; renderTaskListShell("active"); runTasksSearch(true); }
  else if (_cpActiveTab === "history") { _cpTasks = { rows: [], offset: 0, hasMore: false, seq: 0 }; renderTaskListShell("history"); runTasksSearch(true); }
  else if (_cpActiveTab === "missions") { _cpMissions = { rows: [], offset: 0, hasMore: false, seq: 0, state: "ready", enabled: true, reason: null }; renderMissionsShell(); runMissionsSearch(true); }
  else if (_cpActiveTab === "transfers") { renderTransfersTab(); }
  else if (_cpActiveTab === "profile") { renderProfileTab(); }
}

// --- Mes livraisons / Historique ----------------------------------------------

function taskCardHtml(t) {
  const src = areaLine(t.source_area);
  const dst = areaLine(t.destination_area);
  const waiting = t.waiting_for ? WAITING_FOR_FR[t.waiting_for] || t.waiting_for : null;
  const comp = t.compensation;
  return `<div class="cp-mission-card" data-task-id="${esc(t.delivery_task_id)}">
    <div class="toolbar" style="margin:0"><strong>${esc(t.merchant_shop_name || t.fulfillment_shop_name || "Livraison VinHT")}</strong>${statusBadge(t.status)}</div>
    <div class="cp-route"><span class="cp-route-dot source"></span><span>${esc(src)}</span></div>
    <div class="cp-route"><span class="cp-route-dot dest"></span><span>${esc(dst)}</span></div>
    ${waiting ? `<div class="cp-status-banner amber" style="margin:0;font-size:12px"><i data-lucide="clock"></i> ${esc(waiting)}</div>` : ""}
    ${comp && comp.enabled && comp.amount_htg != null ? `<div style="font-size:12px;color:var(--muted,#6f7891)">Compensation : <strong>${money(comp.amount_htg)}</strong>${comp.status ? ` · ${esc(COMPENSATION_STATUS_FR[comp.status] || comp.status)}` : ""}</div>` : ""}
  </div>`;
}

function renderTaskListShell(kind) {
  const host = document.querySelector("#cpBodyHost");
  if (!host) return;
  host.innerHTML = `<div id="cpTaskListHost">${loading(kind === "active" ? "Chargement de vos livraisons…" : "Chargement de l'historique…")}</div><div id="cpTaskLoadMoreWrap" style="margin-top:10px;text-align:center"></div>`;
}

function renderTaskLoadMore() {
  const wrap = document.querySelector("#cpTaskLoadMoreWrap");
  if (!wrap) return;
  wrap.innerHTML = _cpTasks.hasMore ? `<button class="btn btn-ghost btn-sm" id="cpTaskLoadMore" type="button">Charger plus</button>` : "";
  wrap.querySelector("#cpTaskLoadMore")?.addEventListener("click", () => runTasksSearch(false));
}

async function runTasksSearch(reset) {
  const viewSeq = _cpViewSeq;
  const host = document.querySelector("#cpTaskListHost");
  if (!host) return;
  const localSeq = ++_cpTasks.seq;
  const offset = reset ? 0 : _cpTasks.offset;
  if (reset) { _cpTasks.rows = []; _cpTasks.offset = 0; host.innerHTML = loading(); }
  else { const b = document.querySelector("#cpTaskLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listMyDeliveryTasks({ status: _cpActiveTab, limit: TASK_PAGE_SIZE, offset });
    if (viewSeq !== _cpViewSeq || localSeq !== _cpTasks.seq) return;
    const merged = reset ? result.rows : _cpTasks.rows.concat(result.rows);
    const seen = new Set();
    _cpTasks.rows = merged.filter((r) => { const id = String(r?.delivery_task_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _cpTasks.hasMore = result.hasMore;
    _cpTasks.offset = offset + result.rows.length;
    if (!_cpTasks.rows.length) {
      host.innerHTML = empty(_cpActiveTab === "active" ? "Aucune livraison en cours" : "Aucun historique", _cpActiveTab === "active" ? "Vos livraisons assignées apparaîtront ici." : "Vos livraisons terminées apparaîtront ici.");
      renderTaskLoadMore(); refreshIcons(); return;
    }
    host.innerHTML = _cpTasks.rows.map(taskCardHtml).join("");
    host.querySelectorAll("[data-task-id]").forEach((card) => card.addEventListener("click", () => openTaskDetail(card.dataset.taskId)));
    refreshIcons();
    renderTaskLoadMore();
  } catch (err) {
    if (viewSeq !== _cpViewSeq || localSeq !== _cpTasks.seq) return;
    host.innerHTML = errorBox(courierErrorMessageFr(err?.message, "Impossible de charger vos livraisons."));
    renderTaskLoadMore();
  }
}

// --- Missions disponibles ------------------------------------------------------

function missionCardHtml(m) {
  const pickup = areaLine(m.pickup_area);
  const dest = areaLine(m.destination_area);
  return `<div class="cp-mission-card" data-mission-id="${esc(m.delivery_task_id)}">
    <div class="toolbar" style="margin:0"><strong>${esc(m.merchant_shop_name || "Mission VinHT")}</strong>${m.compensation_htg != null ? `<strong>${money(m.compensation_htg)}</strong>` : ""}</div>
    ${m.delivery_kind || m.published_at ? `<div style="font-size:11px;color:var(--muted,#6f7891)">${m.delivery_kind ? esc(DELIVERY_KIND_FR[m.delivery_kind] || m.delivery_kind) : ""}${m.delivery_kind && m.published_at ? " · " : ""}${m.published_at ? `publiée ${esc(fmtDate(m.published_at) || "")}` : ""}</div>` : ""}
    <div class="cp-route"><span class="cp-route-dot source"></span><span>Retrait : ${esc(pickup)}</span></div>
    <div class="cp-route"><span class="cp-route-dot dest"></span><span>Destination : ${esc(dest)}</span></div>
    ${Array.isArray(m.allowed_actions) && m.allowed_actions.includes("claim") ? `<div class="cp-actions"><button class="btn btn-blue btn-sm" type="button" data-claim="${esc(m.delivery_task_id)}">Prendre cette mission</button></div>` : ""}
  </div>`;
}

function renderMissionsShell() {
  const host = document.querySelector("#cpBodyHost");
  if (!host) return;
  host.innerHTML = `<div id="cpMissionListHost">${loading("Chargement des missions disponibles…")}</div><div id="cpMissionLoadMoreWrap" style="margin-top:10px;text-align:center"></div>`;
}

function renderMissionLoadMore() {
  const wrap = document.querySelector("#cpMissionLoadMoreWrap");
  if (!wrap) return;
  wrap.innerHTML = _cpMissions.hasMore ? `<button class="btn btn-ghost btn-sm" id="cpMissionLoadMore" type="button">Charger plus</button>` : "";
  wrap.querySelector("#cpMissionLoadMore")?.addEventListener("click", () => runMissionsSearch(false));
}

const MISSION_UNAVAILABLE_REASON_FR = {
  courier_marketplace_unavailable: "Les missions du marketplace ne sont pas activées pour le moment.",
  courier_not_operationally_active: "Votre profil livreur n'est pas actif — vous ne pouvez pas encore parcourir les missions.",
  courier_not_available: "Passez en ligne pour voir les missions disponibles.",
  courier_capacity_reached: "Vous avez atteint votre nombre maximum de livraisons actives — terminez-en une pour en prendre une nouvelle.",
  courier_service_area_required: "Ajoutez au moins une zone de service active dans l’onglet Profil avant de consulter les missions.",
};

async function runMissionsSearch(reset) {
  const viewSeq = _cpViewSeq;
  const host = document.querySelector("#cpMissionListHost");
  if (!host) return;
  const localSeq = ++_cpMissions.seq;
  const offset = reset ? 0 : _cpMissions.offset;
  if (reset) { _cpMissions.rows = []; _cpMissions.offset = 0; host.innerHTML = loading(); }
  else { const b = document.querySelector("#cpMissionLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listAvailableDeliveryMissions({ limit: MISSION_PAGE_SIZE, offset });
    if (viewSeq !== _cpViewSeq || localSeq !== _cpMissions.seq) return;
    _cpMissions.state = result.state;
    _cpMissions.enabled = result.enabled;
    _cpMissions.reason = result.reason;
    if (!result.enabled || (result.reason && !result.rows.length)) {
      host.innerHTML = empty("Missions indisponibles", MISSION_UNAVAILABLE_REASON_FR[result.reason] || result.reason || "Les missions disponibles ne sont pas accessibles pour le moment.");
      renderMissionLoadMore(); refreshIcons(); return;
    }
    const merged = reset ? result.rows : _cpMissions.rows.concat(result.rows);
    const seen = new Set();
    _cpMissions.rows = merged.filter((r) => { const id = String(r?.delivery_task_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _cpMissions.hasMore = result.hasMore;
    _cpMissions.offset = offset + result.rows.length;
    if (!_cpMissions.rows.length) {
      host.innerHTML = empty("Aucune mission disponible", "Revenez plus tard — de nouvelles missions apparaîtront ici dès qu'elles seront publiées.");
      renderMissionLoadMore(); refreshIcons(); return;
    }
    host.innerHTML = _cpMissions.rows.map(missionCardHtml).join("");
    host.querySelectorAll("[data-claim]").forEach((btn) => btn.addEventListener("click", (e) => { e.stopPropagation(); claimMission(btn.dataset.claim, btn); }));
    refreshIcons();
    renderMissionLoadMore();
  } catch (err) {
    if (viewSeq !== _cpViewSeq || localSeq !== _cpMissions.seq) return;
    host.innerHTML = errorBox(courierErrorMessageFr(err?.message, "Impossible de charger les missions disponibles."));
    renderMissionLoadMore();
  }
}

// Correction ChatGPT — un claim en vol ne doit jamais repeindre un écran que
// l'utilisateur a quitté pendant la requête (ex: Missions -> claim -> Profil
// avant la réponse). On capture la vue au moment du clic et on ne force
// aucune navigation si elle a changé entre-temps, qu'il y ait succès ou échec.
async function claimMission(deliveryTaskId, btn) {
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true; btn.textContent = "Prise en cours…";
  const viewSeq = _cpViewSeq;
  const wasOnMissions = _cpActiveTab === "missions";
  let claimError = null;
  try {
    await ACTION_DISPATCH.claim(deliveryTaskId);
  } catch (err) {
    claimError = err;
  }
  const stillOnMissionsView = wasOnMissions && _cpViewSeq === viewSeq && _cpActiveTab === "missions";

  if (claimError) {
    if (!stillOnMissionsView) return; // vue quittée : rien à repeindre, l'échec n'a rien changé côté serveur
    showToast(courierErrorMessageFr(claimError?.message, "Impossible de prendre cette mission."), "red");
    await runMissionsSearch(true); // reste dans Missions, liste rafraîchie
    return;
  }

  // Succès : jamais optimiste — on ne suppose jamais que la mission existe
  // encore dans le marketplace, mais on ne force la navigation vers Active
  // que si l'utilisateur est toujours sur la vue Missions d'origine.
  if (!stillOnMissionsView) {
    // Invalide simplement les caches obsolètes pour que le prochain passage
    // sur ces onglets recharge des données fraîches, sans voler l'écran.
    _cpMissions.rows = [];
    _cpTasks.rows = [];
    return;
  }
  showToast("Mission prise ✓");
  let refreshFailed = false;
  try { await refreshContext(); } catch { refreshFailed = true; }
  // Revérifie après l'await du refresh : l'utilisateur a pu naviguer entre-temps.
  if (_cpViewSeq !== viewSeq || _cpActiveTab !== "missions") return;
  _cpMissions.rows = [];
  forceSwitchTab("active");
  if (refreshFailed) showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red");
}

// --- Détail d'une tâche ---------------------------------------------------------

function timelineHtml(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) return `<p class="muted" style="font-size:12px">Aucun événement.</p>`;
  return `<ul class="cp-timeline">${timeline.map((e) => `<li><strong>${esc(DELIVERY_STATUS_FR[e.to_status] || e.to_status || e.event_type)}</strong>${e.note ? ` — ${esc(e.note)}` : ""}<br><small class="muted">${esc(fmtDate(e.created_at) || "")}</small></li>`).join("")}</ul>`;
}

function proofsHtml(proofs) {
  if (!Array.isArray(proofs) || !proofs.length) return "";
  return `<div class="portal-card"><h3>Preuves</h3>${proofs.map((p) => `<div class="settings-section"><div><strong>${esc(PROOF_TYPE_FR[p.proof_type] || p.proof_type)}</strong>${p.created_at ? `<p>${esc(fmtDate(p.created_at))}</p>` : ""}</div>${badge(p.verified ? "Vérifiée" : "Non vérifiée", p.verified ? "green" : "")}</div>`).join("")}</div>`;
}

// N'affiche que les champs réellement présents sur l'objet backend, jamais
// JSON.stringify brut, jamais un champ fabriqué. Le résumé d'adresse
// (dédup, mise en forme) vient d'addressContract — logique de forme
// partagée avec le checkout, le carnet d'adresses et l'Admin.
function locationLine(loc, label) {
  if (!loc || typeof loc !== "object") return "";
  const nonEmpty = (v) => v != null && String(v).trim() !== "";
  const placeName = [loc.name, loc.partner_name].find(nonEmpty);
  const summary = addressLabel(loc, { fallback: "" });
  // addressLabel inclut déjà le nom d'un Point VinHT géré. Pour une adresse
  // standard, on conserve le nom métier séparé (boutique/partenaire) devant
  // le résumé sans le dupliquer.
  const line = isManagedPointInput(loc)
    ? summary
    : [placeName, summary].filter(nonEmpty).join(" · ");
  if (!line && !nonEmpty(loc.instructions)) return "";
  return `<div class="settings-section"><div><strong>${esc(label)}</strong>${line ? `<p>${esc(line)}</p>` : ""}${nonEmpty(loc.instructions) ? `<p class="muted" style="font-size:11px">${esc(loc.instructions)}</p>` : ""}</div></div>`;
}

function customerPresenceLine(presence) {
  if (!presence || typeof presence !== "object" || presence.signals_enabled !== true || !presence.state) return "";
  const updated = fmtDate(presence.updated_at);
  return `<div class="settings-section"><div><strong>Présence client</strong><p>${esc(PRESENCE_STATE_FR[presence.state] || presence.state)}${updated ? ` · ${esc(updated)}` : ""}</p></div></div>`;
}

async function openTaskDetail(deliveryTaskId) {
  const host = document.querySelector("#cpBodyHost");
  if (!host) return;
  const viewSeq = _cpViewSeq;
  const seq = ++_cpDetailSeq;
  _cpDetailTaskId = deliveryTaskId;
  const stale = () => viewSeq !== _cpViewSeq || seq !== _cpDetailSeq || _cpDetailTaskId !== deliveryTaskId;
  host.innerHTML = loading("Chargement de la livraison…");
  let result;
  try {
    const [taskResult, custody] = await Promise.all([
      getMyDeliveryTask(deliveryTaskId),
      getMyDeliveryCustodyContext(deliveryTaskId).catch(() => ({ state: "missing" })),
    ]);
    result = { ...taskResult, custody };
  } catch (err) {
    if (stale()) return;
    host.innerHTML = `<div class="portal-card">${errorBox(courierErrorMessageFr(err?.message, "Impossible de charger cette livraison."))}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="cpDetailRetry">Réessayer</button><button class="btn btn-ghost btn-sm" type="button" id="cpDetailBack">Retour</button></div></div>`;
    document.querySelector("#cpDetailRetry")?.addEventListener("click", () => openTaskDetail(deliveryTaskId));
    document.querySelector("#cpDetailBack")?.addEventListener("click", closeTaskDetail);
    return;
  }
  if (stale()) return;
  renderTaskDetail(result, { stale });
}

function closeTaskDetail() {
  invalidateDetail();
  renderTabBody();
}

function renderTaskDetail(result, { stale }) {
  const host = document.querySelector("#cpBodyHost");
  if (!host || stale()) return;
  const t = result.task || {};
  const waiting = t.waiting_for ? WAITING_FOR_FR[t.waiting_for] || t.waiting_for : null;
  const comp = t.compensation;
  const actions = Array.isArray(t.allowed_actions) ? t.allowed_actions : [];
  const ts = t.timestamps || {};

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">${esc(t.merchant_shop_name || t.fulfillment_shop_name || "Livraison")}</h3><button class="btn btn-ghost btn-sm" type="button" id="cpDetailBack2">Retour</button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${statusBadge(t.status)}</div>
      ${waiting && t.status !== "cancelled" ? `<div class="cp-status-banner ${t.waiting_for === "admin_resolution" ? "red" : "amber"}"><i data-lucide="clock"></i> ${esc(waiting)}</div>` : ""}
      ${t.status === "cancelled" ? `<div class="cp-status-banner red"><i data-lucide="circle-x"></i> Cette mission a été annulée.</div>` : ""}
      ${t.handoff?.merchant_confirmation_required && t.status === "handoff_pending_merchant" ? `<div class="cp-status-banner amber"><i data-lucide="info"></i> Vous avez confirmé la récupération. En attente de la confirmation du marchand.</div>` : ""}
      ${t.status === "issue" ? `<div class="cp-status-banner red"><i data-lucide="triangle-alert"></i> ${esc(deliveryIssueNoticeFr())}</div>` : ""}
      ${t.status === "issue" && t.issue_note ? `<div class="cp-status-banner red"><i data-lucide="info"></i> ${esc(t.issue_note)}</div>` : ""}
      ${locationLine(t.source_location, "Point de retrait")}
      ${locationLine(t.destination_location, "Destination")}
      ${customerPresenceLine(t.customer_presence)}
      ${comp && comp.enabled && comp.amount_htg != null ? `<div class="settings-section"><div><strong>Compensation</strong>${comp.paid_at ? `<p>Payée le ${esc(fmtDate(comp.paid_at))}</p>` : ""}</div><strong>${money(comp.amount_htg)}</strong>${comp.status ? badge(COMPENSATION_STATUS_FR[comp.status] || comp.status) : ""}</div>` : ""}
      <div id="cpDetailActionsHost" class="cp-actions"></div>
      <div id="cpDetailFormHost"></div>
      ${result.custody?.state === "ready" ? `
        <div class="settings-section" style="margin-top:10px;flex-direction:column;align-items:stretch"><div><strong>Custody</strong><p>Détenteur : ${esc(result.custody.holder?.type || "—")} · recovery : ${esc(result.custody.recovery?.status || "none")}${result.custody.recovery?.destination_type ? ` → ${esc(result.custody.recovery.destination_type)}` : ""}</p></div>
          ${result.custody.recovery?.status === "required" && result.custody.holder?.type === "courier" ? `<div style="min-width:220px"><label for="cpReturnNote" style="font-size:12px">Note de retour (facultatif)</label><textarea class="input" id="cpReturnNote" rows="2" placeholder="État du colis, précision utile…"></textarea><button class="btn btn-outline-blue btn-sm" type="button" id="cpStartReturn" style="margin-top:6px">Démarrer le retour vers ${esc(result.custody.recovery?.destination_type === "hub" ? "le hub VinHT" : "le marchand")}</button></div>` : ""}
        </div>` : ""}
    </div>
    <div class="portal-card"><h3>Historique</h3>${timelineHtml(result.timeline)}</div>
    ${proofsHtml(result.proofs)}
  `;
  refreshIcons();
  document.querySelector("#cpDetailBack2")?.addEventListener("click", closeTaskDetail);
  document.querySelector("#cpStartReturn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.submitting === "1") return;
    const note = document.querySelector("#cpReturnNote")?.value.trim() || null;
    btn.dataset.submitting = "1"; btn.disabled = true;
    try {
      await courierStartDeliveryReturn(t.delivery_task_id, note);
      showToast("Retour démarré ✓");
      await openTaskDetail(t.delivery_task_id);
    } catch (err) {
      btn.dataset.submitting = ""; btn.disabled = false;
      showToast(courierErrorMessageFr(err?.message, "Impossible de démarrer le retour."), "red");
    }
  });
  renderDetailActions(t.delivery_task_id, actions, { stale, status: t.status, waitingFor: t.waiting_for });
}

function renderDetailActions(taskId, actions, { stale, status = null, waitingFor = null } = {}) {
  const actHost = document.querySelector("#cpDetailActionsHost");
  const formHost = document.querySelector("#cpDetailFormHost");
  if (!actHost || !formHost) return;
  formHost.innerHTML = "";
  // Une action renvoyée par le backend mais inconnue de cette version du
  // frontend n'est jamais rendue comme bouton mort (ACTION_DISPATCH[action]
  // serait undefined) : on l'ignore et on invite à actualiser.
  const known = actions.filter((a) => typeof ACTION_DISPATCH[a] === "function");
  const unknownCount = actions.length - known.length;
  actions = known;
  const simple = actions.filter((a) => !["reject", "report_issue", "confirm_customer_delivery"].includes(a));
  const complex = actions.filter((a) => ["reject", "report_issue", "confirm_customer_delivery"].includes(a));

  actHost.innerHTML = simple.map((a) => `<button class="btn btn-blue btn-sm" type="button" data-action="${esc(a)}">${esc(ALLOWED_ACTION_LABEL_FR[a] || a)}</button>`).join("")
    + complex.map((a) => `<button class="btn ${a === "reject" || a === "report_issue" ? "btn-outline-red" : "btn-outline-blue"} btn-sm" type="button" data-form-action="${esc(a)}">${esc(ALLOWED_ACTION_LABEL_FR[a] || a)}</button>`).join("");
  if (unknownCount > 0) actHost.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:12px;width:100%">Une action supplémentaire est proposée par VinHT mais n'est pas disponible dans cette version de l'application. Actualisez la page.</p>`);
  // Arrivé à destination mais aucune action de livraison proposée : le backend
  // n'autorise pas (encore) la confirmation — on l'explique au lieu de laisser un écran vide.
  if (status === "arrived_destination" && !actions.includes("confirm_customer_delivery") && waitingFor !== "hub_receipt") {
    actHost.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:12px;width:100%">Aucune confirmation de livraison n'est disponible pour le moment. Si le client doit vous fournir un code, il apparaîtra ici dès que VinHT l'autorise ; sinon signalez un problème.</p>`);
  }
  refreshIcons();

  actHost.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => runSimpleAction(taskId, btn.dataset.action, btn, { stale })));
  actHost.querySelectorAll("[data-form-action]").forEach((btn) => btn.addEventListener("click", () => showActionForm(taskId, btn.dataset.formAction, { stale })));
}

async function runSimpleAction(taskId, action, btn, { stale }) {
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "…";
  try {
    await ACTION_DISPATCH[action](taskId);
  } catch (err) {
    btn.dataset.submitting = ""; btn.disabled = false; btn.textContent = originalText;
    if (stale()) return;
    showToast(courierErrorMessageFr(err?.message, "Action impossible."), "red");
    return;
  }
  await afterMutation(taskId, { stale, successToast: "Action enregistrée ✓" });
}

function showActionForm(taskId, action, { stale }) {
  const formHost = document.querySelector("#cpDetailFormHost");
  if (!formHost) return;
  if (action === "reject") {
    formHost.innerHTML = `<div class="settings-section" style="flex-direction:column;align-items:stretch;gap:8px">
      <label style="font-size:12px">Motif du refus (facultatif)</label>
      <textarea class="input" id="cpRejectReason" rows="2"></textarea>
      <div id="cpFormMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-outline-red btn-sm" type="button" id="cpFormSubmit">Confirmer le refus</button><button class="btn btn-ghost btn-sm" type="button" id="cpFormCancel">Annuler</button></div>
    </div>`;
  } else if (action === "report_issue") {
    formHost.innerHTML = `<div class="settings-section" style="flex-direction:column;align-items:stretch;gap:8px">
      <label style="font-size:12px">Décrivez le problème *</label>
      <textarea class="input" id="cpIssueNote" rows="3" required></textarea>
      <div id="cpFormMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-outline-red btn-sm" type="button" id="cpFormSubmit">Envoyer le signalement</button><button class="btn btn-ghost btn-sm" type="button" id="cpFormCancel">Annuler</button></div>
    </div>`;
  } else if (action === "confirm_customer_delivery") {
    formHost.innerHTML = `<div class="settings-section" style="flex-direction:column;align-items:stretch;gap:8px">
      <label style="font-size:12px">Code de confirmation client *</label>
      <input class="input" id="cpConfirmCode" type="text" inputmode="numeric" autocomplete="off">
      <label style="font-size:12px">Note (facultatif)</label>
      <textarea class="input" id="cpConfirmNote" rows="2"></textarea>
      <div id="cpFormMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-blue btn-sm" type="button" id="cpFormSubmit">Confirmer la livraison</button><button class="btn btn-ghost btn-sm" type="button" id="cpFormCancel">Annuler</button></div>
    </div>`;
  }
  refreshIcons();
  document.querySelector("#cpFormCancel")?.addEventListener("click", () => { formHost.innerHTML = ""; });
  document.querySelector("#cpFormSubmit")?.addEventListener("click", (e) => submitActionForm(taskId, action, e.currentTarget, { stale }));
}

async function submitActionForm(taskId, action, btn, { stale }) {
  const msgBox = document.querySelector("#cpFormMsg");
  const showMsg = (t) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; } };
  let payload = {};
  if (action === "reject") {
    payload = { reason: document.querySelector("#cpRejectReason")?.value.trim() || null };
  } else if (action === "report_issue") {
    const note = document.querySelector("#cpIssueNote")?.value.trim() || "";
    if (!note) { showMsg("Décrivez le problème avant d'envoyer le signalement."); return; }
    payload = { note };
  } else if (action === "confirm_customer_delivery") {
    const codeInput = document.querySelector("#cpConfirmCode");
    const code = codeInput?.value.trim() || "";
    const note = document.querySelector("#cpConfirmNote")?.value.trim() || null;
    if (!code) { showMsg("Le code de confirmation client est obligatoire."); return; }
    payload = { code, note };
    // Le code ne doit jamais être conservé où que ce soit : on vide le champ
    // immédiatement, avant même la réponse réseau.
    if (codeInput) codeInput.value = "";
  }
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  try {
    await ACTION_DISPATCH[action](taskId, payload);
  } catch (err) {
    btn.dataset.submitting = ""; btn.disabled = false;
    if (stale()) return;
    showMsg(courierErrorMessageFr(err?.message, "Action impossible."));
    return;
  }
  const formHost = document.querySelector("#cpDetailFormHost");
  if (formHost) formHost.innerHTML = "";
  if (action === "reject") { await afterRejectMutation({ stale }); return; }
  await afterMutation(taskId, { stale, successToast: "Action enregistrée ✓" });
}

// Règle anti-régression : une mutation réussie ne devient jamais un échec si
// le refresh qui suit échoue — on l'affiche distinctement, en une seule fois
// même si les deux refresh (détail + contexte) échouent.
async function afterMutation(taskId, { stale, successToast }) {
  showToast(successToast);
  if (stale()) return;
  let refreshedDetail = null;
  let refreshFailed = false;
  try {
    refreshedDetail = await getMyDeliveryTask(taskId);
  } catch {
    refreshFailed = true;
  }
  try {
    await refreshContext();
  } catch {
    refreshFailed = true;
  }
  if (stale()) return;
  if (refreshFailed) showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red");
  if (refreshedDetail) renderTaskDetail(refreshedDetail, { stale });
}

// Correction ChatGPT — courier_reject_delivery_v1 retire l'affectation :
// get_my_delivery_task_v1(taskId) répondra légitimement
// assigned_delivery_not_found ensuite. Ce n'est pas un échec de refresh, donc
// reject est traité comme une sortie du détail, jamais un "refresh raté".
async function afterRejectMutation({ stale }) {
  showToast("Livraison refusée ✓");
  let refreshFailed = false;
  try { await refreshContext(); } catch { refreshFailed = true; }
  const stillOnThisDetail = !stale();
  invalidateDetail();
  if (!stillOnThisDetail) return; // l'utilisateur avait déjà quitté cet écran : on ne force rien
  forceSwitchTab("active");
  if (refreshFailed) showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red");
}


async function renderTransfersTab() {
  const host = document.querySelector("#cpBodyHost");
  if (!host) return;
  host.innerHTML = loading("Chargement des transferts de colis…");
  let rows;
  try { rows = await listMyDeliveryCustodyTransfers({ limit: 100 }); }
  catch (err) { host.innerHTML = errorBox(courierErrorMessageFr(err?.message, "Impossible de charger les transferts.")); return; }
  const myId = _cpCtx?.profile?.courier_profile_id || _cpCtx?.profile?.id || null;
  const active = rows.filter((r) => ["pending_source_confirmation","pending_target_confirmation"].includes(r.status));
  if (!active.length) { host.innerHTML = empty("Aucun transfert en attente", "Les handovers de colis apparaîtront ici."); refreshIcons(); return; }
  host.innerHTML = active.map((r) => {
    const isSource = myId && r.source_courier_profile_id === myId;
    const isTarget = myId && r.target_courier_profile_id === myId;
    const canOut = isSource && r.status === "pending_source_confirmation";
    const canIn = isTarget && r.status === "pending_target_confirmation" && !!r.source_confirmed_at;
    const waiting = canOut ? "Confirmez que vous remettez physiquement le colis au nouveau livreur." :
      canIn ? "Le livreur source a confirmé la remise. Vérifiez le colis puis confirmez la réception." :
      r.status === "pending_target_confirmation" ? "En attente de la confirmation du livreur cible." : "En attente de la confirmation du livreur source.";
    return `<div class="portal-card" data-transfer="${esc(r.transfer_id)}">
      <div class="toolbar"><div><strong>Transfert · ${esc(String(r.delivery_task_id).slice(0,8))}</strong><p class="muted">${esc(waiting)}</p></div>${badge(r.status, "amber")}</div>
      <div class="settings-section"><div><strong>Custody actuelle</strong><p>${esc(r.holder_type || "—")} · ${esc(String(r.holder_courier_profile_id || "").slice(0,8) || "—")}</p></div></div>
      <div class="settings-section"><div><strong>Source</strong><p>${esc(String(r.source_courier_profile_id || "").slice(0,8))}</p></div><div><strong>Cible</strong><p>${esc(String(r.target_courier_profile_id || "").slice(0,8))}</p></div></div>
      <div class="cp-actions">
        ${canOut ? `<button class="btn btn-blue btn-sm" type="button" data-transfer-out="${esc(r.transfer_id)}">Confirmer la remise (OUT)</button>` : ""}
        ${canIn ? `<button class="btn btn-blue btn-sm" type="button" data-transfer-in="${esc(r.transfer_id)}">Confirmer la réception (IN)</button>` : ""}
      </div>
    </div>`;
  }).join("");
  host.querySelectorAll("[data-transfer-out]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await courierConfirmCustodyTransferOut(b.dataset.transferOut, null); showToast("Remise confirmée ✓ Le colis reste sous votre custody jusqu’à la confirmation IN."); await renderTransfersTab(); await refreshContext().catch(()=>{}); }
    catch (e) { b.disabled = false; showToast(courierErrorMessageFr(e?.message, "Confirmation impossible."), "red"); }
  }));
  host.querySelectorAll("[data-transfer-in]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await courierConfirmCustodyTransferIn(b.dataset.transferIn, null); showToast("Réception confirmée ✓ La custody et l’assignation vous sont transférées."); await refreshContext().catch(()=>{}); forceSwitchTab("active"); }
    catch (e) { b.disabled = false; showToast(courierErrorMessageFr(e?.message, "Confirmation impossible."), "red"); }
  }));
  refreshIcons();
}

// --- Profil (édition / disponibilité / zones / position) -----------------------

function vehicleFieldsHtml(v = {}) {
  return `
    <div class="field"><label>Type de véhicule *</label><select class="input" name="vehicle_type" required>
      <option value="">Choisir…</option>
      ${Object.entries(VEHICLE_TYPE_FR).map(([k, l]) => `<option value="${esc(k)}" ${v.type === k ? "selected" : ""}>${esc(l)}</option>`).join("")}
    </select></div>
    <div class="customer-grid">
      <div class="field"><label>Marque</label><input class="input" name="vehicle_make" value="${esc(v.make || "")}"></div>
      <div class="field"><label>Modèle</label><input class="input" name="vehicle_model" value="${esc(v.model || "")}"></div>
    </div>
    <div class="customer-grid">
      <div class="field"><label>Couleur</label><input class="input" name="vehicle_color" value="${esc(v.color || "")}"></div>
      <div class="field"><label>Plaque</label><input class="input" name="vehicle_plate" value="${esc(v.plate || "")}"></div>
    </div>
    <div class="customer-grid">
      <div class="field"><label>Capacité (kg)</label><input class="input" type="number" min="0" step="0.1" name="vehicle_capacity_kg" value="${v.capacity_kg ?? ""}"></div>
      <div class="field"><label>Livraisons actives max. (1-20) *</label><input class="input" type="number" min="1" max="20" step="1" name="max_active_deliveries" required value="${v.max_active_deliveries ?? ""}"></div>
    </div>`;
}

function courierAddressFieldsHtml(base = {}) {
  return `<div class="customer-grid">
    <div class="field"><label>Adresse de base *</label><input class="input" name="base_address_line1" required value="${esc(base.address_line1 || "")}" placeholder="Rue, quartier, repère"></div>
    <div class="field"><label>Département *</label><input class="input" data-geo="department" name="base_department" required value="${esc(base.department || "")}" placeholder="Ex. Ouest"></div>
    <div class="field"><label>Commune *</label><input class="input" data-geo="commune" name="base_commune" required value="${esc(base.commune || "")}" placeholder="Ex. Carrefour"></div>
  </div>
  <p class="muted" style="font-size:11px;margin:0">Cette base sert à votre dossier livreur. Vos zones de service déterminent les missions que vous pouvez recevoir : choisissez de préférence une commune proposée (orthographe exacte, accents compris).</p>`;
}

function renderProfileTab() {
  const host = document.querySelector("#cpBodyHost");
  if (!host || !_cpCtx) return;
  const p = _cpCtx.profile || {};
  const caps = _cpCtx.capabilities || {};
  const v = p.vehicle || {};
  const base = p.base_address || {};
  const runtime = _cpCtx.runtime || {};
  host.innerHTML = `
    ${caps.can_edit_profile ? `<div class="portal-card">
      <h3>Mon profil livreur</h3>
      <form id="cpProfileForm" style="display:flex;flex-direction:column;gap:8px">
        <div class="field"><label>Téléphone *</label><input class="input" name="phone" required value="${esc(p.phone || "")}"></div>
        ${courierAddressFieldsHtml(base)}
        ${vehicleFieldsHtml(v)}
        <div id="cpProfileMsg" class="error-state" style="display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="submit">Enregistrer</button></div>
      </form>
    </div>` : `<div class="portal-card"><h3>Mon profil</h3><div class="settings-section"><div><strong>${esc(p.full_name || "—")}</strong><p>${esc(p.phone || "—")}${v.type ? ` · ${esc(VEHICLE_TYPE_FR[v.type] || v.type)}` : ""}</p></div></div></div>`}

    ${caps.can_manage_service_areas ? `<div class="portal-card"><h3>Zones de service</h3><div id="cpAreasHost"></div></div>` : ""}

    ${caps.can_update_location && runtime.location_tracking_enabled ? `<div class="portal-card">
      <h3>Position</h3>
      <p class="muted" style="font-size:12px">Dernière mise à jour : ${esc(fmtDate(_cpCtx.location?.last_updated_at) || "jamais")}</p>
      <div id="cpLocationMsg" style="font-size:12px;display:none;margin:6px 0"></div>
      <button class="btn btn-outline-blue btn-sm" type="button" id="cpUpdateLocationBtn">Mettre à jour ma position</button>
    </div>` : ""}
  `;
  refreshIcons();
  attachGeoHints(host);

  const form = document.querySelector("#cpProfileForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const msgBox = document.querySelector("#cpProfileMsg");
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    msgBox.style.display = "none";
    const viewSeq = _cpViewSeq;
    try {
      await submitMyCourierProfile({
        phone: (fd.get("phone") || "").trim(),
        vehicleType: fd.get("vehicle_type"),
        vehicleMake: (fd.get("vehicle_make") || "").trim() || null,
        vehicleModel: (fd.get("vehicle_model") || "").trim() || null,
        vehicleColor: (fd.get("vehicle_color") || "").trim() || null,
        vehiclePlate: (fd.get("vehicle_plate") || "").trim() || null,
        vehicleCapacityKg: fd.get("vehicle_capacity_kg") ? Number(fd.get("vehicle_capacity_kg")) : null,
        maxActiveDeliveries: Number(fd.get("max_active_deliveries")),
        baseAddressLine1: (fd.get("base_address_line1") || "").trim(),
        baseDepartment: (fd.get("base_department") || "").trim(),
        baseCommune: (fd.get("base_commune") || "").trim(),
      });
    } catch (err) {
      msgBox.textContent = courierErrorMessageFr(err?.message, "Impossible d'enregistrer ce profil.");
      msgBox.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast("Profil enregistré ✓");
    let refreshFailed = false;
    try { await refreshContext(); } catch { refreshFailed = true; }
    // L'utilisateur a pu changer d'onglet pendant l'enregistrement : ne
    // jamais repeindre un autre écran (ex: Historique) avec le profil.
    if (_cpViewSeq !== viewSeq) return;
    if (refreshFailed) { showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red"); btn.dataset.submitting = ""; btn.disabled = false; return; }
    renderProfileTab();
  });

  if (caps.can_manage_service_areas) renderServiceAreas(p.service_areas || []);

  document.querySelector("#cpUpdateLocationBtn")?.addEventListener("click", (e) => updateLocation(e.currentTarget));
}

function areaRowHtml(a = {}, i) {
  return `<div class="settings-section" data-area-row="${i}" style="flex-direction:column;align-items:stretch;gap:6px">
    <div class="customer-grid">
      <div class="field"><label>Nom *</label><input class="input area-label" value="${esc(a.label || "")}"></div>
      <div class="field"><label>Département</label><input class="input area-department" data-geo="department" value="${esc(a.department || "")}"></div>
    </div>
    <div class="customer-grid">
      <div class="field"><label>Commune</label><input class="input area-commune" data-geo="commune" value="${esc(a.commune || "")}"></div>
      <div class="field"><label>Priorité</label><input class="input area-priority" type="number" step="1" value="${a.priority ?? ""}"></div>
    </div>
    <div class="customer-grid">
      <div class="field"><label>Latitude</label><input class="input area-lat" type="number" step="any" value="${a.center_latitude ?? ""}"></div>
      <div class="field"><label>Longitude</label><input class="input area-lng" type="number" step="any" value="${a.center_longitude ?? ""}"></div>
      <div class="field"><label>Rayon (km)</label><input class="input area-radius" type="number" step="any" min="0" value="${a.radius_km ?? ""}"></div>
    </div>
    <label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" class="area-active" ${a.is_active !== false ? "checked" : ""}> Active</label>
    <div class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" data-remove-area="${i}">Supprimer cette zone</button></div>
  </div>`;
}

function renderServiceAreas(areas) {
  const host = document.querySelector("#cpAreasHost");
  if (!host) return;
  const rows = areas.length ? areas.slice() : [];
  const draw = () => {
    host.innerHTML = `${rows.map((a, i) => areaRowHtml(a, i)).join("") || `<p class="muted" style="font-size:12px">Aucune zone configurée.</p>`}
      <div id="cpAreasMsg" class="error-state" style="display:none;margin-top:6px"></div>
      <div class="toolbar-group" style="margin-top:8px">
        <button class="btn btn-ghost btn-sm" type="button" id="cpAddArea">Ajouter une zone</button>
        <button class="btn btn-dark btn-sm" type="button" id="cpSaveAreas">Enregistrer les zones</button>
      </div>`;
    refreshIcons();
    attachGeoHints(host);
    host.querySelectorAll("[data-remove-area]").forEach((btn) => btn.addEventListener("click", () => { rows.splice(Number(btn.dataset.removeArea), 1); draw(); }));
    host.querySelector("#cpAddArea")?.addEventListener("click", () => {
      if (rows.length >= MAX_SERVICE_AREAS) { showToast(`Maximum ${MAX_SERVICE_AREAS} zones de service.`, "red"); return; }
      rows.push({ label: "", department: "", commune: "", priority: null, center_latitude: null, center_longitude: null, radius_km: null, is_active: true });
      draw();
    });
    host.querySelector("#cpSaveAreas")?.addEventListener("click", () => saveServiceAreas(host, rows));
  };
  draw();
}

async function saveServiceAreas(host, rows) {
  const msgBox = host.querySelector("#cpAreasMsg");
  const showMsg = (t) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; } };
  const built = [];
  for (const row of host.querySelectorAll("[data-area-row]")) {
    const label = row.querySelector(".area-label").value.trim();
    if (!label) { showMsg("Chaque zone de service doit avoir un nom."); return; }
    const lat = row.querySelector(".area-lat").value.trim();
    const lng = row.querySelector(".area-lng").value.trim();
    const radius = row.querySelector(".area-radius").value.trim();
    const coordsProvided = [lat, lng, radius].filter((v) => v !== "");
    if (coordsProvided.length > 0 && coordsProvided.length < 3) {
      showMsg("Les coordonnées d'une zone (latitude, longitude, rayon) doivent être toutes fournies ou toutes absentes.");
      return;
    }
    built.push({
      label,
      department: row.querySelector(".area-department").value.trim() || null,
      commune: row.querySelector(".area-commune").value.trim() || null,
      priority: row.querySelector(".area-priority").value.trim() ? Number(row.querySelector(".area-priority").value) : null,
      center_latitude: lat !== "" ? Number(lat) : null,
      center_longitude: lng !== "" ? Number(lng) : null,
      radius_km: radius !== "" ? Number(radius) : null,
      is_active: row.querySelector(".area-active").checked,
    });
  }
  if (built.length > MAX_SERVICE_AREAS) { showMsg(`Maximum ${MAX_SERVICE_AREAS} zones de service.`); return; }
  const btn = host.querySelector("#cpSaveAreas");
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  msgBox.style.display = "none";
  const viewSeq = _cpViewSeq;
  try {
    await replaceMyCourierServiceAreas(built);
  } catch (err) {
    showMsg(courierErrorMessageFr(err?.message, "Impossible d'enregistrer ces zones."));
    btn.dataset.submitting = ""; btn.disabled = false;
    return;
  }
  showToast("Zones de service enregistrées ✓");
  let refreshFailed = false;
  try { await refreshContext(); } catch { refreshFailed = true; }
  if (_cpViewSeq !== viewSeq) return; // navigation utilisateur entre-temps : ne rien repeindre
  if (refreshFailed) { showToast("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", "red"); btn.dataset.submitting = ""; btn.disabled = false; return; }
  renderProfileTab();
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("geolocation_unsupported")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

async function updateLocation(btn) {
  const msgBox = document.querySelector("#cpLocationMsg");
  const showMsg = (t, ok) => { if (msgBox) { msgBox.textContent = t; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  let coords;
  try {
    coords = await getBrowserPosition();
  } catch (err) {
    btn.dataset.submitting = ""; btn.disabled = false;
    // Succès navigateur != succès backend, et un refus doit rester visible
    // sans jamais fabriquer une fausse position.
    showMsg(err?.code === 1 ? "Permission de localisation refusée." : "Impossible d'obtenir votre position depuis ce navigateur.", false);
    return;
  }
  const viewSeq = _cpViewSeq;
  try {
    await updateMyCourierLocation(coords.latitude, coords.longitude);
  } catch (err) {
    showMsg(courierErrorMessageFr(err?.message, "Impossible d'enregistrer votre position."), false);
    btn.dataset.submitting = ""; btn.disabled = false;
    return;
  }
  showToast("Position mise à jour ✓");
  let refreshFailed = false;
  try { await refreshContext(); } catch { refreshFailed = true; }
  if (_cpViewSeq !== viewSeq) return; // navigation utilisateur entre-temps : ne rien repeindre
  if (refreshFailed) { showMsg("Action enregistrée, mais impossible d'actualiser les informations. Réessayez l'actualisation.", false); btn.dataset.submitting = ""; btn.disabled = false; return; }
  renderProfileTab();
}

// --- Candidature (has_profile === false) ----------------------------------------

function renderApplicationOrClosed(ctx) {
  showContent();
  document.querySelector("#cpTabsHost").innerHTML = "";
  const host = document.querySelector("#cpHeaderHost");
  const body = document.querySelector("#cpBodyHost");
  if (host) host.innerHTML = "";
  if (!body) return;
  const caps = ctx.capabilities || {};
  const runtime = ctx.runtime || {};
  if (!caps.can_apply) {
    body.innerHTML = `<div class="portal-card">${empty("Candidatures fermées", runtime.public_message_fr || "Les candidatures livreur ne sont pas ouvertes pour le moment.")}</div>`;
    refreshIcons();
    return;
  }
  body.innerHTML = `<div class="portal-card">
    <h3>Devenir livreur VinHT</h3>
    ${runtime.public_message_fr ? `<p class="muted" style="font-size:12px">${esc(runtime.public_message_fr)}</p>` : ""}
    <form id="cpApplyForm" style="display:flex;flex-direction:column;gap:8px">
      <div class="field"><label>Téléphone *</label><input class="input" name="phone" required></div>
      ${courierAddressFieldsHtml({})}
      <div class="green-note">Votre commune principale sera créée comme première zone de service. Vous pourrez ensuite ajouter d'autres zones depuis votre profil.</div>
      ${vehicleFieldsHtml({})}
      <div id="cpApplyMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-blue btn-sm" type="submit">Envoyer ma candidature</button></div>
    </form>
  </div>`;
  refreshIcons();
  attachGeoHints(document.querySelector("#cpApplyForm"));
  const form = document.querySelector("#cpApplyForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const msgBox = document.querySelector("#cpApplyMsg");
    const btn = form.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    msgBox.style.display = "none";
    try {
      await submitMyCourierProfile({
        phone: (fd.get("phone") || "").trim(),
        vehicleType: fd.get("vehicle_type"),
        vehicleMake: (fd.get("vehicle_make") || "").trim() || null,
        vehicleModel: (fd.get("vehicle_model") || "").trim() || null,
        vehicleColor: (fd.get("vehicle_color") || "").trim() || null,
        vehiclePlate: (fd.get("vehicle_plate") || "").trim() || null,
        vehicleCapacityKg: fd.get("vehicle_capacity_kg") ? Number(fd.get("vehicle_capacity_kg")) : null,
        maxActiveDeliveries: Number(fd.get("max_active_deliveries")),
        baseAddressLine1: (fd.get("base_address_line1") || "").trim(),
        baseDepartment: (fd.get("base_department") || "").trim(),
        baseCommune: (fd.get("base_commune") || "").trim(),
      });
      showToast("Candidature envoyée ✓");
      await boot();
    } catch (err) {
      msgBox.textContent = courierErrorMessageFr(err?.message, "Impossible d'envoyer cette candidature.");
      msgBox.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
    }
  });
}

// --- Boot ------------------------------------------------------------------------

async function renderDashboard(ctx) {
  showContent();
  renderHeader(ctx);
  renderTabs();
  renderTabBody();
}

let _cpBooted = false;
let _cpLastUid = null;

async function boot() {
  invalidateView();
  let session;
  try { session = await getSession(); } catch { session = null; }
  if (!session?.user) {
    gate(authGateHtml());
    document.querySelector("#cpLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }
  gate(loading("Vérification de votre accès livreur…"));
  let ctx;
  try {
    ctx = await getMyCourierPortalContext();
  } catch (err) {
    gate(`<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Impossible de charger votre espace livreur</h3><p>${esc(courierErrorMessageFr(err?.message, "Réessayez dans un instant."))}</p><button class="btn btn-outline-blue btn-sm" type="button" id="cpGateRetry">Réessayer</button></div>`);
    document.querySelector("#cpGateRetry")?.addEventListener("click", boot);
    return;
  }
  _cpCtx = ctx;
  if (!ctx.has_profile) { renderApplicationOrClosed(ctx); return; }
  await renderDashboard(ctx);
}

export async function initCourierPortal() {
  if (document.body?.dataset?.courierPage !== "portal") return;
  if (!_cpBooted) {
    onAuthChange((s) => {
      const uid = (s && s.user && s.user.id) || null;
      if (_cpBooted && uid === _cpLastUid) return;
      _cpBooted = true; _cpLastUid = uid;
      boot();
    });
  }
  _cpBooted = true;
  const session = await getSession().catch(() => null);
  _cpLastUid = session?.user?.id || null;
  await boot();
}
