// Panneau "Abonnement" du Merchant Center — plan Professionnel (Feature #4).
//
// Ce panneau remplace l'ancien affichage lecture seule : il consomme désormais
// le backend réel via `get_my_professional_subscription_context_v1()` et les
// actions `start_my_professional_subscription_v1` / `cancel_my_professional_subscription_v1`
// / Edge Function `vinht-professional-subscription-payment`.
//
// Tout l'affichage suit `context.state` + `context.capabilities` (jamais déduit
// de `merchants.plan_code`). VinHT ne demande jamais mot de passe / PIN / MFA
// FlexiCash : on redirige simplement vers le `hosted_checkout_url`. Le routage
// des 5 000 HTG vers la trésorerie GES est backend-only et n'apparaît pas ici.

import {
  getProfessionalSubscriptionContext,
  startProfessionalSubscription,
  cancelProfessionalSubscription,
  professionalSubscriptionPayment,
  subscriptionErrorMessageFr,
} from "../services/professionalSubscription.js?v=20260920-pro-retry-v1";
import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "./toast.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

function fmtDate(v) {
  if (!v) return "—";
  const raw=String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw+"T12:00:00") : new Date(raw);
  return Number.isNaN(d.getTime())
    ? raw
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

// Libellé + ton de badge par état backend (aucun état inventé).
const STATE_BADGE = {
  logged_out: ["Connexion requise", ""],
  merchant_required: ["Espace marchand requis", ""],
  not_subscribed: ["Non abonné", ""],
  launch_offer_available: ["Pro gratuit disponible", "green"],
  active_launch_offer: ["Pro gratuit — lancement", "green"],
  payment_required: ["Paiement en attente", "amber"],
  active: ["Actif", "green"],
  active_cancelling: ["Annulation programmée", "amber"],
  past_due: ["Facture en retard", "red"],
  suspended: ["Suspendu", "red"],
  cancelled: ["Annulé", ""],
  unknown: ["État indisponible", ""],
};

const INVOICE_STATUS_FR = {
  due: "À payer",
  past_due: "En retard",
  paid: "Payée",
  void: "Annulée",
  waived: "Offerte",
  pending: "En attente",
};

