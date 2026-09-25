// Onboarding marchand — KYC personnel (Feature #2).
//
// SOURCE DE VÉRITÉ FRONTEND : le RPC `get_my_merchant_kyc_context_v1()` (et son
// équivalent admin). Tous les RPC renvoient le contexte décoré à jour : après
// chaque action on re-rend simplement depuis la réponse. Le frontend n'invente
// aucune règle (documents requis, can_submit, can_approve viennent du backend).
//
// Bucket privé `merchant-kyc-documents`. Chemin obligatoire :
//   <user_id>/<case_id>/<document_type>/<filename>
// On upload d'abord dans Storage PUIS on appelle register_my_merchant_kyc_document_v1.
// Un fichier n'est jamais "enregistré" tant que le RPC register n'a pas réussi.
// Jamais de getPublicUrl : lecture via createSignedUrl uniquement.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

export const KYC_BUCKET = "merchant-kyc-documents";
// Types de documents visibles dans l'onboarding normal (les autres restent cachés).
export const KYC_ONBOARDING_DOC_TYPES = ["identity_document", "selfie"];
export const KYC_DOC_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const KYC_MAX_BYTES = 25 * 1024 * 1024; // aligné sur file_size_limit du bucket
const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

function sb() {
  const client = getSupabase();
  if (!client) throw new Error("supabase_not_configured");
  return client;
}

async function requireUserId() {
  const session = await getSession();
  const id = session?.user?.id;
  if (!id) throw new Error("authentication_required");
  return id;
}

// --- Messages utilisateur (jamais de code brut à l'écran) -------------------
export function kycErrorMessage(err, fallback = "Une erreur est survenue. Réessayez.") {
  const raw = String((err && (err.message || err.error_description || err.code || err)) || "").toLowerCase();
  const has = (s) => raw.includes(s);
  if (has("authentication_required") || has("not-authenticated") || has("jwt") || has("401")) return "Connectez-vous pour continuer.";
  if (has("admin_role_required") || has("403") || has("permission denied")) return "Action réservée à l'administration VinHT.";
  if (has("merchant_application_required")) return "Créez d'abord votre demande marchand.";
  if (has("merchant_application_not_found")) return "Demande marchand introuvable.";
  if (has("kyc_case_not_found")) return "Aucun dossier de vérification n'a été trouvé.";
  if (has("kyc_case_not_editable")) return "Ce dossier n'est plus modifiable.";
  if (has("kyc_case_not_submittable")) return "Ce dossier ne peut pas être envoyé pour l'instant.";
  if (has("kyc_case_not_reviewable")) return "Ce dossier n'est pas en cours d'examen.";
  if (has("kyc_document_required") || has("required_kyc_documents_missing")) return "Ajoutez votre pièce d'identité et votre selfie avant d'envoyer.";
  if (has("replace_rejected_kyc_documents")) return "Remplacez le document refusé avant de renvoyer votre dossier.";
  if (has("invalid_kyc_document_type")) return "Type de document non pris en charge.";
  if (has("invalid_kyc_storage_path") || has("kyc_storage_object_not_found") || has("kyc_storage_object_not_owned")) return "Le téléchargement a échoué. Réessayez.";
  if (has("rejection_reason_required")) return "Un motif est obligatoire pour refuser.";
  if (has("invalid_document_decision")) return "Décision non valide.";
  if (has("kyc_document_not_found")) return "Document introuvable.";
  if (has("kyc_case_not_approvable")) return "Ce dossier ne peut pas encore être approuvé.";
  if (has("kyc_approval_required")) return "Le KYC du demandeur doit être approuvé avant d'activer la boutique.";
  if (has("payload too large") || has("413") || has("exceeded")) return "Fichier trop volumineux (25 Mo maximum).";
  if (has("mime") || has("content type")) return "Format de fichier non accepté (JPEG, PNG, WebP ou PDF).";
  if (has("network") || has("fetch failed") || has("timeout")) return "Connexion impossible. Vérifiez votre réseau.";
  return fallback;
}

