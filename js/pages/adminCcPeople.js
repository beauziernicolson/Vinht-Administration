// Control Center — onglets « Livreurs » et « Agents ».
// Toutes les actions passent par des RPC Admin (services/adminControl.js) avec
// motif saisi dans une modale ; l'UI n'invente aucune transition : le backend
// valide et son erreur est affichée en clair.

import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";
import {
  esc, fmtDateTime, chip, envPill, errorBox, emptyBox, backendGap, confirmAction, adminErrorFr,
} from "../ui/adminUi.js";
import {
  COURIER_STATUSES, adminListCouriers, adminGetCourier, adminReviewCourier, adminSetCourierOperationalStatus,
  AGENT_STATUSES, adminListAgents, adminActivateAgent, adminSuspendAgent, adminAssignAgentMerchant, adminUnassignAgentMerchant,
  adminGetAgentAudit, adminListAssistedDossiers, adminSetAssistedDossierAgent, adminCancelAssistedDossier,
  AGENT_APPLICATION_STATUSES, adminListAgentApplications, adminReviewAgentApplication,
} from "../services/adminControl.js";
import { getAdminMerchants, getAdminUsers } from "../services/admin.js?v=20260922-mega-a-v1";

const COURIER_STATUS_FR = { pending_review: "À examiner", active: "Actif", paused: "En pause", suspended: "Suspendu", rejected: "Refusé", closed: "Fermé" };
const COURIER_STATUS_TONE = { pending_review: "amber", active: "green", paused: "blue", suspended: "red", rejected: "red", closed: "" };
const AVAIL_FR = { offline: "Hors ligne", available: "En ligne", busy: "Occupé" };
const VEHICLE_FR = { motorcycle: "Moto", car: "Voiture", van: "Camionnette", bicycle: "Vélo", on_foot: "À pied", other: "Autre" };
const AGENT_STATUS_FR = { active: "Actif", suspended: "Suspendu", closed: "Fermé" };
const AGENT_STATUS_TONE = { active: "green", suspended: "red", closed: "" };
const APPLICATION_STATUS_FR = { pending_review: "À examiner", approved: "Approuvée", rejected: "Refusée", cancelled: "Annulée" };
const APPLICATION_STATUS_TONE = { pending_review: "amber", approved: "green", rejected: "red", cancelled: "" };
const DOSSIER_STATUS_FR = { draft: "Brouillon", ready_for_invite: "Prêt pour invitation", invited: "Invité", claimed: "Réclamé", cancelled: "Annulé" };
const COURIER_EVENT_FR = { approved: "Approuvé", rejected: "Refusé", operational_status_changed: "Statut modifié", application_submitted: "Candidature envoyée", application_resubmitted: "Candidature renvoyée" };

