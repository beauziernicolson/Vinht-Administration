// Fiche produit dynamique — product.html?id=<uuid>
//
// Priorités : produit réel, image/placeholder, vendeur, retail, wholesale/MOQ,
// stock, description. PAS de checkout ici (Phase 6).
//
// Les éléments initialement masqués utilisent style="display:none" (inline)
// pour rester déterministes malgré les classes .product-layout{display:grid} etc.

import { $, $$ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { addToCart, getCart, setCart } from "../services/cart.js";
import { showToast } from "../ui/toast.js";
import { getSession } from "../services/auth.js";
import { isWishlisted } from "../services/wishlist.js";
import { paintHeart, handleHeartClick } from "../ui/wishlist.js";
import { trackRecentlyViewed } from "../services/recent.js";
import {
  getProductById,
  getProductBySlug,
  getProductImages,
  getProductVariantContext,
  productImageUrl,
  isSupabaseConfigured,
} from "../services/catalog.js";
import { getProductPromotions, PROMOTION_DISCOUNT_TYPE_FR } from "../services/promotions.js";
import { getSponsoredProductSlots, recordSponsoredProductImpression, recordSponsoredProductClick } from "../services/ads.js";

const PLACEHOLDER_IMG = "assets/abstract-brand.jpg";

function el(id) {
  return document.getElementById(id);
}
function setText(id, val) {
  const n = el(id);
  if (n) n.textContent = val;
}
function display(id, on) {
  const n = el(id);
  if (n) n.style.display = on ? "" : "none";
}
function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// Style minimal des boutons d'option de variante — injecté une seule fois,
// aligné sur le design VinHT (bordure fine, bleu actif).
function ensureVariantStyle() {
  if (document.getElementById("pdpVariantStyle")) return;
  const s = document.createElement("style");
  s.id = "pdpVariantStyle";
  s.textContent =
    ".pdp-variant-opt{appearance:none;cursor:pointer;border:1px solid var(--line,#e7eaf2);" +
    "background:#fff;color:var(--ink,#0b1533);border-radius:10px;padding:8px 14px;font-size:13px;" +
    "font-weight:600;line-height:1;transition:border-color .12s,background .12s}" +
    ".pdp-variant-opt:hover{border-color:var(--blue,#0b2edc)}" +
    ".pdp-variant-opt.active{border-color:var(--blue,#0b2edc);background:var(--blue,#0b2edc);color:#fff}" +
    ".pdp-variant-opt.dimmed{opacity:.45}" +
    ".pdp-variant-opt.dimmed:not(.active){text-decoration:line-through}";
  document.head.appendChild(s);
}

function getLookup() {
  try {
    const q = new URL(window.location.href).searchParams;
    return { id: q.get("id") || "", slug: q.get("slug") || "" };
  } catch (e) {
    return { id: "", slug: "" };
  }
}

function stateHtml(kind, msg) {
  const retry =
    kind === "error"
      ? '<button class="btn btn-outline-blue" type="button" id="pdpRetry" style="margin-left:10px">Réessayer</button>'
      : "";
  return `<div class="surface" style="padding:44px 22px;text-align:center;margin:22px 0">
    <h3 style="margin:0 0 8px">${kind === "error" ? "Erreur" : "Produit introuvable"}</h3>
    <p style="margin:0 0 18px;color:var(--muted,#6f7891);font-size:13px">${esc(msg)}</p>
    <a class="btn btn-blue" href="index.html">Retour au catalogue</a>${retry}
  </div>`;
}

function showState(html) {
  const s = el("pdpState");
  if (s) {
    s.innerHTML = html;
    s.style.display = "";
  }
  display("pdpLayout", false);
  display("pdpDescSection", false);
}
function showProduct() {
  display("pdpState", false);
  display("pdpLayout", true);
  display("pdpDescSection", true);
}

function fill(row, images) {
  const cur = row.currency || "HTG";
  const m = row.merchants || {};

  const imgs = (Array.isArray(images) ? images.slice() : []).sort((a, b) => {
    const pa = a && a.is_primary ? 0 : 1;
    const pb = b && b.is_primary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a?.position ?? 999) - (b?.position ?? 999);
  });
  const urls = imgs.map((i) => productImageUrl(i.storage_path)).filter(Boolean);
  const mainUrl = urls[0] || PLACEHOLDER_IMG;

  document.title = `${row.name || "Produit"} — VinHT`;
  try { if (row.slug) { const u=new URL(location.href); if (u.searchParams.get("slug")!==row.slug) { u.searchParams.set("slug",row.slug); u.searchParams.delete("id"); history.replaceState(null,"",u); } } } catch (e) {}
  setText("pdpBreadcrumb", `Accueil › ${row.name || "Produit"}`);
  setText("pdpName", row.name || "Produit");
  setText("pdpTagline", row.tagline || row.description || "");
  setText("pdpMerchant", m.shop_name || "Marchand VinHT");
  const storeLink = el("pdpStoreLink");
  if (storeLink && row.merchant_id) storeLink.href = `store.html?merchant=${encodeURIComponent(row.merchant_id)}`;
  // "active" = compte actif, PAS un signal de vérification/KYC. Libellé neutre.
  display("pdpMerchantActive", m.status === "active");

  const mainImg = el("pdpMainImg");
  if (mainImg) {
    mainImg.src = mainUrl;
    mainImg.alt = row.name || "";
  }

  const thumbs = el("pdpThumbs");
  if (thumbs) {
    if (urls.length > 1) {
      thumbs.innerHTML = urls
        .map(
          (u, i) =>
            `<div class="thumb${i === 0 ? " active" : ""}" data-full="${esc(u)}"><img src="${esc(u)}" alt=""></div>`
        )
        .join("");
      thumbs.onclick = (e) => {
        const t = e.target.closest(".thumb");
        if (!t) return;
        $$(".thumb", thumbs).forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        if (mainImg) mainImg.src = t.dataset.full;
      };
    } else {
      thumbs.innerHTML = "";
    }
  }

  // Évaluation vendeur
  const rating = el("pdpRating");
  if (rating) {
    const r = Number(m.average_rating) || 0;
    rating.textContent = r > 0 ? `★ ${r.toFixed(1)} / 5` : "Nouveau vendeur";
    rating.style.display = "";
  }

  // Prix
  const retailKnown = row.retail_price != null && !Number.isNaN(Number(row.retail_price));
  setText("pdpRetail", retailKnown ? money(Number(row.retail_price), cur) : "—");

  const hasWholesale = row.wholesale_price != null && row.wholesale_min_qty;
  display("pdpWholesaleSide", !!hasWholesale);
  display("pdpMoqBox", !!hasWholesale);
  if (hasWholesale) {
    setText("pdpWholesale", money(Number(row.wholesale_price), cur));
    setText("pdpMoq", `À partir de ${row.wholesale_min_qty} unités`);
    setText("pdpMoqQty", `${row.wholesale_min_qty} unités`);
  }

  // Stock
  const stock = typeof row.stock === "number" ? row.stock : null;
  const stockLabel = el("pdpStockLabel");
  if (stock === 0) {
    setText("pdpStockLabel", "Rupture");
    if (stockLabel) stockLabel.classList.remove("green");
    setText("pdpStockQty", "");
  } else if (stock != null) {
    setText("pdpStockLabel", "En stock");
    if (stockLabel) stockLabel.classList.add("green");
    setText("pdpStockQty", `${stock} unités`);
  } else {
    setText("pdpStockLabel", "—");
    setText("pdpStockQty", "");
  }

  // Livraison
  const dd = row.estimated_delivery_days;
  const ddText = dd ? `${dd} jour${dd > 1 ? "s" : ""}` : "—";
  setText("pdpDelivery", ddText);
  setText(
    "pdpDeliveryCard",
    row.delivery_zone
      ? `Zone : ${row.delivery_zone}${dd ? ` · ${ddText}` : ""}`
      : "Selon la zone du marchand."
  );

  // Description + specs
  setText("pdpDescription", row.description || row.tagline || "Description non disponible.");
  const specList = el("pdpSpecList");
  const specs =
    row.product_specs && typeof row.product_specs === "object" && !Array.isArray(row.product_specs)
      ? row.product_specs
      : null;
  if (specList && specs) {
    const entries = Object.entries(specs).filter(
      ([k, v]) => k !== "fixture" && v != null && typeof v !== "object"
    );
    if (entries.length) {
      specList.innerHTML = entries
        .map(([k, v]) => `<li><strong>${esc(k)}</strong> : ${esc(v)}</li>`)
        .join("");
      specList.style.display = "";
    }
  }

  // Carte vendeur
  setText("pdpSellerName", m.shop_name || "Marchand VinHT");
  setText("pdpTrust", m.trust_score != null ? String(m.trust_score) : "—");
  setText("pdpMRating", Number(m.average_rating) ? `${Number(m.average_rating).toFixed(1)}/5` : "Nouveau");
  setText("pdpMRatingCount", m.rating_count != null ? String(m.rating_count) : "0");
  setText("pdpTrustLevel", m.trust_level || "—");
  setText("pdpMZone", m.delivery_zone || row.delivery_zone || "—");

  // --- Choix détail / gros -------------------------------------------------
  // Le frontend ne calcule AUCUN prix de checkout autoritaire : il ne fait que
  // transmettre pricing_tier. Le serveur applique le vrai prix.
  const moq = hasWholesale ? Number(row.wholesale_min_qty) || 0 : 0;
  let selectedTier = "retail";

  const qtySpan = document.querySelector(".qty span");
  const tierRow = el("pdpTierRow");
  const tierRetailBtn = el("pdpTierRetail");
  const tierWholesaleBtn = el("pdpTierWholesale");

  function reflectTier() {
    setText("pdpTierHint", selectedTier === "wholesale" ? "Gros" : "Détail");
    if (tierRetailBtn) {
      tierRetailBtn.className = selectedTier === "retail" ? "btn btn-blue" : "btn btn-outline-blue";
    }
    if (tierWholesaleBtn) {
      tierWholesaleBtn.className =
        selectedTier === "wholesale" ? "btn btn-blue" : "btn btn-outline-blue";
    }
    if (selectedTier === "wholesale" && moq && qtySpan) {
      const n = parseInt(qtySpan.textContent, 10) || 1;
      if (n < moq) qtySpan.textContent = String(moq);
    }
  }

  if (hasWholesale && tierRow) {
    tierRow.style.display = "flex";
    if (tierRetailBtn)
      tierRetailBtn.onclick = () => {
        selectedTier = "retail";
        reflectTier();
      };
    if (tierWholesaleBtn)
      tierWholesaleBtn.onclick = () => {
        selectedTier = "wholesale";
        reflectTier();
      };
    // Re-clamp après le handler générique initQty (min 1) sur les boutons +/-.
    document.querySelectorAll(".qty button").forEach((b) =>
      b.addEventListener("click", () => setTimeout(reflectTier, 0))
    );
    reflectTier();
  }

  // --- Panier + variantes réelles (Feature #5) --------------------------
  // Les variantes viennent EXCLUSIVEMENT de get_product_variant_context_v1().
  // Le frontend ne fabrique aucune combinaison : il ne propose que les
  // variantes réelles et conserve le variant_id exact dans le panier.
  const addBtn = el("pdpAddCart");
  const buyBtn = el("pdpBuyNow");
  const variantHost = el("pdpVariants");
  const baseAddLabel = addBtn ? addBtn.textContent || "Ajouter au panier" : "Ajouter au panier";

  let hasVariants = false;
  let variantsResolved = false;
  let selectedVariant = null;
  let variantList = [];
  let optionNames = [];
  const selection = {}; // { "Taille": "M", "Couleur": "Rouge" }

  function matchVariant() {
    if (!hasVariants) return null;
    if (optionNames.some((k) => !selection[k])) return null;
    return (
      variantList.find((v) =>
        optionNames.every((k) => String(v.options[k] ?? "") === String(selection[k]))
      ) || null
    );
  }
  function effStock() {
    if (hasVariants) return selectedVariant ? selectedVariant.stock : null;
    return stock;
  }
  function purchasable() {
    if (!retailKnown || !row.id) return false;
    if (hasVariants) {
      return !!selectedVariant && selectedVariant.is_active && selectedVariant.stock > 0;
    }
    return stock !== 0;
  }

  function syncStockLabel() {
    const lbl = el("pdpStockLabel");
    if (!lbl) return;
    if (hasVariants && !selectedVariant) {
      setText("pdpStockLabel", "Choisissez une option");
      lbl.classList.remove("green");
      setText("pdpStockQty", "");
      return;
    }
    const inactive = hasVariants && selectedVariant && !selectedVariant.is_active;
    const s = effStock();
    if (inactive || s === 0) {
      setText("pdpStockLabel", inactive ? "Indisponible" : "Rupture");
      lbl.classList.remove("green");
      setText("pdpStockQty", "");
    } else if (s != null) {
      setText("pdpStockLabel", "En stock");
      lbl.classList.add("green");
      setText("pdpStockQty", `${s} unités`);
    }
  }

  function syncButtons() {
    const ok = purchasable();
    if (addBtn) {
      addBtn.disabled = !ok;
      addBtn.textContent =
        ok || !variantsResolved
          ? baseAddLabel
          : hasVariants && !selectedVariant
          ? "Choisissez une option"
          : "Indisponible";
    }
    if (buyBtn) buyBtn.disabled = !ok;
    const s = effStock();
    if (s != null && s > 0 && qtySpan) {
      const n = parseInt(qtySpan.textContent, 10) || 1;
      if (n > s) qtySpan.textContent = String(s);
    }
  }

  function renderVariantPicker() {
    if (!variantHost) return;
    const valuesByOpt = {};
    optionNames.forEach((k) => (valuesByOpt[k] = []));
    variantList.forEach((v) =>
      optionNames.forEach((k) => {
        const val = v.options[k];
        if (val != null && !valuesByOpt[k].includes(val)) valuesByOpt[k].push(val);
      })
    );
    const valueHasAvailable = (k, val) =>
      variantList.some(
        (v) =>
          String(v.options[k] ?? "") === String(val) &&
          v.is_active &&
          v.stock > 0 &&
          optionNames.every(
            (o) => o === k || !selection[o] || String(v.options[o] ?? "") === String(selection[o])
          )
      );

    variantHost.innerHTML =
      optionNames
        .map((k) => {
          const opts = valuesByOpt[k]
            .map((val) => {
              const active = selection[k] === val;
              const dim = !valueHasAvailable(k, val);
              return `<button type="button" class="pdp-variant-opt${active ? " active" : ""}${
                dim ? " dimmed" : ""
              }" data-variant-opt data-opt-name="${esc(k)}" data-opt-val="${esc(val)}">${esc(
                val
              )}</button>`;
            })
            .join("");
          const kLabel = esc(String(k).charAt(0).toUpperCase() + String(k).slice(1));
          return `<div class="pdp-variant-group" style="margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">${kLabel}${
            selection[k] ? ` : <span style="font-weight:500;color:var(--muted,#6f7891)">${esc(selection[k])}</span>` : ""
          }</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">${opts}</div>
          </div>`;
        })
        .join("") +
      `<div id="pdpVariantMsg" style="font-size:12px;color:var(--red,#f31938);margin-top:2px;display:none"></div>`;

    variantHost.querySelectorAll("[data-variant-opt]").forEach((b) =>
      b.addEventListener("click", () => {
        const name = b.dataset.optName;
        const val = b.dataset.optVal;
        if (selection[name] === val) delete selection[name];
        else selection[name] = val;
        selectedVariant = matchVariant();
        renderVariantPicker();
        const msg = el("pdpVariantMsg");
        if (msg) {
          const complete = optionNames.every((k) => selection[k]);
          if (complete && !selectedVariant) {
            msg.textContent = "Cette combinaison n'est pas disponible.";
            msg.style.display = "";
          } else if (selectedVariant && (!selectedVariant.is_active || selectedVariant.stock <= 0)) {
            msg.textContent = "Cette variante est en rupture ou indisponible.";
            msg.style.display = "";
          } else {
            msg.style.display = "none";
          }
        }
        syncStockLabel();
        syncButtons();
      })
    );
    ensureVariantStyle();
  }

  const doAdd = () => {
    if (!purchasable()) return 0;
    const wholesale = selectedTier === "wholesale" && hasWholesale;
    let n = Math.max(1, parseInt((qtySpan && qtySpan.textContent) || "1", 10) || 1);
    if (wholesale && moq) n = Math.max(n, moq);
    const s = effStock();
    if (s != null && s > 0 && n > s) n = s;
    const tier = wholesale ? "wholesale" : "retail";
    const vId = hasVariants && selectedVariant ? selectedVariant.id : null;

    try {
      addToCart({
        id: row.id,
        productId: row.id,
        pricingTier: tier,
        moq: wholesale ? moq : undefined,
        name: row.name,
        seller: m.shop_name || "Marchand VinHT",
        price: wholesale ? row.wholesale_price : row.retail_price, // affichage seulement
        currency: row.currency || "HTG",
        img: mainUrl,
        variantId: vId,
        variantOptions: vId ? selectedVariant.options : null,
      });
    } catch (err) {
      if (err?.code === "mixed_currency_cart_not_supported") {
        showToast("Votre panier contient déjà des articles dans une autre devise. Finalisez ou videz ce panier avant d’ajouter ce produit.", "red");
        return 0;
      }
      throw err;
    }
    // Fixe la quantité exacte demandée sur la ligne (pas d'accumulation ici).
    const c = getCart();
    const line = c.find(
      (x) => x.id === row.id && (x.pricingTier || "retail") === tier && (x.variantId || null) === vId
    );
    if (line) {
      line.qty = n;
      setCart(c);
    }
    // Une fiche produit doit confirmer l'ajout par le drawer partagé, pas
    // uniquement par un toast : le panier reste ainsi visible et vérifiable.
    window.dispatchEvent(new CustomEvent("vinht:cartopen"));
    return n;
  };

  if (addBtn) {
    addBtn.onclick = () => {
      if (doAdd() > 0) showToast("Ajouté au panier ✓");
    };
  }
  if (buyBtn) {
    buyBtn.onclick = () => {
      if (doAdd() > 0) window.location.href = "checkout.html";
    };
  }
  syncButtons();

  // Chargement asynchrone des variantes réelles.
  (async () => {
    try {
      const vc = await getProductVariantContext(row.id);
      if (vc.has_variants) {
        hasVariants = true;
        variantList = vc.variants;
        optionNames = vc.option_names.length
          ? vc.option_names
          : [...new Set(variantList.flatMap((v) => Object.keys(v.options)))];
        // Pré-sélection quand il n'existe qu'une seule valeur pour une option.
        optionNames.forEach((k) => {
          const vals = [...new Set(variantList.map((v) => v.options[k]).filter((x) => x != null))];
          if (vals.length === 1) selection[k] = vals[0];
        });
        selectedVariant = matchVariant();
        renderVariantPicker();
        syncStockLabel();
      } else if (variantHost) {
        variantHost.innerHTML = ""; // aucun produit varianté -> pas d'UI inutile
      }
    } catch (e) {
      console.warn("[VinHT] variantes produit:", e && e.message);
    } finally {
      variantsResolved = true;
      syncButtons();
    }
  })();

  initWishlistButton(row.id);
}

