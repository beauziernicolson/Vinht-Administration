import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { getMyRoles } from "./profile.js";

async function adminClient(){
  const sb=getSupabase();if(!sb)throw new Error("Supabase non configuré");
  const session=await getSession();if(!session?.user)throw new Error("not-authenticated");
  const roles=await getMyRoles();if(!roles.includes("admin"))throw new Error("not-admin");
  return sb;
}
async function countTable(sb,table,apply){let q=sb.from(table).select("id",{count:"exact",head:true});if(apply)q=apply(q);const{count,error}=await q;if(error)throw error;return count||0}
function adminEnv(value){const env=String(value||"").toLowerCase();if(env!=="production"&&env!=="demo")throw new Error("environment-invalid");return env}

// Source unique de l'environnement admin : profiles.commerce_environment de l'admin
// connecté (c'est aussi ce que app_private.current_commerce_environment() lit côté RPC).
// Aucun repli silencieux sur "production" : si l'environnement est inconnu, on échoue.
let _adminEnvCache=null;
export function invalidateAdminEnvironment(){_adminEnvCache=null}
export async function getAdminEnvironment(){
  const sb=await adminClient();
  const session=await getSession();const uid=session?.user?.id;
  if(_adminEnvCache&&_adminEnvCache.uid===uid)return _adminEnvCache.env;
  const{data,error}=await sb.from("profiles").select("commerce_environment").eq("id",uid).maybeSingle();
  if(error)throw error;
  const env=String(data?.commerce_environment||"").toLowerCase();
  if(env!=="production"&&env!=="demo")throw new Error("admin_environment_unknown");
  _adminEnvCache={uid,env};
  return env;
}
// Un environnement explicite est validé ; sinon on utilise celui de l'admin.
async function resolveEnv(value){return(value===undefined||value===null||value==="")?getAdminEnvironment():adminEnv(value)}

export async function getAdminOverview({environment}={}){
  const sb=await adminClient(),env=await resolveEnv(environment);
  const [products,merchants,orders,users,pendingProducts]=await Promise.all([
    countTable(sb,"products",q=>q.eq("environment",env)),countTable(sb,"merchants",q=>q.eq("environment",env)),countTable(sb,"orders",q=>q.eq("environment",env)),countTable(sb,"profiles"),
    countTable(sb,"products",q=>q.eq("environment",env).eq("approval_status","pending")),
  ]);
  return{products,merchants,orders,users,pendingProducts,environment:env};
}
export async function getAdminProducts({limit=250,environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);const{data,error}=await sb.from("products").select("id,name,sku,merchant_id,currency,retail_price,wholesale_price,stock,approval_status,is_active,rejection_reason,environment,created_at,merchants!products_merchant_id_fkey(shop_name,status)").eq("environment",env).order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[]}
export async function getAdminMerchants({limit=200,environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);const{data,error}=await sb.from("merchants").select("id,user_id,shop_name,merchant_type,plan_code,status,environment,trust_level,trust_score,average_rating,rating_count,created_at").eq("environment",env).order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[]}
export async function getAdminOrders({limit=250,environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);const{data,error}=await sb.from("orders").select("id,user_id,full_name,email,phone,payment_method,payment_status,delivery_type,currency,total_amount,total_htg,status,environment,created_at").eq("environment",env).order("created_at",{ascending:false}).limit(limit);if(error)throw error;return data||[]}
export async function getAdminUsers({limit=250}={}){const sb=await adminClient();const[{data:profiles,error:pe},{data:roles,error:re}]=await Promise.all([sb.from("profiles").select("id,full_name,email,phone,notifications_enabled,whatsapp_updates,commerce_environment,created_at").order("created_at",{ascending:false}).limit(limit),sb.from("user_roles").select("user_id,role")]);if(pe)throw pe;if(re)throw re;const roleMap=new Map();for(const r of roles||[]){if(!roleMap.has(r.user_id))roleMap.set(r.user_id,[]);roleMap.get(r.user_id).push(r.role)}return(profiles||[]).map(p=>({...p,roles:roleMap.get(p.id)||[]}))}

