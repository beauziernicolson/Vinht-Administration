import { getSupabase } from "./supabase.js";

// Feature #35C — Agent Center frontend.
// Branché exclusivement sur les RPC #35A (agent_operations_security_core_v1)
// et #35B (agent_catalog_inventory_operations_v1). Aucune écriture directe
// dans products/product_variants/merchants/agent_* : toute mutation passe
// par une RPC officielle. Aucune RPC Agent n'est accessible à `anon` — un
// Agent doit être authentifié, et le backend reste la seule source de vérité
// pour l'affectation, les scopes et l'état d'approbation.

async function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

export const AGENT_STATUS_FR = {
  active: "Actif",
  suspended: "Suspendu",
  closed: "Fermé",
  not_agent: "Pas un compte Agent",
  application_pending_review: "Candidature en cours d'examen",
  application_approved: "Candidature approuvée",
  application_rejected: "Candidature refusée",
  application_cancelled: "Candidature annulée",
};

export function agentErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  const map = {
    authentication_required: "Connectez-vous pour continuer.",
    active_agent_required: "Votre compte Agent n'est pas actif.",
    agent_profile_not_found: "Profil Agent introuvable.",
    agent_assignment_required: "Ce marchand ne vous est pas assigné.",
    agent_assignment_or_scope_required: "Ce marchand ne vous est pas assigné, ou cette action n'est pas autorisée pour votre rôle Agent.",
    merchant_required: "Marchand requis.",
    merchant_not_found: "Marchand introuvable.",
    merchant_not_found_or_closed: "Marchand introuvable ou fermé.",
    product_not_found_for_assigned_merchant: "Ce produit est introuvable pour ce marchand.",
    variant_not_found_for_assigned_merchant: "Cette variante est introuvable pour ce marchand.",
    invalid_product_name: "Nom de produit invalide (1 à 240 caractères).",
    active_category_required: "Sélectionnez une catégorie active.",
    invalid_product_currency: "Devise produit invalide. Utilisez HTG ou USD.",
    unsupported_product_currency: "Devise produit non supportée. Utilisez HTG ou USD.",
    usd_per_item_fee_policy_not_configured: "La politique de frais USD du plan marchand n'est pas configurée.",
    invalid_retail_price: "Prix de détail invalide.",
    invalid_stock: "Stock invalide.",
    wholesale_pair_required: "Le prix de gros et la quantité minimum de gros doivent être renseignés ensemble.",
    invalid_wholesale_price: "Prix de gros invalide.",
    invalid_wholesale_min_qty: "Quantité minimum de gros invalide.",
    invalid_compare_at_price: "Prix comparé invalide.",
    invalid_estimated_delivery_days: "Délai de livraison estimé invalide.",
    sku_too_long: "SKU trop long (80 caractères maximum).",
    too_many_search_keywords: "Trop de mots-clés (30 maximum).",
    product_uses_variants_update_variant_inventory: "Ce produit utilise des variantes — modifiez le stock par variante, pas le stock simple.",
    only_approved_product_can_be_activated: "Seul un produit approuvé par VinHT peut être activé.",
    active_flag_required: "État actif/inactif requis.",
    variants_array_required: "Liste de variantes requise.",
    too_many_variants: "Trop de variantes (100 maximum).",
    product_id_required: "Produit requis.",
    variant_required: "Variante requise.",
    variant_sku_required: "SKU de variante requis.",
    variant_sku_too_long: "SKU de variante trop long (80 caractères maximum).",
    invalid_variant_stock_active_or_position: "Stock, statut actif ou position de variante invalide.",
    invalid_variant_stock: "Stock de variante invalide.",
    variant_options_required: "Options de variante requises.",
    variant_options_count_invalid: "Une variante doit avoir entre 1 et 3 options (taille, couleur, etc.).",
    variant_option_name_invalid: "Nom d'option de variante invalide (40 caractères maximum).",
    variant_option_value_must_be_string: "La valeur d'une option de variante doit être du texte.",
    variant_option_value_invalid: "Valeur d'option de variante invalide (80 caractères maximum).",
    variant_option_names_must_match: "Toutes les variantes d'un même produit doivent utiliser les mêmes noms d'options.",
    duplicate_variant_combination: "Deux variantes ne peuvent pas avoir exactement la même combinaison d'options.",
    duplicate_variant_sku: "Deux variantes ne peuvent pas avoir le même SKU.",
    admin_role_required: "Rôle administrateur requis.",
    // #36B — dossiers marchands assistés par un Agent.
    full_name_required: "Nom complet requis.",
    full_name_too_long: "Nom complet trop long (160 caractères maximum).",
    shop_name_required: "Nom de boutique requis.",
    shop_name_too_long: "Nom de boutique trop long (160 caractères maximum).",
    invalid_merchant_type: "Choisissez un type de marchand (producteur, revendeur ou vendeur).",
    phone_or_whatsapp_required: "Renseignez un numéro de téléphone ou un numéro WhatsApp.",
    phone_too_long: "Numéro de téléphone trop long (40 caractères maximum).",
    whatsapp_too_long: "Numéro WhatsApp trop long (40 caractères maximum).",
    invalid_email: "Adresse e-mail invalide.",
    shop_description_too_long: "Description de boutique trop longue (2000 caractères maximum).",
    too_many_product_categories: "Maximum 20 catégories.",
    product_category_too_long: "Une catégorie est trop longue (80 caractères maximum).",
    assisted_onboarding_assignment_required: "Ce dossier ne vous est pas assigné.",
    assisted_onboarding_not_editable: "Ce dossier n'est plus modifiable.",
    assisted_onboarding_not_markable_ready: "Ce dossier ne peut pas être marqué prêt dans son état actuel.",
    assisted_onboarding_profile_incomplete: "Complétez le nom complet et le nom de boutique avant de marquer ce dossier prêt.",
    invalid_assisted_onboarding_status: "Statut de dossier invalide.",
    assisted_onboarding_not_found: "Dossier introuvable.",
    assisted_dossier_not_ready_for_invite: "Ce dossier doit être marqué prêt avant l'envoi de l'invitation.",
    email_required_for_activation: "Une adresse e-mail est requise pour envoyer l'invitation.",
    // Adresse du commerce (dossier assisté v2) et candidature Agent.
    business_address_required: "Renseignez l'adresse du commerce.",
    business_department_required: "Renseignez le département du commerce.",
    business_commune_required: "Renseignez la commune du commerce.",
    business_address_incomplete: "L'adresse du commerce (adresse, département, commune) doit être complète avant de marquer le dossier prêt.",
    already_active_agent: "Votre compte Agent est déjà actif.",
    agent_address_required: "Renseignez votre adresse.",
    agent_department_required: "Renseignez votre département.",
    agent_commune_required: "Renseignez votre commune.",
    agent_phone_required: "Renseignez votre numéro de téléphone.",
    invalid_agent_display_name: "Nom invalide (2 à 120 caractères).",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

// --- Agent — identité / marchands assignés (#35A) --------------------------

export async function agentGetMyContext() {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_get_my_context_v1", {});
  if (error) throw error;
  return data;
}

export async function agentListMyMerchants({ limit = 50, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_list_my_merchants_v1", { p_limit: limit, p_offset: offset });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? null,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
  };
}

export async function agentGetMerchantOperationalContext(merchantId) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_get_merchant_operational_context_v1", { p_merchant_id: merchantId });
  if (error) throw error;
  return data;
}

