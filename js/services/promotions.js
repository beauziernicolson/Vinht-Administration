import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

// Feature #28 — Coupons / Promotions marchands
// (promotion_management_contract_v2 / promotion_admin_runtime_read_v3).
// Toutes les lectures/écritures passent par les RPC officielles — jamais
// d'accès direct à merchant_promotions / merchant_promotion_runtime /
// merchant_promotion_redemptions.

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session?.user) throw new Error("merchant_authentication_required");
  return { sb, user: session.user };
}

export const PROMOTION_MODES = ["code", "automatic"];
export const PROMOTION_DISCOUNT_TYPES = ["percent", "fixed_htg"];
export const PROMOTION_SCOPE_TYPES = ["all", "products", "offers", "categories"];
export const PROMOTION_STATUSES = ["draft", "active", "paused", "disabled"];
export const PROMOTION_PRICING_TIERS = ["retail", "wholesale"];

export const PROMOTION_STATUS_FR = { draft: "Brouillon", active: "Active", paused: "En pause", disabled: "Désactivée" };
export const PROMOTION_SCOPE_FR = { all: "Tout le catalogue", products: "Produits sélectionnés", offers: "Offres sélectionnées", categories: "Catégories sélectionnées" };
export const PROMOTION_DISCOUNT_TYPE_FR = { percent: "Pourcentage", fixed_htg: "Montant fixe (HTG)" };
export const PROMOTION_MODE_FR = { code: "Code promo", automatic: "Automatique" };

// Erreurs composées "prefix:CODE[:reason]" — règles exactes :
//  - promotion_not_eligible:CODE:reason      -> raison = dernier segment (reason)
//  - promotion_became_ineligible:CODE        -> raison = préfixe lui-même (le code n'est pas une raison)
//  - promotion_code_invalid:CODE             -> raison = préfixe lui-même (le code n'est pas une raison)
const COMPOUND_REASON_PREFIXES = new Set(["promotion_not_eligible"]);
export function parsePromotionErrorCode(code) {
  const raw = String(code || "").trim();
  const parts = raw.split(":");
  const prefix = parts[0];
  if (parts.length > 1 && COMPOUND_REASON_PREFIXES.has(prefix)) {
    return parts[parts.length - 1];
  }
  return prefix || raw;
}

