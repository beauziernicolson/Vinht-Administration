// Abonnement Professionnel marchand (Feature #4) — frontend uniquement.
//
// SOURCE DE VÉRITÉ : le RPC `get_my_professional_subscription_context_v1()`.
// Le frontend NE déduit PAS l'état de l'abonnement depuis `merchants.plan_code` :
// tout vient de `state`, `subscription`, `latest_invoice` et `capabilities`.
//
// Principe financier : FlexiCash est la source de vérité du paiement. Un simple
// retour de navigateur n'est jamais une preuve de paiement — après retour on
// appelle uniquement le mécanisme `refresh` exposé par l'Edge Function, puis on
// recharge le contexte. Aucun secret / token de checkout n'est stocké
// (localStorage / sessionStorage / URL VinHT) ni journalisé.
//
// Règle commerciale figée : Professionnel = 5 000 HTG / mois (facture séparée,
// jamais déduite d'un payout vendeur) + 5 % par vente.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const PAYMENT_FN_URL = `${SUPABASE_URL}/functions/v1/vinht-professional-subscription-payment`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// État affiché quand aucune session (jamais utilisé pour "actif").
export const PRO_SUB_LOGGED_OUT = Object.freeze({
  state: "logged_out",
  message_fr: "Connectez-vous pour gérer votre abonnement Professionnel.",
  merchant: null,
  pricing: { monthly_fee_htg: 5000, commission_rate: null, per_item_fee_htg: 0, currency: "HTG" },
  subscription: null,
  latest_invoice: null,
  capabilities: {
    can_start: false,
    can_pay: false,
    can_cancel: false,
    can_reactivate: false,
    production_payments_enabled: false,
  },
});

function normalizeContext(raw) {
  const c = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const caps = (c.capabilities && typeof c.capabilities === "object") ? c.capabilities : {};
  const pricing = (c.pricing && typeof c.pricing === "object") ? c.pricing : {};
  return {
    state: c.state || "unknown",
    message_fr: c.message_fr || "",
    merchant: c.merchant || null,
    pricing: {
      monthly_fee_htg: Number(pricing.monthly_fee_htg ?? 5000),
      effective_monthly_fee_htg: Number(pricing.effective_monthly_fee_htg ?? pricing.monthly_fee_htg ?? 5000),
      commission_rate: pricing.commission_rate ?? null,
      per_item_fee_htg: Number(pricing.per_item_fee_htg ?? 0),
      currency: pricing.currency || "HTG",
    },
    launch_offer: c.launch_offer || null,
    subscription: c.subscription || null,
    latest_invoice: c.latest_invoice || null,
    capabilities: {
      can_start: caps.can_start === true,
      can_pay: caps.can_pay === true,
      can_cancel: caps.can_cancel === true,
      can_reactivate: caps.can_reactivate === true,
      production_payments_enabled: caps.production_payments_enabled === true,
    },
    // `treasury` est volontairement ignoré : le routage GES est backend-only et
    // ne doit jamais apparaître au marchand.
  };
}

// --- Source de vérité : le RPC -------------------------------------------------
export async function getProfessionalSubscriptionContext() {
  const sb = getSupabase();
  if (!sb) return { ...PRO_SUB_LOGGED_OUT, error: "not_configured" };
  const session = await getSession();
  if (!session?.user) return { ...PRO_SUB_LOGGED_OUT };
  const { data, error } = await sb.rpc("get_my_professional_subscription_context_v1");
  if (error) {
    const sig = String(error.message || error.code || "").toLowerCase();
    if (sig.includes("authentication_required") || sig.includes("jwt")) return { ...PRO_SUB_LOGGED_OUT };
    const e = new Error(error.message || "subscription_context_failed");
    e.code = error.code || "subscription_context_failed";
    throw e;
  }
  return normalizeContext(data);
}

