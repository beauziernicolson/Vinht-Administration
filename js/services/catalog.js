// Service catalogue — LECTURE SEULE Supabase.
//
// Aucune écriture. Aucune règle métier. Aucun calcul financier autoritaire.
//
// Schéma produit officiel (fourni par l'architecte) utilisé tel quel — plus
// aucun alias provisoire.

import { getSupabase, isSupabaseConfigured } from "./supabase.js";

export { isSupabaseConfigured };

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

// Sélection produit + embeds via les FK réelles :
//   products_merchant_id_fkey  -> merchants (shop_name, average_rating, trust_score)
//   product_images_product_id_fkey -> product_images (storage_path, alt_text, position, is_primary)
const PRODUCT_SELECT = [
  "id",
  "merchant_id",
  "category_id",
  "slug",
  "sku",
  "name",
  "tagline",
  "description",
  "currency",
  "retail_price",
  "wholesale_price",
  "wholesale_min_qty",
  "compare_at_price",
  "stock",
  "approval_status",
  "is_active",
  "delivery_zone",
  "estimated_delivery_days",
  "search_keywords",
  "product_specs",
  "merchants!products_merchant_id_fkey(shop_name,average_rating,rating_count,trust_score,trust_level,merchant_type,delivery_zone,status)",
  "product_images!product_images_product_id_fkey(storage_path,alt_text,position,is_primary)",
].join(",");

// La visibilité Product V2 dépend de is_active et des politiques RLS publiques
// (marchand actif + environnement correct), jamais du statut de contrôle.
function publicProductsQuery() {
  return client()
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true);
}

// Nettoie un terme de recherche pour l'injecter sans casser la syntaxe or().
function sanitizeTerm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// --- Catégories ----------------------------------------------------------
export async function getCategories({ activeOnly = true } = {}) {
  let q = client()
    .from("categories")
    .select("id,slug,name,description,icon,position,parent_id,is_active");
  if (activeOnly) q = q.eq("is_active", true);
  q = q.order("position", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Tri autorisé — allow-list stricte (aucune colonne/ordre arbitraire depuis l'UI).
const SORT_ORDER = {
  default: { column: "created_at", ascending: false },
  price_asc: { column: "retail_price", ascending: true },
  price_desc: { column: "retail_price", ascending: false },
  newest: { column: "created_at", ascending: false },
};

// --- Produits ----------------------------------------------------------
// Recherche explicite : name / tagline / description (ilike) + search_keywords
// (contains sur le 1er token). Plus de JSON.stringify.
export async function getProducts({ limit = 48, search = "", categoryId = "", sort = "default" } = {}) {
  let q = publicProductsQuery();
  if (categoryId) q = q.eq("category_id", categoryId);

  const phrase = sanitizeTerm(search);
  if (phrase) {
    const token = phrase.split(" ")[0];
    q = q.or(
      [
        `name.ilike.*${phrase}*`,
        `tagline.ilike.*${phrase}*`,
        `description.ilike.*${phrase}*`,
        `search_keywords.cs.{${token}}`,
      ].join(",")
    );
  }

  const order = SORT_ORDER[sort] || SORT_ORDER.default;
  q = q.order(order.column, { ascending: order.ascending }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getProductsByIds(ids = []) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return [];
  const { data, error } = await publicProductsQuery().in("id", list);
  if (error) throw error;
  return data || [];
}

// --- Featured --------------------------------------------------------
// 2 requêtes propres (pas d'embed profond) : featured_products actifs dans la
// fenêtre starts_at/ends_at, puis les produits correspondants, réordonnés.
export async function getFeaturedProducts({ limit = 12 } = {}) {
  const { data: feat, error } = await client()
    .from("featured_products")
    .select("product_id,position,is_active,starts_at,ends_at")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const now = Date.now();
  const ids = (feat || [])
    .filter((r) => {
      const s = r.starts_at ? Date.parse(r.starts_at) : null;
      const e = r.ends_at ? Date.parse(r.ends_at) : null;
      return (s === null || s <= now) && (e === null || e >= now);
    })
    .map((r) => r.product_id)
    .filter(Boolean);

  if (!ids.length) return [];
  const prods = await getProductsByIds(ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  return prods.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

// --- Fiche produit (Phase 3) --------------------------------------------
export async function getProductById(id) {
  if (!id) return null;
  const { data, error } = await publicProductsQuery().eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getProductBySlug(slug) {
  if (!slug) return null;
  const { data, error } = await publicProductsQuery().eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getProductImages(productId) {
  if (!productId) return [];
  const { data, error } = await client()
    .from("product_images")
    .select("storage_path,alt_text,position,is_primary")
    .eq("product_id", productId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data || [];
}

// --- Variantes produit (Feature #5) ------------------------------------
// Source de vérité : RPC public get_product_variant_context_v1(product_id).
// Le frontend NE fabrique JAMAIS de combinaisons : il n'affiche que les
// variantes réelles renvoyées par le backend, avec leur variant_id exact.
export async function getProductVariantContext(productId) {
  if (!productId) return { available: false, has_variants: false, option_names: [], variants: [] };
  const { data, error } = await client().rpc("get_product_variant_context_v1", {
    p_product_id: productId,
  });
  if (error) throw error;
  const c = data && typeof data === "object" ? data : {};
  const variants = Array.isArray(c.variants) ? c.variants : [];
  return {
    available: c.available !== false,
    product_id: c.product_id || productId,
    has_variants: c.has_variants === true && variants.length > 0,
    option_names: Array.isArray(c.option_names) ? c.option_names : [],
    total_stock: typeof c.total_stock === "number" ? c.total_stock : null,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku || "",
      options: v.options && typeof v.options === "object" ? v.options : {},
      stock: typeof v.stock === "number" ? v.stock : 0,
      is_active: v.is_active === true,
      available: v.available === true,
      position: typeof v.position === "number" ? v.position : 0,
    })),
  };
}

// --- Storage --------------------------------------------------------
// Bucket public "product-images". URL publique dérivée de storage_path.
// Renvoie null si pas de chemin -> la couche UI met un placeholder.
export function productImageUrl(storagePath) {
  if (!storagePath) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = sb.storage.from("product-images").getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch (e) {
    return null;
  }
}