// --- Favoris (wishlist_items, RLS) --------------------------------------
async function initWishlistButton(productId) {
  const btn = el("pdpWishlistBtn");
  if (!btn || !productId) return;

  let saved = false;
  try {
    const session = await getSession();
    if (session && session.user) saved = await isWishlisted(productId);
  } catch (e) {
    console.warn("[VinHT] favoris produit:", e && e.message);
  }
  paintHeart(btn, saved, { iconOnly: false });

  btn.onclick = () => {
    handleHeartClick(btn, productId, saved, { iconOnly: false }).then((next) => {
      if (next === true || next === false) saved = next;
    });
  };
}

// Feature #28 — Promotions produit (get_product_promotions_v1). N'affiche que
// ce que le serveur retourne : jamais de promesse d'applicabilité au panier
// (min_subtotal_htg / min_quantity / ends_at ne sont pas revalidés ici,
// seulement rappelés) — un simple "Promotion disponible" plutôt qu'un
// montant d'économie garanti.
function promoBadgeLabel(p) {
  if (p.discount_type === "percent") return `-${p.discount_value}%`;
  if (p.discount_type === "fixed_htg") return `${money(p.discount_value)} de réduction`;
  return PROMOTION_DISCOUNT_TYPE_FR?.[p.discount_type] || "Promotion";
}

