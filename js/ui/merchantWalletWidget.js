// Widget "Solde FlexiCash professionnel" + cash-flow marchand (Feature #14).
//
// VinHT ne possède aucun solde : tout vient de vinht-merchant-flexicash-wallet
// (source_of_truth:"flexicash_professional_wallet" dans la réponse backend).
// Aucun montant n'est calculé ici. Aucun solde n'est écrit dans localStorage.
//
// Rafraîchissement quasi temps réel (~5 s tant que l'onglet est visible, pas
// de WebSocket) : voir initPolling() plus bas.

import { getMerchantFlexicashWallet, walletErrorMessageFr } from "../services/merchantWallet.js";
import { refreshIcons } from "../lib/icons.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const money = (v, currency = "HTG") =>
  `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)} ${currency}`;

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Aujourd'hui ${time}` : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} ${time}`;
}

function freshnessLabel(sinceMs) {
  if (sinceMs < 10000) return "Mis à jour à l'instant";
  if (sinceMs < 60000) return `Mis à jour il y a ${Math.round(sinceMs / 1000)} s`;
  const min = Math.round(sinceMs / 60000);
  return `Mis à jour il y a ${min} min`;
}

// Un mouvement provient directement du wallet FlexiCash — on ne fabrique
// jamais un provider/origine absent, et le sens (+/-) suit le signe réel du
// montant renvoyé, jamais une déduction du libellé.
function movementRowHtml(m) {
  const amountNum = Number(m?.amount ?? m?.amount_htg ?? 0);
  const isOut = amountNum < 0 || String(m?.direction || "").toLowerCase() === "out" || String(m?.type || "").toLowerCase().includes("debit");
  const sign = isOut ? "−" : "+";
  const displayAmount = money(Math.abs(amountNum), m?.currency || "HTG");
  const label = m?.label || m?.description || m?.type || "Mouvement";
  const provider = m?.provider || m?.origin || m?.channel || null;
  const subLabel = provider ? `${esc(label)} • ${esc(provider)}` : esc(label);
  const when = fmtDateTime(m?.occurred_at || m?.created_at || m?.date);
  const ref = typeof m?.reference === "string" && m.reference.length > 0 && m.reference.length <= 40 ? m.reference : null;
  return `<div class="settings-section" style="align-items:flex-start">
    <div>
      <strong style="color:${isOut ? "var(--red,#f31938)" : "var(--green,#25a844)"}">${sign} ${esc(displayAmount)}</strong>
      <p style="margin:2px 0 0">${subLabel}</p>
      <p class="table-secondary" style="margin:2px 0 0">${esc(when)}${ref ? ` · réf ${esc(ref)}` : ""}</p>
    </div>
  </div>`;
}

function blockedHtml(payload) {
  const reason = String(payload?.reason || "");
  const isDemo = reason === "demo_merchant_no_live_professional_balance";
  const title = isDemo ? "Environnement Demo" : "Compte professionnel FlexiCash requis";
  const note = isDemo
    ? "Cette boutique est en environnement Demo : le solde professionnel FlexiCash réel ne s'applique qu'en production."
    : payload?.message_fr ||
      "Pour recevoir vos ventes VinHT, activez votre profil professionnel FlexiCash.";
  return `
    <div class="section-head"><div><h2>Solde FlexiCash professionnel</h2></div>
      <span class="badge amber">${isDemo ? "Demo" : "Non disponible"}</span></div>
    <div class="error-state" style="margin-top:10px;background:#fff8ec;color:#8a5a00;border-color:#f2dfb0">
      <strong style="display:block;margin-bottom:4px">${esc(title)}</strong>
      ${esc(note)}
    </div>
    ${
      isDemo
        ? ""
        : `<div style="margin-top:12px"><a class="btn btn-blue btn-sm" href="../account.html">Connecter / activer FlexiCash</a></div>`
    }
    <p class="muted" style="font-size:11px;margin-top:10px">VinHT ne calcule et ne stocke aucun solde : ce bloc lit uniquement l'état renvoyé par FlexiCash.</p>`;
}

function errorHtml(message) {
  return `
    <div class="section-head"><div><h2>Solde FlexiCash professionnel</h2></div></div>
    <div class="error-state" style="margin-top:10px">${esc(message)}
      <button class="btn btn-outline-blue btn-sm" type="button" data-wallet-retry style="margin-left:8px">Réessayer</button>
    </div>`;
}

