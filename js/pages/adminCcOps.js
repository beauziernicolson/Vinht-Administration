// Control Center — onglets « Missions » et « Logistique ».
//
// Machine d'état, permissions et éligibilité appartiennent au backend.
// Les actions Admin viennent des capabilities du cockpit serveur ; aucune règle
// de dispatch/custody/completion n'est redérivée dans le navigateur.
// Les réglages logistiques suivent le circuit officiel brouillon -> contrôle
// (preflight) -> activation, avec motif obligatoire ; en Production, l'activation
// et le retour arrière exigent en plus une phrase de confirmation.

import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";
import { esc, fmtDateTime, chip, onOff, envPill, errorBox, emptyBox, backendGap, confirmAction, formModal, adminErrorFr } from "../ui/adminUi.js";
import {
  TASK_FILTERABLE_STATUSES, adminGetLogisticsCockpit, adminGetDeliveryTaskCockpit, adminListDeliveryCandidates, adminAssignDelivery,
  adminPublishReadyDeliveryTasks, adminResolveDeliveryIncident, adminConfirmDispatchHubReceipt, adminConfirmCustomerDeliveryOverride,
  adminCancelDeliveryIncidentResolution, adminCancelDeliveryCustodyTransfer, adminConfirmDeliveryReturnHubReceived,
  adminSetDeliveryCompensation, adminListLogisticsAudit, adminListLogisticsVersions, adminRollbackLogisticsVersion, adminSimulateLogistics,
  adminListDeliveryZones, adminCreateDeliveryZone, adminUpdateDeliveryZone, adminListPickupPoints, adminSetPickupPointState,
  adminCreatePickupPoint, adminUpdatePickupPoint, adminCreateSecureDeliveryPoint, adminListSecureDeliveryPoints, adminUpdateSecureDeliveryPoint, adminUpsertShippingRule, adminDeleteDraftShippingRule,
} from "../services/adminControl.js";
import {
  adminGetLogisticsControl, adminGetLogisticsDraft, adminResetLogisticsDraft, adminUpdateLogisticsDraft, adminActivateLogisticsDraft,
  getAdminPayoutReversalAlerts,
} from "../services/admin.js?v=20260922-mega-a-v1";
import {
  DELIVERY_STATUS_FR, DELIVERY_STATUS_TONE, DELIVERY_KIND_FR, COMPENSATION_STATUS_FR,
} from "../services/deliveryContract.js";
import { addressLabel } from "../services/addressContract.js";
import { mountDeliveryTimeoutControl } from "./adminDeliveryTimeoutUx.js";

// Résumé pickup/destination — même logique de forme qu'ailleurs (checkout,
// courier, carnet d'adresses), jamais recalculée localement ici. `name`
// sert de repli d'affichage si aucun champ d'adresse structuré n'est présent
// (ex. point identifié seulement par son nom).
const locLine = (l) => {
  const label = addressLabel(l, { fallback: "" });
  if (label) return label;
  const name = l && typeof l === "object" ? String(l.name || l.address || "").trim() : "";
  return name || "—";
};
const yn = (v) => (v === true ? '<span class="badge green">✓</span>' : v === false ? '<span class="badge amber">✗</span>' : "—");
const PROD_PHRASE = "ACTIVER PRODUCTION";
// financial_scope (admin_get_delivery_task_cockpit_v1) : relation_role par allocation.
const RELATION_FR = { seller: "Vendeur", source_supplier: "Fournisseur" };

// ---------------------------------------------------------------------------
// MISSIONS
// ---------------------------------------------------------------------------
const ADMIN_ACTION_FR = {
  assign: "Assigner à un livreur", reassign: "Réassigner", reopen_issue: "Résoudre l'incident…",
  override_delivery: "Forcer la livraison…", confirm_hub_receipt: "Confirmer la réception au hub",
};

