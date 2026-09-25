// Connexion FlexiCash marchand (Feature #3) — frontend uniquement.
//
// SOURCE DE VÉRITÉ : le RPC `get_my_flexicash_connection_context_v1()`.
// Le frontend NE lit JAMAIS la table `merchant_flexicash_connections` et
// n'invente aucun état / aucune permission : tout vient de `state` + `capabilities`.
//
// Sécurité : VinHT ne demande jamais mot de passe / PIN / MFA FlexiCash. Le
// `connect_url` est construit par l'Edge Function ; le frontend se contente de
// rediriger le navigateur dessus. Le `connect_token` n'est jamais lu, parsé,
// stocké (localStorage / sessionStorage / URL VinHT) ni journalisé.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const CONNECT_FN_URL = `${SUPABASE_URL}/functions/v1/vinht-flexicash-merchant-connect`;

// État affiché quand rien n'est disponible (jamais utilisé pour "connecté").
export const FLEXICASH_LOGGED_OUT = Object.freeze({
  version: 2,
  merchant: null,
  connection: null,
  state: { code: "logged_out", title: "Connexion requise", message: "Connectez-vous pour gérer votre compte FlexiCash." },
  capabilities: { can_start_connection: false, can_refresh: false, can_regenerate_invite: false, payout_ready: false },
});

function normalizeContext(raw) {
  const c = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const st = (c.state && typeof c.state === "object") ? c.state : {};
  const caps = (c.capabilities && typeof c.capabilities === "object") ? c.capabilities : {};
  return {
    version: Number(c.version) || 2,
    merchant: c.merchant || null,
    connection: c.connection || null,
    state: {
      code: st.code || "unknown",
      title: st.title || "État FlexiCash",
      message: st.message || "",
    },
    capabilities: {
      can_start_connection: caps.can_start_connection === true,
      can_refresh: caps.can_refresh === true,
      can_regenerate_invite: caps.can_regenerate_invite === true,
      payout_ready: caps.payout_ready === true,
    },
  };
}

// --- Source de vérité : le RPC ---------------------------------------------
export async function getMyFlexicashConnectionContext() {
  const sb = getSupabase();
  if (!sb) return { ...FLEXICASH_LOGGED_OUT, error: "not_configured" };
  const session = await getSession();
  if (!session?.user) return { ...FLEXICASH_LOGGED_OUT };
  const { data, error } = await sb.rpc("get_my_flexicash_connection_context_v1");
  if (error) {
    const sig = String(error.message || error.code || "").toLowerCase();
    if (sig.includes("authentication_required") || sig.includes("jwt")) return { ...FLEXICASH_LOGGED_OUT };
    const e = new Error(error.message || "flexicash_context_failed");
    e.code = error.code || "flexicash_context_failed";
    throw e;
  }
  return normalizeContext(data);
}

// --- Edge Function `vinht-flexicash-merchant-connect` --------------------
// action : "start" | "refresh". Retourne { success, action, connect_url?, context }.
// En cas d'échec : throw Error avec .code et .message_fr (message backend prêt).
export async function flexicashMerchantConnect(action) {
  if (!["start", "refresh"].includes(action)) throw new Error("invalid_action");
  const session = await getSession();
  const token = session?.access_token;
  if (!token) {
    const e = new Error("not_authenticated");
    e.code = "not_authenticated";
    throw e;
  }

  let resp;
  let payload = {};
  try {
    resp = await fetch(CONNECT_FN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
    const text = await resp.text();
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  } catch {
    const e = new Error("flexicash_unreachable");
    e.code = "flexicash_unreachable";
    e.message_fr = "FlexiCash est temporairement indisponible. Réessayez plus tard.";
    throw e;
  }

  if (!resp.ok || payload?.success === false) {
    const e = new Error(String(payload?.error || `http_${resp.status}`));
    e.code = String(payload?.error || `http_${resp.status}`);
    // Le backend fournit déjà un message FR propre (sans terme interne).
    if (payload?.message_fr) e.message_fr = String(payload.message_fr);
    throw e;
  }

  return {
    success: true,
    action: String(payload?.action || action),
    connect_url: payload?.connect_url ? String(payload.connect_url) : null,
    context: payload?.context ? normalizeContext(payload.context) : null,
  };
}

// --- Messages utilisateur (jamais de code brut, jamais de terme interne) --
const CODE_FR = {
  not_authenticated: "Votre session a expiré. Reconnectez-vous à VinHT.",
  authentication_required: "Votre session a expiré. Reconnectez-vous à VinHT.",
  merchant_not_found: "Aucun compte marchand VinHT n'est associé à ce compte.",
  merchant_required: "Vous devez disposer d'un compte marchand VinHT avant de connecter FlexiCash.",
  merchant_not_active: "Votre espace marchand doit être actif avant de connecter FlexiCash.",
  invalid_merchant_environment: "L'environnement de votre boutique ne permet pas cette connexion pour l'instant.",
  flexicash_provider_not_configured: "La connexion FlexiCash n'est pas encore configurée. Réessayez plus tard.",
  flexicash_seller_scope_required: "La connexion FlexiCash est temporairement indisponible. Réessayez plus tard.",
  flexicash_unreachable: "FlexiCash est temporairement indisponible. Réessayez plus tard.",
  flexicash_rejected_connection: "FlexiCash a refusé la demande de connexion. Réessayez plus tard.",
  flexicash_connection_not_found: "La connexion n'a pas été retrouvée. Vous pouvez générer une nouvelle invitation.",
  flexicash_invalid_response: "VinHT a reçu une réponse FlexiCash invalide. Réessayez.",
  invalid_action: "Action FlexiCash invalide.",
};

export function flexicashConnectErrorMessage(err, fallback = "Une erreur est survenue avec FlexiCash. Réessayez plus tard.") {
  if (err && err.message_fr) return String(err.message_fr);
  const code = String((err && (err.code || err.message)) || "").toLowerCase();
  for (const key of Object.keys(CODE_FR)) if (code.includes(key)) return CODE_FR[key];
  if (code.includes("network") || code.includes("timeout") || code.includes("fetch")) return CODE_FR.flexicash_unreachable;
  return fallback;
}
