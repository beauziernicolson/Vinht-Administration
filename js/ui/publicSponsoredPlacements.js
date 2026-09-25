// Feature #29 — Sponsored Products publics pour home/search/category.
// Aucun ranking client : les rows restent dans l'ordre exact du backend.

import { getSponsoredProductSlots, recordSponsoredProductImpression } from "../services/ads.js";
import { getCategories, productImageUrl } from "../services/catalog.js";
import { money } from "../lib/format.js";

const seenImpressions = new Set();

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function ensureStyle() {
  if (document.getElementById("vinhtSponsoredStyle")) return;
  const style = document.createElement("style");
  style.id = "vinhtSponsoredStyle";
  style.textContent = `
    .vinht-sponsored-section{margin:24px 0;padding:18px;border:1px solid var(--line,#e7eaf2);border-radius:18px;background:#fff}
    .vinht-sponsored-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .vinht-sponsored-heading h2{margin:0;font-size:18px}.vinht-sponsored-heading span{font-size:11px;font-weight:800;color:var(--muted,#6f7891)}
    .vinht-sponsored-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
    .vinht-sponsored-card{border:1px solid var(--line,#e7eaf2);border-radius:14px;overflow:hidden;background:#fff;position:relative}
    .vinht-sponsored-card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#f5f6fa}
    .vinht-sponsored-card-body{padding:10px}.vinht-sponsored-card-body a{font-weight:800;color:inherit;text-decoration:none}.vinht-sponsored-card-body small{display:block;color:var(--muted,#6f7891);margin:4px 0}.vinht-sponsored-price{font-weight:900;margin-top:6px}
    .vinht-sponsored-label{position:absolute;z-index:2;top:8px;left:8px;background:#151515;color:#fff;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:800}
    @media(max-width:800px){.vinht-sponsored-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function productHref(row) {
  if (row?.product_slug) return `product.html?slug=${encodeURIComponent(row.product_slug)}`;
  return row?.product_id ? `product.html?id=${encodeURIComponent(row.product_id)}` : "#";
}

function cardHtml(row, placement) {
  const href = productHref(row);
  const storagePath = row?.product_image_path || "";
  const image = productImageUrl(storagePath) || "assets/abstract-brand.jpg";
  return `<article class="vinht-sponsored-card" data-sponsored-campaign="${esc(row.campaign_id)}" data-sponsored-placement="${esc(placement)}">
    <span class="vinht-sponsored-label">Sponsorisé</span>
    <a href="${esc(href)}" data-sponsored-link="${esc(row.campaign_id)}"><img src="${esc(image)}" data-sponsored-storage-path="${esc(storagePath)}" alt="${esc(row.product_name || "")}" loading="lazy" decoding="async"></a>
    <div class="vinht-sponsored-card-body"><a href="${esc(href)}" data-sponsored-link="${esc(row.campaign_id)}">${esc(row.product_name || "Produit")}</a><small>${esc(row.shop_name || "Marchand VinHT")}</small><div class="vinht-sponsored-price">${row.retail_price_htg != null ? money(row.retail_price_htg) : ""}</div></div>
  </article>`;
}

function observeImpressions(section, placement, context) {
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const card = entry.target;
      const campaignId = card.dataset.sponsoredCampaign;
      const key = `${placement}:${campaignId}`;
      if (!campaignId || seenImpressions.has(key)) { observer.unobserve(card); continue; }
      seenImpressions.add(key);
      recordSponsoredProductImpression({ campaignId, placement, context });
      observer.unobserve(card);
    }
  }, { threshold: [0.5] });
  section.querySelectorAll("[data-sponsored-campaign]").forEach((card) => observer.observe(card));
}

async function mountPlacement({ placement, anchor, search = null, categoryId = null, limit = 4 }) {
  if (!anchor || document.querySelector(`[data-sponsored-section="${placement}"]`)) return;
  let result;
  try {
    result = await getSponsoredProductSlots({ placement, search, categoryId, limit });
  } catch (err) {
    console.warn(`[VinHT] sponsored ${placement}:`, err && err.message);
    return;
  }
  if (!result?.enabled || !Array.isArray(result.rows) || !result.rows.length) return;
  ensureStyle();
  const section = document.createElement("section");
  section.className = "vinht-sponsored-section";
  section.dataset.sponsoredSection = placement;
  section.innerHTML = `<div class="vinht-sponsored-heading"><h2>Produits sponsorisés</h2><span>Publicité</span></div><div class="vinht-sponsored-grid">${result.rows.map((row) => cardHtml(row, placement)).join("")}</div>`;
  anchor.insertAdjacentElement("beforebegin", section);
  observeImpressions(section, placement, { search: search || null, category_id: categoryId || null, source_path: location.pathname });
}

async function resolveCategoryId(slug) {
  if (!slug) return null;
  try {
    const categories = await getCategories();
    return categories.find((c) => String(c.slug || "") === slug)?.id || null;
  } catch (err) {
    console.warn("[VinHT] résolution catégorie sponsorisée:", err && err.message);
    return null;
  }
}

export async function initPublicSponsoredPlacements() {
  const homeGrid = document.querySelector("[data-home-product-grid]");
  if (homeGrid) {
    await mountPlacement({ placement: "home", anchor: homeGrid, limit: 4 });
    return;
  }

  const catalogHost = document.querySelector("#v11CatalogApp");
  if (!catalogHost) return;
  const params = new URLSearchParams(location.search);
  const search = (params.get("q") || "").trim();
  const categorySlug = (params.get("category") || "").trim();
  const categoryId = await resolveCategoryId(categorySlug);

  if (search) {
    await mountPlacement({ placement: "search", anchor: catalogHost, search, categoryId, limit: 4 });
    return;
  }
  if (categoryId) {
    await mountPlacement({ placement: "category", anchor: catalogHost, categoryId, limit: 4 });
  }
}
