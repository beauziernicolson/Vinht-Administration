// Service marchand — plans (lecture) + candidatures (lecture/insertion sous RLS).
//
// Le frontend ne définit JAMAIS : reviewed_by, reviewed_at, rejection_reason.
// status est forcé à "pending" (ou laissé au défaut DB) — jamais un statut
// non-pending contrôlé par le client.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

export const MERCHANT_TYPES = ["producteur", "revendeur", "vendeur"];
export const PLAN_CODES = ["individual", "professional"];

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

// --- Plans (table merchant_plans, lecture anon OK) ------------------------
export async function getMerchantPlans() {
  const { data, error } = await client()
    .from("merchant_plans")
    .select("code,name,monthly_fee_htg,per_item_fee_htg,commission_rate,is_active")
    .eq("is_active", true)
    .order("monthly_fee_htg", { ascending: true });
  if (error) throw error;
  return (data || []).filter((p) => PLAN_CODES.includes(p.code));
}

// --- Candidatures du user courant (RLS autoritaire) ---------------------
const APPLICATION_FIELDS =
  "id,user_id,full_name,email,phone,whatsapp_number,shop_name,shop_description," +
  "merchant_type,requested_plan_code,product_categories,social_links,status," +
  "rejection_reason,created_at,updated_at";

export async function getMyMerchantApplications() {
  const session = await getSession();
  const user = session && session.user;
  if (!user) throw new Error("not-authenticated");

  const { data, error } = await client()
    .from("merchant_applications")
    .select(APPLICATION_FIELDS)
    .eq("user_id", user.id) // portée sémantique « mes » demandes (RLS reste la sécurité)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// --- Insertion candidature --------------------------------------------
export async function createMerchantApplication(input) {
  const sb = client();
  const session = await getSession();
  const user = session && session.user;
  if (!user) throw new Error("not-authenticated");

  if (!MERCHANT_TYPES.includes(input.merchantType))
    throw new Error("invalid-merchant-type");
  if (!PLAN_CODES.includes(input.requestedPlanCode))
    throw new Error("invalid-plan");
  if (!input.shopName || !input.shopName.trim()) throw new Error("shop-name-required");

  const payload = {
    user_id: user.id,
    status: "pending",
    full_name: input.fullName || null,
    email: input.email || null,
    phone: input.phone || null,
    whatsapp_number: input.whatsappNumber || null,
    shop_name: input.shopName.trim(),
    shop_description: input.shopDescription || null,
    merchant_type: input.merchantType,
    requested_plan_code: input.requestedPlanCode,
  };
  // Champs de forme non garantie -> envoyés seulement si renseignés.
  if (Array.isArray(input.productCategories) && input.productCategories.length)
    payload.product_categories = input.productCategories;
  if (input.socialLinks && Object.keys(input.socialLinks).length)
    payload.social_links = input.socialLinks;

  const { data, error } = await sb
    .from("merchant_applications")
    .insert(payload)
    .select(APPLICATION_FIELDS)
    .single();
  if (error) throw error;
  return data;
}
