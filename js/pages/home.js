// Rendu dynamique de la Home (index.html) — catalogue live Supabase.
//
//   #categoryGrid          -> 7 catégories live
//   #productGrid           -> featured + produits live (fixtures réelles)
//   #catalogCategorySelect -> options + filtre par catégorie
//   #catalogSearchInput/Btn-> recherche name/tagline/description/search_keywords
//
// 4 états par section : loading / ready / empty / error.
// CSS injecté ici, préfixé .vh-cat-* : styles.css n'est pas modifié.

import { $ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { addToCart } from "../services/cart.js";
import { showToast } from "../ui/toast.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { getMyWishlistProductIds } from "../services/wishlist.js";
import { paintHeart, handleHeartClick } from "../ui/wishlist.js";
import { refreshIcons } from "../lib/icons.js";
import { saveSearch } from "../services/savedSearches.js";
import {
  getCategories,
  getProducts,
  getFeaturedProducts,
  productImageUrl,
  isSupabaseConfigured,
} from "../services/catalog.js";

const PLACEHOLDER_IMG = "assets/abstract-brand.jpg";

// Icône Lucide décorative par slug (categories.icon est null en base). UX, pas donnée.
const CATEGORY_ICON = {
  "maison-bureau": "house",
  electronique: "laptop",
  "mode-beaute": "shirt",
  alimentation: "carrot",
  "bebe-enfant": "baby",
  sante: "heart-pulse",
  "auto-moto": "car",
};
const ICON_FALLBACK = "shapes";

let currentCategoryId = "";
let currentSort = "default";
let wishlistIds = new Set(); // ids réels chargés depuis wishlist_items (session courante)
const ALLOWED_SORTS = ["default", "price_asc", "price_desc", "newest"];

const STYLE_ID = "vh-cat-css";
const CSS = `
.vh-cat-shine{background:linear-gradient(90deg,#f1f1f2 25%,#fafafa 37%,#f1f1f2 63%);background-size:400% 100%;animation:vh-cat-pulse 1.4s ease infinite}
@keyframes vh-cat-pulse{0%{background-position:100% 0}100%{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.vh-cat-shine{animation:none}}
.vh-cat-skel-cat{height:88px;border:1px solid var(--line,#e8e8eb);border-radius:6px}
.vh-cat-skel-prod{aspect-ratio:1/1.15;background:#f5f5f6}
.vh-cat-state{grid-column:1/-1;text-align:center;padding:44px 22px;border:1px solid var(--line,#e8e8eb);background:#fff}
.vh-cat-state h3{margin:0 0 5px;font-size:14px;color:var(--ink,#202020)}
.vh-cat-state p{margin:0 auto;max-width:420px;color:var(--muted,#71717a);font-size:10px;line-height:1.5}
.vh-cat-retry{margin-top:14px;border:1px solid #151515;border-radius:4px;padding:9px 16px;font-weight:800;cursor:pointer;background:#151515;color:#fff;font:inherit;font-size:11px}
.product-card .add[disabled]{opacity:.45;cursor:default}
`

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function stateBlock(kind, { title, text, retry } = {}) {
  const h = title ? `<h3>${esc(title)}</h3>` : "";
  const p = text ? `<p>${text}</p>` : "";
  const b =
    kind === "error" && retry
      ? `<button class="vh-cat-retry" type="button" data-retry="${esc(retry)}">Réessayer</button>`
      : "";
  return `<div class="vh-cat-state" role="status">${h}${p}${b}</div>`;
}

function skeleton(kind, n) {
  const cls = kind === "cat" ? "vh-cat-skel-cat" : "vh-cat-skel-prod";
  return Array.from({ length: n }, () => `<div class="${cls} vh-cat-shine"></div>`).join("");
}

// --- Catégories ---------------------------------------------------------
function renderCategoryCard(c) {
  const iconName = CATEGORY_ICON[c.slug] || ICON_FALLBACK;
  return `<div class="category-card" role="button" tabindex="0" data-category-id="${esc(c.id)}" data-category-slug="${esc(c.slug)}">
    <div class="category-icon" aria-hidden="true"><i data-lucide="${iconName}"></i></div><span>${esc(c.name)}</span>
  </div>`;
}

function populateCategorySelect(cats) {
  const sel = $("#catalogCategorySelect");
  if (!sel) return;
  const keep = sel.querySelector("option");
  sel.innerHTML = "";
  if (keep) {
    keep.value = "";
    sel.appendChild(keep);
  }
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
  sel.value = currentCategoryId || "";
}

async function loadCategories() {
  const host = $("#categoryGrid");
  if (!host) return;
  host.innerHTML = skeleton("cat", 7);
  try {
    const cats = await getCategories();
    if (!cats.length) {
      host.innerHTML = stateBlock("empty", { text: "Aucune catégorie disponible pour le moment." });
      return;
    }
    host.innerHTML = cats.map(renderCategoryCard).join("");
    populateCategorySelect(cats);
    refreshIcons();
  } catch (e) {
    console.warn("[VinHT] catégories:", e && e.message);
    host.innerHTML = stateBlock("error", {
      text: "Impossible de charger les catégories.",
      retry: "categories",
    });
  }
}

// --- Produits ---------------------------------------------------------
function normalizeProduct(row) {
  if (!row || typeof row !== "object") return null;
  const m = row.merchants || null;
  const imgs = Array.isArray(row.product_images) ? row.product_images.slice() : [];
  imgs.sort((a, b) => {
    const pa = a && a.is_primary ? 0 : 1;
    const pb = b && b.is_primary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a?.position ?? 999) - (b?.position ?? 999);
  });
  const primary = imgs[0] || null;
  return {
    id: row.id,
    slug: row.slug || null,
    name: row.name || "Produit",
    tagline: row.tagline || null,
    description: row.description || null,
    currency: row.currency || "HTG",
    retailPrice: row.retail_price ?? null,
    wholesalePrice: row.wholesale_price ?? null,
    wholesaleMinQty: row.wholesale_min_qty ?? null,
    compareAtPrice: row.compare_at_price ?? null,
    stock: typeof row.stock === "number" ? row.stock : null,
    categoryId: row.category_id || null,
    merchantId: row.merchant_id || null,
    deliveryDays: row.estimated_delivery_days ?? null,
    merchantName: (m && m.shop_name) || null,
    merchantRating: m && typeof m.average_rating === "number" ? m.average_rating : null,
    merchantTrust: m ? m.trust_score ?? null : null,
    imagePath: (primary && primary.storage_path) || null,
    imageAlt: (primary && primary.alt_text) || null,
  };
}

