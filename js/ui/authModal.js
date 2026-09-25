// Modale login / signup.
//
// Le style est injecté une seule fois, préfixé ".vh-auth-*", pour NE PAS
// toucher styles.css (réduction du risque de régression visuelle avant la RC).
// Les tokens visuels suivent le design system Commerce V2 (blanc, noir, bleu VinHT, rouge VinHT).

import { signIn, signUp, signInWithGoogle, rememberAuthReturnUrl, getAuthReturnUrl } from "../services/auth.js";
import { flexicashIdentityErrorMessageFr, showFlexicashSyncNotice } from "../services/flexicashIdentity.js";
import { signInWithFlexiCashPopup } from "./flexicashOAuthPopup.js";
import { flexicashMarkHtml } from "./flexicashMark.js";
import { refreshIcons } from "../lib/icons.js";

let overlayEl = null;

const CSS = `
.vh-auth-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:20px;z-index:10000}
.vh-auth-overlay[hidden]{display:none}
.vh-auth-modal{position:relative;background:#fff;border:1px solid #e8e8eb;border-radius:10px;
  box-shadow:0 24px 60px rgba(0,0,0,.18);width:min(420px,100%);padding:26px;
  font-family:inherit;color:#202020}
.vh-auth-modal h2{margin:0 0 4px;font-size:22px;letter-spacing:-.4px}
.vh-auth-sub{margin:0 0 18px;font-size:13px;color:#71717a}
.vh-auth-field{margin-bottom:13px}
.vh-auth-field[hidden]{display:none}
.vh-auth-field label{display:block;font-size:11px;font-weight:800;margin:0 0 6px;color:#3f3f46}
.vh-auth-field input{width:100%;padding:12px 13px;border:1px solid #d8d8de;border-radius:6px;
  outline:0;background:#fff;font:inherit;color:#202020}
.vh-auth-field input:focus{border-color:#0a35a8}
.vh-auth-pass-wrap{position:relative}
.vh-auth-pass-wrap input{padding-right:42px}
.vh-auth-pass-toggle{position:absolute;top:0;right:0;bottom:0;width:38px;display:grid;place-items:center;
  border:0;background:none;cursor:pointer;color:#71717a}
.vh-auth-pass-toggle:hover{color:#3f3f46}
.vh-auth-pass-toggle svg{width:17px;height:17px}
.vh-auth-btn{width:100%;border:0;border-radius:5px;padding:13px 20px;font-weight:800;
  cursor:pointer;background:#0a35a8;color:#fff;font:inherit}
.vh-auth-btn[disabled]{opacity:.6;cursor:default}
.vh-auth-switch{margin-top:14px;font-size:12px;color:#71717a;text-align:center}
.vh-auth-switch button{background:none;border:0;color:#0a35a8;font-weight:800;cursor:pointer;font:inherit}
.vh-auth-msg{font-size:12px;margin:0 0 12px;padding:10px;border-radius:9px;display:none}
.vh-auth-msg.err{display:block;background:#fff0f3;color:#ba1530}
.vh-auth-msg.ok{display:block;background:#eefaf2;color:#2d6d3b}
.vh-auth-close{position:absolute;top:14px;right:16px;border:0;background:none;font-size:16px;
  cursor:pointer;color:#71717a;line-height:1}
.vh-auth-google{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
  border:1px solid #d8d8de;border-radius:6px;padding:12px 18px;font-weight:800;cursor:pointer;
  background:#fff;color:#202020;font:inherit}
.vh-auth-google:hover{background:#f7f7f8}
.vh-auth-google[disabled]{opacity:.6;cursor:default}
.vh-auth-google svg{width:18px;height:18px;flex:0 0 auto}
.vh-auth-flexicash{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
  border:1px solid #d8d8de;border-radius:6px;padding:10px 18px;font-weight:800;cursor:pointer;
  background:#fff;color:#202020;font:inherit;margin-top:10px}
.vh-auth-flexicash:hover{background:#f7f7f8}
.vh-auth-flexicash[disabled]{opacity:.6;cursor:default}
.vh-auth-or{display:flex;align-items:center;gap:10px;margin:14px 0;color:#a1a1aa;font-size:11px;
  font-weight:800;text-transform:uppercase;letter-spacing:.04em}
.vh-auth-or::before,.vh-auth-or::after{content:"";flex:1;height:1px;background:#e8e8eb}
`;

