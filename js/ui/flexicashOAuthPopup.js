// Orchestration de la popup FlexiCash OAuth Identity — côté fenêtre
// PRINCIPALE VinHT uniquement (le traitement du retour, lui, vit dans la
// popup : voir services/flexicashIdentity.js handleFlexicashPopupCallbackIfNeeded,
// appelé depuis main.js).
//
// But : ne jamais naviguer l'onglet VinHT en cours pendant la connexion
// FlexiCash — le formulaire de connexion/inscription déjà rempli, le panier,
// la page en cours restent intacts pendant que la popup gère FlexiCash.
//
// Contrat de message reçu (voir flexicashIdentity.js pour l'émission) :
//   { source: "vinht-flexicash-oauth", status: "success" | "error", code? }
// Un message n'est traité QUE si :
//   1) event.origin === notre propre origine (jamais FlexiCash ni ailleurs) ;
//   2) event.source === la fenêtre popup exacte que NOUS avons ouverte
//      (empêche qu'une autre fenêtre same-origin usurpe le message) ;
//   3) event.data.source === le marqueur attendu.
// Aucun token, mot de passe, PIN ou secret ne transite jamais par ce canal.

import { signInWithFlexiCash } from "../services/flexicashIdentity.js";

const MESSAGE_SOURCE = "vinht-flexicash-oauth";
const POPUP_NAME = "vinht-flexicash-oauth";
const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 720;

// Ouverte de façon STRICTEMENT synchrone dans le gestionnaire de clic (avant
// tout await) : la plupart des navigateurs bloquent silencieusement un
// window.open() qui n'est plus perçu comme la conséquence directe d'un geste
// utilisateur. On navigue la popup vers l'URL FlexiCash réelle une fois
// celle-ci connue (après l'appel asynchrone à signInWithFlexiCash).
function openCenteredBlankPopup() {
  const width = Math.min(POPUP_WIDTH, (window.screen?.availWidth || POPUP_WIDTH) - 40);
  const height = Math.min(POPUP_HEIGHT, (window.screen?.availHeight || POPUP_HEIGHT) - 40);
  const left = Math.round((window.screenX ?? window.screenLeft ?? 0) + (window.outerWidth - width) / 2);
  const top = Math.round((window.screenY ?? window.screenTop ?? 0) + (window.outerHeight - height) / 2);
  const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no,toolbar=no,menubar=no,location=no`;

  let popup = null;
  try {
    popup = window.open("about:blank", POPUP_NAME, features);
  } catch {
    popup = null;
  }
  // Bloquée par le navigateur : selon les navigateurs, soit null, soit une
  // fenêtre déjà fermée, soit un objet sans .closed exploitable.
  if (!popup || popup.closed) return null;

  try {
    popup.document.title = "Connexion FlexiCash…";
    popup.document.body.style.cssText =
      "margin:0;display:flex;align-items:center;justify-content:center;height:100vh;" +
      "font:14px system-ui,-apple-system,sans-serif;color:#6f7891;background:#fff";
    popup.document.body.textContent = "Ouverture de FlexiCash…";
  } catch {
    // Purement cosmétique — jamais bloquant si le document n'est pas
    // accessible pour une raison quelconque.
  }
  return popup;
}

/**
 * Lance la connexion FlexiCash dans une popup centrée.
 *
 * Résout (ne rejette jamais pour un refus/annulation normal) avec :
 *   { success: true }
 *   { success: false, cancelled: true }              — popup fermée manuellement
 *   { success: false, code }                          — refus/erreur OAuth ou technique
 *   { success: false, fellBackToFullPage: true }       — popup bloquée : la page
 *                                                        est en train de naviguer
 *                                                        en plein écran (comportement
 *                                                        historique), rien d'autre à faire.
 */
export function signInWithFlexiCashPopup() {
  return new Promise((resolve) => {
    const popup = openCenteredBlankPopup();

    if (!popup) {
      // Fallback plein écran : identique au comportement d'avant cette
      // fonctionnalité. La page va naviguer ; on ne fait rien de plus ici.
      signInWithFlexiCash({ popup: false }).catch(() => {});
      resolve({ success: false, fellBackToFullPage: true });
      return;
    }

    let settled = false;
    let pollId = null;

    function cleanup() {
      if (pollId) clearInterval(pollId);
      window.removeEventListener("message", onMessage);
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.source !== popup) return;
      const data = event.data;
      if (!data || data.source !== MESSAGE_SOURCE) return;
      if (data.status === "success") {
        finish({ success: true });
      } else {
        finish({ success: false, code: data.code || "oauth_failed" });
      }
    }
    window.addEventListener("message", onMessage);

    // Détecte une fermeture manuelle de la popup (l'utilisateur renonce, ou
    // FlexiCash affiche un écran neutre "refusé" sans rediriger — dans ce
    // dernier cas, voir la note remise à l'équipe FlexiCash sur le retour
    // souhaité en cas de refus).
    pollId = setInterval(() => {
      if (popup.closed) finish({ success: false, cancelled: true });
    }, 500);

    signInWithFlexiCash({ popup: true })
      .then((data) => {
        if (settled) return;
        if (!data?.url) {
          try { popup.close(); } catch {}
          finish({ success: false, code: "popup_url_missing" });
          return;
        }
        try {
          popup.location.href = data.url;
        } catch {
          try { popup.close(); } catch {}
          finish({ success: false, code: "popup_navigation_failed" });
        }
      })
      .catch((err) => {
        try { popup.close(); } catch {}
        finish({ success: false, code: err?.code || "oauth_start_failed" });
      });
  });
}
