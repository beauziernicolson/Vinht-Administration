// Service Espace marchand — lectures RLS + RPC serveur uniquement.
//
// Aucune UPDATE directe sur public.merchants (admin only).
// Profil -> update_my_merchant_profile
// Stock  -> merchant_set_product_stock
// Statut commande -> merchant_update_order_status
// Le frontend n'envoie jamais de champ privilégié (status/plan/trust/metrics/
// approval/payout).

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session || !session.user) throw new Error("not-authenticated");
  return { sb, user: session.user };
}

// --- Marchand -----------------------------------------------------------
const MERCHANT_FIELDS =
  "id,user_id,shop_name,description,merchant_type,plan_code,whatsapp_number," +
  "delivery_zone,status,environment,demo_flexicash_payout_number," +
  "trust_level,trust_score,average_rating,rating_count,created_at";

export async function getMyMerchant() {
  const { sb, user } = await authed();
  const { data, error } = await sb
    .from("merchants")
    .select(MERCHANT_FIELDS)
    .eq("user_id", user.id) // portée sémantique ; RLS reste la sécurité
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function updateMyMerchantProfile({
  shopName,
  description,
  whatsappNumber,
  deliveryZone,
}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("update_my_merchant_profile", {
    p_shop_name: shopName ?? null,
    p_description: description ?? null,
    p_whatsapp_number: whatsappNumber ?? null,
    p_delivery_zone: deliveryZone ?? null,
  });
  if (error) throw error;
  return data;
}

// Numéro FlexiCash de réception Demo (compte marchand en environment='demo').
// RPC SECURITY DEFINER : jamais utilisé comme clé interne VinHT, sert seulement
// de destinataire de payout Sandbox. Aucun mot de passe / PIN FlexiCash ici.
export async function setDemoFlexicashPayoutNumber(flexicashNumber) {
  const { sb } = await authed();
  const n = String(flexicashNumber || "").trim();
  if (n.length < 4 || n.length > 80) throw new Error("invalid-flexicash-number");
  const { data, error } = await sb.rpc("set_my_demo_flexicash_payout_number", {
    p_flexicash_number: n,
  });
  if (error) throw error;
  return data;
}

// --- Produits du marchand --------------------------------------------
export const PRODUCT_FIELDS =
  "id,name,sku,slug,tagline,description,currency,retail_price,wholesale_price," +
  "wholesale_min_qty,compare_at_price,stock,approval_status,is_active," +
  "rejection_reason,category_id,delivery_zone,estimated_delivery_days," +
  "search_keywords,created_at,updated_at";

export async function getMyProducts(merchantId) {
  if (!merchantId) return [];
  const { sb } = await authed();
  const { data, error } = await sb
    .from("products")
    .select(PRODUCT_FIELDS)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const products = data || [];
  if (!products.length) return products;

  // Vignette : image primaire (fallback position la plus basse) par produit.
  const ids = products.map((p) => p.id);
  const { data: imgs } = await sb
    .from("product_images")
    .select("product_id,storage_path,position,is_primary")
    .in("product_id", ids)
    .order("is_primary", { ascending: false })
    .order("position", { ascending: true });
  const byProduct = new Map();
  const imagesByProduct = new Map();
  for (const im of imgs || []) {
    if (!byProduct.has(im.product_id)) byProduct.set(im.product_id, im.storage_path);
    if (!imagesByProduct.has(im.product_id)) imagesByProduct.set(im.product_id, []);
    imagesByProduct.get(im.product_id).push(im);
  }
  return products.map((p) => ({
    ...p,
    primary_image_path: byProduct.get(p.id) || null,
    product_images: imagesByProduct.get(p.id) || [],
  }));
}

const DIACRITICS = /[̀-ͯ]/g;

function slugify(name) {
  const base =
    String(name || "produit")
      .toLowerCase()
      .normalize("NFD")
      .replace(DIACRITICS, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "produit";
  let suffix;
  try {
    suffix = crypto.randomUUID().slice(0, 8);
  } catch (e) {
    suffix = Math.random().toString(36).slice(2, 10);
  }
  return `${base}-${suffix}`;
}

// wholesale : les deux null, ou les deux présents (price>=0, min_qty>0).
function normalizeWholesale(price, minQty) {
  const pRaw = price === "" || price == null ? null : Number(price);
  const qRaw = minQty === "" || minQty == null ? null : parseInt(minQty, 10);
  if (pRaw == null && qRaw == null) return { wholesale_price: null, wholesale_min_qty: null };
  if (
    pRaw == null ||
    qRaw == null ||
    Number.isNaN(pRaw) ||
    Number.isNaN(qRaw) ||
    pRaw < 0 ||
    qRaw <= 0
  )
    throw new Error("wholesale-pair");
  return { wholesale_price: pRaw, wholesale_min_qty: qRaw };
}

export async function createProduct(input) {
  const { sb } = await authed();
  if (!input.merchantId) throw new Error("merchant-required");
  if (!input.name || !input.name.trim()) throw new Error("name-required");
  if (!input.categoryId) throw new Error("category-required");
  const retail = Number(input.retailPrice);
  const stock = parseInt(input.stock, 10);
  if (Number.isNaN(retail) || retail < 0) throw new Error("retail-invalid");
  if (Number.isNaN(stock) || stock < 0) throw new Error("stock-invalid");
  const ws = normalizeWholesale(input.wholesalePrice, input.wholesaleMinQty);
  const currency = String(input.currency || "HTG").trim().toUpperCase();
  if (!["HTG", "USD"].includes(currency)) throw new Error("currency-invalid");

  const payload = {
    merchant_id: input.merchantId,
    category_id: input.categoryId,
    slug: slugify(input.name),
    name: input.name.trim(),
    currency,
    retail_price: retail,
    stock,
    approval_status: "pending", // jamais approved depuis le frontend
    is_active: true, // publication immédiate ; pending signifie « à vérifier »
    ...ws,
  };
  const opt = {
    sku: (input.sku || "").trim(),
    tagline: (input.tagline || "").trim(),
    description: (input.description || "").trim(),
    delivery_zone: (input.deliveryZone || "").trim(),
  };
  for (const [k, v] of Object.entries(opt)) if (v) payload[k] = v;
  if (input.compareAtPrice !== "" && input.compareAtPrice != null) {
    const c = Number(input.compareAtPrice);
    if (!Number.isNaN(c) && c >= 0) payload.compare_at_price = c;
  }
  if (input.estimatedDeliveryDays !== "" && input.estimatedDeliveryDays != null) {
    const d = parseInt(input.estimatedDeliveryDays, 10);
    if (!Number.isNaN(d) && d >= 0) payload.estimated_delivery_days = d;
  }
  if (Array.isArray(input.searchKeywords) && input.searchKeywords.length)
    payload.search_keywords = input.searchKeywords;

  const { data, error } = await sb
    .from("products")
    .insert(payload)
    .select(PRODUCT_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

// Édition de contenu -> RPC serveur qui repasse le produit en révision.
// L'UPDATE direct sur public.products est ADMIN ONLY : on n'y touche pas.
// Le backend garantit approval_status="pending", is_active=false et le reset
// de approved_by / approved_at / rejection_reason. Le frontend n'envoie AUCUN
// de ces champs (ni merchant_id).
export async function updateProductContent(productId, fields) {
  const { sb } = await authed();
  if (!productId) throw new Error("product-required");

  const name = fields.name != null ? String(fields.name).trim() : "";
  if (!name) throw new Error("name-required");

  let retail = null;
  if (fields.retailPrice !== "" && fields.retailPrice != null) {
    retail = Number(fields.retailPrice);
    if (Number.isNaN(retail) || retail < 0) throw new Error("retail-invalid");
  }
  let compare = null;
  if (fields.compareAtPrice !== "" && fields.compareAtPrice != null) {
    compare = Number(fields.compareAtPrice);
    if (Number.isNaN(compare) || compare < 0) compare = null;
  }
  // Paire wholesale : les deux ou aucun.
  const ws = normalizeWholesale(fields.wholesalePrice, fields.wholesaleMinQty);

  const params = {
    p_product_id: productId,
    p_name: name,
    p_tagline: fields.tagline != null ? String(fields.tagline).trim() || null : null,
    p_description: fields.description != null ? String(fields.description).trim() || null : null,
    p_retail_price: retail,
    p_wholesale_price: ws.wholesale_price,
    p_wholesale_min_qty: ws.wholesale_min_qty,
    p_compare_at_price: compare,
  };

  const { data, error } = await sb.rpc("merchant_resubmit_product_content", params);
  if (error) throw error;
  return data;
}

// Stock seul -> RPC sûr (préserve approval/is_active/metadata).
export async function setProductStock(productId, stock) {
  const { sb } = await authed();
  if (!productId) throw new Error("product-required");
  const s = parseInt(stock, 10);
  if (Number.isNaN(s) || s < 0) throw new Error("stock-invalid");
  const { data, error } = await sb.rpc("merchant_set_product_stock", {
    p_product_id: productId,
    p_stock: s,
  });
  if (error) throw error;
  return data;
}

// --- Variantes produit (Feature #5) --------------------------------------
// Lecture : get_product_variant_context_v1 (RPC public, réutilisé).
// Structure : merchant_replace_product_variants_v1 — UNIQUEMENT lorsqu'on
//   modifie réellement la liste des combinaisons (peut renvoyer le produit en
//   validation `pending` s'il était déjà approuvé -> `requires_review`).
// Inventaire seul : merchant_update_product_variant_inventory_v1 — stock et/ou
//   actif/inactif d'une combinaison existante, sans nouvelle validation.
export async function getProductVariants(productId) {
  const { sb } = await authed();
  if (!productId) throw new Error("product-required");
  const { data, error } = await sb.rpc("get_product_variant_context_v1", { p_product_id: productId });
  if (error) throw error;
  const c = data && typeof data === "object" ? data : {};
  const variants = Array.isArray(c.variants) ? c.variants : [];
  return {
    available: c.available !== false,
    has_variants: c.has_variants === true && variants.length > 0,
    option_names: Array.isArray(c.option_names) ? c.option_names : [],
    total_stock: typeof c.total_stock === "number" ? c.total_stock : null,
    variants: variants
      .map((v) => ({
        id: v.id,
        sku: v.sku || "",
        options: v.options && typeof v.options === "object" ? v.options : {},
        stock: typeof v.stock === "number" ? v.stock : 0,
        is_active: v.is_active === true,
        available: v.available === true,
        position: typeof v.position === "number" ? v.position : 0,
      }))
      .sort((a, b) => a.position - b.position),
  };
}

// Détection légère "produit varianté" pour une LISTE de produits, sans N+1 sur
// get_product_variant_context_v1. Lecture directe (RLS) de product_variants —
// ce n'est PAS un second système de variantes : elle sert uniquement à savoir
// si le stock parent (products.stock, agrégat serveur) doit rester éditable
// ou si le stock réel vit désormais dans les variantes. Les productId fournis
// doivent déjà appartenir au marchand (RLS reste la sécurité de toute façon).
export async function getVariantedProductIds(productIds = []) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const { sb } = await authed();
  const { data, error } = await sb
    .from("product_variants")
    .select("product_id")
    .in("product_id", ids)
    .is("archived_at", null);
  if (error) throw error;
  return new Set((data || []).map((r) => r.product_id));
}

// variants: [{ sku, options:{Name:Value,...}, stock, is_active, position }]
export async function replaceProductVariants(productId, variants) {
  const { sb } = await authed();
  if (!productId) throw new Error("product-required");
  if (!Array.isArray(variants)) throw new Error("variants-array-required");
  const payload = variants.map((v, i) => {
    const opts = {};
    Object.entries(v.options || {}).forEach(([k, val]) => {
      const kk = String(k || "").trim();
      const vv = String(val ?? "").trim();
      if (kk && vv) opts[kk] = vv;
    });
    const sku = String(v.sku || "").trim();
    if (!sku) throw new Error("variant-sku-required");
    if (!Object.keys(opts).length) throw new Error("variant-options-required");
    const stock = parseInt(v.stock, 10);
    return {
      sku,
      options: opts,
      stock: Number.isNaN(stock) || stock < 0 ? 0 : stock,
      is_active: v.is_active !== false,
      position: typeof v.position === "number" ? v.position : i,
    };
  });
  const { data, error } = await sb.rpc("merchant_replace_product_variants_v1", {
    p_product_id: productId,
    p_variants: payload,
  });
  if (error) throw error;
  return data; // { has_variants, variant_count, total_stock, approval_status, is_active, requires_review }
}

export async function updateVariantInventory(variantId, stock, isActive) {
  const { sb } = await authed();
  if (!variantId) throw new Error("variant-required");
  const s = parseInt(stock, 10);
  if (Number.isNaN(s) || s < 0) throw new Error("stock-invalid");
  const params = { p_variant_id: variantId, p_stock: s };
  if (isActive === true || isActive === false) params.p_is_active = isActive;
  const { data, error } = await sb.rpc("merchant_update_product_variant_inventory_v1", params);
  if (error) throw error;
  return data; // { variant_id, stock, is_active, product_total_stock, ... }
}

// --- Images produit --------------------------------------------------
const IMG_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const IMG_MAX_BYTES = 10 * 1024 * 1024;
const IMG_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function validateImageFile(file) {
  if (!file) throw new Error("no-file");
  if (!IMG_MIME.includes(file.type)) throw new Error("bad-mime");
  if (file.size > IMG_MAX_BYTES) throw new Error("too-big");
}

export function canMutateImages(product) {
  // Un produit vérifié reste éditable. Le backend remettra son contenu en
  // contrôle si nécessaire ; le frontend ne recrée jamais un gate bloquant.
  return !!product;
}

export async function uploadProductImage({
  merchantId,
  productId,
  file,
  altText = "",
  position = 0,
  isPrimary = true,
}) {
  const { sb } = await authed();
  validateImageFile(file);
  if (!merchantId || !productId) throw new Error("ids-required");

  const ext = IMG_EXT[file.type] || "bin";
  let rand;
  try {
    rand = crypto.randomUUID();
  } catch (e) {
    rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  // Chemin exigé : <merchant_id>/<product_id>/<filename>
  const path = `${merchantId}/${productId}/${rand}.${ext}`;

  const up = await sb.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) {
    const e = new Error("storage-failed");
    e.cause = up.error;
    throw e;
  }

  const { data, error } = await sb
    .from("product_images")
    .insert({
      product_id: productId,
      storage_path: path,
      alt_text: altText ? String(altText).trim() : null,
      position,
      is_primary: isPrimary,
    })
    .select("id,product_id,storage_path,alt_text,position,is_primary")
    .single();
  if (error) {
    // L'objet Storage existe déjà mais sa ligne métier non : nettoyage best
    // effort afin de ne pas laisser de fichier orphelin. L'erreur d'INSERT
    // reste l'erreur principale, même si le cleanup échoue.
    const cleanup = await sb.storage.from("product-images").remove([path]);
    const e = new Error("image-row-failed");
    e.cause = error;
    e.cleanupError = cleanup.error || null;
    throw e;
  }
  return data;
}

// --- Commandes marchand -------------------------------------------
const MO_FIELDS =
  "id,order_id,merchant_id,status,currency,subtotal_amount,subtotal_htg,commission_rate_snapshot," +
  "platform_commission_amount,platform_commission_htg,per_item_fee_amount,per_item_fee_htg," +
  "payout_status,payout_amount,payout_amount_htg,payout_provider,payout_reference,payout_environment," +
  "payout_paid_at,payout_error,environment,created_at";

export async function getMerchantOrders(merchantId) {
  const { sb } = await authed();
  if (!merchantId) throw new Error("merchant-required");
  // Portée explicite : on ne s'appuie pas seulement sur la RLS (un compte
  // cumulant admin+merchant peut sinon voir les commandes d'autres boutiques).
  const { data, error } = await sb
    .from("merchant_orders")
    .select(MO_FIELDS)
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getMerchantOrderItems(merchantOrderIds = []) {
  const ids = [...new Set((merchantOrderIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { sb } = await authed();
  const { data, error } = await sb
    .from("order_items")
    .select(
      "merchant_order_id,order_id,product_name,product_slug,sku,product_image_path,pricing_tier,currency,unit_price_amount,unit_price_htg,quantity,line_total_amount,line_total_htg"
    )
    .in("merchant_order_id", ids)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getOrdersByIds(orderIds = []) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const { sb } = await authed();
  const { data, error } = await sb
    .from("orders")
    // `status` (parent) : lecture seule, pour distinguer commercialement annulée
    // vs remboursée à l'affichage. Ne sert jamais à calculer une autorisation
    // fulfillment/livraison (celle-ci vient de readiness/contrat backend).
    .select("id,status,full_name,phone,payment_method,payment_status,currency,total_amount,total_htg,delivery_type,delivery_address,pickup_point_code,delivery_notes")
    .in("id", ids);
  if (error) throw error;
  return data || [];
}

// Machine à états : pas de saut, pas de delivered/cancelled ici.
// `handed_off` n'est PAS une action manuelle du marchand : le backend le pose
// lui-même quand le livreur a réellement récupéré le colis (picked_up). Le
// marchand confirme la remise via merchant_confirm_delivery_handoff_v1, jamais
// en forçant le statut de la commande.
export const ORDER_FLOW = ["new", "accepted", "preparing"];

export function nextOrderStatus(current) {
  const i = ORDER_FLOW.indexOf(current);
  return i >= 0 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null;
}

export async function updateMerchantOrderStatus(merchantOrderId, status) {
  const { sb } = await authed();
  if (!merchantOrderId) throw new Error("order-required");
  if (!ORDER_FLOW.includes(status) || status === "new") throw new Error("invalid-status");
  const { data, error } = await sb.rpc("merchant_update_order_status", {
    p_merchant_order_id: merchantOrderId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

// --- Abonnement Professional (lecture seule, RLS owner select) -----------
// Le moteur de facturation est 100% backend (activate_professional_subscription /
// generate_due_professional_invoices / mark_merchant_subscription_invoice_paid).
// Le frontend NE MARQUE JAMAIS une facture payée et ne déduit rien d'un payout.
export async function getMySubscription(merchantId) {
  if (!merchantId) return null;
  const { sb } = await authed();
  const { data, error } = await sb
    .from("merchant_subscriptions")
    .select(
      "merchant_id,plan_code,status,current_period_start,current_period_end,next_invoice_at,monthly_fee_htg,currency,environment"
    )
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getMySubscriptionInvoices(merchantId, { limit = 24 } = {}) {
  if (!merchantId) return [];
  const { sb } = await authed();
  const { data, error } = await sb
    .from("merchant_subscription_invoices")
    .select(
      "id,plan_code,billing_period_start,billing_period_end,amount_htg,currency,status,due_at,paid_at,payment_provider,payment_reference,environment"
    )
    .eq("merchant_id", merchantId)
    .order("billing_period_start", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