function readyHtml(payload, fetchedAt, compact) {
  const cur = payload.currency || "HTG";
  const parts = [];
  if (payload.available_balance != null) parts.push(["Disponible", money(payload.available_balance, cur)]);
  if (payload.reserved_balance != null) parts.push(["Réservé", money(payload.reserved_balance, cur)]);
  if (payload.savings_balance != null) parts.push(["Épargne", money(payload.savings_balance, cur)]);
  if (payload.total_balance != null) parts.push(["Total", money(payload.total_balance, cur)]);

  const movements = Array.isArray(payload.movements) ? payload.movements : [];
  const movementsHtml = compact
    ? ""
    : `<div style="margin-top:14px">
        <h3 style="font-size:13px;margin:0 0 6px">Mouvements récents</h3>
        ${
          movements.length
            ? movements.slice(0, 8).map(movementRowHtml).join("")
            : `<p class="muted" style="font-size:12px">Aucun mouvement récent.</p>`
        }
      </div>`;

  return `
    <div class="section-head"><div><h2>Solde FlexiCash professionnel</h2>
      <small data-wallet-freshness>${esc(freshnessLabel(Date.now() - fetchedAt))}</small></div>
      <span class="badge green">FlexiCash</span></div>
    <div style="margin-top:6px">
      <div style="font-size:26px;font-weight:900;letter-spacing:-.4px">${esc(money(payload.available_balance ?? payload.total_balance, cur))}</div>
      ${payload.shop_name ? `<div class="muted" style="font-size:12px">${esc(payload.shop_name)}${payload.flexicash_number ? ` · ${esc(payload.flexicash_number)}` : ""}</div>` : ""}
    </div>
    ${
      parts.length
        ? `<div class="stat-grid" style="margin-top:12px">${parts
            .map(
              ([label, value]) =>
                `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value" style="font-size:16px">${esc(value)}</div></div>`
            )
            .join("")}</div>`
        : ""
    }
    ${movementsHtml}
    <p class="muted" style="font-size:11px;margin-top:10px">Solde en lecture seule, fourni directement par FlexiCash. VinHT ne modifie ni ne déplace aucun fonds depuis cet écran.</p>`;
}

export function renderMerchantWalletWidget(host, { compact = false } = {}) {
  if (!host) return () => {};
  let destroyed = false;
  let inFlight = false;
  let timerId = null;
  let visibilityHandler = null;
  let tickerId = null;
  let lastPayload = null;
  let lastFetchedAt = 0;

  host.innerHTML = `<div class="section-head"><div><h2>Solde FlexiCash professionnel</h2><small>Chargement…</small></div></div>`;

  function paint() {
    if (destroyed || !lastPayload) return;
    if (lastPayload.available === false) {
      host.innerHTML = blockedHtml(lastPayload);
    } else {
      host.innerHTML = readyHtml(lastPayload, lastFetchedAt, compact);
    }
    host.querySelector("[data-wallet-retry]")?.addEventListener("click", () => load());
    refreshIcons();
  }

  async function load() {
    if (inFlight || destroyed) return;
    inFlight = true;
    try {
      const payload = await getMerchantFlexicashWallet();
      if (destroyed) return;
      lastPayload = payload;
      lastFetchedAt = Date.now();
      paint();
    } catch (err) {
      if (destroyed) return;
      console.warn("[VinHT] wallet FlexiCash:", err && (err.message || err));
      host.innerHTML = errorHtml(walletErrorMessageFr(err));
      host.querySelector("[data-wallet-retry]")?.addEventListener("click", () => load());
    } finally {
      inFlight = false;
    }
  }

  function refreshFreshnessLabel() {
    if (destroyed || !lastFetchedAt) return;
    const el = host.querySelector("[data-wallet-freshness]");
    if (el) el.textContent = freshnessLabel(Date.now() - lastFetchedAt);
  }

  function scheduleNext() {
    if (timerId) clearTimeout(timerId);
    const delay = Number(lastPayload?.refresh_after_ms) > 0 ? Number(lastPayload.refresh_after_ms) : 5000;
    timerId = setTimeout(async () => {
      if (document.visibilityState === "visible") await load();
      scheduleNext();
    }, delay);
  }

  function stopPolling() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
  }

  async function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      stopPolling();
    } else {
      await load();
      scheduleNext();
    }
  }

  function destroy() {
    destroyed = true;
    stopPolling();
    if (tickerId) clearInterval(tickerId);
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    window.removeEventListener("beforeunload", destroy);
  }

  visibilityHandler = onVisibilityChange;
  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("beforeunload", destroy);
  tickerId = setInterval(refreshFreshnessLabel, 1000);

  load().then(scheduleNext);

  return destroy;
}
