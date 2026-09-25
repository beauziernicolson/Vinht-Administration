import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

// Feature #27 — Notifications marketplace. Toutes les lectures/écritures
// passent par les RPC officielles (notification_campaign_read_and_action_path_v3).
// Plus aucun accès direct à la table `notifications` : ni SELECT, ni UPDATE.

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session?.user) throw new Error("authentication_required");
  return { sb, user: session.user };
}

export const NOTIFICATION_CATEGORIES = [
  "general", "orders", "payments", "delivery", "kyc", "subscription",
  "trade_protection", "reputation", "reviews", "catalog", "promotions",
  "merchant", "courier", "admin", "security", "system",
];

// Catégories transactionnelles/sécurité : toujours in-app, jamais masquées
// par un interrupteur global. Seules general/catalog/promotions acceptent
// un opt-out in-app (category_preferences).
export const CRITICAL_NOTIFICATION_CATEGORIES = [
  "orders", "payments", "delivery", "kyc", "subscription",
  "trade_protection", "reputation", "reviews", "security", "system",
];
export const OPTIONAL_IN_APP_CATEGORIES = ["general", "catalog", "promotions"];

export const NOTIFICATION_CATEGORY_FR = {
  general: "Général", orders: "Commandes", payments: "Paiements", delivery: "Livraison",
  kyc: "Vérification d'identité", subscription: "Abonnement", trade_protection: "Protection VinHT",
  reputation: "Réputation", reviews: "Avis", catalog: "Catalogue", promotions: "Promotions",
  merchant: "Marchand", courier: "Livreur", admin: "Administration", security: "Sécurité", system: "Système",
};

export const CAMPAIGN_STATUS_FR = {
  queued: "En file", scheduled: "Planifiée", sending: "En cours d'envoi",
  completed: "Terminée", cancelled: "Annulée",
};

export const CAMPAIGN_PRIORITY_FR = { low: "Basse", normal: "Normale", high: "Haute", critical: "Critique" };

export const ADMIN_CAMPAIGN_CATEGORIES = ["general", "catalog", "promotions", "system", "admin", "courier", "merchant"];
export const ADMIN_CAMPAIGN_AUDIENCES = ["all_users", "all_merchants", "all_couriers"];
export const ADMIN_CAMPAIGN_AUDIENCE_FR = { all_users: "Tous les utilisateurs", all_merchants: "Tous les marchands", all_couriers: "Tous les livreurs" };
export const ADMIN_CAMPAIGN_PRIORITIES = ["low", "normal", "high", "critical"];
export const ADMIN_CAMPAIGN_SOURCE_TYPES = ["admin", "merchant"];

export const NOTIFICATION_DEVICE_PLATFORMS = ["ios", "android", "web"];
export const NOTIFICATION_DEVICE_PROVIDERS = ["fcm", "apns", "webpush", "expo", "other"];

// --- action_path : validation fail-closed côté frontend ---------------------
// Le backend V3 refuse déjà tout ce qui n'est pas un chemin VinHT interne
// sûr, mais on ne construit jamais un <a> cliquable sans revalider ici :
// jamais de javascript:, protocole absolu, "//host" (protocol-relative),
// backslash, ou caractères CR/LF. Un chemin suspect => pas de lien, jamais
// de tentative de "réparation".
export function isSafeInternalActionPath(path) {
  if (typeof path !== "string" || !path) return false;
  if (/[\r\n]/.test(path)) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return false; // ex: "/javascript:alert(1)"
  return true;
}

