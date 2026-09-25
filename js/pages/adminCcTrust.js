// Control Center — onglets « Confiance & Sécurité » et « Paiements ».
//
// Actions financières (résolution de litige, remboursement) : motif obligatoire,
// conséquences affichées, phrase de confirmation en Production. Aucun solde ni
// ledger n'est jamais modifié directement : uniquement des RPC Admin.
// Les réglages Paiements utilisent uniquement des façades Admin sécurisées ; aucune lecture directe app_private.

import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";
import { esc, fmtDateTime, chip, onOff, envPill, errorBox, emptyBox, confirmAction, formModal, adminErrorFr } from "../ui/adminUi.js";
import {
  adminGetTradeProtectionControl, adminUpdateTradeProtectionControl, adminListTradeClaims, adminResolveTradeClaim, adminWaiveTradeReturn,
  adminListVerifiedReviews, adminModerateReview, adminListCertifications, adminReviewCertification,
  adminListVerificationBadges, adminReviewVerificationBadge, adminPreflightFlexicashLogisticsProduction,
  adminListPaymentProviderRuntimeControls, adminSetPaymentProviderRuntimeControl, adminGetMfaAssuranceLevel, adminVerifyTotpAal2,
  adminGetMerchantSubscriptionBillingPolicy, adminSetProfessionalProductionPayments,
  adminListProfessionalBillingDeadLetters, adminRequeueProfessionalBillingDeadLetter,
} from "../services/adminControl.js";
import { adminListProfessionalSubscriptions, adminListFlexicashSellerConnections, getAdminPayoutReversalAlerts } from "../services/admin.js?v=20260922-mega-a-v1";
import { PAYOUT_STATUS_FR, payoutErrorMessageFr } from "../services/merchantFulfillment.js";
import { money } from "../lib/format.js";

const HOLD_BLOCKER_FR = {
  trade_protection_disabled: "Trade Protection est désactivé.",
  financial_hold_mode_disabled: "Le mode de retenue financière n'est pas activé.",
  production_financial_hold_not_verified: "La retenue financière n'est pas vérifiée en Production : la prise de litiges reste bloquée (protection fail-closed).",
  sandbox_financial_hold_not_validated: "La retenue financière Sandbox n'est pas validée.",
  financial_hold_unavailable: "La retenue financière est indisponible.",
};
const CLAIM_STATUS_FR = { open: "Ouvert", under_review: "En examen", merchant_responded: "Marchand a répondu", resolved_buyer: "Résolu — client", resolved_merchant: "Résolu — marchand", rejected: "Rejeté", cancelled: "Annulé" };
const claimTone = (s) => (/resolved/.test(s) ? "green" : /rejected|cancelled/.test(s) ? "" : "amber");
const RETURN_FR = { required: "Retour requis", received: "Retour reçu", waived: "Retour dispensé", none: "—" };
const REVIEW_STATUS_FR = { published: "Publié", hidden: "Masqué", removed: "Retiré" };
const CERT_STATUS_FR = { draft: "Brouillon", submitted: "Soumise", under_review: "En examen", approved: "Approuvée", rejected: "Refusée", revoked: "Révoquée" };
const BADGE_FR = { verified_supplier: "Fournisseur vérifié", verified_pro: "Pro vérifié" };
const BADGE_STATUS_FR = { pending: "En attente", approved: "Approuvé", rejected: "Refusé", suspended: "Suspendu", revoked: "Révoqué" };
const PHRASE_REFUND = "REMBOURSER LE CLIENT";

const section = (title, sub, inner) => `<div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">${esc(title)}</h3>${sub ? `<p class="muted" style="margin:2px 0 0">${sub}</p>` : ""}</div></div>${inner}</div>`;