// --- Agent — catalogue / inventaire (#35B) ----------------------------------

// #35B.1 — recherche serveur sur tout le catalogue du marchand (nom + SKU),
// pas seulement sur la page actuellement chargée. p_search=null pour un
// listing normal sans filtre.
export async function agentListMerchantProducts(merchantId, { search = null, limit = 50, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_list_merchant_products_v2", {
    p_merchant_id: merchantId, p_search: search || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? null,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
  };
}

export async function agentGetProductContext(merchantId, productId) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_get_product_context_v1", {
    p_merchant_id: merchantId, p_product_id: productId,
  });
  if (error) throw error;
  return data;
}

function resolveAgentCreateCurrency(explicitCurrency) {
  let raw = explicitCurrency;
  // Compatibilité avec l'ancien formulaire Agent : la couche UX additive
  // injecte le select sans réécrire toute la page. Les appels non-UI restent HTG.
  if (!raw && typeof document !== "undefined") {
    raw = document.querySelector("#acCreateProductForm [name='currency']")?.value || null;
  }
  const currency = String(raw || "HTG").trim().toUpperCase();
  if (!["HTG", "USD"].includes(currency)) throw new Error("invalid_product_currency");
  return currency;
}

export async function agentCreateProduct(merchantId, {
  categoryId, name, retailPrice, stock = 0, sku = null, tagline = null, description = null,
  wholesalePrice = null, wholesaleMinQty = null, compareAtPrice = null, deliveryZone = null,
  estimatedDeliveryDays = null, searchKeywords = [], currency = null,
}) {
  const sb = await client();
  const normalizedCurrency = resolveAgentCreateCurrency(currency);
  const { data, error } = await sb.rpc("agent_create_product_v2", {
    p_merchant_id: merchantId,
    p_category_id: categoryId,
    p_name: name,
    p_retail_price: retailPrice,
    p_stock: stock,
    p_sku: sku || null,
    p_tagline: tagline || null,
    p_description: description || null,
    p_wholesale_price: wholesalePrice,
    p_wholesale_min_qty: wholesaleMinQty,
    p_compare_at_price: compareAtPrice,
    p_delivery_zone: deliveryZone || null,
    p_estimated_delivery_days: estimatedDeliveryDays,
    p_search_keywords: Array.isArray(searchKeywords) ? searchKeywords : [],
    p_currency: normalizedCurrency,
  });
  if (error) throw error;
  return data;
}

