import { getSupabase } from "./supabase.js";

// Feature #34 — Courier Portal frontend. Branché exclusivement sur les RPC
// #34B (get_my_courier_portal_context_v1 / list_my_delivery_tasks_v2 /
// list_available_delivery_missions_v2 / get_my_delivery_task_v1) et sur les
// mutations Courier existantes #17/#18. Le backend reste l'unique source de
// vérité pour l'état, les capabilities et allowed_actions/waiting_for :
// aucune règle métier n'est recalculée ici.

async function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

export const VEHICLE_TYPE_FR = {
  motorcycle: "Moto",
  car: "Voiture",
  van: "Camionnette",
  bicycle: "Vélo",
  on_foot: "À pied",
  other: "Autre",
};

export const OPERATIONAL_STATUS_FR = {
  pending_review: "En attente de validation",
  active: "Actif",
  paused: "En pause",
  rejected: "Refusé",
  suspended: "Suspendu",
  closed: "Fermé",
};

// Libellés d'affichage uniquement (aucune règle) pour les valeurs brutes du backend.
export const COMPENSATION_STATUS_FR = { not_configured: "Non configurée", pending: "À valider", approved: "Validée", paid: "Payée", cancelled: "Annulée" };
export const PROOF_TYPE_FR = { customer_code: "Code client", hub_receipt: "Réception au point VinHT", admin_override: "Validation administrative" };
export const PRESENCE_STATE_FR = { none: "Aucun signal", on_the_way: "Le client est en route", arrived: "Le client est arrivé", unsafe: "Le client a signalé un lieu non sûr", cannot_attend: "Le client ne peut pas être présent" };
export const DELIVERY_KIND_FR = { customer: "Livraison client", pickup_point: "Vers un point VinHT", secure_meeting: "Rencontre sécurisée" };

export const AVAILABILITY_STATUS_FR = {
  offline: "Hors ligne",
  available: "En ligne",
  busy: "Occupé",
};

export const WAITING_FOR_FR = {
  courier_response: "Action requise de votre part",
  merchant_handoff: "En attente de confirmation du marchand",
  hub_receipt: "En attente de réception au point relais / hub",
  customer_confirmation_code: "En attente du code de confirmation client",
  admin_resolution: "Incident signalé — intervention VinHT nécessaire",
  closed: "Mission terminée",
};

export const ALLOWED_ACTION_LABEL_FR = {
  claim: "Prendre cette mission",
  accept: "Accepter",
  reject: "Refuser",
  arrive_pickup: "Je suis arrivé au point de retrait",
  confirm_pickup: "J'ai récupéré le colis",
  start_transit: "Démarrer la livraison",
  arrive_destination: "Je suis arrivé à destination",
  report_issue: "Signaler un problème",
  confirm_customer_delivery: "Confirmer avec le code client",
};