export async function getAdminProduct(id,{environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);if(!id)return null;const{data,error}=await sb.from("products").select("*,merchants!products_merchant_id_fkey(id,shop_name,status,merchant_type,plan_code,trust_score),categories(id,name,slug)").eq("id",id).eq("environment",env).maybeSingle();if(error)throw error;return data||null}
export async function getAdminMerchant(id,{environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);if(!id)return null;const{data,error}=await sb.from("merchants").select("*").eq("id",id).eq("environment",env).maybeSingle();if(error)throw error;return data||null}
export async function reviewAdminProduct(id,decision,reason){const sb=await adminClient();if(!id)throw new Error("product-required");if(decision!=="approve"&&decision!=="reject")throw new Error("decision-invalid");if(decision==="reject"&&!String(reason||"").trim())throw new Error("reason-required");const{data,error}=await sb.rpc("admin_review_product",{p_product_id:id,p_decision:decision,p_reason:decision==="reject"?String(reason).trim():null});if(error)throw error;return data}
export async function getAdminOrder(id,{environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);if(!id)return null;const[{data:order,error:oe},{data:items,error:ie},{data:alloc,error:ae}]=await Promise.all([sb.from("orders").select("*").eq("id",id).eq("environment",env).maybeSingle(),sb.from("order_items").select("*").eq("order_id",id).order("created_at",{ascending:true}),sb.from("merchant_orders").select("*").eq("order_id",id)]);if(oe)throw oe;if(ie)throw ie;if(ae)throw ae;return order?{...order,items:items||[],merchant_orders:alloc||[]}:null}
// Bloc 2 — alertes "versement déjà payé, reversal requis" (lecture seule).
// Le backend écrit lui-même ce marqueur exact (payout_status reste "paid" +
// payout_error se terminant par "_after_payout_reversal_required" — voir
// migration 20260921173004). Cette fonction ne fait que lire ce fait déjà posé
// par le serveur ; elle ne décide jamais qu'un reversal est nécessaire.
// L'environnement est dérivé côté serveur par admin_list_payout_reversal_alerts_v1
// (app_private.current_commerce_environment()) — jamais un paramètre client ;
// `environment` ici ne sert qu'à une vérification de cohérence côté lecture.
export async function getAdminPayoutReversalAlerts({environment,limit=50,offset=0}={}){
  const sb=await adminClient(),expectedEnv=await resolveEnv(environment);
  const safeLimit=Math.max(1,Math.min(Number(limit)||50,200));
  const safeOffset=Math.max(0,Number(offset)||0);
  const{data,error}=await sb.rpc("admin_list_payout_reversal_alerts_v1",{
    p_limit:safeLimit,
    p_offset:safeOffset,
  });
  if(error)throw error;
  if(!data||data.state!=="ready"||data.environment!==expectedEnv||!Array.isArray(data.rows)){
    throw new Error("payout_reversal_alerts_malformed_response");
  }
  return data.rows;
}
export async function getAdminUser(id){const sb=await adminClient();if(!id)return null;const[{data:profile,error:pe},{data:roles,error:re}]=await Promise.all([sb.from("profiles").select("*").eq("id",id).maybeSingle(),sb.from("user_roles").select("role,created_at").eq("user_id",id)]);if(pe)throw pe;if(re)throw re;return profile?{...profile,roles:(roles||[]).map(x=>x.role)}:null}
export async function getAdminCategories(){const sb=await adminClient();const{data,error}=await sb.from("categories").select("id,parent_id,slug,name,description,icon,position,is_active,created_at,updated_at").order("position",{ascending:true});if(error)throw error;return data||[]}
export async function setAdminCategoryActive(id,isActive){const sb=await adminClient();const{data,error}=await sb.from("categories").update({is_active:!!isActive}).eq("id",id).select("id,name,is_active").single();if(error)throw error;return data}
export async function getAdminFeatured({environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);const{data,error}=await sb.from("featured_products").select("id,product_id,position,is_active,starts_at,ends_at,created_at,products!featured_products_product_id_fkey(id,name,retail_price,approval_status,is_active,environment)").order("position",{ascending:true});if(error)throw error;return(data||[]).filter(x=>x.products?.environment===env)}
export async function setAdminFeaturedActive(id,isActive){const sb=await adminClient();const{data,error}=await sb.from("featured_products").update({is_active:!!isActive}).eq("id",id).select("id,is_active").single();if(error)throw error;return data}
export async function addAdminFeatured(productId,position=0,{environment}={}){const sb=await adminClient(),env=await resolveEnv(environment);const{data:product,error:pe}=await sb.from("products").select("id").eq("id",productId).eq("environment",env).maybeSingle();if(pe)throw pe;if(!product)throw new Error("product_not_in_admin_environment");const{data,error}=await sb.from("featured_products").insert({product_id:productId,position:Number(position)||0,is_active:true}).select("id,product_id,position,is_active").single();if(error)throw error;return data}
export async function removeAdminFeatured(id){const sb=await adminClient();const{error}=await sb.from("featured_products").delete().eq("id",id);if(error)throw error}

