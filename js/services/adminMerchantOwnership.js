import { adminRpc } from "./adminControl.js";

const text = (v) => String(v ?? "").trim();

export async function adminUpdateMerchantOperationalProfile({
  merchantId,
  shopName,
  description = null,
  whatsappNumber = null,
  businessAddress = null,
  reason,
} = {}) {
  if (!merchantId) throw new Error("merchant_required");
  const name = text(shopName);
  const why = text(reason);
  if (!name || name.length > 160) throw new Error("invalid_shop_name");
  if (text(description).length > 2000) throw new Error("shop_description_too_long");
  if (text(whatsappNumber).length > 40) throw new Error("whatsapp_too_long");
  if (why.length < 5) throw new Error("reason_required");
  return adminRpc("admin_update_merchant_operational_profile_v1", {
    p_merchant_id: merchantId,
    p_shop_name: name,
    p_description: text(description) || null,
    p_whatsapp_number: text(whatsappNumber) || null,
    p_business_address: businessAddress || null,
    p_reason: why,
  });
}