function renderProductCard(p) {
  const priceKnown = p.retailPrice != null && !Number.isNaN(Number(p.retailPrice));
  const imgUrl = productImageUrl(p.imagePath) || PLACEHOLDER_IMG;
  const imgAlt = esc(p.imageAlt || p.name);
  const link = p.id ? `product.html?id=${encodeURIComponent(p.id)}` : "#";

  const compare =
    priceKnown && p.compareAtPrice != null && Number(p.compareAtPrice) > Number(p.retailPrice)
      ? `<span class="vh-cat-compare">${money(Number(p.compareAtPrice), p.currency)}</span>`
      : "";
  const priceLine = priceKnown
    ? `<div class="price">${money(Number(p.retailPrice), p.currency)}${compare}</div>`
    : `<div class="price" style="color:var(--muted,#6f7891);font-weight:700;font-size:13px">Prix à venir</div>`;

  const wholesale =
    p.wholesalePrice != null && p.wholesaleMinQty
      ? `<div class="vh-cat-wholesale">Prix de gros : ${money(Number(p.wholesalePrice), p.currency)} — dès ${esc(p.wholesaleMinQty)} unités</div>`
      : "";

  let stock = "";
  if (p.stock === 0) stock = `<div class="vh-cat-stock out">Rupture de stock</div>`;
  else if (p.stock != null) stock = `<div class="vh-cat-stock ok">${esc(p.stock)} en stock</div>`;

  const canAdd = priceKnown && p.id && p.stock !== 0;
  const addBtn = canAdd
    ? `<button class="add" type="button" data-live-add
        data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${esc(p.retailPrice)}"
        data-currency="${esc(p.currency)}" data-seller="${esc(p.merchantName || "Marchand VinHT")}"
        data-img="${esc(imgUrl)}">Ajouter au panier</button>`
    : `<button class="add" type="button" disabled>${p.stock === 0 ? "Indisponible" : "Bientôt"}</button>`;

  const saved = !!p.id && wishlistIds.has(p.id);
  const heartLabel = saved ? "Retirer des favoris" : "Ajouter aux favoris";
  const heartBtn = p.id
    ? `<button class="heart${saved ? " is-saved" : ""}" type="button" data-wishlist-product-id="${esc(p.id)}" aria-pressed="${saved}" aria-label="${heartLabel}"><i data-lucide="heart"></i></button>`
    : `<button class="heart" type="button" aria-label="Ajouter aux favoris" disabled><i data-lucide="heart"></i></button>`;

  return `<div class="product-card">
    ${heartBtn}
    <a href="${link}"><div class="prod-img"><img src="${esc(imgUrl)}" alt="${imgAlt}" loading="lazy"></div></a>
    <h4><a href="${link}" style="color:inherit">${esc(p.name)}</a></h4>
    <div class="seller">${p.merchantId ? `<a href="store.html?merchant=${encodeURIComponent(p.merchantId)}">${esc(p.merchantName || "Marchand VinHT")}</a>` : esc(p.merchantName || "Marchand VinHT")}</div>
    ${priceLine}
    ${wholesale}
    ${stock}
    ${addBtn}
  </div>`;
}

