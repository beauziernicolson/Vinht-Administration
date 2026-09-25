import { adminRpc } from "./adminControl.js";

const reason = (v) => String(v || "").trim();
const requiredId = (v, code) => { if (!v) throw new Error(code); return v; };

export async function adminReopenCourierApplication(courierProfileId, why) {
  const r = reason(why);
  if (!courierProfileId) throw new Error("courier_profile_required");
  if (r.length < 5) throw new Error("reopen_reason_required");
  return adminRpc("admin_reopen_courier_application_v1", {
    p_courier_profile_id: courierProfileId,
    p_reason: r,
  });
}

// Catalogue : l'Admin réutilise les moteurs catalogue côté serveur.
// Le backend garde les mêmes validations métier et journalise actor_role='admin'.
export async function adminCreateCatalogProduct(merchantId, values = {}) {
  const currency = String(values.currency || "HTG").trim().toUpperCase();
  if (!["HTG", "USD"].includes(currency)) throw new Error("unsupported_product_currency");
  const stock = Number(values.stock ?? 0);
  if (!Number.isInteger(stock) || stock < 0) throw new Error("invalid_stock");
  return adminRpc("agent_create_product_v2", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_category_id: requiredId(values.categoryId, "active_category_required"),
    p_name: values.name,
    p_retail_price: values.retailPrice,
    p_stock: stock,
    p_sku: values.sku || null,
    p_tagline: values.tagline || null,
    p_description: values.description || null,
    p_wholesale_price: values.wholesalePrice,
    p_wholesale_min_qty: values.wholesaleMinQty,
    p_compare_at_price: values.compareAtPrice,
    p_delivery_zone: values.deliveryZone || null,
    p_estimated_delivery_days: values.estimatedDeliveryDays,
    p_search_keywords: Array.isArray(values.searchKeywords) ? values.searchKeywords : [],
    p_currency: currency,
  });
}

export async function adminGetCatalogProductContext(merchantId, productId) {
  return adminRpc("agent_get_product_context_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_product_id: requiredId(productId, "product_id_required"),
  });
}

export async function adminUpdateCatalogProductContent(merchantId, productId, values = {}) {
  return adminRpc("agent_update_product_content_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_product_id: requiredId(productId, "product_id_required"),
    p_category_id: values.categoryId || null,
    p_name: values.name,
    p_retail_price: values.retailPrice,
    p_sku: values.sku || null,
    p_tagline: values.tagline || null,
    p_description: values.description || null,
    p_wholesale_price: values.wholesalePrice,
    p_wholesale_min_qty: values.wholesaleMinQty,
    p_compare_at_price: values.compareAtPrice,
    p_delivery_zone: values.deliveryZone || null,
    p_estimated_delivery_days: values.estimatedDeliveryDays,
    p_search_keywords: Array.isArray(values.searchKeywords) ? values.searchKeywords : [],
  });
}

export async function adminSetCatalogProductStock(merchantId, productId, stock) {
  const n = Number(stock);
  if (!Number.isInteger(n) || n < 0) throw new Error("invalid_stock");
  return adminRpc("agent_set_product_stock_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_product_id: requiredId(productId, "product_id_required"),
    p_stock: n,
  });
}

export async function adminUpdateCatalogVariantInventory(merchantId, variantId, stock, isActive = null) {
  const n = Number(stock);
  if (!Number.isInteger(n) || n < 0) throw new Error("invalid_variant_stock");
  return adminRpc("agent_update_product_variant_inventory_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_variant_id: requiredId(variantId, "variant_required"),
    p_stock: n,
    p_is_active: typeof isActive === "boolean" ? isActive : null,
  });
}

export async function adminSetCatalogProductActive(merchantId, productId, isActive) {
  return adminRpc("agent_set_product_active_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_product_id: requiredId(productId, "product_id_required"),
    p_is_active: !!isActive,
  });
}

export async function adminReplaceCatalogProductVariants(merchantId, productId, variants) {
  if (!Array.isArray(variants)) throw new Error("variants_array_required");
  return adminRpc("agent_replace_product_variants_v1", {
    p_merchant_id: requiredId(merchantId, "merchant_required"),
    p_product_id: requiredId(productId, "product_id_required"),
    p_variants: variants,
  });
}

export async function adminGetAdvancedControls() {
  const data = await adminRpc("admin_get_advanced_controls_v1", {});
  if (!data || data.state !== "ready") throw new Error("advanced_controls_malformed_response");
  return data;
}

export async function adminSetProfessionalPlanPricing({ monthlyFeeHtg, commissionRate, reason: why }) {
  const monthly = Number(monthlyFeeHtg);
  const commission = Number(commissionRate);
  const r = reason(why);
  if (!Number.isFinite(monthly) || monthly < 0) throw new Error("invalid_professional_monthly_fee");
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) throw new Error("invalid_professional_commission_rate");
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_set_professional_plan_pricing_v1", {
    p_monthly_fee_htg: monthly,
    p_commission_rate: commission,
    p_reason: r,
  });
}

export async function adminUpdateBillingPolicyControls({ graceDays, autoSuspendUnpaid, reactivateOnPayment, fixedFeesPaused, reason: why }) {
  const grace = Number(graceDays);
  const r = reason(why);
  if (!Number.isInteger(grace) || grace < 0 || grace > 30) throw new Error("invalid_grace_days");
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_update_billing_policy_controls_v1", {
    p_grace_days: grace,
    p_auto_suspend_unpaid: !!autoSuspendUnpaid,
    p_reactivate_on_payment: !!reactivateOnPayment,
    p_fixed_fees_paused: !!fixedFeesPaused,
    p_reason: r,
  });
}

export async function adminSetNotificationChannelRuntime(channel, enabled, why) {
  const r = reason(why);
  if (!["email", "sms", "whatsapp", "push"].includes(channel)) throw new Error("invalid_notification_channel");
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_set_notification_channel_runtime_v1", {
    p_channel: channel,
    p_enabled: !!enabled,
    p_reason: r,
  });
}

export async function adminUpdateReputationSettings(values) {
  const r = reason(values?.reason);
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_update_reputation_settings_v1", {
    p_evaluation_days: Number(values.evaluationDays),
    p_fallback_days: Number(values.fallbackDays),
    p_provisional_min_orders: Number(values.provisionalMinOrders),
    p_established_min_orders: Number(values.establishedMinOrders),
    p_review_window_days: Number(values.reviewWindowDays),
    p_review_edit_days: Number(values.reviewEditDays),
    p_satisfaction_weight: Number(values.satisfactionWeight),
    p_success_weight: Number(values.successWeight),
    p_cancellation_weight: Number(values.cancellationWeight),
    p_dispute_weight: Number(values.disputeWeight),
    p_delivery_weight: Number(values.deliveryWeight),
    p_excellent_threshold: Number(values.excellentThreshold),
    p_good_threshold: Number(values.goodThreshold),
    p_watch_threshold: Number(values.watchThreshold),
    p_reason: r,
  });
}
