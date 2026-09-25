// Lecture de la publication d'une livraison côté marchand.
//
// merchant_publish_order_for_delivery_v1 renvoie :
//   { delivery_status, published, delivery: { status, published, dispatchable,
//     dispatch_block_reason } , ... }
// « published » n'est vrai que si la tâche est réellement passée en
// awaiting_assignment. Une tâche `ready_waiting_dispatch` est prête mais PAS
// visible des livreurs : ne jamais l'annoncer comme « mission publiée ».
// Les motifs viennent de delivery_task_dispatch_readiness_v1 (backend).

import { fulfillmentReadinessMessageFr } from "./merchantFulfillment.js";

export const DISPATCH_BLOCK_FR = {
  order_payment_not_confirmed_for_delivery: "Le paiement de la commande n'est pas encore confirmé.",
  dispatch_source_location_required: "Le point de retrait n'est pas renseigné.",
  dispatch_source_location_not_geographic: "Le point de retrait doit avoir une commune et un département exploitables (ou des coordonnées).",
  dispatch_destination_location_required: "L'adresse de livraison du client n'est pas renseignée.",
  dispatch_destination_location_not_geographic: "L'adresse de livraison du client n'est pas assez précise (commune et département requis).",
  order_not_dispatchable: "La commande est annulée ou remboursée.",
  merchant_order_not_dispatchable: "Cette commande marchand est annulée.",
  order_environment_mismatch: "La commande n'appartient pas à cet environnement.",
  merchant_order_environment_mismatch: "La commande n'appartient pas à cet environnement.",
};

export function dispatchBlockReasonFr(code) {
  const c = String(code || "").trim();
  if (!c) return "";
  return DISPATCH_BLOCK_FR[c] || "";
}

// → { published, status, blockReason, message, tone }
export function describePublishResult(data) {
  const d = data && typeof data === "object" ? data : {};
  const delivery = d.delivery && typeof d.delivery === "object" ? d.delivery : {};
  const status = String(d.delivery_status || delivery.status || "");
  const published = (d.published === true || delivery.published === true) && status !== "ready_waiting_dispatch";
  const blockReason = String(delivery.dispatch_block_reason || "").trim();
  if (published) {
    return { published: true, status, blockReason: "", tone: "green",
      message: "Mission publiée ✓ Le livreur qui la prend pourra vous appeler ou vous écrire sur WhatsApp." };
  }
  if (status === "ready_waiting_dispatch") {
    const why = dispatchBlockReasonFr(blockReason);
    return { published: false, status, blockReason, tone: "amber",
      message: why
        ? `Colis prêt, mais pas encore visible des livreurs : ${why}`
        : "Colis prêt. La mission n'est pas encore visible des livreurs : la livraison est momentanément indisponible, VinHT la publiera dès que possible." };
  }
  if (status) {
    // Tâche déjà avancée (assignée, en route…) : publication idempotente.
    return { published: true, status, blockReason: "", tone: "green", message: "Cette livraison est déjà en cours." };
  }
  return { published: false, status, blockReason, tone: "amber", message: "Commande marquée prête. Vérifiez l'état de la livraison dans quelques instants." };
}

// Messages d'erreur métier (codes RPC réels), sinon null.
export function publishErrorFr(error) {
  const raw = String(error?.message || error || "").toLowerCase();
  const map = [
    ["order_payment_not_confirmed_for_delivery", "Le paiement de cette commande n'est pas encore confirmé. La livraison sera disponible après paiement."],
    ["merchant_order_not_ready_for_delivery", "Cette commande n'est pas encore à l'étape de préparation requise."],
    ["order_not_publishable_for_delivery", "Cette commande est annulée ou remboursée : elle ne peut pas être publiée."],
    ["pickup_address_or_coordinates_required", "Indiquez l'adresse où le livreur doit récupérer le colis."],
    ["pickup_routing_geography_required", "Indiquez une commune et un département valides pour le point de retrait."],
    ["dispatch_source_location_not_geographic", "Le point de retrait doit avoir une commune et un département exploitables."],
    ["dispatch_source_geography_required", "Indiquez une commune et un département valides pour le point de retrait."],
    ["dispatch_source_location_required", "Le point de retrait n'est pas renseigné."],
    ["dispatch_destination_location_not_geographic", "L'adresse de livraison du client n'est pas assez précise pour le dispatch."],
    ["dispatch_destination_geography_required", "L'adresse de livraison du client n'est pas assez précise pour le dispatch."],
    ["dispatch_destination_location_required", "L'adresse de livraison du client n'est pas renseignée."],
    ["invalid_pickup_coordinates", "Les coordonnées du point de retrait sont invalides."],
    ["pickup_coordinates_incomplete", "Renseignez latitude et longitude ensemble, ou aucune des deux."],
    ["invalid_pickup_contact_phone", "Le numéro de contact du point de retrait est invalide."],
    ["invalid_pickup_whatsapp_phone", "Le numéro WhatsApp du point de retrait est invalide."],
    ["logistics_configuration_missing", "La logistique n'est pas encore configurée pour cet environnement. Contactez VinHT."],
    ["fulfillment_task_not_found_for_merchant", "Vous n'êtes pas le marchand chargé de la remise de cette commande."],
    // Refus canoniques d'order_fulfillment_readiness_v1 : le backend décide, on traduit
    // seulement (même dictionnaire que le readiness batch, voir merchantFulfillment.js).
    ["order_payment_not_confirmed_for_fulfillment", fulfillmentReadinessMessageFr("order_payment_not_confirmed_for_fulfillment")],
    ["order_payment_closed", fulfillmentReadinessMessageFr("order_payment_closed")],
    ["order_not_fulfillable", fulfillmentReadinessMessageFr("order_not_fulfillable")],
    ["fulfillment_financial_scope_not_found", "Aucune de vos commandes n'est rattachée à cette livraison."],
    ["fulfillment_task_not_found", "Cette livraison n'existe pas ou ne vous est pas confiée."],
    ["pickup_contact_phone_required", "Indiquez un numéro de contact."],
    ["fulfillment_task_contact_locked", "Le colis est déjà parti : le numéro de contact ne peut plus être modifié."],
    ["pickup_location_object_required", "Indiquez le point de retrait."],
    ["fulfillment_task_not_readyable", "Cette livraison n'est plus à l'étape de publication."],
    ["fulfillment_task_not_publishable", "Cette livraison ne peut plus être publiée dans son état actuel."],
    ["merchant_handoff_confirmation_not_allowed", "La remise ne peut être confirmée qu'une fois le livreur arrivé au point de retrait."],
    ["merchant_authentication_required", "Votre session marchand a expiré. Reconnectez-vous puis réessayez."],
  ];
  for (const [code, msg] of map) if (raw.includes(code)) return msg;
  return null;
}
