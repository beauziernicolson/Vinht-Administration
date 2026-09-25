// Briques d'interface partagées par le VinHT Control Center (Admin).
//
// Règle : UI Admin -> RPC Admin sécurisée -> validation backend -> audit.
// Rien ici ne fait d'écriture directe ; ce module ne fournit que du rendu et
// des confirmations. Les motifs sont saisis dans une vraie modale (jamais
// window.prompt) et les actions dangereuses rappellent l'environnement.

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

export const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const isDemoEnv = (env) => String(env || "").toLowerCase() === "demo";

export function envPill(env) {
  const e = String(env || "").toLowerCase();
  if (e === "demo") return '<span class="badge amber cc-env cc-env-demo">DEMO</span>';
  if (e === "production") return '<span class="badge red cc-env cc-env-prod">PRODUCTION</span>';
  return '<span class="badge cc-env">ENV ?</span>';
}

export function chip(label, tone = "blue") {
  return `<span class="badge ${esc(tone)}">${esc(label)}</span>`;
}

export function onOff(v, on = "ON", off = "OFF") {
  return `<span class="badge ${v ? "green" : "amber"}">${v ? esc(on) : esc(off)}</span>`;
}

export const loadingBox = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;
export const errorBox = (t, retryAttr = "") =>
  `<div class="error-state"><span>${esc(t)}</span>${retryAttr ? ` <button class="btn btn-outline-blue btn-sm" type="button" ${retryAttr}>Réessayer</button>` : ""}</div>`;
export const emptyBox = (title, text = "") =>
  `<div class="empty-state"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}</div>`;
export const backendGap = (title, detail) =>
  `<div class="cc-gap"><span class="badge amber">BACKEND RPC REQUIRED</span> <strong>${esc(title)}</strong><p class="muted" style="margin:4px 0 0">${esc(detail)}</p></div>`;

