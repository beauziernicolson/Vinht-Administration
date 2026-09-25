// FlexiCash OAuth Identity — FlexiCash comme fournisseur OIDC de VinHT.
// FRONTEND UNIQUEMENT.
//
// Architecture respectée (ne pas modifier) :
//   VinHT clique "Continuer avec FlexiCash"
//   -> supabase.auth.signInWithOAuth({ provider: "custom:flexicash" })
//   -> FlexiCash authentifie + écran de consentement FlexiCash (repo FlexiCash)
//   -> retour Supabase/VinHT, session VinHT créée (detectSessionInUrl, déjà actif)
//   -> appel vinht-flexicash-identity-sync avec le seul JWT de session VinHT
//   -> VinHT connaît l'identité FlexiCash stable (public.flexicash_identity_links)
//
// Sécurité : aucun mot de passe / PIN / Client Secret FlexiCash ne transite
// jamais ici. Le provider_access_token FlexiCash n'est jamais lu ni envoyé —
// l'Edge Function relit elle-même l'identité déjà vérifiée par Supabase Auth
// (identities liées au user). Aucun solde ni fusion automatique par nom/téléphone.

import { getSupabase } from "./supabase.js";
import { getSession } from "./auth.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const PROVIDER = "custom:flexicash";
const PENDING_SYNC_KEY = "vinht-flexicash-pending-sync";
const IDENTITY_SYNC_URL = `${SUPABASE_URL}/functions/v1/vinht-flexicash-identity-sync`;

// Marqueur de retour popup (FlexiCash OAuth Identity) — ajouté UNIQUEMENT au redirectTo
// utilisé pour le flux popup, jamais au flux plein écran existant. Permet à
// main.js de reconnaître, dès le chargement, qu'une fenêtre EST la popup
// OAuth FlexiCash plutôt qu'un onglet VinHT normal.
export const POPUP_CALLBACK_PARAM = "flexicash_popup";
const POPUP_MESSAGE_SOURCE = "vinht-flexicash-oauth";

function safeReturnUrl(candidate) {
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

// Même politique de retour que les autres providers OAuth VinHT (voir
// services/auth.js) : on rejoue la page qui a demandé la connexion.
function getReturnUrl() {
  let stored = null;
  try { stored = sessionStorage.getItem("vinht-auth-return-url"); } catch {}
  return safeReturnUrl(stored) || safeReturnUrl(window.location.href) || window.location.origin;
}

// --- 1. Déclenche le login FlexiCash ---------------------------------------
// Scopes actuels du provider : openid email profile (rien d'autre n'existe
// côté backend pour l'instant — ne pas ajouter de scope inventé).
//
// { popup: true } (FlexiCash OAuth Identity, UX popup) : ne navigue PAS
// l'onglet en cours. skipBrowserRedirect laisse le SDK construire l'URL
// d'autorisation FlexiCash sans y rediriger lui-même — c'est l'appelant
// (flexicashOAuthPopup.js) qui pointe une popup déjà ouverte vers cette URL.
// Le marqueur ?flexicash_popup=1 est ajouté au redirectTo (via l'API URL,
// jamais par concaténation de chaîne) pour que main.js reconnaisse cette
// fenêtre comme étant la popup de retour, jamais un onglet normal — les
// query params déjà présents sur l'URL de départ (ex. next=..., order_id=...)
// sont donc préservés intégralement, seul le marqueur est ajouté.
// Le flag "pending sync" (sessionStorage) reste réservé au flux plein écran :
// en popup, la synchronisation est déclenchée directement et sans détour par
// handleFlexicashPopupCallbackIfNeeded().
export async function signInWithFlexiCash({ popup = false } = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  if (!popup) {
    try { sessionStorage.setItem(PENDING_SYNC_KEY, "1"); } catch {}
  }
  let redirectTo = getReturnUrl();
  if (popup) {
    const u = new URL(redirectTo);
    u.searchParams.set(POPUP_CALLBACK_PARAM, "1");
    redirectTo = u.href;
  }
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: PROVIDER,
    options: {
      redirectTo,
      scopes: "openid email profile",
      ...(popup ? { skipBrowserRedirect: true } : {}),
    },
  });
  if (error) {
    if (!popup) { try { sessionStorage.removeItem(PENDING_SYNC_KEY); } catch {} }
    throw error;
  }
  if (popup && !data?.url) {
    throw Object.assign(new Error("URL FlexiCash manquante."), { code: "popup_url_missing" });
  }
  return data;
}

