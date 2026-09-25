// Vraie marque compacte FlexiCash (images/smallspacelogo.png) — pour les
// petits espaces UNIQUEMENT (bouton de connexion, libellé "Mode" sur
// payment.html, icône compacte). Aucun logo FlexiCash n'est fabriqué en
// CSS/texte ici : uniquement le fichier réel fourni par FlexiCash.
//
// Résolu via import.meta.url (et non un chemin relatif du type "images/...")
// car ce module est utilisé par des composants partagés (ex. authModal.js)
// injectés dans des pages à des profondeurs différentes (racine, merchant/,
// etc.) : un chemin relatif à la page casserait selon la page qui ouvre le
// composant. import.meta.url reste toujours ancré sur l'emplacement réel de
// ce fichier (js/ui/), donc la résolution est correcte partout.
const SMALL_MARK_URL = new URL("../../images/smallspacelogo.png", import.meta.url).href;

export function flexicashMarkHtml(size = 24) {
  const s = Math.max(14, Number(size) || 24);
  return `<img src="${SMALL_MARK_URL}" alt="FlexiCash" width="${s}" height="${s}" style="flex:0 0 auto;object-fit:contain">`;
}