function promoConditionsText(p) {
  const parts = [];
  if (p.min_subtotal_htg) parts.push(`dès ${money(p.min_subtotal_htg)} d'achat`);
  if (p.min_quantity && p.min_quantity > 1) parts.push(`à partir de ${esc(p.min_quantity)} unités`);
  if (p.ends_at) {
    const d = new Date(p.ends_at);
    if (!Number.isNaN(d.getTime())) parts.push(`jusqu'au ${d.toLocaleDateString("fr-FR")}`);
  }
  return parts.join(" · ");
}

// --- Feature #29 — Sponsored Products (placement product_page) -----------
// Le backend exclut déjà le produit contexte de ce placement — jamais de
// reclassement local, jamais de calcul de coût côté client. Une impression
// n'est comptée qu'après visibilité réelle (IntersectionObserver, seuil 0.5),
// et l'échec du tracking ne doit jamais bloquer la navigation (fail-open).
const _sponsoredImpressionSeen = new Set();
let _sponsoredObserver = null;

function sponsoredCardHtml(row) {
  const url = row.product_id ? `product.html?id=${encodeURIComponent(row.product_id)}` : "#";
  const img = row.product_image_path || "assets/abstract-brand.jpg";
  return `<article class="v12-related-card" data-sponsored-campaign="${esc(row.campaign_id)}" data-sponsored-placement="${esc(row.placement || "product_page")}">
    <a class="img" href="${url}" data-sponsored-link="${esc(row.campaign_id)}"><span class="badge" style="position:absolute;margin:6px;z-index:1;background:#151515;color:#fff">${esc(row.label || "Sponsorisé")}</span><img src="${esc(img)}" alt="${esc(row.product_name || "")}" loading="lazy" decoding="async"></a>
    <div class="v12-related-body"><h3><a href="${url}" data-sponsored-link="${esc(row.campaign_id)}">${esc(row.product_name || "")}</a></h3><div class="v12-related-meta">${esc(row.shop_name || "")}</div><div class="v12-related-price">${row.retail_price_htg != null ? money(row.retail_price_htg) : ""}</div></div>
  </article>`;
}