// --- Démarrer / récupérer l'abonnement + sa facture --------------------------
// RPC `start_my_professional_subscription_v1()` -> { ok, state, reason?, invoice_id?, amount_htg?, ... }
export async function startProfessionalSubscription() {
  const sb = getSupabase();
  const session = await getSession();
  if (!sb || !session?.user) { const e = new Error("not_authenticated"); e.code = "not_authenticated"; throw e; }
  const { data, error } = await sb.rpc("start_my_professional_subscription_v1");
  if (error) {
    const e = new Error(error.message || "subscription_start_failed");
    e.code = error.code || "subscription_start_failed";
    throw e;
  }
  const r = (data && typeof data === "object") ? data : {};
  if (r.ok === false) {
    const e = new Error(String(r.reason || "subscription_start_failed"));
    e.code = String(r.reason || "subscription_start_failed");
    throw e;
  }
  return {
    ok: true,
    idempotent: r.idempotent === true,
    state: r.state || null,
    invoice_id: r.invoice_id || null,
    amount_htg: r.amount_htg ?? null,
    amount_due_htg: r.amount_due_htg ?? null,
    normal_monthly_fee_htg: r.normal_monthly_fee_htg ?? null,
    free_until: r.free_until || null,
    next_invoice_at: r.next_invoice_at || null,
    launch_offer: r.launch_offer || null,
    period_start: r.period_start || null,
    period_end: r.period_end || null,
  };
}

// --- Annuler l'abonnement ---------------------------------------------------
// L'annulation passe par l'Edge Function afin de fermer d'abord tout Hosted
// Checkout FlexiCash encore payable. Le RPC SQL direct garde un garde-fou et
// refuse le void local si une tentative provider est encore ouverte.
export async function cancelProfessionalSubscription() {
  const r = await professionalSubscriptionPayment("cancel", null);
  return {
    ok: true,
    state: r.state || null,
    cancel_at_period_end: r.cancel_at_period_end === true,
    period_end: r.period_end || null,
    immediate: r.immediate === true,
    idempotent: r.idempotent === true,
    provider_checkouts_cancelled: Number(r.provider_checkouts_cancelled || 0),
  };
}

// --- Edge Function `vinht-professional-subscription-payment` -----------------
// action : "start" | "refresh" | "cancel".
// invoice_id est obligatoire pour start/refresh et optionnel pour cancel.
//   start   -> { ok, state:"pending", hosted_checkout_url, checkout_expires_at, ... }
//              ou { ok, state:"paid", already_paid:true }
//   refresh -> { ok, state:"pending" | "paid" | "no_payment_attempt", ... }
//   cancel  -> ferme d'abord les checkouts provider puis annule/programme le plan.
// En cas d'échec : throw Error avec .code (code backend brut) et .http.
export async function professionalSubscriptionPayment(action, invoiceId) {
  if (!["start", "refresh", "cancel"].includes(action)) { const e = new Error("invalid_action"); e.code = "invalid_action"; throw e; }
  if (action !== "cancel" && !UUID_RE.test(String(invoiceId || ""))) { const e = new Error("invalid_invoice_id"); e.code = "invalid_invoice_id"; throw e; }
  if (action === "cancel" && invoiceId && !UUID_RE.test(String(invoiceId))) { const e = new Error("invalid_invoice_id"); e.code = "invalid_invoice_id"; throw e; }
  const session = await getSession();
  const token = session?.access_token;
  if (!token) { const e = new Error("not_authenticated"); e.code = "not_authenticated"; throw e; }

  let resp;
  let payload = {};
  try {
    resp = await fetch(PAYMENT_FN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceId ? { action, invoice_id: invoiceId } : { action }),
    });
    const text = await resp.text();
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  } catch {
    const e = new Error("flexicash_unreachable");
    e.code = "flexicash_unreachable";
    throw e;
  }

  if (!resp.ok || payload?.ok === false || payload?.error) {
    const e = new Error(String(payload?.error || `http_${resp.status}`));
    e.code = String(payload?.error || `http_${resp.status}`);
    e.http = resp.status;
    if (payload?.provider_error) e.provider_error = String(payload.provider_error);
    throw e;
  }

  return {
    ok: true,
    state: String(payload?.state || ""),
    invoice_id: payload?.invoice_id || invoiceId,
    payment_id: payload?.payment_id || null,
    // URL de checkout hébergé FlexiCash : utilisée telle quelle pour la
    // redirection, jamais stockée ni journalisée.
    hosted_checkout_url: payload?.hosted_checkout_url ? String(payload.hosted_checkout_url) : null,
    checkout_expires_at: payload?.checkout_expires_at || null,
    already_paid: payload?.already_paid === true,
    reused: payload?.reused === true,
    provider_status: payload?.provider_status || null,
    settlement_status: payload?.settlement_status || null,
    subscription: payload?.subscription || null,
    treasury: payload?.treasury || null,
    cancel_at_period_end: payload?.cancel_at_period_end === true,
    period_end: payload?.period_end || null,
    immediate: payload?.immediate === true,
    idempotent: payload?.idempotent === true,
    provider_checkouts_cancelled: Number(payload?.provider_checkouts_cancelled || 0),
  };
}