// Bandeau permanent d'environnement. Le frontend ne choisit jamais
// l'environnement : c'est profiles.commerce_environment de l'admin, appliqué
// par le backend à toutes les RPC. On l'affiche simplement, très visiblement.
export function envBanner(env, { canSwitch = false } = {}) {
  const demo = isDemoEnv(env);
  return `<div class="cc-envbar ${demo ? "cc-envbar-demo" : "cc-envbar-prod"}" role="status">
    <div><strong>Environnement admin : ${demo ? "DEMO" : "PRODUCTION"}</strong>
    <span class="muted">${demo
      ? "Toutes les données et actions ci-dessous concernent Demo (argent fictif). Elles n'affectent pas Production."
      : "Toutes les données et actions ci-dessous concernent la Production (argent et clients réels)."}</span></div>
    ${canSwitch ? `<button class="btn btn-outline-blue btn-sm" type="button" data-cc-switch-env>Changer d'environnement</button>` : ""}
  </div>`;
}

// Dictionnaire d'erreurs backend -> français lisible. On affiche la vraie
// cause (jamais un « Action refusée » générique).
const ERR_FR = {
  admin_role_required: "Rôle administrateur requis.",
  admin_environment_mismatch: "Cette lecture concerne un autre environnement que celui de votre session admin actuelle.",
  logistics_runtime_not_found: "Réglages logistiques introuvables pour cet environnement.",
  authentication_required: "Reconnectez-vous pour continuer.",
  "not-admin": "Rôle administrateur requis.",
  "not-authenticated": "Reconnectez-vous pour continuer.",
  courier_profile_not_found: "Profil livreur introuvable dans cet environnement.",
  unsupported_courier_status: "Statut livreur non pris en charge.",
  courier_service_area_required_before_approval: "Approbation impossible : le livreur n'a aucune zone de service active.",
  courier_base_address_required_before_approval: "Approbation impossible : l'adresse de base du livreur est incomplète.",
  rejection_reason_required: "Un motif est obligatoire pour refuser une candidature.",
  merchant_application_not_found: "Candidature marchand introuvable dans l'environnement admin courant.",
  invalid_merchant_application_status: "Statut de candidature marchand non pris en charge.",
  invalid_order_report_status: "Statut de signalement non pris en charge.",
  kyc_case_not_found: "Dossier KYC introuvable dans l'environnement admin courant.",
  invalid_kyc_status: "Statut KYC non pris en charge.",
  agent_application_not_found: "Candidature Agent introuvable dans cet environnement.",
  agent_application_not_pending_review: "Cette candidature a déjà été traitée.",
  invalid_agent_application_status: "Statut de candidature non pris en charge.",
  courier_profile_not_pending_review: "Cette candidature n'est plus en attente d'examen.",
  courier_review_required_before_status_change: "Ce livreur doit d'abord être examiné (approuvé) avant tout changement de statut.",
  unsupported_operational_status: "Statut opérationnel non pris en charge.",
  suspension_reason_required: "Un motif est obligatoire pour suspendre.",
  unsupported_delivery_status: "Ce statut ne peut pas être filtré côté serveur.",
  delivery_task_not_found: "Mission introuvable dans cet environnement.",
  admin_dispatch_assignment_disabled: "L'affectation manuelle est désactivée : le mode d'assignation doit être « admin » ou « hybride » et la logistique/dispatch/opérations livreur activés.",
  delivery_task_not_assignable_in_current_status: "Cette mission ne peut plus être assignée dans son état actuel.",
  delivery_assignment_requires_paid_order_or_cod: "La commande doit être payée (ou paiement à la livraison) avant assignation.",
  courier_conflict_of_interest: "Ce livreur ne peut pas livrer une commande dont il est client ou marchand.",
  courier_role_required: "Ce compte n'a pas le rôle livreur.",
  delivery_mission_outside_courier_area: "La mission est hors de la zone de service de ce livreur.",
  courier_compensation_not_enabled: "La rémunération livreur n'est pas activée dans la configuration logistique.",
  invalid_courier_compensation: "Montant de rémunération invalide.",
  dispatch_not_enabled: "Le dispatch n'est pas activé (logistique, dispatch et opérations livreur requis).",
  change_reason_required: "Un motif d'au moins 5 caractères est obligatoire.",
  logistics_draft_missing: "Aucun brouillon logistique pour cet environnement.",
  activation_reason_required: "Un motif d'au moins 5 caractères est obligatoire pour activer.",
  logistics_preflight_failed: "Le contrôle (preflight) bloque l'activation : corrigez les points bloquants.",
  rollback_reason_required: "Un motif d'au moins 5 caractères est obligatoire pour revenir à une version.",
  logistics_version_not_found: "Version de configuration introuvable.",
  admin_override_note_required: "Une note est obligatoire pour forcer la livraison.",
  customer_delivery_override_not_applicable: "Le forçage de livraison ne s'applique qu'aux livraisons client.",
  delivery_not_confirmable_in_current_status: "La livraison ne peut pas être confirmée dans l'état actuel (arrivée ou incident requis).",
  hub_receipt_not_applicable: "La réception au hub ne s'applique qu'aux livraisons vers un point VinHT.",
  delivery_not_arrived_at_destination: "La mission n'est pas encore arrivée à destination.",
  resolution_note_required: "Une note de résolution est obligatoire.",
  delivery_task_not_in_issue: "Cette mission n'est pas en incident.",
  unsupported_compensation_status: "Statut de rémunération non pris en charge.",
  compensation_payment_reference_required: "Une référence de paiement est obligatoire pour marquer « payée ».",
  zone_code_and_name_required: "Le code et le nom de la zone sont obligatoires.",
  unsupported_zone_kind: "Type de zone non pris en charge.",
  unsupported_safety_state: "État de sécurité non pris en charge.",
  zone_coordinates_incomplete: "Latitude, longitude et rayon vont ensemble : renseignez les trois ou aucun.",
  shipping_rule_name_required: "Le nom de la règle est obligatoire.",
  invalid_delivery_method: "Méthode de livraison invalide.",
  invalid_pricing_type: "Type de tarification invalide.",
  negative_shipping_amount_not_allowed: "Les montants ne peuvent pas être négatifs.",
  max_fee_below_min_fee: "Le tarif maximum ne peut pas être inférieur au tarif minimum.",
  invalid_shipping_rule_priority: "La priorité doit être comprise entre 1 et 1000.",
  delivery_zone_not_found: "Zone introuvable.",
  draft_shipping_rule_not_found: "Règle brouillon introuvable.",
  unsupported_shipping_pricing_mode: "Mode de tarification de livraison non pris en charge.",
  invalid_assignment_mode: "Mode d'assignation invalide.",
  invalid_mission_accept_timeout: "Le délai d'acceptation doit être entre 1 et 240 minutes.",
  invalid_stalled_delivery_minutes: "Le délai de livraison bloquée doit être entre 5 et 1440 minutes.",
  settings_patch_must_be_object: "Modification invalide.",
  claim_not_found: "Litige introuvable dans cet environnement.",
  invalid_claim_resolution: "Résolution de litige invalide.",
  waiver_note_required: "Une note est obligatoire pour dispenser du retour.",
  claim_return_not_required: "Ce litige n'exige pas de retour.",
  claim_return_already_received: "Le retour a déjà été reçu.",
  trade_protection_payout_not_held: "Les fonds de cette commande ne sont pas retenus : résolution financière impossible.",
  trade_protection_configuration_missing: "La configuration Trade Protection est absente pour cet environnement.",
  financial_hold_required_before_claim_intake: "Impossible d'ouvrir la prise de litiges : la retenue financière n'est pas disponible (fail-closed).",
  unsupported_trade_protection_setting: "Un des réglages demandés n'est pas modifiable.",
  moderation_reason_required: "Un motif est obligatoire pour masquer ou retirer un avis.",
  review_not_found: "Avis introuvable.",
  review_note_required: "Une note est obligatoire pour refuser, suspendre ou révoquer.",
  certification_not_under_review: "Cette certification n'est plus en attente d'examen.",
  approved_certification_required: "Seule une certification approuvée peut être révoquée.",
  expired_certification_cannot_be_approved: "Une certification expirée ne peut pas être approuvée.",
  merchant_not_currently_eligible: "Le marchand n'est plus éligible à ce badge : approbation impossible.",
  verification_request_not_found: "Demande de badge introuvable.",
  invalid_validity_days: "La validité doit être comprise entre 1 et 1095 jours.",
  dispatch_source_location_required: "Le point de retrait de la mission n'est pas renseigné.",
  dispatch_source_location_not_geographic: "Le point de retrait n'a ni commune/département exploitables ni coordonnées.",
  dispatch_destination_location_required: "La destination de la mission n'est pas renseignée.",
  dispatch_destination_location_not_geographic: "La destination n'a ni commune/département exploitables ni coordonnées.",
  order_payment_not_confirmed_for_delivery: "Le paiement de la commande n'est pas confirmé.",
  order_not_dispatchable: "Cette commande n'est pas dispatchable.",
  merchant_order_not_dispatchable: "Cette sous-commande n'est pas dispatchable.",
  courier_capacity_reached: "Le livreur a atteint sa capacité maximale.",
  courier_not_operationally_active: "Le livreur n'est pas opérationnellement actif.",
  courier_not_available: "Le livreur n'est pas disponible.",
  courier_service_area_required: "Le livreur n'a pas de zone de service active.",
  invalid_agent_status: "Statut agent non pris en charge.",
  reason_required: "Un motif est obligatoire.",
  "reason-required": "Un motif d'au moins 5 caractères est obligatoire.",
  note_required: "Une note est obligatoire.",
  logistics_unavailable: "La logistique n'est pas activée dans cet environnement.",
  logistics_configuration_missing: "La configuration logistique est absente pour cet environnement.",
  unsupported_zone_status: "Statut de zone non pris en charge.",
  unsupported_settings_key: "Un des réglages demandés n'est pas modifiable.",
  production_financial_hold_not_verified: "Blocage de sécurité : la retenue financière (financial hold) n'est pas vérifiée.",
  confirmation_required: "La phrase de confirmation est incorrecte.",
  locked_after_activity: "Changement refusé par le backend : ce compte a déjà des produits, des commandes ou une activité dans son environnement actuel.",
  admin_required: "Rôle administrateur requis.",
  aal2_required: "Cette action exige une authentification renforcée (MFA), non disponible dans cette interface.",
};

export function adminErrorFr(err, fallback = "Action impossible.") {
  const raw = String((err && (err.message || err.details || err.hint || err.code)) || err || "").trim();
  if (!raw) return fallback;
  if (ERR_FR[raw]) return ERR_FR[raw];
  for (const k of Object.keys(ERR_FR)) if (raw.includes(k)) return ERR_FR[k];
  if (/^[a-z0-9_:-]+$/i.test(raw) && raw.length < 90) return `${fallback} (${raw})`;
  return fallback;
}

let _modalSeq = 0;
// Confirmation explicite. Retourne { reason } si validé, sinon null.
//  - requireReason : motif obligatoire (minReason caractères)
//  - phrase : texte exact à saisir (actions financières / Production)
//  - consequences : liste d'effets affichés avant validation
export function confirmAction({
  title,
  message = "",
  consequences = [],
  env = null,
  requireReason = false,
  minReason = 5,
  reasonLabel = "Motif",
  phrase = null,
  confirmLabel = "Confirmer",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const id = `ccm${++_modalSeq}`;
    const wrap = document.createElement("div");
    wrap.className = "cc-modal-backdrop";
    wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="${id}t">
      <h3 id="${id}t">${esc(title)}</h3>
      ${env ? `<div style="margin:0 0 8px">${envPill(env)}</div>` : ""}
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${consequences.length ? `<ul class="cc-consequences">${consequences.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${requireReason ? `<div class="field"><label for="${id}r">${esc(reasonLabel)} (obligatoire, ${minReason} caractères min.)</label><textarea id="${id}r" rows="3" maxlength="500"></textarea></div>` : ""}
      ${phrase ? `<div class="field"><label for="${id}p">Pour confirmer, saisissez exactement : <code>${esc(phrase)}</code></label><input id="${id}p" autocomplete="off" spellcheck="false"></div>` : ""}
      <div id="${id}e" class="cc-modal-err" hidden></div>
      <div class="toolbar-group" style="justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" type="button" data-cc-cancel>Annuler</button>
        <button class="btn ${danger ? "btn-outline-red" : "btn-blue"}" type="button" data-cc-ok disabled>${esc(confirmLabel)}</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const ok = wrap.querySelector("[data-cc-ok]");
    const reasonEl = wrap.querySelector(`#${id}r`);
    const phraseEl = wrap.querySelector(`#${id}p`);
    const errEl = wrap.querySelector(`#${id}e`);
    const valid = () => {
      if (requireReason && String(reasonEl?.value || "").trim().length < minReason) return false;
      if (phrase && String(phraseEl?.value || "") !== phrase) return false;
      return true;
    };
    const refresh = () => { ok.disabled = !valid(); };
    reasonEl?.addEventListener("input", refresh);
    phraseEl?.addEventListener("input", refresh);
    if (!requireReason && !phrase) ok.disabled = false;
    const done = (val) => { document.removeEventListener("keydown", onKey); wrap.remove(); resolve(val); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    wrap.querySelector("[data-cc-cancel]").addEventListener("click", () => done(null));
    ok.addEventListener("click", () => {
      if (!valid()) { errEl.hidden = false; errEl.textContent = "Complétez les champs obligatoires."; return; }
      done({ reason: String(reasonEl?.value || "").trim() });
    });
    (reasonEl || phraseEl || ok).focus();
  });
}