async function loadProducts() {
  const host = $("#productGrid");
  if (!host) return;
  const search = currentSearch();
  const cat = currentCategoryId;
  const sort = ALLOWED_SORTS.includes(currentSort) ? currentSort : "default";

  host.setAttribute("aria-busy", "true");
  host.innerHTML = skeleton("prod", 6);
  try {
    let rows;
    if (search || cat || sort !== "default") {
      // Recherche / filtre / tri explicite : liste triée côté serveur.
      rows = await getProducts({ search, categoryId: cat, sort });
    } else {
      // Vue par défaut : produits en vedette d'abord, puis le reste (récents).
      const [feat, all] = await Promise.all([getFeaturedProducts(), getProducts({})]);
      const seen = new Set(feat.map((r) => r.id));
      rows = [...feat, ...all.filter((r) => !seen.has(r.id))];
    }

    const products = rows.map(normalizeProduct).filter(Boolean);
    if (!products.length) {
      const searching = String(search || "").trim().length > 0;
      host.innerHTML = stateBlock("empty", {
        title: searching || cat ? "Aucun résultat" : "Catalogue en préparation",
        text:
          searching || cat
            ? "Aucun produit ne correspond à votre sélection pour le moment."
            : "Aucun produit disponible pour le moment. Le catalogue VinHT arrive très bientôt.",
      });
      return;
    }
    host.innerHTML = products.map(renderProductCard).join("");
    refreshIcons();
  } catch (e) {
    console.warn("[VinHT] produits:", e && e.message);
    host.innerHTML = stateBlock("error", {
      text: "Impossible de charger les produits.",
      retry: "products",
    });
  } finally {
    host.removeAttribute("aria-busy");
  }
}

// --- Interactions ----------------------------------------------------
function currentSearch() {
  const input = $("#catalogSearchInput");
  return input ? input.value || "" : "";
}

function initSearch() {
  const input = $("#catalogSearchInput");
  const btn = $("#catalogSearchBtn");
  const run = (e) => {
    if (e) e.preventDefault();
    loadProducts();
  };
  if (btn) btn.addEventListener("click", run);
  if (input)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run(e);
    });
}

function initCategorySelect() {
  const sel = $("#catalogCategorySelect");
  if (!sel) return;
  sel.addEventListener("change", () => {
    currentCategoryId = sel.value || "";
    loadProducts(); // conserve la recherche + le tri en cours
  });
}

function initSortSelect() {
  const sel = $("#catalogSortSelect");
  if (!sel) return;
  currentSort = ALLOWED_SORTS.includes(sel.value) ? sel.value : "default";
  sel.addEventListener("change", () => {
    currentSort = ALLOWED_SORTS.includes(sel.value) ? sel.value : "default";
    loadProducts(); // conserve la recherche + la catégorie en cours
  });
}


function applyUrlState() {
  try {
    const p = new URLSearchParams(location.search);
    const q = p.get("q") || "";
    const cat = p.get("category") || "";
    const sort = p.get("sort") || "default";
    const input = $("#catalogSearchInput");
    if (input && q) input.value = q;
    if (cat) currentCategoryId = cat;
    if (ALLOWED_SORTS.includes(sort)) currentSort = sort;
    const sel = $("#catalogSortSelect");
    if (sel && ALLOWED_SORTS.includes(sort)) sel.value = sort;
  } catch {}
}

