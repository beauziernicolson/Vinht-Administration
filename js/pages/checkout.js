// Logique de la page checkout.html.
// Rendu panier + quantités + sélection livraison/paiement + récap.
// Les montants affichés sont une ESTIMATION. Le serveur valide les vrais
// montants au moment du checkout.

import { $, $$ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getCart, setCart, updateCartCount, cartCurrency, cartHasMixedCurrencies } from "../services/cart.js";
import { toOrderLines, getActiveSession } from "../services/orders.js";
import {
  getPromotionCapabilities, quoteMarketplacePromotionCodes, createMarketplaceOrderWithPromotions,
  promotionErrorMessageFr, isValidPromotionCode, normalizePromotionCode, parsePromotionErrorCode,
} from "../services/promotions.js";
import { linkOrderAnalyticsSession } from "../services/analyticsSession.js";
import { createPlatformPayment, getPlatformPaymentMethods } from "../services/payments.js";
import { createMoncashPayment } from "../services/moncashPayments.js";
import { showToast } from "../ui/toast.js";
import { isDemoProduct } from "../services/productType.js";
import { isSupabaseConfigured } from "../services/supabase.js";
import { openAuthModal } from "../ui/authModal.js";
import { getMyProfile } from "../services/profile.js";
import { getDefaultAddress } from "../services/addresses.js";
import { getCheckoutDeliveryCapabilities } from "../services/logistics.js";
import { attachGeoHints } from "../services/geoHints.js";
import { validateStandardAddress, canonicalAddressPayload } from "../services/addressContract.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

export function initOptions() {
  $$(".options").forEach((group) => {
    if (group.dataset.optionDelegation === "1") return;
    group.dataset.optionDelegation = "1";
    group.addEventListener("click", (event) => {
      const opt = event.target.closest(".option");
      if (!opt || !group.contains(opt)) return;
      if (opt.dataset.disabled === "true") {
        showToast(opt.dataset.disabledMessage || "Ce choix n'est pas disponible pour cette commande.");
        return;
      }
      $$(".option", group).forEach((x) => x.classList.remove("selected"));
      opt.classList.add("selected");
      recalcSummary();
    });
  });
}

const DELIVERY_METHOD_UI = {
  home: { label: "À domicile", description: "Livraison à votre adresse.", icon: "house" },
  custom_location: { label: "Adresse personnalisée", description: "Adresse ou position choisie.", icon: "map-pin" },
  vinht_pickup: { label: "Point VinHT", description: "Retrait dans un point VinHT disponible.", icon: "store" },
};

function deliveryMethodCard(code,config,currency,pickupPoints=[]){
  const ui=DELIVERY_METHOD_UI[code]||{};
  const fee=config?.fee_amount;
  const feeLine=fee===null||fee===undefined
    ? '<span class="pay-badge">Tarif calculé par le serveur</span>'
    : `<span class="pay-badge">${esc(money(Number(fee),currency))}</span>`;
  const pickupSelect=code==="vinht_pickup"
    ? `<label class="field" style="margin-top:10px"><span>Point de retrait</span><select id="pickupPointSelect" class="input">${pickupPoints.map((p)=>{const a=p?.address||{};const where=[a.address_line1,a.commune].filter(Boolean).join(", ");return `<option value="${esc(p.code)}">${esc(p.name)}${where?` — ${esc(where)}`:""}</option>`}).join("")}</select></label>`
    : "";
  return `<div class="option" data-delivery="${esc(code)}">
    <div class="bigico"><i data-lucide="${esc(ui.icon||"truck")}"></i></div>
    <strong>${esc(ui.label||code)}</strong>
    <p>${esc(ui.description||"Mode de livraison VinHT.")}</p>
    ${feeLine}
    ${pickupSelect}
  </div>`;
}

async function loadDeliveryOptions(){
  const host=$("#deliveryOptions");
  if(!host)return;
  const cart=getCart();
  if(!cart.length){
    host.innerHTML='<div class="empty-state"><p>Ajoutez un produit pour voir les modes de livraison disponibles.</p></div>';
    return;
  }
  const currency=cartCurrency(cart);
  if(!currency||cartHasMixedCurrencies(cart)){
    host.innerHTML='<div class="error-state">Ce panier contient plusieurs devises. Séparez les achats HTG et USD.</div>';
    return;
  }
  host.innerHTML='<div class="loading-state">Chargement des modes de livraison disponibles…</div>';
  try{
    const caps=await getCheckoutDeliveryCapabilities(currency);
    const methods=caps.delivery_methods||{};
    const pickupPoints=Array.isArray(caps.pickup_points)?caps.pickup_points:[];
    const order=["home","custom_location","vinht_pickup"];
    const available=order.filter((code)=>methods?.[code]?.available===true);
    if(!available.length){
      const message=String(caps.public_message_fr||"").trim();
      host.innerHTML=`<div class="error-state">Aucun mode de livraison n'est actuellement disponible pour ce panier.${message?` ${esc(message)}`:""}</div>`;
      recalcSummary();
      return;
    }
    host.innerHTML=available.map((code)=>deliveryMethodCard(code,methods[code],currency,pickupPoints)).join("");
    const first=host.querySelector(".option");
    if(first)first.classList.add("selected");
    refreshIcons();
    recalcSummary();
  }catch{
    host.innerHTML='<div class="error-state">Impossible de charger les modes de livraison actuellement disponibles.</div>';
    recalcSummary();
  }
}

const PAYMENT_METHOD_UI = {
  flexicash: { label: "FlexiCash", description: "Paiement avec votre solde FlexiCash.", image: "images/flexilogo.jpeg" },
  moncash: { label: "MonCash", description: "Paiement mobile Digicel.", image: "images/moncash.png" },
  stripe: { label: "Carte bancaire", description: "Paiement sécurisé par Stripe — Visa, Mastercard et cartes compatibles.", image: "images/stripes.png" },
};