// Formulaire en modale. fields : [{ name, label, type: text|number|select|textarea|checkbox,
// required, options:[{value,label}], value, help, min, max, step, placeholder }].
// Retourne { values } (valeurs typées) ou null si annulé. validate(values) peut
// renvoyer un message d'erreur (chaîne) pour bloquer la validation.
export function formModal({ title, env = null, fields = [], confirmLabel = "Enregistrer", danger = false, intro = "", validate = null } = {}) {
  return new Promise((resolve) => {
    const id = `ccf${++_modalSeq}`;
    const wrap = document.createElement("div");
    wrap.className = "cc-modal-backdrop";
    const fieldHtml = (f, i) => {
      const fid = `${id}_${i}`;
      const req = f.required ? " *" : "";
      if (f.type === "checkbox") return `<div class="field"><label class="cc-check"><input type="checkbox" id="${fid}" ${f.value ? "checked" : ""}> ${esc(f.label)}</label>${f.help ? `<small class="muted">${esc(f.help)}</small>` : ""}</div>`;
      if (f.type === "select") return `<div class="field"><label for="${fid}">${esc(f.label)}${req}</label><select id="${fid}" class="input">${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${f.help ? `<small class="muted">${esc(f.help)}</small>` : ""}</div>`;
      if (f.type === "textarea") return `<div class="field"><label for="${fid}">${esc(f.label)}${req}</label><textarea id="${fid}" rows="3" maxlength="${f.max || 600}" placeholder="${esc(f.placeholder || "")}">${esc(f.value ?? "")}</textarea>${f.help ? `<small class="muted">${esc(f.help)}</small>` : ""}</div>`;
      const t = f.type === "number" ? "number" : "text";
      return `<div class="field"><label for="${fid}">${esc(f.label)}${req}</label><input id="${fid}" class="input" type="${t}" ${f.min != null ? `min="${esc(f.min)}"` : ""} ${f.max != null ? `max="${esc(f.max)}"` : ""} ${f.step != null ? `step="${esc(f.step)}"` : ""} value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}" ${t === "text" ? 'maxlength="240"' : ""}>${f.help ? `<small class="muted">${esc(f.help)}</small>` : ""}</div>`;
    };
    wrap.innerHTML = `<div class="cc-modal" role="dialog" aria-modal="true" aria-labelledby="${id}t">
      <h3 id="${id}t">${esc(title)}</h3>
      ${env ? `<div style="margin:0 0 8px">${envPill(env)}</div>` : ""}
      ${intro ? `<p class="muted">${esc(intro)}</p>` : ""}
      ${fields.map(fieldHtml).join("")}
      <div class="cc-modal-err" data-err hidden></div>
      <div class="toolbar-group" style="justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" type="button" data-cc-cancel>Annuler</button>
        <button class="btn ${danger ? "btn-outline-red" : "btn-blue"}" type="button" data-cc-ok>${esc(confirmLabel)}</button></div></div>`;
    document.body.appendChild(wrap);
    const done = (v) => { document.removeEventListener("keydown", onKey); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    wrap.querySelector("[data-cc-cancel]").addEventListener("click", () => done(null));
    const errEl = wrap.querySelector("[data-err]");
    const showErr = (m) => { errEl.hidden = false; errEl.textContent = m; };
    wrap.querySelector("[data-cc-ok]").addEventListener("click", () => {
      const values = {};
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const el = wrap.querySelector(`#${id}_${i}`);
        let v;
        if (f.type === "checkbox") v = !!el.checked;
        else if (f.type === "number") v = el.value === "" ? null : Number(el.value);
        else v = String(el.value || "").trim();
        if (f.required && (v === "" || v === null || (f.type === "number" && !Number.isFinite(v)))) { showErr(`Champ obligatoire : ${f.label}`); el.focus(); return; }
        if (f.type === "number" && v !== null && !Number.isFinite(v)) { showErr(`Nombre invalide : ${f.label}`); el.focus(); return; }
        values[f.name] = v === "" ? null : v;
      }
      const msg = validate ? validate(values) : null;
      if (msg) { showErr(msg); return; }
      done({ values });
    });
    wrap.querySelector("input,select,textarea")?.focus();
  });
}