function injectCss() {
  if (document.getElementById("vh-auth-css")) return;
  const s = document.createElement("style");
  s.id = "vh-auth-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function translateError(err) {
  const code = String((err && err.code) || "").trim();
  const m = (err && err.message) || "Une erreur est survenue.";

  const byCode = {
    invalid_credentials: "Email ou mot de passe incorrect.",
    email_not_confirmed: "Email pas encore confirmé. Vérifiez votre boîte mail et cliquez sur le lien de confirmation.",
    user_already_exists: "Un compte existe déjà avec cet email.",
    email_exists: "Un compte existe déjà avec cet email.",
    email_address_invalid: "Adresse email invalide.",
    validation_failed: "Formulaire invalide. Vérifiez les champs et réessayez.",
    weak_password: "Mot de passe trop faible. Utilisez au moins 6 caractères.",
    over_email_send_rate_limit: "Trop de tentatives. Réessayez plus tard.",
    over_request_rate_limit: "Trop de tentatives. Réessayez plus tard.",
    signup_disabled: "Les inscriptions sont temporairement désactivées.",
    same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
    session_not_found: "Session expirée. Reconnectez-vous.",
    refresh_token_not_found: "Session expirée. Reconnectez-vous.",
    refresh_token_already_used: "Session expirée. Reconnectez-vous.",
    user_banned: "Ce compte est temporairement suspendu.",
    provider_disabled: "Cette méthode de connexion n'est pas disponible.",
  };
  if (byCode[code]) return byCode[code];

  if (/Invalid login credentials/i.test(m)) return "Email ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(m))
    return "Email pas encore confirmé. Vérifiez votre boîte mail et cliquez sur le lien de confirmation.";
  if (/already registered|already exists/i.test(m)) return "Un compte existe déjà avec cet email.";
  if (/Unable to validate email address|invalid format/i.test(m)) return "Adresse email invalide.";
  if (/Supabase non configuré/i.test(m)) return "Connexion indisponible : configuration manquante.";
  if (/rate limit|too many|for security purposes/i.test(m)) return "Trop de tentatives. Réessayez plus tard.";
  if (/Password should be at least/i.test(m)) return "Mot de passe trop court (6 caractères minimum).";
  if (/weak password/i.test(m)) return "Mot de passe trop faible. Utilisez au moins 6 caractères.";
  if (/signups? not allowed|signup is disabled/i.test(m)) return "Les inscriptions sont temporairement désactivées.";
  if (/session (missing|expired|not found)|refresh token/i.test(m)) return "Session expirée. Reconnectez-vous.";
  if (/network|fetch/i.test(m)) return "Connexion impossible. Vérifiez votre connexion internet.";
  // Fallback sûr : ne jamais afficher un message technique brut en anglais.
  return "Une erreur est survenue. Réessayez.";
}

