// merchant-center.html — Espace marchand V1.
// Boutique / Produits / Commandes. Aucune analytics factice.
//
// Sécurité : la ligne public.merchants (via user_id de session) fait autorité.
// Toutes les mutations passent par les RPC serveur. Aucune UPDATE directe.

import { $ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { getCategories, productImageUrl } from "../services/catalog.js";
import { getActiveSession } from "../services/orders.js";
import { onAuthChange, isSupabaseConfigured } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import * as MC from "../services/merchantCenter.js";
import { getMyAccessContext, merchantSpaceIsReachable } from "../services/access.js";
import { merchantBlockedHtml, merchantBannerHtml } from "../ui/merchantAccess.js";
import { refreshIcons } from "../lib/icons.js";
import { renderFlexicashConnectCard, handleFlexicashConnectReturn } from "../ui/flexicashConnectCard.js";
import { renderProfessionalSubscriptionPanel, handleSubscriptionPaymentReturn } from "../ui/professionalSubscriptionPanel.js?v=20260920-pro-retry-v1";
import { maybeShowMerchantLaunchOffer } from "../ui/launchOfferPopup.js?v=20260920-launch-qa2";
import { renderProductVariantsEditor, renderNewProductVariantsBuilder } from "../ui/productVariantsEditor.js";

const PLACEHOLDER_IMG = "assets/abstract-brand.jpg";

const TYPE_FR = { producteur: "Producteur", revendeur: "Revendeur", vendeur: "Vendeur" };
const PLAN_FR = { individual: "Individuel", professional: "Professionnel" };
const APPROVAL_FR = { pending: "À vérifier", approved: "Vérifié par VinHT", rejected: "Retiré par VinHT" };
const MSTATUS_FR = { active: "Actif", suspended: "Suspendu", closed: "Fermé", pending: "En attente" };
const OFLOW_FR = {
  new: "Nouvelle",
  accepted: "Acceptée",
  preparing: "En préparation",
  ready: "Prête",
  handed_off: "Remise au transport",
};
const DELIVERY_FR = {
  home: "Livraison à domicile",
  vinht_pickup: "Point de retrait VinHT",
  custom_location: "Adresse personnalisée",
};

let CATEGORIES = [];
let MERCHANT = null;
let NEW_VARIANTS = null;

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
const labelOr = (map, v) => (v && map[v]) || (v ? String(v) : "—");
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
const shortId = (id) => (id ? String(id).slice(0, 8) : "—");
const catName = (id) => {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.name : "—";
};
function toast(text, tone) {
  import("../ui/toast.js").then((m) => m.showToast(text, tone)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------
function showGate(html) {
  const s = $("#mcState");
  const c = $("#mcContent");
  if (s) {
    s.innerHTML = html;
    s.style.display = "";
  }
  if (c) c.style.display = "none";
}
function showContent() {
  const s = $("#mcState");
  const c = $("#mcContent");
  if (s) s.style.display = "none";
  if (c) c.style.display = "";
}

// ---------------------------------------------------------------------------
// Boutique
// ---------------------------------------------------------------------------
const isDemoMerchant = (m) => String(m && m.environment || "").toLowerCase() === "demo";

function renderDemoPayout(m) {
  const host = $("#mcDemoPayout");
  if (!host) return;
  if (!isDemoMerchant(m)) { host.innerHTML = ""; host.style.display = "none"; return; }
  host.style.display = "";
  host.innerHTML = `
    <div class="section-head"><div><h2>Compte FlexiCash de réception Demo <span class="badge amber">MODE DEMO</span></h2>
      <small>Numéro FlexiCash qui recevra vos versements en environnement Demo (Sandbox, aucun argent réel). Ne saisissez jamais ici un mot de passe ou un code PIN.</small></div></div>
    <div class="customer-grid">
      <div class="field"><label>Numéro FlexiCash Demo</label><input id="mcDemoFcNumber" inputmode="numeric" autocomplete="off" placeholder="4 à 80 caractères" value="${esc(m.demo_flexicash_payout_number || "")}"></div>
    </div>
    <div id="mcDemoFcMsg" style="display:none;font-size:12px;margin-top:8px"></div>
    <button class="btn btn-blue" id="mcDemoFcSave" type="button" style="margin-top:12px">Enregistrer le numéro Demo</button>`;
  const btn = $("#mcDemoFcSave");
  const msg = $("#mcDemoFcMsg");
  const setMsg = (t, ok) => { if (!msg) return; msg.textContent = t || ""; msg.style.color = ok ? "var(--green,#25a844)" : "var(--red,#f31938)"; msg.style.display = t ? "" : "none"; };
  btn?.addEventListener("click", async () => {
    const val = ($("#mcDemoFcNumber").value || "").trim();
    setMsg("");
    if (val.length < 4 || val.length > 80) { setMsg("Le numéro doit comporter entre 4 et 80 caractères."); return; }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Enregistrement…";
    try {
      await MC.setDemoFlexicashPayoutNumber(val);
      MERCHANT = await MC.getMyMerchant();
      setMsg("Numéro FlexiCash Demo enregistré ✓", true);
    } catch (err) {
      console.warn("[VinHT] demo payout number:", err && (err.message || err));
      const m2 = String(err && (err.message || err.details) || "").toLowerCase();
      setMsg(/demo_only/.test(m2) ? "Réservé aux comptes marchands en mode Demo." : mapErr(err, "Enregistrement impossible."));
    } finally {
      btn.disabled = false;
      btn.textContent = original || "Enregistrer le numéro Demo";
    }
  });
}

function hasSubscriptionPaymentReturn() {
  try { return new URLSearchParams(location.search).get("subscription_payment") === "return"; }
  catch { return false; }
}

// "Abonnement" panel — plan Professionnel. Branché sur le backend réel #4 :
// get_my_professional_subscription_context_v1 (source de vérité) +
// start_my_professional_subscription_v1 / cancel_my_professional_subscription_v1
// + Edge Function vinht-professional-subscription-payment. Les 5 000 HTG/mois
// sont une facture séparée, jamais déduite d'un versement de vente. Toute l'UI
// vit dans ../ui/professionalSubscriptionPanel.js (pas d'UI parallèle ici).
async function renderBilling() {
  const host = $("#mcBilling");
  if (!host) return;
  if (hasSubscriptionPaymentReturn()) return handleSubscriptionPaymentReturn(host);
  return renderProfessionalSubscriptionPanel(host);
}

function renderProfile(m) {
  const host = $("#mcShopView");
  if (!host) return;
  host.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;font-size:13px">
      <div><strong>Boutique</strong><div>${esc(m.shop_name || "—")}</div></div>
      <div><strong>Statut</strong><div>${esc(labelOr(MSTATUS_FR, m.status))}${isDemoMerchant(m) ? ' <span class="badge amber">MODE DEMO</span>' : ""}</div></div>
      <div><strong>Type</strong><div>${esc(labelOr(TYPE_FR, m.merchant_type))}</div></div>
      <div><strong>Plan</strong><div>${esc(labelOr(PLAN_FR, m.plan_code))}</div></div>
      <div><strong>WhatsApp</strong><div>${esc(m.whatsapp_number || "—")}</div></div>
      <div><strong>Zone de livraison</strong><div>${esc(m.delivery_zone || "—")}</div></div>
      <div><strong>Niveau de confiance</strong><div>${esc(m.trust_level || "—")}</div></div>
      <div><strong>Score de confiance</strong><div>${esc(m.trust_score ?? "—")}</div></div>
      <div><strong>Évaluation</strong><div>${
        Number(m.average_rating) ? Number(m.average_rating).toFixed(1) + "/5" : "Nouveau"
      } (${esc(m.rating_count ?? 0)} avis)</div></div>
      <div style="grid-column:1/-1"><strong>Description</strong><div>${esc(m.description || "—")}</div></div>
    </div>`;

  const f = $("#mcShopForm");
  if (f) {
    $("#msShopName").value = m.shop_name || "";
    $("#msDescription").value = m.description || "";
    $("#msWhatsapp").value = m.whatsapp_number || "";
    $("#msZone").value = m.delivery_zone || "";
  }
}

async function saveProfile(e) {
  e.preventDefault();
  const btn = $("#msSave");
  const msg = $("#mcShopMsg");
  if (msg) msg.style.display = "none";
  const original = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Enregistrement…";
  }
  try {
    await MC.updateMyMerchantProfile({
      shopName: ($("#msShopName").value || "").trim() || null,
      description: ($("#msDescription").value || "").trim() || null,
      whatsappNumber: ($("#msWhatsapp").value || "").trim() || null,
      deliveryZone: ($("#msZone").value || "").trim() || null,
    });
    MERCHANT = await MC.getMyMerchant();
    renderProfile(MERCHANT);
    renderDemoPayout(MERCHANT);
    renderBilling(MERCHANT);
    $("#mcShopForm").hidden = true;
    toast("Profil boutique mis à jour ✓");
  } catch (err) {
    console.warn("[VinHT] maj profil:", err && (err.message || err));
    if (msg) {
      msg.textContent = mapErr(err, "La mise à jour du profil a échoué.");
      msg.style.display = "";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || "Enregistrer";
    }
  }
}

// ---------------------------------------------------------------------------
// Produits
// ---------------------------------------------------------------------------
function productCard(p) {
  const badgeColor =
    p.approval_status === "approved"
      ? "var(--green,#25a844)"
      : p.approval_status === "rejected"
      ? "var(--red,#f31938)"
      : "var(--blue,#0b2edc)";
  const wholesale =
    p.wholesale_price != null && p.wholesale_min_qty
      ? `<div style="font-size:12px;color:var(--blue,#0b2edc)">Gros : ${money(p.wholesale_price, p.currency)} dès ${esc(
          p.wholesale_min_qty
        )}</div>`
      : "";
  const rej = p.rejection_reason
    ? `<div style="font-size:12px;color:var(--red,#f31938);margin-top:4px"><strong>Motif de refus :</strong> ${esc(
        p.rejection_reason
      )}</div>`
    : "";

  const images = Array.isArray(p.product_images) ? p.product_images : [];
  const gallery = images.length
    ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px">${images.map((im) => `<img src="${esc(productImageUrl(im.storage_path))}" alt="${esc(p.name)}" style="width:54px;height:54px;object-fit:cover;border:1px solid var(--line,#e7eaf2);border-radius:8px">`).join("")}</div>`
    : "";
  const remaining = Math.max(0, 5 - images.length);
  const imgBlock = `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
       <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple data-img-file ${remaining ? "" : "disabled"}>
       <button class="btn btn-outline-blue" type="button" data-img-upload style="padding:8px 12px;font-size:12px" ${remaining ? "" : "disabled"}>Ajouter des images</button>
       <span style="font-size:11px;color:var(--muted,#6f7891)">${images.length} / 5 image(s)</span>
     </div>${gallery}`;

  const thumb = productImageUrl(p.primary_image_path) || PLACEHOLDER_IMG;
  return `<div class="surface" data-product="${esc(p.id)}" style="padding:16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="display:flex;gap:12px;align-items:flex-start;min-width:0">
        <img data-product-thumb src="${esc(thumb)}" alt="${esc(p.name)}" style="width:56px;height:56px;flex:0 0 auto;object-fit:contain;background:var(--soft,#f6f8fc);border-radius:8px;border:1px solid var(--line,#e7eaf2)">
        <div style="min-width:0">
        <strong>${esc(p.name)}</strong>
        <div style="font-size:12px;color:var(--muted,#6f7891)">SKU ${esc(p.sku || "—")} · ${esc(catName(p.category_id))} · ${esc(
    fmtDate(p.created_at)
  )}</div>
        </div>
      </div>
      <div style="text-align:right">
        <span style="font-size:11px;font-weight:800;color:${badgeColor}">${esc(labelOr(APPROVAL_FR, p.approval_status))}</span>
        <div style="font-size:11px;color:var(--muted,#6f7891)">${p.is_active ? "Actif" : "Inactif"}</div>
      </div>
    </div>
    <div style="margin-top:6px;font-size:13px">Détail : ${money(p.retail_price, p.currency)}</div>
    ${wholesale}
    ${rej}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label style="font-size:12px">Stock <input type="number" min="0" step="1" value="${esc(
        p.stock ?? 0
      )}" data-stock-input style="width:90px;padding:6px 8px;border:1px solid var(--line,#e7eaf2);border-radius:8px"></label>
      <button class="btn btn-outline-blue" type="button" data-stock-save style="padding:8px 12px;font-size:12px">Mettre à jour le stock</button>
      <button class="btn btn-outline-blue" type="button" data-variants-edit style="padding:8px 12px;font-size:12px">Variantes</button>
      <button class="btn btn-outline-red" type="button" data-content-edit style="padding:8px 12px;font-size:12px">Modifier le contenu</button>
    </div>
    <p data-stock-variant-note hidden style="font-size:11px;color:var(--muted,#6f7891);margin:6px 0 0">Le stock de ce produit est géré par ses variantes. Modifiez le stock dans Variantes.</p>
    ${imgBlock}
    <div data-variants-form hidden style="margin-top:10px;border-top:1px solid var(--line,#e7eaf2);padding-top:10px"></div>
    <div data-content-form hidden style="margin-top:10px;border-top:1px solid var(--line,#e7eaf2);padding-top:10px"></div>
    <div data-product-msg style="display:none;font-size:12px;color:var(--red,#f31938);margin-top:8px"></div>
  </div>`;
}

function wireProductCard(card, p) {
  const msg = card.querySelector("[data-product-msg]");
  const showMsg = (t, ok) => {
    msg.textContent = t;
    msg.style.color = ok ? "var(--green,#25a844)" : "var(--red,#f31938)";
    msg.style.display = t ? "" : "none";
  };

  // Stock produit historique (RPC sûr) — désactivé pour un produit varianté :
  // le backend refuse déjà merchant_set_product_stock dans ce cas, et l'inventaire
  // réel vit dans les variantes. La valeur reste affichée en lecture seule.
  const stockInput = card.querySelector("[data-stock-input]");
  const stockSave = card.querySelector("[data-stock-save]");
  const stockNote = card.querySelector("[data-stock-variant-note]");

  function setStockEditable(editable) {
    if (stockInput) {
      stockInput.disabled = !editable;
      stockInput.style.opacity = editable ? "" : "0.6";
    }
    if (stockSave) {
      stockSave.disabled = !editable;
      stockSave.style.opacity = editable ? "" : "0.6";
    }
    if (stockNote) stockNote.hidden = editable;
  }

  stockSave.addEventListener("click", async () => {
    if (stockSave.disabled) return;
    const val = stockInput.value;
    showMsg("");
    try {
      await MC.setProductStock(p.id, val);
      showMsg("Stock mis à jour ✓", true);
    } catch (err) {
      console.warn("[VinHT] stock:", err && (err.message || err));
      showMsg(mapErr(err, "Mise à jour du stock impossible."));
    }
  });

  // Détermine l'état éditable d'après le backend (jamais calculé côté frontend).
  MC.getProductVariants(p.id)
    .then((vc) => setStockEditable(!vc.has_variants))
    .catch(() => {
      /* lecture des variantes indisponible : on garde le champ éditable */
    });

  // Images : 1 à 5 au total, y compris pour un produit déjà vérifié.
  const upBtn = card.querySelector("[data-img-upload]");
  if (upBtn) {
    upBtn.addEventListener("click", async () => {
      const input = card.querySelector("[data-img-file]");
      const files = Array.from((input && input.files) || []);
      showMsg("");
      if (!files.length) return showMsg("Choisissez au moins une image.");
      const start = Array.isArray(p.product_images) ? p.product_images.length : 0;
      if (start + files.length > 5) return showMsg(`Maximum 5 images : vous pouvez encore en ajouter ${Math.max(0, 5 - start)}.`);
      for (const file of files) { try { MC.validateImageFile(file); } catch (e) { return showMsg(`${file.name} : ${imgErr(e)}`); } }
      upBtn.disabled = true;
      const t = upBtn.textContent;
      upBtn.textContent = "Envoi…";
      try {
        const added = [], failed = [];
        for (let i = 0; i < files.length; i += 1) {
          try {
            await MC.uploadProductImage({ merchantId: MERCHANT.id, productId: p.id, file: files[i], altText: p.name, position: start + i, isPrimary: start === 0 && i === 0 });
            added.push(files[i].name);
          } catch (err) { failed.push(`${files[i].name} (${imgErr(err)})`); }
        }
        showMsg(failed.length ? `${added.length} image(s) ajoutée(s). Échec : ${failed.join(", ")}. Le produit existe toujours ; réessayez ces fichiers.` : `${added.length} image(s) ajoutée(s) ✓`, !failed.length);
        input.value = "";
        // Rafraîchit la carte pour afficher la nouvelle vignette primaire.
        const thumb = card.querySelector("[data-product-thumb]");
        if (thumb) {
          try {
            const fresh = await MC.getMyProducts(MERCHANT.id);
            const up = fresh.find((x) => x.id === p.id);
            const url = up && productImageUrl(up.primary_image_path);
            if (url) thumb.src = url;
          } catch (e) {
            /* la vignette apparaîtra au prochain chargement */
          }
        }
        if (!failed.length) loadProducts();
      } catch (err) {
        console.warn("[VinHT] upload images:", err && (err.message || err), err && err.cause);
        showMsg("Téléversement interrompu. Le produit existe toujours ; réessayez.");
      } finally {
        upBtn.disabled = false;
        upBtn.textContent = t;
      }
    });
  }

  // Variantes -> éditeur dédié (structure vs stock, cf. productVariantsEditor)
  card.querySelector("[data-variants-edit]")?.addEventListener("click", () => {
    const box = card.querySelector("[data-variants-form]");
    if (!box) return;
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    renderProductVariantsEditor(box, p, {
      onChange: () => {
        // Une modif de structure peut changer approval_status / is_active :
        // on recharge la liste pour refléter l'état réel renvoyé par le backend.
        loadProducts();
      },
    });
  });

  // Modifier le contenu -> avertissement + formulaire -> retour en révision
  card.querySelector("[data-content-edit]").addEventListener("click", () => {
    const box = card.querySelector("[data-content-form]");
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    const ok = window.confirm(
      "Les modifications seront signalées à VinHT pour un nouveau contrôle. Le produit reste visible pendant le contrôle, sauf s'il avait déjà été retiré par VinHT. Continuer ?"
    );
    if (!ok) return;
    box.innerHTML = `
      <div style="font-size:12px;color:var(--muted,#6f7891);margin-bottom:8px">Après enregistrement : statut « À vérifier ». Le produit reste visible pendant le contrôle, sauf s'il avait déjà été retiré par VinHT.</div>
      <div class="customer-grid">
        <div class="field"><label>Nom</label><input data-ce-name value="${esc(p.name || "")}"></div>
        <div class="field"><label>Accroche</label><input data-ce-tagline value="${esc(p.tagline || "")}"></div>
        <div class="field"><label>Prix détail (HTG)</label><input type="number" min="0" step="0.01" data-ce-retail value="${esc(
          p.retail_price ?? ""
        )}"></div>
        <div class="field"><label>Prix de gros (HTG)</label><input type="number" min="0" step="0.01" data-ce-wprice value="${esc(
          p.wholesale_price ?? ""
        )}"></div>
        <div class="field"><label>Qté min. de gros</label><input type="number" min="1" step="1" data-ce-wqty value="${esc(
          p.wholesale_min_qty ?? ""
        )}"></div>
        <div class="field"><label>Prix barré (HTG)</label><input type="number" min="0" step="0.01" data-ce-compare value="${esc(
          p.compare_at_price ?? ""
        )}"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>Description</label><input data-ce-desc value="${esc(p.description || "")}"></div>
      <button class="btn btn-blue" type="button" data-ce-save style="margin-top:10px;padding:9px 16px;font-size:13px">Enregistrer les modifications</button>`;
    box.hidden = false;
    box.querySelector("[data-ce-save]").addEventListener("click", async () => {
      showMsg("");
      try {
        await MC.updateProductContent(p.id, {
          name: box.querySelector("[data-ce-name]").value,
          tagline: box.querySelector("[data-ce-tagline]").value,
          description: box.querySelector("[data-ce-desc]").value,
          retailPrice: box.querySelector("[data-ce-retail]").value,
          wholesalePrice: box.querySelector("[data-ce-wprice]").value,
          wholesaleMinQty: box.querySelector("[data-ce-wqty]").value,
          compareAtPrice: box.querySelector("[data-ce-compare]").value,
        });
        toast("Modifications enregistrées — contrôle VinHT demandé ✓");
        loadProducts();
      } catch (err) {
        console.warn("[VinHT] edit contenu:", err && (err.message || err));
        showMsg(mapErr(err, "Enregistrement impossible."));
      }
    });
  });
}

async function loadProducts() {
  const host = $("#mcProductsHost");
  if (!host || !MERCHANT) return;
  host.innerHTML = `<div class="surface" style="padding:28px;text-align:center;color:var(--muted,#6f7891)">Chargement des produits…</div>`;
  try {
    const products = await MC.getMyProducts(MERCHANT.id);
    if (!products.length) {
      host.innerHTML = `<div class="surface" style="padding:28px;text-align:center;color:var(--muted,#6f7891)">Aucun produit pour l'instant. Ajoutez votre premier produit ci-dessous.</div>`;
      return;
    }
    host.innerHTML = products.map(productCard).join("");
    host.querySelectorAll("[data-product]").forEach((card) => {
      const id = card.dataset.product;
      const p = products.find((x) => x.id === id);
      if (p) wireProductCard(card, p);
    });
  } catch (err) {
    console.warn("[VinHT] produits marchand:", err && (err.message || err));
    host.innerHTML = `<div class="surface" style="padding:28px;text-align:center">
      <p style="color:var(--red,#b0122a);font-size:13px;margin:0 0 12px">Impossible de charger vos produits.</p>
      <button class="btn btn-outline-blue" type="button" id="mcProductsRetry">Réessayer</button></div>`;
    $("#mcProductsRetry")?.addEventListener("click", loadProducts);
  }
}

function fillCreateCategories() {
  const sel = $("#pcCategory");
  if (!sel) return;
  for (const c of CATEGORIES) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name;
    sel.appendChild(o);
  }
}

function categoryVariantSuggestions() {
  const label = String($("#pcCategory")?.selectedOptions?.[0]?.textContent || "").toLowerCase();
  if (/vêtement|mode|habillement/.test(label)) return ["Taille", "Couleur"];
  if (/chauss/.test(label)) return ["Pointure", "Couleur"];
  if (/téléphone|electron|électron|informatique/.test(label)) return ["Stockage", "Couleur", "RAM"];
  if (/beauté|cosmétique/.test(label)) return ["Teinte", "Volume"];
  return [];
}

function setupNewProductEnhancements() {
  const form = $("#mcProductForm");
  if (!form || form.querySelector("#pcImages")) return;
  const grid = form.querySelector(".customer-grid");
  if (!grid) return;
  const images = document.createElement("div");
  images.className = "field";
  images.style.gridColumn = "1/-1";
  images.innerHTML = `<label>Images du produit * (1 à 5)</label><input id="pcImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required><small id="pcImageCount">0 / 5 image</small><div id="pcImagePreviews" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>`;
  grid.appendChild(images);
  const variants = document.createElement("div");
  variants.id = "pcVariantsBuilder";
  variants.style.gridColumn = "1/-1";
  grid.appendChild(variants);
  const rebuild = () => { NEW_VARIANTS = renderNewProductVariantsBuilder(variants, { skuBase: $("#pcSku")?.value || $("#pcName")?.value || "SKU", suggestions: categoryVariantSuggestions() }); };
  rebuild();
  $("#pcCategory")?.addEventListener("change", rebuild);
  const input = $("#pcImages");
  input?.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    const count = $("#pcImageCount");
    const previews = $("#pcImagePreviews");
    if (files.length > 5) { input.value = ""; if (count) { count.textContent = "Maximum 5 images. Sélection refusée."; count.style.color = "var(--red,#f31938)"; } if (previews) previews.innerHTML = ""; return; }
    if (count) { count.textContent = `${files.length} / 5 image(s)`; count.style.color = ""; }
    if (previews) previews.innerHTML = files.map((file) => `<figure style="margin:0;width:78px"><img src="${URL.createObjectURL(file)}" alt="${esc(file.name)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px"><figcaption style="font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</figcaption></figure>`).join("");
  });
  const submit = $("#pcSubmit");
  if (submit) submit.textContent = "Publier le produit";
}

