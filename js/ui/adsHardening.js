// Feature #29 — hardening transversal du frontend Ads.
// Corrige uniquement des écarts de présentation/intégration ; le backend reste
// la source de vérité pour CTR, éligibilité, budgets, funding et transitions.

import { getMyMerchant, getMyProducts } from "../services/merchantCenter.js";
import { productImageUrl } from "../services/catalog.js";
import { recordSponsoredProductClick } from "../services/ads.js";

let initialized = false;
let productPickerLoading = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixDashboardCtr() {
  const host = document.querySelector("#adsDetailHost");
  if (!host) return;
  host.querySelectorAll(".settings-section").forEach((row) => {
    const label = row.querySelector("div > strong")?.textContent?.trim();
    const value = row.querySelector(":scope > strong");
    if (label !== "CTR" || !value || value.dataset.ctrBackendPercent === "1") return;
    const raw = String(value.textContent || "").replace("%", "").trim().replace(",", ".");
    const displayed = Number(raw);
    if (!Number.isFinite(displayed)) return;
    value.textContent = `${(displayed / 100).toFixed(2)}%`;
    value.dataset.ctrBackendPercent = "1";
  });
}

function fixSponsoredImages() {
  document.querySelectorAll("[data-sponsored-campaign] img").forEach((img) => {
    if (img.dataset.sponsoredImageResolved === "1") return;
    const raw = img.getAttribute("data-sponsored-storage-path") || img.getAttribute("src") || "";
    if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("assets/") || raw.startsWith("/assets/")) {
      img.dataset.sponsoredImageResolved = "1";
      return;
    }
    const url = productImageUrl(raw);
    if (url) img.src = url;
    img.dataset.sponsoredImageResolved = "1";
  });
}

async function loadMerchantProductPicker(input) {
  if (!input || productPickerLoading || input.dataset.adsPickerReady === "1") return;
  productPickerLoading = true;
  const field = input.closest(".field") || input.parentElement;
  const label = field?.querySelector("label");
  if (label) label.textContent = "Produit à sponsoriser";

  const select = document.createElement("select");
  select.className = input.className || "input";
  select.name = "product_id";
  select.required = true;
  select.disabled = true;
  select.dataset.adsPickerReady = "1";
  select.innerHTML = '<option value="">Chargement de vos produits…</option>';
  input.replaceWith(select);

  let status = field?.querySelector("[data-ads-product-picker-status]");
  if (!status) {
    status = document.createElement("div");
    status.dataset.adsProductPickerStatus = "";
    status.className = "muted";
    status.style.fontSize = "11px";
    field?.appendChild(status);
  }

  try {
    const merchant = await getMyMerchant();
    if (!merchant?.id) throw new Error("merchant_not_found");
    const products = await getMyProducts(merchant.id);
    const eligible = (Array.isArray(products) ? products : []).filter((p) => p?.is_active === true && p?.approval_status === "approved");
    select.innerHTML = '<option value="">Choisir un produit…</option>' + eligible.map((p) => `<option value="${String(p.id).replace(/"/g, "&quot;")}">${String(p.name || "Produit")}</option>`).join("");
    select.disabled = eligible.length === 0;
    status.textContent = eligible.length ? "Seuls vos produits actifs et approuvés sont proposés." : "Aucun produit actif et approuvé n'est disponible pour une campagne.";
  } catch (err) {
    select.innerHTML = '<option value="">Produits indisponibles</option>';
    select.disabled = true;
    status.innerHTML = 'Impossible de charger vos produits. <button class="btn btn-ghost btn-sm" type="button" data-ads-product-retry>Réessayer</button>';
    status.querySelector("[data-ads-product-retry]")?.addEventListener("click", () => {
      select.dataset.adsPickerReady = "";
      loadMerchantProductPicker(select);
    }, { once: true });
  } finally {
    productPickerLoading = false;
  }
}

function ensureMerchantProductPicker() {
  if (document.body?.dataset?.merchantPage !== "ads") return;
  const input = document.querySelector('#adsCreateForm input[name="product_id"]');
  if (input) loadMerchantProductPicker(input);
}

async function handleSponsoredNavigation(event) {
  const link = event.target?.closest?.("a[data-sponsored-link]");
  if (!link) return;
  const href = link.href;
  if (!href) return;
  const card = link.closest("[data-sponsored-campaign]");
  const campaignId = link.dataset.sponsoredLink || card?.dataset?.sponsoredCampaign;
  if (!campaignId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const placement = card?.dataset?.sponsoredPlacement || "product_page";
  try {
    await Promise.race([
      recordSponsoredProductClick({
        campaignId,
        placement,
        context: { source_path: location.pathname, source_query: location.search },
      }),
      sleep(450),
    ]);
  } catch {}
  location.href = href;
}

export function initAdsHardening() {
  if (initialized) return;
  initialized = true;
  document.addEventListener("click", handleSponsoredNavigation, true);
  const apply = () => {
    fixDashboardCtr();
    fixSponsoredImages();
    ensureMerchantProductPicker();
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
