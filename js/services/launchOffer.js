import { getSupabase } from "./supabase.js";

export async function getMarketplaceLaunchOffer(){
  const sb=getSupabase();
  if(!sb) throw new Error("backend_unavailable");
  const {data,error}=await sb.rpc("get_marketplace_launch_offer_v1",{});
  if(error) throw error;
  return data||null;
}
