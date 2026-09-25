import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { getMyProfile, updateMyProfile } from "../services/profile.js";
import { getMyOrders, getOrderItems } from "../services/orders.js";
import { getMyWishlist, removeFromWishlist } from "../services/wishlist.js";
import { getProductsByIds, productImageUrl } from "../services/catalog.js";
import {
  listMyNotifications, markMyNotificationRead, markAllMyNotificationsRead,
  getMyNotificationPreferences, updateMyNotificationPreferences, getNotificationCapabilities,
  listMyNotificationDevices, unregisterMyNotificationDevice,
  NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_FR, OPTIONAL_IN_APP_CATEGORIES,
  isSafeInternalActionPath, notificationErrorMessageFr, externalChannelStatusFr,
} from "../services/notifications.js";
import { getUiPreferences, setUiPreferences, setBrowserNotificationsEnabled } from "../services/preferences.js";
import { getRecentlyViewedIds, clearRecentlyViewed } from "../services/recent.js";
import { getSavedSearches, removeSavedSearch, clearSavedSearches, savedSearchUrl } from "../services/savedSearches.js";
import { getAddresses, saveAddress, removeAddress, setDefaultAddress } from "../services/addresses.js";
import { addressLabel, validateStandardAddress } from "../services/addressContract.js";
import { attachGeoHints } from "../services/geoHints.js";
import { getFollowedMerchantIdsAuthoritative, setMerchantFollowRemote } from "../services/following.js";
import { getPublicMerchantsByIds } from "../services/market.js";
import { updateMyPassword } from "../services/security.js";
import { signOut } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { showToast } from "../ui/toast.js";
import { refreshNotificationBadgeNow } from "../ui/shell.js";

const PLACEHOLDER="assets/abstract-brand.jpg";
const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmtDate=(v)=>{const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})};
const ORDER_STATUS_FR={pending:"En attente",confirmed:"Confirmée",preparing:"En préparation",ready:"Prête",shipped:"Expédiée",in_transit:"En transit",in_delivery:"En livraison",delivered:"Livrée",completed:"Terminée",cancelled:"Annulée",refunded:"Remboursée"};
const PAY_STATUS_FR={pending:"Paiement en attente",paid:"Payée",failed:"Paiement échoué",cancelled:"Paiement annulé",refunded:"Remboursée",authorized:"Autorisée"};
const DELIVERY_FR={home:"Livraison à domicile",vinht_pickup:"Point de retrait VinHT",custom_location:"Adresse / position personnalisée",custom_address:"Adresse personnalisée"};
const frLabel=(map,v)=>map[String(v||"").toLowerCase()]||(v?esc(v):"—");
const envBadge=(e)=>String(e||"").toLowerCase()==="demo"?' <span class="badge amber">MODE DEMO</span>':"";
const statusBadge=(s,map)=>{const k=String(s||"").toLowerCase();const cls=/delivered|completed|paid|approved|active/.test(k)?"green":/cancel|reject|fail|suspend/.test(k)?"red":/pending|new|processing|preparing/.test(k)?"amber":"blue";return `<span class="badge ${cls}">${esc((map&&map[k])||s||"—")}</span>`};

