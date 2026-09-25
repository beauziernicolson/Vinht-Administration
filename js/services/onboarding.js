import { getSupabase } from "./supabase.js";

// Feature #36A — Merchant Easy Onboarding (parcours autonome).
// Branché exclusivement sur get_my_merchant_onboarding_context_v1 /
// start_my_easy_merchant_onboarding_v1 / save_my_merchant_onboarding_profile_v1.
// Le backend reste l'unique source de vérité pour l'état, la progression et
// next_step : ce fichier ne fait que transporter les données, aucune règle
// n'est recalculée ici.

async function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

export const ONBOARDING_STEP_STATUS_FR = {
  complete: "Terminée",
  todo: "À faire",
  in_progress: "En cours",
  waiting: "En attente VinHT",
  locked: "Verrouillée",
  blocked: "Bloquée",
};

export function onboardingErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  const map = {
    authentication_required: "Connectez-vous pour continuer.",
    full_name_required: "Nom complet requis.",
    full_name_too_long: "Nom complet trop long (160 caractères maximum).",
    shop_name_required: "Nom de boutique requis.",
    shop_name_too_long: "Nom de boutique trop long (160 caractères maximum).",
    invalid_merchant_type: "Choisissez un type de marchand (producteur, revendeur ou vendeur).",
    phone_or_whatsapp_required: "Renseignez un numéro de téléphone ou un numéro WhatsApp.",
    phone_too_long: "Numéro de téléphone trop long (40 caractères maximum).",
    whatsapp_too_long: "Numéro WhatsApp trop long (40 caractères maximum).",
    shop_description_too_long: "Description de boutique trop longue (2000 caractères maximum).",
    too_many_product_categories: "Maximum 20 catégories.",
    product_category_too_long: "Une catégorie est trop longue (80 caractères maximum).",
    pending_merchant_application_required: "Aucune demande marchand en attente à modifier.",
    merchant_already_exists_use_merchant_profile: "Vous avez déjà un compte marchand actif — modifiez-le depuis l'espace marchand.",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

export async function getMyMerchantOnboardingContext() {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_merchant_onboarding_context_v1", {});
  if (error) throw error;
  return data;
}

export async function startMyEasyMerchantOnboarding({ fullName, shopName, merchantType, phone = null, whatsappNumber = null }) {
  const sb = await client();
  const { data, error } = await sb.rpc("start_my_easy_merchant_onboarding_v1", {
    p_full_name: fullName,
    p_shop_name: shopName,
    p_merchant_type: merchantType,
    p_phone: phone || null,
    p_whatsapp_number: whatsappNumber || null,
  });
  if (error) throw error;
  return data;
}

// --- #36C — activation d'un dossier marchand assisté par un Agent ----------
// Le backend vérifie lui-même (compte non anonyme, dossier invité, invitation
// non expirée, e-mail JWT identique à celui du dossier, e-mail confirmé, auth
// récente par otp/magiclink/invite) : aucune de ces règles n'est reproduite
// ici, ce fichier ne fait que transporter la réponse serveur.

export async function getMyAssistedMerchantInviteContext(dossierId) {
  const sb = await client();
  const { data, error } = await sb.rpc("get_my_assisted_merchant_invite_context_v1", { p_dossier_id: dossierId });
  if (error) throw error;
  return data;
}

export async function claimMyAssistedMerchantDossier(dossierId) {
  const sb = await client();
  const { data, error } = await sb.rpc("claim_my_assisted_merchant_dossier_v1", { p_dossier_id: dossierId });
  if (error) throw error;
  return data;
}

export function assistedInviteErrorMessageFr(code, fallback) {
  const raw = String(code || "").trim();
  const map = {
    authentication_required: "Connectez-vous pour continuer.",
    non_anonymous_account_required: "Ce lien nécessite un compte connecté par e-mail.",
    assisted_invite_not_found: "Invitation introuvable.",
    assisted_invite_already_claimed: "Ce dossier a déjà été réclamé par un autre compte.",
    assisted_invite_not_active: "Cette invitation n'est plus active.",
    assisted_invite_expired: "Cette invitation a expiré. Demandez à votre Agent de la renvoyer.",
    assisted_invite_email_required: "Aucun e-mail n'est associé à ce dossier.",
    assisted_invite_email_mismatch: "L'adresse e-mail connectée ne correspond pas à celle de l'invitation.",
    confirmed_email_required: "Confirmez votre adresse e-mail avant de continuer.",
    recent_email_otp_required: "Ouvrez le lien reçu par e-mail pour continuer (connexion trop ancienne).",
    merchant_account_already_exists: "Vous avez déjà un compte marchand.",
    pending_merchant_application_required: "Impossible de finaliser l'activation pour le moment.",
  };
  return map[raw] || fallback || "Une erreur est survenue.";
}

export async function saveMyMerchantOnboardingProfile({
  fullName, shopName, merchantType, phone = null, whatsappNumber = null,
  shopDescription = null, productCategories = [],
}) {
  const sb = await client();
  const { data, error } = await sb.rpc("save_my_merchant_onboarding_profile_v1", {
    p_full_name: fullName,
    p_shop_name: shopName,
    p_merchant_type: merchantType,
    p_phone: phone || null,
    p_whatsapp_number: whatsappNumber || null,
    p_shop_description: shopDescription || null,
    p_product_categories: Array.isArray(productCategories) ? productCategories : [],
  });
  if (error) throw error;
  return data;
}
