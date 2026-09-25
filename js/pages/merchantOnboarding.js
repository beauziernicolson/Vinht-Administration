import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import {
  getMyMerchantOnboardingContext, startMyEasyMerchantOnboarding, saveMyMerchantOnboardingProfile,
  ONBOARDING_STEP_STATUS_FR, onboardingErrorMessageFr,
} from "../services/onboarding.js";

// Feature #36A — Merchant Easy Onboarding (parcours autonome).
// Ce contrôleur ne recalcule jamais la progression : `steps`, `next_step` et
// `capabilities` viennent uniquement de get_my_merchant_onboarding_context_v1.
// Les CTA next_step ouvrent des surfaces VinHT déjà existantes (KYC, FlexiCash,
// ajout produit, livraison) — aucune de ces fonctionnalités n'est reconstruite.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const loading = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;
const errorBox = (t) => `<div class="error-state">${esc(t)}</div>`;

const STEP_ICON = {
  account: "user-round",
  shop: "store",
  kyc: "shield-check",
  activation: "badge-check",
  payment: "credit-card",
  first_product: "package-plus",
  delivery: "truck",
};

const STEP_STATUS_TONE = {
  complete: "green",
  in_progress: "blue",
  waiting: "amber",
  todo: "",
  locked: "",
  blocked: "red",
};

// action -> URL relative à merchant/onboarding.html. null = pas de navigation
// (ex: "wait", ou une action gérée inline sur cette même page).
const NEXT_STEP_HREF = {
  start_kyc: "../merchant.html#apply",
  continue_kyc: "../merchant.html#apply",
  connect_flexicash: "../merchant-center.html#mcFlexicash",
  add_product: "product-new.html",
  configure_delivery: "settings.html",
  done: "index.html",
};

function gate(kind = "auth") {
  const g = document.querySelector("[data-onboarding-gate]"), c = document.querySelector("[data-onboarding-content]");
  if (g) g.hidden = false;
  if (c) c.hidden = true;
  if (g) {
    g.innerHTML = kind === "error"
      ? `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Chargement impossible</h3><p>Votre parcours marchand est momentanément indisponible.</p><button class="btn btn-outline-blue" type="button" data-onboarding-retry>Réessayer</button></div>`
      : `<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour démarrer ou continuer votre parcours marchand.</p><button class="btn btn-blue" type="button" data-login>Se connecter</button></div>`;
    g.querySelector("[data-login]")?.addEventListener("click", () => openAuthModal("login"));
    g.querySelector("[data-onboarding-retry]")?.addEventListener("click", () => initMerchantOnboarding());
    refreshIcons();
  }
}

function showContent() {
  const g = document.querySelector("[data-onboarding-gate]"), c = document.querySelector("[data-onboarding-content]");
  if (g) g.hidden = true;
  if (c) c.hidden = false;
}

function stepRowHtml(step) {
  const tone = STEP_STATUS_TONE[step.status] || "";
  const label = ONBOARDING_STEP_STATUS_FR[step.status] || step.status;
  return `<div class="settings-section">
    <div style="display:flex;gap:10px;align-items:center">
      <i data-lucide="${esc(STEP_ICON[step.code] || "circle")}"></i>
      <div><strong>${esc(step.label)}</strong>${step.code === "first_product" && step.product_count != null ? `<p>${esc(step.product_count)} produit(s)</p>` : ""}</div>
    </div>
    <span class="badge ${tone}">${esc(label)}</span>
  </div>`;
}