function badgeHtml(state) {
  const [label, tone] = STATE_BADGE[state] || [state || "Abonnement", ""];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

function headerSmall(c){
  const monthly=money(c?.pricing?.monthly_fee_htg??0);
  const commission=Number(c?.pricing?.commission_rate??0);
  return `Plan Professionnel — tarif normal ${monthly} / mois · + ${commission} % par vente · frais mensuel offert pendant la campagne de lancement.`;
}

export async function renderProfessionalSubscriptionPanel(host, { onChange = null } = {}) {
  if (!host) return null;
  host.style.display = "";
  host.innerHTML = `<div class="section-head"><div><h2>Abonnement</h2><small>Chargement de votre abonnement…</small></div></div>`;

  let ctx;
  try {
    ctx = await getProfessionalSubscriptionContext();
  } catch (err) {
    console.warn("[VinHT] abonnement context:", err && (err.message || err));
    host.innerHTML = `<div class="section-head"><div><h2>Abonnement</h2>
      <small>Informations d'abonnement momentanément indisponibles.</small></div></div>
      <div style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" data-sub-retry>Réessayer</button></div>`;
    host.querySelector("[data-sub-retry]")?.addEventListener("click", () => renderProfessionalSubscriptionPanel(host, { onChange }));
    refreshIcons();
    return null;
  }

  paint(ctx);

  function rerender(fresh) {
    if (fresh) ctx = fresh;
    paint(ctx);
    if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  }

  async function reload() {
    try {
      const fresh = await getProfessionalSubscriptionContext();
      rerender(fresh);
    } catch (err) {
      console.warn("[VinHT] abonnement reload:", err && (err.message || err));
    }
  }

  function paint(c) {
    const caps = c.capabilities || {};
    const sub = c.subscription || null;
    const inv = c.latest_invoice || null;
    const state = c.state;
    const monthly = money(c.pricing?.monthly_fee_htg ?? 0);
    const effectiveMonthly = money(c.pricing?.effective_monthly_fee_htg ?? c.pricing?.monthly_fee_htg ?? 0);
    const commission = Number(c.pricing?.commission_rate ?? 0);
    const launch = c.launch_offer || null;
    const launchFree = launch?.fixed_fees_waived === true;
    const isProductionLocked =
      c.merchant?.environment === "production" && caps.production_payments_enabled !== true;

    // --- Plan Individuel / non abonné -------------------------------------
    if (state === "not_subscribed" || state === "launch_offer_available" || state === "merchant_required" || state === "logged_out") {
      const canStart = caps.can_start === true;
      const intro =
        state === "launch_offer_available"
          ? `Offre de lancement : activez le plan Professionnel maintenant pour 0 HTG/mois jusqu’au ${esc(fmtDate(launch?.last_free_day))}. Le tarif normal de ${esc(monthly)}/mois commencera ensuite si vous conservez Pro.`
          : state === "not_subscribed"
            ? `Vous êtes actuellement sur le plan Individuel. Le plan Professionnel revient normalement à ${esc(monthly)} / mois + ${esc(commission)} % par vente.`
            : esc(c.message_fr || "Le plan Professionnel n'est pas actif sur votre boutique.");
      host.innerHTML = `
        <div class="section-head"><div><h2>Abonnement ${badgeHtml(state)}</h2>
          <small>${esc(headerSmall(c))}</small></div></div>
        <p style="margin:8px 0 0;font-size:13px;color:var(--muted,#6f7891)">${intro}</p>
        <div id="mcSubMsg" style="display:none;font-size:12px;margin-top:8px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          ${canStart ? `<button class="btn btn-blue" type="button" data-sub-start>Passer au plan Professionnel</button>` : ""}
          <button class="btn btn-ghost btn-sm" type="button" data-sub-refresh>Actualiser</button>
        </div>
        ${
          !canStart && state === "not_subscribed"
            ? `<p class="muted" style="font-size:11px;margin-top:10px">Votre espace marchand doit être actif pour souscrire au plan Professionnel.</p>`
            : ""
        }`;
      wire(c);
      refreshIcons();
      return;
    }

    // --- Abonnement existant --------------------------------------------
    const rows = [];
    rows.push(`<div><strong>Plan</strong><div>Professionnel</div></div>`);
    rows.push(`<div><strong>Montant mensuel actuel</strong><div>${esc(effectiveMonthly)}</div></div>`);
    if (launchFree) rows.push(`<div><strong>Tarif normal après l’offre</strong><div>${esc(monthly)}</div></div>`);
    rows.push(`<div><strong>Statut</strong><div>${esc((STATE_BADGE[state] || [state])[0])}</div></div>`);
    if (sub?.current_period_start) rows.push(`<div><strong>Début de période</strong><div>${esc(fmtDate(sub.current_period_start))}</div></div>`);
    if (sub?.current_period_end) rows.push(`<div><strong>Fin de période</strong><div>${esc(fmtDate(sub.current_period_end))}</div></div>`);
    rows.push(`<div><strong>Prochaine facture</strong><div>${esc(sub?.next_invoice_at ? fmtDate(sub.next_invoice_at) : "—")}</div></div>`);
    if (sub?.last_paid_at) rows.push(`<div><strong>Dernier paiement</strong><div>${esc(fmtDate(sub.last_paid_at))}</div></div>`);
    rows.push(
      `<div><strong>Annulation en fin de période</strong><div>${
        sub?.cancel_at_period_end
          ? `Oui — actif jusqu'au ${esc(fmtDate(sub?.current_period_end))}`
          : "Non"
      }</div></div>`
    );

    // Facture courante.
    let invoiceHtml = "";
    if (inv) {
      const paidLine = inv.paid_at
        ? ` · payée le ${esc(fmtDate(inv.paid_at))}`
        : inv.due_at
        ? ` · échéance ${esc(fmtDate(inv.due_at))}`
        : "";
      const refLine = inv.payment_reference ? ` · réf. ${esc(inv.payment_reference)}` : "";
      invoiceHtml = `
        <div class="settings-section" style="margin-top:12px">
          <div>
            <strong>Facture courante — ${esc(fmtDate(inv.billing_period_start))} → ${esc(fmtDate(inv.billing_period_end))}</strong>
            <p>${esc(INVOICE_STATUS_FR[inv.status] || inv.status || "—")}${paidLine}${refLine}</p>
          </div>
          <strong>${esc(money(inv.amount_htg))}</strong>
        </div>`;
    }

    // Messages d'état lisibles.
    let hint = "";
    if (state === "active_launch_offer") {
      hint = `<p class="muted" style="font-size:12px;margin-top:8px">Avantage de lancement actif : aucun abonnement mensuel n’est dû avant le ${esc(fmtDate(launch?.end_date))}. Si vous conservez Pro, la facturation normale commencera à cette date.</p>`;
    } else if (state === "past_due" || state === "suspended") {
      hint = `<p class="muted" style="font-size:12px;margin-top:8px">Réglez la facture en retard pour réactiver votre plan Professionnel.</p>`;
    } else if (state === "active_cancelling") {
      hint = `<p class="muted" style="font-size:12px;margin-top:8px">Votre plan Professionnel restera actif jusqu'à la fin de la période en cours, puis basculera en Individuel.</p>`;
    } else if (state === "cancelled") {
      hint = `<p class="muted" style="font-size:12px;margin-top:8px">Vous êtes revenu au plan Individuel. Vous pouvez réactiver le plan Professionnel à tout moment.</p>`;
    }

    // Boutons pilotés STRICTEMENT par les capabilities.
    const btns = [];
    if (caps.can_pay && inv?.id) {
      btns.push(
        `<button class="btn btn-blue" type="button" data-sub-pay ${isProductionLocked ? "disabled" : ""}>Payer ${esc(money(inv.amount_htg))} avec FlexiCash</button>`
      );
    }
    if (caps.can_start) {
      btns.push(`<button class="btn btn-blue" type="button" data-sub-start>Passer au plan Professionnel</button>`);
    }
    if (caps.can_cancel) {
      const label = sub?.status === "active" && !sub?.cancel_at_period_end ? "Programmer l'annulation" : "Annuler l'abonnement";
      btns.push(`<button class="btn btn-ghost btn-sm" type="button" data-sub-cancel>${esc(label)}</button>`);
    }
    btns.push(`<button class="btn btn-ghost btn-sm" type="button" data-sub-refresh>Actualiser</button>`);

    const security = caps.can_pay
      ? `<p style="font-size:11px;color:var(--muted,#6f7891);margin:10px 0 0">Vous serez redirigé vers FlexiCash pour régler la facture. VinHT ne voit jamais votre mot de passe, votre PIN ni votre code de sécurité FlexiCash.</p>`
      : "";

    const prodNote =
      isProductionLocked && caps.can_pay
        ? `<p class="muted" style="font-size:12px;margin-top:8px">Le paiement de l'abonnement n'est pas encore disponible dans cet environnement.</p>`
        : "";

    host.innerHTML = `
      <div class="section-head"><div><h2>Abonnement ${badgeHtml(state)}</h2>
        <small>${esc(headerSmall(c))}</small></div></div>
      <p style="margin:8px 0 0;font-size:13px">${esc(c.message_fr || "")}</p>
      ${hint}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px 24px;font-size:13px;margin-top:12px">${rows.join("")}</div>
      ${invoiceHtml}
      ${prodNote}
      <div id="mcSubMsg" style="display:none;font-size:12px;margin-top:8px"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">${btns.join("")}</div>
      ${security}
      <p class="muted" style="font-size:11px;margin-top:10px">${launchFree?`Pendant l’offre de lancement, le frais mensuel Pro est de ${esc(effectiveMonthly)}. À la fin de l’offre, le tarif normal de ${esc(monthly)}/mois reprend si vous conservez Pro.`:`Le tarif Pro de ${esc(monthly)} / mois est facturé séparément et n’est jamais déduit d'un versement de vente.`}</p>`;
    wire(c);
    refreshIcons();
  }

  function setMsg(text, ok) {
    const m = host.querySelector("#mcSubMsg");
    if (!m) return;
    m.textContent = text || "";
    m.style.color = ok ? "var(--green,#25a844)" : "var(--red,#f31938)";
    m.style.display = text ? "" : "none";
  }

  function wire(c) {
    host.querySelector("[data-sub-refresh]")?.addEventListener("click", (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = "Actualisation…";
      reload();
    });

    host.querySelector("[data-sub-start]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const t0 = b.textContent;
      b.disabled = true;
      b.textContent = "Activation…";
      setMsg("");
      try {
        const res=await startProfessionalSubscription();
        if(res.state==="active_launch_offer"){
          showToast(`Plan Professionnel activé gratuitement jusqu’au ${fmtDate(res.free_until)} ✓`);
        }else{
          showToast("Plan Professionnel initié. Réglez la facture pour l'activer.");
        }
        await reload();
      } catch (err) {
        console.warn("[VinHT] abonnement start:", err && (err.code || err.message));
        setMsg(subscriptionErrorMessageFr(err));
        b.disabled = false;
        b.textContent = t0;
      }
    });

    host.querySelector("[data-sub-pay]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const t0 = b.textContent;
      const invoiceId = c.latest_invoice?.id;
      if (!invoiceId) return;
      b.disabled = true;
      b.textContent = "Connexion à FlexiCash…";
      setMsg("");
      try {
        const res = await professionalSubscriptionPayment("start", invoiceId);
        if (res.hosted_checkout_url) {
          // Redirection vers le checkout hébergé FlexiCash, tel quel.
          window.location.assign(res.hosted_checkout_url);
          return;
        }
        if (res.state === "paid" || res.already_paid) {
          showToast("Cette facture d'abonnement est déjà payée.");
        }
        await reload();
      } catch (err) {
        console.warn("[VinHT] abonnement pay:", err && (err.code || err.message));
        setMsg(subscriptionErrorMessageFr(err));
        b.disabled = false;
        b.textContent = t0;
      }
    });

    host.querySelector("[data-sub-cancel]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const t0 = b.textContent;
      const activeNow = c.subscription?.status === "active" && !c.subscription?.cancel_at_period_end;
      const confirmMsg = activeNow
        ? "Programmer l'annulation ? Votre plan Professionnel restera actif jusqu'à la fin de la période en cours, puis reviendra au plan Individuel."
        : "Annuler l'abonnement Professionnel ? Votre boutique repassera au plan Individuel.";
      if (!window.confirm(confirmMsg)) return;
      b.disabled = true;
      b.textContent = "Traitement…";
      setMsg("");
      try {
        const res = await cancelProfessionalSubscription();
        if (res.cancel_at_period_end) {
          showToast(`Annulation programmée pour le ${fmtDate(res.period_end)}.`);
        } else {
          showToast("Abonnement Professionnel annulé.");
        }
        await reload();
      } catch (err) {
        console.warn("[VinHT] abonnement cancel:", err && (err.code || err.message));
        setMsg(subscriptionErrorMessageFr(err));
        b.disabled = false;
        b.textContent = t0;
      }
    });
  }

  if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  return ctx;
}

