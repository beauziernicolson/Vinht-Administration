import { getSupabase } from "./supabase.js";

// Feature #37 — Agent Bulk Catalog & Inventory Tools frontend.
// L'import catalogue utilise les RPC v2 currency-aware. Les outils stock et
// archive/restauration conservent leurs contrats v1. Le backend reste l'unique
// source de vérité pour la validation, la sensibilité et les confirmations.

const MAX_BULK_ROWS = 500;

async function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

export function bulkMaxRows() {
  return MAX_BULK_ROWS;
}

export function generateIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function bulkCatalogErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  const map = {
    authentication_required: "Connectez-vous pour continuer.",
    agent_assignment_required: "Ce marchand ne vous est pas assigné.",
    agent_assignment_or_scope_required: "Ce marchand ne vous est pas assigné, ou cette action n'est pas autorisée pour votre rôle Agent.",
    bulk_rows_array_required: "Format de lignes invalide.",
    bulk_rows_required: "Aucune ligne à traiter.",
    bulk_rows_limit_exceeded: `Maximum ${MAX_BULK_ROWS} lignes par opération.`,
    invalid_idempotency_key: "Clé d'opération invalide — réessayez.",
    idempotency_key_reused_with_different_payload: "Cette tentative a changé depuis le dernier essai — relancez un aperçu.",
    row_must_be_object: "Ligne invalide.",
    name_required: "Nom de produit requis.",
    name_too_long: "Nom de produit trop long (240 caractères maximum).",
    sku_too_long: "SKU trop long (80 caractères maximum).",
    invalid_category_id: "Identifiant de catégorie invalide.",
    active_category_required: "Catégorie introuvable ou inactive.",
    category_not_found: "Catégorie introuvable.",
    category_ambiguous: "Plusieurs catégories correspondent à ce nom — précisez.",
    category_required: "Catégorie requise.",
    retail_price_required: "Prix de détail requis.",
    invalid_retail_price: "Prix de détail invalide.",
    invalid_stock: "Stock invalide.",
    unsupported_product_currency: "Devise produit invalide. Utilisez HTG ou USD.",
    active_merchant_plan_required: "Un plan marchand actif est requis pour créer un produit USD.",
    usd_per_item_fee_policy_not_configured: "La politique de frais USD n'est pas configurée pour ce plan marchand.",
    wholesale_pair_required: "Le prix de gros et la quantité minimum de gros doivent être renseignés ensemble.",
    invalid_wholesale_price: "Prix de gros invalide.",
    invalid_wholesale_min_qty: "Quantité minimum de gros invalide.",
    invalid_compare_at_price: "Prix comparé invalide.",
    invalid_estimated_delivery_days: "Délai de livraison estimé invalide.",
    invalid_search_keywords: "Mots-clés invalides.",
    too_many_search_keywords: "Trop de mots-clés (30 maximum).",
    sku_already_exists_for_merchant: "Ce SKU existe déjà pour ce marchand.",
    invalid_target_type: "Type de cible invalide (produit ou variante).",
    stock_required: "Nouveau stock requis.",
    invalid_is_active: "Statut actif/inactif invalide.",
    is_active_only_supported_for_variant: "Le statut actif/inactif ne peut être modifié que pour une variante.",
    exactly_one_product_identifier_required: "Indiquez soit l'identifiant produit, soit le SKU (un seul des deux).",
    exactly_one_variant_identifier_required: "Indiquez soit l'identifiant de variante, soit le SKU (un seul des deux).",
    invalid_product_id: "Identifiant produit invalide.",
    invalid_variant_id: "Identifiant de variante invalide.",
    product_not_found_for_assigned_merchant: "Produit introuvable pour ce marchand.",
    variant_not_found_for_assigned_merchant: "Variante introuvable pour ce marchand.",
    product_sku_not_found: "Aucun produit avec ce SKU.",
    product_sku_ambiguous: "Plusieurs produits partagent ce SKU — utilisez l'identifiant produit.",
    variant_sku_not_found: "Aucune variante avec ce SKU.",
    variant_sku_ambiguous: "Plusieurs variantes partagent ce SKU — utilisez l'identifiant de variante.",
    product_uses_variants_update_variant_inventory: "Ce produit utilise des variantes — ciblez la variante, pas le produit.",
    duplicate_target_in_batch: "Cette cible apparaît plusieurs fois dans le même lot.",
    invalid_catalog_status_action: "Action invalide (archiver ou restaurer).",
    only_approved_product_can_be_activated: "Seul un produit approuvé par VinHT peut être restauré (activé).",
    validation_failed: "Certaines lignes ne sont plus valides — relancez un aperçu.",
    confirmation_required: "Confirmation requise ou expirée — relancez un aperçu et confirmez à nouveau.",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

export async function agentPreviewBulkCatalogImport(merchantId, rows) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_preview_bulk_catalog_import_v2", {
    p_merchant_id: merchantId, p_rows: rows,
  });
  if (error) throw error;
  return data;
}

export async function agentCommitBulkCatalogImport(merchantId, rows, idempotencyKey) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_commit_bulk_catalog_import_v2", {
    p_merchant_id: merchantId, p_rows: rows, p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data;
}

export async function agentPreviewBulkInventory(merchantId, rows) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_preview_bulk_inventory_v1", {
    p_merchant_id: merchantId, p_rows: rows,
  });
  if (error) throw error;
  return data;
}

export async function agentCommitBulkInventory(merchantId, rows, idempotencyKey, confirmationToken = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_commit_bulk_inventory_v1", {
    p_merchant_id: merchantId, p_rows: rows, p_idempotency_key: idempotencyKey,
    p_confirmation_token: confirmationToken || null,
  });
  if (error) throw error;
  return data;
}

export async function agentPreviewBulkCatalogStatus(merchantId, rows) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_preview_bulk_catalog_status_v1", {
    p_merchant_id: merchantId, p_rows: rows,
  });
  if (error) throw error;
  return data;
}

export async function agentCommitBulkCatalogStatus(merchantId, rows, idempotencyKey, confirmationToken = null) {
  const sb = await client();
  const { data, error } = await sb.rpc("agent_commit_bulk_catalog_status_v1", {
    p_merchant_id: merchantId, p_rows: rows, p_idempotency_key: idempotencyKey,
    p_confirmation_token: confirmationToken || null,
  });
  if (error) throw error;
  return data;
}
