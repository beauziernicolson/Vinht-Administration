// Carte "FlexiCash" du Merchant Center — connexion du compte FlexiCash marchand.
//
// Tout l'affichage suit `context.state` (code/title/message fournis par le
// backend) et `context.capabilities`. On ne déduit pas les permissions du seul
// nom de l'état. VinHT ne demande jamais mot de passe / PIN / MFA FlexiCash :
// on redirige simplement vers le `connect_url` construit par l'Edge Function.

import {
  getMyFlexicashConnectionContext,
  flexicashMerchantConnect,
  flexicashConnectErrorMessage,
} from "../services/flexicashConnect.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "./toast.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) +
    " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Badge d'état lisible pour un marchand non technique.
function stateBadge(ctx) {
  const code = ctx.state.code;
  const ready = ctx.capabilities.payout_ready;
  const map = {
    not_connected: ["Non connecté", ""],
    invitation_pending: ["Connexion en attente", "amber"],
    invitation_expired: ["Invitation expirée", "red"],
    connected: [ready ? "Prêt à recevoir les paiements" : "Vérification en cours", ready ? "green" : "amber"],
    connected_not_payout_ready: ["Configuration incomplète", "amber"],
    connected_eligibility_unknown: ["Vérification en cours", "amber"],
    restricted: ["Restreint", "red"],
    disconnected: ["Déconnecté", "red"],
    setup_required: ["À finaliser", "amber"],
    merchant_not_active: ["Espace non actif", ""],
    merchant_required: ["Compte marchand requis", ""],
    logged_out: ["Connexion requise", ""],
    unknown: ["État indisponible", ""],
  };
  const [label, tone] = map[code] || [ctx.state.title || "FlexiCash", ""];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

export async function renderFlexicashConnectCard(host, { onChange = null } = {}) {
  if (!host) return null;
  host.style.display = "";
  host.innerHTML = `<div class="section-head"><div><h2>FlexiCash</h2><small>Chargement de l'état de votre connexion…</small></div></div>`;

  let ctx;
  try {
    ctx = await getMyFlexicashConnectionContext();
  } catch (err) {
    console.warn("[VinHT] flexicash context:", err && (err.message || err));
    host.innerHTML = `<div class="section-head"><div><h2>FlexiCash</h2></div></div>
      <div class="error-state">${esc(flexicashConnectErrorMessage(err, "Impossible de charger l'état de votre connexion FlexiCash."))}
      <button class="btn btn-outline-blue btn-sm" type="button" data-fc-retry style="margin-left:8px">Réessayer</button></div>`;
    host.querySelector("[data-fc-retry]")?.addEventListener("click", () => renderFlexicashConnectCard(host, { onChange }));
    refreshIcons();
    return null;
  }

  paint(ctx);

  function rerender(fresh) {
    if (fresh) ctx = fresh;
    paint(ctx);
    if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  }

  function paint(c) {
    const caps = c.capabilities;
    const conn = c.connection || {};
    const code = c.state.code;
    const ready = caps.payout_ready;

    // Détails "connecté".
    let details = "";
    if (["connected", "connected_not_payout_ready", "connected_eligibility_unknown", "restricted"].includes(code) && (conn.connected_flexicash_number_masked || conn.last_synced_at)) {
      const parts = [];
      if (conn.connected_flexicash_number_masked) parts.push(`<div><strong>Compte FlexiCash</strong><div style="font-family:ui-monospace,Menlo,monospace">${esc(conn.connected_flexicash_number_masked)}</div></div>`);
      if (conn.last_synced_at) parts.push(`<div><strong>Dernière synchronisation</strong><div>${esc(fmtDateTime(conn.last_synced_at))}</div></div>`);
      parts.push(`<div><strong>Paiements VinHT</strong><div>${ready ? "Prêt à recevoir les paiements" : "Pas encore prêts"}</div></div>`);
      details = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 24px;font-size:13px;margin-top:10px">${parts.join("")}</div>`;
    }

    // Expiration d'invitation.
    let expiry = "";
    if ((code === "invitation_pending" || code === "invitation_expired") && conn.invitation_expires_at) {
      expiry = `<p style="font-size:12px;color:var(--muted,#6f7891);margin:6px 0 0">Invitation ${
        code === "invitation_expired" ? "expirée le" : "valable jusqu'au"
      } ${esc(fmtDateTime(conn.invitation_expires_at))}.</p>`;
    }

    // CTAs pilotés STRICTEMENT par les capabilities backend.
    const btns = [];
    if (caps.can_start_connection) {
      const label =
        code === "not_connected" ? "Connecter mon compte FlexiCash"
        : code === "invitation_pending" ? "Continuer la connexion"
        : code === "invitation_expired" ? "Créer une nouvelle invitation"
        : code === "disconnected" ? "Reconnecter mon compte FlexiCash"
        : "Connecter mon compte FlexiCash";
      // Pour "invitation_expired", n'exposer la régénération que si le backend l'autorise.
      if (code !== "invitation_expired" || caps.can_regenerate_invite) {
        btns.push(`<button class="btn btn-blue" type="button" data-fc-start>${esc(label)}</button>`);
      }
    }
    if (caps.can_regenerate_invite && code === "invitation_pending") {
      btns.push(`<button class="btn btn-outline-blue btn-sm" type="button" data-fc-start data-fc-regen>Générer une nouvelle invitation</button>`);
    }
    if (caps.can_refresh) {
      btns.push(`<button class="btn btn-ghost btn-sm" type="button" data-fc-refresh>Actualiser</button>`);
    }

    const security = caps.can_start_connection
      ? `<p style="font-size:11px;color:var(--muted,#6f7891);margin:10px 0 0">Vous vous connecterez directement sur FlexiCash. VinHT ne voit jamais votre mot de passe, votre PIN ni votre code de sécurité FlexiCash.</p>`
      : "";

    host.innerHTML = `
      <div class="section-head"><div><h2>FlexiCash</h2>
        <small>Connectez votre compte FlexiCash pour recevoir les paiements de vos ventes.</small></div>
        ${stateBadge(c)}
      </div>
      <div style="margin-top:6px">
        <strong style="display:block">${esc(c.state.title || "FlexiCash")}</strong>
        <p style="margin:4px 0 0;font-size:13px;color:var(--muted,#6f7891)">${esc(c.state.message || "")}</p>
        ${expiry}
        ${details}
      </div>
      <div id="mcFlexicashMsg" style="display:none;font-size:12px;margin-top:8px"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">${btns.join("")}</div>
      ${security}`;

    const setMsg = (t, ok) => {
      const m = host.querySelector("#mcFlexicashMsg");
      if (!m) return;
      m.textContent = t || "";
      m.style.color = ok ? "var(--green,#25a844)" : "var(--red,#f31938)";
      m.style.display = t ? "" : "none";
    };

    const runStart = async (btn) => {
      btn.disabled = true;
      const t0 = btn.textContent;
      btn.textContent = "Connexion à FlexiCash…";
      setMsg("");
      try {
        const res = await flexicashMerchantConnect("start");
        if (res.connect_url) {
          // Redirection : le token reste dans l'URL FlexiCash, jamais lu/stocké ici.
          window.location.assign(res.connect_url);
          return;
        }
        // Déjà connecté côté provider (pas de token) -> on rafraîchit l'affichage.
        rerender(res.context);
        showToast("Compte FlexiCash déjà connecté.");
      } catch (err) {
        console.warn("[VinHT] flexicash start:", err && (err.code || err.message));
        setMsg(flexicashConnectErrorMessage(err));
        btn.disabled = false;
        btn.textContent = t0;
      }
    };

    host.querySelectorAll("[data-fc-start]").forEach((b) => b.addEventListener("click", () => runStart(b)));
    host.querySelector("[data-fc-refresh]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      const t0 = b.textContent;
      b.textContent = "Actualisation…";
      setMsg("");
      try {
        const res = await flexicashMerchantConnect("refresh");
        rerender(res.context);
      } catch (err) {
        console.warn("[VinHT] flexicash refresh:", err && (err.code || err.message));
        setMsg(flexicashConnectErrorMessage(err));
        b.disabled = false;
        b.textContent = t0;
      }
    });

    refreshIcons();
  }

  if (typeof onChange === "function") { try { onChange(ctx); } catch { /* ignore */ } }
  return ctx;
}

// Retour depuis FlexiCash : ?flexicash_connect=return
export async function handleFlexicashConnectReturn(host, { onChange = null } = {}) {
  if (!host) return;
  host.style.display = "";
  host.innerHTML = `<div class="section-head"><div><h2>FlexiCash</h2><small>Vérification de votre connexion FlexiCash…</small></div></div>
    <div class="loading-state">Vérification de votre connexion FlexiCash…</div>`;

  // 1) demander au backend de resynchroniser (échec non bloquant : on ré-affiche l'état réel ensuite)
  try {
    await flexicashMerchantConnect("refresh");
  } catch (err) {
    console.warn("[VinHT] flexicash return refresh:", err && (err.code || err.message));
  }

  // 2) nettoyer le paramètre d'URL sans recharger
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("flexicash_connect")) {
      url.searchParams.delete("flexicash_connect");
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : "") + url.hash);
    }
  } catch { /* ignore */ }

  // 3) ré-afficher l'état réel via le RPC
  await renderFlexicashConnectCard(host, { onChange });
}
