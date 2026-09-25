import { getSession, onAuthChange } from "../services/auth.js";
import { getMyUnreadNotificationCount, listMyNotifications } from "../services/notifications.js";
import { applyUiPreferences, getUiPreferences, maybeShowBrowserNotification } from "../services/preferences.js";
import { refreshIcons } from "../lib/icons.js";

function rootPrefix(){return location.pathname.includes("/admin/")||location.pathname.includes("/merchant/")?"../":""}

const LAST_BROWSER_NOTIFICATION_KEY = "vinht-last-browser-notification-v1";

// notifications_enabled n'est plus un interrupteur maître : les catégories
// transactionnelles/sécurité restent toujours in-app. Seule la préférence
// navigateur locale (browserNotifications) contrôle ce popup système.
async function maybeSurfaceBrowserNotification(session) {
  if (!session?.user) return;
  const prefs = getUiPreferences();
  if (!prefs.browserNotifications || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const { rows } = await listMyNotifications({ limit: 1 });
    const latest = rows[0];
    if (!latest || latest.is_read) return;
    const lastId = localStorage.getItem(LAST_BROWSER_NOTIFICATION_KEY);
    if (lastId === latest.id) return;
    const shown = maybeShowBrowserNotification(latest.title || "VinHT", {
      body: latest.message || "Nouvelle notification VinHT",
      tag: `vinht-${latest.id}`,
    });
    if (shown) localStorage.setItem(LAST_BROWSER_NOTIFICATION_KEY, latest.id);
  } catch {}
}
function rootHref(path){return rootPrefix()+path}

function bindGlobalSearch(){
  document.querySelectorAll("[data-global-search]").forEach((form)=>{
    form.addEventListener("submit",(e)=>{
      e.preventDefault();
      const input=form.querySelector("input[type=search],input[data-search-input],input");
      const q=(input?.value||"").trim();
      const url=new URL(rootHref("products.html"),location.href);
      if(q)url.searchParams.set("q",q);
      location.href=url.href;
    });
  });
}

function markActiveLinks(){
  const file=location.pathname.split("/").filter(Boolean).pop()||"index.html";
  document.querySelectorAll("[data-nav-file]").forEach(a=>a.classList.toggle("active",a.dataset.navFile===file));
}

async function refreshNotificationBadges(session){
  const badges=[...document.querySelectorAll("[data-notification-badge]")];
  if(!badges.length)return;
  badges.forEach(b=>b.textContent="");
  if(!session?.user)return;
  try{
    const count=await getMyUnreadNotificationCount();
    badges.forEach(b=>b.textContent=count?String(Math.min(count,99)):"");
    await maybeSurfaceBrowserNotification(session);
  }catch{}
}

function bindBackButtons(){document.querySelectorAll("[data-go-back]").forEach(b=>b.addEventListener("click",()=>history.length>1?history.back():location.assign(rootHref("index.html"))))}

// Réutilisable par les pages notifications (client/marchand) après une
// mutation (mark read/unread/all) : le badge global doit refléter
// get_my_unread_notification_count_v1(), jamais un compteur local recalculé
// à la main.
export async function refreshNotificationBadgeNow(){
  const badges=[...document.querySelectorAll("[data-notification-badge]")];
  if(!badges.length)return;
  try{
    const session=await getSession();
    if(!session?.user){badges.forEach(b=>b.textContent="");return}
    const count=await getMyUnreadNotificationCount();
    badges.forEach(b=>b.textContent=count?String(Math.min(count,99)):"");
  }catch{}
}

// Header mobile : la loupe seule remplace la barre de recherche complète pour
// gagner de la place, la barre s'ouvre en overlay au tap ; le menu hamburger
// donne accès à la navigation (Catégories/Produits/Offres/...) et à "Vendre
// sur VinHT", masqués sur mobile faute de place dans l'en-tête.
function bindMobileHeader(){
  document.querySelectorAll(".v5-header").forEach((header)=>{
    const toggle=header.querySelector("[data-search-toggle]");
    const form=header.querySelector(".v5-search");
    const input=form?.querySelector("input[data-search-input]");
    if(toggle&&form){
      toggle.addEventListener("click",()=>{
        const open=header.dataset.searchOpen==="1";
        if(open){delete header.dataset.searchOpen;}
        else{header.dataset.searchOpen="1";input?.focus();}
      });
      form.addEventListener("submit",()=>{delete header.dataset.searchOpen;});
      document.addEventListener("click",(e)=>{
        if(header.dataset.searchOpen!=="1")return;
        if(header.contains(e.target))return;
        delete header.dataset.searchOpen;
      });
      document.addEventListener("keydown",(e)=>{
        if(e.key==="Escape"&&header.dataset.searchOpen==="1"){delete header.dataset.searchOpen;toggle.focus();}
      });
    }
  });
  document.querySelectorAll("[data-hamburger-toggle]").forEach((btn)=>{
    const nav=document.querySelector(btn.dataset.hamburgerToggle?`#${btn.dataset.hamburgerToggle}`:"[data-mobile-nav]");
    if(!nav)return;
    const close=()=>{delete nav.dataset.open;btn.setAttribute("aria-expanded","false")};
    const open=()=>{nav.dataset.open="1";btn.setAttribute("aria-expanded","true")};
    btn.setAttribute("aria-expanded","false");
    btn.addEventListener("click",()=>nav.dataset.open==="1"?close():open());
    nav.querySelectorAll("[data-mobile-nav-close]").forEach((el)=>el.addEventListener("click",close));
    nav.querySelectorAll("a").forEach((a)=>a.addEventListener("click",close));
    document.addEventListener("keydown",(e)=>{if(e.key==="Escape"&&nav.dataset.open==="1")close();});
  });
}

export async function initShell(){
  applyUiPreferences();
  bindGlobalSearch();
  bindBackButtons();
  bindMobileHeader();
  markActiveLinks();
  refreshIcons();
  const visualDemo = new URLSearchParams(location.search).get("live") !== "1";
  if (visualDemo) {
    document.querySelectorAll("[data-notification-badge]").forEach((b)=>b.textContent="5");
    return;
  }
  try{const s=await getSession();await refreshNotificationBadges(s);onAuthChange(refreshNotificationBadges)}catch{}
}