async function handleCreateProduct(e) {
  e.preventDefault();
  const btn = $("#pcSubmit");
  const msg = $("#mcCreateMsg");
  const setMsg = (t, ok) => {
    if (!msg) return;
    msg.textContent = t || "";
    msg.style.color = ok ? "var(--green,#25a844)" : "var(--red,#f31938)";
    msg.style.display = t ? "" : "none";
  };
  setMsg("");

  const files = Array.from($("#pcImages")?.files || []);
  if (!files.length) return setMsg("Ajoutez au moins une image du produit.");
  if (files.length > 5) return setMsg("Maximum 5 images. Retirez les fichiers en trop.");
  for (const file of files) { try { MC.validateImageFile(file); } catch (err) { return setMsg(`${file.name} : ${imgErr(err)}`); } }
  const variants = NEW_VARIANTS?.getVariants?.() || [];
  if (NEW_VARIANTS?.isEnabled?.() && !variants.length) return setMsg("Générez au moins une combinaison de variantes.");

  const kw = ($("#pcKeywords").value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const original = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Envoi…";
  }
  try {
    const p = await MC.createProduct({
      merchantId: MERCHANT.id,
      name: $("#pcName").value,
      categoryId: $("#pcCategory").value,
      currency: $("#pcCurrency")?.value || "HTG",
      retailPrice: $("#pcRetail").value,
      stock: $("#pcStock").value,
      sku: $("#pcSku").value,
      tagline: $("#pcTagline").value,
      description: $("#pcDesc").value,
      wholesalePrice: $("#pcWPrice").value,
      wholesaleMinQty: $("#pcWQty").value,
      compareAtPrice: $("#pcCompare").value,
      deliveryZone: $("#pcZone").value,
      estimatedDeliveryDays: $("#pcDeliveryDays").value,
      searchKeywords: kw,
    });
    const added = [], failed = [];
    for (let i = 0; i < files.length; i += 1) {
      try { await MC.uploadProductImage({ merchantId: MERCHANT.id, productId: p.id, file: files[i], altText: p.name, position: i, isPrimary: i === 0 }); added.push(files[i].name); }
      catch (err) { failed.push({ file: files[i], detail: `${files[i].name} (${imgErr(err)})` }); }
    }
    let variantError = null;
    if (variants.length) { try { await MC.replaceProductVariants(p.id, variants); } catch (err) { variantError = err; } }
    if (failed.length || variantError) {
      const details = [`Produit publié sur VinHT ✓`, `${added.length}/${files.length} image(s) ajoutée(s).`, failed.length ? `À réessayer depuis sa carte produit : ${failed.map((x) => x.detail).join(", ")}.` : "", variantError ? `Variantes non enregistrées : ${mapErr(variantError, "réessayez depuis la fiche produit")}.` : ""].filter(Boolean).join(" ");
      setMsg(details, false);
      toast("Produit publié, mais certaines étapes sont à réessayer.", "amber");
    } else {
      setMsg("Produit publié sur VinHT ✓ Il est déjà en vente et sera contrôlé par VinHT.", true);
      $("#mcProductForm").reset();
      const previews = $("#pcImagePreviews"); if (previews) previews.innerHTML = "";
      const count = $("#pcImageCount"); if (count) count.textContent = "0 / 5 image";
      const variantsHost = $("#pcVariantsBuilder");
      if (variantsHost) NEW_VARIANTS = renderNewProductVariantsBuilder(variantsHost, { skuBase: "SKU", suggestions: [] });
      toast("Produit publié sur VinHT ✓");
    }
    loadProducts();
  } catch (err) {
    console.warn("[VinHT] création produit:", err && (err.message || err));
    setMsg(mapCreateErr(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || "Publier le produit";
    }
  }
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
function moCard(mo, order, items) {
  const cust = order || {};
  const addr =
    cust.delivery_address && typeof cust.delivery_address === "object"
      ? [cust.delivery_address.address, cust.delivery_address.city].filter(Boolean).join(", ")
      : "";
  const next = MC.nextOrderStatus(mo.status);
  const itemsHtml = items.length
    ? items
        .map(
          (it) => `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line,#e7eaf2)">
        <img src="${esc(productImageUrl(it.product_image_path) || PLACEHOLDER_IMG)}" alt="${esc(
            it.product_name || "Produit"
          )}" style="width:40px;height:40px;object-fit:contain;background:var(--soft,#f6f8fc);border-radius:8px">
        <div style="flex:1;min-width:0">
          <strong style="font-size:12px">${esc(it.product_name || "Produit")}</strong>
          <div style="font-size:11px;color:var(--muted,#6f7891)">Qté ${esc(it.quantity ?? "—")}${
            it.pricing_tier === "wholesale" ? " · gros" : ""
          } · PU ${money(it.unit_price_htg)}</div>
        </div>
        <strong style="font-size:12px">${money(it.line_total_htg)}</strong>
      </div>`
        )
        .join("")
    : `<div style="font-size:12px;color:var(--muted,#6f7891);padding:8px 0">Aucun article listé.</div>`;

  return `<div class="surface" data-mo="${esc(mo.id)}" style="padding:16px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <strong>Commande #${esc(shortId(mo.id))}</strong>${
          String(mo.environment || "").toLowerCase() === "demo" ? ' <span class="badge amber">MODE DEMO</span>' : ""
        }
        <div style="font-size:12px;color:var(--muted,#6f7891)">${esc(fmtDate(mo.created_at))}</div>
      </div>
      <div style="text-align:right">
        <span style="font-size:12px;font-weight:800;color:var(--blue,#0b2edc)">${esc(labelOr(OFLOW_FR, mo.status))}</span>
        <div style="font-size:12px;color:var(--muted,#6f7891)">Sous-total marchand : ${money(mo.subtotal_htg)}</div>
      </div>
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--muted,#6f7891)">
      <div><strong>Client :</strong> ${esc(cust.full_name || "—")} · ${esc(cust.phone || "—")}</div>
      <div><strong>Livraison :</strong> ${esc(labelOr(DELIVERY_FR, cust.delivery_type))}${addr ? " — " + esc(addr) : ""}</div>
      ${
        cust.delivery_notes
          ? `<div><strong>Note :</strong> ${esc(cust.delivery_notes)}</div>`
          : ""
      }
    </div>
    <div style="margin-top:6px">${itemsHtml}</div>
    <div style="margin-top:8px;font-size:11px;color:var(--muted,#6f7891)">
      Commission plateforme : ${money(mo.platform_commission_htg)} · Frais/article : ${money(
    mo.per_item_fee_htg
  )}<br>
      Versement : <strong>${esc(mo.payout_status || "—")}</strong> · Montant : ${money(mo.payout_amount_htg)}${
    mo.payout_provider ? ` · via ${esc(mo.payout_provider)}${mo.payout_environment ? ` (${esc(mo.payout_environment)})` : ""}` : ""
  }${mo.payout_reference ? `<br>Référence : ${esc(mo.payout_reference)}` : ""}${
    mo.payout_paid_at ? `<br>Versé le ${esc(fmtDate(mo.payout_paid_at))}` : ""
  }${mo.payout_error ? `<br><span style="color:var(--red,#f31938)">Erreur versement : ${esc(mo.payout_error)}</span>` : ""}
    </div>
    ${
      next
        ? `<button class="btn btn-blue" type="button" data-advance="${esc(next)}" style="margin-top:10px;padding:9px 16px;font-size:13px">Passer à : ${esc(
            labelOr(OFLOW_FR, next)
          )}</button>`
        : `<div style="margin-top:10px;font-size:12px;color:var(--muted,#6f7891)">Étape marchand terminée.</div>`
    }
    <div data-mo-msg style="display:none;font-size:12px;margin-top:8px"></div>
  </div>`;
}

async function loadOrders() {
  const host = $("#mcOrdersHost");
  if (!host || !MERCHANT) return;
  host.innerHTML = `<div class="surface" style="padding:28px;text-align:center;color:var(--muted,#6f7891)">Chargement des commandes…</div>`;
  try {
    const mos = await MC.getMerchantOrders(MERCHANT.id);
    if (!mos.length) {
      host.innerHTML = `<div class="surface" style="padding:28px;text-align:center;color:var(--muted,#6f7891)">Aucune commande pour l'instant.</div>`;
      return;
    }
    const [items, orders] = await Promise.all([
      MC.getMerchantOrderItems(mos.map((m) => m.id)).catch(() => []),
      MC.getOrdersByIds(mos.map((m) => m.order_id)).catch(() => []),
    ]);
    const itemsByMo = items.reduce((acc, it) => {
      (acc[it.merchant_order_id] = acc[it.merchant_order_id] || []).push(it);
      return acc;
    }, {});
    const orderById = orders.reduce((acc, o) => ((acc[o.id] = o), acc), {});

    host.innerHTML = mos
      .map((mo) => moCard(mo, orderById[mo.order_id], itemsByMo[mo.id] || []))
      .join("");

    host.querySelectorAll("[data-mo]").forEach((card) => {
      const moId = card.dataset.mo;
      const btn = card.querySelector("[data-advance]");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        const target = btn.dataset.advance;
        const m = card.querySelector("[data-mo-msg]");
        btn.disabled = true;
        try {
          await MC.updateMerchantOrderStatus(moId, target);
          toast("Statut de commande mis à jour ✓");
          loadOrders();
        } catch (err) {
          console.warn("[VinHT] statut commande:", err && (err.message || err));
          if (m) {
            m.textContent = mapErr(err, "Mise à jour du statut impossible.");
            m.style.color = "var(--red,#f31938)";
            m.style.display = "";
          }
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    console.warn("[VinHT] commandes marchand:", err && (err.message || err));
    host.innerHTML = `<div class="surface" style="padding:28px;text-align:center">
      <p style="color:var(--red,#b0122a);font-size:13px;margin:0 0 12px">Impossible de charger les commandes.</p>
      <button class="btn btn-outline-blue" type="button" id="mcOrdersRetry">Réessayer</button></div>`;
    $("#mcOrdersRetry")?.addEventListener("click", loadOrders);
  }
}

// ---------------------------------------------------------------------------
// Erreurs
// ---------------------------------------------------------------------------
function mapErr(err, fallback) {
  const code = err && err.code ? String(err.code) : "";
  const m = String((err && (err.message || err.details)) || "").toLowerCase();
  if (code === "42501" || /permission denied|not-authenticated|jwt|rls/.test(m + " " + code))
    return "Action non autorisée. Reconnectez-vous.";
  if (/23505|duplicate key|unique/.test(m)) return "Conflit : cette valeur existe déjà.";
  if (/network|fetch failed|timeout/.test(m))
    return "Connexion impossible. Vérifiez votre réseau.";
  return fallback || "L'opération a échoué.";
}
function mapCreateErr(err) {
  const m = String((err && (err.message || err.details)) || "").toLowerCase();
  if (/name-required/.test(m)) return "Le nom du produit est requis.";
  if (/category-required/.test(m)) return "Choisissez une catégorie.";
  if (/currency-invalid|unsupported_product_currency/.test(m)) return "Choisissez une devise valide : HTG ou USD.";
  if (/usd_per_item_fee_policy_not_configured/.test(m)) return "La tarification USD de votre plan n’est pas encore configurée par VinHT. Demandez à l’administration de définir le frais USD par article.";
  if (/retail-invalid/.test(m)) return "Le prix détail doit être un nombre ≥ 0.";
  if (/stock-invalid/.test(m)) return "Le stock doit être un entier ≥ 0.";
  if (/wholesale-pair/.test(m))
    return "Prix de gros : renseignez le prix ET la quantité minimale (prix ≥ 0, quantité > 0), ou laissez les deux vides.";
  if (/products_merchant_env_sku_unique/.test(m)) return "Ce SKU est déjà utilisé par un autre produit de votre boutique.";
  if (/23505|duplicate key|slug/.test(m)) return "Conflit d'identifiant produit. Réessayez.";
  return mapErr(err, "La création du produit a échoué.");
}
function imgErr(err) {
  const m = String((err && err.message) || "").toLowerCase();
  if (/bad-mime/.test(m)) return "Format non accepté (JPEG, PNG, WebP ou GIF).";
  if (/too-big/.test(m)) return "Fichier trop lourd (10 Mo maximum).";
  if (/no-file/.test(m)) return "Aucun fichier sélectionné.";
  if (/storage-failed/.test(m))
    return "Échec du téléversement. Le produit est enregistré — réessayez l'image.";
  if (/image-row-failed/.test(m))
    return "Image envoyée mais non enregistrée. Réessayez.";
  return "Téléversement de l'image impossible.";
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function hasFlexicashReturn() {
  try { return new URLSearchParams(location.search).get("flexicash_connect") === "return"; }
  catch { return false; }
}
// Correction ChatGPT — CTA onboarding "Configurer vos paiements" : la section
// #mcFlexicash existe mais son contenu est rendu de façon asynchrone et n'est
// pas visible avant ce rendu. On ne fait défiler qu'une fois le rendu terminé
// et le Merchant Center effectivement affiché, jamais avant.
async function renderFlexicashSection() {
  const host = $("#mcFlexicash");
  if (!host) return;
  if (hasFlexicashReturn()) await handleFlexicashConnectReturn(host);
  else await renderFlexicashConnectCard(host);
  if (window.location.hash === "#mcFlexicash") {
    requestAnimationFrame(() => host.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

async function boot() {
  if (!isSupabaseConfigured()) {
    showGate(
      `<div class="surface" style="padding:36px;text-align:center"><p style="margin:0;color:var(--muted,#6f7891)">Service indisponible : configuration manquante.</p></div>`
    );
    return;
  }

  const session = await getActiveSession();
  if (!session) {
    showGate(`<div class="surface" style="padding:40px 24px;text-align:center">
      <h3 style="margin:0 0 8px">Connexion requise</h3>
      <p style="margin:0 0 18px;color:var(--muted,#6f7891);font-size:13px">Connectez-vous pour accéder à votre espace marchand.</p>
      <button class="btn btn-blue" type="button" id="mcLoginBtn">Se connecter</button></div>`);
    $("#mcLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }

  // Skeleton discret pendant la résolution du contexte d'accès — seulement si
  // le contenu n'est pas déjà affiché (évite un flash sur re-boot auth).
  if (!$("#mcContent") || $("#mcContent").style.display === "none") {
    showGate(`<div class="surface" style="padding:36px;text-align:center;color:var(--muted,#6f7891)">Chargement de votre espace marchand…</div>`);
  }
  const ctx = await getMyAccessContext();
  const access = ctx.merchant_access || {};

  document.querySelector("#mcContent [data-merchant-banner]")?.remove();
  if (!ctx.capabilities?.can_open_merchant_center) {
    // États bloquants gérés par le backend : demande pending / rejected,
    // provisioning, boutique fermée, pas encore marchand, indisponible.
    showGate(`<div class="surface" style="padding:36px 24px">${merchantBlockedHtml(access, { rootPrefix: "", application: ctx.latest_merchant_application })}</div>`);
    $("#mcState")?.querySelector("[data-merchant-access-retry]")?.addEventListener("click", boot);
    refreshIcons();
    return;
  }

  try {
    MERCHANT = await MC.getMyMerchant();
  } catch (err) {
    console.warn("[VinHT] merchant:", err && (err.message || err));
    showGate(`<div class="surface" style="padding:36px;text-align:center">
      <p style="margin:0 0 12px;color:var(--red,#b0122a);font-size:13px">Impossible de vérifier votre compte marchand.</p>
      <button class="btn btn-outline-blue" type="button" id="mcBootRetry">Réessayer</button></div>`);
    $("#mcBootRetry")?.addEventListener("click", boot);
    return;
  }

  if (!MERCHANT) {
    showGate(`<div class="surface" style="padding:36px 24px">${merchantBlockedHtml(access, { rootPrefix: "", application: ctx.latest_merchant_application })}</div>`);
    refreshIcons();
    return;
  }

  showContent();
  // Bandeau non bloquant si la boutique est en pause / suspendue.
  {
    const c = $("#mcContent");
    c?.querySelector("[data-merchant-banner]")?.remove();
    if (merchantSpaceIsReachable(access.state) && access.state !== "active") {
      const d = document.createElement("div");
      d.setAttribute("data-merchant-banner", "");
      d.innerHTML = merchantBannerHtml(access);
      c?.prepend(d);
      refreshIcons();
    }
  }
  try {
    CATEGORIES = await getCategories();
  } catch (e) {
    CATEGORIES = [];
  }
  fillCreateCategories();
  setupNewProductEnhancements();
  renderProfile(MERCHANT);
  renderDemoPayout(MERCHANT);
  renderBilling(MERCHANT);
  await renderFlexicashSection();
  // Le popup de lancement est réservé à un vrai espace marchand déjà créé.
  // Jamais sur une candidature pending/provisioning.
  await maybeShowMerchantLaunchOffer({ merchantKey: MERCHANT.id });

  // initMerchantCenter() peut appeler boot() deux fois au chargement (appel
  // direct + premier callback onAuthChange, cf. commentaire plus bas) : ces
  // boutons vivent dans le HTML statique de la page (jamais recréés par un
  // re-render), donc un ré-attachement sans garde ferait déclencher chaque
  // toggle deux fois par clic réel — et s'annulerait silencieusement.
  const shopEditBtn = $("#mcShopEdit");
  if (shopEditBtn && !shopEditBtn.dataset.wired) {
    shopEditBtn.dataset.wired = "1";
    shopEditBtn.addEventListener("click", () => {
      const f = $("#mcShopForm");
      if (f) f.hidden = !f.hidden;
    });
  }
  const shopForm = $("#mcShopForm");
  if (shopForm && !shopForm.dataset.wired) {
    shopForm.dataset.wired = "1";
    shopForm.addEventListener("submit", saveProfile);
  }
  const productForm = $("#mcProductForm");
  if (productForm && !productForm.dataset.wired) {
    productForm.dataset.wired = "1";
    productForm.addEventListener("submit", handleCreateProduct);
  }
  const addProductToggleBtn = $("#mcAddProductToggle");
  if (addProductToggleBtn && !addProductToggleBtn.dataset.wired) {
    addProductToggleBtn.dataset.wired = "1";
    addProductToggleBtn.addEventListener("click", () => {
      const w = $("#mcProductFormWrap");
      if (!w) return;
      w.hidden = !w.hidden;
      // Le formulaire s'ouvre juste après la liste de produits : sans ça,
      // sur un catalogue déjà rempli ou en bas de section mobile, il
      // apparaît hors écran et le clic donne l'impression de n'avoir rien
      // fait.
      if (!w.hidden) {
        w.scrollIntoView({ behavior: "smooth", block: "start" });
        $("#pcName")?.focus({ preventScroll: true });
      }
    });
  }

  loadProducts();
  loadOrders();
}

let _mcLastUid = null;
let _mcBooted = false;
export function initMerchantCenter() {
  if (!$("#mcContent")) return; // pas merchant-center.html
  boot();
  // Re-boot uniquement sur un vrai changement d'utilisateur (login / logout),
  // pas sur chaque INITIAL_SESSION / TOKEN_REFRESHED.
  onAuthChange((session) => {
    const uid = (session && session.user && session.user.id) || null;
    if (_mcBooted && uid === _mcLastUid) return;
    _mcBooted = true;
    _mcLastUid = uid;
    boot();
  });
}