function fillPortalIdentity(session,profile){
  const name=profile?.full_name||session?.user?.user_metadata?.full_name||session?.user?.email||"Compte VinHT";
  document.querySelectorAll("[data-portal-name]").forEach(x=>x.textContent=name);
  document.querySelectorAll("[data-portal-email]").forEach(x=>x.textContent=session?.user?.email||"");
  document.querySelectorAll("[data-portal-initial]").forEach(x=>x.textContent=String(name).trim().charAt(0).toUpperCase()||"V");
}
function authGate(show=true){
  const gate=document.querySelector("[data-client-auth-gate]");
  const content=document.querySelector("[data-client-content]");
  if(content) content.hidden=show;
  if(!gate) return;
  gate.hidden=!show;
  if(!show) return;
  gate.innerHTML=`<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour ouvrir cette page de votre espace VinHT.</p><button class="btn btn-blue" type="button" data-client-login>Se connecter</button></div>`;
  gate.querySelector("[data-client-login]")?.addEventListener("click",()=>openAuthModal("login"),{once:true});
  refreshIcons();
}
function empty(title,text){return `<div class="empty-state"><div class="empty-icon"><i data-lucide="package-open"></i></div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
function loading(text="Chargement…"){return `<div class="loading-state">${esc(text)}</div>`}
function errorBox(text){return `<div class="error-state">${esc(text)}</div>`}
function orderCurrency(row){return String(row?.currency||"HTG").toUpperCase()==="USD"?"USD":"HTG"}
function orderAmount(row,generic,legacy){return Number(row?.[generic]??row?.[legacy]??0)||0}

async function pageProfile(profile){
  const form=document.querySelector("#profileForm");if(!form)return;
  form.full_name.value=profile?.full_name||"";form.email.value=profile?.email||"";form.phone.value=profile?.phone||"";form.address.value=profile?.address||"";
  form.addEventListener("submit",async(e)=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=true;try{await updateMyProfile({fullName:form.full_name.value,phone:form.phone.value,address:form.address.value});showToast("Profil enregistré ✓")}catch(err){showToast("Impossible d’enregistrer le profil","red")}finally{btn.disabled=false}});
}

function orderRow(o){
  const method=String(o.payment_method||"").toLowerCase();
  const payable=["flexicash","moncash","stripe"].includes(method)&&["pending","authorized","failed"].includes(String(o.payment_status||"").toLowerCase());
  const payBtn=payable?`<a class="btn btn-blue btn-sm" href="payment.html?order_id=${encodeURIComponent(o.id)}">Payer</a> `:"";
  const currency=orderCurrency(o);
  return `<tr><td><div class="table-primary">#${esc(String(o.id).slice(0,8))}${envBadge(o.environment)}</div><div class="table-secondary">${esc(fmtDate(o.created_at))} · ${esc(currency)}</div></td><td>${statusBadge(o.status,ORDER_STATUS_FR)}</td><td>${statusBadge(o.payment_status,PAY_STATUS_FR)}</td><td>${frLabel(DELIVERY_FR,o.delivery_type)}</td><td><strong>${money(orderAmount(o,"total_amount","total_htg"),currency)}</strong></td><td>${payBtn}<button class="btn btn-ghost btn-sm" type="button" data-order-detail="${esc(o.id)}">Détails</button></td></tr>`;
}
async function pageOrders(){
  const host=document.querySelector("#clientOrdersHost");if(!host)return;host.innerHTML=loading("Chargement de vos commandes…");
  try{const rows=await getMyOrders();if(!rows.length){host.innerHTML=empty("Aucune commande","Vos commandes apparaîtront ici après votre premier achat.");refreshIcons();return}
    host.innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Commande</th><th>Statut</th><th>Paiement</th><th>Livraison</th><th>Total</th><th></th></tr></thead><tbody>${rows.map(orderRow).join("")}</tbody></table></div><div id="clientOrderDetail" class="portal-card" hidden></div>`;
    host.querySelectorAll("[data-order-detail]").forEach(btn=>btn.addEventListener("click",async()=>{const box=host.querySelector("#clientOrderDetail");box.hidden=false;box.innerHTML=loading("Chargement du détail…");try{const items=await getOrderItems(btn.dataset.orderDetail);box.innerHTML=`<h3>Détail de la commande</h3>${items.map(it=>{const c=orderCurrency(it);return `<div class="settings-section"><div><strong>${esc(it.product_name||"Produit")}</strong><p>${esc(it.pricing_tier==="wholesale"?"Gros":"Détail")} · Qté ${esc(it.quantity)}</p></div><strong>${money(orderAmount(it,"line_total_amount","line_total_htg"),c)}</strong></div>`}).join("")||"<p class=\"muted\">Aucun article.</p>"}`;}catch{box.innerHTML=errorBox("Impossible de charger le détail.")}}));
  }catch{host.innerHTML=errorBox("Impossible de charger vos commandes.")}
}

function productMiniCard(p,remove=false){const imgs=Array.isArray(p.product_images)?p.product_images.slice():[];imgs.sort((a,b)=>(a?.is_primary?0:1)-(b?.is_primary?0:1));const img=productImageUrl(imgs[0]?.storage_path)||PLACEHOLDER;const merchant=p.merchants?.shop_name||"Marchand VinHT";return `<div class="product-card" data-product-mini="${esc(p.id)}"><a href="product.html?id=${encodeURIComponent(p.id)}"><div class="prod-img"><img src="${esc(img)}" alt="${esc(p.name)}"></div></a><h4><a href="product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a></h4><div class="seller">${esc(merchant)}</div><div class="price">${money(p.retail_price,p.currency)}</div>${remove?`<button class="add" type="button" data-remove-wish="${esc(p.id)}">Retirer</button>`:""}</div>`}
async function pageWishlist(){const host=document.querySelector("#clientWishlistHost");if(!host)return;host.innerHTML=loading("Chargement de vos favoris…");try{const w=await getMyWishlist();const ids=w.map(x=>x.product_id).filter(Boolean);const products=await getProductsByIds(ids);if(!products.length){host.innerHTML=empty("Aucun favori","Touchez le cœur d’un produit pour le retrouver ici.");refreshIcons();return}host.innerHTML=`<div class="products-grid">${products.map(p=>productMiniCard(p,true)).join("")}</div>`;host.querySelectorAll("[data-remove-wish]").forEach(btn=>btn.addEventListener("click",async()=>{btn.disabled=true;try{await removeFromWishlist(btn.dataset.removeWish);btn.closest(".product-card")?.remove();if(!host.querySelector(".product-card")){host.innerHTML=empty("Aucun favori","Votre wishlist est vide.");refreshIcons()}}catch{showToast("Impossible de retirer ce favori","red");btn.disabled=false}}));}catch{host.innerHTML=errorBox("Impossible de charger vos favoris.")}}

function notificationIcon(type){return /order/i.test(type||"")?"package-check":/product/i.test(type||"")?"shopping-bag":/merchant/i.test(type||"")?"store":"bell"}

const NOTIF_PAGE_SIZE = 20;
let _notifCategory = "";
let _notifUnreadOnly = false;
let _notifRows = [];
let _notifOffset = 0;
let _notifHasMore = false;
let _notifRequestSeq = 0;

function notificationActionHtml(n) {
  // Fail-closed : un action_path qui ne ressemble pas à un chemin VinHT
  // interne sûr ne devient jamais un lien, sans tentative de réparation.
  if (!isSafeInternalActionPath(n.action_path)) return "";
  return `<a class="btn btn-outline-blue btn-sm" href="${esc(n.action_path)}">Voir</a>`;
}

function notificationItemHtml(n) {
  return `<article class="notification-item level-${esc(n.level)} ${n.is_read?"":"unread"}" data-notification="${esc(n.id)}">
    <div class="notification-dot"><i data-lucide="${notificationIcon(n.type)}"></i></div>
    <div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><div class="notification-meta">${esc(fmtDate(n.created_at))} · ${esc(NOTIFICATION_CATEGORY_FR[n.category]||n.category||"Général")}</div></div>
    <div class="notification-actions">${notificationActionHtml(n)}${n.is_read
      ? `<button class="btn btn-ghost btn-sm" data-mark-unread type="button">Remettre non lu</button>`
      : `<button class="btn btn-ghost btn-sm" data-mark-read type="button">Lu</button>`}</div>
  </article>`;
}

function wireNotificationItemActions(host) {
  host.querySelectorAll("[data-mark-read]").forEach((btn) => btn.addEventListener("click", async () => {
    const item = btn.closest("[data-notification]"); btn.disabled = true;
    try {
      await markMyNotificationRead(item.dataset.notification, true);
      refreshNotificationBadgeNow();
      // Leçon #27 : en filtre "Non lus uniquement", marquer lu rétrécit le
      // dataset serveur — un simple retrait de classe locale avec l'ancien
      // offset peut faire sauter une notification lors de "Charger plus".
      // On force un reset autoritaire de la pagination dans ce cas.
      if (_notifUnreadOnly) { await runNotificationsSearch(true); return; }
      item.classList.remove("unread"); btn.outerHTML = `<button class="btn btn-ghost btn-sm" data-mark-unread type="button">Remettre non lu</button>`; wireNotificationItemActions(item);
    }
    catch (err) { btn.disabled = false; showToast(notificationErrorMessageFr(err?.message, "Action impossible"), "red"); }
  }));
  host.querySelectorAll("[data-mark-unread]").forEach((btn) => btn.addEventListener("click", async () => {
    const item = btn.closest("[data-notification]"); btn.disabled = true;
    try {
      await markMyNotificationRead(item.dataset.notification, false);
      refreshNotificationBadgeNow();
      item.classList.add("unread"); btn.outerHTML = `<button class="btn btn-ghost btn-sm" data-mark-read type="button">Lu</button>`; wireNotificationItemActions(item);
    }
    catch (err) { btn.disabled = false; showToast(notificationErrorMessageFr(err?.message, "Action impossible"), "red"); }
  }));
}

async function runNotificationsSearch(reset) {
  const host = document.querySelector("#clientNotificationsHost");
  const loadMoreWrap = document.querySelector("#clientNotificationsLoadMoreWrap");
  if (!host) return;
  const requestSeq = ++_notifRequestSeq;
  const requestedOffset = reset ? 0 : _notifOffset;
  if (reset) { _notifOffset = 0; _notifRows = []; host.innerHTML = loading("Chargement des notifications…"); }
  else { const b = loadMoreWrap?.querySelector("#notifLoadMoreBtn"); if (b) b.disabled = true; }
  try {
    const result = await listMyNotifications({ category: _notifCategory || null, unreadOnly: _notifUnreadOnly, limit: NOTIF_PAGE_SIZE, offset: requestedOffset });
    if (requestSeq !== _notifRequestSeq) return;
    const merged = reset ? result.rows : _notifRows.concat(result.rows);
    const seen = new Set();
    _notifRows = merged.filter((r) => { const id = String(r?.id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _notifHasMore = result.hasMore;
    _notifOffset = requestedOffset + result.rows.length;
    if (!_notifRows.length) { host.innerHTML = empty("Tout est calme", _notifUnreadOnly ? "Aucune notification non lue." : "Aucune notification pour le moment."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = `<div class="notification-list">${_notifRows.map(notificationItemHtml).join("")}</div>`;
    wireNotificationItemActions(host);
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _notifHasMore ? `<button class="btn btn-outline-blue" id="notifLoadMoreBtn" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#notifLoadMoreBtn")?.addEventListener("click", () => runNotificationsSearch(false));
    }
    refreshIcons();
  } catch (err) {
    if (requestSeq !== _notifRequestSeq) return;
    host.innerHTML = errorBox(notificationErrorMessageFr(err?.message, "Impossible de charger les notifications."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

async function pageNotifications(){
  const host=document.querySelector("#clientNotificationsHost");if(!host)return;
  const catSelect = document.querySelector("#notifCategoryFilter");
  if (catSelect && catSelect.options.length <= 1) {
    catSelect.innerHTML = `<option value="">Toutes catégories</option>` + NOTIFICATION_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(NOTIFICATION_CATEGORY_FR[c] || c)}</option>`).join("");
  }
  catSelect?.addEventListener("change", () => { _notifCategory = catSelect.value; runNotificationsSearch(true); });
  document.querySelector("#notifUnreadOnly")?.addEventListener("change", (e) => { _notifUnreadOnly = e.target.checked; runNotificationsSearch(true); });
  document.querySelector("#markAllNotifications")?.addEventListener("click", async () => {
    try { await markAllMyNotificationsRead(_notifCategory || null); refreshNotificationBadgeNow(); showToast("Notifications marquées comme lues ✓"); await runNotificationsSearch(true); }
    catch (err) { showToast(notificationErrorMessageFr(err?.message, "Action impossible"), "red"); }
  });
  await runNotificationsSearch(true);
}

// Feature #27 — Préférences de notifications. L'ancien "notifications_enabled"
// de profil agissait comme interrupteur maître masquant tout le centre de
// notifications, y compris les catégories transactionnelles/sécurité : ce
// comportement a disparu. Seules general/catalog/promotions acceptent un
// opt-out in-app ; les canaux externes n'affichent jamais "Activé ✓" sans
// provider_status==="ready" && enabled===true.

function channelRow(label, key, enabled, capability) {
  const status = externalChannelStatusFr(capability);
  const canToggle = capability?.provider_status === "ready";
  return `<div class="settings-section" data-channel="${esc(key)}">
    <div><strong>${esc(label)}</strong><p>${esc(status)}</p></div>
    <label class="switch"><input type="checkbox" data-channel-input ${enabled ? "checked" : ""} ${canToggle ? "" : "disabled"}><span class="switch-slider"></span></label>
  </div>`;
}

// Sérialisation des sauvegardes de préférences (leçon #27) : chaque switch
// déclenche update_my_notification_preferences_v2 qui renvoie tout l'état.
// Deux changements rapides ne doivent jamais courir en parallèle — sinon la
// réponse la plus lente peut écraser un choix plus récent. On garde une
// seule requête en vol, avec un drapeau "une sauvegarde supplémentaire est
// due" qui rejoue le dernier état une fois la requête en cours terminée.
let _prefsSaveInFlight = false;
let _prefsSavePending = false;

async function renderNotificationPreferences() {
  const host = document.querySelector("#notificationPreferencesHost");
  if (!host) return;
  host.innerHTML = loading("Chargement des préférences de notifications…");
  let prefs, caps;
  try {
    [prefs, caps] = await Promise.all([getMyNotificationPreferences(), getNotificationCapabilities()]);
  } catch (err) {
    host.innerHTML = errorBox(notificationErrorMessageFr(err?.message, "Impossible de charger les préférences de notifications."));
    return;
  }
  // Une panne sur les appareils ne doit jamais faire croire à "0 appareil" :
  // c'est chargé et affiché séparément des préférences (leçon #27).
  let devices = null, devicesError = null;
  try { devices = await listMyNotificationDevices(); } catch (err) { devicesError = err; }

  const catPrefs = (prefs.category_preferences && typeof prefs.category_preferences === "object") ? prefs.category_preferences : {};
  const ext = caps?.external_channels || {};
  const devicesHtml = devicesError
    ? errorBox(notificationErrorMessageFr(devicesError?.message, "Impossible de charger les appareils push."))
    : (devices.length
        ? devices.map((d) => `<div class="settings-section" data-device="${esc(d.device_id)}"><div><strong>${esc(d.platform || "—")} · ${esc(d.provider || "—")}${d.device_name ? " · " + esc(d.device_name) : ""}</strong><p>${d.active === false ? "Inactif" : "Actif"} · enregistré le ${esc(fmtDate(d.created_at))}</p></div>${d.active === false ? "" : `<button class="btn btn-outline-red btn-sm" data-remove-device type="button">Désactiver</button>`}</div>`).join("")
        : `<p class="muted" style="font-size:12px">Push préparé côté VinHT — fournisseur/appareil non configuré.</p>`);

  host.innerHTML = `
    <h3>Préférences de notifications</h3>
    <p class="muted" style="font-size:12px">Les alertes commandes, paiements, livraison, sécurité et autres catégories transactionnelles restent toujours actives dans votre centre de notifications VinHT.</p>
    ${channelRow("Email", "email", prefs.email_enabled, ext.email)}
    ${channelRow("SMS", "sms", prefs.sms_enabled, ext.sms)}
    ${channelRow("WhatsApp", "whatsapp", prefs.whatsapp_enabled, ext.whatsapp)}
    ${channelRow("Notifications push (mobile)", "push", prefs.push_enabled, ext.push)}
    <div class="settings-section" data-channel="marketing"><div><strong>Communications marketing</strong><p>Offres et actualités VinHT sur les canaux activés ci-dessus.</p></div><label class="switch"><input type="checkbox" data-channel-input ${prefs.marketing_enabled ? "checked" : ""}><span class="switch-slider"></span></label></div>
    <h4 style="margin:18px 0 4px;font-size:13px">Catégories in-app optionnelles</h4>
    ${OPTIONAL_IN_APP_CATEGORIES.map((c) => `<div class="settings-section" data-category-pref="${esc(c)}"><div><strong>${esc(NOTIFICATION_CATEGORY_FR[c] || c)}</strong><p>Afficher ces notifications dans votre centre in-app.</p></div><label class="switch"><input type="checkbox" data-category-input ${catPrefs[c]?.in_app === false ? "" : "checked"}><span class="switch-slider"></span></label></div>`).join("")}
    <h4 style="margin:18px 0 4px;font-size:13px">Appareils push enregistrés</h4>
    ${devicesHtml}
  `;

  async function save() {
    if (_prefsSaveInFlight) { _prefsSavePending = true; return; }
    _prefsSaveInFlight = true;
    host.querySelectorAll("[data-channel-input], [data-category-input]").forEach((i) => { i.disabled = true; });
    const val = (k) => host.querySelector(`[data-channel="${k}"] [data-channel-input]`)?.checked;
    const nextCategoryPreferences = { ...catPrefs };
    OPTIONAL_IN_APP_CATEGORIES.forEach((c) => {
      const checked = host.querySelector(`[data-category-pref="${c}"] [data-category-input]`)?.checked;
      nextCategoryPreferences[c] = { ...(nextCategoryPreferences[c] || {}), in_app: !!checked };
    });
    try {
      await updateMyNotificationPreferences({
        emailEnabled: val("email"), smsEnabled: val("sms"), whatsappEnabled: val("whatsapp"), pushEnabled: val("push"),
        marketingEnabled: val("marketing"), categoryPreferences: nextCategoryPreferences,
      });
      showToast("Préférences de notifications enregistrées ✓");
    } catch (err) {
      showToast(notificationErrorMessageFr(err?.message, "Impossible d'enregistrer ces préférences."), "red");
    } finally {
      _prefsSaveInFlight = false;
      if (_prefsSavePending) { _prefsSavePending = false; await save(); }
      else { await renderNotificationPreferences(); } // re-fetch l'état serveur, dernière action gagnante
    }
  }
  host.querySelectorAll("[data-channel-input], [data-category-input]").forEach((input) => input.addEventListener("change", save));
  host.querySelectorAll("[data-remove-device]").forEach((btn) => btn.addEventListener("click", async () => {
    const row = btn.closest("[data-device]"); btn.disabled = true;
    try { await unregisterMyNotificationDevice(row.dataset.device); await renderNotificationPreferences(); showToast("Appareil désactivé ✓"); }
    catch (err) { btn.disabled = false; showToast(notificationErrorMessageFr(err?.message, "Impossible de désactiver cet appareil."), "red"); }
  }));
}

async function pageSettings(){
  const form=document.querySelector("#settingsForm");if(!form)return;const ui=getUiPreferences();
  form.compact_grid.checked=!!ui.compactGrid;form.reduce_motion.checked=!!ui.reduceMotion;form.recent_tracking.checked=ui.recentTracking!==false;form.browser_notifications.checked=!!ui.browserNotifications;
  form.compact_grid.addEventListener("change",()=>setUiPreferences({compactGrid:form.compact_grid.checked}));form.reduce_motion.addEventListener("change",()=>setUiPreferences({reduceMotion:form.reduce_motion.checked}));form.recent_tracking.addEventListener("change",()=>setUiPreferences({recentTracking:form.recent_tracking.checked}));form.browser_notifications.addEventListener("change",async()=>{try{await setBrowserNotificationsEnabled(form.browser_notifications.checked)}catch(err){form.browser_notifications.checked=false;setUiPreferences({browserNotifications:false});showToast(err.message.includes("denied")?"Permission navigateur refusée":"Notifications navigateur non disponibles","red")}});
  await renderNotificationPreferences();
}

async function pageRecent(){const host=document.querySelector("#recentProductsHost");if(!host)return;const ids=getRecentlyViewedIds();if(!ids.length){host.innerHTML=empty("Aucun produit récent","Les produits consultés apparaîtront ici.");refreshIcons();return}host.innerHTML=loading();try{const products=await getProductsByIds(ids);const by=new Map(products.map(p=>[p.id,p]));const ordered=ids.map(id=>by.get(id)).filter(Boolean);host.innerHTML=ordered.length?`<div class="products-grid">${ordered.map(p=>productMiniCard(p)).join("")}</div>`:empty("Aucun produit récent","Les anciens produits consultés ne sont plus visibles.");document.querySelector("#clearRecent")?.addEventListener("click",()=>{clearRecentlyViewed();host.innerHTML=empty("Historique effacé","Les prochains produits consultés apparaîtront ici.");refreshIcons()})}catch{host.innerHTML=errorBox("Impossible de charger les produits récents.")}}

function pageSavedSearches(){const host=document.querySelector("#savedSearchesHost");if(!host)return;const render=()=>{const rows=getSavedSearches();host.innerHTML=rows.length?rows.map(r=>`<div class="settings-section" data-saved-search="${esc(r.id)}"><div><strong>${esc(r.query||r.categoryLabel||"Recherche")}</strong><p>${esc(r.categoryLabel||"Toutes catégories")} · ${esc(r.sort||"default")} · ${esc(fmtDate(r.createdAt))}</p></div><div class="toolbar-group"><a class="btn btn-blue btn-sm" href="${esc(savedSearchUrl(r))}">Ouvrir</a><button class="btn btn-ghost btn-sm" data-remove-search type="button">Supprimer</button></div></div>`).join(""):empty("Aucune recherche sauvegardée","Depuis le catalogue, sauvegardez une recherche pour la retrouver ici.");refreshIcons();host.querySelectorAll("[data-remove-search]").forEach(b=>b.addEventListener("click",()=>{removeSavedSearch(b.closest("[data-saved-search]").dataset.savedSearch);render()}))};render();document.querySelector("#clearSearches")?.addEventListener("click",()=>{clearSavedSearches();render()})}

function pageAddresses(){const host=document.querySelector("#addressesHost"),form=document.querySelector("#addressForm");if(!host||!form)return;attachGeoHints(form);const msgBox=document.querySelector("#addressFormMsg");const showFormMsg=(t)=>{if(msgBox){msgBox.textContent=t;msgBox.style.display=t?"":"none"}};const render=()=>{const rows=getAddresses();host.innerHTML=rows.length?rows.map(a=>`<div class="portal-card" data-address-id="${esc(a.id)}"><div class="toolbar"><div><strong>${esc(a.label)} ${a.isDefault?'<span class="badge blue">Par défaut</span>':''}</strong><div class="table-secondary">${esc(a.fullName)} · ${esc(a.phone)}</div></div><div class="toolbar-group">${a.isDefault?'':`<button class="btn btn-ghost btn-sm" data-default-address type="button">Définir par défaut</button>`}<button class="btn btn-outline-red btn-sm" data-delete-address type="button">Supprimer</button></div></div><p class="muted" style="font-size:11px;margin:6px 0 0">${esc(addressLabel(a))}</p></div>`).join(""):empty("Aucune adresse enregistrée","Ajoutez une adresse pour préremplir plus vite le checkout sur cet appareil.");refreshIcons();host.querySelectorAll("[data-delete-address]").forEach(b=>b.addEventListener("click",()=>{removeAddress(b.closest("[data-address-id]").dataset.addressId);render()}));host.querySelectorAll("[data-default-address]").forEach(b=>b.addEventListener("click",()=>{setDefaultAddress(b.closest("[data-address-id]").dataset.addressId);render()}))};render();form.addEventListener("submit",e=>{e.preventDefault();showFormMsg("");const candidate={address_line1:form.address_line1.value,address_line2:form.address_line2.value,commune:form.commune.value,department:form.department.value,landmark:form.landmark.value};const{valid,errors}=validateStandardAddress(candidate);if(!valid){showFormMsg(errors.address_line1||errors.commune||errors.department||errors.coordinates||"Adresse incomplète.");return}try{saveAddress({label:form.label.value,fullName:form.full_name.value,phone:form.phone.value,...candidate,notes:form.notes.value,isDefault:form.is_default.checked});form.reset();render();showToast("Adresse enregistrée ✓")}catch{showFormMsg("Adresse requise.")}})}


// Pour un compte connecté (cette page est dans le portail client, donc
// toujours authentifiée), la liste des boutiques suivies vient de
// list_my_notification_subscriptions_v1 — jamais du localStorage, qui ne
// reflète que l'expérience anonyme sur cet appareil.
async function pageFollowing(){
  const host=document.querySelector("#followingHost");if(!host)return;
  host.innerHTML=loading("Chargement de vos boutiques…");
  try{
    const ids=await getFollowedMerchantIdsAuthoritative();
    if(!ids.length){host.innerHTML=empty("Aucune boutique suivie","Depuis une page boutique, suivez un marchand pour recevoir ses notifications ici.");refreshIcons();return}
    const rows=await getPublicMerchantsByIds(ids);const map=new Map(rows.map(x=>[x.id,x]));const ordered=ids.map(id=>map.get(id)).filter(Boolean);
    host.innerHTML=ordered.length?`<div class="quick-grid">${ordered.map(m=>`<article class="quick-card" data-follow-card="${esc(m.id)}"><div class="quick-icon"><i data-lucide="store"></i></div><div style="flex:1"><strong>${esc(m.shop_name)}</strong><small>${esc(m.merchant_type||"Marchand")} · Confiance ${esc(m.trust_score??"—")}/100</small></div><div class="toolbar-group"><a class="btn btn-blue btn-sm" href="store.html?merchant=${encodeURIComponent(m.id)}">Boutique</a><button class="btn btn-ghost btn-sm" data-unfollow="${esc(m.id)}" type="button">Ne plus suivre</button></div></article>`).join("")}</div>`:empty("Aucune boutique suivie","Les boutiques suivies ne sont plus publiques.");
    host.querySelectorAll("[data-unfollow]").forEach(b=>b.addEventListener("click",async()=>{
      b.disabled=true;
      try{
        await setMerchantFollowRemote(b.dataset.unfollow,false);
        b.closest("[data-follow-card]")?.remove();
        if(!host.querySelector("[data-follow-card]")){host.innerHTML=empty("Aucune boutique suivie","Vous ne suivez plus aucune boutique.");refreshIcons()}
      }catch(err){b.disabled=false;showToast(notificationErrorMessageFr(err?.message,"Impossible de retirer ce suivi."),"red")}
    }));
    refreshIcons();
  }catch(err){host.innerHTML=errorBox(notificationErrorMessageFr(err?.message,"Impossible de charger les boutiques suivies."))}
}

async function pageSecurity(session){
  const host=document.querySelector("#securityIdentity");if(host)host.innerHTML=`<div class="settings-section"><div><strong>Email de connexion</strong><p>${esc(session?.user?.email||"—")}</p></div><span class="badge green">Compte actif</span></div>`;
  const form=document.querySelector("#passwordForm");if(form)form.addEventListener("submit",async e=>{e.preventDefault();const p1=form.new_password.value,p2=form.confirm_password.value;if(p1!==p2){showToast("Les mots de passe ne correspondent pas","red");return}const btn=form.querySelector("button[type=submit]");btn.disabled=true;try{await updateMyPassword(p1);form.reset();showToast("Mot de passe mis à jour ✓")}catch(err){showToast(err?.message?.includes("weak")?"Utilisez au moins 8 caractères":"Impossible de modifier le mot de passe","red")}finally{btn.disabled=false}});
  document.querySelector("#securityLogout")?.addEventListener("click",async()=>{try{await signOut();location.href="index.html"}catch{showToast("Déconnexion impossible","red")}});
}

async function pageOrderDetail(){
  const host=document.querySelector("#orderDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";
  if(!id){host.innerHTML=empty("Commande introuvable","Aucun identifiant de commande n’a été fourni.");refreshIcons();return}
  host.innerHTML=loading("Chargement de la commande…");
  try{
    const allOrders=await getMyOrders();const order=allOrders.find(o=>o.id===id);
    if(!order){host.innerHTML=empty("Commande introuvable","Cette commande n’est pas disponible dans votre compte.");refreshIcons();return}
    const items=await getOrderItems(id);
    const addr=order.delivery_address&&typeof order.delivery_address==="object"?[order.delivery_address.address,order.delivery_address.city].filter(Boolean).join(", "):"";
    const currency=orderCurrency(order);
    const subtotal=orderAmount(order,"subtotal_amount","subtotal_htg"),discount=orderAmount(order,"payment_discount_amount","payment_discount_htg"),shipping=orderAmount(order,"shipping_amount","shipping_htg"),total=orderAmount(order,"total_amount","total_htg");
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>Commande #${esc(String(order.id).slice(0,8))}${envBadge(order.environment)}</h3><div class="table-secondary">${esc(fmtDate(order.created_at))} · ${esc(currency)}</div></div><div class="toolbar-group">${statusBadge(order.status,ORDER_STATUS_FR)} ${statusBadge(order.payment_status,PAY_STATUS_FR)}</div></div><div class="settings-section"><div><strong>Livraison</strong><p>${frLabel(DELIVERY_FR,order.delivery_type)}${addr?` — ${esc(addr)}`:order.pickup_point_code?` — ${esc(order.pickup_point_code)}`:""}</p></div></div>${items.map(it=>{const c=orderCurrency(it);return `<div class="settings-section"><div><strong>${esc(it.product_name||"Produit")}</strong><p>Qté ${esc(it.quantity)} · ${esc(it.pricing_tier==="wholesale"?"Gros":"Détail")} · PU ${money(orderAmount(it,"unit_price_amount","unit_price_htg"),c)}</p></div><strong>${money(orderAmount(it,"line_total_amount","line_total_htg"),c)}</strong></div>`}).join("")||'<p class="muted">Aucun article.</p>'}<div class="settings-section"><div><strong>Sous-total</strong></div><strong>${money(subtotal,currency)}</strong></div><div class="settings-section"><div><strong>Remise paiement</strong><p>${esc(order.payment_method||"—")}</p></div><strong>${discount?"− "+money(discount,currency):money(0,currency)}</strong></div><div class="settings-section"><div><strong>Livraison</strong></div><strong>${money(shipping,currency)}</strong></div><div class="settings-section"><div><strong>Total final</strong></div><strong>${money(total,currency)}</strong></div></div>`;
  }catch{host.innerHTML=errorBox("Impossible de charger cette commande.")}
}

export async function initClientPortal(){
  const page=document.body.dataset.clientPage;if(!page)return;
  let session=await getSession();if(!session?.user){authGate(true);onAuthChange(s=>{if(s?.user)location.reload()});return}authGate(false);
  let profile=null;try{profile=await getMyProfile()}catch{}
  fillPortalIdentity(session,profile);
  if(page==="profile")await pageProfile(profile);
  else if(page==="orders")await pageOrders();
  else if(page==="wishlist")await pageWishlist();
  else if(page==="notifications")await pageNotifications();
  else if(page==="settings")await pageSettings();
  else if(page==="recent")await pageRecent();
  else if(page==="saved-searches")pageSavedSearches();
  else if(page==="addresses")pageAddresses();
  else if(page==="following")await pageFollowing();
  else if(page==="security")await pageSecurity(session);
  else if(page==="order-detail")await pageOrderDetail();
  refreshIcons();
}
