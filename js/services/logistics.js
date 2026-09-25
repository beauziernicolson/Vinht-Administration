import { getSupabase } from "./supabase.js";

export async function getCheckoutDeliveryCapabilities(currency="HTG"){
  const sb=getSupabase();
  if(!sb)throw new Error("Supabase non configuré");
  const normalized=String(currency||"HTG").trim().toUpperCase();
  if(!["HTG","USD"].includes(normalized))throw new Error("invalid_currency");
  const{data,error}=await sb.rpc("get_checkout_delivery_capabilities_v1",{p_currency:normalized});
  if(error)throw error;
  if(!data||data.state!=="ready"||data.currency!==normalized||!data.delivery_methods)throw new Error("delivery_capabilities_malformed_response");
  return data;
}
