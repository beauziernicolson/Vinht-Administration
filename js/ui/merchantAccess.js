// Rendu des états d'accès à l'espace marchand, partagé par merchant/index.html
// (portail simplifié) et merchant-center.html (centre complet).
//
// La décision d'ouvrir ou non l'espace vient du backend via
// `getMyAccessContext().merchant_access` — on ne recalcule rien ici, on habille.

import { merchantStateMessage } from "../services/access.js";

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// Bandeau non bloquant affiché AU-DESSUS du contenu quand l'espace reste
// accessible mais dégradé (paused / suspended). Retourne "" sinon.
export function merchantBannerHtml(access) {
  const state = access?.state;
  if (state !== "paused" && state !== "suspended") return "";
  const tone = state === "suspended" ? "#b0122a" : "#8a5a00";
  const bg = state === "suspended" ? "#fff0f3" : "#fff8e6";
  const border = state === "suspended" ? "#f7c9d2" : "#f2dca6";
  const title = state === "suspended" ? "Boutique suspendue" : "Boutique en pause";
  return `<div class="surface" style="padding:14px 16px;margin-bottom:14px;background:${bg};border:1px solid ${border};color:${tone}">
    <strong style="display:block;margin-bottom:2px">${esc(title)}</strong>
    <span style="font-size:13px">${esc(merchantStateMessage(access))}</span>
  </div>`;
}

// HTML pour un état BLOQUANT (l'espace n'est pas ouvert). `rootPrefix` = "" ou
// "../" selon la profondeur de la page. Retourne "" si l'état n'est pas bloquant.
export function merchantBlockedHtml(access, { rootPrefix = "", application = null } = {}) {
  const state = access?.state;
  const msg = merchantStateMessage(access);
  const app = application || access?.latest_merchant_application || null;
  const reason = app && String(app.rejection_reason || "").trim();
  const applyHref = `${rootPrefix}merchant.html`;
  const wrap = (icon, title, body, actions = "") => `
    <div class="empty-state">
      <div class="empty-icon"><i data-lucide="${icon}"></i></div>
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
      ${actions}
    </div>`;

  switch (state) {
    case "application_pending":
      return wrap("hourglass", "Demande marchand en cours d'examen", msg,
        `<a class="btn btn-ghost btn-sm" href="${applyHref}">Voir ma demande</a>`);
    case "application_rejected":
      return wrap(
        "file-x2",
        "Demande marchand refusée",
        reason ? `${msg}` : msg,
        (reason ? `<p style="font-size:12px;color:var(--muted,#6f7891);margin:2px 0 10px"><strong>Motif :</strong> ${esc(reason)}</p>` : "") +
          (access?.can_apply
            ? `<a class="btn btn-blue" href="${applyHref}">Soumettre une nouvelle demande</a>`
            : `<a class="btn btn-ghost btn-sm" href="${applyHref}">Voir le dossier</a>`)
      );
    case "provisioning_required":
    case "pending":
      return wrap("loader", "Espace marchand en cours d'activation", msg);
    case "closed":
      return wrap("store", "Boutique fermée", msg,
        `<a class="btn btn-ghost btn-sm" href="${rootPrefix}support.html">Contacter le support</a>`);
    case "unknown":
      return wrap("triangle-alert", "Information marchand indisponible", msg,
        `<button class="btn btn-outline-blue btn-sm" type="button" data-merchant-access-retry>Réessayer</button>`);
    case "not_merchant":
    default:
      return wrap("store", "Pas encore marchand", msg,
        `<a class="btn btn-blue" href="${applyHref}">Devenir marchand</a>`);
  }
}
