// Service commandes — appelle le RPC serveur officiel.
//
//   public.create_marketplace_order(
//     p_items jsonb, p_full_name text, p_phone text,
//     p_payment_method text, p_delivery_type text,
//     p_email text default null, p_delivery_address jsonb default '{}',
//     p_pickup_point_code text default null, p_delivery_notes text default null
//   )
//
// RÈGLE FINANCIÈRE ABSOLUE : le frontend n'envoie AUCUN montant.
// Les lignes ne contiennent que product_id / quantity / pricing_tier.
// Le serveur est autoritaire pour subtotal / rabais / livraison / commission /
// payout / total. Le récap avant envoi est une simple estimation d'affichage.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { isLiveProductId } from "./productType.js";

export async function getActiveSession() {
  const s = await getSession();
  return s && s.user ? s : null;
}

// Ne conserve que les clés autorisées par ligne : product_id, variant_id
// (uniquement si la ligne référence une variante réelle), quantity, pricing_tier.
// Le backend (create_marketplace_order) refuse une commande sans variant_id pour
// un produit à variantes, et refuse un variant_id pour un produit sans variantes.
export function toOrderLines(cartItems = []) {
  return cartItems.map((it) => {
    const productId = it.productId || it.id;
    // Défense en profondeur : même un ancien panier local injecté manuellement
    // ne peut pas franchir la frontière vers create_marketplace_order.
    if (!isLiveProductId(productId) || it.productType === "demo") {
      throw new Error("demo-product-not-purchasable");
    }
    const line = {
      product_id: productId,
      quantity: Math.max(1, parseInt(it.qty, 10) || 1),
      pricing_tier: it.pricingTier === "wholesale" ? "wholesale" : "retail",
    };
    if (it.variantId) line.variant_id = it.variantId;
    return line;
  });
}

export async function createMarketplaceOrder({
  items,
  fullName,
  phone,
  email = null,
  paymentMethod,
  deliveryType,
  deliveryAddress = {},
  pickupPointCode = null,
  deliveryNotes = null,
}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");

  const payload = {
    p_items: items,
    p_full_name: fullName,
    p_phone: phone,
    p_payment_method: paymentMethod,
    p_delivery_type: deliveryType,
    p_email: email || null,
    p_delivery_address: deliveryAddress || {},
    p_pickup_point_code: pickupPointCode || null,
    p_delivery_notes: deliveryNotes || null,
  };

  const { data, error } = await sb.rpc("create_marketplace_order", payload);
  if (error) throw error;
  return data;
}

// --- Lecture des commandes du client (RLS autoritaire) ---------------------
// Aucun filtre user_id fourni par l'UI : RLS restreint déjà aux lignes du client.

const ORDER_FIELDS =
  "id,full_name,email,phone,payment_method,payment_status,delivery_type," +
  "delivery_address,pickup_point_code,delivery_notes,currency,subtotal_amount,payment_discount_amount," +
  "shipping_amount,total_amount,subtotal_htg,payment_discount_htg,shipping_htg,total_htg," +
  "status,environment,client_delivery_confirmed,created_at,updated_at";

const ORDER_ITEM_FIELDS =
  "order_id,product_id,product_name,product_slug,sku,product_image_path," +
  "pricing_tier,currency,unit_price_amount,unit_price_htg,quantity,line_total_amount,line_total_htg,created_at";

export async function getMyOrders() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");

  // L'id vient TOUJOURS de la session Auth, jamais d'un argument UI.
  const session = await getSession();
  const user = session && session.user;
  if (!user) throw new Error("not-authenticated");

  const { data, error } = await sb
    .from("orders")
    .select(ORDER_FIELDS)
    .eq("user_id", user.id) // portée sémantique « mes » commandes (RLS reste la sécurité)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Lecture minimale d'une commande (page de retour paiement, Feature #10) :
// on ne connaît que order_id via l'URL, il faut d'abord savoir quel moyen de
// paiement a réellement été utilisé avant d'interroger le bon vérificateur
// (FlexiCash vs MonCash vs autre). Filtrage explicite sur user_id EN PLUS de
// RLS (défense en profondeur, même garantie que l'ancien getMyOrder()) : RLS
// reste la sécurité réelle, ce filtre évite juste de dépendre d'elle seule.
const ORDER_SUMMARY_FIELDS = "id,payment_method,payment_status,status,currency,total_amount,total_htg,environment,created_at";

export async function getOrderPaymentSummary(orderId) {
  if (!orderId) return null;
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  const user = session && session.user;
  if (!user) throw new Error("not-authenticated");

  const { data, error } = await sb
    .from("orders")
    .select(ORDER_SUMMARY_FIELDS)
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getOrderItems(orderId) {
  if (!orderId) return [];
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb
    .from("order_items")
    .select(ORDER_ITEM_FIELDS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Un seul appel pour tous les articles de plusieurs commandes (évite le N+1).
export async function getOrderItemsByOrderIds(orderIds = []) {
  const ids = (orderIds || []).filter(Boolean);
  if (!ids.length) return [];
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb
    .from("order_items")
    .select(ORDER_ITEM_FIELDS)
    .in("order_id", ids)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
