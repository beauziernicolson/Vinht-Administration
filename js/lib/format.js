// Formatage d'affichage. Purement UX : le serveur reste la source financière autoritaire.

export function money(n, currency = "HTG") {
  return currency + " " + Number(n || 0).toLocaleString("en-US");
}