function paymentMethodCard(method) {
  const code = String(method?.method_code || "").toLowerCase();
  const ui = PAYMENT_METHOD_UI[code] || {};
  const label = ui.label || method?.label || code;
  const available = method?.available !== false;
  const description = available
    ? (ui.description || "Paiement sécurisé.")
    : "Temporairement indisponible. Le fournisseur ne répond pas correctement en ce moment.";
  const image = ui.image ? `<span class="pay-card-logo"><img src="${esc(ui.image)}" alt="${esc(label)}" loading="lazy" decoding="async"></span>` : "";
  const perk = available && code === "flexicash" ? '<span class="pay-badge pay-badge-perk">2 % de réduction avec FlexiCash</span>' : "";
  const unavailable = available ? "" : '<span class="pay-badge">Indisponible</span>';
  return `<div class="option pay-card${available ? "" : " is-disabled"}"
    data-method="${esc(code)}"
    data-available="${available ? "yes" : "no"}"
    data-disabled="${available ? "false" : "true"}"
    data-disabled-message="${available ? "" : esc(label + " est temporairement indisponible.")}"
    data-discount="${available && code === "flexicash" ? "yes" : "no"}"
    aria-disabled="${available ? "false" : "true"}">
    ${image}<span class="pay-card-body"><strong>${esc(label)}</strong><p>${esc(description)}</p>${perk}${unavailable}</span>
    ${available ? '<span class="pay-card-check" aria-hidden="true"><i data-lucide="check"></i></span>' : ""}
  </div>`;
}

async function loadPaymentOptions() {
  const host = $("#paymentOptions");
  if (!host) return;
  const cart = getCart();
  if (!cart.length) {
    host.innerHTML = '<div class="empty-state"><p>Ajoutez un produit pour voir les moyens de paiement disponibles.</p></div>';
    return;
  }
  const currency = cartCurrency(cart);
  if (!currency || cartHasMixedCurrencies(cart)) {
    host.innerHTML = '<div class="error-state">Ce panier contient plusieurs devises. Séparez les achats HTG et USD.</div>';
    return;
  }

  const session = await getActiveSession();
  if (!session) {
    host.innerHTML = '<div class="error-state">Connectez-vous pour charger les moyens de paiement disponibles.</div>';
    return;
  }

  host.innerHTML = '<div class="loading-state">Chargement des moyens de paiement disponibles…</div>';
  let environment = "production";
  try {
    const customerProfile = await getMyProfile();
    environment = String(customerProfile?.commerce_environment || "production").toLowerCase();
  } catch {}

  try {
    const result = await getPlatformPaymentMethods(currency, environment, session);
    const methods = Array.isArray(result?.methods) ? result.methods : [];
    if (!methods.length) {
      host.innerHTML = `<div class="error-state">Aucun moyen de paiement n'est actuellement disponible en ${esc(currency)}.</div>`;
      recalcSummary();
      return;
    }
    host.innerHTML = methods.map(paymentMethodCard).join("");
    const first = host.querySelector('.option[data-available="yes"]');
    if (first) first.classList.add("selected");
    refreshIcons();
    recalcSummary();
  } catch {
    host.innerHTML = '<div class="error-state">Impossible de charger les moyens de paiement actuellement disponibles.</div>';
    recalcSummary();
  }
}

export function initQty() {
  try { if (document.body?.hasAttribute("data-product-v12") && new URLSearchParams(location.search).get("catalogDemo") === "1") return; } catch (e) {}
  $$(".qty").forEach((q) => {
    const value = $("span", q);
    if (!value) return;
    $$("button", q).forEach((btn) =>
      btn.addEventListener("click", () => {
        let n = Number(value.textContent);
        n = Math.max(1, n + (btn.dataset.dir === "inc" ? 1 : -1));
        value.textContent = n;
      })
    );
  });
}

export function renderCart() {
  const host = $("#cartRows");
  if (!host) return;

  const cart = getCart();
  const containsDemo = cart.some(isDemoProduct);

  document.querySelectorAll('a[href="checkout.html"], a[data-checkout-link]').forEach((link) => {
    link.dataset.checkoutLink = "1";
    if (containsDemo) {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.classList.add("is-disabled");
    } else {
      link.setAttribute("href", "checkout.html");
      link.removeAttribute("aria-disabled");
      link.classList.remove("is-disabled");
    }
  });

  if (!cart.length) {
    host.innerHTML =
      '<div style="padding:34px 16px;text-align:center;color:#6f7891;font-size:13px">' +
      'Votre panier est vide. ' +
      '<a href="index.html" style="color:#0b2edc;font-weight:800">Continuer vos achats</a>' +
      "</div>";
    recalcSummary();
    refreshIcons();
    return;
  }

  const demoWarning = containsDemo
    ? '<div class="error-state" style="margin-bottom:12px">Ce panier contient un produit de démonstration. Retirez-le pour accéder au checkout réel.</div>'
    : "";
  host.innerHTML = demoWarning + cart
    .map((x, i) => {
      const tierBadge =
        x.pricingTier === "wholesale"
          ? ` <span style="font-size:10px;font-weight:800;color:var(--blue,#0b2edc)">GROS${
              x.moq ? ` · min ${x.moq}` : ""
            }</span>`
          : "";
      const optTxt =
        x.variantOptions && typeof x.variantOptions === "object"
          ? Object.entries(x.variantOptions)
              .filter(([, v]) => v != null && String(v) !== "")
              .map(([k, v]) => `${String(k).charAt(0).toUpperCase() + String(k).slice(1)} : ${v}`)
              .join(" · ")
          : "";
      const optLine = optTxt
        ? `<small style="display:block;color:var(--muted,#6f7891)">${esc(optTxt)}</small>`
        : "";
      return `
    <div class="cart-row" data-index="${i}">
      <div class="cart-prod"><img src="${esc(x.img)}" alt="${esc(x.name)}"><div><strong>${esc(x.name)}</strong><small>Produit VinHT${tierBadge}</small>${optLine}</div></div>
      <div><strong style="font-size:12px">${esc(x.seller || "Marchand VinHT")}</strong><small style="display:block;margin-top:4px;color:var(--muted,#6f7891)">Marchand</small></div>
      <div class="cart-price">${money(x.price, x.currency || "HTG")}</div>
      <div class="qty cartqty"><button type="button" data-dir="dec" aria-label="Diminuer la quantité"><i data-lucide="minus"></i></button><span>${x.qty}</span><button type="button" data-dir="inc" aria-label="Augmenter la quantité"><i data-lucide="plus"></i></button></div>
      <div class="cart-total">${money(x.price * x.qty, x.currency || "HTG")}</div>
      <button class="delete" type="button" aria-label="Retirer ${esc(x.name)}"><i data-lucide="trash-2"></i></button>
    </div>`;
    })
    .join("");
  refreshIcons();

  $$(".cart-row", host).forEach((row) => {
    const i = Number(row.dataset.index);
    const qty = $(".cartqty", row);
    $$("button", qty).forEach((btn) =>
      btn.addEventListener("click", () => {
        const c = getCart();
        const minQ = c[i].pricingTier === "wholesale" && c[i].moq ? c[i].moq : 1;
        c[i].qty = Math.max(minQ, c[i].qty + (btn.dataset.dir === "inc" ? 1 : -1));
        setCart(c);
        renderCart();
        recalcSummary();
      })
    );
    $(".delete", row).addEventListener("click", () => {
      const c = getCart();
      c.splice(i, 1);
      setCart(c);
      renderCart();
      recalcSummary();
    });
  });

  recalcSummary();
}