async function renderSponsoredSlots(productId) {
  const section = el("pdpSponsoredSection");
  const host = el("pdpSponsoredGrid");
  if (!section || !host) return;
  section.style.display = "none";
  host.innerHTML = "";
  let result;
  try {
    result = await getSponsoredProductSlots({ placement: "product_page", contextProductId: productId, limit: 12 });
  } catch {
    // Panne de télémétrie/slots : la fiche produit continue de fonctionner,
    // on masque simplement le bloc plutôt que de casser la page.
    return;
  }
  if (!result.enabled || !result.rows.length) return;
  section.style.display = "";
  host.innerHTML = result.rows.map(sponsoredCardHtml).join("");

  host.querySelectorAll("[data-sponsored-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      const campaignId = link.dataset.sponsoredLink;
      // Le tracking ne doit jamais retarder indéfiniment la navigation —
      // on l'envoie en fire-and-forget, jamais en attente bloquante.
      recordSponsoredProductClick({ campaignId, placement: "product_page", context: { source_product_id: productId } });
    });
  });

  if (_sponsoredObserver) _sponsoredObserver.disconnect();
  _sponsoredObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const campaignId = entry.target.dataset.sponsoredCampaign;
      const key = `product_page:${campaignId}`;
      if (_sponsoredImpressionSeen.has(key)) continue;
      _sponsoredImpressionSeen.add(key);
      recordSponsoredProductImpression({ campaignId, placement: "product_page", context: { source_product_id: productId } });
      _sponsoredObserver.unobserve(entry.target);
    }
  }, { threshold: 0.5 });
  host.querySelectorAll("[data-sponsored-campaign]").forEach((card) => _sponsoredObserver.observe(card));
}

