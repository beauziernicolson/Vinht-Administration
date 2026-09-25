// Candidatures marchand — surface Admin.
//
// Uniquement les 5 RPC Admin environment-aware (backend 20260921234848) :
//   admin_list_merchant_applications_v1, admin_get_merchant_application_v1,
//   admin_count_pending_merchant_applications_v1, admin_approve_merchant_application_v1,
//   admin_reject_merchant_application_v1.
// Le backend limite tout à l'environnement de l'admin courant et refuse une candidature d'un
// autre environnement. Aucun SELECT direct sur merchant_applications, aucun appel aux anciens
// approve_merchant_application / reject_merchant_application depuis ce frontend.

import { adminRpc } from "./adminControl.js";

export const MERCHANT_APPLICATION_STATUSES = ["pending", "approved", "rejected", "cancelled"];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const ready = (d, code) => {
  if (!isObj(d) || d.state !== "ready") throw new Error(code);
  return d;
};

export async function adminListMerchantApplications({ status = null, limit = 100, offset = 0 } = {}) {
  const d = ready(await adminRpc("admin_list_merchant_applications_v1", { p_status: status || null, p_limit: limit, p_offset: offset }), "merchant_applications_malformed_response");
  if (!Array.isArray(d.rows)) throw new Error("merchant_applications_malformed_response");
  return { environment: d.environment || null, rows: d.rows, total: Number.isFinite(Number(d.total)) ? Number(d.total) : d.rows.length, limit: d.limit ?? limit, offset: d.offset ?? offset, hasMore: !!d.has_more };
}

export async function adminGetMerchantApplication(applicationId) {
  if (!applicationId) throw new Error("application-required");
  const d = ready(await adminRpc("admin_get_merchant_application_v1", { p_application_id: applicationId }), "merchant_application_malformed_response");
  if (!isObj(d.application)) throw new Error("merchant_application_malformed_response");
  return { environment: d.environment || null, application: d.application };
}

export async function adminCountPendingMerchantApplications() {
  const d = ready(await adminRpc("admin_count_pending_merchant_applications_v1", {}), "merchant_applications_count_malformed_response");
  const n = Number(d.count);
  if (!Number.isFinite(n)) throw new Error("merchant_applications_count_malformed_response");
  return { environment: d.environment || null, count: n };
}

export async function adminApproveMerchantApplication(applicationId) {
  if (!applicationId) throw new Error("application-required");
  const d = ready(await adminRpc("admin_approve_merchant_application_v1", { p_application_id: applicationId }), "merchant_application_approve_malformed_response");
  return { environment: d.environment || null, result: d.result ?? null };
}

export async function adminRejectMerchantApplication(applicationId, reason) {
  if (!applicationId) throw new Error("application-required");
  const r = String(reason || "").trim();
  if (!r) throw new Error("reason-required");
  const d = ready(await adminRpc("admin_reject_merchant_application_v1", { p_application_id: applicationId, p_reason: r }), "merchant_application_reject_malformed_response");
  return { environment: d.environment || null, result: d.result ?? null };
}