export async function agentUpdateProductContent(merchantId, productId, {
  categoryId, name, retailPrice, sku = null, tagline = null, description = null,
  wholesalePrice = null, wholesaleMinQty = null, compareAtPrice = null, deliveryZone = null,
  estimatedDeliveryDays = null, searchKeywords = [],
}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_update_product_content_v1", {
    p_merchant_id: merchantId,
    p_product_id: productId,
    p_category_id: categoryId,
    p_name: name,
    p_retail_price: retailPrice,
    p_sku: sku || null,
    p_tagline: tagline || null,
    p_description: description || null,
    p_wholesale_price: wholesalePrice,
    p_wholesale_min_qty: wholesaleMinQty,
    p_compare_at_price: compareAtPrice,
    p_delivery_zone: deliveryZone || null,
    p_estimated_delivery_days: estimatedDeliveryDays,
    p_search_keywords: Array.isArray(searchKeywords) ? searchKeywords : [],
  });
  if (error) throw error;
  return data;
}

export async function agentSetProductStock(merchantId, productId, stock) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_set_product_stock_v1", {
    p_merchant_id: merchantId, p_product_id: productId, p_stock: stock,
  });
  if (error) throw error;
  return data;
}

// variants: [{ sku, stock, isActive, position, options:{ [name]: value } }]
export async function agentReplaceProductVariants(merchantId, productId, variants) {
  const sb = await client();
  const payload = (Array.isArray(variants) ? variants : []).map((v, i) => ({
    sku: v.sku,
    stock: v.stock,
    is_active: v.isActive !== false,
    position: v.position ?? i,
    options: v.options || {},
  }));
  const { data, error } = await sb.rpc("agent_replace_product_variants_v1", {
    p_merchant_id: merchantId, p_product_id: productId, p_variants: payload,
  });
  if (error) throw error;
  return data;
}

export async function agentUpdateProductVariantInventory(merchantId, variantId, stock, isActive = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_update_product_variant_inventory_v1", {
    p_merchant_id: merchantId, p_variant_id: variantId, p_stock: stock, p_is_active: isActive,
  });
  if (error) throw error;
  return data;
}

export async function agentSetProductActive(merchantId, productId, isActive) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_set_product_active_v1", {
    p_merchant_id: merchantId, p_product_id: productId, p_is_active: isActive,
  });
  if (error) throw error;
  return data;
}