// --- Utilisateur ----------------------------------------------------------
export async function getMyMerchantKycContext() {
  const { data, error } = await sb().rpc("get_my_merchant_kyc_context_v1");
  if (error) throw error;
  return data || null;
}

export async function startMerchantKyc(applicationId = null) {
  const { data, error } = await sb().rpc("start_my_merchant_kyc_v1", { p_application_id: applicationId || null });
  if (error) throw error;
  return data;
}

export async function submitMerchantKyc() {
  const { data, error } = await sb().rpc("submit_my_merchant_kyc_v1");
  if (error) throw error;
  return data;
}

export async function cancelMerchantKyc() {
  const { data, error } = await sb().rpc("cancel_my_merchant_kyc_v1");
  if (error) throw error;
  return data;
}

// Upload Storage PUIS register. `documentType` doit être 'identity_document' ou 'selfie'.
export async function uploadKycDocument({ caseId, documentType, file }) {
  if (!caseId) throw new Error("kyc_case_not_found");
  if (!KYC_ONBOARDING_DOC_TYPES.includes(documentType)) throw new Error("invalid_kyc_document_type");
  if (!file) throw new Error("no_file");
  if (!KYC_DOC_MIME.includes(file.type)) throw new Error("mime");
  if (file.size > KYC_MAX_BYTES) throw new Error("exceeded");

  const uid = await requireUserId();
  const ext = EXT_BY_MIME[file.type] || "bin";
  let rand;
  try { rand = crypto.randomUUID(); } catch { rand = Math.random().toString(36).slice(2) + Date.now().toString(36); }
  const storagePath = `${uid}/${caseId}/${documentType}/${rand}.${ext}`;

  const up = await sb().storage.from(KYC_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
  if (up.error) {
    const e = new Error("kyc_storage_upload_failed");
    e.cause = up.error;
    throw e;
  }

  const { data, error } = await sb().rpc("register_my_merchant_kyc_document_v1", {
    p_case_id: caseId,
    p_document_type: documentType,
    p_storage_path: storagePath,
  });
  if (error) {
    // Le fichier est dans Storage mais non enregistré -> on tente un nettoyage best-effort.
    try { await sb().storage.from(KYC_BUCKET).remove([storagePath]); } catch { /* ignore */ }
    throw error;
  }
  return data;
}

// Lecture d'un document privé : URL signée courte. JAMAIS getPublicUrl.
export async function signedKycUrl(storagePath, expiresSeconds = 120) {
  if (!storagePath) return null;
  const { data, error } = await sb().storage.from(KYC_BUCKET).createSignedUrl(storagePath, expiresSeconds);
  if (error) throw error;
  return data?.signedUrl || null;
}

// --- Admin --------------------------------------------------------------
export async function adminListKycCases({ status = null, limit = 100 } = {}) {
  const { data, error } = await sb().rpc("admin_list_merchant_kyc_cases_v1", {
    p_status: status || null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data && Array.isArray(data.cases) ? data.cases : []);
}

export async function adminGetKycContext(caseId) {
  const { data, error } = await sb().rpc("admin_get_merchant_kyc_context_v1", { p_case_id: caseId });
  if (error) throw error;
  return data || null;
}

export async function adminReviewKycDocument(documentId, decision, reason = null) {
  // decision : 'accepted' | 'rejected'
  const { data, error } = await sb().rpc("admin_review_merchant_kyc_document_v1", {
    p_document_id: documentId,
    p_decision: decision,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data;
}

export async function adminRequestKycChanges(caseId, reason) {
  const { data, error } = await sb().rpc("admin_request_merchant_kyc_changes_v1", { p_case_id: caseId, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function adminApproveKyc(caseId, note = null) {
  const { data, error } = await sb().rpc("admin_approve_merchant_kyc_v1", { p_case_id: caseId, p_note: note || null });
  if (error) throw error;
  return data;
}

export async function adminRejectKyc(caseId, reason) {
  const { data, error } = await sb().rpc("admin_reject_merchant_kyc_v1", { p_case_id: caseId, p_reason: reason });
  if (error) throw error;
  return data;
}
