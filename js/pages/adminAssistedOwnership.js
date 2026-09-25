// Admin Ownership — gestion complète d'un dossier d'onboarding assisté existant.
// Couche additive : ne remplace pas l'onglet Agents et n'élargit aucune RPC Agent.

import { showToast } from "../ui/toast.js";
import { formModal, confirmAction, adminErrorFr, esc } from "../ui/adminUi.js";
import { signInWithOtpToEmail } from "../services/auth.js";
import {
  adminGetAssistedDossierOwnership,
  adminUpdateAssistedDossierOwnership,
  adminMarkAssistedDossierReady,
  adminIssueAssistedDossierInvite,
} from "../services/adminAssistedOwnership.js";

let observer = null;
let busy = false;

const statusFr = {
  draft: "Brouillon",
  ready_for_invite: "Prêt pour invitation",
  invited: "Invité",
  claimed: "Réclamé",
  cancelled: "Annulé",
};

const categories = (value) => String(value || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)
  .slice(0, 20);

async function reloadDossier(id) {
  const r = await adminGetAssistedDossierOwnership(id);
  return r?.dossier || null;
}

async function editDossier(id, dossier) {
  const p = dossier?.profile || {};
  const f = await formModal({
    title: "Modifier le dossier accompagné — Admin",
    confirmLabel: "Continuer",
    intro: "L'Admin corrige le dossier sans se faire passer pour l'Agent. La modification est auditée séparément.",
    fields: [
      { name: "fullName", label: "Nom complet", value: p.full_name || "", required: true },
      { name: "shopName", label: "Nom de boutique", value: p.shop_name || "", required: true },
      { name: "merchantType", label: "Type de marchand", type: "select", value: p.merchant_type || "vendeur", required: true, options: [
        { value: "producteur", label: "Producteur" },
        { value: "revendeur", label: "Revendeur" },
        { value: "vendeur", label: "Vendeur" },
      ] },
      { name: "phone", label: "Téléphone", value: p.phone || "" },
      { name: "whatsapp", label: "WhatsApp", value: p.whatsapp_number || "" },
      { name: "email", label: "E-mail", type: "email", value: p.email || "" },
      { name: "description", label: "Description boutique", type: "textarea", value: p.shop_description || "" },
      { name: "categories", label: "Catégories produits (séparées par virgules)", value: Array.isArray(p.product_categories) ? p.product_categories.join(", ") : "" },
      { name: "address", label: "Adresse du commerce", value: p.business_address_line1 || "", required: true },
      { name: "department", label: "Département", value: p.business_department || "", required: true },
      { name: "commune", label: "Commune", value: p.business_commune || "", required: true },
    ],
  });
  if (!f) return;

  const ok = await confirmAction({
    title: "Enregistrer cette correction Admin ?",
    message: "Le dossier reste dans son workflow actuel ; aucune approbation marchande ni KYC n'est contournée.",
    requireReason: true,
    minReason: 5,
    reasonLabel: "Motif interne",
    confirmLabel: "Enregistrer",
    consequences: ["L'action sera journalisée comme Admin.", "L'Agent assigné reste inchangé."],
  });
  if (!ok) return;

  await adminUpdateAssistedDossierOwnership(id, {
    fullName: String(f.values.fullName || "").trim(),
    shopName: String(f.values.shopName || "").trim(),
    merchantType: f.values.merchantType,
    phone: String(f.values.phone || "").trim() || null,
    whatsappNumber: String(f.values.whatsapp || "").trim() || null,
    email: String(f.values.email || "").trim() || null,
    shopDescription: String(f.values.description || "").trim() || null,
    productCategories: categories(f.values.categories),
    businessAddressLine1: String(f.values.address || "").trim(),
    businessDepartment: String(f.values.department || "").trim(),
    businessCommune: String(f.values.commune || "").trim(),
  }, ok.reason);
  showToast("Dossier corrigé par l’Admin ✓");
  location.reload();
}

async function markReady(id) {
  const ok = await confirmAction({
    title: "Marquer ce dossier prêt pour invitation ?",
    requireReason: true,
    minReason: 5,
    reasonLabel: "Motif interne",
    confirmLabel: "Marquer prêt",
    consequences: ["Le backend revérifie identité, contact et adresse.", "Le compte marchand n'est pas créé ni approuvé à cette étape."],
  });
  if (!ok) return;
  await adminMarkAssistedDossierReady(id, ok.reason);
  showToast("Dossier prêt pour invitation ✓");
  location.reload();
}