function initSaveSearch() {
  const btn = $("#saveSearchBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const catSel = $("#catalogCategorySelect");
    try {
      saveSearch({
        query: currentSearch(),
        categoryId: currentCategoryId,
        categoryLabel: catSel?.selectedOptions?.[0]?.textContent || "",
        sort: currentSort,
      });
      showToast("Recherche sauvegardée ✓");
    } catch {
      showToast("Ajoutez un mot-clé ou une catégorie avant de sauvegarder.", "red");
    }
  });
}

// --- Favoris (wishlist_items, RLS) ------------------------------------
async function loadWishlistIds() {
  try {
    const session = await getSession();
    wishlistIds = session && session.user ? new Set(await getMyWishlistProductIds()) : new Set();
  } catch (e) {
    console.warn("[VinHT] favoris:", e && e.message);
    wishlistIds = new Set();
  }
}

function repaintHearts() {
  $("#productGrid")
    ?.querySelectorAll("[data-wishlist-product-id]")
    .forEach((btn) => paintHeart(btn, wishlistIds.has(btn.dataset.wishlistProductId)));
}

function initDelegates() {
  document.addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      e.preventDefault();
      if (retry.dataset.retry === "categories") loadCategories();
      else if (retry.dataset.retry === "products") loadProducts();
    }
  });

  const catGrid = $("#categoryGrid");
  if (catGrid) {
    const pickCategory = (card) => {
      currentCategoryId = card.dataset.categoryId || "";
      const sel = $("#catalogCategorySelect");
      if (sel) sel.value = currentCategoryId;
      loadProducts();
      document.getElementById("products")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    catGrid.addEventListener("click", (e) => {
      const card = e.target.closest("[data-category-id]");
      if (card) pickCategory(card);
    });
    catGrid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest("[data-category-id]");
      if (!card) return;
      e.preventDefault();
      pickCategory(card);
    });
  }

  const grid = $("#productGrid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const heart = e.target.closest("[data-wishlist-product-id]");
      if (heart) {
        const pid = heart.dataset.wishlistProductId;
        const saved = wishlistIds.has(pid);
        handleHeartClick(heart, pid, saved).then((next) => {
          if (next === true) wishlistIds.add(pid);
          else if (next === false) wishlistIds.delete(pid);
        });
        return;
      }
      const btn = e.target.closest("[data-live-add]");
      if (!btn) return;
      const d = btn.dataset;
      let added = false;
      try {
        added = addToCart({
          id: d.id,
          productId: d.id,
          pricingTier: "retail", // retail par défaut ; wholesale seulement si choisi explicitement
          name: d.name,
          seller: d.seller,
          price: d.price,
          currency: d.currency || "HTG",
          img: d.img,
        });
      } catch (err) {
        if (err?.code === "mixed_currency_cart_not_supported") {
          showToast("Votre panier contient déjà des articles dans une autre devise. Finalisez ou videz ce panier avant d’ajouter ce produit.", "red");
          return;
        }
        throw err;
      }
      showToast(added ? "Ajouté au panier ✓" : "Produit de démonstration : aperçu uniquement.");
    });
  }
}

export function initHome() {
  if (!$("#categoryGrid") && !$("#productGrid")) return; // pas la Home
  injectCss();
  applyUrlState();
  initDelegates();
  initSearch();
  initCategorySelect();
  initSortSelect();
  initSaveSearch();

  if (!isSupabaseConfigured()) {
    const msg = stateBlock("error", { text: "Configuration Supabase manquante." });
    const cg = $("#categoryGrid");
    const pg = $("#productGrid");
    if (cg) cg.innerHTML = msg;
    if (pg) pg.innerHTML = msg;
    return;
  }

  loadCategories();
  loadWishlistIds().then(loadProducts); // 1er rendu avec l'état favoris déjà connu

  // Connexion/déconnexion ailleurs sur le site (modale, autre onglet) ->
  // recharge les favoris réels et repeint sans reload de page.
  onAuthChange(async () => {
    await loadWishlistIds();
    repaintHearts();
  });
}
