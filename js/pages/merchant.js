// merchant.html — demande marchand réelle (public.merchant_applications).
//
// - Auth obligatoire pour soumettre.
// - Aucun champ admin/review envoyé.
// - status forcé "pending".
// - Si une demande "pending" existe déjà : pas de nouvelle soumission.
// - Aucune règle KYC/légale inventée.

import { $ } from "../lib/dom.js";
import { money } from "../lib/format.js";
import { getCategories } from "../services/catalog.js";
import {
  getMerchantPlans,
  getMyMerchantApplications,
  createMerchantApplication,
} from "../services/merchants.js";
import { getActiveSession } from "../services/orders.js";
import { onAuthChange, isSupabaseConfigured } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { getMyAccessContext } from "../services/access.js";
import { renderMerchantKycFlow } from "../ui/merchantKycFlow.js";
import { startMerchantKyc } from "../services/merchantKyc.js";
import { getMarketplaceLaunchOffer } from "../services/launchOffer.js";

const TYPE_FR = { producteur: "Producteur", revendeur: "Revendeur", vendeur: "Vendeur" };
const PLAN_FR = { individual: "Individuel", professional: "Professionnel" };
const STATUS_FR = {
  pending: "En cours d'examen",
  approved: "Approuvée",
  rejected: "Refusée",
  cancelled: "Annulée",
};

let selectedCategorySlugs = [];

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
function showMsg(text) {
  const b = $("#merchantMsg");
  if (!b) return;
  b.textContent = text || "";
  b.style.display = text ? "" : "none";
}
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

const PLAN_ORDER = ["individual", "professional"];

function planDisplay(p, offer) {
  const code = p.code;
  const commission = Number(
    code === "professional"
      ? (offer?.professional?.commission_rate ?? p.commission_rate ?? offer?.commission_rate ?? 0)
      : (offer?.commission_rate ?? p.commission_rate ?? 0)
  );
  const waived = offer?.fixed_fees_waived === true;

  if (code === "professional") {
    const normal = Number(offer?.professional?.normal_monthly_fee_htg ?? p.monthly_fee_htg ?? 0);
    const effective = Number(offer?.professional?.effective_monthly_fee_htg ?? normal);
    return {
      name: PLAN_FR[code] || p.name || code,
      lines: waived
        ? [
            `${money(effective)}/mois pendant l’offre`,
            `Tarif normal ensuite : ${money(normal)}/mois`,
            `+${commission}% par vente`,
            "0 HTG par unité",
          ]
        : [`${money(normal)}/mois`, `+${commission}% par vente`, "0 HTG par unité"],
      selectBits: [`${money(effective)}/mois`, "0 HTG/unité", `${commission}% par vente`],
      waived,
    };
  }

  const normalHtg = Number(offer?.individual?.normal_per_item_fee_htg ?? p.per_item_fee_htg ?? 0);
  const effectiveHtg = Number(offer?.individual?.effective_per_item_fee_htg ?? normalHtg);
  const normalUsd = Number(offer?.individual?.normal_per_item_fee_usd ?? p.per_item_fee_usd ?? 0);
  const effectiveUsd = Number(offer?.individual?.effective_per_item_fee_usd ?? normalUsd);
  return {
    name: PLAN_FR[code] || p.name || code,
    lines: waived
      ? [
          `${money(effectiveHtg)}/unité HTG pendant l’offre`,
          `${effectiveUsd} USD/unité USD pendant l’offre`,
          `Tarif normal ensuite : ${money(normalHtg)}/unité HTG · ${normalUsd} USD/unité USD`,
          `+${commission}% par vente`,
          "0 HTG / mois",
        ]
      : [
          `${money(normalHtg)}/unité HTG`,
          `${normalUsd} USD/unité USD`,
          `+${commission}% par vente`,
          "0 HTG / mois",
        ],
    selectBits: [`${money(effectiveHtg)}/unité HTG`, `${effectiveUsd} USD/unité USD`, `${commission}% par vente`],
    waived,
  };
}

function renderPlanCards(plans, offer) {
  const host = $("#planCards");
  if (!host) return;
  const byCode = new Map((plans || []).map((p) => [p.code, p]));
  const codes = PLAN_ORDER.filter((c) => byCode.has(c));
  host.innerHTML = codes
    .map((code) => {
      const display = planDisplay(byCode.get(code), offer);
      return `<article class="plan-card portal-card">
        <span class="portal-kicker">${esc(display.name.toUpperCase())}</span>
        ${display.waived ? '<span class="badge green" style="margin-left:8px">Offre de lancement</span>' : ""}
        <ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.6">
          ${display.lines.map((l) => `<li>${esc(l)}</li>`).join("")}
        </ul>
      </article>`;
    })
    .join("");
}

