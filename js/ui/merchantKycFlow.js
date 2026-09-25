// Parcours utilisateur "Vérification d'identité" pour devenir marchand.
//
// 2 documents seulement : identity_document + selfie. La logique d'états et le
// bouton "Envoyer" suivent STRICTEMENT le contexte backend :
//   - états : context.state.code / .title / .message
//   - progression : context.progress.missing_required_documents
//   - bouton envoyer : context.actions.can_submit  (déjà = base && missing==0)
// On ne réécrit aucune machine à états ni validation.

import {
  getMyMerchantKycContext,
  startMerchantKyc,
  submitMerchantKyc,
  cancelMerchantKyc,
  uploadKycDocument,
  kycErrorMessage,
  KYC_DOC_MIME,
} from "../services/merchantKyc.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "./toast.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const ACCEPT_ATTR = KYC_DOC_MIME.join(",");
const DOC_META = {
  identity_document: {
    label: "Pièce d'identité",
    help: "Carte d'identité, passeport ou autre pièce officielle. JPEG, PNG, WebP ou PDF.",
    addLabel: "Ajouter ma pièce",
    okToast: "Votre pièce d'identité a été ajoutée.",
  },
  selfie: {
    label: "Selfie de vérification",
    help: "Votre visage doit être clairement visible. JPEG, PNG ou WebP.",
    addLabel: "Prendre / ajouter un selfie",
    okToast: "Votre selfie a été ajouté.",
  },
};

// nom de fichier local, uniquement pour l'affichage après un upload dans la même
// session (jamais persisté, jamais le chemin Storage).
const _lastFileName = new Map();

function fmtBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return "";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} Ko`;
  return `${(b / (1024 * 1024)).toFixed(1)} Mo`;
}
function fmtDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function currentDoc(ctx, type) {
  return (ctx.documents || []).find((d) => d.is_current && d.document_type === type) || null;
}

function docStatusChip(doc) {
  if (!doc) return `<span class="badge">Manquant</span>`;
  switch (doc.status) {
    case "accepted": return `<span class="badge green">Validé</span>`;
    case "rejected": return `<span class="badge red">Refusé</span>`;
    case "uploaded": return `<span class="badge amber">Ajouté</span>`;
    default: return `<span class="badge">${esc(doc.status)}</span>`;
  }
}

function docBlock(ctx, type, editable) {
  const meta = DOC_META[type];
  const doc = currentDoc(ctx, type);
  const name = _lastFileName.get(type);
  const rejected = doc && doc.status === "rejected";
  const info = doc
    ? `<div style="font-size:12px;color:var(--muted,#6f7891);margin-top:4px">${
        name ? `${esc(name)} · ` : ""
      }${doc.mime_type ? esc(doc.mime_type.split("/").pop().toUpperCase()) + " · " : ""}${fmtBytes(doc.file_size_bytes)}${
        doc.created_at ? ` · ajouté le ${esc(fmtDate(doc.created_at))}` : ""
      }</div>`
    : "";
  const reject = rejected && doc.review_reason
    ? `<div class="error-state" style="margin-top:8px;font-size:12px"><strong>Motif du refus :</strong> ${esc(doc.review_reason)}${
        editable ? " — remplacez ce document." : ""
      }</div>`
    : "";
  const uploadUi = editable
    ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
         <input type="file" accept="${ACCEPT_ATTR}"${type === "selfie" ? ' capture="user"' : ""} data-kyc-file="${type}">
         <button class="btn btn-outline-blue btn-sm" type="button" data-kyc-upload="${type}">${
           doc ? "Remplacer" : esc(meta.addLabel)
         }</button>
         <span data-kyc-doc-msg="${type}" style="font-size:12px;color:var(--muted,#6f7891)"></span>
       </div>`
    : "";

  return `<div class="surface" style="padding:14px 16px;margin-bottom:12px" data-kyc-doc="${type}">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <strong>${esc(meta.label)}</strong>${docStatusChip(doc)}
    </div>
    <div style="font-size:12px;color:var(--muted,#6f7891);margin-top:2px">${esc(meta.help)}</div>
    ${info}${reject}${uploadUi}
  </div>`;
}

function progressBlock(ctx) {
  const need = ctx.required_documents || [{ code: "identity_document" }, { code: "selfie" }];
  const done = need.filter((r) => {
    const d = currentDoc(ctx, r.code);
    return d && d.status !== "rejected";
  }).length;
  const line = (code) => {
    const d = currentDoc(ctx, code);
    const ok = d && d.status !== "rejected";
    return `<div style="font-size:13px;color:${ok ? "var(--green,#25a844)" : "var(--muted,#6f7891)"}">${
      ok ? "✓" : "•"
    } ${esc(DOC_META[code]?.label || code)}</div>`;
  };
  return `<div style="margin:10px 0 14px">
    <div style="font-size:13px;font-weight:700">${done} / ${need.length} document${need.length > 1 ? "s" : ""} ajouté${
    done > 1 ? "s" : ""
  }</div>
    <div style="margin-top:4px">${need.map((r) => line(r.code)).join("")}</div>
  </div>`;
}

