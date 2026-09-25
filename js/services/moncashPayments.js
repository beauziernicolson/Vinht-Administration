// Parcours MonCash — Feature #10 frontend uniquement.
//
// Mêmes garanties que FlexiCash : VinHT ne lit et ne demande jamais de PIN /
// mot de passe MonCash ; le paiement se fait entièrement sur l'interface
// officielle MonCash (moncashbutton.digicelgroup.com) ; le navigateur
// n'envoie que order_id ; "payé" n'est JAMAIS décidé côté navigateur — seul
// /api/moncash/verify-payment (qui interroge le backend serveur->serveur)
// fait foi.
//
// Backend réel utilisé : Edge Functions Supabase déjà déployées
// vinht-moncash-create-payment / vinht-moncash-verify-payment, via les
// proxys Vercel /api/moncash/* (même schéma que /api/flexicash/*).

import { getSession } from "./auth.js";

// Domaines officiels MonCash (Digicel) : le backend ne devrait jamais
// renvoyer autre chose, mais on ne fait jamais confiance à une URL de
// paiement sans la vérifier — un domaine inattendu ne doit jamais être ouvert
// comme "paiement sécurisé MonCash".
const OFFICIAL_MONCASH_HOSTS = new Set([
  "moncashbutton.digicelgroup.com",
  "sandbox.moncashbutton.digicelgroup.com",
]);

function assertOfficialMoncashCheckoutUrl(url) {
  const value = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Réponse MonCash invalide : URL de paiement absente.");
  }
  if (parsed.protocol !== "https:" || !OFFICIAL_MONCASH_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Réponse MonCash invalide : domaine de paiement non officiel.");
  }
  return parsed.href;
}

function moncashErrorMessage(code) {
  const c = String(code || "");
  if (c === "order_already_paid") return "Cette commande est déjà payée.";
  if (c === "order_not_found") return "Commande introuvable ou inaccessible.";
  if (c === "order_not_moncash") return "Cette commande n'utilise pas MonCash.";
  if (c === "order_payment_closed")
    return "Cette commande n'accepte plus de paiement (remboursée, annulée ou close).";
  if (c === "invalid_order_environment") return "Environnement de commande invalide.";
  if (c === "moncash_production_locked")
    return "Le paiement MonCash en production n'est pas encore activé.";
  if (c === "payment_initializing")
    return "Une tentative de paiement MonCash est déjà en cours. Patientez quelques secondes puis réessayez.";
  if (c === "moncash_not_ready") return "MonCash a refusé la demande de paiement. Réessayez dans un instant.";
  if (c === "flexicash_not_configured" || c === "flexicash_sandbox_not_configured")
    return "Le paiement MonCash n'est pas encore configuré côté serveur.";
  if (/platform_allocation_failed|connected_seller|demo_payout_number_missing|production_platform/.test(c))
    return "Le paiement MonCash est temporairement indisponible pour cette boutique.";
  if (c === "invalid_moncash_checkout_url" || c === "invalid_platform_payment_response" || c === "platform_provider_response_mismatch")
    return "Réponse MonCash invalide. Réessayez.";
  if (c === "not_authenticated") return "Reconnectez-vous puis réessayez le paiement.";
  if (/unreachable|backend/.test(c)) return "Le service de paiement est momentanément indisponible.";
  return "Impossible de démarrer le paiement MonCash. Réessayez.";
}

// Démarre (ou reprend, idempotent) un paiement MonCash pour une commande déjà
// créée. Retourne { checkout_url, checkout_expires_at, ... } — jamais de
// montant recalculé ici, jamais de mot de passe/PIN.
export async function createMoncashPayment(orderId, providedSession = null) {
  const session = providedSession || (await getSession());
  const token = session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const response = await fetch("/api/moncash/create-payment", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId }),
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(moncashErrorMessage(data?.error));
    error.code = data?.error || `http_${response.status}`;
    throw error;
  }

  const checkoutUrl = assertOfficialMoncashCheckoutUrl(data?.checkout_url);
  return { ...data, checkout_url: checkoutUrl };
}

// Vérification serveur du paiement MonCash. Le navigateur n'envoie QUE
// order_id ; le backend interroge FlexiCash/MonCash serveur->serveur et
// applique le règlement uniquement si le provider confirme "settled".
export async function verifyMoncashPayment(orderId, providedSession = null) {
  const session = providedSession || (await getSession());
  const token = session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const response = await fetch("/api/moncash/verify-payment", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ order_id: orderId }),
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(moncashErrorMessage(data?.error));
    error.code = data?.error || `http_${response.status}`;
    throw error;
  }
  return data;
}