// --- Feature #28 — Codes promo au checkout ----------------------------
// Le rabais final (promo ET paiement) n'est JAMAIS calculé ici : on
// n'affiche que ce que quote_marketplace_promotion_codes_v1 retourne.
// Le quote est invalidé et relancé à chaque changement pertinent (panier,
// quantité, offre, pricing tier, moyen de paiement, codes) avec une garde
// de séquence pour ignorer toute réponse obsolète.
let _promoCapsCache = null;
let _appliedCodes = [];
let _promoQuote = null;
let _promoQuoteError = null;
let _promoQuoteSeq = 0;

function buildQuoteItemsOrNull(cart) {
  try {
    // Mêmes lignes que toOrderLines() (product_id/quantity/pricing_tier,
    // + offer_id si présent sur l'article — Feature #7, jamais régressé),
    // mais sans lever d'exception : un panier invalide se traduit juste
    // par l'absence de quote, pas par un crash de l'écran récap.
    const lines = cart.map((it) => {
      const line = {
        product_id: it.productId || it.id,
        quantity: Math.max(1, parseInt(it.qty, 10) || 1),
        pricing_tier: it.pricingTier === "wholesale" ? "wholesale" : "retail",
      };
      if (it.offerId) line.offer_id = it.offerId;
      return line;
    });
    // Tout-ou-rien : une seule ligne inquotable invalide le devis entier —
    // jamais de quote partiel qui ignorerait silencieusement un article.
    if (lines.some((l) => !UUID_RE.test(String(l.product_id || "")))) return null;
    return lines;
  } catch {
    return null;
  }
}

function renderPromoChips() {
  const box = $("#promoCodeChips");
  if (!box) return;
  box.innerHTML = _appliedCodes.map((c) => `<span class="badge blue" data-promo-chip="${esc(c)}" style="display:inline-flex;align-items:center;gap:6px">${esc(c)}<button type="button" data-remove-code="${esc(c)}" style="border:none;background:none;cursor:pointer;color:inherit;font-weight:700">×</button></span>`).join("");
  box.querySelectorAll("[data-remove-code]").forEach((btn) => btn.addEventListener("click", () => {
    _appliedCodes = _appliedCodes.filter((c) => c !== btn.dataset.removeCode);
    renderPromoChips();
    recalcSummary();
  }));
}

async function initPromoCodeUI() {
  const section = $("#promoCodeSection");
  if (!section) return;
  const currency = cartCurrency(getCart());
  if (currency !== "HTG") {
    section.hidden = true;
    _appliedCodes = [];
    _promoQuote = null;
    _promoQuoteError = null;
    return;
  }
  try {
    _promoCapsCache = await getPromotionCapabilities();
  } catch {
    _promoCapsCache = null;
  }
  // N'affiche le bloc code promo QUE si promotions_enabled === true — ne
  // simule jamais une disponibilité que le backend n'accorde pas.
  section.hidden = !_promoCapsCache?.promotions_enabled;
  if (section.hidden) return;

  const input = $("#promoCodeInput");
  const applyBtn = $("#promoCodeApplyBtn");
  const msgBox = $("#promoCodeMsg");
  const showCodeMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = text ? "" : "none"; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
  const applyCode = () => {
    const raw = normalizePromotionCode(input?.value || "");
    if (!raw) return;
    if (!isValidPromotionCode(raw)) { showCodeMsg("Code invalide (3 à 32 caractères : lettres, chiffres, _ ou -).", false); return; }
    // Dédup exacte côté client — la validité réelle n'est jamais prétendue
    // avant le quote serveur.
    if (_appliedCodes.includes(raw)) { showCodeMsg("Ce code est déjà appliqué.", false); return; }
    _appliedCodes = [..._appliedCodes, raw];
    if (input) input.value = "";
    showCodeMsg("", true);
    renderPromoChips();
    recalcSummary();
  };
  applyBtn?.addEventListener("click", applyCode);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyCode(); } });
}