export function courierErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  // Le backend peut produire des variantes dynamiques par transition, ex.
  // invalid_delivery_transition_from_accepted_to_in_transit — la map exacte
  // ne peut pas toutes les lister, donc on traite le préfixe avant la map.
  if (raw.startsWith("invalid_delivery_transition_from_") || raw.startsWith("delivery_transition_forbidden")) {
    return "Cette transition n'est pas autorisée dans l'état actuel.";
  }
  const map = {
    authentication_required: "Connectez-vous pour continuer.",
    logistics_configuration_missing: "Le service de livraison n'est pas configuré pour le moment.",
    courier_profile_required: "Vous n'avez pas encore de profil livreur actif.",
    courier_operations_unavailable: "Les opérations de livraison sont temporairement indisponibles.",
    courier_not_operationally_active: "Votre profil livreur n'est pas actif pour le moment.",
    courier_not_available: "Passez en ligne pour voir les missions.",
    courier_capacity_reached: "Vous avez atteint votre nombre maximum de livraisons actives.",
    courier_marketplace_unavailable: "Les missions disponibles ne sont pas activées pour le moment.",
    unsupported_delivery_status_filter: "Filtre de statut invalide.",
    delivery_mission_already_taken: "Cette mission a déjà été prise par un autre livreur.",
    delivery_mission_outside_courier_area: "Cette mission est en dehors de vos zones de service.",
    assigned_delivery_not_found: "Cette livraison ne vous est pas assignée ou est introuvable.",
    delivery_not_waiting_for_acceptance: "Cette livraison n'attend plus votre réponse.",
    invalid_delivery_transition: "Cette transition n'est pas autorisée dans l'état actuel.",
    delivery_issue_note_required: "Décrivez le problème avant d'envoyer le signalement.",
    invalid_delivery_confirmation_code: "Code de confirmation invalide.",
    delivery_not_arrived_at_destination: "La livraison doit être arrivée à destination avant confirmation.",
    customer_delivery_confirmation_not_applicable: "Aucune confirmation client n'est requise pour cette livraison.",
    courier_applications_closed: "Les candidatures livreur sont fermées pour le moment.",
    courier_application_v2_required: "Complétez votre adresse et votre zone principale pour envoyer la candidature.",
    courier_base_address_required: "Votre adresse de base est requise.",
    courier_base_department_required: "Votre département est requis.",
    courier_base_commune_required: "Votre commune est requise.",
    courier_service_area_required: "Ajoutez au moins une zone de service active avant de passer en ligne.",
    courier_service_area_required_before_approval: "Une zone de service active est requise avant l'approbation.",
    courier_base_address_required_before_approval: "Une adresse de base complète est requise avant l'approbation.",
    unsupported_vehicle_type: "Type de véhicule non supporté.",
    courier_phone_required: "Numéro de téléphone requis.",
    invalid_vehicle_capacity: "Capacité du véhicule invalide.",
    invalid_max_active_deliveries: "Nombre maximum de livraisons actives invalide (1 à 20).",
    courier_location_tracking_disabled: "Le suivi de position n'est pas activé pour le moment.",
    invalid_courier_coordinates: "Coordonnées de position invalides.",
    areas_must_be_array: "Format de zones de service invalide.",
    too_many_service_areas: "Maximum 20 zones de service.",
    service_area_label_required: "Chaque zone de service doit avoir un nom.",
    service_area_coordinates_incomplete: "Les coordonnées d'une zone (latitude, longitude, rayon) doivent être toutes fournies ou toutes absentes.",
    // Codes émis par le moteur de livraison canonique.
    logistics_unavailable: "La livraison n'est pas activée pour le moment.",
    courier_profile_not_editable_in_current_status: "Votre profil ne peut pas être modifié dans son état actuel.",
    courier_service_areas_not_editable: "Vos zones de service ne peuvent pas être modifiées dans l'état actuel du profil.",
    unsupported_availability_status: "Statut de disponibilité non pris en charge.",
    unsupported_delivery_transition: "Cette action n'est pas autorisée dans l'état actuel de la mission.",
    delivery_issue_not_allowed_in_current_status: "Un problème ne peut pas être signalé dans l'état actuel de la mission.",
    customer_delivery_code_required_by_trade_protection: "Le code de confirmation du client est obligatoire pour cette livraison.",
    delivery_assignment_requires_paid_order_or_cod: "La commande doit être payée (ou en paiement à la livraison) avant d'être livrée.",
    courier_cannot_deliver_own_order: "Vous ne pouvez pas livrer votre propre commande.",
    merchant_owner_cannot_be_assigned_as_courier_for_own_order: "Vous ne pouvez pas livrer la commande de votre propre boutique.",
    fulfillment_merchant_owner_cannot_be_courier: "Vous ne pouvez pas livrer une commande préparée par votre propre boutique.",
    delivery_task_not_found: "Mission introuvable.",
    verified_delivery_proof_required: "Une preuve de livraison vérifiée est requise (code client ou réception).",
    dispatch_source_location_required: "Le point de retrait de cette mission n'est pas renseigné.",
    dispatch_source_location_not_geographic: "Le point de retrait de cette mission n'est pas exploitable.",
    dispatch_destination_location_required: "La destination de cette mission n'est pas renseignée.",
    dispatch_destination_location_not_geographic: "La destination de cette mission n'est pas exploitable.",
    order_payment_not_confirmed_for_delivery: "Le paiement de la commande n'est pas encore confirmé.",
    invalid_courier_context_response: "Informations momentanément indisponibles.",
    invalid_courier_tasks_response: "Informations momentanément indisponibles.",
    invalid_courier_missions_response: "Informations momentanément indisponibles.",
    invalid_courier_task_detail_response: "Informations momentanément indisponibles.",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

// --- #34B — Lecture (source de vérité du portail) ---------------------------

// Une réponse RPC malformée n'est jamais assimilée à "aucun résultat" : elle
// doit devenir une erreur explicite (informations momentanément indisponibles),
// jamais une liste vide, un enabled=true fabriqué ou un state="ready" inventé.
// Validation stricte : aucun champ essentiel du contrat n'a de valeur de
// repli (`?? "ready"`, `?? null`, etc.) — s'il manque ou a le mauvais type,
// c'est un contrat backend rompu, pas une donnée absente à tolérer.
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function isNonNegativeInteger(v) {
  return Number.isInteger(v) && v >= 0;
}
function isPositiveInteger(v) {
  return Number.isInteger(v) && v > 0;
}
function hasValidPageFields(d) {
  return isNonNegativeInteger(d.total) && isPositiveInteger(d.limit)
    && isNonNegativeInteger(d.offset) && typeof d.has_more === "boolean";
}

export async function getMyCourierPortalContext() {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_courier_portal_context_v1", {});
  if (error) throw error;
  const valid = isPlainObject(data)
    && data.state === "ready"
    && typeof data.environment === "string" && data.environment.length > 0
    && typeof data.has_profile === "boolean"
    && isPlainObject(data.runtime)
    && isPlainObject(data.capabilities)
    && isPlainObject(data.counts)
    && (data.has_profile ? isPlainObject(data.profile) : data.profile === null);
  if (!valid) throw new Error("invalid_courier_context_response");
  return data;
}

export async function listMyDeliveryTasks({ status = null, limit = 20, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("list_my_delivery_tasks_v2", {
    p_status: status || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  const valid = isPlainObject(data) && data.state === "ready" && Array.isArray(data.rows) && hasValidPageFields(data);
  if (!valid) throw new Error("invalid_courier_tasks_response");
  return {
    rows: data.rows,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
    hasMore: data.has_more,
    statusFilter: data.status_filter ?? status ?? null,
  };
}

export async function listAvailableDeliveryMissions({ limit = 20, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("list_available_delivery_missions_v2", {
    p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  const valid = isPlainObject(data)
    && (data.state === "ready" || data.state === "unavailable")
    && typeof data.enabled === "boolean"
    && Array.isArray(data.rows)
    && hasValidPageFields(data);
  if (!valid) throw new Error("invalid_courier_missions_response");
  return {
    state: data.state,
    enabled: data.enabled,
    reason: data.reason ?? null,
    rows: data.rows,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
    hasMore: data.has_more,
  };
}

export async function getMyDeliveryTask(deliveryTaskId) {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_delivery_task_v1", { p_delivery_task_id: deliveryTaskId });
  if (error) throw error;
  const valid = isPlainObject(data) && data.state === "ready"
    && isPlainObject(data.task) && Array.isArray(data.timeline) && Array.isArray(data.proofs);
  if (!valid) throw new Error("invalid_courier_task_detail_response");
  return data;
}

export async function getMyDeliveryCustodyContext(deliveryTaskId) {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_delivery_custody_context_v1", { p_delivery_task_id: deliveryTaskId });
  if (error) throw error;
  if (!isPlainObject(data) || !["ready","missing"].includes(data.state)) throw new Error("invalid_courier_custody_response");
  return data;
}

export async function listMyDeliveryCustodyTransfers({ status = null, limit = 100, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("list_my_delivery_custody_transfers_v1", { p_status: status || null, p_limit: limit, p_offset: offset });
  if (error) throw error;
  if (!isPlainObject(data) || data.state !== "ready" || !Array.isArray(data.rows)) throw new Error("invalid_courier_transfer_list_response");
  return data.rows;
}

export async function courierConfirmCustodyTransferOut(transferId, note = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_confirm_delivery_custody_transfer_out_v1", { p_transfer_id: transferId, p_note: note || null });
  if (error) throw error;
  return data;
}
export async function courierConfirmCustodyTransferIn(transferId, note = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_confirm_delivery_custody_transfer_in_v1", { p_transfer_id: transferId, p_note: note || null });
  if (error) throw error;
  return data;
}
export async function courierStartDeliveryReturn(deliveryTaskId, note = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_start_delivery_return_v1", { p_delivery_task_id: deliveryTaskId, p_note: note || null });
  if (error) throw error;
  return data;
}

// --- Mutations #17/#18 — profil, disponibilité, zones, position ------------

export async function submitMyCourierProfile({
  phone, vehicleType, vehicleMake, vehicleModel, vehicleColor, vehiclePlate,
  vehicleCapacityKg, maxActiveDeliveries,
  baseAddressLine1, baseDepartment, baseCommune, primaryServiceLabel = "Zone principale",
}) {
  const sb = await client();
  const { data, error } = await sb.rpc("submit_my_courier_profile_v2", {
    p_phone: phone,
    p_vehicle_type: vehicleType,
    p_vehicle_make: vehicleMake || null,
    p_vehicle_model: vehicleModel || null,
    p_vehicle_color: vehicleColor || null,
    p_vehicle_plate: vehiclePlate || null,
    p_vehicle_capacity_kg: vehicleCapacityKg,
    p_max_active_deliveries: maxActiveDeliveries,
    p_base_address_line1: baseAddressLine1,
    p_base_department: baseDepartment,
    p_base_commune: baseCommune,
    p_primary_service_label: primaryServiceLabel || "Zone principale",
  });
  if (error) throw error;
  return data;
}

export async function setMyCourierAvailability(status) {
  const sb = await client();
  const { data, error } = await sb.rpc("set_my_courier_availability_v1", { p_status: status });
  if (error) throw error;
  return data;
}

export async function replaceMyCourierServiceAreas(areas) {
  const sb = await client();
  const { data, error } = await sb.rpc("replace_my_courier_service_areas_v1", { p_areas: areas });
  if (error) throw error;
  return data;
}

export async function updateMyCourierLocation(latitude, longitude) {
  const sb = await client();
  const { data, error } = await sb.rpc("update_my_courier_location_v1", {
    p_latitude: latitude, p_longitude: longitude,
  });
  if (error) throw error;
  return data;
}

// --- Mutations delivery — cycle de vie mission (backend seul décideur) -----

export async function courierClaimDeliveryMission(deliveryTaskId) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_claim_delivery_mission_v1", { p_delivery_task_id: deliveryTaskId });
  if (error) throw error;
  return data;
}

export async function courierAcceptDelivery(deliveryTaskId) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_accept_delivery_v1", { p_delivery_task_id: deliveryTaskId });
  if (error) throw error;
  return data;
}

export async function courierRejectDelivery(deliveryTaskId, reason = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_reject_delivery_v1", {
    p_delivery_task_id: deliveryTaskId, p_reason: reason || null,
  });
  if (error) throw error;
  return data;
}

export async function courierTransitionDelivery(deliveryTaskId, newStatus, note = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_transition_delivery_v1", {
    p_delivery_task_id: deliveryTaskId, p_new_status: newStatus, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function courierConfirmCustomerDelivery(deliveryTaskId, confirmationCode, note = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("courier_confirm_customer_delivery_v1", {
    p_delivery_task_id: deliveryTaskId, p_confirmation_code: confirmationCode, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// Table de relais allowed_action -> RPC existante. Ne décide JAMAIS si une
// action est autorisée — ceci est uniquement un routage vers la bonne
// mutation ; la présence du bouton dépend exclusivement de
// task.allowed_actions renvoyé par le backend.
export const ACTION_DISPATCH = {
  claim: (id) => courierClaimDeliveryMission(id),
  accept: (id) => courierAcceptDelivery(id),
  reject: (id, { reason } = {}) => courierRejectDelivery(id, reason),
  arrive_pickup: (id, { note } = {}) => courierTransitionDelivery(id, "at_pickup", note),
  confirm_pickup: (id, { note } = {}) => courierTransitionDelivery(id, "picked_up", note),
  start_transit: (id, { note } = {}) => courierTransitionDelivery(id, "in_transit", note),
  arrive_destination: (id, { note } = {}) => courierTransitionDelivery(id, "arrived_destination", note),
  report_issue: (id, { note } = {}) => courierTransitionDelivery(id, "issue", note),
  confirm_customer_delivery: (id, { code, note } = {}) => courierConfirmCustomerDelivery(id, code, note),
};