export function notificationErrorMessageFr(code, fallback) {
  const c = String(code || "").trim();
  const map = {
    authentication_required: "Connectez-vous pour accéder à vos notifications.",
    notification_not_found: "Cette notification est introuvable.",
    invalid_category_preferences: "Préférences de catégories invalides.",

    invalid_device_platform: "Plateforme d'appareil invalide.",
    invalid_push_provider: "Fournisseur push invalide.",
    invalid_device_token: "Jeton d'appareil invalide.",
    notification_device_not_found: "Cet appareil est introuvable.",

    merchant_not_found: "Ce marchand est introuvable.",
    cannot_follow_own_merchant: "Vous ne pouvez pas suivre votre propre boutique.",
    merchant_authentication_required: "Connectez-vous en tant que marchand pour continuer.",

    invalid_campaign_content: "Le titre (2 à 140 caractères) et le message (2 à 1000 caractères) sont requis.",
    invalid_notification_action_path: "Ce lien n'est pas un chemin VinHT valide.",
    merchant_notification_campaign_daily_limit_reached: "Limite atteinte : maximum 3 campagnes non annulées par 24 heures.",

    invalid_campaign_category: "Catégorie de campagne invalide.",
    invalid_campaign_audience: "Audience de campagne invalide.",
    invalid_campaign_priority: "Priorité de campagne invalide.",
    invalid_campaign_status: "Statut de campagne invalide.",
    invalid_campaign_source_type: "Type de source de campagne invalide.",
    campaign_not_cancellable: "Cette campagne ne peut plus être annulée.",

    admin_role_required: "Rôle administrateur requis.",
  };
  return map[c] || fallback || "Une erreur est survenue.";
}

// --- Notifications utilisateur ----------------------------------------------

export async function listMyNotifications({ category = null, unreadOnly = false, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_notifications_v1", {
    p_category: category || null,
    p_unread_only: !!unreadOnly,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  const totalCount = d.total_count ?? 0;
  const unreadCount = d.unread_count ?? 0;
  // Leçon #25 : quand p_unread_only est actif, le total pertinent pour la
  // pagination est unread_count, jamais total_count (qui compte tout).
  const relevantTotal = unreadOnly ? unreadCount : totalCount;
  const rows = Array.isArray(d.rows) ? d.rows : [];
  return {
    rows,
    totalCount,
    unreadCount,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: offset + rows.length < relevantTotal,
  };
}

export async function getMyUnreadNotificationCount() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_my_unread_notification_count_v1", {});
  if (error) throw error;
  return Number(data) || 0;
}

export async function markMyNotificationRead(notificationId, read = true) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("mark_my_notification_read_v1", {
    p_notification_id: notificationId,
    p_read: !!read,
  });
  if (error) throw error;
  return data;
}

export async function markAllMyNotificationsRead(category = null) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("mark_all_my_notifications_read_v1", { p_category: category || null });
  if (error) throw error;
  return data;
}

// --- Préférences --------------------------------------------------------

export async function getMyNotificationPreferences() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_my_notification_preferences_v1", {});
  if (error) throw error;
  return data;
}

export async function updateMyNotificationPreferences({ emailEnabled, smsEnabled, whatsappEnabled, pushEnabled, marketingEnabled, categoryPreferences }) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("update_my_notification_preferences_v2", {
    p_email_enabled: emailEnabled,
    p_sms_enabled: smsEnabled,
    p_whatsapp_enabled: whatsappEnabled,
    p_push_enabled: pushEnabled,
    p_marketing_enabled: marketingEnabled,
    p_category_preferences: categoryPreferences && typeof categoryPreferences === "object" ? categoryPreferences : {},
  });
  if (error) throw error;
  return data;
}

export async function getNotificationCapabilities() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_notification_capabilities_v1", {});
  if (error) throw error;
  return data;
}

// Un canal externe n'est présentable comme opérationnel que si
// provider_status === "ready" ET enabled === true. Sinon on affiche
// toujours un état honnête (jamais "Activé ✓").
export function externalChannelStatusFr(channel) {
  if (!channel || typeof channel !== "object") return "Non encore disponible";
  if (channel.provider_status === "ready" && channel.enabled === true) return "Activé ✓";
  if (channel.provider_status === "ready" && channel.enabled === false) return "Disponible côté fournisseur, désactivé par VinHT";
  if (channel.provider_status === "paused") return "Fournisseur en pause";
  if (channel.provider_status === "configured") return "Configuré, en attente d'activation";
  return "Fournisseur externe non configuré";
}

