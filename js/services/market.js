import { getSupabase } from "./supabase.js";
import { getProducts } from "./catalog.js";

function client(){const sb=getSupabase();if(!sb)throw new Error("Supabase non configuré");return sb}

const MERCHANT_FIELDS="id,shop_name,description,merchant_type,plan_code,delivery_zone,logo_url,cover_url,status,trust_level,trust_score,average_rating,rating_count,successful_orders_count";
const PRODUCT_FIELDS=[
  "id","merchant_id","category_id","slug","sku","name","tagline","description","currency","retail_price","wholesale_price","wholesale_min_qty","compare_at_price","stock","delivery_zone","estimated_delivery_days","created_at",
  "merchants!products_merchant_id_fkey(id,shop_name,average_rating,rating_count,trust_score,trust_level,merchant_type,delivery_zone,status)",
  "product_images!product_images_product_id_fkey(storage_path,alt_text,position,is_primary)"
].join(",");

export async function getPublicMerchants({limit=100}={}){
  const {data,error}=await client().from("merchants").select(MERCHANT_FIELDS).eq("status","active").order("trust_score",{ascending:false}).limit(limit);
  if(error)throw error;return data||[];
}
export async function getPublicMerchant(id){
  if(!id)return null;const{data,error}=await client().from("merchants").select(MERCHANT_FIELDS).eq("id",id).eq("status","active").maybeSingle();if(error)throw error;return data||null;
}
export async function getPublicMerchantsByIds(ids=[]){
  const list=[...new Set((ids||[]).filter(Boolean))];if(!list.length)return[];const{data,error}=await client().from("merchants").select(MERCHANT_FIELDS).in("id",list).eq("status","active");if(error)throw error;return data||[];
}
export async function getPublicProductsByMerchant(merchantId,{limit=80}={}){
  if(!merchantId)return[];const{data,error}=await client().from("products").select(PRODUCT_FIELDS).eq("merchant_id",merchantId).eq("is_active",true).order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[];
}
export async function getDeals({limit=48}={}){
  const rows=await getProducts({limit:Math.max(limit,80),sort:"default"});
  return rows.filter(p=>p.compare_at_price!=null&&p.retail_price!=null&&Number(p.compare_at_price)>Number(p.retail_price)).slice(0,limit);
}
export async function getNewArrivals({limit=48}={}){return getProducts({limit,sort:"newest"})}