// Environnement commerce d'un utilisateur (Production / Demo). Décision serveur :
// RPC SECURITY DEFINER admin. Le navigateur ne choisit jamais lui-même.
export async function setUserCommerceEnvironment(userId,environment,reason){
  const sb=await adminClient();
  if(!userId)throw new Error("user-required");
  if(environment!=="production"&&environment!=="demo")throw new Error("environment-invalid");
  if(!String(reason||"").trim()||String(reason).trim().length<5)throw new Error("reason-required");
  const{data,error}=await sb.rpc("admin_set_user_commerce_environment",{p_user_id:userId,p_environment:environment,p_reason:String(reason).trim()});
  if(error)throw error;invalidateAdminEnvironment();return data;
}

export async function adminGetIndividualPricing(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_individual_pricing_v1",{});
  if(error)throw error;
  if(!data||data.state!=="ready"||data.plan_code!=="individual")throw new Error("individual_pricing_malformed_response");
  return data;
}

export async function adminSetIndividualUsdFee(amount,reason=null){
  const sb=await adminClient();
  const normalized=(amount===null||amount===undefined||String(amount).trim()==="")?null:Number(amount);
  if(normalized!==null&&(!Number.isFinite(normalized)||normalized<0))throw new Error("invalid_individual_usd_fee");
  const{data,error}=await sb.rpc("admin_set_individual_usd_fee_v1",{
    p_per_item_fee_usd:normalized,
    p_reason:reason||null,
  });
  if(error)throw error;
  if(!data||data.state!=="ready"||data.plan_code!=="individual")throw new Error("individual_pricing_malformed_response");
  return data;
}

export async function adminSetIndividualTransactionCommission(rate,reason=null){
  const sb=await adminClient();
  const normalized=Number(rate);
  if(!Number.isFinite(normalized)||normalized<0||normalized>100)throw new Error("invalid_individual_commission_rate");
  const{data,error}=await sb.rpc("admin_set_individual_transaction_commission_v1",{
    p_commission_rate:normalized,
    p_reason:reason||null,
  });
  if(error)throw error;
  if(!data||data.state!=="ready"||data.plan_code!=="individual")throw new Error("individual_pricing_malformed_response");
  return data;
}

export async function adminGetMarketplaceLaunchOffer(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_marketplace_launch_offer_v1",{});
  if(error)throw error;
  if(!data||data.state!=="ready")throw new Error("launch_offer_malformed_response");
  return data;
}

export async function adminSetMarketplaceLaunchOffer({
  enabled,startDate,endDate,individualFeeHtg,individualFeeUsd,
  professionalMonthlyFeeHtg,commissionRate,reason=null,
}={}){
  const sb=await adminClient();
  const htg=Number(individualFeeHtg),usd=Number(individualFeeUsd),pro=Number(professionalMonthlyFeeHtg),commission=Number(commissionRate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate||""))||!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate||"")))throw new Error("invalid_launch_offer_dates");
  if([htg,usd,commission].some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(pro)||pro<=0||commission>100)throw new Error("invalid_launch_offer_pricing");
  const{data,error}=await sb.rpc("admin_set_marketplace_launch_offer_v1",{
    p_enabled:!!enabled,
    p_start_date:startDate,
    p_end_date:endDate,
    p_individual_fee_htg:htg,
    p_individual_fee_usd:usd,
    p_professional_monthly_fee_htg:pro,
    p_commission_rate:commission,
    p_reason:reason||null,
  });
  if(error)throw error;
  if(!data||data.state!=="ready")throw new Error("launch_offer_malformed_response");
  return data;
}