async function renderProductPromotions(productId, offerId = null) {
  const host = el("pdpPromotions");
  if (!host) return;
  host.innerHTML = "";
  try {
    const promos = await getProductPromotions(productId, offerId);
    if (!promos.length) return;
    host.innerHTML = promos.map((p) => `<div class="badge green" style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;margin:0 6px 6px 0;font-weight:600">
      <span>${esc(promoBadgeLabel(p))}${p.mode === "code" && p.code ? ` · Code ${esc(p.code)}` : ""}</span>
      <span style="font-weight:400;font-size:11px">${esc(promoConditionsText(p) || "Promotion disponible")}</span>
    </div>`).join("");
  } catch (e) {
    // Une panne promotions ne doit jamais casser la fiche produit — le reste
    // de la page continue de fonctionner, mais l'échec reste visible plutôt
    // que silencieux (jamais une section qui disparaît sans explication).
    host.innerHTML = `<div class="badge" style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;margin:0 6px 6px 0">
      <span>Promotions temporairement indisponibles.</span>
      <button type="button" data-promo-retry style="border:none;background:none;cursor:pointer;color:inherit;text-decoration:underline;font:inherit">Réessayer</button>
    </div>`;
    host.querySelector("[data-promo-retry]")?.addEventListener("click", () => renderProductPromotions(productId, offerId));
  }
}

