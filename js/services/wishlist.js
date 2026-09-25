// Service Favoris (Wishlist) — lecture/écriture RLS sur public.wishlist_items.
//
// user_id vient TOUJOURS de la session Supabase Auth courante — jamais d'une
// URL, d'un formulaire, du DOM ou de localStorage. Aucune vérité locale : le
// favori est réel ou n'existe pas.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";

async function authed() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const session = await getSession();
  if (!session || !session.user) throw new Error("not-authenticated");
  return { sb, user: session.user };
}

export async function getMyWishlist() {
  const { sb, user } = await authed();
  const { data, error } = await sb
    .from("wishlist_items")
    .select("id,product_id,created_at")
    .eq("user_id", user.id) // portée sémantique ; RLS reste la sécurité
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getMyWishlistProductIds() {
  const rows = await getMyWishlist();
  return rows.map((r) => r.product_id).filter(Boolean);
}

export async function isWishlisted(productId) {
  if (!productId) return false;
  const { sb, user } = await authed();
  const { data, error } = await sb
    .from("wishlist_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function addToWishlist(productId) {
  if (!productId) throw new Error("product-required");
  const { sb, user } = await authed();
  const { error } = await sb
    .from("wishlist_items")
    .insert({ user_id: user.id, product_id: productId });
  if (error) {
    // Violation unique (user_id, product_id) = déjà en favoris -> pas une erreur fatale.
    if (error.code === "23505") return { alreadyExists: true };
    throw error;
  }
  return { alreadyExists: false };
}

export async function removeFromWishlist(productId) {
  if (!productId) throw new Error("product-required");
  const { sb, user } = await authed();
  const { error } = await sb
    .from("wishlist_items")
    .delete()
    .eq("user_id", user.id) // jamais de DELETE large
    .eq("product_id", productId);
  if (error) throw error;
}

// Bascule et renvoie le nouvel état (true = enregistré, false = retiré).
export async function toggleWishlist(productId, currentlySaved) {
  if (currentlySaved) {
    await removeFromWishlist(productId);
    return false;
  }
  await addToWishlist(productId);
  return true;
}
