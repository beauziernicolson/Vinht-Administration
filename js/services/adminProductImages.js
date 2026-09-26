import { getSupabase } from "./supabase.js";

const BUCKET = "product-images";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 10 * 1024 * 1024;

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  return sb;
}

function validateFile(file) {
  if (!file) throw new Error("image_file_required");
  if (!ALLOWED_MIME.has(file.type)) throw new Error("invalid_product_image_mime");
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES) throw new Error("invalid_product_image_size");
}

function randomName(ext) {
  try { return `${crypto.randomUUID()}.${ext}`; }
  catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.${ext}`; }
}

export async function adminListProductImages(productId) {
  if (!productId) throw new Error("product_id_required");
  const sb = client();
  const { data, error } = await sb.rpc("admin_list_product_images_v1", { p_product_id: productId });
  if (error) throw error;
  if (!data || data.state !== "ready" || !data.product || !Array.isArray(data.rows)) throw new Error("admin_product_images_malformed_response");
  return data;
}

export function adminProductImagePublicUrl(storagePath) {
  const path = String(storagePath || "").trim();
  if (!path) return "";
  const sb = client();
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

export async function adminUploadProductImage({ productId, merchantId, file, altText = null, position = null, isPrimary = false, reason }) {
  if (!productId || !merchantId) throw new Error("product_image_context_required");
  const why = String(reason || "").trim();
  if (why.length < 5) throw new Error("reason_required");
  validateFile(file);

  const sb = client();
  const ext = EXT[file.type] || "bin";
  const path = `${merchantId}/${productId}/${randomName(ext)}`;
  const upload = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) {
    const e = new Error("product_image_storage_upload_failed");
    e.cause = upload.error;
    throw e;
  }

  const { data, error } = await sb.rpc("admin_register_product_image_v1", {
    p_product_id: productId,
    p_storage_path: path,
    p_alt_text: String(altText || "").trim() || null,
    p_position: position == null ? null : Number(position),
    p_is_primary: !!isPrimary,
    p_reason: why,
  });
  if (error) {
    await sb.storage.from(BUCKET).remove([path]).catch(() => null);
    throw error;
  }
  return data;
}

export async function adminDeleteProductImage(imageId, reason) {
  if (!imageId) throw new Error("product_image_id_required");
  const why = String(reason || "").trim();
  if (why.length < 5) throw new Error("reason_required");
  const sb = client();
  const { data, error } = await sb.rpc("admin_delete_product_image_v1", { p_image_id: imageId, p_reason: why });
  if (error) throw error;
  let cleanupError = null;
  if (data?.storage_path) {
    const cleanup = await sb.storage.from(BUCKET).remove([data.storage_path]);
    cleanupError = cleanup.error || null;
  }
  return { ...data, cleanupError };
}

export function adminProductImageErrorFr(err, fallback = "Action image refusée.") {
  const code = String(err?.message || err || "").trim();
  const map = {
    admin_role_required: "Rôle administrateur requis.",
    product_id_required: "Produit requis.",
    product_not_found: "Produit introuvable dans l’environnement Admin actuel.",
    reason_required: "Un motif interne d’au moins 5 caractères est requis.",
    image_file_required: "Choisissez au moins une image.",
    invalid_product_image_mime: "Format d’image non supporté. Utilisez JPG, PNG, WebP ou GIF.",
    invalid_product_image_size: "Image invalide ou supérieure à 10 Mo.",
    invalid_product_image_storage_path: "Chemin de stockage image invalide.",
    product_image_storage_object_not_found: "Le fichier image n’a pas été retrouvé dans le stockage.",
    product_image_limit_reached: "Ce produit possède déjà 5 images.",
    product_image_already_registered: "Cette image est déjà enregistrée.",
    product_image_not_found: "Image produit introuvable.",
    product_image_storage_upload_failed: "Échec de l’envoi du fichier image.",
  };
  return map[code] || fallback;
}
