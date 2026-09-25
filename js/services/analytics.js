import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
async function authed(){const sb=getSupabase();if(!sb)throw new Error("Supabase non configuré");const session=await getSession();if(!session?.user)throw new Error("not-authenticated");return{sb,user:session.user}}
export async function getMerchantProductEvents(merchantId,{limit=500}={}){
  if(!merchantId)return[];const{sb}=await authed();const{data,error}=await sb.from("product_events").select("id,product_id,merchant_id,event_type,source,created_at").eq("merchant_id",merchantId).order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[];
}
export async function getAdminProductEvents({limit=1000}={}){
  const{sb}=await authed();const{data,error}=await sb.from("product_events").select("id,product_id,merchant_id,event_type,source,created_at").order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[];
}
