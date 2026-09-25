// account.html — espace client authentifié : "Mes commandes".
//
// Lecture via le client Supabase authentifié ; RLS restreint aux lignes du
// client. Aucun filtre user_id fourni par l'UI. Aucune donnée fabriquée.

import { $ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import {
  getMyOrders,
  getOrderItems,
  getOrderItemsByOrderIds,
} from "../services/orders.js";
import { productImageUrl, getProductsByIds } from "../services/catalog.js";
import { getActiveSession } from "../services/orders.js";
import { onAuthChange, isSupabaseConfigured } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { getMyWishlist, removeFromWishlist } from "../services/wishlist.js";
import { showToast } from "../ui/toast.js";
import { getMyAccessContext } from "../services/access.js";
import { refreshIcons } from "../lib/icons.js";

const PLACEHOLDER_IMG = "assets/abstract-brand.jpg";

const ORDER_STATUS_FR = {
  pending: "En attente",
  confirmed: "Confirmée",
  processing: "En préparation",
  preparing: "En préparation",
  ready: "Prête",
  shipped: "Expédiée",
  in_transit: "En transit",
  out_for_delivery: "En cours de livraison",
  delivered: "Livrée",
  completed: "Terminée",
  cancelled: "Annulée",
  canceled: "Annulée",
  refunded: "Remboursée",
  rejected: "Refusée",
};
const PAYMENT_STATUS_FR = {
  pending: "Paiement en attente",
  paid: "Payé",
  processing: "Paiement en cours",
  failed: "Paiement échoué",
  refunded: "Remboursé",
  cancelled: "Paiement annulé",
  canceled: "Paiement annulé",
};
const DELIVERY_FR = {
  home: "Livraison à domicile",
  vinht_pickup: "Point de retrait VinHT",
  custom_location: "Adresse personnalisée",
};
const PAYMENT_METHOD_FR = {
  flexicash: "FlexiCash",
  flexicard: "FlexiCard",
  vinht_balance: "Solde VinHT",
  other: "Autre moyen",
};

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

function stateBox(kind, { title, text, retry } = {}) {
  const h = title ? `<h3 style="margin:0 0 6px">${esc(title)}</h3>` : "";
  const p = text ? `<p style="margin:0;color:var(--muted,#6f7891);font-size:13px">${esc(text)}</p>` : "";
  const b =
    kind === "error" && retry
      ? `<button class="btn btn-outline-blue" type="button" data-orders-retry style="margin-top:14px">Réessayer</button>`
      : "";
  const a =
    kind === "empty"
      ? `<a class="btn btn-blue" href="index.html" style="margin-top:14px">Découvrir le catalogue</a>`
      : "";
  return `<div class="surface" style="padding:36px 22px;text-align:center">${h}${p}${b}${a}</div>`;
}

function itemRow(it) {
  const img = productImageUrl(it.product_image_path) || PLACEHOLDER_IMG;
  const tier = it.pricing_tier === "wholesale" ? " · gros" : "";
  return `<div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line,#e7eaf2)">
    <img src="${esc(img)}" alt="${esc(it.product_name || "Produit")}" style="width:46px;height:46px;object-fit:contain;background:var(--soft,#f6f8fc);border-radius:8px">
    <div style="flex:1;min-width:0">
      <strong style="font-size:13px">${esc(it.product_name || "Produit")}</strong>
      <div style="font-size:11px;color:var(--muted,#6f7891)">Qté ${esc(it.quantity ?? "—")}${tier} · PU ${money(it.unit_price_htg)}</div>
    </div>
    <strong style="font-size:13px">${money(it.line_total_htg)}</strong>
  </div>`;
}

function orderCard(o, count) {
  const id = esc(o.id);
  return `<div class="surface" data-order="${id}" style="padding:18px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div>
        <strong>Commande #${esc(shortId(o.id))}</strong>${
    String(o.environment || "").toLowerCase() === "demo" ? ' <span class="badge amber">MODE DEMO</span>' : ""
  }
        <div style="font-size:12px;color:var(--muted,#6f7891)">${esc(fmtDate(o.created_at))} · ${
    count == null ? "…" : esc(count)
  } article${count === 1 ? "" : "s"}</div>
      </div>
      <div style="text-align:right">
        <strong>${money(o.total_htg)}</strong>
        <div style="font-size:12px;color:var(--muted,#6f7891)">${esc(labelOr(ORDER_STATUS_FR, o.status))}</div>
      </div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--muted,#6f7891)">
      <span>${esc(labelOr(PAYMENT_STATUS_FR, o.payment_status))}</span>
      <span>${esc(labelOr(PAYMENT_METHOD_FR, o.payment_method))}</span>
      <span>${esc(labelOr(DELIVERY_FR, o.delivery_type))}</span>
    </div>
    <button class="btn btn-outline-blue" type="button" data-toggle-items style="margin-top:12px;padding:8px 14px;font-size:12px">Voir le détail</button>
    <div data-items hidden style="margin-top:6px"></div>
  </div>`;
}

async function loadOrders() {
  const host = $("#ordersHost");
  if (!host) return;
  host.innerHTML = `<div class="surface" style="padding:36px;text-align:center;color:var(--muted,#6f7891)">Chargement de vos commandes…</div>`;

  try {
    const orders = await getMyOrders();
    if (!orders.length) {
      host.innerHTML = stateBox("empty", {
        title: "Aucune commande",
        text: "Vous n'avez encore aucune commande.",
      });
      return;
    }

    // Compte d'articles par commande en un seul appel.
    let countByOrder = {};
    try {
      const allItems = await getOrderItemsByOrderIds(orders.map((o) => o.id));
      countByOrder = allItems.reduce((acc, it) => {
        acc[it.order_id] = (acc[it.order_id] || 0) + (Number(it.quantity) || 1);
        return acc;
      }, {});
    } catch (e) {
      console.warn("[VinHT] comptage articles:", e && e.message);
    }

    host.innerHTML = orders.map((o) => orderCard(o, countByOrder[o.id])).join("");

    host.querySelectorAll("[data-order]").forEach((card) => {
      const orderId = card.dataset.order;
      const btn = card.querySelector("[data-toggle-items]");
      const box = card.querySelector("[data-items]");
      btn.addEventListener("click", async () => {
        if (!box.hidden) {
          box.hidden = true;
          btn.textContent = "Voir le détail";
          return;
        }
        if (!box.dataset.loaded) {
          box.innerHTML = `<div style="padding:12px 0;color:var(--muted,#6f7891);font-size:12px">Chargement…</div>`;
          box.hidden = false;
          try {
            const items = await getOrderItems(orderId);
            box.innerHTML = items.length
              ? items.map(itemRow).join("")
              : `<div style="padding:12px 0;color:var(--muted,#6f7891);font-size:12px">Aucun article.</div>`;
            box.dataset.loaded = "1";
          } catch (e) {
            console.warn("[VinHT] articles commande:", e && e.message);
            box.innerHTML = `<div style="padding:12px 0;color:#b0122a;font-size:12px">Impossible de charger le détail.</div>`;
          }
        } else {
          box.hidden = false;
        }
        btn.textContent = "Masquer le détail";
      });
    });
  } catch (e) {
    const msg = (e && e.message) || "";
    console.warn("[VinHT] commandes:", msg);
    if (/not-authenticated/.test(msg)) {
      showGate();
      return;
    }
    host.innerHTML = stateBox("error", {
      title: "Erreur",
      text: "Impossible de charger vos commandes.",
      retry: true,
    });
    host.querySelector("[data-orders-retry]")?.addEventListener("click", loadOrders);
  }
}

// --- Mes favoris (wishlist_items -> catalogue public) --------------------
const PLACEHOLDER_IMG_WL = "assets/abstract-brand.jpg";

function wishlistCard(p) {
  const imgs = Array.isArray(p.product_images) ? p.product_images.slice() : [];
  imgs.sort((a, b) => (a?.is_primary ? 0 : 1) - (b?.is_primary ? 0 : 1));
  const img = productImageUrl(imgs[0] && imgs[0].storage_path) || PLACEHOLDER_IMG_WL;
  const merchantName = (p.merchants && p.merchants.shop_name) || "Marchand VinHT";
  const link = `product.html?id=${encodeURIComponent(p.id)}`;
  return `<div class="surface" data-wl-product="${esc(p.id)}" style="padding:14px;margin-bottom:12px;display:flex;gap:12px;align-items:center">
    <a href="${link}"><img src="${esc(img)}" alt="${esc(p.name)}" style="width:56px;height:56px;object-fit:contain;background:var(--soft,#f6f8fc);border-radius:10px"></a>
    <div style="flex:1;min-width:0">
      <a href="${link}" style="color:inherit;font-weight:800;font-size:13px">${esc(p.name)}</a>
      <div style="font-size:12px;color:var(--muted,#6f7891);margin-top:2px">${esc(merchantName)}</div>
      <div style="font-size:13px;font-weight:800;margin-top:2px">${money(p.retail_price, p.currency)}</div>
    </div>
    <button class="btn btn-outline-red" type="button" data-wl-remove style="padding:8px 12px;font-size:12px">Retirer</button>
  </div>`;
}

async function loadWishlist() {
  const host = $("#wishlistHost");
  if (!host) return;
  host.innerHTML = `<div class="surface" style="padding:28px;text-align:center;color:var(--muted,#6f7891)">Chargement de vos favoris…</div>`;

  try {
    const rows = await getMyWishlist();
    if (!rows.length) {
      host.innerHTML = stateBox("empty", { text: "Aucun favori pour le moment." });
      return;
    }

    // Données produit depuis le catalogue public uniquement : un favori
    // pointant vers un produit retiré/rejeté/inactif n'est jamais affiché.
    const productIds = rows.map((r) => r.product_id).filter(Boolean);
    const products = await getProductsByIds(productIds);
    const byId = new Map(products.map((p) => [p.id, p]));
    const visible = rows.map((r) => byId.get(r.product_id)).filter(Boolean);

    if (!visible.length) {
      host.innerHTML = stateBox("empty", { text: "Aucun favori pour le moment." });
      return;
    }

    host.innerHTML = visible.map(wishlistCard).join("");
    host.querySelectorAll("[data-wl-product]").forEach((card) => {
      const productId = card.dataset.wlProduct;
      card.querySelector("[data-wl-remove]").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await removeFromWishlist(productId);
          card.remove();
          if (!host.querySelector("[data-wl-product]")) {
            host.innerHTML = stateBox("empty", { text: "Aucun favori pour le moment." });
          }
        } catch (err) {
          console.warn("[VinHT] retrait favori:", err && err.message);
          showToast("Impossible de retirer ce favori.", "red");
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    const msg = (e && e.message) || "";
    console.warn("[VinHT] favoris:", msg);
    if (/not-authenticated/.test(msg)) {
      showGate();
      return;
    }
    host.innerHTML = stateBox("error", {
      title: "Erreur",
      text: "Impossible de charger vos favoris.",
      retry: true,
    });
    host.querySelector("[data-orders-retry]")?.addEventListener("click", loadWishlist);
  }
}

function showGate() {
  const gate = $("#acctAuthGate");
  const content = $("#acctContent");
  if (gate) gate.style.display = "";
  if (content) content.style.display = "none";
  const who = $("#acctWho");
  if (who) who.textContent = "Espace client VinHT";
  const actions = document.querySelector(".portal-actions");
  if (actions) actions.innerHTML = "";
}

// Boutons "Vos espaces" dans l'en-tête du tableau de bord client — utile surtout
// en mobile (l'onglet "Moi" mène ici). Être marchand/admin n'enlève jamais
// l'espace client : cette page reste la page client.
async function renderSpaces() {
  const host = document.querySelector(".portal-actions");
  if (!host) return;
  host.innerHTML = "";
  let ctx;
  try {
    ctx = await getMyAccessContext();
  } catch {
    return;
  }
  const caps = (ctx && ctx.capabilities) || {};
  const items = [];
  if (caps.can_open_merchant_center) items.push(`<a class="btn btn-outline-blue btn-sm" href="merchant/index.html"><i data-lucide="store"></i> Espace marchand</a>`);
  if (caps.can_admin) items.push(`<a class="btn btn-outline-blue btn-sm" href="admin/index.html"><i data-lucide="shield"></i> Administration</a>`);
  // Toujours visible (comme "Vendre sur VinHT" pour les marchands) : la page
  // elle-même gère candidature / profil existant / connexion requise — ce
  // lien ne doit pas être conditionné à can_deliver, sinon un candidat sans
  // profil courier n'aurait jamais accès à la surface de candidature.
  items.push(`<a class="btn btn-outline-blue btn-sm" href="courier/index.html"><i data-lucide="truck"></i> Espace livreur</a>`);
  // Centre Agent : accessible aux agents (actifs ou non) et aux candidats
  // potentiels ; la page gère candidature, attente d'examen et refus.
  const aa = (ctx && ctx.agent_access) || {};
  if (caps.can_agent || aa.can_apply || aa.has_profile) items.push(`<a class="btn btn-outline-blue btn-sm" href="agent/index.html"><i data-lucide="users"></i> Centre Agent</a>`);
  if (!items.length) return;
  host.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${items.join("")}</div>`;
  refreshIcons();
}

function showContent(session) {
  const gate = $("#acctAuthGate");
  const content = $("#acctContent");
  if (gate) gate.style.display = "none";
  if (content) content.style.display = "";
  const who = $("#acctWho");
  const u = session && session.user;
  const name =
    (u && u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) ||
    (u && u.email) ||
    "";
  if (who) who.textContent = name ? `Connecté : ${name}` : "Espace client VinHT";
  renderSpaces();
  loadWishlist();
  loadOrders();
}

export async function initAccountPage() {
  if (!$("#acctContent")) return; // pas account.html

  const loginBtn = $("#acctLoginBtn");
  if (loginBtn) loginBtn.addEventListener("click", () => openAuthModal("login"));

  if (!isSupabaseConfigured()) {
    showGate();
    return;
  }

  const session = await getActiveSession();
  if (session) showContent(session);
  else showGate();

  // Re-rend si l'état d'auth change (connexion via la modale, déconnexion).
  onAuthChange((s) => {
    if (s && s.user) showContent(s);
    else showGate();
  });
}