// --- 2. Synchronisation d'identité au retour --------------------------------
// AUCUN provider_access_token envoyé : uniquement le JWT de session VinHT.
// L'Edge Function lit elle-même l'identité custom:flexicash déjà vérifiée.
async function callIdentitySync(token) {
  const response = await fetch(IDENTITY_SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  return { ok: response.ok, status: response.status, data };
}

// Synchronisation inconditionnelle (session déjà confirmée par l'appelant).
// Factorisée pour être partagée entre le flux plein écran (via le flag
// "pending", ci-dessous) et le flux popup (appelée directement depuis la
// popup elle-même, sans dépendre d'un flag sessionStorage — voir
// handleFlexicashPopupCallbackIfNeeded).
async function syncFlexicashIdentityNow(session) {
  try {
    const { ok, data } = await callIdentitySync(session.access_token);
    if (!ok || data?.success === false) {
      return { success: false, code: data?.error || "sync_failed", message: data?.message_fr || "Impossible de synchroniser l'identité FlexiCash." };
    }
    return { success: true, context: data?.context || null };
  } catch (e) {
    console.warn("[VinHT] identity-sync FlexiCash:", e && e.message);
    return { success: false, code: "sync_failed", message: "Impossible de synchroniser l'identité FlexiCash. Réessayez plus tard." };
  }
}

// À appeler une fois au boot de chaque page (fail-safe). Ne fait rien si
// aucun login FlexiCash n'était en cours. Idempotent : le flag est retiré
// dès la première tentative, réussie ou non. Réservé au flux plein écran
// (flow popup : voir handleFlexicashPopupCallbackIfNeeded).
export async function syncFlexicashIdentityIfPending() {
  let pending = false;
  try { pending = sessionStorage.getItem(PENDING_SYNC_KEY) === "1"; } catch {}
  if (!pending) return null;
  try { sessionStorage.removeItem(PENDING_SYNC_KEY); } catch {}

  const session = await getSession().catch(() => null);
  if (!session || !session.user) return null; // le retour OAuth n'a pas abouti à une session
  return syncFlexicashIdentityNow(session);
}

// --- Flux popup (FlexiCash OAuth Identity) ----------------------------------
//
// Tout ce qui suit s'exécute UNIQUEMENT dans la popup elle-même (jamais dans
// l'onglet VinHT principal). Contrat de communication avec l'onglet parent,
// quand il est encore joignable :
//   window.opener.postMessage({ source: "vinht-flexicash-oauth", status, code? }, origin)
// - `origin` est TOUJOURS notre propre origine (la popup est servie par
//   VinHT, jamais par FlexiCash) — jamais "*".
// - Aucun token, session, mot de passe ou secret n'est jamais inclus : un
//   simple statut succès/échec plus, en cas d'échec, un code d'erreur stable.
//
// Important : la détection "je suis la popup" repose UNIQUEMENT sur le
// marqueur d'URL, jamais sur la présence de window.opener. Un aller-retour
// cross-origin (VinHT -> FlexiCash -> VinHT) peut faire perdre `window.opener`
// en cours de route (COOP ou politique équivalente côté FlexiCash, hors de
// notre contrôle) : si la détection dépendait de l'opener, cette petite
// fenêtre de ~480px finirait par démarrer l'application VinHT complète au
// lieu de simplement se terminer. Le marqueur seul doit donc toujours
// empêcher le boot normal ; la présence ou non de l'opener ne décide ensuite
// que de COMMENT cette fenêtre se termine (notifier puis fermer, ou état
// terminal local en best-effort).

// Vrai pour toute fenêtre portant le marqueur posé par
// signInWithFlexiCash({popup:true}) — que window.opener soit encore présent
// ou non. Voir la note ci-dessus : ne JAMAIS ajouter de condition sur
// window.opener ici.
export function isFlexicashPopupWindow() {
  try {
    return new URLSearchParams(window.location.search).get(POPUP_CALLBACK_PARAM) === "1";
  } catch {
    return false;
  }
}

function popupPostMessage(status, extra = {}) {
  if (!window.opener) return false;
  try {
    window.opener.postMessage({ source: POPUP_MESSAGE_SOURCE, status, ...extra }, window.location.origin);
    return true;
  } catch {
    return false;
  }
}

// État terminal affiché quand window.opener a été perdu en route : la popup
// ne peut plus notifier l'onglet parent, donc pas question d'y démarrer
// l'application VinHT complète — juste un message minimal, puis on tente
// quand même de se fermer (best-effort : certains navigateurs refusent
// window.close() sur une fenêtre qui ne se reconnaît plus comme "ouverte par
// script" une fois l'opener perdu).
function renderOpenerLostTerminalState(message) {
  try {
    document.title = "FlexiCash — VinHT";
    document.body.innerHTML = "";
    document.body.style.cssText =
      "margin:0;display:flex;align-items:center;justify-content:center;height:100vh;" +
      "padding:24px;text-align:center;font:14px system-ui,-apple-system,sans-serif;color:#202020;background:#fff";
    document.body.textContent = message;
  } catch {}
  try { window.close(); } catch {}
}

// Le retour OAuth peut arriver avant que le client Supabase de CETTE fenêtre
// (nouvellement chargée) ait fini de traiter l'URL (detectSessionInUrl est
// asynchrone). On patiente un peu plutôt que de déclarer un échec immédiat.
async function waitForFlexicashSession(maxAttempts = 12, delayMs = 300) {
  for (let i = 0; i < maxAttempts; i++) {
    const session = await getSession().catch(() => null);
    if (session && session.user) return session;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// À appeler tout en haut de main.js, AVANT tout autre init de page — voir
// isFlexicashPopupWindow() pour la condition de déclenchement (marqueur
// d'URL seul, jamais window.opener). Ne renvoie jamais d'exception non gérée.
//
// Si window.opener est encore là : synchronise puis notifie puis ferme
// (chemin normal). Si window.opener a été perdu pendant le trajet
// cross-origin : synchronise quand même (la session/l'identité sont réelles,
// autant les persister), mais ne peut plus notifier l'onglet parent — affiche
// un état terminal local minimal et tente de se fermer, SANS JAMAIS rendre
// l'application VinHT complète dans cette fenêtre.
export async function handleFlexicashPopupCallbackIfNeeded() {
  if (!isFlexicashPopupWindow()) return false;

  const finish = (status, code, terminalMessage) => {
    const notified = popupPostMessage(status, code ? { code } : {});
    if (!notified) renderOpenerLostTerminalState(terminalMessage);
    else setTimeout(() => { try { window.close(); } catch {} }, 50);
  };

  try {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    // Refus/erreur FlexiCash : Supabase relaie l'erreur OAuth standard
    // (error/error_description) sur ce même redirectTo plutôt que d'inventer
    // une session. On ne fabrique jamais un succès dans ce cas.
    const oauthError = params.get("error") || hashParams.get("error");
    if (oauthError) {
      finish("error", "oauth_denied", "Connexion FlexiCash refusée ou annulée. Vous pouvez fermer cette fenêtre.");
      return true;
    }

    const session = await waitForFlexicashSession();
    if (!session) {
      finish("error", "session_timeout", "La connexion FlexiCash n'a pas abouti à temps. Vous pouvez fermer cette fenêtre.");
      return true;
    }

    const result = await syncFlexicashIdentityNow(session);
    if (result && result.success === false) {
      finish("error", result.code || "sync_failed", "La connexion FlexiCash a échoué. Vous pouvez fermer cette fenêtre.");
    } else {
      finish("success", null, "Connexion FlexiCash réussie. Vous pouvez fermer cette fenêtre.");
    }
  } catch (err) {
    console.warn("[VinHT] callback popup FlexiCash:", err && err.message);
    finish("error", "callback_failed", "La connexion FlexiCash a échoué. Vous pouvez fermer cette fenêtre.");
  }
  return true;
}

// --- 3. Contexte d'identité FlexiCash (lecture) -----------------------------
export async function getMyFlexicashIdentityContext() {
  const sb = getSupabase();
  if (!sb) return null;
  const session = await getSession();
  if (!session || !session.user) return null;
  const { data, error } = await sb.rpc("get_my_flexicash_identity_context_v1");
  if (error) {
    const sig = String(error.message || error.code || "").toLowerCase();
    if (sig.includes("authentication_required") || sig.includes("jwt")) return null;
    throw error;
  }
  return data && typeof data === "object" ? data : null;
}

// --- 4. Lier un compte VinHT déjà connecté à une identité FlexiCash ---------
// Utilise le mécanisme officiel Supabase linkIdentity() — jamais de fusion
// automatique par nom/téléphone : seule l'identité vérifiée par Supabase compte.
export async function linkFlexicashIdentity() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  if (typeof sb.auth.linkIdentity !== "function") {
    const e = new Error("linkIdentity_unsupported");
    e.code = "linkIdentity_unsupported";
    throw e;
  }
  try { sessionStorage.setItem(PENDING_SYNC_KEY, "1"); } catch {}
  const { data, error } = await sb.auth.linkIdentity({
    provider: PROVIDER,
    options: { redirectTo: getReturnUrl(), scopes: "openid email profile" },
  });
  if (error) {
    try { sessionStorage.removeItem(PENDING_SYNC_KEY); } catch {}
    throw error;
  }
  return data;
}

// --- Messages FR (fallback ; le backend fournit déjà message_fr) -----------
export function flexicashIdentityErrorMessageFr(code, fallback = "Une erreur est survenue avec FlexiCash.") {
  const map = {
    not_authenticated: "Connectez-vous à VinHT pour continuer.",
    flexicash_oauth_identity_missing: "Aucune identité FlexiCash n'a été reçue lors de la connexion.",
    invalid_flexicash_subject: "L'identité FlexiCash reçue est invalide.",
    flexicash_identity_already_linked: "Ce compte FlexiCash est déjà lié à un autre compte VinHT.",
    vinht_user_already_linked_to_other_flexicash_identity: "Ce compte VinHT est déjà lié à une autre identité FlexiCash.",
    merchant_flexicash_identity_mismatch:
      "Ce compte FlexiCash ne correspond pas au compte actuellement connecté à votre boutique VinHT. Connectez-vous avec le compte FlexiCash associé à cette boutique.",
    sync_failed: "Impossible de synchroniser l'identité FlexiCash. Réessayez plus tard.",
    // Codes spécifiques au flux popup (FlexiCash OAuth Identity) — voir flexicashOAuthPopup.js.
    oauth_denied: "Connexion FlexiCash refusée ou annulée.",
    session_timeout: "La connexion FlexiCash n'a pas abouti à temps. Réessayez.",
    popup_url_missing: "Impossible de démarrer la connexion FlexiCash. Réessayez.",
    popup_navigation_failed: "Impossible d'ouvrir la fenêtre FlexiCash. Réessayez.",
    oauth_start_failed: "Impossible de démarrer la connexion FlexiCash. Réessayez.",
    callback_failed: "La connexion FlexiCash a échoué. Réessayez.",
  };
  return map[code] || fallback;
}

// --- Carte "Connexions liées" (paramètres) ---------------------------------
// N'affiche jamais un lien fabriqué : reflète get_my_flexicash_identity_context_v1
// (linked/email/full_name/synced_at) tel quel.
export async function renderFlexicashLinkCard(host) {
  if (!host) return;
  const session = await getSession();
  if (!session || !session.user) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<div class="section-head"><div><h2>Connexions liées</h2><small>Chargement…</small></div></div>`;
  let ctx = null;
  try {
    ctx = await getMyFlexicashIdentityContext();
  } catch (e) {
    host.innerHTML = `<div class="section-head"><div><h2>Connexions liées</h2></div></div>
      <p class="muted" style="font-size:12px;margin-top:8px">Informations FlexiCash momentanément indisponibles.</p>`;
    return;
  }

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  if (ctx && ctx.linked) {
    host.innerHTML = `
      <div class="section-head"><div><h2>Connexions liées</h2><small>Identité vérifiée par FlexiCash, jamais un rapprochement par nom ou téléphone.</small></div></div>
      <div class="settings-section"><div><strong>FlexiCash</strong><p>${esc(ctx.email || ctx.full_name || "Compte lié")}</p></div><span class="badge green">Lié</span></div>`;
    return;
  }

  host.innerHTML = `
    <div class="section-head"><div><h2>Connexions liées</h2><small>Reliez votre compte FlexiCash pour l'utiliser comme méthode de connexion.</small></div></div>
    <div class="settings-section">
      <div><strong>FlexiCash</strong><p>Non lié à ce compte VinHT.</p></div>
      <button class="btn btn-outline-blue btn-sm" type="button" id="flexicashLinkBtn">Lier mon compte FlexiCash</button>
    </div>
    <div id="flexicashLinkMsg" style="display:none;font-size:12px;margin-top:8px;color:var(--red,#f31938)"></div>`;

  const btn = host.querySelector("#flexicashLinkBtn");
  const msg = host.querySelector("#flexicashLinkMsg");
  btn?.addEventListener("click", async () => {
    if (msg) msg.style.display = "none";
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Redirection…";
    try {
      await linkFlexicashIdentity();
    } catch (err) {
      const text =
        err?.code === "linkIdentity_unsupported"
          ? "La liaison de compte n'est pas encore activée dans la configuration actuelle de VinHT."
          : flexicashIdentityErrorMessageFr(err?.code, err?.message || "Impossible de lier ce compte FlexiCash pour le moment.");
      if (msg) {
        msg.textContent = text;
        msg.style.display = "";
      }
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

// --- Bandeau de notification (plus visible/persistant qu'un toast pour un
// résultat d'authentification — l'utilisateur vient de revenir de FlexiCash). --
export function showFlexicashSyncNotice(message, tone = "blue") {
  if (!message) return;
  document.getElementById("vhFlexicashNotice")?.remove();
  const colors = {
    blue: { bg: "#eaf1ff", fg: "#0a35a8", border: "#c7d9ff" },
    green: { bg: "#eefaf2", fg: "#2d6d3b", border: "#bfe8cc" },
    red: { bg: "#fff0f3", fg: "#ba1530", border: "#f5c2cc" },
  }[tone] || { bg: "#eaf1ff", fg: "#0a35a8", border: "#c7d9ff" };
  const bar = document.createElement("div");
  bar.id = "vhFlexicashNotice";
  bar.setAttribute("role", "status");
  bar.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:10050;background:${colors.bg};color:${colors.fg};
    border-bottom:1px solid ${colors.border};padding:12px 44px 12px 16px;font-size:13px;font-weight:600;
    text-align:center;box-shadow:0 4px 14px rgba(0,0,0,.08)`;
  bar.innerHTML = `<span></span><button type="button" aria-label="Fermer" style="position:absolute;top:8px;right:12px;
    background:none;border:0;font-size:16px;line-height:1;cursor:pointer;color:${colors.fg}">×</button>`;
  bar.querySelector("span").textContent = message;
  bar.querySelector("button").addEventListener("click", () => bar.remove());
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 9000);
}