export async function adminGetUsdShippingPricing(environment){
  const sb=await adminClient();
  const env=await resolveEnv(environment);
  const{data,error}=await sb.rpc("admin_get_usd_shipping_pricing_v1",{p_environment:env});
  if(error)throw error;
  if(!data||data.state!=="ready"||data.environment!==env)throw new Error("usd_shipping_pricing_malformed_response");
  return data;
}

export async function adminSetUsdShippingPricing({
  environment,
  homeDeliveryFeeUsd=null,
  customLocationFeeUsd=null,
  pickupFeeUsd=null,
  reason=null,
}={}){
  const sb=await adminClient();
  const env=await resolveEnv(environment);
  const norm=(value)=>{
    if(value===null||value===undefined||String(value).trim()==="")return null;
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)throw new Error("invalid_usd_shipping_fee");
    return n;
  };
  const{data,error}=await sb.rpc("admin_set_usd_shipping_pricing_v1",{
    p_environment:env,
    p_home_delivery_fee_usd:norm(homeDeliveryFeeUsd),
    p_custom_location_fee_usd:norm(customLocationFeeUsd),
    p_pickup_fee_usd:norm(pickupFeeUsd),
    p_reason:reason||null,
  });
  if(error)throw error;
  if(!data||data.state!=="ready"||data.environment!==env)throw new Error("usd_shipping_pricing_malformed_response");
  return data;
}

export async function adminSetUsdShippingActivation({
  environment,
  enabled=false,
  homeEnabled=false,
  customEnabled=false,
  pickupEnabled=false,
  reason=null,
}={}){
  const sb=await adminClient();
  const env=await resolveEnv(environment);
  const{data,error}=await sb.rpc("admin_set_usd_shipping_activation_v1",{
    p_environment:env,
    p_enabled:!!enabled,
    p_home_enabled:!!homeEnabled,
    p_custom_enabled:!!customEnabled,
    p_pickup_enabled:!!pickupEnabled,
    p_reason:reason||null,
  });
  if(error)throw error;
  if(!data||data.state!=="ready"||data.environment!==env)throw new Error("usd_shipping_activation_malformed_response");
  return data;
}

// --- Feature #32 — Admin Control Center ------------------------------------
// Pivot transversal en lecture seule : le backend reste l'unique source de
// vérité pour ces compteurs. Une réponse absente/mal formée doit lever une
// exception, jamais être silencieusement convertie en état vide/zéro — voir
// adminPortal.js pour l'affichage d'un état d'erreur explicite en ce cas.
const isPlainObject=(v)=>!!v&&typeof v==="object"&&!Array.isArray(v);
const isFiniteNumber=(v)=>typeof v==="number"&&Number.isFinite(v);

const CC_ATTENTION_KEYS=["kyc_pending","products_pending","couriers_pending_review","trade_protection_open","certifications_pending","verification_badges_pending","seller_health_watch","seller_health_at_risk","pro_past_due","pro_suspended","flexicash_connections_not_ready","delivery_issues"];
const CC_MARKETPLACE_KEYS=["merchants_total","merchants_active","products_active","orders_pending_payment","payouts_pending","active_promotions","ad_campaigns_total"];

export async function adminGetPlatformControlCenter(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_platform_control_center_v1",{});
  if(error)throw error;
  if(!isPlainObject(data))throw new Error("control_center_malformed_response");
  if(data.state!=="ready")throw new Error("control_center_malformed_response");
  if(typeof data.environment!=="string"||!data.environment.trim())throw new Error("control_center_malformed_response");
  if(!isPlainObject(data.attention)||!CC_ATTENTION_KEYS.every((k)=>isFiniteNumber(data.attention[k])))throw new Error("control_center_malformed_response");
  if(!isPlainObject(data.marketplace)||!CC_MARKETPLACE_KEYS.every((k)=>isFiniteNumber(data.marketplace[k])))throw new Error("control_center_malformed_response");
  // Les objets runtime.promotions / runtime.ads doivent exister et être des
  // objets : leurs champs business internes restent, eux, tolérés absents
  // (contrat le permet réellement) — jamais inventés à false/0/"" pour autant,
  // voir le rendu tri-state dans adminPortal.js.
  if(!isPlainObject(data.runtime)||!isPlainObject(data.runtime.promotions)||!isPlainObject(data.runtime.ads))throw new Error("control_center_malformed_response");
  return data;
}