function build() {
  injectCss();

  const overlay = document.createElement("div");
  overlay.className = "vh-auth-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="vh-auth-modal" role="dialog" aria-modal="true" aria-labelledby="vh-auth-title">
      <button class="vh-auth-close" type="button" aria-label="Fermer"><i data-lucide="x"></i></button>
      <h2 id="vh-auth-title">Connexion</h2>
      <p class="vh-auth-sub">Accédez à votre compte VinHT.</p>
      <p class="vh-auth-msg" role="alert"></p>
      <button type="button" class="vh-auth-google">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.8h12.5c-.3 2.1-1.6 5.2-4.7 7.3l7.3 5.7c4.3-4 6.9-9.9 6.9-16.7z"/><path fill="#FBBC05" d="M10.5 28.3c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.1 0 19.9 0 23.7s1 7.6 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 12-2.1 16-5.8l-7.3-5.7c-2 1.4-4.7 2.4-8.7 2.4-6.3 0-11.6-3.7-13.5-8.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        <span class="vh-auth-google-label">Continuer avec Google</span>
      </button>
      <button type="button" class="vh-auth-flexicash">
        ${flexicashMarkHtml(22)}
        <span class="vh-auth-flexicash-label">Continuer avec FlexiCash</span>
      </button>
      <div class="vh-auth-or">ou</div>
      <form novalidate>
        <div class="vh-auth-field vh-auth-name" hidden>
          <label for="vh-auth-name">Nom complet</label>
          <input id="vh-auth-name" type="text" autocomplete="name">
        </div>
        <div class="vh-auth-field">
          <label for="vh-auth-email">Email</label>
          <input id="vh-auth-email" type="email" autocomplete="email" required>
        </div>
        <div class="vh-auth-field">
          <label for="vh-auth-pass">Mot de passe</label>
          <div class="vh-auth-pass-wrap">
            <input id="vh-auth-pass" type="password" autocomplete="current-password" required minlength="6">
            <button type="button" class="vh-auth-pass-toggle" aria-label="Afficher le mot de passe" aria-pressed="false"><i data-lucide="eye"></i></button>
          </div>
        </div>
        <button class="vh-auth-btn" type="submit">Se connecter</button>
      </form>
      <p class="vh-auth-switch">
        <span class="vh-auth-switch-text">Pas encore de compte ?</span>
        <button type="button" class="vh-auth-switch-btn">Créer un compte</button>
      </p>
    </div>`;
  document.body.appendChild(overlay);
  refreshIcons();

  const form = overlay.querySelector("form");
  const msg = overlay.querySelector(".vh-auth-msg");
  const title = overlay.querySelector("#vh-auth-title");
  const sub = overlay.querySelector(".vh-auth-sub");
  const nameField = overlay.querySelector(".vh-auth-name");
  const nameInput = overlay.querySelector("#vh-auth-name");
  const emailInput = overlay.querySelector("#vh-auth-email");
  const passInput = overlay.querySelector("#vh-auth-pass");
  const passToggle = overlay.querySelector(".vh-auth-pass-toggle");
  const submitBtn = overlay.querySelector(".vh-auth-btn");
  const switchText = overlay.querySelector(".vh-auth-switch-text");
  const switchBtn = overlay.querySelector(".vh-auth-switch-btn");
  const closeBtn = overlay.querySelector(".vh-auth-close");
  const googleBtn = overlay.querySelector(".vh-auth-google");
  const flexicashBtn = overlay.querySelector(".vh-auth-flexicash");

  let mode = "login";

  function clearMsg() {
    msg.className = "vh-auth-msg";
    msg.textContent = "";
  }
  function showErr(t) {
    msg.className = "vh-auth-msg err";
    msg.textContent = t;
  }
  function showOk(t) {
    msg.className = "vh-auth-msg ok";
    msg.textContent = t;
  }

  function setMode(next) {
    mode = next;
    const isSignup = mode === "signup";
    title.textContent = isSignup ? "Créer un compte" : "Connexion";
    sub.textContent = isSignup
      ? "Rejoignez VinHT en quelques secondes."
      : "Accédez à votre compte VinHT.";
    submitBtn.textContent = isSignup ? "Créer mon compte" : "Se connecter";
    nameField.hidden = !isSignup;
    passInput.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
    switchText.textContent = isSignup ? "Vous avez déjà un compte ?" : "Pas encore de compte ?";
    switchBtn.textContent = isSignup ? "Se connecter" : "Créer un compte";
    clearMsg();
  }

  function resetPassVisibility() {
    passInput.type = "password";
    passToggle.setAttribute("aria-pressed", "false");
    passToggle.setAttribute("aria-label", "Afficher le mot de passe");
    passToggle.innerHTML = `<i data-lucide="eye"></i>`;
    refreshIcons();
  }
  function open(startMode = "login") {
    rememberAuthReturnUrl();
    setMode(startMode);
    resetPassVisibility();
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => emailInput.focus(), 30);
  }
  function close() {
    overlay.hidden = true;
    document.body.style.overflow = "";
    form.reset();
    resetPassVisibility();
    clearMsg();
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
  switchBtn.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  passToggle.addEventListener("click", () => {
    const shown = passInput.type === "text";
    passInput.type = shown ? "password" : "text";
    passToggle.setAttribute("aria-pressed", shown ? "false" : "true");
    passToggle.setAttribute("aria-label", shown ? "Afficher le mot de passe" : "Masquer le mot de passe");
    passToggle.innerHTML = `<i data-lucide="${shown ? "eye" : "eye-off"}"></i>`;
    refreshIcons();
    passInput.focus();
  });

  const googleLabel = overlay.querySelector(".vh-auth-google-label");
  googleBtn.addEventListener("click", async () => {
    clearMsg();
    googleBtn.disabled = true;
    const original = googleLabel.textContent;
    googleLabel.textContent = "Redirection…";
    try {
      // Déclenche une redirection plein écran vers Google puis retour sur la page
      // qui a demandé la connexion (ex. /admin/index.html).
      await signInWithGoogle();
    } catch (err) {
      showErr(translateError(err));
      googleBtn.disabled = false;
      googleLabel.textContent = original;
    }
  });

  const flexicashLabel = overlay.querySelector(".vh-auth-flexicash-label");
  flexicashBtn.addEventListener("click", async () => {
    clearMsg();
    flexicashBtn.disabled = true;
    const original = flexicashLabel.textContent;
    flexicashLabel.textContent = "Connexion…";
    try {
      // Popup centrée (fournisseur OIDC custom:flexicash) : l'onglet VinHT en
      // cours ne navigue jamais, le formulaire déjà rempli (nom/email/mot de
      // passe pour une inscription en cours) reste intact quoi qu'il arrive.
      // Jamais de mot de passe/PIN FlexiCash lu ici : tout se passe côté FlexiCash.
      const result = await signInWithFlexiCashPopup();
      if (result.fellBackToFullPage) {
        // Popup bloquée par le navigateur : la page est déjà en train de
        // naviguer en plein écran (comportement historique) — rien de plus
        // à faire ici, la navigation va interrompre ce script.
        flexicashLabel.textContent = "Redirection…";
        return;
      }
      if (result.success) {
        showOk("✓ Connexion FlexiCash réussie");
        flexicashLabel.textContent = "Connecté ✓";
        // Aucun rechargement : la session a été posée par la popup dans le
        // même stockage d'origine, et onAuthChange() (services/auth.js,
        // déjà branché par ui/account.js, ui/shell.js, etc. sur tout VinHT)
        // se déclenche naturellement dès que le client Supabase de cet
        // onglet détecte le changement — l'état connecté se met à jour tout
        // seul, sans quitter la page ni perdre quoi que ce soit.
        setTimeout(() => {
          close();
          // Bandeau persistant sur la page VinHT elle-même (pas seulement
          // dans la modale qui vient de disparaître) : reprend le même
          // composant que le flux plein écran, pour une expérience cohérente
          // quel que soit le chemin de connexion FlexiCash emprunté.
          showFlexicashSyncNotice("Connexion FlexiCash réussie ✓", "green");
        }, 900);
        return;
      }
      if (result.cancelled) {
        showErr("Connexion FlexiCash annulée.");
      } else {
        showErr(flexicashIdentityErrorMessageFr(result.code, "Impossible de se connecter avec FlexiCash. Réessayez."));
      }
      flexicashBtn.disabled = false;
      flexicashLabel.textContent = original;
    } catch (err) {
      showErr(translateError(err));
      flexicashBtn.disabled = false;
      flexicashLabel.textContent = original;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const email = emailInput.value.trim();
    const password = passInput.value;
    const fullName = nameInput.value.trim();

    if (!email || !password) {
      showErr("Email et mot de passe requis.");
      return;
    }
    if (password.length < 6) {
      showErr("Mot de passe trop court (6 caractères minimum).");
      return;
    }

    const original = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Patientez…";
    try {
      if (mode === "signup") {
        const data = await signUp({ email, password, fullName });
        if (data && data.session) {
          close();
        } else {
          showOk("Compte créé. Vérifiez votre email pour confirmer votre adresse.");
        }
      } else {
        await signIn({ email, password });
        close();
        // Le mot de passe ne quitte pas le navigateur comme OAuth : forcer la
        // même destination mémorisée garantit le comportement de toutes les
        // pages protégées (checkout, marchand, client, admin, etc.).
        window.location.assign(getAuthReturnUrl());
      }
    } catch (err) {
      showErr(translateError(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  overlayEl = overlay;
  overlayEl._open = open;
  overlayEl._close = close;
  return overlay;
}

export function openAuthModal(mode = "login") {
  if (!overlayEl) build();
  overlayEl._open(mode);
}

export function closeAuthModal() {
  if (overlayEl) overlayEl._close();
}