// --- Appareils (push) --------------------------------------------------------
// Aucune fabrication de token : ce module ne fait qu'afficher les appareils
// réellement enregistrés côté serveur et permettre leur désactivation.
// Notification.requestPermission() seul ne produit jamais un vrai token
// WebPush/FCM/APNs — donc aucun flux d'enregistrement n'est proposé ici.

export async function listMyNotificationDevices() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_notification_devices_v1", {});
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function unregisterMyNotificationDevice(deviceId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("unregister_my_notification_device_v1", { p_device_id: deviceId });
  if (error) throw error;
  return data;
}

// V4 : la création de campagne ne garantit pas une livraison immédiate.
// "queued"/"scheduled" signifient mis en file / planifiée — jamais "envoyée",
// qui suppose une distribution effective déjà prouvée par le serveur.
export function campaignCreationResultMessageFr(status) {
  if (status === "scheduled") return "Campagne planifiée ✓";
  if (status === "queued") return "Campagne mise en file ✓";
  return "Campagne enregistrée ✓";
}

// --- Suivi de boutiques (backend autoritaire) --------------------------------

export async function listMyNotificationSubscriptions() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_notification_subscriptions_v1", {});
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function setMyMerchantNotificationFollow(merchantId, enabled) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("set_my_merchant_notification_follow_v1", {
    p_merchant_id: merchantId,
    p_enabled: !!enabled,
  });
  if (error) throw error;
  return data;
}

// --- Campagnes marchand -------------------------------------------------

export async function createMyMerchantNotificationCampaign({ title, message, actionPath = null, scheduledAt = null }) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("create_my_merchant_notification_campaign_v1", {
    p_title: title,
    p_message: message,
    p_action_path: actionPath || null,
    p_scheduled_at: scheduledAt || null,
  });
  if (error) throw error;
  return data;
}

export async function listMyNotificationCampaigns({ status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("list_my_notification_campaigns_v1", {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? 0,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
  };
}

export async function cancelMyNotificationCampaign(campaignId) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("cancel_my_notification_campaign_v1", { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}

// --- Campagnes Admin -----------------------------------------------------

export async function adminCreateNotificationCampaign({ category, title, message, audienceType, actionPath = null, priority = "normal", scheduledAt = null }) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_create_notification_campaign_v1", {
    p_category: category,
    p_title: title,
    p_message: message,
    p_audience_type: audienceType,
    p_action_path: actionPath || null,
    p_priority: priority,
    p_scheduled_at: scheduledAt || null,
  });
  if (error) throw error;
  return data;
}

export async function adminListNotificationCampaigns({ sourceType = null, status = null, limit = 20, offset = 0 } = {}) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_list_notification_campaigns_v1", {
    p_source_type: sourceType || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const d = data && typeof data === "object" ? data : {};
  return {
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: d.total ?? 0,
    limit: d.limit ?? limit,
    offset: d.offset ?? offset,
    hasMore: !!d.has_more,
  };
}

// --- Feature #27 V4 — Preview (notification_campaign_preview_safety_v4) -----
// Read-only. Ne déclenchent jamais d'envoi. Obligatoires avant toute création
// de campagne réelle (marchand ou admin) pour que l'utilisateur confirme en
// connaissance de cause une action Production potentiellement irréversible.

export async function getMyMerchantNotificationCampaignPreview() {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("get_my_merchant_notification_campaign_preview_v1", {});
  if (error) throw error;
  return data;
}

export async function adminPreviewNotificationCampaign({ category, audienceType }) {
  const { sb } = await authed();
  const { data, error } = await sb.rpc("admin_preview_notification_campaign_v1", {
    p_category: category,
    p_audience_type: audienceType,
  });
  if (error) throw error;
  return data;
}