export async function renderMissions(body, { env }) {
  const state = { status: "", tasks: [], cockpit: null };

  const draw = async () => {
    body.innerHTML = `<div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Missions de livraison</h3>
      <p class="muted" style="margin:2px 0 0">Supervision, assignation, incidents. ${envPill(env)}</p></div>
      <div class="toolbar-group"><select class="input" data-f-status><option value="">Toutes les missions</option>${TASK_FILTERABLE_STATUSES.map((s) => `<option value="${esc(s)}" ${s === state.status ? "selected" : ""}>${esc(DELIVERY_STATUS_FR[s] || s)}</option>`).join("")}</select>
      <button class="btn btn-outline-blue btn-sm" type="button" data-publish>Publier les missions prêtes…</button>
      <button class="btn btn-ghost btn-sm" type="button" data-refresh>Actualiser</button></div></div>
      <div data-kpis></div><div data-list><div class="loading-state">Chargement des missions…</div></div></div>
      <div class="portal-card" data-timeout-control></div>`;
    body.querySelector("[data-f-status]").addEventListener("change", (e) => { state.status = e.target.value; load(); });
    body.querySelector("[data-refresh]").addEventListener("click", draw);
    body.querySelector("[data-publish]").addEventListener("click", publishReady);
    mountDeliveryTimeoutControl(body.querySelector("[data-timeout-control]"), { env, onAfterRun: () => load(true) });
    await load(true);
  };

  const load = async (withKpis = false) => {
    const listEl = body.querySelector("[data-list]");
    listEl.innerHTML = `<div class="loading-state">Chargement des missions…</div>`;
    try {
      // Bloc 8 / parity v10 : cockpit unique = settings + summary + rows + capabilities.
      // Rémunération et confirmation hub sont désormais également exposées par ce contrat.
      const [cockpit, reversalAlerts] = await Promise.all([
        adminGetLogisticsCockpit({ status: state.status || null, limit: 100 }),
        getAdminPayoutReversalAlerts({ limit: 200 }).catch(() => []),
      ]);
      state.cockpit = cockpit; state.tasks = cockpit.rows || [];
      // Bloc 2 : merchant_order_id du VENDEUR (seul exposé par le cockpit) signalé s'il porte
      // le marqueur reversal_required. Un fournisseur flaggé sur SA propre allocation n'est pas
      // visible ici : cette liste ne couvre que le vendeur.
      // Environnement dérivé côté serveur par admin_list_payout_reversal_alerts_v1 —
      // jamais un paramètre client (voir js/services/admin.js).
      state.reversalMoIds = new Set(reversalAlerts.map((r) => String(r.id)));
    } catch (e) { listEl.innerHTML = errorBox(adminErrorFr(e, "Impossible de charger les missions."), "data-retry"); listEl.querySelector("[data-retry]")?.addEventListener("click", () => load(true)); return; }

    const counts = state.cockpit?.summary?.statuses || {};
    const kpiOrder = ["ready_waiting_dispatch", "awaiting_assignment", "assigned", "accepted", "in_transit", "issue", "delivered"];
    body.querySelector("[data-kpis]").innerHTML = `<div class="cc-kpis">${kpiOrder.map((s) => `<div class="cc-kpi"><span class="cc-kpi-n ${s === "issue" && counts[s] > 0 ? "cc-kpi-alert" : ""}">${esc(counts[s] ?? 0)}</span><span class="muted">${esc(DELIVERY_STATUS_FR[s])}</span></div>`).join("")}</div>`;

    const s = state.cockpit?.settings || {};
    const compensationEnabled = !!s.courier_compensation_enabled;
    const dispatchOk = s.logistics_enabled && s.dispatch_enabled && s.courier_operations_enabled;
    const modeOk = ["admin", "hybrid"].includes(s.assignment_mode);
    const notes = [];
    if (!dispatchOk) notes.push("Le dispatch n'est pas actif (logistique, dispatch et opérations livreur requis) : les missions prêtes restent « en attente de publication ».");
    if (!modeOk) notes.push(`Le mode d'assignation est « ${s.assignment_mode || "—"} » : l'assignation manuelle par l'admin exige « admin » ou « hybride ».`);
    const noteHtml = notes.length ? `<div class="error-state" style="margin:8px 0">${notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "";

    if (!state.tasks.length) { listEl.innerHTML = noteHtml + emptyBox("Aucune mission", state.status ? "Aucune mission avec ce statut." : "Aucune mission de livraison dans cet environnement."); return; }
    listEl.innerHTML = noteHtml + `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Mission</th><th>État</th><th>Retrait</th><th>Destination</th><th>Livreur</th><th>Rémunération</th><th>Mis à jour</th><th></th></tr></thead><tbody>
      ${state.tasks.map((t) => {
        // Capabilities server-driven (Bloc 8) : jamais dérivées de t.status localement.
        const caps = t.capabilities || {};
        const canAssign = !!caps.assignment?.can_assign;
        const isReassign = t.status === "assigned";
        const canResolveIncident = !!caps.incident?.can_resolve;
        const canOverride = !!caps.proof?.can_admin_override_delivery;
        const canHubReceipt = !!caps.completion?.can_confirm_hub_receipt;
        const acts = [
          canAssign ? { action: isReassign ? "reassign" : "assign", label: isReassign ? "Réassigner" : "Assigner à un livreur" } : null,
          canResolveIncident ? { action: "reopen_issue", label: "Résoudre l'incident…" } : null,
          canOverride ? { action: "override_delivery", label: "Forcer la livraison…" } : null,
          canHubReceipt ? { action: "confirm_hub_receipt", label: "Confirmer la réception au hub" } : null,
        ].filter(Boolean);
        const reversalFlag = state.reversalMoIds?.has(String(t.merchant_order_id)) ? ' <span class="badge red" title="Versement déjà payé, régularisation requise">⚠ Reversal</span>' : "";
        return `<tr><td><strong>${esc(t.merchant_shop_name || "—")}</strong>${reversalFlag}<div class="muted">${esc(DELIVERY_KIND_FR[t.delivery_kind] || t.delivery_kind || "")} · ${esc(String(t.delivery_task_id || "").slice(0, 8))}</div></td>
          <td>${chip(DELIVERY_STATUS_FR[t.status] || t.status, DELIVERY_STATUS_TONE[t.status] || "")}</td>
          <td>${yn(t.source_location_ready)} <span class="muted">${esc(locLine(t.source_location))}</span></td>
          <td>${yn(t.destination_location_ready)} <span class="muted">${esc(locLine(t.destination_location))}</span></td>
          <td>${t.courier_name ? esc(t.courier_name) : '<span class="muted">—</span>'}</td>
          <td>${t.compensation_htg != null ? esc(t.compensation_htg) + " HTG" : "—"} <span class="muted">${esc(COMPENSATION_STATUS_FR[t.compensation_status] || "")}</span></td>
          <td>${esc(fmtDateTime(t.updated_at))}</td>
          <td class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" data-detail="${esc(t.delivery_task_id)}">Détail</button>${acts.map((a) => `<button class="btn btn-outline-blue btn-sm" type="button" data-act="${esc(a.action)}" data-task="${esc(t.delivery_task_id)}">${esc(a.label)}</button>`).join("")}${compensationEnabled ? `<button class="btn btn-ghost btn-sm" type="button" data-comp="${esc(t.delivery_task_id)}">Rémunération</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px">Les actions affichées viennent des capabilities calculées par le cockpit backend pour chaque mission ; le serveur revalide toujours.</p>`;
    listEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.task, b.dataset.act)));
    listEl.querySelectorAll("[data-comp]").forEach((b) => b.addEventListener("click", () => compensation(b.dataset.comp)));
    listEl.querySelectorAll("[data-detail]").forEach((b) => b.addEventListener("click", () => openTaskDetail(b.dataset.detail)));
    refreshIcons();
  };

  const task = (id) => state.tasks.find((t) => t.delivery_task_id === id);

  const publishReady = async () => {
    const ok = await confirmAction({ title: "Publier toutes les missions prêtes ?", env, confirmLabel: "Publier", requireReason: false,
      consequences: ["Toutes les missions « prêtes — en attente de publication » qui satisfont la règle de dispatch du serveur passent en « publiée ».", "Les autres restent en attente (aucune n'est forcée).", "Les livreurs éligibles pourront les voir (mode marketplace) ou vous pourrez les assigner (mode admin)."] });
    if (!ok) return;
    try { const r = await adminPublishReadyDeliveryTasks(); showToast(`${r.published_count ?? 0} mission(s) publiée(s) ✓`); await draw(); }
    catch (e) { showToast(adminErrorFr(e, "Publication refusée."), "red"); }
  };

  const act = async (id, action) => {
    const t = task(id);
    try {
      if (action === "assign" || action === "reassign") return await assign(t);
      if (action === "reopen_issue") {
        const [cands, points] = await Promise.all([
          adminListDeliveryCandidates(id, 50).catch(() => []),
          adminListPickupPoints({ limit: 200 }).then((r) => r.rows || []).catch(() => []),
        ]);
        // Bloc 8 : cockpit.capabilities.incident.available_resolution_types restreint déjà les
        // résolutions réellement permises pour CETTE task (custody/recovery/transfert en cours…).
        // On ne propose jamais une résolution que le backend refuserait de toute façon.
        const RESOLUTION_FR = {
          resume_same_courier: "Reprendre avec le même livreur",
          handover_to_new_courier: "Transférer à un autre livreur",
          return_to_merchant: "Retourner au marchand",
          return_to_hub: "Retourner à un point VinHT / hub",
          cancel_before_pickup: "Annuler avant récupération",
        };
        const available = t?.capabilities?.incident?.available_resolution_types;
        const resolutionTypes = Array.isArray(available) ? available : [];
        if (!resolutionTypes.length) {
          showToast("Aucune résolution n'est actuellement autorisée par le backend pour cette mission.", "red");
          return;
        }
        const f = await formModal({
          title: "Résoudre l'incident logistique",
          env,
          confirmLabel: "Appliquer la résolution",
          danger: true,
          intro: "La résolution est décidée et validée par le backend. Aucun changement de custody, d'assignation ou de retour n'est simulé dans le navigateur.",
          fields: [
            { name: "resolution", label: "Résolution", type: "select", required: true, options: resolutionTypes.map((r) => ({ value: r, label: RESOLUTION_FR[r] || r })) },
            { name: "courier", label: "Nouveau livreur (pour transfert)", type: "select", options: [
              { value: "", label: "— Aucun —" },
              ...cands.map((x) => ({ value: x.courier_profile_id, label: x.full_name || x.courier_profile_id })),
            ] },
            { name: "hub", label: "Point VinHT / hub (pour retour hub)", type: "select", options: [
              { value: "", label: "— Aucun —" },
              ...points.map((x) => ({ value: x.id, label: x.name || x.code || x.id })),
            ] },
            { name: "note", label: "Note de résolution", type: "textarea", required: true },
          ],
          validate: (v) => {
            if (v.resolution === "handover_to_new_courier" && !v.courier) return "Choisissez le nouveau livreur.";
            if (v.resolution === "return_to_hub" && !v.hub) return "Choisissez le point VinHT / hub de retour.";
            return null;
          },
        });
        if (!f) return;
        await adminResolveDeliveryIncident(id, f.values.resolution, {
          targetCourierProfileId: f.values.courier || null,
          targetPickupPointId: f.values.hub || null,
          reasonCode: "admin_incident_resolution",
          note: f.values.note,
        });
      } else if (action === "confirm_hub_receipt") {
        const f = await formModal({ title: "Confirmer la réception au point VinHT", env, confirmLabel: "Confirmer la réception", fields: [{ name: "ref", label: "Référence de réception", required: true }, { name: "note", label: "Note", type: "textarea" }] });
        if (!f) return;
        await adminConfirmDispatchHubReceipt(id, f.values.ref, f.values.note);
      } else if (action === "override_delivery") {
        const f = await formModal({ title: "Forcer la livraison (sans code client)", env, danger: true, confirmLabel: "Forcer la livraison",
          intro: "Action exceptionnelle : la mission passe « livrée » sans preuve du client. Elle est tracée dans l'historique.",
          fields: [{ name: "proof", label: "Référence de preuve (photo, appel, message…)" }, { name: "note", label: "Note obligatoire", type: "textarea", required: true }] });
        if (!f) return;
        const ok = await confirmAction({ title: "Confirmer le forçage de la livraison ?", env, danger: true, confirmLabel: "Je confirme", consequences: ["La commande peut passer « livrée » si toutes ses missions sont terminées.", "Cette action ne peut pas être annulée depuis l'interface."] });
        if (!ok) return;
        await adminConfirmCustomerDeliveryOverride(id, f.values.proof, f.values.note);
      } else return;
      showToast("Action enregistrée ✓"); await draw();
    } catch (e) { showToast(adminErrorFr(e, "Action refusée par le backend."), "red"); }
  };

  const assign = async (t) => {
    let cands;
    try { cands = await adminListDeliveryCandidates(t.delivery_task_id, 30); } catch (e) { showToast(adminErrorFr(e, "Candidats indisponibles."), "red"); return; }
    if (!cands.length) { showToast("Aucun livreur éligible (actif, en ligne, disponible et non en conflit).", "red"); return; }
    const compOn = !!state.cockpit?.settings?.courier_compensation_enabled;
    const f = await formModal({ title: `${t.status === "assigned" ? "Réassigner" : "Assigner"} la mission — ${t.merchant_shop_name || ""}`, env, confirmLabel: "Assigner",
      intro: "Livreurs éligibles, triés par zone, distance puis charge. Le serveur revérifie zone, capacité et conflits d'intérêt.",
      fields: [{ name: "courier", label: "Livreur", type: "select", required: true, options: cands.map((c) => ({ value: c.courier_profile_id, label: `${c.full_name || "Livreur"} — ${c.area_match ? "dans la zone" : "hors zone"} — ${c.active_deliveries}/${c.max_active_deliveries} missions${c.distance_km != null ? ` — ${Number(c.distance_km).toFixed(1)} km` : ""}` })) },
        ...(compOn ? [{ name: "comp", label: "Rémunération (HTG, optionnel)", type: "number", min: 0, step: "1" }] : [])] });
    if (!f) return;
    await adminAssignDelivery(t.delivery_task_id, f.values.courier, compOn ? f.values.comp : null);
    showToast("Mission assignée ✓"); await draw();
  };

  const compensation = async (id) => {
    const t = task(id);
    const f = await formModal({ title: "Rémunération du livreur", env, confirmLabel: "Enregistrer",
      intro: "Enregistrement comptable interne : aucun paiement n'est déclenché par cette action.",
      fields: [{ name: "amount", label: "Montant (HTG)", type: "number", required: true, min: 0, step: "1", value: t.compensation_htg ?? "" },
        { name: "status", label: "Statut", type: "select", value: t.compensation_status === "not_configured" ? "pending" : t.compensation_status, options: ["pending", "approved", "paid", "cancelled"].map((v) => ({ value: v, label: COMPENSATION_STATUS_FR[v] })) },
        { name: "ref", label: "Référence de paiement", help: "Obligatoire si le statut est « Payée »." }] });
    if (!f) return;
    try { await adminSetDeliveryCompensation(id, f.values.amount, f.values.status, f.values.ref); showToast("Rémunération enregistrée ✓"); await draw(); }
    catch (e) { showToast(adminErrorFr(e, "Enregistrement refusé."), "red"); }
  };

  // --- Fiche détail d'une mission (admin_get_delivery_task_cockpit_v1) -----------
  // Vue lecture + actions d'annulation seulement : toute action de progression
  // (assigner, résoudre l'incident, forcer, hub) reste dans la liste via act().
  const openTaskDetail = async (id) => {
    const wrap = document.createElement("div");
    wrap.className = "cc-modal-backdrop";
    wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="ccdt-title" style="max-width:760px;max-height:86vh;overflow:auto">
      <div class="toolbar" style="align-items:flex-start"><h3 id="ccdt-title" style="margin:0">Détail de la mission</h3><button class="btn btn-ghost btn-sm" type="button" data-cc-close aria-label="Fermer">✕</button></div>
      <div data-detail-body><div class="loading-state">Chargement…</div></div>
    </div>`;
    document.body.appendChild(wrap);
    const close = () => { document.removeEventListener("keydown", onKey); wrap.remove(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    wrap.querySelector("[data-cc-close]").addEventListener("click", close);

    const bodyEl = wrap.querySelector("[data-detail-body]");
    let c;
    try { c = await adminGetDeliveryTaskCockpit(id); }
    catch (e) { bodyEl.innerHTML = errorBox(adminErrorFr(e, "Détail de mission indisponible.")); return; }

    const row = (label, value) => `<div class="settings-section" style="padding:6px 0"><div class="muted" style="font-size:11px">${esc(label)}</div><div>${value ?? "—"}</div></div>`;
    const section = (title, html) => `<h4 style="margin:16px 0 6px">${esc(title)}</h4>${html}`;

    // Financial scope : toutes les allocations réellement liées à la mission (vendeur +
    // fournisseurs), jamais réduites à un seul merchant_order — voir §4 du mandat Mega-B.
    const scopeRows = Array.isArray(c.financial_scope) ? c.financial_scope : [];
    const scopeHtml = scopeRows.length
      ? `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Rôle</th><th>Marchand</th><th>Statut</th><th>Versement</th><th>Preuve livraison</th></tr></thead><tbody>${scopeRows.map((r) => `<tr>
          <td>${esc(RELATION_FR[r.relation_role] || r.relation_role || "—")}</td>
          <td>${esc(r.merchant_shop_name || "—")}</td>
          <td>${esc(r.status || "—")}</td>
          <td>${chip(r.payout_status || "—", r.payout_status === "paid" ? "green" : "")} ${r.payout_amount != null ? esc(`${r.currency || "HTG"} ${r.payout_amount}`) : ""}${r.payout_error ? ` <span style="color:#b0122a;font-size:11px">${esc(r.payout_error)}</span>` : ""}</td>
          <td>${r.verified_delivery_at ? `${esc(fmtDateTime(r.verified_delivery_at))} <span class="muted">(${esc(r.verified_delivery_source || "—")})</span>` : '<span class="muted">Non vérifiée</span>'}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">Aucune allocation financière trouvée pour cette mission.</p>`;

    const caps = c.capabilities || {};
    const custody = c.custody || {};
    const holder = custody.holder || {};
    const recovery = custody.recovery || {};
    const incidentResolution = custody.incident_resolution || null;
    const pendingTransfer = custody.pending_transfer || null;
    const canCancelResolution = !!caps.incident?.can_cancel_active_resolution && !!incidentResolution?.id;
    const canCancelTransfer = !!pendingTransfer?.transfer_id;
    const canConfirmHubReturn = recovery.status === "returning" && recovery.destination_type === "hub" && !!recovery.destination_pickup_point_id;
    const events = (list, mapFn) => (Array.isArray(list) && list.length
      ? `<ol style="margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.7">${list.map(mapFn).join("")}</ol>`
      : `<p class="muted" style="font-size:12px">Aucun événement.</p>`);

    bodyEl.innerHTML = `
      ${row("Mission", `${esc(String(c.task?.delivery_task_id || id))} · ${chip(DELIVERY_STATUS_FR[c.task?.status] || c.task?.status, DELIVERY_STATUS_TONE[c.task?.status] || "")}`)}
      ${section("Commande", `
        ${row("Commande", esc(c.order?.order_id || "—"))}
        ${row("Paiement", `${esc(c.order?.payment_method || "—")} · ${esc(c.order?.payment_status || "—")} · ${esc(c.order?.currency || "—")}`)}
        ${row("Merchant order principal (vendeur)", `${esc(c.primary_merchant_order?.merchant_order_id || "—")} — ${esc(c.primary_merchant_order?.status || "—")} — versement ${esc(c.primary_merchant_order?.payout_status || "—")}`)}
        ${row("Marchand vendeur", esc(c.merchant?.shop_name || "—"))}
        ${row("Marchand exécutant", esc(c.fulfillment_merchant?.shop_name || "—"))}
      `)}
      ${section("Livreur & assignation", `
        ${row("Livreur assigné", c.courier ? `${esc(c.courier.full_name || "—")} — ${esc(c.courier.operational_status)}/${esc(c.courier.availability_status)} — charge ${esc(c.courier.active_load ?? "—")}/${esc(c.courier.max_active_deliveries ?? "—")}` : '<span class="muted">Aucun</span>')}
        ${row("Assignation en cours", c.current_assignment ? `${esc(c.current_assignment.assignment_status)} — assignée ${esc(fmtDateTime(c.current_assignment.assigned_at))}` : '<span class="muted">Aucune</span>')}
        ${row("Dispatch readiness", c.dispatch_readiness ? `${c.dispatch_readiness.ready ? chip("Prêt", "green") : chip("Bloqué", "amber")} ${esc(c.dispatch_readiness.reason || "")}` : "—")}
      `)}
      ${section("Custody & incident", `
        ${row("Détenteur actuel (custody)", esc(holder.type || "—"))}
        ${row("Recovery", recovery.status ? `${esc(recovery.status)}${recovery.destination_type ? ` → ${esc(recovery.destination_type)}` : ""}` : "none")}
        ${row("Résolution active", incidentResolution?.id ? `${esc(incidentResolution.resolution_type)} (${esc(incidentResolution.status)})` : '<span class="muted">Aucune</span>')}
        ${row("Transfert en cours", pendingTransfer?.transfer_id ? `${esc(pendingTransfer.status)} → ${esc(String(pendingTransfer.target_courier_profile_id || "").slice(0, 8))}` : '<span class="muted">Aucun</span>')}
        <div class="toolbar-group" style="margin-top:6px">
          ${canCancelResolution ? `<button class="btn btn-outline-red btn-sm" type="button" data-cancel-resolution>Annuler la résolution active</button>` : ""}
          ${canCancelTransfer ? `<button class="btn btn-outline-red btn-sm" type="button" data-cancel-transfer>Annuler le transfert en cours</button>` : ""}
          ${canConfirmHubReturn ? `<button class="btn btn-blue btn-sm" type="button" data-confirm-hub-return>Confirmer la réception au hub</button>` : ""}
        </div>
      `)}
      ${section("Preuve de livraison", caps.proof?.confirmation ? row("État de confirmation", `${esc(caps.proof.confirmation.state || "—")}`) : '<p class="muted">Aucune donnée de confirmation.</p>')}
      ${section(`Portée financière (${scopeRows.length} allocation${scopeRows.length > 1 ? "s" : ""})`, scopeHtml)}
      ${section(`Candidats (${(c.candidates || []).length})`, (c.candidates || []).length ? `<div class="muted" style="font-size:12px">${(c.candidates || []).map((x) => esc(x.full_name || x.courier_profile_id)).join(", ")}</div>` : '<p class="muted">Aucun (hors fenêtre d\'assignation).</p>')}
      ${section(`Preuves (${(c.proofs || []).length})`, events(c.proofs, (p) => `<li>${esc(p.proof_type)} — ${esc(p.proof_reference || "")} ${p.verified_at ? chip("Vérifiée", "green") : chip("Non vérifiée", "amber")} <span class="muted">${esc(fmtDateTime(p.created_at))}</span></li>`))}
      ${section("Historique livraison", events(c.timeline?.delivery_events, (e) => `<li>${esc(e.event_type)} ${e.to_status ? `→ ${esc(DELIVERY_STATUS_FR[e.to_status] || e.to_status)}` : ""} <span class="muted">${esc(fmtDateTime(e.created_at))}</span></li>`))}
      ${section("Historique custody", events(c.timeline?.custody_events, (e) => `<li>${esc(e.event_type)} ${e.to_holder_type ? `→ ${esc(e.to_holder_type)}` : ""} <span class="muted">${esc(fmtDateTime(e.created_at))}</span></li>`))}
    `;

    const reload = async () => { close(); await draw(); };
    wrap.querySelector("[data-cancel-resolution]")?.addEventListener("click", async () => {
      const ok = await confirmAction({ title: "Annuler la résolution active ?", env, requireReason: true, reasonLabel: "Motif", confirmLabel: "Annuler la résolution", danger: true,
        consequences: ["La résolution en cours est abandonnée côté serveur.", "La mission reste en incident : une nouvelle résolution devra être choisie."] });
      if (!ok) return;
      try { await adminCancelDeliveryIncidentResolution(incidentResolution.id, ok.reason); showToast("Résolution annulée ✓"); await reload(); }
      catch (e) { showToast(adminErrorFr(e, "Annulation refusée par le backend."), "red"); }
    });
    wrap.querySelector("[data-cancel-transfer]")?.addEventListener("click", async () => {
      const ok = await confirmAction({ title: "Annuler le transfert de custody en cours ?", env, requireReason: true, reasonLabel: "Motif", confirmLabel: "Annuler le transfert", danger: true,
        consequences: ["Le transfert vers le nouveau livreur est abandonné.", "Le colis reste sous la responsabilité du livreur d'origine."] });
      if (!ok) return;
      try { await adminCancelDeliveryCustodyTransfer(pendingTransfer.transfer_id, ok.reason); showToast("Transfert annulé ✓"); await reload(); }
      catch (e) { showToast(adminErrorFr(e, "Annulation refusée par le backend."), "red"); }
    });
    wrap.querySelector("[data-confirm-hub-return]")?.addEventListener("click", async () => {
      const f = await formModal({ title: "Confirmer la réception au hub", env, confirmLabel: "Confirmer la réception",
        intro: "Cette confirmation ferme le retour physique et termine la recovery.",
        fields: [{ name: "ref", label: "Référence de preuve", required: true }, { name: "note", label: "Note", type: "textarea" }] });
      if (!f) return;
      try { await adminConfirmDeliveryReturnHubReceived(id, recovery.destination_pickup_point_id, f.values.ref, f.values.note); showToast("Réception hub confirmée ✓"); await reload(); }
      catch (e) { showToast(adminErrorFr(e, "Confirmation refusée par le backend."), "red"); }
    });
    wrap.querySelector("[data-cc-close]").focus();
  };

  await draw();
}

// ---------------------------------------------------------------------------
// LOGISTIQUE
// ---------------------------------------------------------------------------
const SETTING_GROUPS = [
  { title: "Général", items: [
    { k: "logistics_enabled", t: "bool", label: "Logistique activée", help: "Interrupteur général : sans lui, aucune méthode de livraison n'est proposée." },
    { k: "public_message_fr", t: "text", label: "Message public", help: "Affiché aux clients quand la livraison est limitée ou indisponible." },
  ] },
  { title: "Méthodes de livraison", items: [
    { k: "home_delivery_enabled", t: "bool", label: "Livraison à domicile" },
    { k: "pickup_points_enabled", t: "bool", label: "Points de retrait VinHT", help: "Exige au moins un point actif avec horaires." },
    { k: "secure_meeting_enabled", t: "bool", label: "Rencontres sécurisées" },
    { k: "shipping_pricing_mode", t: "select", label: "Tarification de la livraison", options: [["not_configured", "Non configurée"], ["free", "Gratuite"], ["rules", "Selon les règles tarifaires"]], help: "« Selon les règles » utilise les tarifs de la section Tarifs de livraison." },
    { k: "require_delivery_zone_for_home", t: "bool", label: "Zone obligatoire pour la livraison à domicile" },
  ] },
  { title: "Livreurs", items: [
    { k: "courier_applications_enabled", t: "bool", label: "Candidatures livreur ouvertes" },
    { k: "courier_operations_enabled", t: "bool", label: "Opérations livreur", help: "Passage en ligne et actions des livreurs." },
    { k: "courier_service_area_required", t: "bool", label: "Zone de service obligatoire", help: "Un livreur sans zone ne reçoit aucune mission." },
    { k: "courier_location_tracking_enabled", t: "bool", label: "Suivi GPS des livreurs" },
    { k: "courier_marketplace_enabled", t: "bool", label: "Marketplace de missions", help: "Les livreurs éligibles voient et prennent les missions." },
    { k: "assignment_mode", t: "select", label: "Mode d'assignation", options: [["admin", "Admin (manuel)"], ["marketplace", "Marketplace (libre-service)"], ["hybrid", "Hybride"]] },
  ] },
  { title: "Dispatch & délais", items: [
    { k: "dispatch_enabled", t: "bool", label: "Dispatch activé", help: "Nécessaire pour publier et attribuer des missions." },
    { k: "mission_accept_timeout_minutes", t: "num", label: "Délai d'acceptation d'une mission (minutes)", min: 1, max: 240 },
    { k: "stalled_delivery_minutes", t: "num", label: "Délai avant livraison considérée bloquée (minutes)", min: 5, max: 1440 },
  ] },
  { title: "Confirmations & sécurité", items: [
    { k: "merchant_handoff_confirmation_required", t: "bool", label: "Remise confirmée par le marchand" },
    { k: "customer_delivery_confirmation_required", t: "bool", label: "Livraison confirmée par le client (code)" },
    { k: "customer_presence_signals_enabled", t: "bool", label: "Signaux de présence client", help: "« En route / arrivé / lieu non sûr »." },
    { k: "allow_inflight_completion_when_paused", t: "bool", label: "Terminer les livraisons en cours si la logistique est en pause" },
  ] },
  { title: "Rémunération livreur", items: [
    { k: "courier_compensation_enabled", t: "bool", label: "Rémunération activée" },
    { k: "courier_compensation_mode", t: "select", label: "Mode de rémunération", options: [["not_configured", "Non configuré"], ["manual", "Manuel"]] },
  ] },
];
const ALL_SETTING_ITEMS = SETTING_GROUPS.flatMap((g) => g.items);
const fmtVal = (item, v) => {
  if (v === undefined || v === null || v === "") return "—";
  if (item.t === "bool") return v ? "ON" : "OFF";
  if (item.t === "select") return (item.options.find((o) => o[0] === v) || [v, v])[1];
  return String(v);
};

export async function renderLogistics(body, { env }) {
  const isProd = env === "production";
  const ctx = { runtime: null, draft: null, zones: [], points: [], securePoints: [] };

  body.innerHTML = `
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Configuration logistique</h3>
      <p class="muted" style="margin:2px 0 0">Circuit officiel : brouillon → contrôle → activation (motif obligatoire, audit). ${envPill(env)}</p></div></div><div data-config><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Tarifs de livraison (brouillon)</h3>
      <p class="muted" style="margin:2px 0 0">S'appliquent seulement après activation du brouillon, si la tarification est « selon les règles ».</p></div>
      <button class="btn btn-outline-blue btn-sm" type="button" data-add-rule>Ajouter une règle</button></div><div data-rules></div></div>
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Zones de service</h3><p class="muted" style="margin:2px 0 0">Communes/zones desservies pour la livraison à domicile et les rencontres.</p></div>
      <button class="btn btn-outline-blue btn-sm" type="button" data-add-zone>Ajouter une zone</button></div><div data-zones><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Points VinHT (retrait)</h3></div>
      <button class="btn btn-outline-blue btn-sm" type="button" data-add-point>Ajouter un point</button></div><div data-points><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Points de rencontre sécurisés</h3><p class="muted" style="margin:2px 0 0">Liste Admin autoritaire, isolée par environnement.</p></div>
      <button class="btn btn-outline-blue btn-sm" type="button" data-add-secure>Ajouter un point</button></div>
      <div data-secure><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Simulation de tarif (sur le brouillon)</h3><div data-sim></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Versions & retour arrière</h3><div data-versions><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Journal d'audit logistique</h3><div data-audit><div class="loading-state">Chargement…</div></div></div>`;

  // ---- Configuration (runtime vs brouillon) ----
  const cfgEl = body.querySelector("[data-config]");
  const drawConfig = () => {
    const rt = ctx.runtime || {}; const ds = ctx.draft?.settings || {}; const pf = ctx.draft?.preflight || {};
    const changedVsRuntime = ALL_SETTING_ITEMS.filter((i) => (rt[i.k] ?? null) !== (ds[i.k] ?? null));
    const ready = pf.ready === true;
    const list = (rows, cls, label) => (Array.isArray(rows) && rows.length ? rows.map((r) => `<div class="settings-section"><div><strong>${esc(r.code || "Contrôle")}</strong><p>${esc(r.message_fr || r.message || "")}</p></div>${chip(label, cls)}</div>`).join("") : "");
    cfgEl.innerHTML = `
      <p class="muted">Version active : <strong>${esc(rt.active_version ?? "—")}</strong> · Révision du brouillon : <strong>${esc(ctx.draft?.draft_revision ?? "—")}</strong> · ${changedVsRuntime.length ? `<strong>${changedVsRuntime.length} différence(s)</strong> avec le runtime` : "brouillon identique au runtime"}</p>
      ${SETTING_GROUPS.map((g) => `<h4 style="margin:14px 0 4px">${esc(g.title)}</h4>${g.items.map((it) => {
        const dv = ds[it.k]; const rv = rt[it.k]; const changed = (rv ?? null) !== (dv ?? null);
        let input = "";
        if (it.t === "bool") input = `<label class="switch" aria-labelledby="setting_label_${esc(it.k)}"><input type="checkbox" data-k="${esc(it.k)}" aria-labelledby="setting_label_${esc(it.k)}" ${dv ? "checked" : ""}><span></span></label>`;
        else if (it.t === "select") input = `<select class="input" data-k="${esc(it.k)}" aria-labelledby="setting_label_${esc(it.k)}">${it.options.map((o) => `<option value="${esc(o[0])}" ${o[0] === dv ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
        else if (it.t === "num") input = `<input class="input" type="number" data-k="${esc(it.k)}" aria-labelledby="setting_label_${esc(it.k)}" min="${it.min}" max="${it.max}" value="${esc(dv ?? "")}" style="max-width:110px">`;
        else input = `<input class="input" type="text" data-k="${esc(it.k)}" aria-labelledby="setting_label_${esc(it.k)}" maxlength="240" value="${esc(dv ?? "")}">`;
        return `<div class="settings-section"><div><strong id="setting_label_${esc(it.k)}">${esc(it.label)}</strong>${it.help ? `<p>${esc(it.help)}</p>` : ""}<p class="muted">Runtime actuel : <strong>${esc(fmtVal(it, rv))}</strong>${changed ? ` ${chip("Brouillon différent", "amber")}` : ""}</p></div>${input}</div>`;
      }).join("")}`).join("")}
      <div class="${ready ? "green-note" : "error-state"}" style="margin:14px 0"><strong>Contrôle (preflight) : ${ready ? "PRÊT" : "BLOQUÉ"}</strong>
        ${list(pf.errors, "red", "Bloquant")}${list(pf.warnings, "amber", "Attention")}</div>
      <div class="toolbar-group">
        <button class="btn btn-blue" type="button" data-save-draft>Enregistrer le brouillon…</button>
        <button class="btn btn-ghost" type="button" data-reset-draft>Aligner le brouillon sur le runtime…</button>
        <button class="btn ${isProd ? "btn-outline-red" : "btn-outline-blue"}" type="button" data-activate ${ready && changedVsRuntime.length ? "" : "disabled"}>Activer le brouillon${isProd ? " en Production" : ""}…</button>
      </div>
      ${!ready ? `<p class="muted" style="font-size:12px">Activation impossible tant que le contrôle est bloqué.</p>` : !changedVsRuntime.length ? `<p class="muted" style="font-size:12px">Rien à activer : le brouillon est identique au runtime.</p>` : ""}`;

    const readDraftPatch = () => {
      const patch = {};
      cfgEl.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k; const it = ALL_SETTING_ITEMS.find((x) => x.k === k);
        let v = it.t === "bool" ? el.checked : it.t === "num" ? (el.value === "" ? null : Number(el.value)) : el.value.trim();
        if (it.t === "text" && v === "") v = null;
        if ((ds[k] ?? null) !== v) patch[k] = v;
      });
      return patch;
    };
    cfgEl.querySelector("[data-save-draft]").addEventListener("click", async () => {
      const patch = readDraftPatch();
      if (!Object.keys(patch).length) { showToast("Aucun changement à enregistrer."); return; }
      const ok = await confirmAction({ title: "Enregistrer le brouillon logistique ?", env, requireReason: true, confirmLabel: "Enregistrer",
        consequences: ["Le brouillon n'est PAS actif : rien ne change pour les clients ni les livreurs avant l'activation.", ...Object.keys(patch).map((k) => { const it = ALL_SETTING_ITEMS.find((x) => x.k === k); return `${it.label} : ${fmtVal(it, ds[k])} → ${fmtVal(it, patch[k])}`; })] });
      if (!ok) return;
      try { ctx.draft = await adminUpdateLogisticsDraft(patch, ok.reason); showToast("Brouillon enregistré ✓"); drawConfig(); loadRules(); }
      catch (e) { showToast(adminErrorFr(e, "Brouillon refusé par le backend."), "red"); }
    });
    cfgEl.querySelector("[data-reset-draft]").addEventListener("click", async () => {
      const ok = await confirmAction({ title: "Aligner le brouillon sur le runtime ?", env, requireReason: true, confirmLabel: "Réinitialiser", consequences: ["Les modifications non activées du brouillon sont perdues."] });
      if (!ok) return;
      try { await adminResetLogisticsDraft(ok.reason); await loadConfig(); showToast("Brouillon réinitialisé ✓"); }
      catch (e) { showToast(adminErrorFr(e, "Réinitialisation refusée."), "red"); }
    });
    cfgEl.querySelector("[data-activate]").addEventListener("click", async () => {
      if (readDraftPatch() && Object.keys(readDraftPatch()).length) { showToast("Enregistrez d'abord vos modifications du brouillon.", "red"); return; }
      const cons = changedVsRuntime.map((it) => `${it.label} : ${fmtVal(it, rt[it.k])} → ${fmtVal(it, ds[it.k])}`);
      const ok = await confirmAction({ title: `Activer la configuration logistique${isProd ? " en PRODUCTION" : ""} ?`, env, requireReason: true, confirmLabel: "Activer", danger: isProd, phrase: isProd ? PROD_PHRASE : null,
        consequences: [isProd ? "Effet immédiat sur les clients, marchands et livreurs réels." : "Effet immédiat en environnement Demo.", "Une nouvelle version de configuration est créée (retour arrière possible).", ...cons] });
      if (!ok) return;
      try { await adminActivateLogisticsDraft(ok.reason); showToast("Configuration activée ✓"); await Promise.all([loadConfig(), loadVersions(), loadAudit()]); }
      catch (e) { showToast(adminErrorFr(e, "Activation refusée."), "red"); }
    });
  };
  const loadConfig = async () => {
    cfgEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    try { const [rt, dr] = await Promise.all([adminGetLogisticsControl(), adminGetLogisticsDraft()]); ctx.runtime = rt; ctx.draft = dr; drawConfig(); loadRules(); }
    catch (e) { cfgEl.innerHTML = errorBox(adminErrorFr(e, "Configuration logistique indisponible."), "data-retry"); cfgEl.querySelector("[data-retry]")?.addEventListener("click", loadConfig); }
  };

  // ---- Règles tarifaires ----
  const rulesEl = body.querySelector("[data-rules]");
  const METHOD_FR = { home: "Domicile", pickup_point: "Point VinHT", secure_meeting: "Rencontre sécurisée" };
  const PRICING_FR = { free: "Gratuit", fixed: "Forfait", distance_from_zone_center: "Distance depuis le centre de la zone" };
  const loadRules = () => {
    const rules = ctx.draft?.shipping_rules || [];
    if (!rules.length) { rulesEl.innerHTML = emptyBox("Aucune règle", "Sans règle, la tarification « selon les règles » ne pourra pas s'appliquer."); return; }
    rulesEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Règle</th><th>Méthode</th><th>Tarification</th><th>Montants (HTG)</th><th>Priorité</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(METHOD_FR[r.delivery_method] || r.delivery_method)}</td><td>${esc(PRICING_FR[r.pricing_type] || r.pricing_type)}</td>
      <td>base ${esc(r.base_fee_htg)}${Number(r.per_km_htg) ? ` · ${esc(r.per_km_htg)}/km (dès ${esc(r.included_km)} km)` : ""}${r.min_fee_htg != null ? ` · min ${esc(r.min_fee_htg)}` : ""}${r.max_fee_htg != null ? ` · max ${esc(r.max_fee_htg)}` : ""}</td><td>${esc(r.priority)}</td>
      <td class="toolbar-group"><button class="btn btn-outline-blue btn-sm" type="button" data-edit-rule="${esc(r.id)}">Modifier</button><button class="btn btn-outline-red btn-sm" type="button" data-del-rule="${esc(r.id)}">Supprimer</button></td></tr>`).join("")}</tbody></table></div>`;
    rulesEl.querySelectorAll("[data-edit-rule]").forEach((b) => b.addEventListener("click", () => ruleForm(rules.find((r) => r.id === b.dataset.editRule))));
    rulesEl.querySelectorAll("[data-del-rule]").forEach((b) => b.addEventListener("click", async () => {
      const ok = await confirmAction({ title: "Supprimer cette règle brouillon ?", env, danger: true, confirmLabel: "Supprimer", consequences: ["Seule la règle brouillon est supprimée ; la règle active n'est pas touchée avant activation."] });
      if (!ok) return;
      try { await adminDeleteDraftShippingRule(b.dataset.delRule); showToast("Règle supprimée ✓"); await loadConfig(); } catch (e) { showToast(adminErrorFr(e, "Suppression refusée."), "red"); }
    }));
  };
  const ruleForm = async (r = null) => {
    if (!ctx.zones.length && !ctx.zonesLoaded) await loadZones(true);
    const f = await formModal({ title: r ? "Modifier la règle tarifaire" : "Nouvelle règle tarifaire", env, confirmLabel: "Enregistrer",
      intro: "Règle de brouillon : active seulement après activation de la configuration.",
      fields: [
        { name: "name", label: "Nom", required: true, value: r?.name },
        { name: "method", label: "Méthode de livraison", type: "select", value: r?.delivery_method || "home", options: Object.entries(METHOD_FR).map(([v, l]) => ({ value: v, label: l })) },
        { name: "pricing", label: "Tarification", type: "select", value: r?.pricing_type || "fixed", options: Object.entries(PRICING_FR).map(([v, l]) => ({ value: v, label: l })) },
        { name: "zone", label: "Zone (obligatoire pour « distance depuis le centre de la zone »)", type: "select", value: r?.zone_id || "", options: [{ value: "", label: "— Aucune —" }, ...ctx.zones.map((z) => ({ value: z.id, label: `${z.name} (${z.code})` }))] },
        { name: "base", label: "Frais de base (HTG)", type: "number", min: 0, step: "1", value: r?.base_fee_htg ?? 0 },
        { name: "perKm", label: "Frais par km (HTG)", type: "number", min: 0, step: "1", value: r?.per_km_htg ?? 0 },
        { name: "incKm", label: "Km inclus", type: "number", min: 0, step: "0.1", value: r?.included_km ?? 0 },
        { name: "min", label: "Tarif minimum (HTG)", type: "number", min: 0, step: "1", value: r?.min_fee_htg ?? "" },
        { name: "max", label: "Tarif maximum (HTG)", type: "number", min: 0, step: "1", value: r?.max_fee_htg ?? "" },
        { name: "prio", label: "Priorité (1 à 1000)", type: "number", min: 1, max: 1000, step: "1", value: r?.priority ?? 100 },
      ],
      validate: (v) => (v.pricing === "distance_from_zone_center" && !v.zone ? "Choisissez une zone pour ce type de tarification." : v.method === "pickup_point" && v.zone ? "Une règle « point VinHT » ne peut pas cibler une zone." : null) });
    if (!f) return;
    const v = f.values;
    try { await adminUpsertShippingRule({ ruleId: r?.id, name: v.name, deliveryMethod: v.method, pricingType: v.pricing, zoneId: v.zone || null, baseFeeHtg: v.base ?? 0, perKmHtg: v.perKm ?? 0, includedKm: v.incKm ?? 0, minFeeHtg: v.min, maxFeeHtg: v.max, priority: v.prio ?? 100 }); showToast("Règle enregistrée ✓"); await loadConfig(); }
    catch (e) { showToast(adminErrorFr(e, "Règle refusée par le backend."), "red"); }
  };
  body.querySelector("[data-add-rule]").addEventListener("click", () => ruleForm());

  // ---- Zones ----
  const zonesEl = body.querySelector("[data-zones]");
  const ZKIND_FR = { service: "Service", restricted: "Restreinte", meeting_only: "Rencontres seulement" };
  const ZSAFE_FR = { standard: "Standard", caution: "Prudence", suspended: "Suspendue" };
  const ZSTATUS_FR = { draft: "Brouillon", active: "Active", paused: "En pause", closed: "Fermée" };
  const ZSTATUS_TONE = { active: "green", paused: "amber", closed: "red", draft: "" };
  const loadZones = async (silent = false) => {
    if (!silent) zonesEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    try { const r = await adminListDeliveryZones({ limit: 200 }); ctx.zones = r.rows; ctx.zonesLoaded = true; }
    catch (e) { if (!silent) zonesEl.innerHTML = errorBox(adminErrorFr(e, "Zones indisponibles."), "data-retry"); zonesEl.querySelector("[data-retry]")?.addEventListener("click", () => loadZones()); return; }
    if (silent) return;
    if (!ctx.zones.length) { zonesEl.innerHTML = emptyBox("Aucune zone", "Créez au moins une zone pour proposer la livraison à domicile."); return; }
    zonesEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Zone</th><th>Localisation</th><th>Type</th><th>Sécurité</th><th>Statut</th><th>Règles</th><th></th></tr></thead><tbody>${ctx.zones.map((z) => `<tr><td><strong>${esc(z.name)}</strong><div class="muted">${esc(z.code)}</div></td><td>${esc([z.commune, z.department].filter(Boolean).join(", ") || "—")}${z.location?.radius_km ? ` · rayon ${esc(z.location.radius_km)} km` : ""}</td><td>${esc(ZKIND_FR[z.zone_kind] || z.zone_kind)}${z.accepts_home_delivery ? " · domicile" : ""}${z.accepts_secure_meeting ? " · rencontre" : ""}</td><td>${esc(ZSAFE_FR[z.safety_state] || z.safety_state)}</td><td>${chip(ZSTATUS_FR[z.status] || z.status, ZSTATUS_TONE[z.status] || "")}</td><td>${esc(z.shipping_rule_count ?? 0)}</td><td><button class="btn btn-outline-blue btn-sm" type="button" data-edit-zone="${esc(z.id)}">Modifier</button></td></tr>`).join("")}</tbody></table></div>`;
    zonesEl.querySelectorAll("[data-edit-zone]").forEach((b) => b.addEventListener("click", () => zoneForm(ctx.zones.find((z) => z.id === b.dataset.editZone))));
  };
  const zoneForm = async (z = null) => {
    const f = await formModal({ title: z ? `Modifier la zone ${z.code}` : "Nouvelle zone de service", env, confirmLabel: "Enregistrer", danger: isProd && !!z,
      intro: isProd ? "Production : une zone active modifie immédiatement la disponibilité de la livraison pour les clients." : "",
      fields: [
        ...(z ? [] : [{ name: "code", label: "Code (unique)", required: true, placeholder: "PV-CENTRE" }]),
        { name: "name", label: "Nom", required: true, value: z?.name },
        { name: "department", label: "Département", value: z?.department },
        { name: "commune", label: "Commune", value: z?.commune },
        { name: "kind", label: "Type de zone", type: "select", value: z?.zone_kind || "service", options: Object.entries(ZKIND_FR).map(([v, l]) => ({ value: v, label: l })) },
        ...(z ? [{ name: "status", label: "Statut", type: "select", value: z.status, options: Object.entries(ZSTATUS_FR).map(([v, l]) => ({ value: v, label: l })) }] : []),
        { name: "home", label: "Accepte la livraison à domicile", type: "checkbox", value: z ? z.accepts_home_delivery : true },
        { name: "meet", label: "Accepte les rencontres sécurisées", type: "checkbox", value: z?.accepts_secure_meeting },
        { name: "safety", label: "État de sécurité", type: "select", value: z?.safety_state || "standard", options: Object.entries(ZSAFE_FR).map(([v, l]) => ({ value: v, label: l })) },
        { name: "msg", label: "Message public (optionnel)", type: "textarea", value: z?.public_message_fr },
        { name: "lat", label: "Latitude centre", type: "number", step: "any", value: z?.location?.latitude ?? "" },
        { name: "lng", label: "Longitude centre", type: "number", step: "any", value: z?.location?.longitude ?? "" },
        { name: "rad", label: "Rayon (km)", type: "number", step: "any", min: 0, max: 500, value: z?.location?.radius_km ?? "" },
        { name: "prio", label: "Priorité d'affichage (1 à 10000)", type: "number", min: 1, max: 10000, value: z?.sort_priority ?? 100 },
      ],
      validate: (v) => { const n = [v.lat, v.lng, v.rad].filter((x) => x !== null).length; return n !== 0 && n !== 3 ? "Latitude, longitude et rayon vont ensemble : renseignez les trois ou aucun." : null; } });
    if (!f) return;
    const v = f.values;
    const payload = { code: v.code, name: v.name, department: v.department, commune: v.commune, zoneKind: v.kind, status: v.status, acceptsHomeDelivery: v.home, acceptsSecureMeeting: v.meet, safetyState: v.safety, publicMessageFr: v.msg, centerLatitude: v.lat, centerLongitude: v.lng, radiusKm: v.rad, sortPriority: v.prio ?? 100 };
    try { if (z) await adminUpdateDeliveryZone(z.id, payload); else await adminCreateDeliveryZone(payload); showToast("Zone enregistrée ✓"); loadZones(); }
    catch (e) { showToast(adminErrorFr(e, "Zone refusée par le backend."), "red"); }
  };
  body.querySelector("[data-add-zone]").addEventListener("click", () => zoneForm());

  // ---- Points VinHT ----
  const pointsEl = body.querySelector("[data-points]");
  const loadPoints = async () => {
    pointsEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    try { const r = await adminListPickupPoints({ limit: 200 }); ctx.points = r.rows; }
    catch (e) { pointsEl.innerHTML = errorBox(adminErrorFr(e, "Points VinHT indisponibles."), "data-retry"); pointsEl.querySelector("[data-retry]")?.addEventListener("click", loadPoints); return; }
    if (!ctx.points.length) { pointsEl.innerHTML = emptyBox("Aucun point VinHT", "Créez un point de retrait, puis renseignez ses horaires avant de l'activer."); return; }
    pointsEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Point</th><th>Adresse</th><th>Statut</th><th>Charge</th><th>Ouvert</th><th></th></tr></thead><tbody>${ctx.points.map((p) => `<tr><td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.code)}</div></td><td>${esc([p.address?.address_line1, p.address?.commune, p.address?.department].filter(Boolean).join(", "))}</td><td>${chip(ZSTATUS_FR[p.status] || p.status, ZSTATUS_TONE[p.status] || "")} ${p.accepts_new_pickups ? chip("Accepte les colis", "green") : chip("Colis suspendus", "amber")}</td><td>${esc(p.active_load ?? 0)}${p.capacity_limit ? ` / ${esc(p.capacity_limit)}` : ""}</td><td>${p.is_open_now ? chip("Ouvert", "green") : chip("Fermé", "")}</td><td class="toolbar-group"><button class="btn btn-outline-blue btn-sm" type="button" data-pt-edit="${esc(p.id)}">Modifier</button><button class="btn btn-ghost btn-sm" type="button" data-pt-state="${esc(p.id)}">État…</button></td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:12px">Horaires d'ouverture : l'édition n'est pas encore disponible dans cette interface (RPC admin_replace_pickup_point_hours_v1 présente, format des horaires à définir).</p>`;
    pointsEl.querySelectorAll("[data-pt-edit]").forEach((b) => b.addEventListener("click", () => pointForm(ctx.points.find((p) => p.id === b.dataset.ptEdit))));
    pointsEl.querySelectorAll("[data-pt-state]").forEach((b) => b.addEventListener("click", () => pointState(ctx.points.find((p) => p.id === b.dataset.ptState))));
  };
  const pointForm = async (p = null) => {
    const f = await formModal({ title: p ? `Modifier ${p.code}` : "Nouveau point VinHT", env, confirmLabel: "Enregistrer",
      fields: [
        ...(p ? [] : [{ name: "code", label: "Code (A–Z, 0–9, _ -, 3 à 32 car.)", required: true, placeholder: "PV-CENTRE" }]),
        { name: "name", label: "Nom", required: true, value: p?.name },
        { name: "addr1", label: "Adresse", required: true, value: p?.address?.address_line1 },
        { name: "addr2", label: "Complément d'adresse", value: p?.address?.address_line2 },
        { name: "department", label: "Département", required: true, value: p?.address?.department },
        { name: "commune", label: "Commune", required: true, value: p?.address?.commune },
        { name: "phone", label: "Téléphone", value: p?.phone },
        { name: "instr", label: "Instructions client", type: "textarea", value: p?.customer_instructions },
        ...(p ? [{ name: "opmsg", label: "Message opérationnel", type: "textarea", value: p?.operational_message }] : []),
        { name: "cap", label: "Capacité maximale (colis)", type: "number", min: 1, value: p?.capacity_limit ?? "" },
        { name: "hold", label: "Jours de conservation (1 à 30)", type: "number", min: 1, max: 30, value: p?.hold_days ?? 7 },
        { name: "lat", label: "Latitude", type: "number", step: "any", value: p?.location?.latitude ?? "" },
        { name: "lng", label: "Longitude", type: "number", step: "any", value: p?.location?.longitude ?? "" },
      ],
      validate: (v) => ((v.lat === null) !== (v.lng === null) ? "Latitude et longitude vont ensemble." : null) });
    if (!f) return;
    const v = f.values;
    const payload = { code: v.code, name: v.name, addressLine1: v.addr1, addressLine2: v.addr2, department: v.department, commune: v.commune, phone: v.phone, customerInstructions: v.instr, operationalMessage: v.opmsg, capacityLimit: v.cap, holdDays: v.hold ?? 7, latitude: v.lat, longitude: v.lng, sortPriority: p?.sort_priority ?? 100 };
    try { if (p) await adminUpdatePickupPoint(p.id, payload); else await adminCreatePickupPoint(payload); showToast("Point enregistré ✓"); loadPoints(); }
    catch (e) { showToast(adminErrorFr(e, "Point refusé par le backend."), "red"); }
  };
  const pointState = async (p) => {
    const f = await formModal({ title: `État de ${p.name}`, env, confirmLabel: "Enregistrer", danger: isProd,
      intro: "Un point ne peut accepter de nouveaux colis que s'il a des horaires d'ouverture (contrôle serveur).",
      fields: [{ name: "status", label: "Statut", type: "select", value: p.status, options: Object.entries(ZSTATUS_FR).map(([v, l]) => ({ value: v, label: l })) },
        { name: "acc", label: "Accepte de nouveaux colis", type: "checkbox", value: p.accepts_new_pickups },
        { name: "msg", label: "Message opérationnel (visible des clients)", type: "textarea", value: p.operational_message }] });
    if (!f) return;
    try { await adminSetPickupPointState(p.id, { status: f.values.status, acceptsNewPickups: f.values.acc, operationalMessage: f.values.msg }); showToast("État enregistré ✓"); loadPoints(); }
    catch (e) { showToast(adminErrorFr(e, "Changement d'état refusé."), "red"); }
  };
  body.querySelector("[data-add-point]").addEventListener("click", () => pointForm());


  // ---- Points de rencontre sécurisés ----
  const secureEl = body.querySelector("[data-secure]");
  const loadSecurePoints = async () => {
    secureEl.innerHTML = '<div class="loading-state">Chargement…</div>';
    try { const r = await adminListSecureDeliveryPoints({ limit: 200 }); ctx.securePoints = r.rows; }
    catch (e) { secureEl.innerHTML = errorBox(adminErrorFr(e, "Points sécurisés indisponibles.")); return; }
    if (!ctx.securePoints.length) { secureEl.innerHTML = emptyBox("Aucun point sécurisé", "Ajoutez un point de rencontre sécurisé."); return; }
    const tone = { active:"green", draft:"amber", paused:"amber", closed:"" };
    secureEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Point</th><th>Adresse</th><th>Sécurité</th><th>Statut</th><th></th></tr></thead><tbody>${ctx.securePoints.map((p)=>`<tr>
      <td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.code)}${p.partner_name ? ` · ${esc(p.partner_name)}` : ""}</div></td>
      <td>${esc([p.address_line1,p.commune,p.department].filter(Boolean).join(", "))}</td>
      <td>${esc(p.safety_level || "standard")} · ${p.accepts_meetings ? "rencontres ON" : "rencontres OFF"}</td>
      <td>${chip(p.status, tone[p.status] || "")}</td>
      <td><button class="btn btn-outline-blue btn-sm" type="button" data-secure-edit="${esc(p.id)}">Modifier</button></td>
    </tr>`).join("")}</tbody></table></div>`;
    secureEl.querySelectorAll("[data-secure-edit]").forEach((b)=>b.addEventListener("click",()=>secureForm(ctx.securePoints.find((p)=>p.id===b.dataset.secureEdit))));
  };
  const secureForm = async (p = null) => {
    if (!ctx.zonesLoaded) await loadZones(true);
    if (!ctx.zones.length) { showToast("Créez d'abord une zone : un point sécurisé doit être rattaché à une zone.", "red"); return; }
    const f = await formModal({ title: p ? `Modifier ${p.code}` : "Nouveau point de rencontre sécurisé", env, confirmLabel: "Enregistrer",
      fields: [
        ...(p ? [] : [{ name:"code", label:"Code (unique)", required:true }]),
        { name:"name", label:"Nom", required:true, value:p?.name },
        { name:"partner", label:"Partenaire (commerce hôte)", value:p?.partner_name },
        { name:"zone", label:"Zone", type:"select", required:true, value:p?.zone_id || "", options:ctx.zones.map((z)=>({value:z.id,label:`${z.name} (${z.code})`})) },
        { name:"addr1", label:"Adresse", required:true, value:p?.address_line1 },
        { name:"addr2", label:"Complément", value:p?.address_line2 },
        { name:"department", label:"Département", value:p?.department },
        { name:"commune", label:"Commune", required:true, value:p?.commune },
        { name:"status", label:"Statut", type:"select", value:p?.status || "draft", options:["draft","active","paused","closed"].map((v)=>({value:v,label:v})) },
        { name:"meet", label:"Accepte les rencontres", type:"checkbox", value:p ? !!p.accepts_meetings : true },
        { name:"level", label:"Niveau de sécurité", type:"select", value:p?.safety_level || "standard", options:[{value:"standard",label:"Standard"},{value:"enhanced",label:"Renforcé"}] },
        { name:"phone", label:"Téléphone", value:p?.phone },
        { name:"instr", label:"Instructions client", type:"textarea", value:p?.customer_instructions },
        { name:"opmsg", label:"Message opérationnel", type:"textarea", value:p?.operational_message },
        { name:"lat", label:"Latitude", type:"number", step:"any", value:p?.latitude ?? "" },
        { name:"lng", label:"Longitude", type:"number", step:"any", value:p?.longitude ?? "" },
        { name:"prio", label:"Priorité", type:"number", value:p?.sort_priority ?? 100 },
      ],
      validate:(v)=>((v.lat===null)!==(v.lng===null) ? "Latitude et longitude vont ensemble." : null) });
    if (!f) return;
    const v=f.values;
    const payload={ code:v.code, name:v.name, partnerName:v.partner, zoneId:v.zone, addressLine1:v.addr1, addressLine2:v.addr2,
      department:v.department, commune:v.commune, status:v.status, acceptsMeetings:v.meet, safetyLevel:v.level, phone:v.phone,
      customerInstructions:v.instr, operationalMessage:v.opmsg, latitude:v.lat, longitude:v.lng, sortPriority:v.prio ?? 100,
      openingHours:p?.opening_hours || {}, mapProvider:p?.map_provider || "manual", mapPlaceId:p?.map_place_id || null };
    try {
      if (p) await adminUpdateSecureDeliveryPoint(p.id,payload); else await adminCreateSecureDeliveryPoint(payload);
      showToast("Point sécurisé enregistré ✓");
      await loadSecurePoints();
    } catch (e) { showToast(adminErrorFr(e, "Point sécurisé refusé par le backend."), "red"); }
  };
  body.querySelector("[data-add-secure]").addEventListener("click", () => secureForm());


  // ---- Simulation ----
  body.querySelector("[data-sim]").innerHTML = `<p class="muted">Calcule le tarif qui serait appliqué avec le <strong>brouillon</strong> (aucune écriture).</p><button class="btn btn-outline-blue btn-sm" type="button" data-run-sim>Lancer une simulation…</button><div data-sim-out style="margin-top:10px"></div>`;
  body.querySelector("[data-run-sim]").addEventListener("click", async () => {
    if (!ctx.zonesLoaded) await loadZones(true);
    const f = await formModal({ title: "Simulation de tarif", env, confirmLabel: "Simuler",
      fields: [{ name: "type", label: "Méthode", type: "select", value: "home", options: [{ value: "home", label: "Domicile" }, { value: "custom_location", label: "Adresse personnalisée" }, { value: "vinht_pickup", label: "Point VinHT" }, { value: "secure_meeting", label: "Rencontre sécurisée" }] },
        { name: "zone", label: "Zone (domicile)", type: "select", options: [{ value: "", label: "— Aucune —" }, ...ctx.zones.map((z) => ({ value: z.code, label: `${z.name} (${z.code})` }))] },
        { name: "pickup", label: "Code du point VinHT (si point VinHT)" }] });
    if (!f) return;
    const out = body.querySelector("[data-sim-out]");
    out.innerHTML = `<div class="loading-state">Calcul…</div>`;
    try {
      const r = await adminSimulateLogistics({ deliveryType: f.values.type, deliveryAddress: f.values.zone ? { delivery_zone_code: f.values.zone } : {}, pickupPointCode: f.values.pickup });
      out.innerHTML = `<pre class="cc-pre">${esc(JSON.stringify(r, null, 2))}</pre>`;
    } catch (e) { out.innerHTML = errorBox(adminErrorFr(e, "Simulation impossible.")); }
  });

  // ---- Versions & audit ----
  const verEl = body.querySelector("[data-versions]");
  const loadVersions = async () => {
    verEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    try {
      const r = await adminListLogisticsVersions({ limit: 20 });
      if (!r.rows.length) { verEl.innerHTML = emptyBox("Aucune version", "Aucune activation enregistrée."); return; }
      verEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Version</th><th>Date</th><th>Motif</th><th></th></tr></thead><tbody>${r.rows.map((v, i) => `<tr><td><strong>v${esc(v.version_number)}</strong>${i === 0 ? " " + chip("Active", "green") : ""}${v.source_version_number != null ? `<div class="muted">issue de v${esc(v.source_version_number)}</div>` : ""}</td><td>${esc(fmtDateTime(v.created_at))}</td><td>${esc(v.activation_reason || "—")}</td><td>${i === 0 ? "" : `<button class="btn btn-outline-red btn-sm" type="button" data-rollback="${esc(v.version_number)}">Revenir à cette version…</button>`}</td></tr>`).join("")}</tbody></table></div>`;
      verEl.querySelectorAll("[data-rollback]").forEach((b) => b.addEventListener("click", async () => {
        const n = Number(b.dataset.rollback);
        const ok = await confirmAction({ title: `Revenir à la version v${n} ?`, env, requireReason: true, confirmLabel: "Revenir en arrière", danger: true, phrase: isProd ? PROD_PHRASE : null,
          consequences: [isProd ? "Effet immédiat sur les clients, marchands et livreurs réels." : "Effet immédiat en Demo.", "Les réglages ET les règles tarifaires de cette version redeviennent actifs.", "Une nouvelle version est créée : l'historique est conservé."] });
        if (!ok) return;
        try { await adminRollbackLogisticsVersion(n, ok.reason); showToast("Retour arrière effectué ✓"); await Promise.all([loadConfig(), loadVersions(), loadAudit()]); }
        catch (e) { showToast(adminErrorFr(e, "Retour arrière refusé."), "red"); }
      }));
    } catch (e) { verEl.innerHTML = errorBox(adminErrorFr(e, "Versions indisponibles.")); }
  };
  const auditEl = body.querySelector("[data-audit]");
  const loadAudit = async () => {
    auditEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    try {
      const rows = await adminListLogisticsAudit({ limit: 30 });
      auditEl.innerHTML = rows.length ? `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Date</th><th>Action</th><th>Motif</th></tr></thead><tbody>${rows.map((a) => `<tr><td>${esc(fmtDateTime(a.created_at))}</td><td>${esc(a.action)}</td><td>${esc(a.reason || "—")}</td></tr>`).join("")}</tbody></table></div>` : emptyBox("Aucune entrée", "");
    } catch (e) { auditEl.innerHTML = errorBox(adminErrorFr(e, "Audit indisponible.")); }
  };

  await Promise.all([loadConfig(), loadZones(), loadPoints(), loadSecurePoints(), loadVersions(), loadAudit()]);
  refreshIcons();
}