function startFormHtml(prefill = {}) {
  return `<div class="portal-card">
    <h3>Créer votre espace vendeur</h3>
    <p class="muted" style="font-size:12px">1 à 2 minutes — vous compléterez le reste ensuite.</p>
    <form id="obStartForm" style="display:flex;flex-direction:column;gap:8px">
      <div class="field"><label>Nom complet *</label><input class="input" name="full_name" required maxlength="160" value="${esc(prefill.full_name || "")}"></div>
      <div class="field"><label>Nom de la boutique *</label><input class="input" name="shop_name" required maxlength="160" value="${esc(prefill.shop_name || "")}"></div>
      <div class="field"><label>Type de marchand *</label><select class="input" name="merchant_type" required>
        <option value="">Choisir…</option>
        <option value="producteur" ${prefill.merchant_type === "producteur" ? "selected" : ""}>Producteur</option>
        <option value="revendeur" ${prefill.merchant_type === "revendeur" ? "selected" : ""}>Revendeur</option>
        <option value="vendeur" ${prefill.merchant_type === "vendeur" ? "selected" : ""}>Vendeur</option>
      </select></div>
      <div class="customer-grid">
        <div class="field"><label>Téléphone</label><input class="input" name="phone" maxlength="40" value="${esc(prefill.phone || "")}"></div>
        <div class="field"><label>WhatsApp</label><input class="input" name="whatsapp_number" maxlength="40" value="${esc(prefill.whatsapp_number || "")}"></div>
      </div>
      <p class="muted" style="font-size:11px">Téléphone ou WhatsApp obligatoire (au moins un des deux).</p>
      <div id="obStartMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-blue" type="submit">Commencer</button></div>
    </form>
  </div>`;
}

function editFormHtml(app) {
  return `<div class="portal-card">
    <h3>Modifier votre demande</h3>
    <form id="obEditForm" style="display:flex;flex-direction:column;gap:8px">
      <div class="field"><label>Nom complet *</label><input class="input" name="full_name" required maxlength="160" value="${esc(app.full_name || "")}"></div>
      <div class="field"><label>Nom de la boutique *</label><input class="input" name="shop_name" required maxlength="160" value="${esc(app.shop_name || "")}"></div>
      <div class="field"><label>Type de marchand *</label><select class="input" name="merchant_type" required>
        <option value="producteur" ${app.merchant_type === "producteur" ? "selected" : ""}>Producteur</option>
        <option value="revendeur" ${app.merchant_type === "revendeur" ? "selected" : ""}>Revendeur</option>
        <option value="vendeur" ${app.merchant_type === "vendeur" ? "selected" : ""}>Vendeur</option>
      </select></div>
      <div class="customer-grid">
        <div class="field"><label>Téléphone</label><input class="input" name="phone" maxlength="40" value="${esc(app.phone || "")}"></div>
        <div class="field"><label>WhatsApp</label><input class="input" name="whatsapp_number" maxlength="40" value="${esc(app.whatsapp_number || "")}"></div>
      </div>
      <div class="field"><label>Description boutique</label><textarea class="input" name="shop_description" maxlength="2000">${esc(app.shop_description || "")}</textarea></div>
      <div class="field"><label>Catégories de produits (séparées par des virgules, 20 maximum)</label><input class="input" name="product_categories" value="${esc((app.product_categories || []).join(", "))}"></div>
      <div id="obEditMsg" class="error-state" style="display:none"></div>
      <div class="toolbar-group"><button class="btn btn-dark" type="submit">Enregistrer</button></div>
    </form>
  </div>`;
}

function nextStepHtml(next) {
  if (!next) return "";
  const href = NEXT_STEP_HREF[next.action] || null;
  const isWait = next.action === "wait" || next.action === "review_rejection" || next.action === "done" && false;
  return `<div class="portal-card" data-next-step>
    <div class="settings-section">
      <div><strong>${esc(next.title || "")}</strong><p>${esc(next.message || "")}</p></div>
      ${href ? `<a class="btn btn-blue btn-sm" href="${esc(href)}">Continuer</a>` : (next.action === "start_easy_onboarding" ? "" : "")}
    </div>
  </div>`;
}

async function submitStart(form, msgBox) {
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  msgBox.style.display = "none";
  try {
    const result=await startMyEasyMerchantOnboarding({
      fullName: (fd.get("full_name") || "").trim(),
      shopName: (fd.get("shop_name") || "").trim(),
      merchantType: fd.get("merchant_type"),
      phone: (fd.get("phone") || "").trim(),
      whatsappNumber: (fd.get("whatsapp_number") || "").trim(),
    });
    await render();
  } catch (err) {
    msgBox.textContent = onboardingErrorMessageFr(err?.message, "Impossible de créer votre espace vendeur.");
    msgBox.style.display = "";
    btn.dataset.submitting = ""; btn.disabled = false;
  }
}

