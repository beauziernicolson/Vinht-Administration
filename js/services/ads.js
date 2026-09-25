import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { getAnalyticsSessionHash, createClientEventId } from "./analyticsSession.js";

// Feature #29 — Publicité self-service marchand / Sponsored Products.
// Le moteur publicitaire backend existe déjà (marketplace_ads_runtime /
// marketplace_ad_campaigns / marketplace_ad_events / ...) : ce module
// n'accède JAMAIS directement à ces tables, uniquement aux RPC officielles.
// service_confirm_ad_campaign_funding_v1 est SERVICE ONLY — jamais appelée
// depuis ce fichier ni depuis le navigateur.

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session?.user) throw new Error("merchant_authentication_required");
  return { sb, user: session.user };
}

export const AD_PLACEMENTS = ["search", "category", "product_page", "home"];

export const AD_CAMPAIGN_STATUSES = [
  "draft", "pending_funding", "scheduled", "active", "paused", "exhausted", "ended", "cancelled",
];
export const AD_FUNDING_STATUSES = ["unfunded", "pending", "funded", "failed", "refunded"];

export const AD_CAMPAIGN_STATUS_FR = {
  draft: "Brouillon",
  pending_funding: "En attente de financement",
  scheduled: "Planifiée",
  active: "Active",
  paused: "En pause",
  exhausted: "Budget épuisé",
  ended: "Terminée",
  cancelled: "Annulée",
};

export const AD_FUNDING_STATUS_FR = {
  unfunded: "Non financée",
  pending: "Financement en cours",
  funded: "Financée",
  failed: "Échec du financement",
  refunded: "Remboursée",
};

export const AD_PLACEMENT_FR = {
  search: "Recherche",
  category: "Catégorie",
  product_page: "Fiche produit",
  home: "Accueil",
};

// Erreurs composées éventuelles ("prefix:detail") : on ne connaît aujourd'hui
// aucun code d'erreur Ads composé documenté par le backend — on retombe donc
// simplement sur le code complet, jamais une reconstruction inventée.
export function adsErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  const map = {
    merchant_authentication_required: "Connectez-vous en tant que marchand pour continuer.",

    ads_feature_disabled: "La publicité VinHT n'est pas encore activée.",
    ads_funding_provider_not_ready: "Le financement publicitaire FlexiCash n'est pas encore disponible.",

    invalid_ad_placements: "Sélectionnez entre 1 et 4 emplacements valides (recherche, catégorie, fiche produit, accueil).",
    invalid_ad_placement: "Emplacement publicitaire invalide.",

    ad_budget_out_of_bounds: "Le budget total est hors des limites autorisées.",
    invalid_daily_ad_budget: "Le budget journalier est invalide (doit être supérieur à 0 et ne pas dépasser le budget total).",

    invalid_campaign_dates: "Dates de campagne invalides (la fin doit être après le début).",
    campaign_duration_too_long: "La durée de la campagne dépasse la limite autorisée.",

    product_not_found: "Ce produit est introuvable.",
    approved_active_product_required: "Le produit doit être approuvé et actif pour être sponsorisé.",
    active_owned_offer_required: "L'offre sélectionnée doit être active et vous appartenir pour ce produit.",
    merchant_not_authorized_for_product: "Vous n'êtes pas autorisé à sponsoriser ce produit.",

    ad_campaign_not_found: "Cette campagne est introuvable.",
    ad_campaign_not_funded: "Cette campagne n'est pas encore financée.",
    ad_campaign_not_startable: "Cette campagne ne peut pas être démarrée dans son état actuel.",
    ad_campaign_expired: "Cette campagne est expirée.",

    sponsored_product_not_eligible: "Ce produit n'est plus éligible à la publicité sponsorisée.",
    merchant_not_ads_eligible: "Votre boutique n'est actuellement pas éligible à la publicité VinHT en raison de son état Seller Health.",

    ad_campaign_not_pauseable: "Cette campagne ne peut pas être mise en pause dans son état actuel.",
    ad_campaign_not_cancellable: "Cette campagne ne peut plus être annulée.",

    invalid_session_hash: "Session de suivi invalide.",

    admin_role_required: "Rôle administrateur requis.",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

// --- Capacités (publique — jamais d'exigence de session) ------------------

export async function getMarketplaceAdsCapabilities() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_marketplace_ads_capabilities_v1", {});
  if (error) throw error;
  return data;
}

// --- Marchand : gestion de mes campagnes -----------------------------------

export async function createMyAdCampaign({
  name, productId, offerId = null, placements, totalBudgetHtg, dailyBudgetHtg = null,
  startAt, endAt,
}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("create_my_ad_campaign_v1", {
    p_name: name,
    p_product_id: productId,
    p_offer_id: offerId || null,
    p_placements: placements,
    p_total_budget_htg: totalBudgetHtg,
    p_daily_budget_htg: dailyBudgetHtg,
    p_start_at: startAt,
    p_end_at: endAt,
  });
  if (error) throw error;
  return data;
}

export async function listMyAdCampaigns({ status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_ad_campaigns_v1", {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  // Cette RPC ne retourne PAS total/has_more aujourd'hui — ne jamais les
  // inventer. La pagination se déduit uniquement de rows.length vs limit.
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    capabilities: d.capabilities || null,
  };
}

export async function getMyAdCampaignDashboard(campaignId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_my_ad_campaign_dashboard_v1", { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}

export async function startMyAdCampaign(campaignId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("start_my_ad_campaign_v1", { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}

export async function pauseMyAdCampaign(campaignId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("pause_my_ad_campaign_v1", { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}

export async function cancelMyAdCampaign(campaignId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("cancel_my_ad_campaign_v1", { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}

// --- Public / Sponsored Products -------------------------------------------

export async function getSponsoredProductSlots({ placement, search = null, categoryId = null, contextProductId = null, limit = 12 } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_sponsored_product_slots_v1", {
    p_placement: placement,
    p_search: search || null,
    p_category_id: categoryId || null,
    p_context_product_id: contextProductId || null,
    p_limit: Math.min(12, limit || 12),
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    enabled: !!d.enabled,
    availability: d.availability || "coming_soon",
    rows: Array.isArray(d.rows) ? d.rows : [],
    messageFr: d.message_fr || null,
  };
}

// Télémétrie pure — un échec ne doit jamais bloquer l'affichage ou la
// navigation buyer (fail-open). Les raisons non-exception (ads_feature_disabled,
// campaign_not_servable, duplicate_client_event) ne sont pas des erreurs UX.
export async function recordSponsoredProductImpression({ campaignId, placement, context = {} }) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const sessionHash = await getAnalyticsSessionHash();
    const { data, error } = await sb.rpc("record_sponsored_product_impression_v1", {
      p_campaign_id: campaignId,
      p_placement: placement,
      p_session_hash: sessionHash,
      p_client_event_id: createClientEventId(),
      p_context: context || {},
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function recordSponsoredProductClick({ campaignId, placement, context = {} }) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const sessionHash = await getAnalyticsSessionHash();
    const { data, error } = await sb.rpc("record_sponsored_product_click_v1", {
      p_campaign_id: campaignId,
      p_placement: placement,
      p_session_hash: sessionHash,
      p_client_event_id: createClientEventId(),
      p_context: context || {},
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// --- Admin ------------------------------------------------------------------

export async function adminListAdCampaigns({ status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_list_ad_campaigns_v1", {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? 0,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
    state: d.state,
    environment: d.environment,
  };
}