async function render() {
  if (!el("pdpLayout")) return; // pas la fiche produit

  const lookup = getLookup();
  // Les IDs demo-* appartiennent au snapshot standalone local, pas à Supabase.
  if (lookup.id && lookup.id.startsWith("demo-")) return;
  if (!lookup.id && !lookup.slug) {
    showState(stateHtml("empty", "Aucun produit sélectionné."));
    return;
  }
  if (!isSupabaseConfigured()) {
    showState(stateHtml("error", "Configuration Supabase manquante."));
    return;
  }

  // loading
  const s = el("pdpState");
  if (s) {
    s.innerHTML =
      '<div class="surface" style="padding:44px;text-align:center;color:var(--muted,#6f7891)">Chargement du produit…</div>';
    s.style.display = "";
  }
  display("pdpLayout", false);
  display("pdpDescSection", false);

  try {
    const row = lookup.slug ? await getProductBySlug(lookup.slug) : await getProductById(lookup.id);
    const images = row?.id ? await getProductImages(row.id) : [];
    if (!row) {
      showState(stateHtml("empty", "Ce produit n'existe pas ou n'est plus disponible."));
      return;
    }
    fill(row, images);
    trackRecentlyViewed(row.id);
    showProduct();
    renderProductPromotions(row.id);
    renderSponsoredSlots(row.id);
  } catch (e) {
    console.warn("[VinHT] produit:", e && e.message);
    showState(stateHtml("error", "Impossible de charger ce produit."));
    const retry = el("pdpRetry");
    if (retry) retry.addEventListener("click", render);
  }
}

export function initProduct() {
  render();
}