async function fillPlans() {
  const sel = $("#maPlan");
  let plans = [];
  let offer = null;
  try {
    [plans, offer] = await Promise.all([
      getMerchantPlans(),
      getMarketplaceLaunchOffer().catch(() => null),
    ]);
  } catch (e) {
    console.warn("[VinHT] plans marchand:", e && e.message);
  }
  renderPlanCards(plans, offer);
  if (!sel) return;

  for (const p of plans) {
    const display = planDisplay(p, offer);
    const o = document.createElement("option");
    o.value = p.code;
    o.textContent = `${display.name} — ${display.selectBits.join(" · ")}`;
    sel.appendChild(o);
  }
}

async function fillCategories() {
  const host = $("#maCategories");
  if (!host) return;
  try {
    const cats = await getCategories();
    host.innerHTML = cats
      .map(
        (c) =>
          `<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;border:1px solid var(--line,#e7eaf2);border-radius:999px;padding:6px 12px;cursor:pointer">
        <input type="checkbox" value="${esc(c.slug)}" data-cat> ${esc(c.name)}</label>`
      )
      .join("");
    host.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-cat]");
      if (!cb) return;
      // product_categories = text[] de SLUGS de catégories.
      selectedCategorySlugs = [...host.querySelectorAll("[data-cat]:checked")].map((x) => x.value);
    });
  } catch (e) {
    console.warn("[VinHT] catégories marchand:", e && e.message);
  }
}

function renderExistingState(app) {
  const box = $("#merchantState");
  const form = $("#merchantForm");
  if (!box) return;

  const common = `
    <div style="font-size:13px;color:var(--muted,#6f7891);margin-top:8px">
      <div><strong>Boutique :</strong> ${esc(app.shop_name || "—")}</div>
      <div><strong>Type :</strong> ${esc(TYPE_FR[app.merchant_type] || app.merchant_type || "—")}</div>
      <div><strong>Plan demandé :</strong> ${esc(PLAN_FR[app.requested_plan_code] || app.requested_plan_code || "—")}</div>
      <div><strong>Envoyée le :</strong> ${esc(fmtDate(app.created_at))}</div>
      <div><strong>Statut :</strong> ${esc(STATUS_FR[app.status] || app.status || "—")}</div>
    </div>`;

  if (app.status === "approved") {
    box.innerHTML = `<h3 style="margin:0;color:var(--green,#25a844)">Demande approuvée ✓</h3>
      <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">Votre demande marchand a été approuvée par VinHT.</p>${common}
      <a class="btn btn-blue" href="merchant-center.html" style="margin-top:14px">Ouvrir mon espace marchand</a>`;
    box.style.display = "";
    if (form) form.style.display = "none";
    return true;
  }
  if (app.status === "pending") {
    box.innerHTML = `<h3 style="margin:0;color:var(--blue,#0b2edc)">Votre demande marchand est en cours d'examen.</h3>
      <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">Aucun compte marchand n'est encore activé.</p>${common}`;
    box.style.display = "";
    if (form) form.style.display = "none";
    return true;
  }
  if (app.status === "rejected") {
    const reason = app.rejection_reason
      ? `<div style="margin-top:8px;font-size:13px;color:#b0122a"><strong>Motif :</strong> ${esc(app.rejection_reason)}</div>`
      : "";
    box.innerHTML = `<h3 style="margin:0;color:var(--red,#f31938)">Demande précédente refusée</h3>${reason}${common}
      <p style="margin:10px 0 0;font-size:13px;color:var(--muted,#6f7891)">Vous pouvez soumettre une nouvelle demande ci-dessous.</p>`;
    box.style.display = "";
    if (form) form.style.display = ""; // nouvelle demande autorisée
    return false;
  }
  return false;
}

let _kycMounted = false;
function hideKyc() {
  const h = document.querySelector("#merchantKycHost");
  if (h) { h.style.display = "none"; h.innerHTML = ""; }
  _kycMounted = false;
}
async function mountKyc(applicationId) {
  const h = document.querySelector("#merchantKycHost");
  if (!h) return;
  if (_kycMounted) return; // évite un double rendu sur re-run onAuthChange
  _kycMounted = true;
  try { await startMerchantKyc(applicationId || null); } catch (e) { /* start est idempotent ; on rend quand même */ }
  await renderMerchantKycFlow(h, { applicationId: applicationId || null });
}

