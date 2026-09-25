// Page résultat de paiement — payment.html?order_id=<uuid>
//
// Feature #10 : cette page n'est plus réservée à FlexiCash. Elle lit d'abord
// le moyen de paiement RÉEL de la commande (orders.payment_method) puis
// n'interroge que le vérificateur serveur correspondant (FlexiCash ou
// MonCash). Pour tout autre moyen, elle affiche le statut de la commande tel
// que renvoyé par le backend, sans inventer de vérification.
//
// Règles :
//  - session obligatoire ; on ne voit QUE sa propre commande (RLS + backend) ;
//  - le statut "payé" ne vient JAMAIS de l'URL (paramètres de retour ignorés
//    comme preuve) ;
//  - vérifications temporisées bornées (0s, +2s, +5s, +10s) puis bouton manuel.

import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { verifyFlexiCashPayment, createPlatformPayment } from "../services/payments.js";
import { verifyMoncashPayment, createMoncashPayment } from "../services/moncashPayments.js";
import { getOrderPaymentSummary } from "../services/orders.js";
import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { flexicashMarkHtml } from "../ui/flexicashMark.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_DELAYS = [0, 2000, 5000, 10000];

const PAYMENT_METHOD_FR = {
  flexicash: "FlexiCash",
  moncash: "MonCash",
  stripe: "Carte bancaire (Stripe)",
  flexicard: "FlexiCard",
  vinht_balance: "Solde VinHT",
  cash_on_delivery: "Paiement à la livraison",
  card: "Carte bancaire",
  other: "Autre moyen",
};
// Petit contexte (24px) : FlexiCash utilise son vrai logo compact
// (images/smallspacelogo.png via flexicashMarkHtml), jamais le grand
// wordmark réduit (illisible en dessous d'une carte de paiement).
// MonCash a déjà un logo carré conçu pour les petites tailles.
const PAYMENT_METHOD_LOGO = {
  moncash: "images/moncash.png",
  stripe: "images/stripes.png",
};
function methodLogoHtml(method) {
  if (method === "flexicash") return flexicashMarkHtml(24);
  const src = PAYMENT_METHOD_LOGO[method];
  return src ? `<img src="${src}" alt="${methodLabel(method)}">` : "";
}
function methodLabel(method) {
  return PAYMENT_METHOD_FR[method] || (method ? String(method) : "—");
}

// États réellement possibles côté backend. "closed" (MonCash) regroupe
// remboursée / annulée / stock relâché — jamais présenté comme un vrai "payé".
const STATE_FR = {
  checking: { title: "Vérification du paiement…", tone: "blue", note: "Nous confirmons votre paiement auprès du fournisseur." },
  paid: { title: "Paiement confirmé ✓", tone: "green", note: "Votre commande est confirmée." },
  pending: { title: "Paiement en attente", tone: "amber", note: "Le paiement n'est pas encore confirmé par le fournisseur." },
  no_attempt: { title: "Paiement pas encore lancé", tone: "amber", note: "Aucune tentative de paiement n'a encore été enregistrée pour cette commande." },
  failed: { title: "Paiement échoué", tone: "red", note: "Le paiement n'a pas abouti. Vous pouvez réessayer." },
  cancelled: { title: "Paiement annulé", tone: "red", note: "Le paiement a été annulé." },
  expired: { title: "Session de paiement expirée", tone: "amber", note: "La session de paiement a expiré. Créez une nouvelle tentative." },
  refunded: { title: "Paiement remboursé", tone: "blue", note: "Ce paiement a été remboursé." },
  closed: { title: "Commande fermée", tone: "amber", note: "Cette commande n'accepte plus de paiement (remboursée, annulée, ou stock relâché)." },
  error: { title: "Erreur de vérification", tone: "red", note: "Impossible de vérifier le paiement pour l'instant. Réessayez dans un instant." },
};

// --- Normalisation des réponses backend vers un vocabulaire d'états commun --
function mapFlexicashState(data) {
  const s = String(data?.state || "").toLowerCase();
  if (data?.payment_status === "paid" || s === "paid") return "paid";
  if (data?.payment_status === "refunded" || s === "refunded") return "refunded";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "cancelled";
  if (s === "expired") return "expired";
  if (["verify_error", "verify_mismatch", "verify_unavailable"].includes(s)) return "error";
  if (["pending", "no_attempt", "no_provider_payment"].includes(s)) return "pending";
  return "pending";
}
function mapMoncashState(data) {
  const s = String(data?.state || "").toLowerCase();
  if (data?.payment_status === "paid" || s === "paid") return "paid";
  if (s === "closed") return "closed";
  if (s === "no_attempt") return "no_attempt";
  if (["verify_error", "verify_mismatch", "verify_unavailable"].includes(s)) return "error";
  if (s === "pending") return "pending";
  return "pending";
}

