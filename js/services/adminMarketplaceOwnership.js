import { adminRpc } from "./adminControl.js";

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const paged = (v) => {
  const d = obj(v);
  return {
    environment: d.environment || null,
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: Number.isFinite(Number(d.total)) ? Number(d.total) : null,
    limit: Number.isFinite(Number(d.limit)) ? Number(d.limit) : null,
    offset: Number.isFinite(Number(d.offset)) ? Number(d.offset) : 0,
    hasMore: !!d.has_more,
  };
};
const reason = (v) => String(v || "").trim();

export const MARKETPLACE_OFFER_STATUSES = ["draft", "active", "paused", "archived"];
export const MARKETPLACE_OFFER_KINDS = ["direct", "dropship"];
export const DROPSHIP_AUTH_STATUSES = ["requested", "approved", "rejected", "revoked"];

export async function adminListMarketplaceOffers({ status = null, kind = null, search = null, limit = 50, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_marketplace_offers_v1", {
    p_status: status || null,
    p_kind: kind || null,
    p_search: String(search || "").trim() || null,
    p_limit: limit,
    p_offset: offset,
  }));
}

export async function adminSetMarketplaceOfferStatus(offerId, status, why) {
  const r = reason(why);
  if (!offerId) throw new Error("offer_id_required");
  if (!MARKETPLACE_OFFER_STATUSES.includes(status) || status === "draft") throw new Error("invalid_offer_status");
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_set_marketplace_offer_status_v1", {
    p_offer_id: offerId,
    p_status: status,
    p_reason: r,
  });
}

export async function adminListDropshipAuthorizations({ status = null, limit = 50, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_dropship_authorizations_v1", {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  }));
}

export async function adminRevokeDropshipAuthorization(authorizationId, why) {
  const r = reason(why);
  if (!authorizationId) throw new Error("authorization_id_required");
  if (r.length < 5) throw new Error("reason_required");
  return adminRpc("admin_revoke_dropship_authorization_v1", {
    p_authorization_id: authorizationId,
    p_reason: r,
  });
}

export function marketplaceOwnershipErrorFr(err, fallback = "Action Marketplace refusée.") {
  const raw = String(err?.message || err || "").trim();
  const code = raw.match(/([a-z][a-z0-9_]{3,})/i)?.[1] || raw;
  const map = {
    admin_role_required: "Rôle administrateur requis.",
    offer_id_required: "Offre requise.",
    offer_not_found: "Offre Marketplace introuvable dans cet environnement.",
    invalid_offer_status: "Statut d’offre invalide.",
    invalid_offer_kind: "Type d’offre invalide.",
    reason_required: "Un motif Admin d’au moins 5 caractères est requis.",
    reason_too_long: "Le motif Admin est trop long.",
    approved_dropship_authorization_required: "Cette offre dropship ne peut pas être réactivée sans autorisation approuvée.",
    dropship_source_offer_unavailable: "L’offre source n’est pas active ou n’autorise plus le dropshipping.",
    invalid_dropship_authorization_status: "Statut d’autorisation dropship invalide.",
    authorization_id_required: "Autorisation dropship requise.",
    dropship_authorization_not_found: "Autorisation dropship introuvable dans cet environnement.",
  };
  return map[code] || fallback;
}