function isValidAdminListEnvelope(data){
  return isPlainObject(data)&&data.state==="ready"&&Array.isArray(data.rows)
    &&isFiniteNumber(data.total)&&data.total>=0
    &&isFiniteNumber(data.limit)&&isFiniteNumber(data.offset)
    &&typeof data.has_more==="boolean";
}

export async function adminListProfessionalSubscriptions({status=null,limit=50,offset=0}={}){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_list_professional_subscriptions_v1",{p_status:status||null,p_limit:limit,p_offset:offset});
  if(error)throw error;
  if(!isValidAdminListEnvelope(data))throw new Error("professional_subscriptions_malformed_response");
  return{rows:data.rows,total:data.total,limit:data.limit,offset:data.offset,hasMore:data.has_more};
}

export async function adminListFlexicashSellerConnections({status=null,limit=50,offset=0}={}){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_list_flexicash_seller_connections_v1",{p_status:status||null,p_limit:limit,p_offset:offset});
  if(error)throw error;
  if(!isValidAdminListEnvelope(data))throw new Error("flexicash_connections_malformed_response");
  return{rows:data.rows,total:data.total,limit:data.limit,offset:data.offset,hasMore:data.has_more};
}

// --- Feature #33 — Admin Economic Analytics --------------------------------
// Cockpit économique en lecture seule au-dessus des RPC #33. GMV, revenu
// plateforme, contribution, refunds, payouts, etc. ne sont jamais recalculés
// ni recomposés côté frontend — le backend reste l'unique source de vérité.
// Une réponse absente/mal formée lève toujours une exception, jamais un
// 0/[]/false silencieux (voir adminPortal.js pour l'affichage d'erreur).
const ECON_ORDERS_KEYS=["paid_orders_count","gmv_merchandise_htg","customer_paid_total_htg","merchant_promotions_htg","flexicash_discount_htg","shipping_charged_htg","refunded_orders_count","refunded_customer_total_htg","average_order_value_htg"];
const ECON_SALES_FEES_KEYS=["commission_5pct_htg","individual_per_item_fees_htg","sales_fees_total_htg"];
const ECON_SUBSCRIPTIONS_KEYS=["paid_revenue_htg","paid_invoices","due_htg","past_due_invoices"];
const ECON_LABELING_KEYS=["recognized_revenue_htg","estimated_cost_htg","completed_orders"];
const ECON_ADS_KEYS=["recognized_spend_htg","billable_clicks","active_campaigns"];
const ECON_PAYOUTS_KEYS=["sent_htg","sent_count","pending_htg","pending_count"];
const ECON_HEALTH_NUMERIC_KEYS=["merchants_total","merchants_active","merchants_pro","products_active","open_trade_claims","delivery_issues"];
const ECON_SELLER_HEALTH_KEYS=["excellent","good","watch","at_risk","new"];
const ECON_PLATFORM_REVENUE_KEYS=["commission_htg","per_item_fees_htg","subscription_revenue_htg","labeling_revenue_htg","ad_revenue_htg","gross_platform_revenue_htg","flexicash_discount_cost_htg","labeling_estimated_cost_htg","contribution_before_refund_adjustments_htg"];
const ECON_TIMESERIES_GRANULARITIES=["day","week","month"];
const ECON_TIMESERIES_ROW_KEYS=["gmv_htg","customer_paid_htg","flexicash_discount_htg","refunds_htg","commission_htg","per_item_fees_htg","subscription_revenue_htg"];
const ECON_TOP_MERCHANTS_SORTS=["gmv","platform_revenue","orders","payout"];
const ECON_TOP_PRODUCTS_SORTS=["sales","units","orders"];

const requireNumericKeys=(obj,keys)=>isPlainObject(obj)&&keys.every((k)=>isFiniteNumber(obj[k]));