const statusOptions = (values, labels, current, allLabel) =>
  `<option value="">${esc(allLabel)}</option>` +
  values.map((v) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(labels[v] || v)}</option>`).join("");

const addr = (a) => [a?.address_line1, a?.commune, a?.department].filter(Boolean).join(", ") || "—";

// ---------------------------------------------------------------------------
// LIVREURS
// ---------------------------------------------------------------------------
function courierActions(c) {
  const s = c.operational_status;
  const acts = [];
  if (s === "pending_review") {
    acts.push({ id: "approve", label: "Approuver", cls: "btn-blue" });
    acts.push({ id: "reject", label: "Refuser…", cls: "btn-outline-red" });
  } else if (s === "active") {
    acts.push({ id: "paused", label: "Mettre en pause", cls: "btn-outline-blue" });
    acts.push({ id: "suspended", label: "Suspendre…", cls: "btn-outline-red" });
    acts.push({ id: "closed", label: "Fermer le compte…", cls: "btn-outline-red" });
  } else if (s === "paused") {
    acts.push({ id: "active", label: "Réactiver", cls: "btn-blue" });
    acts.push({ id: "suspended", label: "Suspendre…", cls: "btn-outline-red" });
    acts.push({ id: "closed", label: "Fermer le compte…", cls: "btn-outline-red" });
  } else if (s === "suspended") {
    acts.push({ id: "active", label: "Réactiver", cls: "btn-blue" });
    acts.push({ id: "closed", label: "Fermer le compte…", cls: "btn-outline-red" });
  } else if (s === "closed") {
    acts.push({ id: "active", label: "Rouvrir le compte", cls: "btn-outline-blue" });
  }
  // "rejected" : le livreur doit renvoyer une candidature, aucune action admin.
  return acts;
}

function courierDetailHtml(c, env) {
  const v = c.vehicle || {};
  const areas = Array.isArray(c.service_areas) ? c.service_areas : [];
  const events = Array.isArray(c.events) ? c.events : [];
  const acts = courierActions(c);
  return `<div class="portal-card cc-detail" data-courier-detail="${esc(c.courier_profile_id)}">
    <div class="toolbar"><div><h3 style="margin:0">${esc(c.full_name || "Livreur")}</h3>
      <p class="muted" style="margin:2px 0 0">${esc(c.phone || "Téléphone non renseigné")} · ${envPill(c.environment || env)}</p></div>
      <div class="toolbar-group">${chip(COURIER_STATUS_FR[c.operational_status] || c.operational_status, COURIER_STATUS_TONE[c.operational_status] || "")}${chip(AVAIL_FR[c.availability_status] || c.availability_status || "—")}</div></div>
    <div class="cc-grid">
      <div><strong>Adresse de base</strong><div>${esc(addr(c.base_address))}</div></div>
      <div><strong>Véhicule</strong><div>${esc(VEHICLE_FR[v.type] || v.type || "—")} ${esc([v.make, v.model, v.color].filter(Boolean).join(" "))} ${v.plate ? `· ${esc(v.plate)}` : ""}</div></div>
      <div><strong>Capacité</strong><div>${v.max_active_deliveries != null ? `${esc(v.max_active_deliveries)} livraison(s) simultanée(s)` : "—"}${v.capacity_kg != null ? ` · ${esc(v.capacity_kg)} kg` : ""}</div></div>
      <div><strong>Approuvé le</strong><div>${esc(fmtDateTime(c.approved_at))}</div></div>
    </div>
    ${c.rejected_reason ? `<p class="error-state"><strong>Motif du refus :</strong> ${esc(c.rejected_reason)}</p>` : ""}
    ${c.suspended_reason ? `<p class="error-state"><strong>Motif de suspension :</strong> ${esc(c.suspended_reason)}</p>` : ""}
    ${c.admin_notes ? `<p class="muted"><strong>Notes internes :</strong> ${esc(c.admin_notes)}</p>` : ""}
    <h4>Zones de service (${esc(c.active_service_areas_count ?? 0)} active${(c.active_service_areas_count ?? 0) > 1 ? "s" : ""})</h4>
    ${areas.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Zone</th><th>Département</th><th>Commune</th><th>Rayon</th><th>État</th></tr></thead><tbody>${areas.map((a) => `<tr><td>${esc(a.label || "—")}</td><td>${esc(a.department || "—")}</td><td>${esc(a.commune || "—")}</td><td>${a.radius_km != null ? esc(a.radius_km) + " km" : "—"}</td><td>${chip(a.is_active ? "Active" : "Inactive", a.is_active ? "green" : "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Aucune zone de service : le livreur ne peut recevoir aucune mission tant qu'une zone active n'existe pas.</p>`}
    <h4>Historique</h4>
    ${events.length ? `<ul class="cc-timeline">${events.map((e) => `<li><strong>${esc(COURIER_EVENT_FR[e.event_type] || e.event_type)}</strong>${e.from_status || e.to_status ? ` · ${esc(COURIER_STATUS_FR[e.from_status] || e.from_status || "—")} → ${esc(COURIER_STATUS_FR[e.to_status] || e.to_status || "—")}` : ""}${e.reason ? ` · « ${esc(e.reason)} »` : ""}<span class="muted"> — ${esc(fmtDateTime(e.created_at))}</span></li>`).join("")}</ul>` : `<p class="muted">Aucun événement.</p>`}
    <div class="toolbar-group" style="margin-top:12px">${acts.length ? acts.map((a) => `<button class="btn ${a.cls} btn-sm" type="button" data-courier-act="${esc(a.id)}">${esc(a.label)}</button>`).join("") : `<span class="muted">Aucune action administrative disponible pour cet état${c.operational_status === "rejected" ? " (le livreur doit renvoyer une candidature)" : ""}.</span>`}</div>
  </div>`;
}

export async function renderCouriers(body, { env }) {
  const state = { status: "", list: [], selected: null };
  const draw = async () => {
    body.innerHTML = `<div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Livreurs</h3>
      <p class="muted" style="margin:2px 0 0">Candidatures, statut opérationnel, zones de service. ${envPill(env)}</p></div>
      <div class="toolbar-group"><select class="input" data-f-status>${statusOptions(COURIER_STATUSES, COURIER_STATUS_FR, state.status, "Tous les statuts")}</select>
      <button class="btn btn-ghost btn-sm" type="button" data-refresh>Actualiser</button></div></div>
      <div data-list><div class="loading-state">Chargement des livreurs…</div></div></div><div data-detail></div>`;
    body.querySelector("[data-f-status]").addEventListener("change", (e) => { state.status = e.target.value; state.selected = null; draw(); });
    body.querySelector("[data-refresh]").addEventListener("click", () => draw());
    const listEl = body.querySelector("[data-list]");
    try {
      state.list = await adminListCouriers({ status: state.status || null, limit: 100 });
    } catch (e) { listEl.innerHTML = errorBox(adminErrorFr(e, "Impossible de charger les livreurs."), "data-retry"); listEl.querySelector("[data-retry]")?.addEventListener("click", draw); return; }
    if (!state.list.length) { listEl.innerHTML = emptyBox("Aucun livreur", state.status ? "Aucun livreur avec ce statut dans cet environnement." : "Aucune candidature ni livreur dans cet environnement."); return; }
    const pending = state.list.filter((c) => c.operational_status === "pending_review").length;
    listEl.innerHTML = `${pending ? `<div class="green-note" style="margin-bottom:8px"><strong>${pending} candidature${pending > 1 ? "s" : ""} à examiner.</strong></div>` : ""}
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Livreur</th><th>Statut</th><th>Disponibilité</th><th>Base</th><th>Véhicule</th><th>Zones</th><th>Créé</th><th></th></tr></thead><tbody>
      ${state.list.map((c) => `<tr class="${state.selected === c.courier_profile_id ? "cc-row-active" : ""}"><td><strong>${esc(c.full_name || "—")}</strong><div class="muted">${esc(c.phone || "")}</div></td>
        <td>${chip(COURIER_STATUS_FR[c.operational_status] || c.operational_status, COURIER_STATUS_TONE[c.operational_status] || "")}</td>
        <td>${esc(AVAIL_FR[c.availability_status] || c.availability_status || "—")}</td>
        <td>${esc([c.base_address?.commune, c.base_address?.department].filter(Boolean).join(", ") || "—")}</td>
        <td>${esc(VEHICLE_FR[c.vehicle?.type] || c.vehicle?.type || "—")}</td>
        <td>${esc(c.active_service_areas_count ?? 0)}</td><td>${esc(fmtDateTime(c.created_at))}</td>
        <td><button class="btn btn-outline-blue btn-sm" type="button" data-open="${esc(c.courier_profile_id)}">Ouvrir</button></td></tr>`).join("")}
      </tbody></table></div>`;
    listEl.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.open)));
    if (state.selected) openDetail(state.selected);
    refreshIcons();
  };

  const openDetail = async (id) => {
    state.selected = id;
    const host = body.querySelector("[data-detail]");
    host.innerHTML = `<div class="loading-state">Chargement du dossier…</div>`;
    let c;
    try { c = await adminGetCourier(id); }
    catch (e) { host.innerHTML = errorBox(adminErrorFr(e, "Dossier livreur indisponible.")); return; }
    host.innerHTML = courierDetailHtml(c, env);
    host.scrollIntoView({ behavior: "smooth", block: "start" });
    host.querySelectorAll("[data-courier-act]").forEach((b) => b.addEventListener("click", () => act(c, b.dataset.courierAct, b)));
    refreshIcons();
  };

  const act = async (c, action, btn) => {
    const name = c.full_name || "ce livreur";
    let call;
    if (action === "approve") {
      const ok = await confirmAction({ title: `Approuver ${name} ?`, env, confirmLabel: "Approuver",
        consequences: ["Le livreur reçoit le rôle « courier » et accède à l'Espace Livreur.", "Il pourra se mettre en ligne si la logistique et les opérations livreur sont activées.", "Le backend refuse l'approbation sans zone de service active ni adresse de base complète."] });
      if (!ok) return;
      call = () => adminReviewCourier(c.courier_profile_id, true);
    } else if (action === "reject") {
      const ok = await confirmAction({ title: `Refuser la candidature de ${name} ?`, env, requireReason: true, reasonLabel: "Motif du refus (visible par le livreur)", confirmLabel: "Refuser", danger: true,
        consequences: ["Le livreur pourra corriger et renvoyer sa candidature.", "Le rôle « courier » est retiré s'il n'a aucun autre profil actif."] });
      if (!ok) return;
      call = () => adminReviewCourier(c.courier_profile_id, false, ok.reason);
    } else {
      const cfg = {
        active: { t: `Réactiver ${name} ?`, cl: "Réactiver", reason: false, danger: false, cons: ["Le livreur retrouve l'accès à l'Espace Livreur (il devra se remettre en ligne)."] },
        paused: { t: `Mettre ${name} en pause ?`, cl: "Mettre en pause", reason: false, danger: false, cons: ["Il passe hors ligne et ne reçoit plus de nouvelles missions.", "Les livraisons déjà en cours ne sont pas modifiées par cette action."] },
        suspended: { t: `Suspendre ${name} ?`, cl: "Suspendre", reason: true, danger: true, cons: ["Il passe hors ligne immédiatement et ne peut plus prendre de missions.", "Le motif est enregistré dans l'historique."] },
        closed: { t: `Fermer le compte livreur de ${name} ?`, cl: "Fermer le compte", reason: true, danger: true, cons: ["Le rôle « courier » est retiré (sauf autre profil actif).", "Le livreur perd l'accès à l'Espace Livreur."] },
      }[action];
      if (!cfg) return;
      const ok = await confirmAction({ title: cfg.t, env, requireReason: cfg.reason, confirmLabel: cfg.cl, danger: cfg.danger, consequences: cfg.cons });
      if (!ok) return;
      call = () => adminSetCourierOperationalStatus(c.courier_profile_id, action, ok.reason || null);
    }
    btn.disabled = true;
    try { await call(); showToast("Action enregistrée ✓"); await draw(); }
    catch (e) { showToast(adminErrorFr(e, "Action refusée par le backend."), "red"); btn.disabled = false; }
  };

  await draw();
}

// ---------------------------------------------------------------------------
// AGENTS
// ---------------------------------------------------------------------------
// Modale de choix dans une liste (jamais window.prompt).
function chooseModal({ title, env, label, options, confirmLabel = "Valider", withReason = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "cc-modal-backdrop";
    wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div style="margin:0 0 8px">${envPill(env)}</div>
      <div class="field"><label>${esc(label)}</label><select class="input" data-v>${options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select></div>
      ${withReason ? `<div class="field"><label>Motif (optionnel)</label><input class="input" data-r maxlength="300"></div>` : ""}
      <div class="toolbar-group" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-c type="button">Annuler</button><button class="btn btn-blue" data-ok type="button">${esc(confirmLabel)}</button></div></div>`;
    document.body.appendChild(wrap);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector("[data-c]").addEventListener("click", () => done(null));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    wrap.querySelector("[data-ok]").addEventListener("click", () => done({ value: wrap.querySelector("[data-v]").value, reason: (wrap.querySelector("[data-r]")?.value || "").trim() }));
  });
}

