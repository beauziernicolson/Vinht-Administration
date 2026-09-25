import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import {
  getMyAssistedMerchantInviteContext, claimMyAssistedMerchantDossier, assistedInviteErrorMessageFr,
} from "../services/onboarding.js";

// Feature #36C — page d'activation d'un dossier marchand assisté par un Agent.
// Toutes les règles de sécurité (compte non anonyme, e-mail JWT = e-mail du
// dossier, invitation non expirée, auth récente par otp/magiclink/invite)
// sont vérifiées côté backend (get_my_assisted_merchant_invite_context_v1) :
// ce fichier ne fait que présenter le résultat, jamais les reproduire.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const loading = (t = "Chargement…") => `<div class="loading-state">${esc(t)}</div>`;

function getDossierId() {
  try { return new URL(window.location.href).searchParams.get("dossier_id") || ""; }
  catch { return ""; }
}

function render(html) {
  const host = document.querySelector("#activateHost");
  if (host) host.innerHTML = html;
  refreshIcons();
}

function errorScreen(message, { retry } = {}) {
  render(`<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Activation impossible</h3><p>${esc(message)}</p>${retry ? `<button class="btn btn-outline-blue btn-sm" type="button" id="actRetry">Réessayer</button>` : ""}</div>`);
  if (retry) document.querySelector("#actRetry")?.addEventListener("click", retry);
}

async function showWelcome(dossierId, ctx) {
  const p = ctx.profile || {};
  const inv = ctx.invitation || {};
  if (!inv.claimable) {
    errorScreen("Cette invitation n'est plus disponible pour activation. Demandez à votre Agent de la renvoyer si besoin.");
    return;
  }
  render(`
    <div class="empty-state" style="text-align:left">
      <h3>Bienvenue, ${esc(p.full_name || "")}</h3>
      <p><strong>${esc(p.shop_name || "")}</strong> · ${esc(p.merchant_type || "")}</p>
      <p class="muted" style="font-size:12px">Ces informations ont été préparées avec l'aide d'un Agent VinHT. Vous pourrez les modifier ensuite depuis votre espace marchand.</p>
      <div id="actMsg" class="error-state" style="display:none;margin-top:8px"></div>
      <button class="btn btn-blue" type="button" id="actClaimBtn" style="margin-top:12px">Activer mon espace marchand</button>
    </div>
  `);
  document.querySelector("#actClaimBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const msgBox = document.querySelector("#actMsg");
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    try {
      await claimMyAssistedMerchantDossier(dossierId);
      showClaimed();
    } catch (err) {
      msgBox.textContent = assistedInviteErrorMessageFr(err?.message, "Impossible d'activer votre espace marchand.");
      msgBox.style.display = "";
      btn.dataset.submitting = ""; btn.disabled = false;
    }
  });
}

function showClaimed() {
  render(`<div class="empty-state"><div class="empty-icon"><i data-lucide="circle-check"></i></div><h3>Dossier réclamé ✓</h3><p>Votre demande marchand a été créée. Continuez le parcours de vérification et d’activation ; l’espace marchand sera disponible après validation.</p><a class="btn btn-blue" href="onboarding.html">Continuer</a></div>`);
}

async function boot() {
  const dossierId = getDossierId();
  if (!dossierId) { errorScreen("Lien d'activation invalide ou incomplet."); return; }
  render(loading("Vérification de votre invitation…"));

  const session = await getSession();
  if (!session?.user) {
    render(`<div class="empty-state"><div class="empty-icon"><i data-lucide="mail"></i></div><h3>Ouvrez ce lien depuis l'e-mail reçu</h3><p>Votre session n'est pas encore active. Ouvrez le lien d'invitation reçu par e-mail sur cet appareil, ou connectez-vous si vous avez déjà un mot de passe VinHT.</p><button class="btn btn-outline-blue btn-sm" type="button" id="actLogin">Se connecter</button></div>`);
    document.querySelector("#actLogin")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }

  let ctx;
  try {
    ctx = await getMyAssistedMerchantInviteContext(dossierId);
  } catch (err) {
    errorScreen(assistedInviteErrorMessageFr(err?.message, "Impossible de charger cette invitation."), { retry: boot });
    return;
  }

  if (ctx.state === "claimed") { showClaimed(); return; }
  await showWelcome(dossierId, ctx);
}

let _actBooted = false;
let _actLastUid = null;

export async function initMerchantActivate() {
  if (document.body.dataset.activatePage !== "activate") return;
  if (!_actBooted) {
    onAuthChange((s) => {
      const uid = (s && s.user && s.user.id) || null;
      if (_actBooted && uid === _actLastUid) return;
      _actLastUid = uid;
      boot();
    });
  }
  _actBooted = true;
  await boot();
}
