// Bloc 4 — Timeouts automatiques de livraison (lecture + libellés de présentation).
//
// Le backend (app_private.reconcile_delivery_timeouts_v1, exécuté chaque
// minute par le cron "vinht-delivery-timeouts-every-minute", et exposé en
// lecture/action manuelle via admin_get_delivery_timeout_control_v1 /
// admin_run_delivery_timeouts_v1) reste l'unique décideur des transitions
// assignment_timed_out et delivery_stalled_timed_out. Ce module ne fait que :
//   - lire le contrôle (réglages, compteurs "due", dernier événement) ;
//   - déclencher manuellement la même reconciliation que le cron ;
//   - fournir des libellés français purs (aucune règle, aucun calcul de délai).
// Aucun setTimeout ici ne transforme jamais localement une mission en expirée :
// un compte à rebours visuel, s'il existe un jour, devra se contenter d'attendre
// un rafraîchissement backend, jamais décider par lui-même.

import { getSupabase } from "./supabase.js";

async function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// Lecture stricte : jamais de "state: ready" ou de compteur fabriqué si la
// réponse RPC est malformée — une réponse invalide devient une erreur
// explicite, jamais un due=0 ou un settings vide silencieux.
export async function adminGetDeliveryTimeoutControl() {
  const sb = await client();
  // p_environment n'est jamais fourni : le backend dérive systématiquement
  // l'environnement de la session admin courante et refuse toute tentative
  // de contournement (admin_environment_mismatch). Aucun sélecteur local
  // indépendant de l'environnement Admin central n'existe ici.
  const { data, error } = await sb.rpc("admin_get_delivery_timeout_control_v1", { p_environment: null });
  if (error) throw error;
  const valid = isPlainObject(data)
    && data.state === "ready"
    && typeof data.environment === "string" && data.environment.length > 0
    && isPlainObject(data.settings)
    && Number.isInteger(data.settings.mission_accept_timeout_minutes)
    && Number.isInteger(data.settings.stalled_delivery_minutes)
    && isPlainObject(data.due)
    && Number.isInteger(data.due.assignment_timeouts)
    && Number.isInteger(data.due.stalled_timeouts)
    && Number.isInteger(data.due.total)
    && (data.last_timeout_event === null || isPlainObject(data.last_timeout_event))
    && typeof data.cron_job === "string";
  if (!valid) throw new Error("invalid_delivery_timeout_control_response");
  return data;
}

// Exécute immédiatement la même reconciliation que le cron, pour
// l'environnement courant de l'admin. Ne force aucune mission : seules
// celles réellement échues selon le backend sont traitées.
export async function adminRunDeliveryTimeouts() {
  const sb = await client();
  const { data, error } = await sb.rpc("admin_run_delivery_timeouts_v1", {});
  if (error) throw error;
  const valid = isPlainObject(data)
    && data.state === "ready"
    && Number.isInteger(data.assignment_timeouts)
    && Number.isInteger(data.stalled_timeouts)
    && Number.isInteger(data.total_actions);
  if (!valid) throw new Error("invalid_delivery_timeout_run_response");
  return data;
}

// Présentation pure : voir deliveryTimeoutsRules.js (testable sans réseau).
export {
  TIMEOUT_EVENT_LABEL_FR, DELIVERY_ISSUE_NOTICE_FR, timeoutEventLabelFr,
  deliveryIssueNoticeFr, timeoutSummaryView,
} from "./deliveryTimeoutsRules.js";
