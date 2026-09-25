// Câblage "Ajouter au panier" pour index.html et product.html.
// Comportement identique à l'ancien app.js : cible uniquement [data-add].

import { $$ } from "../lib/dom.js";
import { addToCart } from "../services/cart.js";
import { showToast } from "../ui/toast.js";

export function initAddButtons() {
  $$("[data-add]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const d = btn.dataset;
      if (!d.id) return;
      try {
        const added = addToCart({ id: d.id, name: d.name, seller: d.seller, price: d.price, currency: d.currency || "HTG", img: d.img });
        showToast(added ? "Ajouté au panier ✓" : "Produit de démonstration : aperçu uniquement.");
      } catch (err) {
        if (err?.code === "mixed_currency_cart_not_supported") {
          showToast("Votre panier contient déjà des articles dans une autre devise. Finalisez ou videz ce panier avant d’ajouter ce produit.", "red");
          return;
        }
        throw err;
      }
    })
  );
}
