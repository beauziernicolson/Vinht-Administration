// Agent catalog currency UX — couche additive, sans réécrire le Centre Agent.
// La vérité reste côté RPC agent_create_product_v2. HTG reste le défaut historique.

let observer = null;

function replaceLabelText(label, nextText) {
  const textNode = Array.from(label.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && String(n.nodeValue || "").trim());
  if (textNode) textNode.nodeValue = `${nextText} `;
  else label.insertBefore(document.createTextNode(`${nextText} `), label.firstChild);
}

function updateCreateLabels(form, currency) {
  const code = String(currency || "HTG").toUpperCase();
  form.querySelectorAll("label").forEach((label) => {
    const t = String(label.textContent || "").trim();
    if (t.startsWith("Prix détail")) replaceLabelText(label, `Prix détail (${code}) *`);
    else if (t.startsWith("Prix comparé")) replaceLabelText(label, `Prix comparé (${code}, facultatif)`);
    else if (t.startsWith("Prix de gros")) replaceLabelText(label, `Prix de gros (${code}, facultatif)`);
  });
}

function enhanceCreateForm(form) {
  if (!form || form.dataset.currencyUxReady === "1") return;
  form.dataset.currencyUxReady = "1";

  const retail = form.querySelector("[name='retail_price']");
  const retailField = retail?.closest(".field");
  const grid = retailField?.parentElement;
  if (!retailField || !grid) return;

  const currencyField = document.createElement("div");
  currencyField.className = "field";
  currencyField.innerHTML = `
    <label>Devise *
      <select class="input" name="currency" required aria-label="Devise du produit">
        <option value="HTG" selected>HTG — Gourde</option>
        <option value="USD">USD — Dollar US</option>
      </select>
    </label>`;
  grid.insertBefore(currencyField, retailField);

  const select = currencyField.querySelector("select[name='currency']");
  const sync = () => updateCreateLabels(form, select?.value || "HTG");
  select?.addEventListener("change", sync);
  sync();
}

function enhanceEditForm(form) {
  if (!form || form.dataset.currencyUxReady === "1") return;
  form.dataset.currencyUxReady = "1";
  // L'édition ne change jamais la devise. On supprime seulement le libellé HTG
  // trompeur pour les produits USD existants, sans retirer les inputs imbriqués.
  form.querySelectorAll("label").forEach((label) => {
    const t = String(label.textContent || "").trim();
    if (t.startsWith("Prix détail")) replaceLabelText(label, "Prix détail (devise du produit) *");
    else if (t.startsWith("Prix comparé")) replaceLabelText(label, "Prix comparé (devise du produit, facultatif)");
    else if (t.startsWith("Prix de gros")) replaceLabelText(label, "Prix de gros (devise du produit, facultatif)");
  });
}

function scan() {
  enhanceCreateForm(document.querySelector("#acCreateProductForm"));
  enhanceEditForm(document.querySelector("#acEditProductForm"));
}

export function initAgentCurrencyUx() {
  if (!String(location.pathname || "").includes("/agent/")) return;
  scan();
  if (observer) return;
  observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