export async function adminGetEconomicDashboard({from=null,to=null}={}){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_economic_dashboard_v1",{p_from:from||null,p_to:to||null});
  if(error)throw error;
  if(!isPlainObject(data)||data.state!=="ready")throw new Error("economic_dashboard_malformed_response");
  if(typeof data.environment!=="string"||!data.environment.trim())throw new Error("economic_dashboard_malformed_response");
  if(typeof data.currency!=="string"||!data.currency.trim())throw new Error("economic_dashboard_malformed_response");
  if(!isPlainObject(data.period))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.orders,ECON_ORDERS_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.sales_fees,ECON_SALES_FEES_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.subscriptions,ECON_SUBSCRIPTIONS_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.labeling,ECON_LABELING_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.ads,ECON_ADS_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.payouts,ECON_PAYOUTS_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!isPlainObject(data.marketplace_health)||!requireNumericKeys(data.marketplace_health,ECON_HEALTH_NUMERIC_KEYS)||!requireNumericKeys(data.marketplace_health.seller_health,ECON_SELLER_HEALTH_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!requireNumericKeys(data.platform_revenue,ECON_PLATFORM_REVENUE_KEYS))throw new Error("economic_dashboard_malformed_response");
  if(!isPlainObject(data.definitions))throw new Error("economic_dashboard_malformed_response");
  if(!isPlainObject(data.data_quality)||typeof data.data_quality.refund_adjusted_net_revenue_available!=="boolean"||typeof data.data_quality.net_profit_available!=="boolean"||typeof data.data_quality.message_fr!=="string")throw new Error("economic_dashboard_malformed_response");
  return data;
}

export async function adminGetEconomicTimeseries({from=null,to=null,granularity="day"}={}){
  if(!ECON_TIMESERIES_GRANULARITIES.includes(granularity))throw new Error("invalid_granularity");
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_economic_timeseries_v1",{p_from:from||null,p_to:to||null,p_granularity:granularity});
  if(error)throw error;
  if(!isPlainObject(data)||data.state!=="ready"||typeof data.environment!=="string"||data.granularity!==granularity||!isPlainObject(data.period)||!Array.isArray(data.rows))throw new Error("economic_timeseries_malformed_response");
  for(const row of data.rows){
    if(!isPlainObject(row)||(row.bucket==null)||!ECON_TIMESERIES_ROW_KEYS.every((k)=>isFiniteNumber(row[k])))throw new Error("economic_timeseries_malformed_response");
  }
  return data;
}

export async function adminGetPaymentProviderAnalytics({from=null,to=null}={}){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_payment_provider_analytics_v1",{p_from:from||null,p_to:to||null});
  if(error)throw error;
  if(!isPlainObject(data)||data.state!=="ready"||typeof data.environment!=="string"||!isPlainObject(data.period)||!Array.isArray(data.provider_attempts)||!Array.isArray(data.settled_orders_by_payment_method))throw new Error("payment_provider_analytics_malformed_response");
  for(const p of data.provider_attempts){
    if(!isPlainObject(p)||typeof p.provider!=="string"||!isFiniteNumber(p.attempts)||!isFiniteNumber(p.paid_attempts)||!isFiniteNumber(p.failed_attempts)||!isFiniteNumber(p.paid_volume_htg)||!isFiniteNumber(p.success_rate_pct))throw new Error("payment_provider_analytics_malformed_response");
  }
  for(const s of data.settled_orders_by_payment_method){
    if(!isPlainObject(s)||typeof s.payment_method!=="string"||!isFiniteNumber(s.paid_orders)||!isFiniteNumber(s.paid_volume_htg)||!isFiniteNumber(s.payment_discount_htg))throw new Error("payment_provider_analytics_malformed_response");
  }
  return data;
}

// admin_list_top_merchants_v1 / admin_list_top_products_v1 renvoient toujours
// une enveloppe objet complète (state/environment/sort/period/rows/limit/
// offset) — jamais un tableau brut ni un objet sans state. Ces RPC ne
// renvoient PAS total/has_more : jamais de fausse pagination inventée.
const isStringOrNull=(v)=>v===null||typeof v==="string";