function gate(show) {
  const g = $("[data-client-auth-gate]");
  const c = $("[data-client-content]");
  if (c) c.hidden = show;
  if (!g) return;
  g.hidden = !show;
  if (!show) return;
  g.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour voir le résultat de votre paiement.</p><button class="btn btn-blue" type="button" id="payLogin">Se connecter</button></div>`;
  $("#payLogin")?.addEventListener("click", () => openAuthModal("login"), { once: true });
  refreshIcons();
}

function render(host, stateKey, data, provider, { busy = false, note } = {}) {
  const base = STATE_FR[stateKey] || STATE_FR.pending;
  const st = note ? { ...base, note } : base;
  const orderId = data?.order_id ? String(data.order_id) : "";
  const currency = String(data?.currency || "HTG").toUpperCase();
  const rawAmount = data?.amount ?? data?.amount_htg;
  const amount = rawAmount != null ? money(rawAmount, currency) : "—";
  const payStatusFr = {
    pending: "Paiement en attente", paid: "Payé", failed: "Échoué",
    cancelled: "Annulé", refunded: "Remboursé", authorized: "Autorisé",
    partially_refunded: "Partiellement remboursé",
  }[String(data?.payment_status || "").toLowerCase()] || esc(data?.payment_status || "—");
  const providerLabel = methodLabel(provider);
  const logo = methodLogoHtml(provider);

  // "no_attempt" : aucune tentative encore -> action principale = démarrer,
  // pas "réessayer". Les états FlexiCash-only (failed/cancelled/expired)
  // n'existent que pour ce provider ; MonCash ne les retourne jamais.
  const canRetry =
    provider === "moncash"
      ? ["pending", "no_attempt", "error"].includes(stateKey)
      : provider === "flexicash" || provider === "stripe"
      ? ["failed", "cancelled", "expired", "pending", "error"].includes(stateKey)
      : false;
  const retryLabel =
    stateKey === "no_attempt"
      ? `Démarrer le paiement ${providerLabel}`
      : stateKey === "expired"
      ? "Créer une nouvelle tentative de paiement"
      : `Reprendre le paiement ${providerLabel}`;

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar">
        <div><h3>${esc(st.title)}</h3><div class="table-secondary">${esc(st.note)}</div></div>
        <span class="badge ${st.tone}">${esc(st.title.replace(" ✓", ""))}</span>
      </div>
      <div class="settings-section"><div><strong>N° commande</strong><p>${orderId ? "#" + esc(orderId.slice(0, 8)) : "—"}</p></div></div>
      <div class="settings-section"><div><strong>Montant</strong></div><strong>${amount}</strong></div>
      <div class="settings-section"><div><strong>Mode</strong></div><strong class="pay-method-mini">${logo}${esc(providerLabel)}</strong></div>
      <div class="settings-section"><div><strong>Statut paiement</strong></div><strong>${payStatusFr}</strong></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        ${stateKey === "paid" || stateKey === "refunded"
          ? `<a class="btn btn-blue" href="orders.html">Voir ma commande</a>`
          : `
            ${provider === "flexicash" || provider === "moncash" || provider === "stripe"
              ? `<button class="btn btn-outline-blue" type="button" id="payRecheck" ${busy ? "disabled" : ""}>Vérifier à nouveau</button>`
              : ""}
            ${canRetry ? `<button class="btn btn-blue" type="button" id="payRetry" ${busy ? "disabled" : ""}>${esc(retryLabel)}</button>` : ""}
            <a class="btn btn-ghost" href="orders.html">Mes commandes</a>
          `}
        <span id="payMsg" style="align-self:center;color:var(--muted,#6f7891);font-size:12px"></span>
      </div>
    </div>`;
  refreshIcons();
}