async function pickMerchantDialog(env) {
  let merchants = [];
  try { merchants = await getAdminMerchants({ environment: env === "demo" ? "demo" : "production", limit: 200 }); } catch { /* liste vide */ }
  return merchants.filter((m) => m.status === "active");
}

export async function renderAgents(body, { env }) {
  const state = { status: "", dossierStatus: "", appStatus: "pending_review" };
  const draw = async () => {
    body.innerHTML = `
      <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Agents</h3>
        <p class="muted" style="margin:2px 0 0">Profils Agent, marchands assignés, audit. ${envPill(env)}</p></div>
        <div class="toolbar-group"><select class="input" data-a-status>${statusOptions(AGENT_STATUSES, AGENT_STATUS_FR, state.status, "Tous les statuts")}</select>
        <button class="btn btn-outline-blue btn-sm" type="button" data-activate>Activer un Agent…</button></div></div>
        <div data-agents><div class="loading-state">Chargement des Agents…</div></div></div>
      <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Candidatures Agent</h3>
        <p class="muted" style="margin:2px 0 0">Candidatures déposées depuis le Centre Agent. L'approbation crée le profil Agent avec l'adresse déclarée.</p></div>
        <select class="input" data-app-status>${statusOptions(AGENT_APPLICATION_STATUSES, APPLICATION_STATUS_FR, state.appStatus, "Toutes")}</select></div>
        <div data-applications><div class="loading-state">Chargement des candidatures…</div></div></div>
      <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Dossiers marchands accompagnés</h3>
        <p class="muted" style="margin:2px 0 0">Dossiers créés par les Agents (adresse du commerce incluse).</p></div>
        <select class="input" data-d-status>${statusOptions(["draft", "ready_for_invite", "invited", "claimed", "cancelled"], DOSSIER_STATUS_FR, state.dossierStatus, "Tous les statuts")}</select></div>
        <div data-dossiers><div class="loading-state">Chargement des dossiers…</div></div></div>
      <div class="portal-card"><h3 style="margin-top:0">Audit des actions Agent</h3><div data-audit><div class="loading-state">Chargement de l'audit…</div></div></div>`;
    body.querySelector("[data-a-status]").addEventListener("change", (e) => { state.status = e.target.value; loadAgents(); });
    body.querySelector("[data-d-status]").addEventListener("change", (e) => { state.dossierStatus = e.target.value; loadDossiers(); });
    body.querySelector("[data-app-status]").addEventListener("change", (e) => { state.appStatus = e.target.value; loadApplications(); });
    body.querySelector("[data-activate]").addEventListener("click", activateAgent);
    loadApplications(); loadAgents(); loadDossiers(); loadAudit();
  };

  const loadApplications = async () => {
    const host = body.querySelector("[data-applications]");
    if (!host) return;
    host.innerHTML = `<div class="loading-state">Chargement des candidatures…</div>`;
    try {
      const r = await adminListAgentApplications({ status: state.appStatus || null, limit: 50 });
      if (!r.rows.length) { host.innerHTML = emptyBox("Aucune candidature", state.appStatus === "pending_review" ? "Aucune candidature en attente d'examen." : "Aucune candidature pour ce filtre."); return; }
      host.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Candidat</th><th>Téléphone</th><th>Adresse</th><th>Statut</th><th>Reçue le</th><th></th></tr></thead><tbody>
        ${r.rows.map((a) => `<tr><td><strong>${esc(a.display_name || "—")}</strong></td>
          <td>${esc(a.phone || "—")}</td>
          <td>${esc(addr(a))}</td>
          <td>${chip(APPLICATION_STATUS_FR[a.status] || a.status, APPLICATION_STATUS_TONE[a.status] || "")}${a.review_reason ? `<div class="muted">Motif : ${esc(a.review_reason)}</div>` : ""}</td>
          <td>${esc(fmtDateTime(a.created_at))}</td>
          <td class="toolbar-group">${a.status === "pending_review" ? `<button class="btn btn-blue btn-sm" type="button" data-app-approve="${esc(a.id)}">Approuver</button><button class="btn btn-outline-red btn-sm" type="button" data-app-reject="${esc(a.id)}">Refuser…</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div><p class="muted" style="font-size:12px">${esc(r.total ?? r.rows.length)} candidature(s).</p>`;
      const byId = new Map(r.rows.map((a) => [a.id, a]));
      host.querySelectorAll("[data-app-approve]").forEach((b) => b.addEventListener("click", () => reviewApplication(byId.get(b.dataset.appApprove), true, b)));
      host.querySelectorAll("[data-app-reject]").forEach((b) => b.addEventListener("click", () => reviewApplication(byId.get(b.dataset.appReject), false, b)));
    } catch (e) { host.innerHTML = errorBox(adminErrorFr(e, "Impossible de charger les candidatures."), "data-retry"); host.querySelector("[data-retry]")?.addEventListener("click", loadApplications); }
  };

  const reviewApplication = async (app, approve, btn) => {
    if (!app) return;
    const who = app.display_name || "ce candidat";
    const ok = await confirmAction({
      title: approve ? `Approuver ${who} comme Agent ?` : `Refuser la candidature de ${who} ?`, env,
      requireReason: !approve, minReason: 5, reasonLabel: approve ? undefined : "Motif du refus (obligatoire, visible du candidat)",
      confirmLabel: approve ? "Approuver" : "Refuser", danger: !approve,
      consequences: approve
        ? [`Le rôle « agent » est accordé et un profil Agent actif est créé avec l'adresse : ${addr(app)}.`, "Il n'aura accès à aucun marchand tant que vous ne lui en assignez pas."]
        : ["Le candidat est informé du refus et du motif.", "Il pourra déposer une nouvelle candidature."],
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await adminReviewAgentApplication(app.id, approve, ok.reason || null);
      showToast(approve ? "Candidature approuvée ✓" : "Candidature refusée ✓");
      loadApplications(); loadAgents(); loadAudit();
    } catch (e) { showToast(adminErrorFr(e, "Décision refusée par le backend."), "red"); btn.disabled = false; loadApplications(); }
  };

  let agentsCache = [];
  const loadAgents = async () => {
    const host = body.querySelector("[data-agents]");
    host.innerHTML = `<div class="loading-state">Chargement des Agents…</div>`;
    try {
      const r = await adminListAgents({ status: state.status || null, limit: 100 });
      agentsCache = r.rows;
      if (!r.rows.length) { host.innerHTML = emptyBox("Aucun Agent", "Aucun profil Agent dans cet environnement."); return; }
      host.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Agent</th><th>Statut</th><th>Adresse</th><th>Marchands assignés</th><th></th></tr></thead><tbody>
        ${r.rows.map((a) => `<tr><td><strong>${esc(a.display_name || "—")}</strong><div class="muted">${esc(a.phone || "")}</div></td>
          <td>${chip(AGENT_STATUS_FR[a.status] || a.status, AGENT_STATUS_TONE[a.status] || "")}</td>
          <td>${a.address_line1 || a.commune ? esc([a.address_line1, a.commune, a.department].filter(Boolean).join(", ")) : '<span class="muted">Non renseignée (activation directe)</span>'}</td>
          <td>${esc(a.assigned_merchants_count ?? 0)}</td>
          <td class="toolbar-group">${a.status === "active" ? `<button class="btn btn-outline-blue btn-sm" data-assign="${esc(a.user_id)}" type="button">Assigner un marchand</button><button class="btn btn-ghost btn-sm" data-unassign="${esc(a.user_id)}" type="button">Retirer un marchand</button><button class="btn btn-outline-red btn-sm" data-suspend="${esc(a.user_id)}" type="button">Suspendre…</button>` : ""}<button class="btn btn-ghost btn-sm" data-audit="${esc(a.user_id)}" type="button">Audit</button></td></tr>`).join("")}
        </tbody></table></div><p class="muted" style="font-size:12px">${esc(r.total ?? r.rows.length)} Agent(s).</p>`;
      host.querySelectorAll("[data-suspend]").forEach((b) => b.addEventListener("click", () => suspend(b.dataset.suspend, b)));
      host.querySelectorAll("[data-assign]").forEach((b) => b.addEventListener("click", () => assign(b.dataset.assign, true)));
      host.querySelectorAll("[data-unassign]").forEach((b) => b.addEventListener("click", () => assign(b.dataset.unassign, false)));
      host.querySelectorAll("[data-audit]").forEach((b) => b.addEventListener("click", () => loadAudit(b.dataset.audit)));
    } catch (e) { host.innerHTML = errorBox(adminErrorFr(e, "Impossible de charger les Agents."), "data-retry"); host.querySelector("[data-retry]")?.addEventListener("click", loadAgents); }
  };

  const agentName = (uid) => agentsCache.find((a) => a.user_id === uid)?.display_name || "cet Agent";

  const suspend = async (uid, btn) => {
    const ok = await confirmAction({ title: `Suspendre ${agentName(uid)} ?`, env, requireReason: true, minReason: 5, confirmLabel: "Suspendre", danger: true,
      consequences: ["L'Agent perd l'accès au Centre Agent.", "Toutes ses affectations de marchands actives sont révoquées automatiquement."] });
    if (!ok) return;
    btn.disabled = true;
    try { await adminSuspendAgent(uid, ok.reason); showToast("Agent suspendu ✓"); loadAgents(); loadAudit(); }
    catch (e) { showToast(adminErrorFr(e, "Suspension refusée."), "red"); btn.disabled = false; }
  };

  const assign = async (uid, doAssign) => {
    const merchants = await pickMerchantDialog(env);
    if (!merchants.length) { showToast("Aucun marchand actif dans cet environnement.", "red"); return; }
    const r = await chooseModal({
      title: doAssign ? `Assigner un marchand à ${agentName(uid)}` : `Retirer un marchand à ${agentName(uid)}`,
      env, label: "Marchand", confirmLabel: doAssign ? "Assigner" : "Retirer", withReason: true,
      options: merchants.map((m) => ({ value: m.id, label: `${m.shop_name || m.id} · ${m.merchant_type || ""}` })),
    });
    if (!r) return;
    try {
      if (doAssign) await adminAssignAgentMerchant(uid, r.value, r.reason || null);
      else await adminUnassignAgentMerchant(uid, r.value, r.reason || null);
      showToast(doAssign ? "Marchand assigné ✓" : "Marchand retiré ✓"); loadAgents(); loadAudit(uid);
    } catch (e) { showToast(adminErrorFr(e, "Opération refusée par le backend."), "red"); }
  };

  const activateAgent = async () => {
    let users = [];
    try { users = await getAdminUsers({ limit: 250 }); } catch (e) { showToast(adminErrorFr(e, "Liste des utilisateurs indisponible."), "red"); return; }
    const candidates = users.filter((u) => !(u.roles || []).includes("agent"));
    const wrap = document.createElement("div");
    wrap.className = "cc-modal-backdrop";
    wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true"><h3>Activer un utilisateur comme Agent</h3><div style="margin:0 0 8px">${envPill(env)}</div>
      <div class="error-state" style="margin-bottom:8px">Chemin d'activation directe : l'adresse, le département et la commune de l'Agent ne sont <strong>pas</strong> enregistrés. Préférez le circuit « Candidatures Agent » ci-dessus, qui enregistre l'adresse déclarée.</div>
      <div class="field"><label>Utilisateur</label><select class="input" data-u>${candidates.map((u) => `<option value="${esc(u.id)}" data-name="${esc(u.full_name || "")}" data-phone="${esc(u.phone || "")}">${esc(u.full_name || u.email || u.id)} — ${esc(u.email || "")}</option>`).join("")}</select></div>
      <div class="field"><label>Nom affiché</label><input class="input" data-n maxlength="120"></div><div class="field"><label>Téléphone</label><input class="input" data-p maxlength="40"></div>
      <div class="toolbar-group" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost" data-c type="button">Annuler</button><button class="btn btn-blue" data-ok type="button">Activer l'Agent</button></div></div>`;
    document.body.appendChild(wrap);
    const sel = wrap.querySelector("[data-u]");
    const fill = () => { const o = sel.selectedOptions[0]; wrap.querySelector("[data-n]").value = o?.dataset.name || ""; wrap.querySelector("[data-p]").value = o?.dataset.phone || ""; };
    sel.addEventListener("change", fill); fill();
    wrap.querySelector("[data-c]").addEventListener("click", () => wrap.remove());
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelector("[data-ok]").addEventListener("click", async () => {
      const uid = sel.value; const n = wrap.querySelector("[data-n]").value.trim(); const p = wrap.querySelector("[data-p]").value.trim();
      if (!uid || n.length < 2) { showToast("Nom affiché requis (2 caractères min.).", "red"); return; }
      const ok = await confirmAction({ title: `Activer ${n} comme Agent ?`, env, confirmLabel: "Activer", consequences: ["L'utilisateur reçoit le rôle « agent » et accède au Centre Agent.", "Il n'aura accès à aucun marchand tant que vous ne lui en assignez pas."] });
      if (!ok) return;
      try {
        await adminActivateAgent(uid, n, p || null);
        wrap.remove(); showToast("Agent activé ✓"); loadAgents();
      } catch (e) { showToast(adminErrorFr(e, "Activation refusée."), "red"); }
    });
  };

  const loadDossiers = async () => {
    const host = body.querySelector("[data-dossiers]");
    host.innerHTML = `<div class="loading-state">Chargement des dossiers…</div>`;
    try {
      const r = await adminListAssistedDossiers({ status: state.dossierStatus || null, limit: 50 });
      if (!r.rows.length) { host.innerHTML = emptyBox("Aucun dossier", "Aucun dossier accompagné dans cet environnement."); return; }
      host.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Dossier</th><th>Statut</th><th>Commerce</th><th>Progression</th><th>Agent</th><th></th></tr></thead><tbody>
        ${r.rows.map((d) => {
          const p = d.profile || {};
          const pr = d.progress || {};
          const ag = d.assigned_agent || {};
          const id = d.id;
          const st = d.status;
          const ready = (k) => (pr[k] === true ? "✓" : pr[k] === false ? "✗" : "—");
          return `<tr><td><strong>${esc(p.shop_name || "—")}</strong><div class="muted">${esc(p.full_name || "")}</div></td>
            <td>${chip(DOSSIER_STATUS_FR[st] || st || "—", st === "claimed" ? "green" : st === "cancelled" ? "red" : "blue")}</td>
            <td>${esc([p.business_address_line1, p.business_commune, p.business_department].filter(Boolean).join(", ") || "—")}</td>
            <td class="muted">Contact ${ready("contact_complete")} · Boutique ${ready("shop_complete")} · Adresse ${ready("address_complete")}${pr.ready_for_invite ? " · <strong>prêt</strong>" : ""}</td>
            <td>${esc(ag.display_name || "—")}</td>
            <td class="toolbar-group">${st !== "claimed" && st !== "cancelled" ? `<button class="btn btn-outline-blue btn-sm" type="button" data-reassign="${esc(id)}">Changer d'Agent</button><button class="btn btn-outline-red btn-sm" type="button" data-cancel="${esc(id)}">Annuler…</button>` : ""}</td></tr>`;
        }).join("")}</tbody></table></div>`;
      host.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
        const ok = await confirmAction({ title: "Annuler ce dossier accompagné ?", env, requireReason: true, confirmLabel: "Annuler le dossier", danger: true, consequences: ["Le dossier n'est plus utilisable ni invitable."] });
        if (!ok) return;
        try { await adminCancelAssistedDossier(b.dataset.cancel, ok.reason); showToast("Dossier annulé ✓"); loadDossiers(); } catch (e) { showToast(adminErrorFr(e, "Annulation refusée."), "red"); }
      }));
      host.querySelectorAll("[data-reassign]").forEach((b) => b.addEventListener("click", async () => {
        const actives = agentsCache.filter((a) => a.status === "active");
        if (!actives.length) { showToast("Aucun Agent actif.", "red"); return; }
        const pick = await chooseModal({ title: "Assigner ce dossier à un Agent", env, label: "Agent", confirmLabel: "Assigner", options: actives.map((a) => ({ value: a.user_id, label: a.display_name || a.user_id })) });
        if (!pick) return;
        try { await adminSetAssistedDossierAgent(b.dataset.reassign, pick.value); showToast("Agent assigné au dossier ✓"); loadDossiers(); } catch (e) { showToast(adminErrorFr(e, "Assignation refusée."), "red"); }
      }));
    } catch (e) { host.innerHTML = errorBox(adminErrorFr(e, "Impossible de charger les dossiers."), "data-retry"); host.querySelector("[data-retry]")?.addEventListener("click", loadDossiers); }
  };

  const loadAudit = async (agentUserId = null) => {
    const host = body.querySelector("[data-audit]");
    if (!host) return;
    host.innerHTML = `<div class="loading-state">Chargement de l'audit…</div>`;
    try {
      const r = await adminGetAgentAudit({ agentUserId, limit: 30 });
      host.innerHTML = r.rows.length ? `${agentUserId ? `<p class="muted">Filtré sur ${esc(agentName(agentUserId))} — <button class="btn btn-ghost btn-sm" type="button" data-clear>Tout afficher</button></p>` : ""}<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Portée</th><th>Motif</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${esc(fmtDateTime(x.created_at))}</td><td>${esc(x.actor_role || "—")}</td><td>${esc(x.action || "—")}</td><td>${esc(x.scope || x.entity_type || "—")}</td><td>${esc(x.reason || "—")}</td></tr>`).join("")}</tbody></table></div>` : emptyBox("Aucune action enregistrée", "");
      host.querySelector("[data-clear]")?.addEventListener("click", () => loadAudit());
    } catch (e) { host.innerHTML = errorBox(adminErrorFr(e, "Audit indisponible.")); }
  };

  await draw();
}