async function refreshApplicationState() {
  const form = $("#merchantForm");
  const box = $("#merchantState");
  const session = await getActiveSession();

  if (!session) {
    if (box) {
      box.innerHTML = `<h3 style="margin:0">Connexion requise</h3>
        <p style="margin:6px 0 14px;font-size:13px;color:var(--muted,#6f7891)">Connectez-vous pour envoyer votre demande marchand.</p>
        <button class="btn btn-blue" type="button" id="maLoginBtn">Se connecter</button>`;
      box.style.display = "";
      $("#maLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    }
    if (form) form.style.display = "none";
    return;
  }

  // Source principale : le contexte d'accès backend. Un compte déjà marchand
  // (actif / en pause / suspendu) ne doit jamais revoir le formulaire de demande.
  try {
    const ctx = await getMyAccessContext();
    const access = ctx.merchant_access || {};
    if (access.has_merchant || ctx.capabilities?.can_open_merchant_center) {
      if (box) {
        box.innerHTML = `<h3 style="margin:0;color:var(--green,#25a844)">Vous avez déjà un espace marchand</h3>
          <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">${esc(access.message_fr || "Votre compte marchand est actif.")}</p>
          <a class="btn btn-blue" href="merchant-center.html" style="margin-top:14px">Ouvrir mon espace marchand</a>`;
        box.style.display = "";
      }
      if (form) form.style.display = "none";
      return;
    }
    if (access.state === "application_pending") {
      if (box) {
        box.innerHTML = `<h3 style="margin:0;color:var(--blue,#0b2edc)">Demande marchand reçue</h3>
          <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">Complétez la vérification d'identité ci-dessous. VinHT validera votre boutique une fois l'identité approuvée.</p>`;
        box.style.display = "";
      }
      if (form) form.style.display = "none";
      await mountKyc(ctx.latest_merchant_application?.id || null);
      return;
    }
    if (access.state === "provisioning_required") {
      if (box) {
        box.innerHTML = `<h3 style="margin:0">Espace marchand en cours d'activation</h3>
          <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">${esc(access.message_fr || "Votre compte marchand est en cours d'activation.")}</p>`;
        box.style.display = "";
      }
      if (form) form.style.display = "none";
      hideKyc();
      return;
    }
    if (access.state === "application_rejected") {
      const appRow = ctx.latest_merchant_application || {};
      const reason = String(appRow.rejection_reason || "").trim();
      if (box) {
        box.innerHTML = `<h3 style="margin:0;color:var(--red,#f31938)">Demande précédente refusée</h3>
          ${reason ? `<div style="margin-top:8px;font-size:13px;color:#b0122a"><strong>Motif :</strong> ${esc(reason)}</div>` : ""}
          <p style="margin:10px 0 0;font-size:13px;color:var(--muted,#6f7891)">${
            access.can_apply ? "Vous pouvez soumettre une nouvelle demande ci-dessous." : esc(access.message_fr || "")
          }</p>`;
        box.style.display = "";
      }
      if (form) form.style.display = access.can_apply ? "" : "none";
      hideKyc();
      return;
    }
    // not_merchant / autre -> formulaire normal.
    if (box) box.style.display = "none";
    if (form) form.style.display = "";
    hideKyc();
    return;
  } catch (e) {
    console.warn("[VinHT] contexte d'accès marchand:", e && e.message);
    // Repli : ancien chemin basé sur les candidatures.
  }

  try {
    const apps = await getMyMerchantApplications();
    if (apps.length && apps[0].status === "pending") {
      if (form) form.style.display = "none";
      await mountKyc(apps[0].id);
      return;
    }
    if (apps.length) {
      const blocking = renderExistingState(apps[0]);
      if (blocking) return;
    }
    if (box && !apps.length) box.style.display = "none";
    if (form) form.style.display = "";
  } catch (e) {
    console.warn("[VinHT] demandes marchand:", e && e.message);
    if (form) form.style.display = "";
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  showMsg("");

  const btn = $("#merchantSubmit");
  const shopName = ($("#maShopName")?.value || "").trim();
  const merchantType = $("#maType")?.value || "";
  const requestedPlanCode = $("#maPlan")?.value || "";

  if (!shopName) return showMsg("Le nom de la boutique est requis."), $("#maShopName")?.focus();
  if (!merchantType) return showMsg("Choisissez un type de marchand."), $("#maType")?.focus();
  if (!requestedPlanCode) return showMsg("Choisissez un plan."), $("#maPlan")?.focus();

  const session = await getActiveSession();
  if (!session) {
    showMsg("Connectez-vous pour envoyer votre demande marchand.");
    openAuthModal("login");
    return;
  }

  const socialUrl = ($("#maSocial")?.value || "").trim();
  const safeSocial = /^https?:\/\//i.test(socialUrl) ? socialUrl : "";
  const input = {
    fullName: ($("#maFullName")?.value || "").trim() || null,
    email: ($("#maEmail")?.value || "").trim() || null,
    phone: ($("#maPhone")?.value || "").trim() || null,
    whatsappNumber: ($("#maWhatsapp")?.value || "").trim() || null,
    shopName,
    shopDescription: ($("#maDesc")?.value || "").trim() || null,
    merchantType,
    requestedPlanCode,
    productCategories: selectedCategorySlugs, // slugs, envoyés seulement si non vide (voir service)
    socialLinks: safeSocial ? { website: safeSocial } : null,
  };

  const original = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Envoi…";
  }
  try {
    const app = await createMerchantApplication(input);
    const box = $("#merchantState");
    const form = $("#merchantForm");
    if (box) {
      box.innerHTML = `<h3 style="margin:0;color:var(--blue,#0b2edc)">Demande envoyée ✓</h3>
        <p style="margin:6px 0 0;font-size:13px;color:var(--muted,#6f7891)">Dernière étape : vérifiez votre identité ci-dessous. Aucun compte marchand n'est activé tant que l'identité n'est pas approuvée.</p>
        <div style="font-size:13px;color:var(--muted,#6f7891);margin-top:8px">
          <div><strong>Boutique :</strong> ${esc(app.shop_name || shopName)}</div>
          <div><strong>Type :</strong> ${esc(TYPE_FR[app.merchant_type] || merchantType)}</div>
          <div><strong>Plan demandé :</strong> ${esc(PLAN_FR[app.requested_plan_code] || requestedPlanCode)}</div>
          <div><strong>Statut :</strong> ${esc(STATUS_FR[app.status] || app.status || "En cours d'examen")}</div>
        </div>`;
      box.style.display = "";
    }
    if (form) form.style.display = "none";
    // Étape 2 : démarrer / afficher le KYC pour cette candidature.
    _kycMounted = false;
    await mountKyc(app.id);
  } catch (err) {
    console.warn("[VinHT] création demande marchand:", err && (err.message || err));
    showMsg(mapError(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || "Envoyer ma demande";
    }
  }
}

function mapError(err) {
  const code = err && err.code ? String(err.code) : "";
  const m = String((err && (err.message || err.details)) || "").toLowerCase();

  // Violation d'unicité PostgreSQL : 1 seule demande "pending" par user (contrainte DB).
  if (code === "23505" || /23505|duplicate key|unique constraint/.test(m))
    return "Vous avez déjà une demande marchand en cours d'examen.";
  if (/not-authenticated|permission denied|rls|jwt|401|403/.test(m + " " + code))
    return "Connectez-vous pour envoyer votre demande marchand.";
  if (/invalid-merchant-type/.test(m)) return "Type de marchand invalide.";
  if (/invalid-plan/.test(m)) return "Plan invalide.";
  if (/shop-name-required/.test(m)) return "Le nom de la boutique est requis.";
  if (/column .* does not exist|product_categories|social_links|malformed array/.test(m))
    return "Certaines informations optionnelles n'ont pas pu être enregistrées. Réessayez sans les catégories / le lien.";
  if (/network|fetch failed|timeout/.test(m))
    return "Connexion impossible. Vérifiez votre réseau et réessayez.";
  return "L'envoi de la demande a échoué. Réessayez.";
}

export function initMerchant() {
  const form = $("#merchantForm");
  if (!form) return; // pas merchant.html

  if (!isSupabaseConfigured()) {
    const box = $("#merchantState");
    if (box) {
      box.textContent = "Service indisponible : configuration manquante.";
      box.style.display = "";
    }
    form.style.display = "none";
    return;
  }

  fillPlans();
  fillCategories();
  form.addEventListener("submit", handleSubmit);
  refreshApplicationState();
  onAuthChange(() => refreshApplicationState());
}
