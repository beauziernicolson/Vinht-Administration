// Services du VinHT Control Center (Admin).
//
// Uniquement des RPC Admin sécurisées (rôle admin vérifié par le backend,
// environnement = profiles.commerce_environment de l'admin). Aucun .from().update().
// Chaque réponse est validée : une forme inattendue lève une erreur explicite
// (jamais un écran rempli de zéros).

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { getMyRoles } from "./profile.js";

export async function adminRpc(name, args = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session?.user) throw new Error("not-authenticated");
  const roles = await getMyRoles();
  if (!roles.includes("admin")) throw new Error("not-admin");
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const mustObj = (v, code) => { if (!isObj(v)) throw new Error(code); return v; };
const mustArr = (v, code) => { if (!Array.isArray(v)) throw new Error(code); return v; };
const clampReason = (r) => String(r || "").trim();
const paged = (d, code) => {
  mustObj(d, code);
  return {
    environment: d.environment || null,
    rows: Array.isArray(d.rows) ? d.rows : [],
    total: Number.isFinite(Number(d.total)) ? Number(d.total) : null,
    limit: d.limit ?? null,
    offset: d.offset ?? 0,
    hasMore: !!d.has_more,
  };
};

// --- Signalements de commande (order_reports) --------------------------------
// RPC Admin environment-aware (backend 20260921234848) ; la RLS d'order_reports l'est aussi.
export const ORDER_REPORT_STATUSES = ["open", "investigating", "resolved", "dismissed"];
export async function adminListOrderReports({ status = null, limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_order_reports_v1", { p_status: status || null, p_limit: limit, p_offset: offset }), "order_reports_malformed_response");
}
// --- Espaces d'un utilisateur (lecture seule) ---------------------------------
export async function adminGetUserSpaces(userId) {
  return mustObj(await adminRpc("admin_get_user_spaces_v1", { p_user_id: userId }), "user_spaces_malformed_response");
}

// --- Livreurs ---------------------------------------------------------------
export const COURIER_STATUSES = ["pending_review", "active", "paused", "suspended", "rejected", "closed"];
export async function adminListCouriers({ status = null, limit = 100, offset = 0 } = {}) {
  return mustArr(await adminRpc("admin_list_couriers_v1", { p_status: status, p_limit: limit, p_offset: offset }), "couriers_malformed_response");
}
export async function adminGetCourier(courierProfileId) {
  return mustObj(await adminRpc("admin_get_courier_v1", { p_courier_profile_id: courierProfileId }), "courier_malformed_response");
}
export async function adminReviewCourier(courierProfileId, approve, reason = null, adminNotes = null) {
  return adminRpc("admin_review_courier_v1", {
    p_courier_profile_id: courierProfileId, p_approve: !!approve,
    p_reason: clampReason(reason) || null, p_admin_notes: clampReason(adminNotes) || null,
  });
}
export async function adminSetCourierOperationalStatus(courierProfileId, status, reason = null) {
  return adminRpc("admin_set_courier_operational_status_v1", {
    p_courier_profile_id: courierProfileId, p_status: status, p_reason: clampReason(reason) || null,
  });
}

// --- Agents -----------------------------------------------------------------
export const AGENT_STATUSES = ["active", "suspended", "closed"];
export async function adminListAgents({ status = null, limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_agents_v1", { p_status: status, p_limit: limit, p_offset: offset }), "agents_malformed_response");
}
// Candidatures Agent (backend 20260921191638 : ouvertes à authenticated, garde admin côté serveur).
export const AGENT_APPLICATION_STATUSES = ["pending_review", "approved", "rejected", "cancelled"];
export async function adminListAgentApplications({ status = null, limit = 50, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_agent_applications_v1", { p_status: status, p_limit: limit, p_offset: offset }), "agent_applications_malformed_response");
}
export async function adminReviewAgentApplication(applicationId, approve, reason = null) {
  const r = clampReason(reason);
  if (!approve && !r) throw new Error("rejection_reason_required");
  return mustObj(await adminRpc("admin_review_agent_application_v1", { p_application_id: applicationId, p_approve: !!approve, p_reason: r || null }), "agent_application_review_malformed_response");
}
export async function adminActivateAgent(userId, displayName, phone = null) {
  return adminRpc("admin_activate_agent_v1", { p_user_id: userId, p_display_name: clampReason(displayName), p_phone: clampReason(phone) || null });
}
export async function adminSuspendAgent(userId, reason) {
  return adminRpc("admin_suspend_agent_v1", { p_user_id: userId, p_reason: clampReason(reason) });
}
export async function adminAssignAgentMerchant(agentUserId, merchantId, reason = null) {
  return adminRpc("admin_assign_agent_merchant_v1", { p_agent_user_id: agentUserId, p_merchant_id: merchantId, p_reason: clampReason(reason) || null });
}
export async function adminUnassignAgentMerchant(agentUserId, merchantId, reason = null) {
  return adminRpc("admin_unassign_agent_merchant_v1", { p_agent_user_id: agentUserId, p_merchant_id: merchantId, p_reason: clampReason(reason) || null });
}
export async function adminGetAgentAudit({ agentUserId = null, merchantId = null, limit = 50, offset = 0 } = {}) {
  return paged(await adminRpc("admin_get_agent_audit_v1", { p_agent_user_id: agentUserId, p_merchant_id: merchantId, p_limit: limit, p_offset: offset }), "agent_audit_malformed_response");
}
export async function adminListAssistedDossiers({ status = null, limit = 50, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_assisted_merchant_dossiers_v1", { p_status: status, p_limit: limit, p_offset: offset }), "dossiers_malformed_response");
}
export async function adminSetAssistedDossierAgent(dossierId, agentUserId) {
  return adminRpc("admin_set_assisted_merchant_agent_v1", { p_dossier_id: dossierId, p_agent_user_id: agentUserId });
}
export async function adminCancelAssistedDossier(dossierId, reason) {
  return adminRpc("admin_cancel_assisted_merchant_dossier_v1", { p_dossier_id: dossierId, p_reason: clampReason(reason) });
}

// --- Confiance & sécurité -----------------------------------------------------
export async function adminGetTradeProtectionControl() {
  return mustObj(await adminRpc("admin_get_trade_protection_control_v1", {}), "trade_protection_control_malformed_response");
}
export async function adminUpdateTradeProtectionControl(patch, reason) {
  return mustObj(await adminRpc("admin_update_trade_protection_control_v1", { p_patch: patch, p_reason: clampReason(reason) }), "trade_protection_update_malformed_response");
}
export async function adminListTradeClaims({ status = null, limit = 100, offset = 0 } = {}) {
  const d = mustObj(await adminRpc("admin_list_trade_protection_claims_v1", { p_status: status, p_limit: limit, p_offset: offset }), "claims_malformed_response");
  return { rows: Array.isArray(d.rows) ? d.rows : [], limit: d.limit ?? limit, offset: d.offset ?? offset };
}
export async function adminResolveTradeClaim(claimId, resolution, note) {
  return adminRpc("admin_resolve_trade_protection_claim_v1", { p_claim_id: claimId, p_resolution: resolution, p_note: clampReason(note) });
}
export async function adminWaiveTradeReturn(claimId, note) {
  return adminRpc("admin_waive_trade_protection_return_v1", { p_claim_id: claimId, p_note: clampReason(note) });
}
export async function adminListVerifiedReviews({ status = null, reviewType = null, limit = 50, offset = 0 } = {}) {
  const d = mustObj(await adminRpc("admin_list_verified_reviews_v1", { p_status: status, p_review_type: reviewType, p_limit: limit, p_offset: offset }), "reviews_malformed_response");
  return { rows: Array.isArray(d.rows) ? d.rows : [] };
}
export async function adminModerateReview(reviewId, status, reason = null) {
  return adminRpc("admin_moderate_verified_review_v1", { p_review_id: reviewId, p_status: status, p_reason: clampReason(reason) || null });
}
export async function adminListCertifications({ status = null, limit = 50, offset = 0 } = {}) {
  const d = mustObj(await adminRpc("admin_list_merchant_certifications_v1", { p_status: status, p_limit: limit, p_offset: offset }), "certifications_malformed_response");
  return { rows: Array.isArray(d.rows) ? d.rows : [] };
}
export async function adminReviewCertification(certificationId, decision, note = null) {
  return adminRpc("admin_review_merchant_certification_v1", { p_certification_id: certificationId, p_decision: decision, p_note: clampReason(note) || null });
}
export async function adminListVerificationBadges({ status = null, badgeType = null, limit = 50, offset = 0 } = {}) {
  const d = mustObj(await adminRpc("admin_list_merchant_verification_badges_v1", { p_status: status, p_badge_type: badgeType, p_limit: limit, p_offset: offset }), "badges_malformed_response");
  return { rows: Array.isArray(d.rows) ? d.rows : [] };
}
export async function adminReviewVerificationBadge(merchantId, badgeType, decision, note = null, validDays = 365) {
  return adminRpc("admin_review_merchant_verification_badge_v1", { p_merchant_id: merchantId, p_badge_type: badgeType, p_decision: decision, p_note: clampReason(note) || null, p_valid_days: validDays });
}
export async function adminPreflightFlexicashLogisticsProduction() {
  return mustObj(await adminRpc("admin_preflight_flexicash_logistics_production_v1", {}), "flexicash_preflight_malformed_response");
}

// --- Paiements / facturation Pro ---------------------------------------------
export async function adminListPaymentProviderRuntimeControls() {
  const d = mustObj(await adminRpc("admin_list_payment_provider_runtime_controls_v1", {}), "payment_provider_controls_malformed_response");
  return { rows: Array.isArray(d.rows) ? d.rows : [] };
}
export async function adminGetMerchantSubscriptionBillingPolicy() {
  return mustObj(await adminRpc("admin_get_merchant_subscription_billing_policy_v1", {}), "billing_policy_malformed_response");
}
export async function adminListProfessionalBillingDeadLetters({ entityKind = null, limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_professional_billing_dead_letters_v1", { p_entity_kind: entityKind || null, p_limit: limit, p_offset: offset }), "billing_dead_letters_malformed_response");
}
export async function adminRequeueProfessionalBillingDeadLetter(entityKind, entityId, reason = null) {
  return mustObj(await adminRpc("admin_requeue_professional_billing_dead_letter_v1", { p_entity_kind: entityKind, p_entity_id: entityId, p_reason: clampReason(reason) || null }), "billing_dead_letter_requeue_malformed_response");
}
export async function adminSetProfessionalProductionPayments(enabled, reason = null) {
  return mustObj(await adminRpc("admin_set_professional_production_payments_v1", { p_enabled: !!enabled, p_reason: clampReason(reason) || null }), "professional_production_payments_malformed_response");
}
export async function adminGetMfaAssuranceLevel() {
  const sb = getSupabase();
  if (!sb?.auth?.mfa?.getAuthenticatorAssuranceLevel) throw new Error("mfa_api_unavailable");
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data;
}
export async function adminVerifyTotpAal2(code) {
  const sb = getSupabase();
  if (!sb?.auth?.mfa) throw new Error("mfa_api_unavailable");
  const { data: factors, error: factorsError } = await sb.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const factor = (factors?.totp || []).find((x) => x.status === "verified");
  if (!factor) throw new Error("mfa_verified_totp_required");
  const { data: challenge, error: challengeError } = await sb.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError) throw challengeError;
  const { data, error } = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: String(code || "").trim() });
  if (error) throw error;
  return data;
}
export async function adminSetPaymentProviderRuntimeControl(provider, productionEnabled, note, confirmation) {
  return mustObj(await adminRpc("admin_set_payment_provider_runtime_control_v1", {
    p_provider: provider,
    p_production_enabled: !!productionEnabled,
    p_note: clampReason(note) || null,
    p_confirmation: clampReason(confirmation),
  }), "payment_provider_runtime_control_malformed_response");
}

// --- Missions de livraison ---------------------------------------------------
// Les 13 statuts canoniques sont filtrables (admin_list_delivery_tasks_v1, backend
// 20260921191638). Ordre = parcours nominal d'une livraison.
export const TASK_FILTERABLE_STATUSES = ["awaiting_fulfillment", "ready_waiting_dispatch", "awaiting_assignment", "assigned", "accepted", "at_pickup", "handoff_pending_merchant", "picked_up", "in_transit", "arrived_destination", "delivered", "issue", "cancelled"];
export async function adminListDeliveryTasks({ status = null, limit = 100, offset = 0 } = {}) {
  return mustArr(await adminRpc("admin_list_delivery_tasks_v1", { p_status: status, p_limit: limit, p_offset: offset }), "tasks_malformed_response");
}
export async function adminListDeliveryCandidates(taskId, limit = 30) {
  return mustArr(await adminRpc("admin_list_delivery_candidates_v1", { p_delivery_task_id: taskId, p_limit: limit }), "candidates_malformed_response");
}
// Bloc 8 — cockpit unifié (missions + settings + summary + anomalies + action_contracts).
// Chaque ligne porte déjà capabilities/custody/confirmation calculées par le backend
// (app_private.admin_delivery_task_capabilities_v1) : le frontend ne doit jamais
// redériver une permission depuis `status` quand le cockpit l'a déjà fournie.
export async function adminGetLogisticsCockpit({ status = null, limit = 100, offset = 0 } = {}) {
  return mustObj(await adminRpc("admin_get_logistics_cockpit_v1", { p_status: status, p_limit: limit, p_offset: offset }), "logistics_cockpit_malformed_response");
}
export async function adminGetDeliveryTaskCockpit(taskId) {
  return mustObj(await adminRpc("admin_get_delivery_task_cockpit_v1", { p_delivery_task_id: taskId }), "delivery_task_cockpit_malformed_response");
}
// Annulation — uniquement quand le backend l'autorise encore (capabilities.incident.can_cancel_active_resolution
// / custody.pending_transfer_id) : le frontend ne fait que transmettre l'id déjà lu du cockpit.
export async function adminCancelDeliveryIncidentResolution(resolutionId, note) {
  return adminRpc("admin_cancel_delivery_incident_resolution_v1", { p_resolution_id: resolutionId, p_note: clampReason(note) });
}
export async function adminCancelDeliveryCustodyTransfer(transferId, note) {
  return adminRpc("admin_cancel_delivery_custody_transfer_v1", { p_transfer_id: transferId, p_note: clampReason(note) });
}
export async function adminConfirmDeliveryReturnHubReceived(taskId, pickupPointId, proofReference, note = null) {
  return adminRpc("admin_confirm_delivery_return_hub_received_v1", { p_delivery_task_id: taskId, p_pickup_point_id: pickupPointId, p_proof_reference: clampReason(proofReference), p_note: clampReason(note) || null });
}
export async function adminAssignDelivery(taskId, courierProfileId, compensationHtg = null) {
  return adminRpc("admin_assign_delivery_v1", { p_delivery_task_id: taskId, p_courier_profile_id: courierProfileId, p_compensation_htg: compensationHtg });
}
export async function adminPublishReadyDeliveryTasks() {
  return mustObj(await adminRpc("admin_publish_ready_delivery_tasks_v1", {}), "publish_ready_malformed_response");
}
export async function adminResolveDeliveryIncident(taskId, resolutionType, {
  targetCourierProfileId = null,
  targetPickupPointId = null,
  reasonCode = "admin_incident_resolution",
  note = null,
} = {}) {
  return adminRpc("admin_resolve_delivery_incident_v1", {
    p_delivery_task_id: taskId,
    p_resolution_type: resolutionType,
    p_target_courier_profile_id: targetCourierProfileId || null,
    p_target_pickup_point_id: targetPickupPointId || null,
    p_reason_code: clampReason(reasonCode) || "admin_incident_resolution",
    p_note: clampReason(note) || null,
  });
}
export async function adminConfirmDispatchHubReceipt(taskId, receiptReference, note) {
  return adminRpc("admin_confirm_dispatch_hub_receipt_v1", { p_delivery_task_id: taskId, p_receipt_reference: clampReason(receiptReference), p_note: clampReason(note) || null });
}
export async function adminConfirmCustomerDeliveryOverride(taskId, proofReference, note) {
  return adminRpc("admin_confirm_customer_delivery_override_v1", { p_delivery_task_id: taskId, p_proof_reference: clampReason(proofReference), p_note: clampReason(note) });
}
export async function adminSetDeliveryCompensation(taskId, amountHtg, status, reference = null) {
  return adminRpc("admin_set_delivery_compensation_v1", { p_delivery_task_id: taskId, p_amount_htg: amountHtg, p_status: status, p_reference: clampReason(reference) || null });
}

// --- Logistique --------------------------------------------------------------
export async function adminGetLogisticsDashboard() {
  const d = mustObj(await adminRpc("admin_get_logistics_dashboard_v1", {}), "logistics_dashboard_malformed_response");
  return d;
}
export async function getLogisticsRuntimeCapabilities() {
  return mustObj(await adminRpc("get_logistics_runtime_capabilities_v1", {}), "logistics_runtime_malformed_response");
}
export async function adminListLogisticsAudit({ limit = 50, offset = 0 } = {}) {
  return mustArr(await adminRpc("admin_list_logistics_audit_v1", { p_limit: limit, p_offset: offset }), "logistics_audit_malformed_response");
}
export async function adminListLogisticsVersions({ limit = 20, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_logistics_versions_v1", { p_limit: limit, p_offset: offset }), "logistics_versions_malformed_response");
}
export async function adminRollbackLogisticsVersion(versionNumber, reason) {
  return adminRpc("admin_rollback_logistics_version_v1", { p_version_number: versionNumber, p_reason: clampReason(reason) });
}
export async function adminSimulateLogistics({ deliveryType, deliveryAddress = {}, pickupPointCode = null, secureDeliveryPointCode = null }) {
  return mustObj(await adminRpc("admin_simulate_logistics_v1", {
    p_delivery_type: deliveryType, p_delivery_address: deliveryAddress,
    p_pickup_point_code: pickupPointCode, p_secure_delivery_point_code: secureDeliveryPointCode,
  }), "logistics_simulation_malformed_response");
}

// --- Zones, points VinHT ------------------------------------------------------
export async function adminListDeliveryZones({ status = null, search = null, limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_delivery_zones_v1", { p_status: status, p_search: search, p_limit: limit, p_offset: offset }), "zones_malformed_response");
}
export async function adminCreateDeliveryZone(z) {
  return adminRpc("admin_create_delivery_zone_v1", {
    p_code: z.code, p_name: z.name, p_commune: z.commune || null, p_department: z.department || null,
    p_zone_kind: z.zoneKind || "service", p_accepts_home_delivery: z.acceptsHomeDelivery !== false,
    p_accepts_secure_meeting: !!z.acceptsSecureMeeting, p_safety_state: z.safetyState || "standard",
    p_public_message_fr: z.publicMessageFr || null,
    p_center_latitude: z.centerLatitude ?? null, p_center_longitude: z.centerLongitude ?? null,
    p_radius_km: z.radiusKm ?? null, p_sort_priority: z.sortPriority ?? 100,
  });
}
export async function adminUpdateDeliveryZone(zoneId, z) {
  return adminRpc("admin_update_delivery_zone_v1", {
    p_zone_id: zoneId, p_name: z.name, p_commune: z.commune || null, p_department: z.department || null,
    p_zone_kind: z.zoneKind, p_status: z.status, p_accepts_home_delivery: !!z.acceptsHomeDelivery,
    p_accepts_secure_meeting: !!z.acceptsSecureMeeting, p_safety_state: z.safetyState,
    p_public_message_fr: z.publicMessageFr || null,
    p_center_latitude: z.centerLatitude ?? null, p_center_longitude: z.centerLongitude ?? null,
    p_radius_km: z.radiusKm ?? null, p_sort_priority: z.sortPriority ?? 100,
  });
}
export async function adminListPickupPoints({ limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_pickup_points_v1", { p_limit: limit, p_offset: offset }), "pickup_points_malformed_response");
}
export async function adminCreatePickupPoint(p) {
  return adminRpc("admin_create_pickup_point_v1", {
    p_code: p.code, p_name: p.name, p_address_line1: p.addressLine1, p_commune: p.commune, p_department: p.department,
    p_address_line2: p.addressLine2 || null, p_latitude: p.latitude ?? null, p_longitude: p.longitude ?? null,
    p_phone: p.phone || null, p_customer_instructions: p.customerInstructions || null,
    p_capacity_limit: p.capacityLimit ?? null, p_hold_days: p.holdDays ?? 7, p_map_provider: p.mapProvider || "manual", p_map_place_id: p.mapPlaceId || null,
  });
}
export async function adminUpdatePickupPoint(pickupPointId, p) {
  return adminRpc("admin_update_pickup_point_v1", {
    p_pickup_point_id: pickupPointId, p_name: p.name, p_address_line1: p.addressLine1, p_commune: p.commune, p_department: p.department,
    p_address_line2: p.addressLine2 || null, p_latitude: p.latitude ?? null, p_longitude: p.longitude ?? null,
    p_phone: p.phone || null, p_customer_instructions: p.customerInstructions || null, p_operational_message: p.operationalMessage || null,
    p_capacity_limit: p.capacityLimit ?? null, p_hold_days: p.holdDays ?? 7, p_map_provider: p.mapProvider || "manual", p_map_place_id: p.mapPlaceId || null,
    p_sort_priority: p.sortPriority ?? 100,
  });
}
export async function adminCreateSecureDeliveryPoint(p) {
  return adminRpc("admin_create_secure_delivery_point_v1", {
    p_code: p.code, p_name: p.name, p_address_line1: p.addressLine1, p_commune: p.commune, p_zone_id: p.zoneId,
    p_partner_name: p.partnerName || null, p_address_line2: p.addressLine2 || null, p_department: p.department || null,
    p_latitude: p.latitude ?? null, p_longitude: p.longitude ?? null, p_safety_level: p.safetyLevel || "standard",
    p_phone: p.phone || null, p_customer_instructions: p.customerInstructions || null, p_opening_hours: p.openingHours || {},
    p_map_provider: p.mapProvider || "manual", p_map_place_id: p.mapPlaceId || null, p_sort_priority: p.sortPriority ?? 100,
  });
}
export async function adminListSecureDeliveryPoints({ status = null, limit = 100, offset = 0 } = {}) {
  return paged(await adminRpc("admin_list_secure_delivery_points_v1", { p_status: status, p_limit: limit, p_offset: offset }), "secure_delivery_points_malformed_response");
}

export async function adminUpdateSecureDeliveryPoint(pointId, p) {
  return adminRpc("admin_update_secure_delivery_point_v1", {
    p_point_id: pointId,
    p_name: p.name,
    p_partner_name: p.partnerName || null,
    p_address_line1: p.addressLine1,
    p_address_line2: p.addressLine2 || null,
    p_commune: p.commune,
    p_department: p.department || null,
    p_zone_id: p.zoneId || null,
    p_latitude: p.latitude ?? null,
    p_longitude: p.longitude ?? null,
    p_status: p.status || "draft",
    p_accepts_meetings: p.acceptsMeetings !== false,
    p_safety_level: p.safetyLevel || "standard",
    p_phone: p.phone || null,
    p_customer_instructions: p.customerInstructions || null,
    p_operational_message: p.operationalMessage || null,
    p_opening_hours: p.openingHours || {},
    p_map_provider: p.mapProvider || "manual",
    p_map_place_id: p.mapPlaceId || null,
    p_sort_priority: p.sortPriority ?? 100,
  });
}

export async function adminUpsertShippingRule(r) {
  return adminRpc("admin_upsert_shipping_rule_v1", {
    p_rule_id: r.ruleId || null, p_name: r.name, p_delivery_method: r.deliveryMethod, p_pricing_type: r.pricingType,
    p_base_fee_htg: r.baseFeeHtg ?? 0, p_per_km_htg: r.perKmHtg ?? 0, p_included_km: r.includedKm ?? 0,
    p_min_fee_htg: r.minFeeHtg ?? null, p_max_fee_htg: r.maxFeeHtg ?? null,
    p_zone_id: r.zoneId || null, p_pickup_point_id: r.pickupPointId || null, p_secure_delivery_point_id: r.secureDeliveryPointId || null,
    p_priority: r.priority ?? 100,
  });
}
export async function adminDeleteDraftShippingRule(ruleId) {
  return adminRpc("admin_delete_draft_shipping_rule_v1", { p_rule_id: ruleId });
}
export async function adminSetPickupPointState(pickupPointId, { status = null, acceptsNewPickups = null, operationalMessage = null } = {}) {
  return adminRpc("admin_set_pickup_point_state_v1", {
    p_pickup_point_id: pickupPointId, p_status: status, p_accepts_new_pickups: acceptsNewPickups, p_operational_message: operationalMessage,
  });
}
