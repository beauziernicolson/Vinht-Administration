// Control Center — section « Timeouts automatiques » (onglet Missions).
//
// Observabilité + déclenchement manuel du même moteur que le cron
// "vinht-delivery-timeouts-every-minute" (app_private.reconcile_delivery_timeouts_v1).
// Ce module ne calcule et ne décide jamais rien : les réglages, les compteurs
// "due" et le dernier événement viennent tels quels de
// admin_get_delivery_timeout_control_v1 ; le bouton "Vérifier maintenant"
// n'appelle que admin_run_delivery_timeouts_v1 pour l'environnement admin
// courant (jamais un environnement choisi localement).

import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";
import { esc, fmtDateTime, envPill, errorBox, confirmAction, adminErrorFr } from "../ui/adminUi.js";
import { adminGetDeliveryTimeoutControl, adminRunDeliveryTimeouts, timeoutSummaryView } from "../services/deliveryTimeouts.js";

// Monte la section dans `host` (un <div> vide fourni par la page appelante).
// `onAfterRun` est rappelé après une exécution manuelle réussie, pour laisser
// la page hôte rafraîchir ses propres listes de missions si elle le souhaite.
export function mountDeliveryTimeoutControl(host, { env, onAfterRun } = {}) {
  if (!host) return;
  let view = null;
  let running = false;

  const draw = () => {
    if (!view) { host.innerHTML = `<div class="loading-state">Chargement des timeouts automatiques…</div>`; return; }
    host.innerHTML = `
      <div class="toolbar"><div><h3 style="margin:0">Timeouts automatiques</h3>
        <p class="muted" style="margin:2px 0 0">Vérification automatique chaque minute (${esc(view.cronJob)}). ${envPill(view.environment)}</p></div>
        <div class="toolbar-group"><button class="btn btn-outline-blue btn-sm" type="button" data-dt-refresh ${running ? "disabled" : ""}>Actualiser</button>
        <button class="btn btn-blue btn-sm" type="button" data-dt-run ${running ? "disabled" : ""}>${running ? "Vérification…" : "Vérifier les timeouts maintenant"}</button></div></div>
      <div class="cc-kpis" style="margin-top:8px">
        <div class="cc-kpi"><span class="cc-kpi-n">${esc(view.acceptTimeoutMinutes)} min</span><span class="muted">Timeout acceptation</span></div>
        <div class="cc-kpi"><span class="cc-kpi-n">${esc(view.stalledMinutes)} min</span><span class="muted">Watchdog livraison</span></div>
        <div class="cc-kpi"><span class="cc-kpi-n ${view.dueAssignment > 0 ? "cc-kpi-alert" : ""}">${esc(view.dueAssignment)}</span><span class="muted">Assignations expirables (dues)</span></div>
        <div class="cc-kpi"><span class="cc-kpi-n ${view.dueStalled > 0 ? "cc-kpi-alert" : ""}">${esc(view.dueStalled)}</span><span class="muted">Livraisons bloquées (dues)</span></div>
        <div class="cc-kpi"><span class="cc-kpi-n ${view.dueTotal > 0 ? "cc-kpi-alert" : ""}">${esc(view.dueTotal)}</span><span class="muted">Total en attente</span></div>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Une mission assignée qui n'est pas acceptée dans ce délai redevient assignable. Une livraison active sans progression pendant ce délai passe en Incident : le livreur et la garde du colis (custody) sont conservés.</p>
      <div style="margin-top:10px">
        <h4 style="margin:0 0 4px">Dernier événement de timeout</h4>
        ${view.lastEvent
          ? `<div class="settings-section"><div><strong>${esc(view.lastEvent.label)}</strong><p>${esc(view.lastEvent.fromStatus)} → ${esc(view.lastEvent.toStatus)} · mission ${esc(String(view.lastEvent.deliveryTaskId || "").slice(0, 8))}</p></div><span class="muted">${esc(fmtDateTime(view.lastEvent.createdAt))}</span></div>`
          : `<p class="muted" style="font-size:12px">Aucun événement de timeout enregistré pour le moment.</p>`}
      </div>`;
    host.querySelector("[data-dt-refresh]")?.addEventListener("click", load);
    host.querySelector("[data-dt-run]")?.addEventListener("click", runNow);
    refreshIcons();
  };

  const load = async () => {
    host.innerHTML = `<div class="loading-state">Chargement des timeouts automatiques…</div>`;
    try {
      const control = await adminGetDeliveryTimeoutControl();
      view = timeoutSummaryView(control);
      draw();
    } catch (e) {
      host.innerHTML = errorBox(adminErrorFr(e, "Timeouts automatiques indisponibles."), "data-dt-retry");
      host.querySelector("[data-dt-retry]")?.addEventListener("click", load);
    }
  };

  const runNow = async () => {
    if (running) return;
    const ok = await confirmAction({
      title: "Vérifier les timeouts maintenant ?",
      env,
      confirmLabel: "Exécuter",
      consequences: [
        "Cette action exécute immédiatement le moteur automatique pour l'environnement courant.",
        "Elle ne force aucune livraison arbitrairement : seules les missions réellement expirées selon le backend seront traitées.",
      ],
    });
    if (!ok) return;
    running = true;
    draw();
    try {
      const result = await adminRunDeliveryTimeouts();
      showToast(`Vérification effectuée : ${result.assignment_timeouts} assignation(s) expirée(s), ${result.stalled_timeouts} livraison(s) passée(s) en incident.`);
      await load();
      if (typeof onAfterRun === "function") await onAfterRun(result);
    } catch (e) {
      showToast(adminErrorFr(e, "Vérification refusée par le backend."), "red");
    } finally {
      running = false;
      // load() redessine déjà l'état normal après succès. En cas d'échec,
      // réactiver explicitement les boutons sans modifier les données affichées.
      if (host.isConnected && host.querySelector("[data-dt-run]")?.disabled) draw();
    }
  };

  load();
  return { reload: load };
}
