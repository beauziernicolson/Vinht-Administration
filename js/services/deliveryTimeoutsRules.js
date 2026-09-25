// Présentation pure des timeouts automatiques de livraison.
// Aucune machine d'état locale ici : le backend reste l'unique source de vérité.
// Ce module traduit uniquement les événements timeout et prépare les données
// d'affichage du Control Center.

export const TIMEOUT_EVENT_LABEL_FR = {
  assignment_timed_out: "Assignation expirée automatiquement",
  delivery_stalled_timed_out: "Livraison passée en incident (blocage détecté)",
};

export const DELIVERY_ISSUE_NOTICE_FR =
  "Incident — intervention requise. Ne remettez pas le colis ou la mission à une autre personne sans instruction VinHT.";

export function timeoutEventLabelFr(eventType) {
  return TIMEOUT_EVENT_LABEL_FR[eventType] || String(eventType || "—");
}

export function deliveryIssueNoticeFr() {
  return DELIVERY_ISSUE_NOTICE_FR;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// Vue de présentation pure du contrôle admin des timeouts : ne fait que
// reformater les champs déjà renvoyés par admin_get_delivery_timeout_control_v1.
// Elle ne classe aucun statut actif/terminal et ne calcule aucun délai.
export function timeoutSummaryView(control) {
  if (!isPlainObject(control)) return null;
  const s = control.settings || {};
  const d = control.due || {};
  const last = control.last_timeout_event || null;
  return {
    environment: control.environment,
    acceptTimeoutMinutes: s.mission_accept_timeout_minutes,
    stalledMinutes: s.stalled_delivery_minutes,
    dueAssignment: d.assignment_timeouts,
    dueStalled: d.stalled_timeouts,
    dueTotal: d.total,
    cronJob: control.cron_job,
    lastEvent: last
      ? {
          deliveryTaskId: last.delivery_task_id,
          label: timeoutEventLabelFr(last.event_type),
          fromStatus: last.from_status,
          toStatus: last.to_status,
          createdAt: last.created_at,
        }
      : null,
  };
}