// ---------------------------------------------------------------------------
// CONFIANCE & SÉCURITÉ
// ---------------------------------------------------------------------------
export async function renderTrust(body, { env }) {
  const isProd = env === "production";
  body.innerHTML = `
    <div data-tp-control></div>
    ${section("Litiges Trade Insurance", `Réclamations clients, résolution et retour marchandise. ${envPill(env)}`, `<div data-claims><div class="loading-state">Chargement…</div></div>`)}
    ${section("Avis vérifiés", "Modération a posteriori (masquer / retirer avec motif).", `<div class="toolbar-group" style="margin-bottom:8px"><select class="input" data-review-status><option value="">Tous</option>${Object.entries(REVIEW_STATUS_FR).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div><div data-reviews><div class="loading-state">Chargement…</div></div>`)}
    ${section("Certifications marchands", "Examen des certificats soumis.", `<div data-certs><div class="loading-state">Chargement…</div></div>`)}
    ${section("Badges de vérification", "Fournisseur vérifié / Pro vérifié : l'approbation exige l'éligibilité actuelle calculée par le serveur.", `<div data-badges><div class="loading-state">Chargement…</div></div>`)}`;

  // ---- Trade Protection : contrôle ----
  const tpEl = body.querySelector("[data-tp-control]");
  const loadTp = async () => {
    tpEl.innerHTML = section("Trade Protection — réglages", `Contrôle runtime (${envPill(env)}). Toute modification exige un motif.`, `<div class="loading-state">Chargement…</div>`);
    try {
      const c = await adminGetTradeProtectionControl();
      const blocker = c.financial_hold_blocker;
      tpEl.innerHTML = section("Trade Protection — réglages", `Contrôle runtime. ${envPill(env)}`, `
        <div class="settings-section"><div><strong>Trade Protection activé</strong></div>${onOff(c.enabled === true)}</div>
        <div class="settings-section"><div><strong>Prise de litiges par les clients</strong><p>Exige une retenue financière disponible.</p></div>${onOff(c.claim_intake_enabled === true)}</div>
        <div class="settings-section"><div><strong>Confirmation de réception par le client</strong></div>${onOff(c.client_receipt_confirmation_enabled === true)}</div>
        <div class="settings-section"><div><strong>Fenêtre de réclamation</strong></div>${chip(c.claim_window_hours != null ? c.claim_window_hours + " h" : "—")}</div>
        <div class="settings-section"><div><strong>Retenue financière</strong><p>Mode : ${esc(c.funds_hold_mode || "—")} · Capacité fournisseur : ${esc(c.provider_hold_capability || "—")}</p></div>${onOff(c.financial_hold_available === true, "Disponible", "Indisponible")}</div>
        ${blocker ? `<div class="error-state" style="margin:8px 0">${esc(HOLD_BLOCKER_FR[blocker] || blocker)}</div>` : ""}
        ${c.public_message_fr ? `<p class="muted">Message public : ${esc(c.public_message_fr)}</p>` : ""}
        <button class="btn btn-blue btn-sm" type="button" data-edit-tp>Modifier les réglages…</button>`);
      tpEl.querySelector("[data-edit-tp]").addEventListener("click", async () => {
        const f = await formModal({ title: "Réglages Trade Protection", env, confirmLabel: "Continuer",
          fields: [{ name: "enabled", label: "Trade Protection activé", type: "checkbox", value: c.enabled }, { name: "intake", label: "Prise de litiges par les clients", type: "checkbox", value: c.claim_intake_enabled },
            { name: "receipt", label: "Confirmation de réception par le client", type: "checkbox", value: c.client_receipt_confirmation_enabled },
            { name: "hours", label: "Fenêtre de réclamation (heures)", type: "number", min: 1, value: c.claim_window_hours },
            { name: "msg", label: "Message public", type: "textarea", value: c.public_message_fr }] });
        if (!f) return;
        const patch = { enabled: f.values.enabled, claim_intake_enabled: f.values.intake, client_receipt_confirmation_enabled: f.values.receipt, public_message_fr: f.values.msg };
        if (f.values.hours != null) patch.claim_window_hours = f.values.hours;
        const ok = await confirmAction({ title: "Enregistrer les réglages Trade Protection ?", env, requireReason: true, danger: isProd, confirmLabel: "Enregistrer",
          consequences: [isProd ? "Effet immédiat sur les clients et marchands réels." : "Effet immédiat en Demo.", "Le serveur refuse d'ouvrir la prise de litiges si la retenue financière n'est pas disponible."] });
        if (!ok) return;
        try { await adminUpdateTradeProtectionControl(patch, ok.reason); showToast("Réglages enregistrés ✓"); loadTp(); }
        catch (e) { showToast(adminErrorFr(e, "Réglages refusés par le backend."), "red"); }
      });
    } catch (e) { tpEl.innerHTML = section("Trade Protection — réglages", "", errorBox(adminErrorFr(e, "Réglages indisponibles."), "data-retry")); tpEl.querySelector("[data-retry]")?.addEventListener("click", loadTp); }
  };

  // ---- Litiges ----
  const claimsEl = body.querySelector("[data-claims]");
  const loadClaims = async () => {
    claimsEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    let rows;
    try { rows = (await adminListTradeClaims({ limit: 100 })).rows; } catch (e) { claimsEl.innerHTML = errorBox(adminErrorFr(e, "Litiges indisponibles."), "data-retry"); claimsEl.querySelector("[data-retry]")?.addEventListener("click", loadClaims); return; }
    if (!rows.length) { claimsEl.innerHTML = emptyBox("Aucun litige", "Aucune réclamation dans cet environnement."); return; }
    claimsEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Litige</th><th>Statut</th><th>Retour</th><th>Action financière</th><th>Date</th><th></th></tr></thead><tbody>${rows.map((c) => {
      const closed = /^(resolved_|rejected|cancelled)/.test(c.status);
      return `<tr><td><strong>${esc(c.shop_name || "—")}</strong><div class="muted">${esc(c.reason_code || "")} — ${esc(String(c.description || "").slice(0, 90))}</div>${c.merchant_response ? `<div class="muted">Marchand : ${esc(String(c.merchant_response).slice(0, 90))}</div>` : ""}</td>
        <td>${chip(CLAIM_STATUS_FR[c.status] || c.status, claimTone(c.status))}</td>
        <td>${esc(RETURN_FR[c.return_status] || c.return_status || "—")}</td>
        <td>${c.financial_action ? `${esc(c.financial_action)} · ${esc(c.financial_status || "")}` : "—"}${c.financial_error ? `<div class="muted" style="color:var(--red)">${esc(c.financial_error)}</div>` : ""}</td>
        <td>${esc(fmtDateTime(c.created_at))}</td>
        <td class="toolbar-group">${closed ? "" : `<button class="btn btn-outline-blue btn-sm" type="button" data-claim="${esc(c.claim_id)}" data-res="under_review">En examen</button><button class="btn btn-outline-blue btn-sm" type="button" data-claim="${esc(c.claim_id)}" data-res="resolved_merchant">Donner raison au marchand</button><button class="btn btn-outline-red btn-sm" type="button" data-claim="${esc(c.claim_id)}" data-res="resolved_buyer">Donner raison au client</button><button class="btn btn-ghost btn-sm" type="button" data-claim="${esc(c.claim_id)}" data-res="rejected">Rejeter</button>${c.return_status === "required" ? `<button class="btn btn-ghost btn-sm" type="button" data-waive="${esc(c.claim_id)}">Dispenser du retour</button>` : ""}`}</td></tr>`;
    }).join("")}</tbody></table></div>`;
    claimsEl.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", () => resolveClaim(b.dataset.claim, b.dataset.res)));
    claimsEl.querySelectorAll("[data-waive]").forEach((b) => b.addEventListener("click", () => waive(b.dataset.waive)));
  };
  const RES_CONS = {
    under_review: ["Le litige passe « en examen » ; aucun mouvement d'argent."],
    resolved_merchant: ["Le litige est clos en faveur du marchand.", "Les fonds retenus sont libérés selon les règles serveur."],
    resolved_buyer: ["Le litige est résolu en faveur du client : une action financière (remboursement) est déclenchée côté serveur.", "Pour certains motifs, le remboursement reste bloqué tant que le retour n'est pas confirmé ou dispensé.", "Cette action est irréversible."],
    rejected: ["La réclamation est rejetée ; aucun remboursement."],
  };
  const resolveClaim = async (id, res) => {
    const money = res === "resolved_buyer";
    const ok = await confirmAction({ title: `Résoudre le litige : ${{ under_review: "mise en examen", resolved_merchant: "en faveur du marchand", resolved_buyer: "en faveur du client", rejected: "rejet" }[res]} ?`, env, requireReason: true, reasonLabel: "Note de résolution (visible dans l'historique)", confirmLabel: "Confirmer", danger: money, phrase: money && isProd ? PHRASE_REFUND : null, consequences: RES_CONS[res] });
    if (!ok) return;
    try { const r = await adminResolveTradeClaim(id, res, ok.reason); showToast(r?.message_fr || "Litige mis à jour ✓"); loadClaims(); }
    catch (e) { showToast(adminErrorFr(e, "Résolution refusée par le backend."), "red"); }
  };
  const waive = async (id) => {
    const ok = await confirmAction({ title: "Dispenser le client du retour de la marchandise ?", env, requireReason: true, reasonLabel: "Motif de la dispense", danger: true, confirmLabel: "Dispenser",
      consequences: ["Le remboursement du client n'attendra plus la confirmation du retour.", "La dispense est tracée dans l'historique du litige."] });
    if (!ok) return;
    try { await adminWaiveTradeReturn(id, ok.reason); showToast("Retour dispensé ✓"); loadClaims(); } catch (e) { showToast(adminErrorFr(e, "Dispense refusée."), "red"); }
  };

  // ---- Avis ----
  const reviewsEl = body.querySelector("[data-reviews]");
  const loadReviews = async () => {
    reviewsEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    let rows;
    try { rows = (await adminListVerifiedReviews({ status: body.querySelector("[data-review-status]").value || null, limit: 50 })).rows; } catch (e) { reviewsEl.innerHTML = errorBox(adminErrorFr(e, "Avis indisponibles.")); return; }
    if (!rows.length) { reviewsEl.innerHTML = emptyBox("Aucun avis", ""); return; }
    reviewsEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Avis</th><th>Note</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><strong>${esc(r.product_name || r.merchant_shop_name || "—")}</strong><div class="muted">${esc(r.title || "")} ${esc(String(r.body || "").slice(0, 120))}</div>${r.moderation_reason ? `<div class="muted">Modération : ${esc(r.moderation_reason)}</div>` : ""}</td><td>${"★".repeat(Math.max(0, Math.min(5, r.rating | 0)))}</td><td>${chip(REVIEW_STATUS_FR[r.status] || r.status, r.status === "published" ? "green" : "amber")}</td>
      <td class="toolbar-group">${["published", "hidden", "removed"].filter((s) => s !== r.status).map((s) => `<button class="btn btn-ghost btn-sm" type="button" data-rev="${esc(r.review_id)}" data-to="${s}">${{ published: "Republier", hidden: "Masquer…", removed: "Retirer…" }[s]}</button>`).join("")}</td></tr>`).join("")}</tbody></table></div>`;
    reviewsEl.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", async () => {
      const to = b.dataset.to; const needReason = to !== "published";
      const ok = await confirmAction({ title: `${{ published: "Republier", hidden: "Masquer", removed: "Retirer" }[to]} cet avis ?`, env, requireReason: needReason, confirmLabel: "Confirmer", consequences: to === "published" ? ["L'avis redevient visible publiquement."] : ["L'avis n'est plus visible publiquement.", "Le motif est enregistré."] });
      if (!ok) return;
      try { await adminModerateReview(b.dataset.rev, to, ok.reason || null); showToast("Avis mis à jour ✓"); loadReviews(); } catch (e) { showToast(adminErrorFr(e, "Modération refusée."), "red"); }
    }));
  };
  body.querySelector("[data-review-status]").addEventListener("change", loadReviews);

  // ---- Certifications ----
  const certsEl = body.querySelector("[data-certs]");
  const loadCerts = async () => {
    certsEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    let rows;
    try { rows = (await adminListCertifications({ limit: 50 })).rows; } catch (e) { certsEl.innerHTML = errorBox(adminErrorFr(e, "Certifications indisponibles.")); return; }
    if (!rows.length) { certsEl.innerHTML = emptyBox("Aucune certification", ""); return; }
    certsEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Certification</th><th>Marchand</th><th>Statut</th><th></th></tr></thead><tbody>${rows.map((c) => {
      const review = ["submitted", "under_review"].includes(c.status);
      return `<tr><td><strong>${esc(c.name || "—")}</strong><div class="muted">${esc(c.issuer || "")} ${c.certificate_number ? "· n° " + esc(c.certificate_number) : ""} ${c.expiry_date ? "· expire " + esc(c.expiry_date) : ""}${c.is_expired ? " " + chip("Expirée", "red") : ""}</div>${c.verification_url ? `<a class="muted" href="${esc(c.verification_url)}" target="_blank" rel="noopener noreferrer">Vérifier en ligne</a>` : ""}</td><td>${esc(c.shop_name || "—")}</td><td>${chip(CERT_STATUS_FR[c.status] || c.status, c.status === "approved" ? "green" : c.status === "rejected" || c.status === "revoked" ? "red" : "amber")}</td>
      <td class="toolbar-group">${review ? `<button class="btn btn-blue btn-sm" data-cert="${esc(c.certification_id)}" data-d="approved" type="button">Approuver</button><button class="btn btn-outline-red btn-sm" data-cert="${esc(c.certification_id)}" data-d="rejected" type="button">Refuser…</button>` : ""}${c.status === "approved" ? `<button class="btn btn-outline-red btn-sm" data-cert="${esc(c.certification_id)}" data-d="revoked" type="button">Révoquer…</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
    certsEl.querySelectorAll("[data-cert]").forEach((b) => b.addEventListener("click", async () => {
      const d = b.dataset.d;
      const ok = await confirmAction({ title: `${{ approved: "Approuver", rejected: "Refuser", revoked: "Révoquer" }[d]} cette certification ?`, env, requireReason: d !== "approved", confirmLabel: "Confirmer", danger: d !== "approved", consequences: d === "approved" ? ["La certification devient visible sur le profil de confiance du marchand."] : ["Le marchand est informé ; le motif est enregistré."] });
      if (!ok) return;
      try { await adminReviewCertification(b.dataset.cert, d, ok.reason || null); showToast("Certification mise à jour ✓"); loadCerts(); } catch (e) { showToast(adminErrorFr(e, "Décision refusée."), "red"); }
    }));
  };

  // ---- Badges ----
  const badgesEl = body.querySelector("[data-badges]");
  const loadBadges = async () => {
    badgesEl.innerHTML = `<div class="loading-state">Chargement…</div>`;
    let rows;
    try { rows = (await adminListVerificationBadges({ limit: 50 })).rows; } catch (e) { badgesEl.innerHTML = errorBox(adminErrorFr(e, "Badges indisponibles.")); return; }
    if (!rows.length) { badgesEl.innerHTML = emptyBox("Aucune demande de badge", ""); return; }
    badgesEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Marchand</th><th>Badge</th><th>Statut</th><th>Éligibilité actuelle</th><th></th></tr></thead><tbody>${rows.map((b) => {
      const elig = b.current_eligibility || {};
      return `<tr><td><strong>${esc(b.shop_name || "—")}</strong><div class="muted">${esc(b.merchant_type || "")}</div></td><td>${esc(BADGE_FR[b.badge_type] || b.badge_type)}</td><td>${chip(BADGE_STATUS_FR[b.status] || b.status, b.status === "approved" ? "green" : b.status === "pending" ? "amber" : "red")}${b.valid_until ? `<div class="muted">jusqu'au ${esc(b.valid_until)}</div>` : ""}</td><td>${elig.eligible === true ? chip("Éligible", "green") : elig.eligible === false ? chip("Non éligible", "red") : "—"}</td>
        <td class="toolbar-group">${b.status === "pending" ? `<button class="btn btn-blue btn-sm" data-bm="${esc(b.merchant_id)}" data-bt="${esc(b.badge_type)}" data-d="approved" type="button" ${elig.eligible === false ? "disabled" : ""}>Approuver</button><button class="btn btn-outline-red btn-sm" data-bm="${esc(b.merchant_id)}" data-bt="${esc(b.badge_type)}" data-d="rejected" type="button">Refuser…</button>` : ""}${b.status === "approved" ? `<button class="btn btn-outline-red btn-sm" data-bm="${esc(b.merchant_id)}" data-bt="${esc(b.badge_type)}" data-d="suspended" type="button">Suspendre…</button><button class="btn btn-outline-red btn-sm" data-bm="${esc(b.merchant_id)}" data-bt="${esc(b.badge_type)}" data-d="revoked" type="button">Révoquer…</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
    badgesEl.querySelectorAll("[data-bm]").forEach((btn) => btn.addEventListener("click", async () => {
      const d = btn.dataset.d;
      let days = 365;
      if (d === "approved") {
        const f = await formModal({ title: "Approuver le badge", env, confirmLabel: "Approuver", fields: [{ name: "days", label: "Validité (jours, 1 à 1095)", type: "number", min: 1, max: 1095, value: 365, required: true }] });
        if (!f) return; days = f.values.days;
      }
      const ok = await confirmAction({ title: `${{ approved: "Approuver", rejected: "Refuser", suspended: "Suspendre", revoked: "Révoquer" }[d]} ce badge ?`, env, requireReason: d !== "approved", confirmLabel: "Confirmer", danger: d !== "approved", consequences: d === "approved" ? ["Le badge s'affiche publiquement pour la durée choisie.", "Le serveur revérifie l'éligibilité à l'instant de la décision."] : ["Le badge est retiré de l'affichage public.", "Le motif est enregistré."] });
      if (!ok) return;
      try { await adminReviewVerificationBadge(btn.dataset.bm, btn.dataset.bt, d, ok.reason || null, days); showToast("Badge mis à jour ✓"); loadBadges(); } catch (e) { showToast(adminErrorFr(e, "Décision refusée."), "red"); }
    }));
  };

  await Promise.all([loadTp(), loadClaims(), loadReviews(), loadCerts(), loadBadges()]);
  refreshIcons();
}

// ---------------------------------------------------------------------------
// PAIEMENTS
// ---------------------------------------------------------------------------
export async function renderPayments(body, { env }) {
  body.innerHTML = `
    <div class="portal-card"><h3 style="margin-top:0">Fournisseurs de paiement & Production</h3>
      <p class="muted">Lecture et contrôle via RPC Admin. Aucun paiement n'est déclenché ici et aucun solde/ledger n'est modifié directement.</p>
      <div data-provider-controls><div class="loading-state">Chargement des fournisseurs…</div></div>
      <hr style="border:0;border-top:1px solid var(--border,#e5e8ef);margin:16px 0">
      <div data-billing-policy><div class="loading-state">Chargement de la politique Pro…</div></div>
      <hr style="border:0;border-top:1px solid var(--border,#e5e8ef);margin:16px 0">
      <div data-deadletters><div class="loading-state">Chargement des dead letters…</div></div>
    </div>
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Préflight FlexiCash / Logistique (Production)</h3><p class="muted" style="margin:2px 0 0">Lecture seule : vérifie l'état de préparation de l'intégration Production.</p></div><button class="btn btn-outline-blue btn-sm" type="button" data-run-pf>Lancer le préflight</button></div><div data-pf></div></div>
    <div class="portal-card"><h3 style="margin-top:0;color:#b0122a">⚠ Versements déjà payés — régularisation requise</h3>
      <p class="muted">Commande annulée/remboursée APRÈS versement au marchand : le versement reste « Payé » (le backend ne le modifie jamais tout seul) mais VinHT doit engager la régularisation (reversal/recouvrement).</p>
      <div data-reversal><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Abonnements Pro à surveiller</h3><div data-pro><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Connexions FlexiCash des vendeurs</h3><div data-fx><div class="loading-state">Chargement…</div></div></div>`;


  const providerEl = body.querySelector("[data-provider-controls]");
  const billingEl = body.querySelector("[data-billing-policy]");
  const deadEl = body.querySelector("[data-deadletters]");

  const loadProviders = async () => {
    providerEl.innerHTML = '<div class="loading-state">Chargement…</div>';
    let rows;
    try { rows = (await adminListPaymentProviderRuntimeControls()).rows; }
    catch (e) { providerEl.innerHTML = errorBox(adminErrorFr(e, "Contrôles providers indisponibles.")); return; }
    const byProvider = new Map(rows.map((r)=>[r.provider,r]));
    const providers = ["moncash","natcash","paypal","card"].map((provider)=>byProvider.get(provider)||({provider,production_enabled:false,note:null,updated_at:null}));
    providerEl.innerHTML = `<h4 style="margin:0 0 8px">Providers Production</h4><div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Provider</th><th>Production</th><th>Note</th><th>Mis à jour</th><th></th></tr></thead><tbody>${providers.map((r)=>`<tr>
      <td><strong>${esc(r.provider)}</strong></td>
      <td>${r.production_enabled ? chip("ACTIF","green") : chip("DÉSACTIVÉ","amber")}</td>
      <td>${esc(r.note||"—")}</td>
      <td>${esc(fmtDateTime(r.updated_at))}</td>
      <td><button class="btn btn-outline-blue btn-sm" type="button" data-provider-edit="${esc(r.provider)}">Modifier…</button></td>
    </tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Toute mutation provider exige AAL2 (MFA) et la phrase de confirmation imposée par le backend.</p>`;
    providerEl.querySelectorAll("[data-provider-edit]").forEach((btn)=>btn.addEventListener("click",async()=>{
      const provider=btn.dataset.providerEdit;
      const current=providers.find((r)=>r.provider===provider);
      const f=await formModal({title:`Contrôle provider : ${provider}`,env,confirmLabel:"Continuer",
        fields:[
          {name:"enabled",label:"Activer en Production",type:"checkbox",value:!!current?.production_enabled},
          {name:"note",label:"Note d'audit",type:"textarea",value:current?.note||""},
        ]});
      if(!f)return;
      const aal=await adminGetMfaAssuranceLevel().catch(()=>null);
      if(aal?.currentLevel!=="aal2"){
        const m=await formModal({title:"Vérification MFA requise",env,confirmLabel:"Vérifier",
          intro:"Le backend exige une session AAL2 avant toute modification d'un provider live.",
          fields:[{name:"code",label:"Code TOTP",required:true}]});
        if(!m)return;
        try{await adminVerifyTotpAal2(m.values.code);}catch(e){showToast(adminErrorFr(e,"MFA refusée."),"red");return;}
      }
      const enabling=!!f.values.enabled;
      const phrase=enabling?"ACTIVER FOURNISSEUR LIVE VINHT":"DESACTIVER FOURNISSEUR LIVE VINHT";
      const ok=await confirmAction({title:`${enabling?"Activer":"Désactiver"} ${provider} en Production ?`,env:"production",danger:true,phrase,requireReason:false,
        confirmLabel:enabling?"Activer le provider":"Désactiver le provider",
        consequences:["Impact direct sur la disponibilité du provider en Production.","Le changement est audité côté backend."]});
      if(!ok)return;
      try{await adminSetPaymentProviderRuntimeControl(provider,enabling,f.values.note,phrase);showToast("Provider mis à jour ✓");await loadProviders();}
      catch(e){showToast(adminErrorFr(e,"Modification provider refusée."),"red");}
    }));
  };

  const loadBillingPolicy = async () => {
    billingEl.innerHTML = '<div class="loading-state">Chargement…</div>';
    let p;
    try { p = await adminGetMerchantSubscriptionBillingPolicy(); }
    catch (e) { billingEl.innerHTML = errorBox(adminErrorFr(e, "Politique Pro indisponible.")); return; }
    billingEl.innerHTML = `<div class="toolbar"><div><h4 style="margin:0">Politique de facturation Pro</h4><p class="muted" style="margin:2px 0 0">Source serveur autoritaire.</p></div>
      <button class="btn ${p.production_payments_enabled?"btn-outline-red":"btn-blue"} btn-sm" type="button" data-toggle-pro-payments>${p.production_payments_enabled?"Désactiver":"Activer"} les paiements Pro Production…</button></div>
      <div class="settings-section"><div><strong>Paiements Production</strong><p>${p.production_payments_enabled?"ACTIFS":"DÉSACTIVÉS"}</p></div>${p.production_payments_enabled?chip("ON","green"):chip("OFF","amber")}</div>
      <div class="settings-section"><div><strong>Grâce / suspension</strong><p>${esc(p.grace_days)} jour(s) · auto-suspend : ${p.auto_suspend_unpaid?"oui":"non"} · réactivation paiement : ${p.reactivate_on_payment?"oui":"non"}</p></div></div>
      <div class="settings-section"><div><strong>Offre de lancement</strong><p>${p.launch_offer_enabled?"Active":"Inactive"} · ${esc(p.launch_offer_start_date||"—")} → ${esc(p.launch_offer_end_date||"—")}</p></div></div>
      <div class="settings-section"><div><strong>Frais fixes</strong><p>${p.fixed_fees_paused?"En pause":"Actifs"} · source revenu : ${esc(p.revenue_source_code||"—")}</p></div></div>`;
    billingEl.querySelector("[data-toggle-pro-payments]")?.addEventListener("click",async()=>{
      const target=!p.production_payments_enabled;
      const ok=await confirmAction({title:`${target?"Activer":"Désactiver"} les paiements Pro Production ?`,env:"production",danger:true,requireReason:true,minReason:5,
        confirmLabel:target?"Activer":"Désactiver",
        consequences:target?["Les factures Production actuellement « due » deviennent dues maintenant.","Effet sur l'argent réel : vérifiez Stripe/rails avant confirmation."]:["Les nouveaux paiements Pro Production seront bloqués jusqu'à réactivation."]});
      if(!ok)return;
      try{await adminSetProfessionalProductionPayments(target,ok.reason);showToast("Kill-switch Pro mis à jour ✓");await loadBillingPolicy();}
      catch(e){showToast(adminErrorFr(e,"Modification refusée."),"red");}
    });
  };

  const loadDeadLetters = async () => {
    deadEl.innerHTML = '<div class="loading-state">Chargement…</div>';
    let r;
    try { r = await adminListProfessionalBillingDeadLetters({ limit: 100 }); }
    catch (e) { deadEl.innerHTML = errorBox(adminErrorFr(e, "Dead letters indisponibles.")); return; }
    if(!r.rows.length){deadEl.innerHTML='<h4 style="margin:0 0 6px">Dead letters facturation Pro</h4><p class="muted">Aucune entrée en dead letter dans cet environnement.</p>';return;}
    deadEl.innerHTML=`<h4 style="margin:0 0 8px">Dead letters facturation Pro</h4><div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Type</th><th>Entité</th><th>Marchand</th><th>Erreur</th><th>Retries</th><th>Date</th><th></th></tr></thead><tbody>${r.rows.map((x)=>`<tr>
      <td>${esc(x.entity_kind)}</td><td><code>${esc(String(x.entity_id).slice(0,8))}</code></td><td>${esc(String(x.merchant_id||"—").slice(0,8))}</td>
      <td>${esc(x.dead_letter_reason||x.last_error||"—")}</td><td>${esc(x.retry_count??0)}</td><td>${esc(fmtDateTime(x.dead_lettered_at))}</td>
      <td><button class="btn btn-outline-blue btn-sm" type="button" data-requeue-kind="${esc(x.entity_kind)}" data-requeue-id="${esc(x.entity_id)}">Requeue…</button></td>
    </tr>`).join("")}</tbody></table></div>`;
    deadEl.querySelectorAll("[data-requeue-id]").forEach((btn)=>btn.addEventListener("click",async()=>{
      const ok=await confirmAction({title:"Rejouer cette dead letter ?",env,requireReason:true,minReason:5,confirmLabel:"Requeue",
        consequences:["Le retry_count est remis à zéro et le traitement est replanifié immédiatement.","Aucun solde n'est modifié directement par cette action."]});
      if(!ok)return;
      try{await adminRequeueProfessionalBillingDeadLetter(btn.dataset.requeueKind,btn.dataset.requeueId,ok.reason);showToast("Dead letter replanifiée ✓");await loadDeadLetters();}
      catch(e){showToast(adminErrorFr(e,"Requeue refusé."),"red");}
    }));
  };

  await Promise.all([loadProviders(),loadBillingPolicy(),loadDeadLetters()]);

  // Environnement dérivé côté serveur par admin_list_payout_reversal_alerts_v1 —
  // jamais un paramètre client (voir js/services/admin.js).
  const revEl = body.querySelector("[data-reversal]");
  getAdminPayoutReversalAlerts({ limit: 50 }).then((rows) => {
    if (!rows.length) { revEl.innerHTML = '<p class="muted">Aucune alerte de versement dans cet environnement.</p>'; return; }
    revEl.innerHTML = `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Marchand</th><th>Commande</th><th>Versement</th><th>Anomalie</th><th>Mis à jour</th></tr></thead><tbody>${rows.map((r) => {
      const currency = r.currency || "HTG";
      const amount = r.payout_amount != null ? r.payout_amount : r.payout_amount_htg;
      return `<tr><td><strong>${esc(r.shop_name || String(r.merchant_id).slice(0, 8))}</strong></td><td><a href="order-detail.html?id=${encodeURIComponent(r.order_id)}">#${esc(String(r.order_id).slice(0, 8))}</a></td><td>${chip(PAYOUT_STATUS_FR.paid, "red")} <strong>${money(amount, currency)}</strong></td><td style="color:#b0122a;font-size:12px">${esc(payoutErrorMessageFr(r.payout_error))}</td><td>${esc(fmtDateTime(r.updated_at))}</td></tr>`;
    }).join("")}</tbody></table></div><p class="muted" style="font-size:12px">${esc(rows.length)} versement(s) à régulariser. Le statut « Payé » n'est jamais modifié depuis cette interface.</p>`;
  }).catch((e) => { revEl.innerHTML = errorBox(adminErrorFr(e, "Alertes de versement indisponibles.")); });


  body.querySelector("[data-run-pf]").addEventListener("click", async () => {
    const out = body.querySelector("[data-pf]"); out.innerHTML = `<div class="loading-state">Vérification…</div>`;
    try { const r = await adminPreflightFlexicashLogisticsProduction(); out.innerHTML = `<pre class="cc-pre">${esc(JSON.stringify(r, null, 2))}</pre>`; }
    catch (e) { out.innerHTML = errorBox(adminErrorFr(e, "Préflight indisponible.")); }
  });

  const proEl = body.querySelector("[data-pro]");
  Promise.all([adminListProfessionalSubscriptions({ status: "past_due", limit: 10 }), adminListProfessionalSubscriptions({ status: "suspended", limit: 10 })]).then(([pd, sp]) => {
    const row = (r) => `<div class="settings-section"><div><strong>${esc(r.shop_name || "Marchand")}</strong><p>${esc(r.plan_code || "")} · ${esc(r.status || "")}${r.latest_invoice_status ? ` · facture ${esc(r.latest_invoice_status)}` : ""}${r.latest_invoice_due_at ? ` · échéance ${esc(fmtDateTime(r.latest_invoice_due_at))}` : ""}</p></div></div>`;
    proEl.innerHTML = `<h4 style="margin:0 0 4px">En retard (${esc(pd.total ?? pd.rows.length)})</h4>${pd.rows.length ? pd.rows.map(row).join("") : '<p class="muted">Aucun.</p>'}<h4 style="margin:10px 0 4px">Suspendus (${esc(sp.total ?? sp.rows.length)})</h4>${sp.rows.length ? sp.rows.map(row).join("") : '<p class="muted">Aucun.</p>'}`;
  }).catch((e) => { proEl.innerHTML = errorBox(adminErrorFr(e, "Abonnements indisponibles.")); });

  const fxEl = body.querySelector("[data-fx]");
  adminListFlexicashSellerConnections({ limit: 20 }).then((r) => {
    fxEl.innerHTML = r.rows.length ? `<div class="table-wrap" tabindex="0"><table class="data-table"><thead><tr><th>Vendeur</th><th>Statut</th><th>Éligible paiements Production</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${esc(x.shop_name || x.merchant_id || "—")}</td><td>${chip(x.status || "—", x.status === "active" ? "green" : "amber")}</td><td>${x.provider_production_eligible === true ? chip("Oui", "green") : x.provider_production_eligible === false ? chip("Non", "red") : "—"}</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:12px">${esc(r.total ?? r.rows.length)} connexion(s).</p>` : emptyBox("Aucune connexion", "");
  }).catch((e) => { fxEl.innerHTML = errorBox(adminErrorFr(e, "Connexions indisponibles.")); });
  refreshIcons();
}
