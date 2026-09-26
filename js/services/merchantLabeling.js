import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("supabase-not-configured");
  const session = await getSession();
  if (!session?.user) throw new Error("not-authenticated");
  return sb;
}

async function rpc(name, params = {}) {
  const sb = await authed();
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data && typeof data === "object" ? data : {};
}

export function newLabelingRequestKey() {
  try {
    return `vinht-labeling-${crypto.randomUUID()}`;
  } catch {
    return `vinht-labeling-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

export const getMyLabelingServiceContext = () => rpc("get_my_labeling_service_context_v1");

export function searchMyLabelingTargets(search = "", limit = 50, offset = 0) {
  return rpc("search_my_labeling_targets_v1", {
    p_search: String(search || "").trim() || null,
    p_limit: Math.max(1, Math.min(Number(limit) || 50, 100)),
    p_offset: Math.max(0, Number(offset) || 0),
  });
}

export function ensureMyProductIdentifier(productId, variantId = null) {
  if (!productId) throw new Error("product-required");
  return rpc("ensure_my_product_identifier_v1", {
    p_product_id: productId,
    p_variant_id: variantId || null,
  });
}

export function setMyProductIdentifier(productId, variantId = null, gtin = null, asin = null) {
  if (!productId) throw new Error("product-required");
  return rpc("set_my_product_identifier_v1", {
    p_product_id: productId,
    p_variant_id: variantId || null,
    p_gtin: String(gtin || "").trim() || null,
    p_asin: String(asin || "").trim() || null,
  });
}

export function quoteMyLabelingServiceOrder(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("items-required");
  return rpc("quote_my_labeling_service_order_v1", { p_items: items });
}

export function createMyLabelingServiceOrder(items, customerNotes, idempotencyKey) {
  if (!Array.isArray(items) || !items.length) throw new Error("items-required");
  if (!idempotencyKey) throw new Error("idempotency-key-required");
  return rpc("create_my_labeling_service_order_v1", {
    p_items: items,
    p_customer_notes: String(customerNotes || "").trim() || null,
    p_idempotency_key: idempotencyKey,
  });
}

export function listMyLabelingServiceOrders(status = null, limit = 20, offset = 0) {
  return rpc("list_my_labeling_service_orders_v1", {
    p_status: status || null,
    p_limit: Math.max(1, Math.min(Number(limit) || 20, 100)),
    p_offset: Math.max(0, Number(offset) || 0),
  });
}

export function getMyLabelingServiceOrder(orderId) {
  if (!orderId) throw new Error("order-required");
  return rpc("get_my_labeling_service_order_v1", { p_order_id: orderId });
}