function lockedSummary(ctx) {
  return `<div style="margin-top:6px">${["identity_document", "selfie"]
    .map((t) => {
      const d = currentDoc(ctx, t);
      return `<div class="settings-section"><div><strong>${esc(DOC_META[t].label)}</strong></div>${docStatusChip(d)}</div>`;
    })
    .join("")}</div>`;
}

// ---------------------------------------------------------------------------

export async function renderMerchantKycFlow(host, { applicationId = null, onChange = null } = {}) {
  if (!host) return null;
  host.style.display = "";
  host.innerHTML = `<div class="loading-state">Chargement de votre vérification…</div>`;

  let ctx;
  try {
    ctx = await getMyMerchantKycContext();
  } catch (err) {
    console.warn("[VinHT] kyc context:", err && (err.message || err));
    host.innerHTML = `<div class="error-state">Impossible de charger votre vérification d'identité. <button class="btn btn-outline-blue btn-sm" type="button" data-kyc-retry>Réessayer</button></div>`;
    host.querySelector("[data-kyc-retry]")?.addEventListener("click", () => renderMerchantKycFlow(host, { applicationId, onChange }));
    refreshIcons();
    return null;
  }

  // Compteur de requêtes : les deux documents peuvent être envoyés en parallèle
  // (deux boutons indépendants) ; sans garde, la réponse la plus lente peut
  // écraser un état plus complet avec un contexte plus ancien, laissant le
  // bouton "Envoyer" désactivé jusqu'à un reload manuel.
  let requestSeq = 0;

  const rerender = (freshCtx) => {
    if (freshCtx) ctx = freshCtx;
    paint();
    if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  };

  // Après un upload, on ne fait jamais confiance uniquement au contexte
  // renvoyé par cet appel précis : on re-synchronise depuis la source de
  // vérité pour garantir un état 2/2 correct même en cas de réponses
  // désordonnées entre les deux documents.
  const resyncAfterUpload = async () => {
    const mySeq = ++requestSeq;
    try {
      const latest = await getMyMerchantKycContext();
      if (mySeq === requestSeq) rerender(latest);
    } catch {
      /* le contexte renvoyé par l'upload lui-même reste affiché */
    }
  };

  function paint() {
    const state = ctx.state || { code: "not_started", title: "Vérification marchand", message: "" };
    const code = state.code;
    const actions = ctx.actions || {};
    const editable = code === "draft" || code === "changes_requested";
    const intro = `<p style="margin:0 0 12px;font-size:13px;color:var(--muted,#6f7891)">Pour protéger les acheteurs et les marchands, VinHT vérifie votre identité avant d'activer votre boutique.</p>`;

    // Pas de dossier -> CTA de démarrage.
    if (!ctx.case) {
      host.innerHTML = `<h3 style="margin:0 0 4px">Vérification de votre identité</h3>${intro}
        ${actions.can_start
          ? `<button class="btn btn-blue" type="button" data-kyc-start>Commencer ma vérification</button>`
          : `<p class="muted" style="font-size:13px">Créez d'abord votre demande marchand pour lancer la vérification.</p>`}`;
      host.querySelector("[data-kyc-start]")?.addEventListener("click", async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = "Ouverture…";
        try { rerender(await startMerchantKyc(applicationId)); }
        catch (err) { showToast(kycErrorMessage(err, "Impossible de démarrer la vérification."), "red"); b.disabled = false; b.textContent = "Commencer ma vérification"; }
      });
      refreshIcons();
      return;
    }

    let body = "";
    if (editable) {
      const reasonBanner = code === "changes_requested"
        ? `<div class="error-state" style="margin-bottom:12px"><strong>Des corrections sont nécessaires.</strong><br>${esc(state.message || "")}</div>`
        : "";
      body = `${reasonBanner}${progressBlock(ctx)}
        ${docBlock(ctx, "identity_document", true)}
        ${docBlock(ctx, "selfie", true)}
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px">
          <button class="btn btn-blue" type="button" data-kyc-submit ${actions.can_submit ? "" : "disabled"}>Envoyer pour vérification</button>
          ${actions.can_cancel ? `<button class="btn btn-ghost btn-sm" type="button" data-kyc-cancel>Annuler le dossier</button>` : ""}
          <span data-kyc-submit-msg style="font-size:12px;color:var(--muted,#6f7891)"></span>
        </div>
        ${actions.can_submit ? "" : `<p class="muted" style="font-size:12px;margin-top:8px">Ajoutez les deux documents pour pouvoir envoyer.</p>`}`;
    } else if (code === "submitted") {
      body = `<div class="green-note" style="margin-bottom:10px">Votre dossier a été envoyé à VinHT.</div>${lockedSummary(ctx)}`;
    } else if (code === "under_review") {
      body = `<div class="green-note" style="margin-bottom:10px">Votre identité est en cours de vérification.</div>${lockedSummary(ctx)}`;
    } else if (code === "approved") {
      const appPending = ctx.application && ctx.application.status === "pending";
      body = `<div class="surface" style="padding:16px;background:#eefaf1;border:1px solid #bce9c8;margin-bottom:10px">
          <strong style="color:var(--green,#1f9d4d);display:flex;align-items:center;gap:6px"><i data-lucide="badge-check"></i> Identité vérifiée</strong>
          <p style="margin:6px 0 0;font-size:13px;color:#2f6b45">${
            appPending
              ? "Votre identité est vérifiée. Votre demande marchand est maintenant prête pour validation."
              : esc(state.message || "Votre vérification d'identité a été approuvée.")
          }</p>
        </div>${lockedSummary(ctx)}`;
    } else if (code === "rejected") {
      body = `<div class="error-state" style="margin-bottom:10px"><strong>Vérification refusée.</strong><br>${esc(state.message || "")}</div>
        ${actions.can_restart ? `<button class="btn btn-blue" type="button" data-kyc-restart>Recommencer ma vérification</button>` : ""}`;
    } else if (code === "cancelled") {
      body = `<p style="font-size:13px;color:var(--muted,#6f7891);margin:0 0 10px">${esc(state.message || "Ce dossier a été annulé.")}</p>
        ${actions.can_restart ? `<button class="btn btn-blue" type="button" data-kyc-restart>Reprendre ma vérification</button>` : ""}`;
    } else {
      body = `<p style="font-size:13px;color:var(--muted,#6f7891)">${esc(state.message || "")}</p>`;
    }

    host.innerHTML = `
      <h3 style="margin:0 0 4px">${esc(state.title || "Vérification de votre identité")}</h3>
      ${editable || code === "not_started" ? intro : ""}
      ${body}`;

    // --- wires ---
    host.querySelectorAll("[data-kyc-upload]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const type = btn.dataset.kycUpload;
        const input = host.querySelector(`[data-kyc-file="${type}"]`);
        const msg = host.querySelector(`[data-kyc-doc-msg="${type}"]`);
        const file = input && input.files && input.files[0];
        if (msg) msg.textContent = "";
        if (!file) { if (msg) { msg.textContent = "Choisissez un fichier."; } return; }
        btn.disabled = true;
        const t0 = btn.textContent;
        btn.textContent = "Envoi…";
        try {
          const fresh = await uploadKycDocument({ caseId: ctx.case.id, documentType: type, file });
          _lastFileName.set(type, file.name);
          showToast(DOC_META[type].okToast);
          rerender(fresh);
          await resyncAfterUpload();
        } catch (err) {
          console.warn("[VinHT] kyc upload:", err && (err.message || err), err && err.cause);
          if (msg) msg.textContent = kycErrorMessage(err, "Le téléchargement a échoué. Réessayez.");
          btn.disabled = false;
          btn.textContent = t0;
        }
      });
    });

    host.querySelector("[data-kyc-submit]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const msg = host.querySelector("[data-kyc-submit-msg]");
      b.disabled = true; b.textContent = "Envoi…";
      try {
        rerender(await submitMerchantKyc());
        showToast("Votre dossier KYC a été envoyé.");
      } catch (err) {
        console.warn("[VinHT] kyc submit:", err && (err.message || err));
        if (msg) msg.textContent = kycErrorMessage(err, "Envoi impossible. Vérifiez vos documents.");
        b.disabled = false; b.textContent = "Envoyer pour vérification";
      }
    });

    host.querySelector("[data-kyc-cancel]")?.addEventListener("click", async (e) => {
      if (!window.confirm("Annuler ce dossier de vérification ?")) return;
      const b = e.currentTarget; b.disabled = true;
      try { rerender(await cancelMerchantKyc()); showToast("Dossier annulé."); }
      catch (err) { showToast(kycErrorMessage(err, "Annulation impossible."), "red"); b.disabled = false; }
    });

    host.querySelectorAll("[data-kyc-restart]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "Ouverture…";
        try { rerender(await startMerchantKyc(applicationId)); }
        catch (err) { showToast(kycErrorMessage(err, "Impossible de recommencer."), "red"); b.disabled = false; }
      })
    );

    refreshIcons();
  }

  paint();
  if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  return ctx;
}
