import { getSession } from "./auth.js";

function paymentErrorMessage(code) {
  const c = String(code || "");
  if (c === "flexicash_not_configured") return "Le service de paiement n'est pas encore configuré côté serveur.";
  if (c === "order_already_paid") return "Cette commande est déjà payée.";
  if (c === "order_not_found") return "Commande introuvable ou inaccessible.";
  if (c === "order_not_flexicash" || c === "order_not_flexicash_platform") return "Cette commande n'utilise pas un paiement Platform pris en charge.";
  if (c === "payment_method_not_available") return "Ce moyen de paiement n'est pas disponible pour la devise de cette commande.";
  if (c === "usd_demo_not_enabled") return "Les paiements USD ne sont pas activés en mode Demo.";
  if (/unreachable|backend/.test(c)) return "Le service de paiement est momentanément indisponible.";
  return "Impossible de démarrer le paiement. Réessayez.";
}

export async function createPlatformPayment(orderId, providedSession = null) {
  const session = providedSession || (await getSession());
  const token = session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const response = await fetch("/api/flexicash/create-payment", {
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
    const error = new Error(paymentErrorMessage(data?.error));
    error.code = data?.error || `http_${response.status}`;
    throw error;
  }

  // On privilégie le Hosted Checkout FlexiCash (panneau sécurisé) et on retombe
  // sur checkout_url si besoin. VinHT ne lit jamais de mot de passe / PIN.
  const checkoutUrl = String(data?.hosted_checkout_url || data?.checkout_url || "").trim();
  try {
    const parsed = new URL(checkoutUrl);
    if (parsed.protocol !== "https:") throw new Error("not_https");
  } catch {
    throw new Error("Réponse FlexiCash invalide : URL de paiement absente.");
  }

  return data;
}

export async function createFlexiCashPayment(orderId, providedSession = null) {
  return createPlatformPayment(orderId, providedSession);
}

export async function getPlatformPaymentMethods(currency, environment = "production", providedSession = null) {
  const session = providedSession || (await getSession());
  const token = session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!["HTG", "USD"].includes(normalizedCurrency)) throw new Error("invalid_currency");

  const response = await fetch("/api/flexicash/payment-methods", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currency: normalizedCurrency,
      environment: String(environment || "production").toLowerCase(),
    }),
  });

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok || data?.success !== true) {
    const error = new Error(paymentErrorMessage(data?.error || `http_${response.status}`));
    error.code = data?.error || `http_${response.status}`;
    throw error;
  }

  const methods = Array.isArray(data?.methods) ? data.methods : [];
  return {
    currency: normalizedCurrency,
    environment: data?.environment || environment,
    methods: methods.filter((m) => m && m.method_code && m.available !== false),
  };
}

// Vérification serveur du paiement. Le navigateur n'envoie QUE order_id ; le
// backend interroge FlexiCash serveur->serveur et applique le règlement si
// (et seulement si) le provider confirme settled/settled. Jamais de "paid"
// décidé côté navigateur.
export async function verifyFlexiCashPayment(orderId, providedSession = null) {
  const session = providedSession || (await getSession());
  const token = session?.access_token;
  if (!token) throw new Error("not_authenticated");

  const response = await fetch("/api/flexicash/verify-payment", {
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
    const error = new Error(paymentErrorMessage(data?.error));
    error.code = data?.error || `http_${response.status}`;
    throw error;
  }
  return data;
}
