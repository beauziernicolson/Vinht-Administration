import { adminRpc } from "./adminControl.js";

const requiredId = (v) => { if (!v) throw new Error("assisted_onboarding_not_found"); return v; };
const reason = (v) => {
  const r = String(v || "").trim();
  if (r.length < 5) throw new Error("reason_required");
  return r;
};

export async function adminGetAssistedDossierOwnership(dossierId) {
  return adminRpc("admin_get_assisted_merchant_dossier_v1", {
    p_dossier_id: requiredId(dossierId),
  });
}

export async function adminUpdateAssistedDossierOwnership(dossierId, values = {}, why) {
  return adminRpc("admin_update_assisted_merchant_dossier_v1", {
    p_dossier_id: requiredId(dossierId),
    p_full_name: values.fullName,
    p_shop_name: values.shopName,
    p_merchant_type: values.merchantType,
    p_phone: values.phone || null,
    p_whatsapp_number: values.whatsappNumber || null,
    p_email: values.email || null,
    p_shop_description: values.shopDescription || null,
    p_product_categories: Array.isArray(values.productCategories) ? values.productCategories : [],
    p_business_address_line1: values.businessAddressLine1,
    p_business_department: values.businessDepartment,
    p_business_commune: values.businessCommune,
    p_reason: reason(why),
  });
}

export async function adminMarkAssistedDossierReady(dossierId, why) {
  return adminRpc("admin_mark_assisted_merchant_ready_v1", {
    p_dossier_id: requiredId(dossierId),
    p_reason: reason(why),
  });
}

export async function adminIssueAssistedDossierInvite(dossierId, why) {
  return adminRpc("admin_issue_assisted_merchant_invite_v1", {
    p_dossier_id: requiredId(dossierId),
    p_reason: reason(why),
  });
}