async function issueInvite(id, resend = false) {
  const ok = await confirmAction({
    title: resend ? "Renvoyer l'invitation marchand ?" : "Envoyer l'invitation marchand ?",
    requireReason: true,
    minReason: 5,
    reasonLabel: "Motif interne",
    confirmLabel: resend ? "Renvoyer" : "Envoyer",
    consequences: ["Un lien/OTP Supabase Auth sera envoyé à l'e-mail du dossier.", "Aucun mot de passe, token ou secret n'est exposé à l'Admin."],
  });
  if (!ok) return;

  const issued = await adminIssueAssistedDossierInvite(id, ok.reason);
  const delivery = issued?.delivery || {};
  if (!delivery.email) throw new Error("email_required_for_activation");
  if (!delivery.redirect_path) throw new Error("invite_redirect_path_missing");
  if (delivery.auth_action && delivery.auth_action !== "supabase.auth.signInWithOtp") throw new Error("unexpected_invite_auth_action");
  const redirectTo = new URL(delivery.redirect_path, window.location.origin).toString();
  try {
    await signInWithOtpToEmail(delivery.email, {
      redirectTo,
      shouldCreateUser: delivery.should_create_user !== false,
    });
    showToast(resend ? "Invitation renvoyée ✓" : "Invitation envoyée ✓");
  } catch (e) {
    // Le backend a déjà enregistré l'émission. Le statut invited permet de
    // retenter proprement sans falsifier l'historique.
    showToast("Invitation préparée, mais l'e-mail n'a pas pu être envoyé. Utilisez « Renvoyer ».", "red");
  }
  location.reload();
}

async function openManager(id) {
  if (busy) return;
  busy = true;
  let dossier;
  try { dossier = await reloadDossier(id); }
  catch (e) { showToast(adminErrorFr(e, "Dossier indisponible."), "red"); busy = false; return; }
  busy = false;
  if (!dossier) return;

  const p = dossier.profile || {};
  const pr = dossier.progress || {};
  const status = dossier.status || "draft";
  const canEdit = status === "draft" || status === "ready_for_invite";
  const canReady = status === "draft" && pr.ready_for_invite === true;
  const canInvite = (status === "ready_for_invite" || status === "invited") && dossier.activation?.email_available === true;

  const wrap = document.createElement("div");
  wrap.className = "cc-modal-backdrop";
  wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true" aria-label="Gestion Admin du dossier accompagné">
    <h3>Contrôle propriétaire — dossier accompagné</h3>
    <p><strong>${esc(p.shop_name || "Commerce")}</strong> · ${esc(statusFr[status] || status)}</p>
    <p class="muted">${esc(p.full_name || "—")} · ${esc(p.email || p.whatsapp_number || p.phone || "Contact non renseigné")}</p>
    <div class="settings-section"><div><strong>Adresse</strong><p>${esc([p.business_address_line1,p.business_commune,p.business_department].filter(Boolean).join(", ") || "—")}</p></div></div>
    <div class="settings-section"><div><strong>Progression</strong><p>Contact ${pr.contact_complete ? "✓" : "✗"} · Boutique ${pr.shop_complete ? "✓" : "✗"} · Adresse ${pr.address_complete ? "✓" : "✗"}</p></div></div>
    <div class="toolbar-group" style="margin-top:14px">
      ${canEdit ? '<button class="btn btn-outline-blue btn-sm" type="button" data-own-edit>Modifier…</button>' : ""}
      ${canReady ? '<button class="btn btn-blue btn-sm" type="button" data-own-ready>Marquer prêt…</button>' : ""}
      ${canInvite ? `<button class="btn btn-blue btn-sm" type="button" data-own-invite>${status === "invited" ? "Renvoyer l’invitation…" : "Envoyer l’invitation…"}</button>` : ""}
      <button class="btn btn-ghost btn-sm" type="button" data-own-close>Fermer</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("[data-own-close]")?.addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  wrap.querySelector("[data-own-edit]")?.addEventListener("click", async () => { close(); try { await editDossier(id, dossier); } catch (e) { showToast(adminErrorFr(e, "Modification refusée."), "red"); } });
  wrap.querySelector("[data-own-ready]")?.addEventListener("click", async () => { close(); try { await markReady(id); } catch (e) { showToast(adminErrorFr(e, "Transition refusée."), "red"); } });
  wrap.querySelector("[data-own-invite]")?.addEventListener("click", async () => { close(); try { await issueInvite(id, status === "invited"); } catch (e) { showToast(adminErrorFr(e, "Invitation refusée."), "red"); } });
}

function scan() {
  if (!document.body?.dataset?.adminPage && !String(location.pathname || "").includes("/admin/")) return;
  document.querySelectorAll("[data-reassign]").forEach((anchor) => {
    const id = anchor.dataset.reassign;
    const cell = anchor.closest("td") || anchor.parentElement;
    if (!id || !cell || cell.querySelector(`[data-admin-own-dossier="${CSS.escape(id)}"]`)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-blue btn-sm";
    btn.dataset.adminOwnDossier = id;
    btn.textContent = "Gérer…";
    btn.addEventListener("click", () => openManager(id));
    cell.prepend(btn);
  });
}

export function initAdminAssistedOwnership() {
  scan();
  if (observer) return;
  observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