async function runPromoQuote() {
  const seq = ++_promoQuoteSeq;
  const cart = getCart();
  const currency = cartCurrency(cart);
  const items = buildQuoteItemsOrNull(cart);
  const paymentMethod = selectedPayment();
  if (currency !== "HTG") {
    _appliedCodes = [];
    _promoQuote = null;
    _promoQuoteError = null;
    const section = $("#promoCodeSection");
    if (section) section.hidden = true;
    applyPromoQuoteToSummary();
    return;
  }
  const clearPromoMsg = () => { const m = $("#promoCodeMsg"); if (m) { m.textContent = ""; m.style.display = "none"; } };
  if (!items || !items.length || !paymentMethod) {
    _promoQuote = null;
    _promoQuoteError = null;
    clearPromoMsg();
    applyPromoQuoteToSummary();
    return;
  }
  try {
    const quote = await quoteMarketplacePromotionCodes({ items, codes: _appliedCodes, paymentMethod });
    if (seq !== _promoQuoteSeq) return; // réponse obsolète — jamais réécrire un panier plus récent
    _promoQuote = quote;
    _promoQuoteError = null;
    // Un devis plus récent réussit : toute erreur affichée précédemment est
    // obsolète, jamais laissée persister à l'écran.
    clearPromoMsg();
  } catch (err) {
    if (seq !== _promoQuoteSeq) return;
    _promoQuote = null;
    _promoQuoteError = err;
    const msgBox = $("#promoCodeMsg");
    if (msgBox && _appliedCodes.length) {
      msgBox.textContent = promotionErrorMessageFr(err?.message, "Impossible de valider ces codes.");
      msgBox.style.display = "";
      msgBox.style.color = "var(--red,#b0122a)";
    }
  }
  if (seq === _promoQuoteSeq) applyPromoQuoteToSummary();
}

function applyPromoQuoteToSummary() {
  const sub = $("#subtotal");
  const disc = $("#discount");
  const label = $("#discountLabel");
  const promoRow = $("#promoDiscountRow");
  const promoDisc = $("#promoDiscount");
  const afterDiscounts = $("#subtotalAfterDiscounts");
  const selected = $(".payment-options .selected");
  const eligible = selected?.dataset.discount === "yes";
  if (label) label.textContent = eligible ? "Réduction FlexiCash (2 %)" : "Réduction paiement";
  // "Sous-total après remises" exclut la livraison — jamais présenté comme un
  // "Total" : le total réel (avec livraison) ne vient que de la réponse de
  // création de commande (voir #total, texte statique dans checkout.html).

  if (_promoQuote) {
    const baseSubtotal = Number(_promoQuote.base_subtotal_htg) || 0;
    const promoDiscountHtg = Number(_promoQuote.promotion_discount_htg) || 0;
    const paymentDiscountHtg = Number(_promoQuote.payment_discount_htg) || 0;
    const afterHtg = Number(_promoQuote.subtotal_after_promotions_and_payment_discount_htg);
    if (sub) sub.textContent = money(baseSubtotal);
    if (promoRow) promoRow.hidden = promoDiscountHtg <= 0;
    if (promoDisc) promoDisc.textContent = promoDiscountHtg ? "- " + money(promoDiscountHtg) : money(0);
    if (disc) disc.textContent = paymentDiscountHtg ? "- " + money(paymentDiscountHtg) : money(0);
    if (afterDiscounts) afterDiscounts.textContent = Number.isFinite(afterHtg) ? money(afterHtg) : "—";
  } else {
    // Pas de quote valide (panier vide, code en échec, panne réseau…) :
    // jamais de faux calcul local — on affiche un état honnête plutôt
    // qu'un rabais inventé.
    const localCart = getCart();
    const localCurrency = cartCurrency(localCart) || "HTG";
    const subtotalLocal = localCart.reduce((s, x) => s + x.price * x.qty, 0);
    if (sub) sub.textContent = money(subtotalLocal, localCurrency);
    if (promoRow) promoRow.hidden = true;
    if (disc) disc.textContent = _promoQuoteError ? "—" : money(0, localCurrency);
    if (afterDiscounts) afterDiscounts.textContent = _promoQuoteError ? "—" : money(subtotalLocal, localCurrency);
  }
}

export function recalcSummary() {
  // Rendu synchrone immédiat (estimation locale pendant que le quote
  // serveur tourne), puis le quote authoritaire vient écraser ces valeurs
  // dès qu'il répond — jamais l'inverse.
  applyPromoQuoteToSummary();
  runPromoQuote();
}

// ----------------------------------------------------------------------------
// Soumission de commande — RPC officiel create_marketplace_order
// ----------------------------------------------------------------------------

let submitting = false;

function selectedDelivery() {
  const el = $("#deliveryOptions .option.selected");
  return el ? el.dataset.delivery || "" : "";
}
function selectedPickupPointCode(){
  const value=String($("#pickupPointSelect")?.value||"").trim();
  return value||null;
}
function selectedPayment() {
  const el = $(".payment-options .option.selected");
  return el ? el.dataset.method || "" : "";
}

function showMsg(text) {
  const box = $("#checkoutMsg");
  if (!box) return;
  box.textContent = text;
  box.style.display = text ? "" : "none";
}
function clearMsg() {
  showMsg("");
}