async function submitEdit(form, msgBox) {
  const fd = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');
  if (btn.dataset.submitting === "1") return;
  btn.dataset.submitting = "1"; btn.disabled = true;
  msgBox.style.display = "none";
  const categories = (fd.get("product_categories") || "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    await saveMyMerchantOnboardingProfile({
      fullName: (fd.get("full_name") || "").trim(),
      shopName: (fd.get("shop_name") || "").trim(),
      merchantType: fd.get("merchant_type"),
      phone: (fd.get("phone") || "").trim(),
      whatsappNumber: (fd.get("whatsapp_number") || "").trim(),
      shopDescription: (fd.get("shop_description") || "").trim(),
      productCategories: categories,
    });
    await render();
  } catch (err) {
    msgBox.textContent = onboardingErrorMessageFr(err?.message, "Impossible d'enregistrer ces modifications.");
    msgBox.style.display = "";
    btn.dataset.submitting = ""; btn.disabled = false;
  }
}

let _obSeq = 0;

async function render() {
  const seq = ++_obSeq;
  const startHost = document.querySelector("#obStartHost");
  const progressHost = document.querySelector("#obProgressHost");
  if (!startHost || !progressHost) return;
  progressHost.innerHTML = loading("Chargement de votre parcours…");
  startHost.innerHTML = "";
  let ctx;
  try {
    ctx = await getMyMerchantOnboardingContext();
  } catch (err) {
    if (seq !== _obSeq) return;
    progressHost.innerHTML = errorBox(onboardingErrorMessageFr(err?.message, "Impossible de charger votre parcours marchand."));
    return;
  }
  if (seq !== _obSeq) return;

  const caps = ctx.capabilities || {};
  const app = ctx.application || null;

  if (caps.can_start) {
    startHost.innerHTML = startFormHtml(app || {});
    startHost.querySelector("#obStartForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitStart(e.currentTarget, startHost.querySelector("#obStartMsg"));
    });
  }

  if (ctx.state === "application_rejected" && app?.rejection_reason) {
    progressHost.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="circle-x"></i></div><h3>Demande refusée</h3><p>${esc(app.rejection_reason)}</p></div></div>`;
  } else {
    const steps = Array.isArray(ctx.steps) ? ctx.steps : [];
    const percent = ctx.progress?.percent ?? 0;
    progressHost.innerHTML = `
      <div class="portal-card">
        <div class="toolbar"><h3>Progression</h3><strong>${esc(percent)}%</strong></div>
        <div class="progress-track" style="height:8px;background:var(--line,#eceff5);border-radius:99px;overflow:hidden;margin-bottom:8px"><div style="height:100%;width:${esc(percent)}%;background:var(--blue,#1257e0)"></div></div>
        ${steps.map(stepRowHtml).join("")}
      </div>
      ${nextStepHtml(ctx.next_step)}
    `;
  }

  if (caps.can_edit_application && app) {
    const editWrap = document.createElement("div");
    editWrap.innerHTML = editFormHtml(app);
    progressHost.appendChild(editWrap.firstElementChild);
    progressHost.querySelector("#obEditForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitEdit(e.currentTarget, progressHost.querySelector("#obEditMsg"));
    });
  }

  refreshIcons();
}

let _obAuthBound = false;
let _obLastUid = null;
let _obBooted = false;

export async function initMerchantOnboarding() {
  if (document.body.dataset.onboardingPage !== "onboarding") return;
  if (!_obAuthBound) {
    _obAuthBound = true;
    onAuthChange((s) => {
      const uid = (s && s.user && s.user.id) || null;
      if (_obBooted && uid === _obLastUid) return;
      _obBooted = true; _obLastUid = uid;
      initMerchantOnboarding();
    });
  }
  const session = await getSession();
  _obBooted = true; _obLastUid = session?.user?.id || null;
  if (!session?.user) { gate("auth"); return; }
  showContent();
  await render();
}