// Statut générique pour un moyen de paiement sans vérification automatisée
// côté frontend (ex. cash_on_delivery, card, vinht_balance, other) : on
// affiche l'état réel de la commande, sans simuler une vérification qui
// n'existe pas.
function renderGeneric(host, summary) {
  const payStatusFr = {
    pending: "Paiement en attente", paid: "Payé", failed: "Échoué",
    cancelled: "Annulé", refunded: "Remboursé", partially_refunded: "Partiellement remboursé",
  }[String(summary?.payment_status || "").toLowerCase()] || esc(summary?.payment_status || "—");
  const orderId = summary?.id ? String(summary.id) : "";
  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar">
        <div><h3>Statut de votre commande</h3><div class="table-secondary">Ce moyen de paiement ne propose pas encore de vérification automatique sur VinHT.</div></div>
        <span class="badge ${payStatusFr === "Payé" ? "green" : "amber"}">${payStatusFr}</span>
      </div>
      <div class="settings-section"><div><strong>N° commande</strong><p>${orderId ? "#" + esc(orderId.slice(0, 8)) : "—"}</p></div></div>
      <div class="settings-section"><div><strong>Montant</strong></div><strong>${(summary?.total_amount ?? summary?.total_htg) != null ? money(summary?.total_amount ?? summary?.total_htg, summary?.currency || "HTG") : "—"}</strong></div>
      <div class="settings-section"><div><strong>Mode</strong></div><strong>${esc(methodLabel(summary?.payment_method))}</strong></div>
      <div class="settings-section"><div><strong>Statut commande</strong></div><strong>${esc(summary?.status || "—")}</strong></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <a class="btn btn-blue" href="orders.html">Voir mes commandes</a>
      </div>
    </div>`;
  refreshIcons();
}

export function initPaymentResult() {
  const host = $("#paymentResultHost");
  if (!host) return; // pas payment.html

  const params = new URL(location.href).searchParams;
  const orderId = params.get("order_id") || "";
  // Les fournisseurs ajoutent des paramètres de retour (fc_result, etc.). On
  // les lit UNIQUEMENT pour un indice d'UX, jamais comme preuve de paiement :
  // la conclusion vient TOUJOURS de la vérification serveur->serveur.
  const fcResult = String(params.get("fc_result") || "").toLowerCase();
  let session = null;
  let provider = null;
  let lastData = { order_id: UUID_RE.test(orderId) ? orderId : "" };
  let polling = false;

  async function verifyOnce() {
    const data =
      provider === "moncash"
        ? await verifyMoncashPayment(orderId, session)
        : await verifyFlexiCashPayment(orderId, session);
    lastData = data;
    return data;
  }
  function mapState(data) {
    return provider === "moncash" ? mapMoncashState(data) : mapFlexicashState(data);
  }

  async function runPollSequence() {
    if (polling) return;
    polling = true;
    render(host, "checking", lastData, provider, {
      busy: true,
      note: fcResult === "cancelled"
        ? "Retour annulé — vérification du paiement auprès du fournisseur…"
        : fcResult === "error"
        ? "Retour en erreur — vérification du paiement auprès du fournisseur…"
        : undefined,
    });
    for (let i = 0; i < POLL_DELAYS.length; i++) {
      if (POLL_DELAYS[i]) await new Promise((r) => setTimeout(r, POLL_DELAYS[i]));
      let data;
      try { data = await verifyOnce(); }
      catch (e) {
        render(host, "error", lastData, provider);
        polling = false;
        wire();
        return;
      }
      const key = mapState(data);
      if (["paid", "refunded", "failed", "cancelled", "closed"].includes(key)) {
        render(host, key, data, provider);
        polling = false;
        wire();
        return;
      }
      render(host, key, data, provider, { busy: i < POLL_DELAYS.length - 1 });
    }
    // Fin de séquence sans confirmation -> état courant + bouton manuel.
    render(host, mapState(lastData), lastData, provider);
    polling = false;
    wire();
  }

  function wire() {
    $("#payRecheck")?.addEventListener("click", async () => {
      const msg = $("#payMsg");
      if (msg) msg.textContent = "Vérification…";
      try {
        const data = await verifyOnce();
        render(host, mapState(data), data, provider);
        wire();
      } catch {
        render(host, "error", lastData, provider);
        wire();
      }
    }, { once: true });

    $("#payRetry")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const msg = $("#payMsg");
      const providerLabel = methodLabel(provider);
      btn.disabled = true;
      if (msg) msg.textContent = `Ouverture de ${providerLabel}…`;
      try {
        const payment =
          provider === "moncash"
            ? await createMoncashPayment(orderId, session)
            : await createPlatformPayment(orderId, session);
        const url = String(payment?.checkout_url || payment?.hosted_checkout_url || "").trim();
        // Redirection vers l'interface officielle du fournisseur, telle
        // quelle. VinHT ne lit jamais mot de passe / PIN / code MonCash.
        window.location.assign(url);
      } catch (err) {
        if (msg) msg.textContent = err?.message || `Impossible de démarrer ${providerLabel}. Réessayez.`;
        btn.disabled = false;
      }
    }, { once: true });
  }

  async function boot() {
    session = await getSession();
    if (!session) { gate(true); return; }
    gate(false);

    if (!UUID_RE.test(orderId)) {
      host.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="package-open"></i></div><h3>Commande introuvable</h3><p>Lien de paiement invalide.</p><a class="btn btn-blue" href="orders.html">Mes commandes</a></div></div>`;
      refreshIcons();
      return;
    }

    let summary;
    try {
      summary = await getOrderPaymentSummary(orderId);
    } catch (e) {
      console.warn("[VinHT] résumé commande:", e && e.message);
      host.innerHTML = `<div class="portal-card error-state">Impossible de charger cette commande pour l'instant. Réessayez.</div>`;
      return;
    }
    if (!summary) {
      host.innerHTML = `<div class="portal-card"><div class="empty-state"><div class="empty-icon"><i data-lucide="package-open"></i></div><h3>Commande introuvable</h3><p>Cette commande n'existe pas ou ne vous appartient pas.</p><a class="btn btn-blue" href="orders.html">Mes commandes</a></div></div>`;
      refreshIcons();
      return;
    }

    provider = String(summary.payment_method || "");
    if (provider === "flexicash" || provider === "moncash" || provider === "stripe") {
      lastData = { order_id: summary.id, currency: summary.currency || "HTG", amount: summary.total_amount ?? summary.total_htg, amount_htg: summary.total_htg, payment_status: summary.payment_status };
      runPollSequence();
    } else {
      renderGeneric(host, summary);
    }
  }

  boot();
  onAuthChange(() => boot());
}