// Erreurs serveur -> message clair, jamais de stack trace.
function mapOrderError(err) {
  // Feature #28 — entre le quote et le submit, une promo peut expirer ou
  // atteindre sa limite : le panier n'est jamais vidé dans ce cas (voir
  // handleSubmit), on affiche juste l'erreur exacte pour inviter à retirer
  // ou revalider le code.
  const promoCode = parsePromotionErrorCode(err && err.message);
  if (Object.prototype.hasOwnProperty.call(
    { promotion_code_invalid: 1, promotion_not_active: 1, no_eligible_items: 1, minimum_subtotal_not_met: 1,
      minimum_quantity_not_met: 1, promotion_economic_guard_failed: 1, multiple_promotions_same_merchant_not_allowed: 1,
      promotion_became_ineligible: 1, promotion_already_expired: 1, promotion_not_found: 1 },
    promoCode
  )) {
    return promotionErrorMessageFr(promoCode, null);
  }

  const raw = [err && err.message, err && err.details, err && err.hint, err && err.code]
    .filter(Boolean)
    .join(" | ");
  const m = raw.toLowerCase();

  if (/permission denied for function|jwt|not authenticated|auth/.test(m))
    return "Connectez-vous pour passer votre commande.";
  if (/mixed_currency_cart_not_supported/.test(m))
    return "Les articles HTG et USD doivent être commandés séparément.";
  if (/usd_promotions_not_configured/.test(m))
    return "Les promotions ne sont pas encore disponibles pour les commandes USD.";
  if (/usd_shipping_pricing_not_configured/.test(m))
    return "La livraison des commandes USD n'est pas encore configurée. Aucun frais ne sera converti ou inventé.";
  if (/usd_logistics_not_enabled|logistics_unavailable|home_delivery_unavailable|pickup_points_unavailable/.test(m))
    return "Ce mode de livraison n'est pas actuellement ouvert pour cette commande.";
  if (/usd_per_item_fee_policy_not_configured/.test(m))
    return "La tarification USD du plan vendeur n'est pas encore configurée par VinHT.";
  if (/usd_dropship_pricing_not_configured/.test(m))
    return "Les offres dropshipping ne sont pas encore disponibles en USD.";
  if (/usd_payment_method_not_supported|payment_method_not_available/.test(m))
    return "Ce moyen de paiement n'est pas disponible pour cette commande.";
  if (/variant selection is required/.test(m))
    return "Choisissez une option (taille, couleur…) pour un article avant de commander.";
  if (/selected variant is unavailable|does not use variants/.test(m))
    return "Une option sélectionnée n'est plus disponible. Retirez l'article et rechoisissez depuis la fiche produit.";
  if (/insufficient stock for selected variant/.test(m))
    return "Stock insuffisant pour l'option sélectionnée d'un article.";
  if (/insufficient|insuffisant|not enough|out of stock|rupture/.test(m) && /stock|quant/.test(m))
    return "Stock insuffisant pour un article de votre panier.";
  if (/moq|min_qty|minimum.*(qty|quantit)|quantit.*minimum/.test(m))
    return "La quantité minimale de gros n'est pas atteinte pour un article.";
  if (/wholesale/.test(m) && /(unavailable|not available|no wholesale|indisponible)/.test(m))
    return "Le prix de gros n'est pas disponible pour un article.";
  if (/(product|produit|article).*(unavailable|not active|inactive|not found|introuvable|indisponible)/.test(m))
    return "Un article n'est plus disponible. Retirez-le et réessayez.";
  if (/merchant_plan_fees_exceed_sale_amount/.test(m))
    return "Le prix de cet article est trop bas pour couvrir les frais du plan vendeur. Le vendeur doit ajuster son prix avant que l’article puisse être commandé.";
  if (/payment.?method|mode de paiement/.test(m))
    return "Mode de paiement non pris en charge.";
  if (/delivery.?address|adresse.*(requis|manquant)|address.*required/.test(m))
    return "Une adresse de livraison est requise pour ce mode de livraison.";
  if (/pickup|point de retrait/.test(m))
    return "Le point de retrait sélectionné n'est pas valide.";
  if (/network|fetch failed|timeout/.test(m))
    return "Connexion impossible. Vérifiez votre réseau et réessayez.";
  return "Une erreur est survenue lors de la création de la commande. Réessayez.";
}

function buildLinesOrThrow(cart) {
  if (cartHasMixedCurrencies(cart)) {
    const e = new Error("mixed_currency_cart_not_supported");
    e.userMessage = "Les articles HTG et USD doivent être commandés séparément.";
    throw e;
  }
  if (!cart.length) {
    const e = new Error("empty");
    e.userMessage = "Votre panier est vide.";
    throw e;
  }
  for (const it of cart) {
    if (isDemoProduct(it)) {
      const e = new Error("demo-product");
      e.userMessage = `« ${it.name || "Ce produit"} » est une démonstration visuelle et ne peut pas être commandé.`;
      throw e;
    }
    const pid = it.productId || it.id;
    if (!UUID_RE.test(String(pid || ""))) {
      const e = new Error("bad-line");
      e.userMessage =
        "Un article du panier provient d'une ancienne version. Retirez-le puis rajoutez-le depuis la fiche produit.";
      throw e;
    }
    if (it.pricingTier === "wholesale" && it.moq && it.qty < it.moq) {
      const e = new Error("moq");
      e.userMessage = `« ${it.name} » : quantité minimale de gros de ${it.moq} unités non atteinte.`;
      throw e;
    }
  }
  return toOrderLines(cart);
}

