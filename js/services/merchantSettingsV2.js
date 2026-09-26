import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function client() {
  const sb = getSupabase();
  const session = await getSession();
  if (!sb || !session?.user) throw new Error("merchant_authentication_required");
  return sb;
}

export async function getMyMerchantAddressContext() {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_merchant_address_context_v1", {});
  if (error) throw error;
  if (!data || data.state !== "ready" || !data.business_address || typeof data.business_address !== "object") {
    throw new Error("merchant_address_context_malformed");
  }
  return data;
}

export async function updateMyMerchantProfileV2({ shopName, description, whatsappNumber, businessAddress } = {}) {
  const sb = await client();
  const name = String(shopName || "").trim();
  if (!name) throw new Error("shop_name_required");
  if (!businessAddress || typeof businessAddress !== "object") throw new Error("address_object_required");
  const { data, error } = await sb.rpc("update_my_merchant_profile_v2", {
    p_shop_name: name,
    p_description: String(description || "").trim() || null,
    p_whatsapp_number: String(whatsappNumber || "").trim() || null,
    p_business_address: businessAddress,
  });
  if (error) throw error;
  if (!data || data.state !== "ready") throw new Error("merchant_profile_update_malformed");
  return data;
}