// --- Messages utilisateur (jamais de code brut, jamais de terme interne) -----
const CODE_FR = {
  not_authenticated: "Votre session a expiré. Reconnectez-vous à VinHT.",
  authentication_required: "Votre session a expiré. Reconnectez-vous à VinHT.",
  merchant_required: "Vous devez disposer d'un espace marchand VinHT.",
  merchant_not_active: "Votre espace marchand doit être actif pour gérer l'abonnement Professionnel.",
  professional_plan_inactive: "Le plan Professionnel n'est pas disponible pour le moment.",
  invoice_not_found: "La facture d'abonnement est introuvable.",
  invalid_professional_invoice: "Cette facture n'est pas une facture d'abonnement Professionnel valide.",
  invoice_closed: "Cette facture d'abonnement a été clôturée.",
  invoice_not_payable: "Cette facture n'est pas payable pour le moment.",
  production_subscription_payments_disabled: "Le paiement de l'abonnement n'est pas encore disponible dans cet environnement.",
  flexicash_not_configured: "Le paiement FlexiCash n'est pas encore configuré. Réessayez plus tard.",
  billing_policy_unavailable: "Le service d'abonnement est momentanément indisponible. Réessayez plus tard.",
  backend_not_configured: "Le service d'abonnement est momentanément indisponible. Réessayez plus tard.",
  flexicash_unreachable: "FlexiCash est temporairement indisponible. Réessayez plus tard.",
  flexicash_rejected_request: "FlexiCash a refusé la demande de paiement. Réessayez plus tard.",
  flexicash_payment_lookup_failed: "Impossible de vérifier le paiement auprès de FlexiCash. Réessayez dans un instant.",
  provider_payment_id_mismatch: "La vérification du paiement a échoué. Contactez le support VinHT.",
  provider_payment_amount_mismatch: "Le montant du paiement ne correspond pas à la facture. Contactez le support VinHT.",
  provider_payment_environment_mismatch: "La vérification du paiement a échoué. Contactez le support VinHT.",
  invalid_provider_response: "VinHT a reçu une réponse FlexiCash invalide. Réessayez.",
  payment_attempt_reservation_failed: "Impossible de réserver le checkout de manière sûre. Réessayez.",
  provider_checkout_recovery_required: "VinHT doit d'abord vérifier l'ancien checkout FlexiCash avant d'annuler. Réessayez dans un instant.",
  provider_checkout_recovery_failed: "Impossible de récupérer l'ancien checkout FlexiCash. Réessayez dans un instant.",
  provider_checkout_recovery_mismatch: "L'ancien checkout FlexiCash ne correspond pas à la facture. Contactez le support VinHT.",
  provider_payment_already_final: "Ce paiement semble déjà finalisé chez FlexiCash. VinHT ne peut pas annuler la facture avant vérification.",
  provider_payment_reconciliation_pending: "Ce checkout FlexiCash est déjà en cours de vérification. VinHT ne créera pas un deuxième checkout. Réessayez après la prochaine vérification.",
  provider_checkout_cancel_not_confirmed: "FlexiCash n'a pas confirmé l'annulation du checkout. La facture VinHT reste ouverte par sécurité.",
  provider_checkout_cancelled_during_creation: "Le checkout a été annulé pendant sa création. Actualisez l'abonnement.",
  payment_reconciliation_required: "Ce paiement est déjà en cours de traitement financier. Une vérification est nécessaire avant toute annulation.",
  provider_checkout_cancellation_required: "Le checkout FlexiCash doit être fermé avant l'annulation de la facture.",
  subscription_cancel_failed: "L'annulation de l'abonnement n'a pas pu être finalisée. Réessayez.",
  subscription_activation_failed: "Le paiement est passé mais l'activation tarde. Actualisez dans un instant.",
  invalid_invoice_id: "Référence de facture invalide.",
  invalid_action: "Action d'abonnement invalide.",
};

export function subscriptionErrorMessageFr(err, fallback = "Une erreur est survenue avec l'abonnement. Réessayez plus tard.") {
  if (err && err.message_fr) return String(err.message_fr);
  const code = String((err && (err.code || err.message)) || "").toLowerCase();
  for (const key of Object.keys(CODE_FR)) if (code.includes(key)) return CODE_FR[key];
  if (code.includes("network") || code.includes("timeout") || code.includes("fetch")) return CODE_FR.flexicash_unreachable;
  return fallback;
}
