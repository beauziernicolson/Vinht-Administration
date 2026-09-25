import { refreshIcons } from "../lib/icons.js";

function mobileNavMarkup(id) {
  return `<div class="v5-mobile-nav" id="${id}" data-mobile-nav>
    <div class="v5-mobile-nav-backdrop" data-mobile-nav-close></div>
    <nav class="v5-mobile-nav-panel" aria-label="Menu principal">
      <button class="v5-mobile-nav-close" type="button" aria-label="Fermer" data-mobile-nav-close><i data-lucide="x"></i></button>
      <a href="category.html"><i data-lucide="grid-2x2"></i>Catégories</a>
      <a href="products.html"><i data-lucide="package"></i>Produits</a>
      <a href="deals.html"><i data-lucide="tag"></i>Offres <span class="v5-dot"></span></a>
      <a href="new-arrivals.html"><i data-lucide="sparkles"></i>Nouveautés</a>
      <a href="stores.html"><i data-lucide="store"></i>Boutiques</a>
      <a href="merchant.html" class="v5-mobile-sell"><i data-lucide="store"></i>Vendre sur VinHT</a>
    </nav>
  </div>`;
}

function ensureMobileControls(header, index) {
  const inner = header.querySelector(".v5-header-inner");
  if (!inner) return null;

  const searchForm = header.querySelector(".v5-search");
  const iconActions = header.querySelector(".v5-icon-actions");
  const sellLink = header.querySelector(".v9-sell-header");

  let searchToggle = header.querySelector("[data-search-toggle]");
  if (!searchToggle && searchForm) {
    searchToggle = document.createElement("button");
    searchToggle.className = "v5-search-toggle";
    searchToggle.type = "button";
    searchToggle.setAttribute("aria-label", "Rechercher");
    searchToggle.setAttribute("data-search-toggle", "");
    searchToggle.innerHTML = '<i data-lucide="search"></i>';
    inner.insertBefore(searchToggle, iconActions || sellLink || null);
  }

  const navId = index === 0 ? "v5MobileNav" : `v5MobileNav${index + 1}`;
  let nav = document.getElementById(navId);
  if (!nav) {
    header.insertAdjacentHTML("afterend", mobileNavMarkup(navId));
    nav = document.getElementById(navId);
  }

  let hamburger = header.querySelector("[data-hamburger-toggle]");
  if (!hamburger) {
    hamburger = document.createElement("button");
    hamburger.className = "v5-hamburger-btn";
    hamburger.type = "button";
    hamburger.setAttribute("aria-label", "Menu");
    hamburger.setAttribute("aria-controls", navId);
    hamburger.setAttribute("data-hamburger-toggle", navId);
    hamburger.innerHTML = '<i data-lucide="menu"></i>';
    if (sellLink) inner.insertBefore(hamburger, sellLink);
    else inner.appendChild(hamburger);
  }

  return { searchForm, searchToggle, hamburger, nav };
}

export function initMobileHeader() {
  document.querySelectorAll(".v5-header").forEach((header, index) => {
    if (header.dataset.mobileHeaderBound === "1") return;
    const controls = ensureMobileControls(header, index);
    if (!controls) return;
    header.dataset.mobileHeaderBound = "1";

    const { searchForm, searchToggle, hamburger, nav } = controls;
    const input = searchForm?.querySelector("input[data-search-input]");

    if (searchToggle && searchForm) {
      searchToggle.addEventListener("click", () => {
        const open = header.dataset.searchOpen === "1";
        if (open) delete header.dataset.searchOpen;
        else {
          header.dataset.searchOpen = "1";
          input?.focus();
        }
      });
      searchForm.addEventListener("submit", () => { delete header.dataset.searchOpen; });
      document.addEventListener("click", (event) => {
        if (header.dataset.searchOpen !== "1" || header.contains(event.target)) return;
        delete header.dataset.searchOpen;
      });
    }

    if (hamburger && nav) {
      const close = () => {
        delete nav.dataset.open;
        hamburger.setAttribute("aria-expanded", "false");
      };
      const open = () => {
        nav.dataset.open = "1";
        hamburger.setAttribute("aria-expanded", "true");
      };
      hamburger.setAttribute("aria-expanded", "false");
      hamburger.addEventListener("click", () => nav.dataset.open === "1" ? close() : open());
      nav.querySelectorAll("[data-mobile-nav-close]").forEach((el) => el.addEventListener("click", close));
      nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (header.dataset.searchOpen === "1") {
        delete header.dataset.searchOpen;
        searchToggle?.focus();
      }
      if (nav?.dataset.open === "1") {
        delete nav.dataset.open;
        hamburger?.setAttribute("aria-expanded", "false");
        hamburger?.focus();
      }
    });
  });

  refreshIcons();
}
