// Point d'entrée unique, chargé sur les pages VinHT.
// Détection par capacité : chaque init ne fait rien si sa cible est absente.

import { updateCartCount, maybeSeedCart } from "./services/cart.js";
import { initAddButtons } from "./pages/catalog.js?v=20260918a";
import { initOptions, initQty, renderCart, initCheckout } from "./pages/checkout.js?v=20260920b";
import { initHome } from "./pages/home.js?v=20260918a";
import { initProduct } from "./pages/product.js?v=20260920live";
import { initAccountPage } from "./pages/account.js?v=20260921-align-v1";
import { initMerchant } from "./pages/merchant.js?v=20260920-launch-qa2";
import { initMerchantCenter } from "./pages/merchantCenter.js?v=20260922-mega-a-v1";
import { initAccount } from "./ui/account.js?v=20260921-align-v1";
import { refreshIcons } from "./lib/icons.js";
import { initShell } from "./ui/shell.js";
import { initMobileHeader } from "./ui/mobileHeader.js";
import { initCartDrawer } from "./ui/cartDrawer.js?v=20260918a";
import { initMerchantFeatureNav } from "./ui/merchantFeatureNav.js?v=20260910b";
import { initPromotionHardening } from "./ui/promotionHardening.js";
import { initAdsHardening } from "./ui/adsHardening.js";
import { initPublicSponsoredPlacements } from "./ui/publicSponsoredPlacements.js";
import { flushPendingOrderAnalyticsLink } from "./services/analyticsSession.js";
import { initClientPortal } from "./pages/clientPortal.js?v=20260921-align-v1";
import { initClientOrderDeliveryUx } from "./pages/clientOrderDeliveryUx.js?v=20260922-mega-a-v1";
import { initPaymentResult } from "./pages/payment.js?v=20260918b";
import { initMerchantPortal } from "./pages/merchantPortal.js?v=20260921-align-v2";
import { initMerchantOnboarding } from "./pages/merchantOnboarding.js?v=20260920-launch-qa2";
import { initAgentCenter } from "./pages/agentCenter.js?v=20260921-align-v1";
import { initAgentCurrencyUx } from "./pages/agentCurrencyUx.js?v=20260923-currency-v1";
import { initMerchantActivate } from "./pages/merchantActivate.js?v=20260920-launch-qa2";
import { initCourierPortal } from "./pages/courierPortal.js?v=20260921-align-v1";
import { initCourierStatusFrUx } from "./pages/courierStatusFrUx.js?v=20260917a";
import { initAdminPortal } from "./pages/adminPortal.js?v=20260922-mega-a-v1";
import { initAdminOwnershipEnhancements } from "./pages/adminOwnershipEnhancements.js?v=20260923-owner-v1";
import { initAdminOwnershipA11y } from "./pages/adminOwnershipA11y.js?v=20260923-owner-a11y-v1";
import { initAdminAssistedOwnership } from "./pages/adminAssistedOwnership.js?v=20260923-owner-v1";
import { initAdminCourierAvailabilityOwnership } from "./pages/adminCourierAvailabilityOwnership.js?v=20260923-owner-v1";
import { getMyRoles } from "./services/profile.js";
import { initPublicPortal } from "./pages/publicPortal.js?v=20260918a";
import { syncFlexicashIdentityIfPending, showFlexicashSyncNotice, renderFlexicashLinkCard, handleFlexicashPopupCallbackIfNeeded } from "./services/flexicashIdentity.js";

async function boot() {
  // FlexiCash OAuth Identity — cette fenêtre peut être la popup OAuth
  // FlexiCash plutôt qu'un onglet VinHT normal : dans ce cas, on ne rend
  // RIEN de l'app, on traite juste le retour OAuth puis on se referme. Doit
  // rester le tout premier check du boot.
  if (await handleFlexicashPopupCallbackIfNeeded()) return;

  initMobileHeader();
  await initShell().catch((err) => console.warn("[VinHT] shell:", err));
  initMerchantFeatureNav();
  initPromotionHardening();
  initAdsHardening();

  flushPendingOrderAnalyticsLink().catch((err) => console.warn("[VinHT] reprise analytics commande:", err));

  // FlexiCash OAuth Identity — au retour d'un login/liaison FlexiCash (custom:flexicash),
  // synchronise l'identité une seule fois (fail-safe, ne bloque jamais le
  // reste du boot). Le flag "en attente" est posé par signInWithFlexiCash()
  // avant la redirection et n'existe donc que sur le vrai retour OAuth.
  syncFlexicashIdentityIfPending()
    .then((result) => {
      if (!result) return;
      if (result.success) showFlexicashSyncNotice("Compte FlexiCash connecté à VinHT ✓", "green");
      else showFlexicashSyncNotice(result.message, "red");
    })
    .catch((err) => console.warn("[VinHT] sync identité FlexiCash:", err && err.message));

  maybeSeedCart();
  updateCartCount();
  initCartDrawer();
  initAddButtons();
  initOptions();
  initQty();
  renderCart();
  initCheckout();
  initHome();
  initProduct();
  initMerchant();
  initMerchantCenter();
  initAccountPage().catch((err) => console.warn("[VinHT] init page compte:", err));
  initClientPortal().catch((err) => console.warn("[VinHT] portail client:", err));
  initClientOrderDeliveryUx();
  initPaymentResult();
  initMerchantPortal().catch((err) => console.warn("[VinHT] portail marchand:", err));
  initMerchantOnboarding().catch((err) => console.warn("[VinHT] parcours marchand:", err));
  initAgentCenter().catch((err) => console.warn("[VinHT] centre agent:", err));
  initAgentCurrencyUx();
  initMerchantActivate().catch((err) => console.warn("[VinHT] activation marchand assisté:", err));
  initCourierPortal().catch((err) => console.warn("[VinHT] espace livreur:", err));
  initCourierStatusFrUx();
  initAdminPortal().catch((err) => console.warn("[VinHT] portail admin:", err));
  const isAdminSurface = !!document.body?.dataset?.adminPage || String(location.pathname || "").includes("/admin/");
  if (isAdminSurface) {
    const adminRoles = await getMyRoles().catch(() => []);
    if (adminRoles.includes("admin")) {
      initAdminOwnershipEnhancements();
      initAdminOwnershipA11y();
      initAdminAssistedOwnership();
      initAdminCourierAvailabilityOwnership();
    }
  }
  initPublicPortal().catch((err) => console.warn("[VinHT] portail public:", err));
  initPublicSponsoredPlacements().catch((err) => console.warn("[VinHT] placements sponsorisés:", err));

  initAccount().catch((err) => console.warn("[VinHT] init compte:", err));

  // FlexiCash OAuth Identity — carte "Lier mon compte FlexiCash" (paramètres uniquement,
  // ne fait rien sur les pages qui n'ont pas cet élément).
  const flexicashLinkHost = document.getElementById("flexicashLinkHost");
  if (flexicashLinkHost) renderFlexicashLinkCard(flexicashLinkHost).catch((err) => console.warn("[VinHT] carte FlexiCash:", err));

  refreshIcons();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
