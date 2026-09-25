// État "Mon compte" dans le header des 4 pages.
//
// - Déconnecté : le lien ouvre la modale de connexion.
// - Connecté   : le lien affiche le prénom / l'email + un menu "Se déconnecter".
//
// Le lien ciblé est <a ... data-account-link> (ajouté dans les 4 HTML).
// Style du menu injecté ici, préfixé ".vh-acct-*" (styles.css intact).

import { $$ } from "../lib/dom.js";
import { onAuthChange, getSession, signOut, isSupabaseConfigured } from "../services/auth.js";
import { openAuthModal } from "./authModal.js";
import { showToast } from "./toast.js";
import { getMyAccessContext } from "../services/access.js";
import { refreshIcons } from "../lib/icons.js";

const LABEL_LOGGED_OUT = "Mon compte";
function rootPrefix() {
  return /\/(admin|merchant|agent|courier)\//.test(location.pathname) ? "../" : "";
}
function rootHref(path) { return rootPrefix() + path; }


function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function displayLabel(user) {
  if (!user) return LABEL_LOGGED_OUT;
  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name;
  if (name) return String(name).trim().split(/\s+/)[0];
  if (user.email) return user.email.split("@")[0];
  return LABEL_LOGGED_OUT;
}

function injectCss() {
  if (document.getElementById("vh-acct-css")) return;
  const s = document.createElement("style");
  s.id = "vh-acct-css";
  s.textContent = `
    .vh-acct-menu{position:absolute;z-index:10001;background:#fff;border:1px solid #e7eaf2;
      border-radius:12px;box-shadow:0 16px 40px rgba(16,27,63,.18);padding:12px;min-width:210px;
      font-family:inherit}
    .vh-acct-email{font-size:12px;color:#6f7891;margin-bottom:10px;word-break:break-all}
    .vh-acct-link{display:block;text-align:center;border:1px solid #e7eaf2;border-radius:9px;
      padding:9px 10px;margin-bottom:8px;font-weight:800;font-size:13px;color:#0b2edc;text-decoration:none}
    .vh-acct-logout{width:100%;border:0;border-radius:9px;background:#f31938;color:#fff;
      font-weight:800;padding:10px;cursor:pointer;font:inherit}`;
  document.head.appendChild(s);
}

function closeMenu() {
  const m = document.querySelector(".vh-acct-menu");
  if (m) m.remove();
}

function toggleMenu(anchor, user) {
  if (document.querySelector(".vh-acct-menu")) {
    closeMenu();
    return;
  }
  injectCss();
  const menu = document.createElement("div");
  menu.className = "vh-acct-menu";
  const root = rootPrefix();
  menu.innerHTML = `
    <div class="vh-acct-email"></div>
    <a class="vh-acct-link" href="${root}account.html">Tableau de bord</a>
    <a class="vh-acct-link" href="${root}orders.html">Mes commandes</a>
    <a class="vh-acct-link" href="${root}wishlist.html">Mes favoris</a>
    <a class="vh-acct-link" href="${root}notifications.html">Notifications</a>
    <a class="vh-acct-link" href="${root}settings.html">Paramètres</a>
    <a class="vh-acct-link" href="${root}merchant/index.html" data-merchant-link hidden>Espace marchand</a>
    <a class="vh-acct-link" href="${root}admin/index.html" data-admin-link hidden>Administration</a>
    <a class="vh-acct-link" href="${root}agent/index.html" data-agent-link hidden>Centre Agent</a>
    <a class="vh-acct-link" href="${root}courier/index.html" data-courier-link hidden>Espace livreur</a>
    <button type="button" class="vh-acct-logout">Se déconnecter</button>`;
  menu.querySelector(".vh-acct-email").textContent = user.email || "Connecté";
  document.body.appendChild(menu);

  // Source unique : le RPC backend d'accès. On n'affiche un espace que si la
  // capability correspondante est vraie ; posséder un rôle ne retire jamais les
  // autres espaces.
  getMyAccessContext()
    .then((ctx) => {
      const caps = (ctx && ctx.capabilities) || {};
      const mLink = menu.querySelector("[data-merchant-link]");
      const aLink = menu.querySelector("[data-admin-link]");
      const cLink = menu.querySelector("[data-courier-link]");
      if (mLink && caps.can_open_merchant_center) mLink.hidden = false;
      if (aLink && caps.can_admin) aLink.hidden = false;
      const agLink = menu.querySelector("[data-agent-link]");
      const ca = (ctx && ctx.courier_access) || {};
      const aa = (ctx && ctx.agent_access) || {};
      // Un candidat (ou un profil en attente/refusé) doit pouvoir atteindre la
      // page, qui affiche l'état et le formulaire : pas seulement les actifs.
      if (cLink && (caps.can_deliver || ca.can_apply || ca.has_profile)) cLink.hidden = false;
      if (agLink && (caps.can_agent || aa.can_apply || aa.has_profile)) agLink.hidden = false;
      // Repositionne le menu : sa hauteur a pu changer.
      const rr = anchor.getBoundingClientRect();
      menu.style.left = window.scrollX + Math.max(12, rr.right - menu.offsetWidth) + "px";
    })
    .catch(() => {});

  const r = anchor.getBoundingClientRect();
  menu.style.top = window.scrollY + r.bottom + 8 + "px";
  menu.style.left = window.scrollX + Math.max(12, r.right - menu.offsetWidth) + "px";

  const onDoc = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor) {
      closeMenu();
      document.removeEventListener("mousedown", onDoc);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc), 0);

  menu.querySelector(".vh-acct-logout").addEventListener("click", async () => {
    closeMenu();
    try {
      await signOut();
      showToast("Déconnecté ✓");
    } catch (e) {
      showToast("Erreur de déconnexion", "red");
    }
  });
}

function render(session) {
  const user = session && session.user ? session.user : null;
  $$("[data-account-link]").forEach((link) => {
    // Icône seule dans le header compact (.v5-icon-actions) : le nom/email
    // injecté en texte y débordait du bouton carré. Le libellé reste
    // disponible via aria-label/title (survol, lecteurs d'écran).
    link.innerHTML = `<i data-lucide="user-round"></i>`;
    const label = esc(displayLabel(user));
    link.setAttribute("aria-label", label);
    link.setAttribute("title", label);
    link.setAttribute("href", "#");
    link.onclick = (e) => {
      e.preventDefault();
      if (user) toggleMenu(link, user);
      else openAuthModal("login");
    };
  });
  refreshIcons();
}

export async function initAccount() {
  if (!isSupabaseConfigured()) {
    // Pas de config : le lien ouvre quand même la modale, qui affichera
    // "Connexion indisponible : configuration manquante".
    $$("[data-account-link]").forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        openAuthModal("login");
      };
    });
    return;
  }

  render(await getSession());
  onAuthChange((session) => render(session));
}
