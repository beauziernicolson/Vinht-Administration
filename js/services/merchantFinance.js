// Service Dashboard financier marchand (Feature #8 — FRONTEND VinHT uniquement).
//
// Le backend est la SEULE autorité : montants, commission, frais, payouts,
// abonnement, totaux et périodes viennent des RPC ci-dessous. Le frontend ne
// calcule aucun montant faisant foi et n'invente aucun "solde VinHT".
//
// Contrats backend réellement utilisés (projet Supabase VinHT) :
//   get_my_financial_dashboard_v1(p_from, p_to)                        -> jsonb
//   list_my_financial_activity_v1(p_from, p_to, p_limit, p_offset)     -> jsonb
//   export_my_financial_activity_csv_v1(p_from, p_to)                  -> jsonb
//
// Périodes : défaut backend = 30 j, maximum = 366 j.
// Erreurs backend : invalid_financial_period, financial_period_too_large,
//                   authentication_required.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function financeRpc(name, args) {
  const sb = getSupabase();
  if (!sb) throw new Error("supabase-not-configured");
  const session = await getSession();
  if (!session || !session.user) throw new Error("not-authenticated");
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

// Presets de période exposés au marchand (le "Personnalisé" ouvre 2 dates).
export const FINANCE_PERIOD_PRESETS = [
  { key: "7", label: "7 jours", days: 7 },
  { key: "30", label: "30 jours", days: 30 },
  { key: "90", label: "90 jours", days: 90 },
  { key: "custom", label: "Personnalisé", days: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Fenêtre glissante [maintenant - N jours ; maintenant].
export function presetRange(days) {
  const to = new Date();
  const from = new Date(to.getTime() - Number(days) * DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Deux dates "YYYY-MM-DD" (locales) -> bornes ISO inclusives.
export function customRange(fromDateStr, toDateStr) {
  const from = new Date(`${fromDateStr}T00:00:00`);
  const to = new Date(`${toDateStr}T23:59:59.999`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const e = new Error("invalid_financial_period");
    e.code = "invalid_financial_period";
    throw e;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// --- RPC ------------------------------------------------------------------
export function getFinancialDashboard({ from = null, to = null } = {}) {
  return financeRpc("get_my_financial_dashboard_v1", { p_from: from, p_to: to });
}

// Backend : limite max 200 lignes par appel.
export function listFinancialActivity({ from = null, to = null, limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  return financeRpc("list_my_financial_activity_v1", {
    p_from: from,
    p_to: to,
    p_limit: lim,
    p_offset: off,
  });
}

// Backend : renvoie { content, filename, mime_type, row_count, truncated, max_rows }.
// Le CSV n'est JAMAIS reconstruit côté navigateur.
export function exportFinancialActivityCsv({ from = null, to = null } = {}) {
  return financeRpc("export_my_financial_activity_csv_v1", { p_from: from, p_to: to });
}

// --- Messages FR --------------------------------------------------------
export function financeErrorMessageFr(err, fallback = "Impossible de charger vos finances. Réessayez.") {
  const code = String((err && (err.message || err.code || err)) || "").toLowerCase();
  if (code.includes("invalid_financial_period"))
    return "Période invalide : la date de début doit précéder la date de fin.";
  if (code.includes("financial_period_too_large"))
    return "Période trop large : 366 jours maximum. Réduisez l'intervalle.";
  if (code.includes("authentication_required") || code.includes("not-authenticated") || code.includes("jwt"))
    return "Reconnectez-vous pour consulter vos finances.";
  if (code.includes("supabase-not-configured"))
    return "Service indisponible : configuration manquante.";
  return fallback;
}
