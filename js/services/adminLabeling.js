import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { getMyRoles } from "./profile.js";

async function adminClient(){
  const sb=getSupabase();
  if(!sb)throw new Error("Supabase non configuré");
  const session=await getSession();
  if(!session?.user)throw new Error("not-authenticated");
  const roles=await getMyRoles();
  if(!roles.includes("admin"))throw new Error("not-admin");
  return sb;
}

async function rpc(name,args={}){
  const sb=await adminClient();
  const {data,error}=await sb.rpc(name,args);
  if(error)throw error;
  return data;
}

export const getLabelingDashboard=()=>rpc("admin_get_labeling_dashboard_v1");
export const listLabelSupplyPurchases=(limit=50)=>rpc("admin_list_label_supply_purchases_v1",{p_limit:limit});
export const listLabelingOrders=({status=null,limit=100}={})=>rpc("admin_list_labeling_service_orders_v1",{p_status:status||null,p_limit:limit});
export const getLabelingOrder=(id)=>rpc("admin_get_labeling_service_order_v1",{p_order_id:id});
export const getLabelBatch=(id)=>rpc("admin_get_label_batch_v1",{p_order_id:id});
export const scanLabelCode=(code)=>rpc("admin_scan_label_code_v1",{p_code:String(code||"").trim()});

export function updateLabelingSettings(values){
  return rpc("admin_update_labeling_settings_v1",{
    p_enabled:!!values.enabled,
    p_price_per_unit_htg:Number(values.pricePerUnit||0),
    p_labor_cost_per_unit_htg:Number(values.laborCost||0),
    p_overhead_cost_per_unit_htg:Number(values.overheadCost||0),
    p_minimum_units:Number(values.minimumUnits||1),
    p_standard_label_template:String(values.template||"STANDARD").trim()||"STANDARD",
    p_customer_instructions:String(values.instructions||"").trim()||null,
    p_reason:String(values.reason||"").trim()||null,
  });
}

export function recordLabelSupplyPurchase(values){
  return rpc("admin_record_label_supply_purchase_v1",{
    p_template_code:String(values.template||"STANDARD").trim()||"STANDARD",
    p_quantity:Number(values.quantity||0),
    p_total_cost_htg:Number(values.totalCost||0),
    p_supplier_name:String(values.supplier||"").trim()||null,
    p_purchase_reference:String(values.reference||"").trim()||null,
    p_purchased_at:values.purchasedAt||null,
    p_notes:String(values.notes||"").trim()||null,
  });
}

export function createLabelingOrder({merchantId,items,customerNotes=null,internalNotes=null}){
  return rpc("admin_create_labeling_service_order_v1",{
    p_merchant_id:merchantId,
    p_items:items,
    p_customer_notes:customerNotes,
    p_internal_notes:internalNotes,
  });
}

export function updateLabelingItemCounts(itemId,{received,labeled,qaPassed}){
  return rpc("admin_update_labeling_item_counts_v1",{
    p_order_item_id:itemId,
    p_received_qty:Number(received||0),
    p_labeled_qty:Number(labeled||0),
    p_qa_passed_qty:Number(qaPassed||0),
  });
}

export function transitionLabelingOrder(orderId,status,note=null){
  return rpc("admin_transition_labeling_service_order_v1",{
    p_order_id:orderId,
    p_new_status:status,
    p_note:String(note||"").trim()||null,
  });
}

export function upsertProductIdentifier(productId,{variantId=null,gtin=null,asin=null}={}){
  return rpc("admin_upsert_product_identifier_v1",{
    p_product_id:productId,
    p_variant_id:variantId||null,
    p_gtin:String(gtin||"").trim()||null,
    p_asin:String(asin||"").trim()||null,
  });
}

export async function getLabelingCatalog(){
  const sb=await adminClient();
  const [{data:merchants,error:me},{data:products,error:pe},{data:variants,error:ve}]=await Promise.all([
    sb.from("merchants").select("id,shop_name,status,environment").order("shop_name"),
    sb.from("products").select("id,merchant_id,name,sku,environment,approval_status,is_active").order("name"),
    sb.from("product_variants").select("id,product_id,sku,option_values,is_active,archived_at").is("archived_at",null).order("position"),
  ]);
  if(me)throw me;if(pe)throw pe;if(ve)throw ve;
  return {merchants:merchants||[],products:products||[],variants:variants||[]};
}
