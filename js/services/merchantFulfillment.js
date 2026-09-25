// Logique pure (sans DOM, sans réseau) de l'espace Commandes marchand.
//
// Modèle multi-fulfillment (backend v7/v8) :
//  - une task de livraison est identifiée par delivery_task_id ;
//  - task.merchant_order_id = merchant_order du VENDEUR (seller), jamais un scope
//    financier du marchand connecté quand celui-ci est un fournisseur ;
//  - task.my_merchant_order_id = le merchant_order du marchand connecté pour cette
//    task (seller ou source_supplier) : c'est le seul lien à utiliser ;
//  - les articles physiques à préparer sont task.items, pas order_items.
// Le navigateur ne décide d'aucune autorisation : les actions marchand viennent
// du contrat get_delivery_state_machine_contract_v1 ; le backend refuse sinon.

import { contractActionsFor } from "./deliveryContractRules.js";

// Regroupe les tasks par my_merchant_order_id (jamais un Map qui écrase).
// Les tasks sans scope financier "mine" sont renvoyées à part (unlinked) pour ne
// jamais disparaître silencieusement.
export function groupTasksByMyMerchantOrder(tasks) {
  const byMo = new Map();
  const unlinked = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const key = t && t.my_merchant_order_id ? String(t.my_merchant_order_id) : "";
    if (!key) { unlinked.push(t); continue; }
    if (!byMo.has(key)) byMo.set(key, []);
    byMo.get(key).push(t);
  }
  return { byMo, unlinked };
}

// Articles à préparer pour une task : uniquement task.items (aucun prix inventé).
export function taskItems(task) {
  const items = Array.isArray(task?.items) ? task.items : [];
  return items.map((it) => ({
    key: String(it.order_item_id || `${it.product_id || ""}:${it.variant_id || ""}`),
    name: String(it.product_name || "Produit"),
    sku: String(it.variant_sku || it.sku || ""),
    options: it.variant_options && typeof it.variant_options === "object" ? it.variant_options : null,
    quantity: Number(it.quantity) || 0,
    imagePath: it.product_image_path || null,
  }));
}

export function optionsLabel(options) {
  if (!options || typeof options !== "object") return "";
  return Object.entries(options).map(([k, v]) => `${k} : ${v}`).join(" · ");
}

// Montant currency-aware : *_amount d'abord ; le champ *_htg n'est un repli que
// pour l'HTG (ou une ligne historique sans devise). Jamais de 0 HTG fictif :
// retourne null si rien de fiable n'est exposé.
export function amountOf(row, amountKey, htgKey, currencyKey = "currency") {
  if (!row || typeof row !== "object") return { value: null, currency: null };
  const currency = String(row[currencyKey] || "").toUpperCase() || null;
  const raw = row[amountKey];
  if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) {
    return { value: Number(raw), currency: currency || "HTG" };
  }
  if ((!currency || currency === "HTG") && htgKey) {
    const h = row[htgKey];
    if (h !== null && h !== undefined && h !== "" && Number.isFinite(Number(h))) return { value: Number(h), currency: "HTG" };
  }
  return { value: null, currency };
}

export function formatAmount({ value, currency }) {
  if (value === null || value === undefined) return "—";
  return `${currency || "HTG"} ${Number(value).toLocaleString("en-US")}`;
}

// Actions marchand autorisées par le CONTRAT pour cette task.
// fulfillment_ready → publier / marquer prêt ; confirm_handoff → confirmer la remise.
// Sans contrat : aucune action (fail closed).
export function merchantTaskActions(contract, task) {
  const acts = contractActionsFor(contract, "merchant", String(task?.status || "")).map((a) => a.action);
  return {
    canPublish: acts.includes("fulfillment_ready"),
    canConfirmHandoff: acts.includes("confirm_handoff"),
  };
}

