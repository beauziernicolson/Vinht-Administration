// Solde et cash-flow FlexiCash professionnel marchand (Feature #14).
// FRONTEND UNIQUEMENT — VinHT ne possède pas ce solde, il le lit via le
// backend sécurisé (vinht-merchant-flexicash-wallet), qui interroge
// FlexiCash serveur->serveur. Aucun calcul de solde ici, aucune persistance
// autoritaire côté navigateur (jamais dans localStorage).

import { getSession } from "./auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const WALLET_FN_URL = `${SUPABASE_URL}/functions/v1/vinht-merchant-flexicash-wallet`;

// Retourne toujours la réponse backend telle quelle (normalisée a minima) :
//   { available:true, ...soldes, movements:[...] }
//   { available:false, reason, message_fr, ... }  (démo, pas de connexion, profil pro manquant/non actif…)
// Lève une erreur uniquement pour les échecs réseau/auth durs.
export async function getMerchantFlexicashWallet() {
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
    resp = await fetch(WALLET_FN_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
    });
    const text = await resp.text();
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  } catch {
    const e = new Error("flexicash_unreachable");
    e.code = "flexicash_unreachable";
    throw e;
  }

  if (!resp.ok || payload?.success === false) {
    const e = new Error(payload?.message_fr || "Impossible de charger le solde FlexiCash.");
    e.code = payload?.error || `http_${resp.status}`;
    e.message_fr = payload?.message_fr || null;
    throw e;
  }

  return payload; // { success:true, available, ...  }
}

export function walletErrorMessageFr(err, fallback = "Impossible de charger le solde FlexiCash. Réessayez.") {
  if (err && err.message_fr) return String(err.message_fr);
  const code = String((err && (err.code || err.message)) || "").toLowerCase();
  if (code.includes("not_authenticated")) return "Reconnectez-vous pour voir votre solde FlexiCash.";
  if (code.includes("unreachable") || code.includes("backend")) return "FlexiCash est temporairement indisponible. Réessayez dans quelques instants.";
  return fallback;
}