export function promotionErrorMessageFr(code, fallback) {
  const c = parsePromotionErrorCode(code);
  const map = {
    merchant_authentication_required: "Connectez-vous en tant que marchand pour continuer.",
    promotions_disabled: "Les promotions sont actuellement désactivées par VinHT.",
    automatic_promotions_disabled: "Le mode automatique n'est pas encore activé par VinHT.",
    automatic_promotions_requires_promotions_enabled: "Activez d'abord les promotions avant d'activer les promotions automatiques.",

    invalid_promotion_mode: "Mode de promotion invalide.",
    invalid_promotion_code: "Le code promo doit contenir 3 à 32 caractères, commencer par une lettre ou un chiffre et utiliser uniquement A-Z, 0-9, _ ou -.",
    promotion_code_already_exists: "Ce code promo existe déjà.",

    invalid_promotion_name: "Le nom de la promotion est invalide.",
    invalid_discount_type: "Type de remise invalide.",
    invalid_discount_value: "Valeur de remise invalide (strictement positive ; pourcentage : maximum 95 %).",
    invalid_max_discount: "Plafond de remise invalide.",

    invalid_min_subtotal: "Sous-total minimum invalide.",
    invalid_min_quantity: "Quantité minimum invalide.",

    invalid_promotion_dates: "Dates de promotion invalides (la fin doit être après le début).",
    promotion_duration_too_long: "La durée de la promotion ne peut pas dépasser 366 jours.",

    invalid_pricing_tiers: "Sélectionnez au moins un type de prix (détail ou gros).",
    invalid_total_usage_limit: "Limite totale d'utilisation invalide.",
    invalid_per_user_usage_limit: "Limite par utilisateur invalide (1 à 100).",
    usage_limit_below_existing_redemptions: "Cette limite totale est inférieure au nombre d'utilisations déjà réservées ou consommées.",

    promotion_limit_reached: "Vous avez atteint le nombre maximum de promotions en cours (brouillon, active ou en pause).",
    promotion_not_found: "Cette promotion est introuvable.",
    invalid_promotion_status: "Statut de promotion invalide.",
    promotion_already_expired: "Cette promotion est déjà expirée.",
    invalid_scope_type: "Périmètre de promotion invalide.",

    pause_promotion_before_edit: "Mettez cette promotion en pause avant de la modifier.",
    pause_promotion_before_scope_change: "Mettez cette promotion en pause avant de changer son périmètre.",
    promotion_scope_not_configured: "Le périmètre de cette promotion n'est pas encore configuré.",

    product_scope_required: "Sélectionnez au moins un produit.",
    offer_scope_required: "Sélectionnez au moins une offre.",
    category_scope_required: "Sélectionnez au moins une catégorie.",

    invalid_product_scope: "Sélection de produits invalide.",
    invalid_offer_scope: "Sélection d'offres invalide.",
    invalid_category_scope: "Sélection de catégories invalide.",

    promotion_code_invalid: "Ce code promo n'existe pas ou n'est plus valide.",
    promotion_not_active: "Cette promotion n'est plus active.",
    no_eligible_items: "Aucun article du panier n'est éligible à ce code.",
    minimum_subtotal_not_met: "Le sous-total minimum requis pour ce code n'est pas atteint.",
    minimum_quantity_not_met: "La quantité minimum requise pour ce code n'est pas atteinte.",
    promotion_economic_guard_failed: "Ce code ne peut pas être appliqué (garde-fou économique).",
    promotion_usage_limit_reached: "Ce code promo a atteint sa limite totale d'utilisation.",
    promotion_user_limit_reached: "Vous avez déjà atteint la limite d'utilisation de ce code.",
    promotion_would_zero_line: "Cette promotion ne peut pas ramener un article à zéro.",
    platform_commission_cannot_fund_flexicash_discount: "Cette combinaison de promotion et de rabais FlexiCash ne peut pas être appliquée.",
    promotion_discount_allocation_mismatch: "Impossible de répartir correctement cette remise. Réessayez.",

    multiple_promotions_same_merchant_not_allowed: "Un seul code promo par marchand peut être appliqué en même temps.",
    promotion_became_ineligible: "Ce code n'est plus applicable à votre panier — retirez-le ou revalidez.",

    cart_is_empty: "Votre panier est vide.",
    invalid_quantity: "Une quantité du panier est invalide.",
    marketplace_offer_unavailable: "Une offre de votre panier n'est plus disponible.",
    offer_wholesale_unavailable: "Le tarif gros demandé n'est plus disponible pour une offre du panier.",
    pricing_unavailable: "Le prix d'un article du panier n'est plus disponible.",
    product_unavailable: "Un produit du panier n'est plus disponible.",
    unsupported_payment_method: "Ce moyen de paiement n'est pas pris en charge pour cette commande.",

    admin_role_required: "Rôle administrateur requis.",
    reason_required: "Un motif est requis.",
    invalid_environment: "Environnement invalide.",
  };
  return map[c] || fallback || "Une erreur est survenue.";
}

const ORDER_TIME_PROMOTION_CODES = new Set([
  "promotion_usage_limit_reached",
  "promotion_user_limit_reached",
  "promotion_would_zero_line",
  "platform_commission_cannot_fund_flexicash_discount",
  "promotion_discount_allocation_mismatch",
  "promotion_became_ineligible",
]);

function dispatchPromotionUiEvent(name, detail) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function assertPromotionDiscountValue(discountType, discountValue) {
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_discount_value");
  if (discountType === "percent" && value > 95) throw new Error("invalid_discount_value");
}

// --- Capacités ---------------------------------------------------------

export async function getPromotionCapabilities() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_promotion_capabilities_v1", {});
  if (error) throw error;
  return data;
}

// --- Marchand : gestion de mes promotions -----------------------------

export async function createMyPromotion({
  mode, code = null, name, description = null, discountType, discountValue,
  maxDiscountHtg = null, minSubtotalHtg = 0, minQuantity = 1, scopeType,
  pricingTiers = ["retail"], startsAt = null, endsAt = null,
  totalUsageLimit = null, perUserUsageLimit = 1,
}) {
  assertPromotionDiscountValue(discountType, discountValue);
  const { sb } = await authed();
  const { data, error } = await sb.rpc("create_my_promotion_v1", {
    p_mode: mode,
    p_code: code || null,
    p_name: name,
    p_description: description || null,
    p_discount_type: discountType,
    p_discount_value: discountValue,
    p_max_discount_htg: maxDiscountHtg,
    p_min_subtotal_htg: minSubtotalHtg,
    p_min_quantity: minQuantity,
    p_scope_type: scopeType,
    p_pricing_tiers: pricingTiers,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_total_usage_limit: totalUsageLimit,
    p_per_user_usage_limit: perUserUsageLimit,
  });
  if (error) throw error;
  return data;
}