// --- Bloc 2 : readiness paiement (merchant_list_fulfillment_readiness_v1) --------
//
// readiness.ready / readiness.reason viennent uniquement de
// app_private.order_fulfillment_readiness_v1 (backend). Le frontend ne recalcule
// JAMAIS `ready` : il ne fait que traduire `reason` en français pour l'affichage.
// Ne jamais ajouter ici de règle du type payment_status==="paid" ou
// payment_method==="cod" : la seule source de vérité est readiness.ready.
const READINESS_REASON_FR = {
  order_payment_not_confirmed_for_fulfillment: "Le paiement n'est pas encore confirmé. La préparation commencera après confirmation du paiement.",
  order_payment_closed: "Le paiement de cette commande est fermé ou remboursé. Aucune nouvelle préparation n'est possible.",
  order_not_fulfillable: "Cette commande est annulée ou remboursée et ne peut plus être préparée.",
  order_not_found: "Cette commande est introuvable.",
};

// Présentation uniquement : traduit le `reason` renvoyé par le backend. Ne calcule
// jamais `ready` — ce helper ne prend même pas `ready` en paramètre.
export function fulfillmentReadinessMessageFr(reason) {
  const key = String(reason || "").trim();
  return READINESS_REASON_FR[key] || "Cette commande n'est pas encore prête pour la préparation.";
}

// Construit un index merchant_order_id -> ligne de readiness à partir de la
// réponse (tableau) de merchant_list_fulfillment_readiness_v1.
export function readinessMapFrom(rows) {
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.merchant_order_id) map.set(String(r.merchant_order_id), r);
  }
  return map;
}

// true seulement si le backend a explicitement répondu readiness.ready === true
// pour ce merchant_order_id. Toute absence d'entrée (échec réseau, id inconnu,
// réponse tronquée) est traitée comme NON prête (fail closed), jamais comme prête.
export function isFulfillmentReady(readinessMap, merchantOrderId) {
  const row = readinessMap instanceof Map ? readinessMap.get(String(merchantOrderId || "")) : null;
  return !!row && row.readiness && row.readiness.ready === true;
}

export function readinessReasonFor(readinessMap, merchantOrderId) {
  const row = readinessMap instanceof Map ? readinessMap.get(String(merchantOrderId || "")) : null;
  return row?.readiness?.reason || null;
}

// --- Bloc 2 : versement (payout_status / payout_error) ---------------------------
// Présentation directe de champs serveur. Ne jamais réécrire payout_status ou
// payout_error côté frontend, et ne jamais transformer un payout "paid" en
// "cancelled"/"refunded"/"reversed" tant que le backend n'a pas lui-même
// effectué ce changement (voir migration 20260921173004).
export const PAYOUT_STATUS_FR = {
  pending: "En attente",
  eligible: "Éligible",
  processing: "En cours de versement",
  paid: "Payé",
  held: "Retenu",
  cancelled: "Annulé",
};

// true uniquement si le backend a lui-même écrit ce marqueur exact (payout déjà
// payé + suffixe "_after_payout_reversal_required" posé par le trigger serveur).
// Ce n'est pas une règle d'autorisation : c'est la lecture d'un fait déjà écrit
// par le serveur, jamais une déduction locale à partir d'autre chose.
export function isPayoutReversalRequired(payoutStatus, payoutError) {
  return payoutStatus === "paid" && typeof payoutError === "string" && payoutError.endsWith("_after_payout_reversal_required");
}

const PAYOUT_ERROR_FR = {
  parent_order_cancelled: "Cette commande a été annulée avant le versement : le versement a été annulé.",
  parent_order_refunded: "Cette commande a été remboursée avant le versement : le versement a été annulé.",
  parent_order_cancelled_after_payout_reversal_required: "Versement déjà effectué avant l'annulation de cette commande. Une régularisation (reversal) est requise.",
  parent_order_refunded_after_payout_reversal_required: "Versement déjà effectué avant le remboursement de cette commande. Une régularisation (reversal) est requise.",
};

export function payoutErrorMessageFr(code) {
  const key = String(code || "").trim();
  if (!key) return "";
  return PAYOUT_ERROR_FR[key] || `Anomalie de versement signalée par VinHT (${key}).`;
}
