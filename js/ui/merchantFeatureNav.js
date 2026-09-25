import { refreshIcons } from "../lib/icons.js";

// Injecte les liens des modules "services marchand" dans la barre latérale du
// portail marchand, sans modifier chaque page HTML. Idempotent : si le lien
// existe déjà (marqueur data-*), on ne le recrée pas.
export function initMerchantFeatureNav() {
  document.querySelectorAll(".portal-sidebar .portal-nav").forEach((nav) => {
    const path = String(location.pathname || "");
    const inMerchantDir = /\/merchant\//.test(path);
    const anchors = () => Array.from(nav.querySelectorAll("a"));
    const anchorBefore = () =>
      anchors().find((a) => /support\.html(?:$|[?#])/.test(a.getAttribute("href") || "")) ||
      anchors().find((a) => /merchant-center\.html(?:$|[?#])/.test(a.getAttribute("href") || ""));

    // Finances (Feature #8)
    if (!nav.querySelector("[data-finance-nav]")) {
      const fin = document.createElement("a");
      fin.setAttribute("data-finance-nav", "");
      fin.href = inMerchantDir ? "finance.html" : "merchant/finance.html";
      fin.className = /\/merchant\/finance\.html$/.test(path) ? "active" : "";
      fin.innerHTML = '<i data-lucide="wallet"></i>Finances';
      const before = anchorBefore();
      if (before) nav.insertBefore(fin, before);
      else nav.appendChild(fin);
    }

    // Étiquetage (Feature #6)
    if (!nav.querySelector("[data-labeling-nav]")) {
      const link = document.createElement("a");
      link.setAttribute("data-labeling-nav", "");
      link.href = inMerchantDir ? "labeling.html" : "merchant/labeling.html";
      link.className = /\/merchant\/labeling\.html$/.test(path) ? "active" : "";
      link.innerHTML = '<i data-lucide="tags"></i>Étiquetage';
      const before = anchorBefore();
      if (before) nav.insertBefore(link, before);
      else nav.appendChild(link);
    }
  });
  refreshIcons();
}