// --- Agent — parcours assisté marchand (#36B / #36C) ------------------------
// L'Agent ne voit et ne manipule jamais de mot de passe, code OTP, document
// KYC ou donnée financière ici : ces capacités sont explicitement false côté
// backend (agent_can_view_kyc_documents, agent_can_manage_finance,
// agent_can_set_password, agent_can_claim_account) et le frontend ne construit
// aucun contournement quand elles le sont.

export const ASSISTED_DOSSIER_STATUS_FR = {
  draft: "Brouillon",
  ready_for_invite: "Prêt pour invitation",
  invited: "Invité",
  claimed: "Réclamé",
  cancelled: "Annulé",
};

// Contrat v2 : l'adresse, le département et la commune du commerce sont
// obligatoires côté backend (sinon le dossier ne peut jamais passer
// `ready_for_invite`). Les anciennes RPC _v1 n'exigent pas ces champs et ne
// doivent plus être appelées.
export async function agentCreateAssistedMerchantDossier({
  fullName, shopName, merchantType, phone = null, whatsappNumber = null, email = null,
  businessAddressLine1 = null, businessDepartment = null, businessCommune = null,
}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_create_assisted_merchant_dossier_v2", {
    p_full_name: fullName, p_shop_name: shopName, p_merchant_type: merchantType,
    p_phone: phone || null, p_whatsapp_number: whatsappNumber || null, p_email: email || null,
    p_business_address_line1: businessAddressLine1 || null,
    p_business_department: businessDepartment || null,
    p_business_commune: businessCommune || null,
  });
  if (error) throw error;
  return data;
}

export async function agentSaveAssistedMerchantDossier(dossierId, {
  fullName, shopName, merchantType, phone = null, whatsappNumber = null, email = null,
  shopDescription = null, productCategories = [],
  businessAddressLine1 = null, businessDepartment = null, businessCommune = null,
}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_save_assisted_merchant_dossier_v2", {
    p_dossier_id: dossierId, p_full_name: fullName, p_shop_name: shopName, p_merchant_type: merchantType,
    p_phone: phone || null, p_whatsapp_number: whatsappNumber || null, p_email: email || null,
    p_shop_description: shopDescription || null,
    p_product_categories: Array.isArray(productCategories) ? productCategories : [],
    p_business_address_line1: businessAddressLine1 || null,
    p_business_department: businessDepartment || null,
    p_business_commune: businessCommune || null,
  });
  if (error) throw error;
  return data;
}

// Candidature Agent (n'importe quel utilisateur authentifié qui n'est pas
// déjà Agent actif). Le backend décide de tout : approbation, rejet, motif.
export async function submitMyAgentApplication({ displayName, phone, addressLine1, department, commune }) {
  const sb = await client();
  const { data, error } = await sb.rpc("submit_my_agent_application_v1", {
    p_display_name: displayName, p_phone: phone, p_address_line1: addressLine1,
    p_department: department, p_commune: commune,
  });
  if (error) throw error;
  return data;
}

export async function agentMarkAssistedMerchantReady(dossierId) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_mark_assisted_merchant_ready_v1", { p_dossier_id: dossierId });
  if (error) throw error;
  return data;
}

export async function agentGetAssistedMerchantDossier(dossierId) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_get_assisted_merchant_dossier_v1", { p_dossier_id: dossierId });
  if (error) throw error;
  return data;
}

export async function agentListMyAssistedMerchantDossiers({ status = null, limit = 50, offset = 0 } = {}) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_list_my_assisted_merchant_dossiers_v1", {
    p_status: status || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? null,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
  };
}

// Ne renvoie jamais de secret : `delivery` décrit uniquement le canal, l'email
// cible, l'expiration et le chemin de retour. L'envoi réel de l'e-mail est un
// appel Supabase Auth séparé (signInWithOtp), jamais transporté par cette RPC.
export async function agentIssueAssistedMerchantInvite(dossierId) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_issue_assisted_merchant_invite_v1", { p_dossier_id: dossierId });
  if (error) throw error;
  return data;
}