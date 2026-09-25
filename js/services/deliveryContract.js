// Contrat canonique de la machine d'état de livraison (source de vérité : backend).
//
// Le navigateur NE définit PAS qui peut faire quoi : il lit
// get_delivery_state_machine_contract_v1() et n'affiche une action que si le
// contrat la prévoit pour l'acteur et le statut courants. Les libellés français
// ci-dessous sont de la présentation, pas des règles.

import { getSupabase } from "./supabase.js";

export const DELIVERY_STATUS_FR = {
  awaiting_fulfillment: "En préparation chez le marchand",
  ready_waiting_dispatch: "Prête — en attente de publication",
  awaiting_assignment: "Publiée — en attente d'un livreur",
  assigned: "Assignée — réponse du livreur attendue",
  accepted: "Acceptée par le livreur",
  at_pickup: "Livreur au point de retrait",
  handoff_pending_merchant: "Remise à confirmer par le marchand",
  picked_up: "Colis récupéré",
  in_transit: "En route",
  arrived_destination: "Arrivé à destination",
  delivered: "Livrée",
  issue: "Incident à traiter",
  cancelled: "Annulée",
};

export const DELIVERY_STATUS_TONE = {
  awaiting_fulfillment: "blue", ready_waiting_dispatch: "amber", awaiting_assignment: "amber", assigned: "amber",
  accepted: "blue", at_pickup: "blue", handoff_pending_merchant: "amber", picked_up: "blue", in_transit: "blue",
  arrived_destination: "blue", delivered: "green", issue: "red", cancelled: "",
};

export const DELIVERY_KIND_FR = { customer: "Livraison client", pickup_point: "Vers un point VinHT", secure_meeting: "Rencontre sécurisée" };

export const COMPENSATION_STATUS_FR = { not_configured: "Non configurée", pending: "À valider", approved: "Validée", paid: "Payée", cancelled: "Annulée" };

let _cache = null;
let _inflight = null;

export async function getDeliveryStateMachineContract({ force = false } = {}) {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = (async () => {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase non configuré");
    const { data, error } = await sb.rpc("get_delivery_state_machine_contract_v1");
    if (error) throw error;
    if (!data || typeof data !== "object" || !Array.isArray(data.statuses) || !Array.isArray(data.transitions)) {
      throw new Error("delivery_contract_malformed_response");
    }
    _cache = data;
    return data;
  })();
  try { return await _inflight; } finally { _inflight = null; }
}

// Lecture pure du contrat : voir deliveryContractRules.js (testable sans réseau).
export { contractActionsFor, isTerminalStatus } from "./deliveryContractRules.js";

export function deliveryStatusLabel(status) {
  return DELIVERY_STATUS_FR[status] || String(status || "—");
}
