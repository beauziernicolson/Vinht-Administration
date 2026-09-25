// Service panier partagé (localStorage).
//
// Clé inchangée : "vinht-cart". Forme d'un article :
//   { id, name, seller, price, qty, img }
//
// Les prix stockés ici ne servent qu'à l'affichage / estimation.
// Le serveur reste la source financière autoritaire (checkout Phase 6).

import { $$ } from "../lib/dom.js";
import { getProductType, isLiveProductId } from "./productType.js";

const KEY = "vinht-cart";
function normalizeCurrency(value) {
  const c = String(value || "HTG").trim().toUpperCase();
  return c === "USD" ? "USD" : "HTG";
}

export function cartCurrency(items = null) {
  const rows = Array.isArray(items) ? items : getCart();
  const currencies = [...new Set(rows.map((x) => normalizeCurrency(x?.currency)))];
  return currencies.length <= 1 ? (currencies[0] || "HTG") : null;
}

export function cartHasMixedCurrencies(items = null) {
  const rows = Array.isArray(items) ? items : getCart();
  return new Set(rows.map((x) => normalizeCurrency(x?.currency))).size > 1;
}

export function getCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    // Le stockage navigateur est une entrée non fiable : une ancienne version,
    // une extension ou une écriture manuelle ne doit jamais faire tomber le
    // boot de toutes les pages via un `.reduce` sur un objet.
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => isLiveProductId(item?.productId || item?.id))
          .map((item) => ({ ...item, currency: normalizeCurrency(item?.currency), productType: getProductType(item?.productId || item?.id) }))
      : [];
  } catch (e) {
    return [];
  }
}

export function setCart(items) {
  const next = Array.isArray(items) ? items : [];
  localStorage.setItem(KEY, JSON.stringify(next));
  updateCartCount();
  // `storage` ne se déclenche pas dans la fenêtre qui écrit. Cet évènement
  // synchronise donc immédiatement drawer, page panier et autres vues déjà
  // montées, sans créer un second système de panier.
  window.dispatchEvent(new CustomEvent("vinht:cartchange"));
}

export function cartCount() {
  return getCart().reduce((a, b) => a + Math.max(0, Number(b?.qty) || 0), 0);
}

export function cartSubtotal() {
  return getCart().reduce((s, x) => s + (Number(x?.price) || 0) * Math.max(0, Number(x?.qty) || 0), 0);
}

export function updateCartCount() {
  const n = cartCount();
  $$(".cart-count").forEach((x) => {
    x.textContent = n;
  });
}

// Données panier essentielles pour le checkout serveur (Phase 6) :
//   product_id, variant_id (si le produit a des variantes), qty, pricing_tier.
// pricing_tier = "retail" par défaut ; "wholesale" seulement si explicitement choisi.
// variantId provient toujours d'une variante RÉELLE renvoyée par le backend
// (get_product_variant_context_v1) — jamais fabriqué côté frontend.
// Les autres champs (name, seller, price, img, variantOptions) sont purement
// pour l'affichage — le serveur reste la source financière autoritaire.
export function addToCart({
  id,
  name,
  seller,
  price,
  img,
  currency = "HTG",
  productId = null,
  pricingTier = "retail",
  moq,
  variantId = null,
  variantOptions = null,
}) {
  const key = id || productId;
  // Les fixtures restent visibles dans le catalogue, mais ne doivent jamais
  // contaminer le panier transactionnel ni devenir une ligne RPC.
  if (!isLiveProductId(productId || key)) return false;
  const cart = getCart();
  const lineCurrency = normalizeCurrency(currency);
  const existingCurrency = cartCurrency(cart);
  if (cart.length && existingCurrency && existingCurrency !== lineCurrency) {
    const err = new Error("mixed_currency_cart_not_supported");
    err.code = "mixed_currency_cart_not_supported";
    throw err;
  }
  if (cart.length && existingCurrency === null) {
    const err = new Error("mixed_currency_cart_not_supported");
    err.code = "mixed_currency_cart_not_supported";
    throw err;
  }
  const tier = pricingTier || "retail";
  const vId = variantId || null;
  // Une variante distincte = une ligne de panier distincte.
  const found = cart.find(
    (x) => x.id === key && (x.pricingTier || "retail") === tier && (x.variantId || null) === vId
  );
  if (found) {
    found.qty++;
    if (tier === "wholesale" && moq && found.qty < moq) found.qty = moq;
  } else {
    const item = {
      id: key,
      productId: productId || null,
      productType: "live",
      pricingTier: tier,
      name,
      seller,
      price: Number(price) || 0,
      currency: lineCurrency,
      qty: tier === "wholesale" && moq ? Math.max(1, moq) : 1,
      img,
    };
    if (tier === "wholesale" && moq) item.moq = Number(moq) || 0;
    if (vId) {
      item.variantId = vId;
      if (variantOptions && typeof variantOptions === "object") item.variantOptions = variantOptions;
    }
    cart.push(item);
  }
  setCart(cart);
  return true;
}

// Libellé lisible d'une combinaison de variante : { "Taille":"M","Couleur":"Rouge" }
// -> "Taille : M · Couleur : Rouge". Retourne "" si aucune option.
export function variantOptionsLabel(options) {
  if (!options || typeof options !== "object") return "";
  const parts = Object.entries(options)
    .filter(([, v]) => v != null && String(v) !== "")
    .map(([k, v]) => `${k} : ${v}`);
  return parts.join(" · ");
}

// L'ancien panier de démonstration a été retiré.
// Cette routine purge les anciennes lignes fictives restées dans localStorage.
export function maybeSeedCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) {
      localStorage.setItem(KEY, "[]");
      return;
    }
    const live = raw.filter((item) => isLiveProductId(item?.productId || item?.id));
    if (live.length !== raw.length) localStorage.setItem(KEY, JSON.stringify(live));
  } catch {
    localStorage.setItem(KEY, "[]");
  }
}
