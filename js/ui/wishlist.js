// UI partagée pour les boutons "coeur" (Home + fiche produit).
// Anonyme -> modale Auth existante, jamais d'écriture locale.
// Authentifié -> toggle réel sur wishlist_items, repeinture immédiate.
//
// Icône : une seule <i data-lucide="heart"> par bouton, posée une fois dans le
// markup (home.js / product.html). paintHeart() ne fait que basculer une
// classe "is-saved" — le remplissage (♡ -> ♥) vient du CSS (voir js/lib/icons.js),
// jamais d'un remplacement de textContent qui effacerait l'icône SVG.

import { getSession } from "../services/auth.js";
import { toggleWishlist } from "../services/wishlist.js";
import { openAuthModal } from "./authModal.js";
import { showToast } from "./toast.js";

export function paintHeart(btn, saved, { iconOnly = true } = {}) {
  btn.classList.toggle("is-saved", !!saved);
  btn.setAttribute("aria-pressed", saved ? "true" : "false");
  btn.setAttribute("aria-label", saved ? "Retirer des favoris" : "Ajouter aux favoris");
  if (!iconOnly) {
    const label = btn.querySelector("[data-heart-label]");
    if (label) label.textContent = saved ? "Dans mes favoris" : "Ajouter aux favoris";
  }
}

// Gère un clic sur un coeur. Retourne le nouvel état (true/false) ou null si
// l'action a été bloquée (anonyme) ou a échoué (repeint alors l'état d'origine).
export async function handleHeartClick(btn, productId, saved, opts = {}) {
  if (!productId) return null;

  const session = await getSession();
  if (!session || !session.user) {
    showToast("Connectez-vous pour enregistrer vos favoris.");
    openAuthModal("login");
    return null;
  }

  btn.disabled = true;
  try {
    const next = await toggleWishlist(productId, saved);
    paintHeart(btn, next, opts);
    return next;
  } catch (e) {
    console.warn("[VinHT] wishlist:", e && e.message);
    showToast("Action impossible sur les favoris.", "red");
    paintHeart(btn, saved, opts); // restaure l'état connu
    return null;
  } finally {
    btn.disabled = false;
  }
}