// Panneau sécurisé Hosted Checkout FlexiCash affiché AU-DESSUS de VinHT.
// VinHT n'affiche et ne lit jamais de mot de passe / PIN FlexiCash : le paiement
// se déroule entièrement sur la page hébergée sécurisée de FlexiCash.
function openHostedCheckout(payment, orderId, provider = "flexicash") {
  const url = String(payment?.hosted_checkout_url || payment?.checkout_url || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("not_https");
  } catch {
    showMsg(`Réponse ${provider === "stripe" ? "Stripe" : "FlexiCash"} invalide : URL de paiement absente. Réessayez.`);
    return;
  }
  const returnUrl = `payment.html?order_id=${encodeURIComponent(orderId)}`;
  const providerLabel = provider === "stripe" ? "Stripe" : "FlexiCash";

  document.getElementById("fcHostedOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "fcHostedOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(9,16,40,.55)";
  overlay.innerHTML = `
    <div style="background:#fff;max-width:440px;width:100%;border-radius:16px;padding:24px;box-shadow:0 24px 60px rgba(9,16,40,.28)">
      <div style="display:flex;align-items:center;gap:8px;margin:0 0 6px">
        <i data-lucide="shield-check" style="color:var(--blue,#0b2edc)"></i>
        <h2 style="margin:0;font-size:17px;color:var(--blue,#0b2edc)">Paiement sécurisé ${esc(providerLabel)}</h2>
      </div>
      <p style="margin:0 0 14px;color:var(--muted,#6f7891);font-size:13px">
        Votre commande est enregistrée. Le paiement se fait sur la page sécurisée ${esc(providerLabel)}.
        <strong>VinHT ne collecte jamais vos identifiants de paiement</strong>
        et aucun paiement n'est confirmé tant que le fournisseur ne l'a pas validé.
      </p>
      <a id="fcHostedOpen" class="btn btn-blue" href="${esc(url)}" target="_blank" rel="noopener" style="display:block;text-align:center">Ouvrir le paiement sécurisé ${esc(providerLabel)}</a>
      <a class="btn btn-outline-blue" href="${esc(returnUrl)}" style="display:block;text-align:center;margin-top:10px">J'ai terminé — vérifier mon paiement</a>
      <button type="button" id="fcHostedCancel" class="btn btn-ghost" style="display:block;width:100%;margin-top:10px">Revenir plus tard</button>
    </div>`;
  document.body.appendChild(overlay);
  refreshIcons();

  overlay.querySelector("#fcHostedCancel")?.addEventListener("click", () => {
    overlay.remove();
    window.location.assign(returnUrl);
  });

  // Ouverture automatique de la fenêtre sécurisée (si le navigateur l'autorise).
  try { window.open(url, "_blank", "noopener"); } catch (e) {}
}

// Même principe que FlexiCash : panneau sécurisé MonCash au-dessus de VinHT.
// VinHT n'affiche et ne lit jamais de PIN/mot de passe MonCash ; le paiement
// se déroule entièrement sur l'interface officielle MonCash (Digicel).
function openMoncashHostedCheckout(payment, orderId) {
  const url = String(payment?.checkout_url || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("not_https");
  } catch {
    showMsg("Réponse MonCash invalide : URL de paiement absente. Réessayez.");
    return;
  }
  const returnUrl = `payment.html?order_id=${encodeURIComponent(orderId)}`;

  document.getElementById("fcHostedOverlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "fcHostedOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(9,16,40,.55)";
  overlay.innerHTML = `
    <div style="background:#fff;max-width:440px;width:100%;border-radius:16px;padding:24px;box-shadow:0 24px 60px rgba(9,16,40,.28)">
      <div style="display:flex;align-items:center;gap:8px;margin:0 0 6px">
        <i data-lucide="shield-check" style="color:var(--red,#e21d3c)"></i>
        <h2 style="margin:0;font-size:17px;color:var(--red,#e21d3c)">Paiement sécurisé MonCash</h2>
      </div>
      <p style="margin:0 0 14px;color:var(--muted,#6f7891);font-size:13px">
        Votre commande est enregistrée. Le paiement se fait sur l'interface officielle MonCash
        (connexion + code secret MonCash). <strong>VinHT ne voit jamais votre mot de passe ni votre code MonCash</strong>
        et aucun paiement n'est confirmé tant que MonCash ne l'a pas validé.
      </p>
      <a id="fcHostedOpen" class="btn btn-blue" href="${esc(url)}" target="_blank" rel="noopener" style="display:block;text-align:center">Ouvrir le paiement sécurisé MonCash</a>
      <a class="btn btn-outline-blue" href="${esc(returnUrl)}" style="display:block;text-align:center;margin-top:10px">J'ai terminé — vérifier mon paiement</a>
      <button type="button" id="fcHostedCancel" class="btn btn-ghost" style="display:block;width:100%;margin-top:10px">Revenir plus tard</button>
    </div>`;
  document.body.appendChild(overlay);
  refreshIcons();

  overlay.querySelector("#fcHostedCancel")?.addEventListener("click", () => {
    overlay.remove();
    window.location.assign(returnUrl);
  });

  try { window.open(url, "_blank", "noopener"); } catch (e) {}
}

// Réessai depuis l'écran de succès (commande créée mais démarrage du paiement
// en échec) — commun à FlexiCash et MonCash, jamais de nouvelle commande créée.
function bindPaymentRetry(box, orderId, provider) {
  const retry = box?.querySelector("[data-retry-payment]");
  const msg = box?.querySelector("[data-payment-retry-msg]");
  if (!retry) return;
  const providerLabel = provider === "moncash" ? "MonCash" : provider === "stripe" ? "Stripe" : "FlexiCash";

  retry.addEventListener("click", async () => {
    if (retry.dataset.loading === "1") return;
    retry.dataset.loading = "1";
    retry.disabled = true;
    const original = retry.textContent;
    retry.textContent = `Ouverture de ${providerLabel}…`;
    if (msg) msg.textContent = "";
    try {
      const session = await getActiveSession();
      if (!session) {
        if (msg) msg.textContent = "Reconnectez-vous puis réessayez le paiement.";
        openAuthModal("login");
        return;
      }
      if (provider === "moncash") {
        const payment = await createMoncashPayment(orderId, session);
        openMoncashHostedCheckout(payment, orderId);
      } else {
        const payment = await createPlatformPayment(orderId, session);
        openHostedCheckout(payment, orderId, provider);
      }
    } catch (error) {
      console.warn(`[VinHT] ${providerLabel} retry:`, error && (error.message || error));
      if (msg) msg.textContent = error?.message || `Impossible de démarrer ${providerLabel}. Réessayez.`;
    } finally {
      retry.dataset.loading = "0";
      retry.disabled = false;
      retry.textContent = original || `Réessayer le paiement ${providerLabel}`;
    }
  });
}

function renderSuccess(data, options = {}) {
  // create_marketplace_order RETURNS jsonb -> un SEUL objet JSON.
  // Clés confirmées : order_id, subtotal_htg, payment_discount_htg, shipping_htg,
  // total_htg, payment_method, payment_status, status.
  const d = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const val = (v) => (v === null || v === undefined || v === "" ? "—" : v);
  const currency = String(d.currency || "HTG").toUpperCase();
  const amountValue = (generic, legacy) => d?.[generic] ?? d?.[legacy];
  const amt = (v) => (v === null || v === undefined || v === "" ? "—" : money(Number(v), currency));

  const box = $("#orderResult");
  const grid = $(".checkout-grid");
  if (!box) return;

  // paymentError: { provider: "flexicash" | "moncash", message } — la commande
  // est déjà créée, seul le démarrage du paiement a échoué. On ne recrée
  // jamais de commande : le bouton "Réessayer" relance uniquement le paiement.
  const paymentError = options.paymentError || null;
  const providerLabel = paymentError?.provider === "moncash" ? "MonCash" : paymentError?.provider === "stripe" ? "Stripe" : "FlexiCash";
  const paymentIntro = paymentError
    ? `<p style="margin:0 0 16px;color:var(--muted,#6f7891);font-size:13px">La commande est enregistrée, mais le paiement ${esc(providerLabel)} n'a pas démarré. <strong>Aucun paiement n'a été prélevé.</strong> Réessayez sans recréer la commande.</p>`
    : `<p style="margin:0 0 16px;color:var(--muted,#6f7891);font-size:13px">Paiement <strong>en attente</strong> — aucun paiement n'a encore été prélevé.</p>`;
  const retryBlock = paymentError
    ? `<div class="error-state" style="margin-top:12px">${esc(paymentError.message)}</div><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-blue" type="button" data-retry-payment>Réessayer le paiement ${esc(providerLabel)}</button><span data-payment-retry-msg style="align-self:center;color:var(--muted,#6f7891);font-size:12px"></span></div>`
    : "";

  box.innerHTML = `
    <h2 style="margin:0 0 4px;color:var(--blue,#0b2edc)">Commande créée ✓</h2>
    ${paymentIntro}
    <div class="sum-row"><span>N° de commande</span><strong>${esc(val(d.order_id))}</strong></div>
    <div class="sum-row"><span>Sous-total</span><strong>${amt(amountValue("subtotal_amount", "subtotal_htg"))}</strong></div>
    <div class="sum-row"><span>Rabais paiement</span><strong class="green">${
      Number(amountValue("payment_discount_amount", "payment_discount_htg")) ? "- " + amt(amountValue("payment_discount_amount", "payment_discount_htg")) : amt(amountValue("payment_discount_amount", "payment_discount_htg"))
    }</strong></div>
    <div class="sum-row"><span>Livraison</span><strong>${amt(amountValue("shipping_amount", "shipping_htg"))}</strong></div>
    <div class="sum-row sum-total"><span>Total</span><strong>${amt(amountValue("total_amount", "total_htg"))}</strong></div>
    <div class="sum-row"><span>Paiement</span><strong>${esc(val(d.payment_method))} — ${esc(val(d.payment_status))}</strong></div>
    <div class="sum-row"><span>Statut commande</span><strong>${esc(val(d.status))}</strong></div>
    ${retryBlock}
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
      <a class="btn btn-blue" href="account.html">Voir mes commandes</a>
      <a class="btn btn-outline-blue" href="index.html">Continuer mes achats</a>
    </div>
  `;
  box.style.display = "";
  if (grid) grid.style.display = "none";
  if (paymentError && d.order_id) bindPaymentRetry(box, d.order_id, paymentError.provider);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleSubmit() {
  // Verrou synchrone : posé AVANT tout `await` pour qu'un double-clic rapide
  // (pendant getActiveSession) ne puisse pas lancer deux create_marketplace_order.
  if (submitting) return;
  submitting = true;
  const btn = $("#placeOrderBtn");
  const label = btn ? btn.querySelector("[data-btn-label]") : null;
  const originalLabel = label ? label.textContent : "";
  if (btn) btn.disabled = true;
  try {
  clearMsg();

  const cart = getCart();

  if (!isSupabaseConfigured()) {
    showMsg("Service indisponible : configuration manquante.");
    return;
  }

  let lines;
  try {
    lines = buildLinesOrThrow(cart);
  } catch (e) {
    showMsg(e.userMessage || "Panier invalide.");
    return;
  }

  const session = await getActiveSession();
  if (!session) {
    showMsg("Connectez-vous pour passer votre commande.");
    openAuthModal("login");
    return;
  }

  const deliveryType = selectedDelivery();
  const paymentMethod = selectedPayment();

  if (!paymentMethod) {
    showMsg("Choisissez un mode de paiement.");
    return;
  }
  if (!deliveryType) {
    showMsg("Choisissez un mode de livraison.");
    return;
  }
  const fullName = ($("#custFullName")?.value || "").trim();
  const phone = ($("#custPhone")?.value || "").trim();
  const email = ($("#custEmail")?.value || "").trim();
  const department = ($("#custDepartment")?.value || "").trim();
  const commune = ($("#custCity")?.value || "").trim();
  const address_line1 = ($("#custAddress")?.value || "").trim();
  const address_line2 = ($("#custAddressLine2")?.value || "").trim();
  const landmark = ($("#custLandmark")?.value || "").trim();
  const notes = ($("#custNotes")?.value || "").trim();

  if (!fullName) {
    showMsg("Votre nom complet est requis.");
    $("#custFullName")?.focus();
    return;
  }
  if (!phone) {
    showMsg("Votre numéro de téléphone est requis.");
    $("#custPhone")?.focus();
    return;
  }

  let deliveryAddress = {};
  if (deliveryType === "home" || deliveryType === "custom_location") {
    const candidate = { address_line1, address_line2, commune, department, landmark };
    const { valid, errors } = validateStandardAddress(candidate);
    if (!valid) {
      // Un seul message à la fois, dans l'ordre des champs du formulaire —
      // jamais une erreur technique brute affichée à l'utilisateur.
      if (errors.address_line1) { showMsg(errors.address_line1); $("#custAddress")?.focus(); return; }
      if (errors.department) { showMsg(errors.department); $("#custDepartment")?.focus(); return; }
      if (errors.commune) { showMsg(errors.commune); $("#custCity")?.focus(); return; }
      if (errors.coordinates) { showMsg(errors.coordinates); return; }
      showMsg("Adresse de livraison incomplète.");
      return;
    }
    // Payload structuré uniquement — jamais une chaîne concaténée seule.
    // `address`/`city` sont conservés en plus des clés structurées pour la
    // compatibilité avec le backend actuel et toute lecture legacy en aval.
    deliveryAddress = {
      ...canonicalAddressPayload(candidate),
      address: address_line1,
      city: commune,
      country_code: "HT",
    };
  }
  const pickupPointCode=deliveryType==="vinht_pickup"?selectedPickupPointCode():null;
  if(deliveryType==="vinht_pickup"&&!pickupPointCode){
    showMsg("Choisissez un point de retrait VinHT disponible.");
    return;
  }

  const payload = {
    items: lines, // { product_id, quantity, pricing_tier } uniquement
    fullName,
    phone,
    email: email || null,
    paymentMethod,
    deliveryType,
    deliveryAddress,
    pickupPointCode,
    deliveryNotes: notes || null,
  };

  // Le label est un <span> dédié à côté de l'icône <i data-lucide="lock">,
  // pour ne jamais écraser l'icône avec un textContent de secours.
  if (label) label.textContent = "Envoi de la commande…";

  try {
    // create_marketplace_order_with_promotions_v1 : chemin autoritaire unique,
    // même avec un tableau de codes vide — c'est par lui que les futures
    // promotions automatiques seront appliquées. Le quote préalable n'est
    // qu'une estimation : le serveur revalide tout (limites, expiration,
    // éligibilité) à la création réelle.
    const data = await createMarketplaceOrderWithPromotions({ ...payload, promotionCodes: _appliedCodes });
    // Succès serveur uniquement -> on vide le panier local APRÈS la création atomique de commande.
    setCart([]);
    updateCartCount();
    // Attribution Sponsored Products (#29) : la commande reste un succès même
    // si ce lien échoue (voir analyticsSession.js — fail-open par construction).
    linkOrderAnalyticsSession(data.order_id);

    if (paymentMethod === "flexicash" || paymentMethod === "stripe") {
      const providerLabel = paymentMethod === "stripe" ? "Stripe" : "FlexiCash";
      if (label) label.textContent = `Ouverture de ${providerLabel}…`;
      try {
        const payment = await createPlatformPayment(data.order_id, session);
        openHostedCheckout(payment, data.order_id, paymentMethod);
        return;
      } catch (err) {
        console.warn(`[VinHT] ${providerLabel}:`, err && (err.message || err));
        renderSuccess(data, {
          paymentError: { provider: paymentMethod, message: err?.message || `Impossible de démarrer le paiement ${providerLabel}. Réessayez.` },
        });
        return;
      }
    }

    if (paymentMethod === "moncash") {
      // Même contrat que FlexiCash : le navigateur n'envoie QUE order_id, le
      // backend construit le checkout_url MonCash officiel serveur->serveur.
      if (label) label.textContent = "Ouverture de MonCash…";
      try {
        const payment = await createMoncashPayment(data.order_id, session);
        openMoncashHostedCheckout(payment, data.order_id);
        return;
      } catch (err) {
        console.warn("[VinHT] MonCash:", err && (err.message || err));
        renderSuccess(data, {
          paymentError: { provider: "moncash", message: err?.message || "Impossible de démarrer le paiement MonCash. Réessayez." },
        });
        return;
      }
    }

    renderSuccess(data);
  } catch (err) {
    console.warn("[VinHT] commande:", err && (err.message || err));
    showMsg(mapOrderError(err));
  }
  } finally {
    // Libère le verrou quel que soit le chemin (retours de validation compris).
    submitting = false;
    if (btn) btn.disabled = false;
    if (label && ["Envoi de la commande…", "Ouverture de FlexiCash…", "Ouverture de Stripe…", "Ouverture de MonCash…"].includes(label.textContent)) {
      label.textContent = originalLabel || "Passer la commande";
    }
  }
}

// Lecture tolérante : `addr` peut venir de l'ancien carnet local (juste
// `address`/`city`) ou d'une adresse déjà migrée vers la forme structurée
// (`address_line1`/`address_line2`/`commune`/`department`/`landmark`).
function prefillAddressFields(addr) {
  if (!addr) return;
  const address = $("#custAddress"), address2 = $("#custAddressLine2"), landmark = $("#custLandmark");
  const city = $("#custCity"), department = $("#custDepartment");
  const line1 = addr.address_line1 || addr.address || "";
  if (address && !address.value) address.value = line1;
  if (address2 && !address2.value && addr.address_line2) address2.value = addr.address_line2;
  if (landmark && !landmark.value && addr.landmark) landmark.value = addr.landmark;
  const commune = addr.commune || addr.city || "";
  if (city && !city.value && commune) city.value = commune;
  const dept = addr.department || addr.departement || "";
  if (department && !department.value && dept && [...department.options].some((o) => o.value === dept)) department.value = dept;
}

async function prefillCheckoutIdentity() {
  const addr = getDefaultAddress();
  try {
    const profile = await getMyProfile();
    const name = $("#custFullName"), phone = $("#custPhone"), email = $("#custEmail");
    if (name && !name.value) name.value = addr?.fullName || profile?.full_name || "";
    if (phone && !phone.value) phone.value = addr?.phone || profile?.phone || "";
    if (email && !email.value) email.value = profile?.email || "";
    prefillAddressFields({ address_line1: addr?.address || profile?.address, ...addr });
    const notes = $("#custNotes");
    if (notes && !notes.value && addr?.notes) notes.value = addr.notes;
  } catch {
    if (!addr) return;
    const name = $("#custFullName"), phone = $("#custPhone"), notes = $("#custNotes");
    if (name && !name.value) name.value = addr.fullName || "";
    if (phone && !phone.value) phone.value = addr.phone || "";
    prefillAddressFields(addr);
    if (notes && !notes.value) notes.value = addr.notes || "";
  }
}

export function initCheckout() {
  const btn = $("#placeOrderBtn");
  if (!btn) return;
  if (getCart().some(isDemoProduct)) {
    btn.disabled = true;
    showMsg("Ce panier contient un produit de démonstration. Retirez-le avant de créer une commande réelle.");
    return;
  }
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    handleSubmit();
  });
  prefillCheckoutIdentity();
  loadDeliveryOptions();
  loadPaymentOptions();
  initPromoCodeUI(); // Feature #28 — promotions HTG uniquement pour l'instant
  attachGeoHints(document); // suggestions de commune (zones actives) — jamais une liste fermée
}