function isValidTopListEnvelope(data,sort){
  return isPlainObject(data)&&data.state==="ready"
    &&typeof data.environment==="string"&&data.environment.trim()!==""
    &&data.sort===sort
    &&isPlainObject(data.period)
    &&Array.isArray(data.rows)
    &&isFiniteNumber(data.limit)&&isFiniteNumber(data.offset);
}

export async function adminListTopMerchants({from=null,to=null,sort="gmv",limit=10,offset=0}={}){
  if(!ECON_TOP_MERCHANTS_SORTS.includes(sort))throw new Error("invalid_sort");
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_list_top_merchants_v1",{p_from:from||null,p_to:to||null,p_sort:sort,p_limit:limit,p_offset:offset});
  if(error)throw error;
  if(!isValidTopListEnvelope(data,sort))throw new Error("top_merchants_malformed_response");
  for(const r of data.rows){
    if(!isPlainObject(r)||typeof r.merchant_id!=="string"||typeof r.shop_name!=="string"||!isStringOrNull(r.merchant_type)||!isStringOrNull(r.plan_code)||!isFiniteNumber(r.merchant_orders)||!isFiniteNumber(r.gmv_htg)||!isFiniteNumber(r.platform_revenue_htg)||!isFiniteNumber(r.payout_htg)||!isFiniteNumber(r.rank))throw new Error("top_merchants_malformed_response");
  }
  return data.rows;
}

export async function adminListTopProducts({from=null,to=null,sort="sales",limit=10,offset=0}={}){
  if(!ECON_TOP_PRODUCTS_SORTS.includes(sort))throw new Error("invalid_sort");
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_list_top_products_v1",{p_from:from||null,p_to:to||null,p_sort:sort,p_limit:limit,p_offset:offset});
  if(error)throw error;
  if(!isValidTopListEnvelope(data,sort))throw new Error("top_products_malformed_response");
  for(const r of data.rows){
    if(!isPlainObject(r)||typeof r.product_id!=="string"||typeof r.product_name!=="string"||!isStringOrNull(r.product_slug)||!isFiniteNumber(r.paid_orders)||!isFiniteNumber(r.units_sold)||!isFiniteNumber(r.sales_htg)||!isFiniteNumber(r.rank))throw new Error("top_products_malformed_response");
  }
  return data.rows;
}


// --- Logistique / Livreurs --------------------------------------------------
export async function adminGetLogisticsControl(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_logistics_control_v1",{});
  if(error)throw error;
  if(!data||typeof data!=="object")throw new Error("logistics_control_malformed_response");
  return data;
}

export async function adminGetLogisticsDraft(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_get_logistics_draft_v1",{});
  if(error)throw error;
  if(!data||typeof data!=="object"||!data.settings)throw new Error("logistics_draft_malformed_response");
  return data;
}

export async function adminResetLogisticsDraft(reason){
  const sb=await adminClient();
  const why=String(reason||"").trim();
  if(why.length<5)throw new Error("reason-required");
  const{data,error}=await sb.rpc("admin_reset_logistics_draft_v1",{p_reason:why});
  if(error)throw error;
  return data;
}

export async function adminUpdateLogisticsDraft(patch,reason){
  const sb=await adminClient();
  const why=String(reason||"").trim();
  if(!patch||typeof patch!=="object"||Array.isArray(patch))throw new Error("patch-required");
  if(why.length<5)throw new Error("reason-required");
  const{data,error}=await sb.rpc("admin_update_logistics_draft_v1",{p_patch:patch,p_reason:why});
  if(error)throw error;
  return data;
}

export async function adminPreflightLogistics(){
  const sb=await adminClient();
  const{data,error}=await sb.rpc("admin_preflight_logistics_v1",{});
  if(error)throw error;
  if(!data||typeof data!=="object"||typeof data.ready!=="boolean")throw new Error("logistics_preflight_malformed_response");
  return data;
}

export async function adminActivateLogisticsDraft(reason){
  const sb=await adminClient();
  const why=String(reason||"").trim();
  if(why.length<5)throw new Error("reason-required");
  const{data,error}=await sb.rpc("admin_activate_logistics_draft_v1",{p_reason:why});
  if(error)throw error;
  if(!data||typeof data!=="object"||data.activated!==true)throw new Error("logistics_activation_malformed_response");
  return data;
}