// promotion_mode / code / scope_type sont immuables après création : on ne
// les envoie même pas ici pour ne jamais laisser croire qu'ils changent.
export async function updateMyPromotion(promotionId, {
  name, description = null, discountType, discountValue, maxDiscountHtg = null,
  minSubtotalHtg = 0, minQuantity = 1, pricingTiers = ["retail"],
  startsAt = null, endsAt = null, totalUsageLimit = null, perUserUsageLimit = 1,
}) {
  assertPromotionDiscountValue(discountType, discountValue);
  const { sb } = await authed();
  const { data, error } = await sb.rpc("update_my_promotion_v1", {
    p_promotion_id: promotionId,
    p_name: name,
    p_description: description || null,
    p_discount_type: discountType,
    p_discount_value: discountValue,
    p_max_discount_htg: maxDiscountHtg,
    p_min_subtotal_htg: minSubtotalHtg,
    p_min_quantity: minQuantity,
    p_pricing_tiers: pricingTiers,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_total_usage_limit: totalUsageLimit,
    p_per_user_usage_limit: perUserUsageLimit,
  });
  if (error) throw error;
  return data;
}

export async function setMyPromotionScope(promotionId, { productIds = [], offerIds = [], categoryIds = [] } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("set_my_promotion_scope_v1", {
    p_promotion_id: promotionId,
    p_product_ids: productIds,
    p_offer_ids: offerIds,
    p_category_ids: categoryIds,
  });
  if (error) throw error;
  return data;
}

export async function setMyPromotionStatus(promotionId, status) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("set_my_promotion_status_v1", {
    p_promotion_id: promotionId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

export async function listMyPromotions({ status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_promotions_v1", {
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
  };
}

export async function getMyPromotion(promotionId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_my_promotion_v1", { p_promotion_id: promotionId });
  if (error) throw error;
  return data;
}

// --- Public / produit ---------------------------------------------------

export async function getProductPromotions(productId, offerId = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_product_promotions_v1", {
    p_product_id: productId,
    p_offer_id: offerId || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// --- Checkout ------------------------------------------------------------
// items : [{ product_id, offer_id?, quantity, pricing_tier }] — jamais de
// montant calculé côté frontend, uniquement transmis au serveur.

export async function quoteMarketplacePromotionCodes({ items, codes = [], paymentMethod }) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("quote_marketplace_promotion_codes_v1", {
    p_items: items,
    p_codes: codes,
    p_payment_method: paymentMethod,
  });
  if (error) {
    dispatchPromotionUiEvent("vinht:promotion-quote", {
      ok: false,
      codes,
      code: parsePromotionErrorCode(error.message),
      message: promotionErrorMessageFr(error.message, "Impossible de recalculer les remises de ce panier."),
    });
    throw error;
  }
  dispatchPromotionUiEvent("vinht:promotion-quote", { ok: true, codes });
  return data;
}

export async function createMarketplaceOrderWithPromotions({
  items, promotionCodes = [], fullName, phone, email = null, paymentMethod,
  deliveryType, deliveryAddress = {}, pickupPointCode = null, deliveryNotes = null,
}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("create_marketplace_order_with_promotions_v1", {
    p_items: items,
    p_promotion_codes: promotionCodes || [],
    p_full_name: fullName,
    p_phone: phone,
    p_payment_method: paymentMethod,
    p_delivery_type: deliveryType,
    p_email: email || null,
    p_delivery_address: deliveryAddress || {},
    p_pickup_point_code: pickupPointCode || null,
    p_delivery_notes: deliveryNotes || null,
  });
  if (error) {
    const code = parsePromotionErrorCode(error.message);
    if (ORDER_TIME_PROMOTION_CODES.has(code)) {
      dispatchPromotionUiEvent("vinht:promotion-order-error", {
        code,
        message: promotionErrorMessageFr(code, "La promotion n'est plus applicable à cette commande."),
      });
    }
    throw error;
  }
  return data;
}

// --- Admin -----------------------------------------------------------------

export async function adminGetPromotionRuntime(environment = null) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_get_promotion_runtime_v1", { p_environment: environment || null });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return Array.isArray(d.rows) ? d.rows : [];
}

export async function adminSetPromotionRuntime({ environment, enabled, automaticEnabled, reason }) {
  if (!enabled && automaticEnabled) throw new Error("automatic_promotions_requires_promotions_enabled");
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_set_promotion_runtime_v1", {
    p_environment: environment,
    p_enabled: enabled,
    p_automatic_enabled: automaticEnabled,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function adminListMerchantPromotions({ status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_list_merchant_promotions_v1", {
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

export async function adminDisableMerchantPromotion(promotionId, reason) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_disable_merchant_promotion_v1", {
    p_promotion_id: promotionId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// --- Validation fail-closed côté frontend (avant tout appel réseau) --------
// Le backend reste autoritaire ; ceci n'évite qu'un aller-retour inutile.

export function isValidPromotionCode(code) {
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code.trim().toUpperCase());
}
export function normalizePromotionCode(code) {
  return String(code || "").trim().toUpperCase();
}
