// Feature #28 — hardening UI transversal.
// Ce module ne crée aucune règle métier : il reflète les invariants du backend
// sur les formulaires déjà rendus et rend visibles les erreurs async checkout.

function setMessage(box, text, ok = false) {
  if (!box) return;
  box.textContent = text || "";
  box.style.display = text ? "" : "none";
  if (text) box.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)";
}

function syncDiscountForm(form) {
  if (!form || form.dataset.promoDiscountHardened === "1") return;
  const type = form.querySelector('[name="discount_type"]');
  const value = form.querySelector('[name="discount_value"]');
  if (!type || !value) return;

  const sync = () => {
    value.min = "0.01";
    value.step = "0.01";
    if (type.value === "percent") value.max = "95";
    else value.removeAttribute("max");
  };

  type.addEventListener("change", sync);
  form.addEventListener("submit", (event) => {
    const numeric = Number(value.value);
    const invalid = !Number.isFinite(numeric) || numeric <= 0 || (type.value === "percent" && numeric > 95);
    if (!invalid) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const box = form.querySelector("#promoCreateMsg, #promoEditMsg") ||
      document.querySelector(form.id === "promoCreateForm" ? "#promoCreateMsg" : "#promoEditMsg");
    setMessage(box, type.value === "percent"
      ? "La remise doit être supérieure à 0 et ne peut pas dépasser 95 %."
      : "La remise doit être strictement supérieure à 0 HTG.");
    value.focus();
  }, true);

  form.dataset.promoDiscountHardened = "1";
  sync();
}

function syncRuntimeCard(section) {
  if (!section || section.dataset.promoRuntimeHardened === "1") return;
  const enabled = section.querySelector("[data-runtime-enabled]");
  const automatic = section.querySelector("[data-runtime-auto]");
  if (!enabled || !automatic) return;

  const sync = () => {
    if (!enabled.checked) {
      automatic.checked = false;
      automatic.disabled = true;
      automatic.setAttribute("aria-disabled", "true");
    } else {
      automatic.disabled = false;
      automatic.removeAttribute("aria-disabled");
    }
  };

  enabled.addEventListener("change", sync);
  section.dataset.promoRuntimeHardened = "1";
  sync();
}

function normalizeRuntimeWording(root = document) {
  root.querySelectorAll?.("[data-promo-env] p").forEach((p) => {
    if (!/promotions actives par marchand/i.test(p.textContent || "")) return;
    p.textContent = (p.textContent || "").replace(
      /promotions actives par marchand/i,
      "promotions en cours (brouillon, active ou en pause) par marchand"
    );
  });
}

function scanPromotionUi(root = document) {
  root.querySelectorAll?.("#promoCreateForm, #promoEditForm").forEach(syncDiscountForm);
  root.querySelectorAll?.("[data-promo-env]").forEach(syncRuntimeCard);
  normalizeRuntimeWording(root);
}

function initCheckoutPromotionEvents() {
  const box = document.querySelector("#checkoutMsg");
  if (!box || box.dataset.promoEventsWired === "1") return;
  box.dataset.promoEventsWired = "1";

  let quoteOwnedText = "";
  let ownWrite = false;
  const observer = new MutationObserver(() => {
    if (ownWrite) return;
    if (box.dataset.promoQuoteOwned === "1" && box.textContent !== quoteOwnedText) {
      delete box.dataset.promoQuoteOwned;
      quoteOwnedText = "";
    }
  });
  observer.observe(box, { childList: true, characterData: true, subtree: true });

  const setQuoteError = (text) => {
    ownWrite = true;
    quoteOwnedText = text || "Impossible de recalculer les remises de ce panier.";
    box.dataset.promoQuoteOwned = "1";
    delete box.dataset.promoOrderOwned;
    setMessage(box, quoteOwnedText, false);
    queueMicrotask(() => { ownWrite = false; });
  };

  const clearQuoteError = () => {
    if (box.dataset.promoQuoteOwned !== "1") return;
    ownWrite = true;
    setMessage(box, "");
    delete box.dataset.promoQuoteOwned;
    quoteOwnedText = "";
    queueMicrotask(() => { ownWrite = false; });
  };

  window.addEventListener("vinht:promotion-quote", (event) => {
    const detail = event.detail || {};
    if (detail.ok) {
      clearQuoteError();
      return;
    }
    if (!Array.isArray(detail.codes) || detail.codes.length === 0) {
      setQuoteError(detail.message);
    }
  });

  window.addEventListener("vinht:promotion-order-error", (event) => {
    const message = event.detail?.message;
    if (!message) return;
    setTimeout(() => {
      ownWrite = true;
      delete box.dataset.promoQuoteOwned;
      quoteOwnedText = "";
      box.dataset.promoOrderOwned = "1";
      setMessage(box, message, false);
      queueMicrotask(() => { ownWrite = false; });
    }, 0);
  });
}

export function initPromotionHardening() {
  scanPromotionUi(document);
  initCheckoutPromotionEvents();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.("#promoCreateForm, #promoEditForm")) syncDiscountForm(node);
        if (node.matches?.("[data-promo-env]")) syncRuntimeCard(node);
        scanPromotionUi(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
