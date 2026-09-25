// Intégration Lucide Icons (CDN, sans bundler — https://lucide.dev).
//
// - Icônes statiques : <i data-lucide="nom"></i> dans le HTML, révélées par
//   window.lucide.createIcons() (le script Lucide est chargé en <script>
//   classique sur les pages VinHT, avant js/main.js).
// - Contenu rendu dynamiquement (innerHTML) : appeler refreshIcons() juste
//   après avoir injecté le HTML contenant de nouveaux [data-lucide].
//
// Taille/stroke homogènes imposés ici via la classe .lucide que Lucide ajoute
// automatiquement à chaque icône générée — pas de modification de styles.css.

const STYLE_ID = "vh-icons-css";

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.lucide{width:18px;height:18px;stroke-width:2.25;vertical-align:-4px;flex-shrink:0}
.heart .lucide{width:16px;height:16px;vertical-align:-3px}
.heart.is-saved .lucide,#pdpWishlistBtn.is-saved .lucide{fill:currentColor}
#pdpWishlistBtn.is-saved{color:var(--red,#f31938);border-color:var(--red,#f31938)}
.iconcircle .lucide,.bigico .lucide,.category-icon .lucide{width:26px;height:26px;stroke-width:1.8;vertical-align:middle}
.qty .lucide{width:14px;height:14px;stroke-width:2.5}
.mini-info .lucide{width:20px;height:20px;stroke-width:1.8}
.delivery-card strong .lucide{width:16px;height:16px;vertical-align:-3px}
`;
  document.head.appendChild(s);
}
injectCss();

export function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}
