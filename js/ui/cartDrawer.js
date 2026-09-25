import { getCart, setCart } from "../services/cart.js";
import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));

function prefix() {
  return location.pathname.includes("/admin/") || location.pathname.includes("/merchant/") || location.pathname.includes("/agent/") || location.pathname.includes("/courier/") ? "../" : "";
}

function ensureStyles() {
  if (document.querySelector('link[data-cart-drawer-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `${prefix()}cart-drawer-v16.css`;
  link.dataset.cartDrawerStyle = "1";
  document.head.appendChild(link);
}

function items() {
  return getCart();
}

function writeItems(next) {
  setCart(next);
}

function count(itemsList = items()) {
  return itemsList.reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
}

function subtotal(itemsList = items()) {
  return itemsList.reduce((sum, x) => sum + (Number(x.price) || 0) * (Number(x.qty) || 0), 0);
}

function syncBadges(itemsList = items()) {
  const n = count(itemsList);
  document.querySelectorAll(".cart-count").forEach((badge) => {
    badge.textContent = n ? String(Math.min(n, 99)) : "";
  });
}

function shell() {
  let root = document.querySelector("[data-v16-cart-root]");
  if (root) return root;
  root = document.createElement("div");
  root.dataset.v16CartRoot = "1";
  root.innerHTML = `
    <div class="v16-cart-overlay" data-cart-overlay hidden></div>
    <aside class="v16-cart-drawer" data-cart-drawer aria-hidden="true" aria-label="Votre panier" tabindex="-1">
      <header class="v16-cart-head">
        <div>
          <span class="v16-cart-eyebrow">VinHT</span>
          <h2>Votre panier</h2>
        </div>
        <button type="button" class="v16-cart-close" data-cart-close aria-label="Fermer le panier"><i data-lucide="x"></i></button>
      </header>
      <div class="v16-cart-scroll" data-cart-items></div>
      <footer class="v16-cart-foot">
        <div class="v16-cart-subtotal"><span>Sous-total</span><strong data-cart-subtotal>HTG 0</strong></div>
        <p>Livraison et total final calculés au checkout.</p>
        <a class="v16-cart-checkout" data-cart-checkout href="${prefix()}checkout.html"><span>Checkout</span><i data-lucide="arrow-right"></i></a>
      </footer>
    </aside>`;
  document.body.appendChild(root);
  return root;
}

// Options de variante sélectionnées (affichage seulement). Le variant_id exact
// reste porté par la ligne de panier et transmis au checkout.
function variantLine(item) {
  const o = item && item.variantOptions;
  if (!o || typeof o !== "object") return "";
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const txt = Object.entries(o)
    .filter(([, v]) => v != null && String(v) !== "")
    .map(([k, v]) => `${cap(k)} : ${v}`)
    .join(" · ");
  return txt
    ? `<p style="font-size:11px;color:var(--muted,#6f7891);margin:2px 0 0">${esc(txt)}</p>`
    : "";
}

function row(item, index) {
  const wholesale = item.pricingTier === "wholesale";
  const min = wholesale && item.moq ? Number(item.moq) || 1 : 1;
  return `
    <article class="v16-cart-item" data-cart-index="${index}">
      <a class="v16-cart-thumb" href="${prefix()}product.html?id=${encodeURIComponent(item.productId || item.id || "")}" tabindex="-1">
        <img src="${esc(item.img || `${prefix()}assets/abstract-brand.jpg`)}" alt="${esc(item.name || "Produit")}" loading="lazy" decoding="async">
      </a>
      <div class="v16-cart-copy">
        <div class="v16-cart-line-top">
          <h3>${esc(item.name || "Produit VinHT")}</h3>
          <button type="button" class="v16-cart-remove" data-cart-remove aria-label="Retirer ${esc(item.name || "ce produit")}"><i data-lucide="x"></i></button>
        </div>
        <p>${esc(item.seller || "Marchand VinHT")}</p>
        ${variantLine(item)}
        <div class="v16-cart-price-row">
          <strong>${money(Number(item.price) || 0, item.currency || "HTG")}</strong>
          ${wholesale ? `<span>Gros · MOQ ${min}</span>` : `<span>Détail</span>`}
        </div>
        <div class="v16-cart-qty" data-cart-qty>
          <button type="button" data-cart-dec aria-label="Diminuer la quantité"><i data-lucide="minus"></i></button>
          <span>${Number(item.qty) || 1}</span>
          <button type="button" data-cart-inc aria-label="Augmenter la quantité"><i data-lucide="plus"></i></button>
        </div>
      </div>
    </article>`;
}

function render() {
  const root = shell();
  const list = root.querySelector("[data-cart-items]");
  const sum = root.querySelector("[data-cart-subtotal]");
  const checkout = root.querySelector("[data-cart-checkout]");
  const current = items();
  const currencies = [...new Set(current.map((x) => String(x?.currency || "HTG").toUpperCase()))];
  const currentCurrency = currencies.length === 1 ? currencies[0] : null;
  const mixedCurrencies = currencies.length > 1;
  syncBadges(current);
  if (!list || !sum || !checkout) return;

  if (!current.length) {
    list.innerHTML = `
      <div class="v16-cart-empty">
        <span><i data-lucide="shopping-bag"></i></span>
        <h3>Votre panier est vide</h3>
        <p>Ajoutez un produit pour le retrouver ici sans quitter la page.</p>
        <a href="${prefix()}products.html" data-cart-close-link>Découvrir les produits <i data-lucide="arrow-right"></i></a>
      </div>`;
    checkout.classList.add("is-disabled");
    checkout.setAttribute("aria-disabled", "true");
    checkout.removeAttribute("href");
  } else {
    list.innerHTML = current.map(row).join("");
    if (mixedCurrencies) {
      checkout.classList.add("is-disabled");
      checkout.setAttribute("aria-disabled", "true");
      checkout.removeAttribute("href");
      checkout.querySelector("span").textContent = "Séparez les devises du panier";
    } else {
      checkout.classList.remove("is-disabled");
      checkout.removeAttribute("aria-disabled");
      checkout.href = `${prefix()}checkout.html`;
      checkout.querySelector("span").textContent = "Checkout";
    }
  }
  sum.textContent = mixedCurrencies ? "Panier multi-devise" : money(subtotal(current), currentCurrency || "HTG");

  list.querySelectorAll("[data-cart-index]").forEach((el) => {
    const idx = Number(el.dataset.cartIndex);
    const currentItem = current[idx];
    if (!currentItem) return;
    const minimum = currentItem.pricingTier === "wholesale" && currentItem.moq ? Number(currentItem.moq) || 1 : 1;
    el.querySelector("[data-cart-inc]")?.addEventListener("click", () => {
      const next = items();
      if (!next[idx]) return;
      next[idx].qty = (Number(next[idx].qty) || 1) + 1;
      writeItems(next);
      render();
    });
    el.querySelector("[data-cart-dec]")?.addEventListener("click", () => {
      const next = items();
      if (!next[idx]) return;
      next[idx].qty = Math.max(minimum, (Number(next[idx].qty) || 1) - 1);
      writeItems(next);
      render();
    });
    el.querySelector("[data-cart-remove]")?.addEventListener("click", () => {
      const next = items();
      next.splice(idx, 1);
      writeItems(next);
      render();
    });
  });
  refreshIcons();
}

function open() {
  const root = shell();
  render();
  root.querySelector("[data-cart-overlay]").hidden = false;
  const drawer = root.querySelector("[data-cart-drawer]");
  drawer?.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => root.classList.add("is-open"));
  document.documentElement.classList.add("v16-cart-locked");
  setTimeout(() => drawer?.focus({ preventScroll: true }), 40);
}

function close() {
  const root = shell();
  root.classList.remove("is-open");
  root.querySelector("[data-cart-drawer]")?.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("v16-cart-locked");
  setTimeout(() => {
    const overlay = root.querySelector("[data-cart-overlay]");
    if (overlay) overlay.hidden = true;
  }, 260);
  if (location.hash === "#cart") history.replaceState(null, "", location.pathname + location.search);
}

function bindTriggers() {
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-cart-trigger], a[href$='cart.html'], a[href='#cart']");
    if (trigger && !trigger.closest("[data-v16-cart-root]")) {
      e.preventDefault();
      open();
      return;
    }
    if (e.target.closest("[data-cart-close]")) {
      e.preventDefault();
      close();
    }
  });

  const root = shell();
  root.querySelector("[data-cart-overlay]")?.addEventListener("click", close);
  root.querySelector("[data-cart-items]")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-cart-close-link]")) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("storage", render);
  window.addEventListener("vinht:cartchange", render);
  window.addEventListener("vinht:cartopen", open);
}

export function initCartDrawer() {
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const portalPage = document.body?.matches?.("[data-admin-page],[data-merchant-page],[data-agent-page],[data-courier-page]") === true;
  if (portalPage || location.pathname.includes("/merchant/") || location.pathname.includes("/admin/") || location.pathname.includes("/agent/") || location.pathname.includes("/courier/") || file === "merchant.html" || file === "merchant-center.html") return;
  ensureStyles();
  shell();
  bindTriggers();
  render();
  const params = new URLSearchParams(location.search);
  if (location.hash === "#cart" || params.get("cart") === "open" || params.get("cart") === "1") open();
}