// Retour depuis le checkout FlexiCash : ?subscription_payment=return&invoice_id=<uuid>
// On ne considère JAMAIS le simple retour comme un paiement réussi : on demande
// au backend de vérifier via `refresh`, puis on recharge le contexte réel.
export async function handleSubscriptionPaymentReturn(host, { onChange = null } = {}) {
  if (!host) return;
  host.style.display = "";
  host.innerHTML = `<div class="section-head"><div><h2>Abonnement</h2><small>Vérification de votre paiement d'abonnement…</small></div></div>
    <div class="loading-state">Vérification de votre paiement d'abonnement…</div>`;

  let invoiceId = "";
  try {
    invoiceId = new URLSearchParams(window.location.search).get("invoice_id") || "";
  } catch { /* ignore */ }

  // 1) demander au backend de vérifier réellement le paiement (non bloquant)
  if (invoiceId) {
    try {
      const res = await professionalSubscriptionPayment("refresh", invoiceId);
      if (res.state === "paid") showToast("Paiement d'abonnement confirmé ✓");
      else if (res.state === "pending") showToast("Paiement en cours de confirmation par FlexiCash.");
    } catch (err) {
      console.warn("[VinHT] abonnement return refresh:", err && (err.code || err.message));
    }
  }

  // 2) nettoyer les paramètres d'URL sans recharger
  try {
    const url = new URL(window.location.href);
    let touched = false;
    ["subscription_payment", "invoice_id"].forEach((k) => {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; }
    });
    if (touched) {
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
    }
  } catch { /* ignore */ }

  // 3) ré-afficher l'état réel via le RPC
  await renderProfessionalSubscriptionPanel(host, { onChange });
}