// Onglets à base de hash (#livreurs). Retourne { show(name) }.
export function mountTabs(root, tabs, { initial, onShow } = {}) {
  const nav = root.querySelector("[data-cc-tabs]");
  const body = root.querySelector("[data-cc-body]");
  const byId = new Map(tabs.map((t) => [t.id, t]));
  nav.innerHTML = tabs.map((t) => `<button type="button" class="cc-tab" role="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join("");
  let current = null;
  const show = async (id, { pushHash = true } = {}) => {
    const t = byId.get(id) || tabs[0];
    current = t.id;
    nav.querySelectorAll(".cc-tab").forEach((b) => {
      const on = b.dataset.tab === t.id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (pushHash) { try { history.replaceState(null, "", `#${t.id}`); } catch { /* ignore */ } }
    body.innerHTML = loadingBox();
    try { await onShow(t, body); }
    catch (e) { console.warn("[VinHT] control-center tab:", t.id, e && (e.message || e)); body.innerHTML = errorBox("Cet onglet n'a pas pu se charger.", "data-cc-retry-tab"); body.querySelector("[data-cc-retry-tab]")?.addEventListener("click", () => show(t.id)); }
  };
  nav.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
  window.addEventListener("hashchange", () => { const h = location.hash.replace(/^#/, ""); if (byId.has(h) && h !== current) show(h, { pushHash: false }); });
  const h = location.hash.replace(/^#/, "");
  show(byId.has(h) ? h : initial || tabs[0].id, { pushHash: false });
  return { show };
}
