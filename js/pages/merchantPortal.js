import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { getMyMerchant, getMyProducts, setProductStock, getMerchantOrders, getMerchantOrderItems, getOrdersByIds, nextOrderStatus, updateMerchantOrderStatus, updateMyMerchantProfile, createProduct, updateProductContent, getVariantedProductIds, getProductVariants } from "../services/merchantCenter.js";
import { getCategories } from "../services/catalog.js";
import { getMerchantProductEvents } from "../services/analytics.js";
import { getFinancialDashboard } from "../services/merchantFinance.js";
import {
  listMyNotifications, markMyNotificationRead, markAllMyNotificationsRead,
  createMyMerchantNotificationCampaign, listMyNotificationCampaigns, cancelMyNotificationCampaign,
  getMyMerchantNotificationCampaignPreview, campaignCreationResultMessageFr,
  CAMPAIGN_STATUS_FR, isSafeInternalActionPath, notificationErrorMessageFr,
} from "../services/notifications.js";
import { openAuthModal } from "../ui/authModal.js";
import { showToast } from "../ui/toast.js";
import { refreshNotificationBadgeNow } from "../ui/shell.js";
import {
  getPromotionCapabilities, createMyPromotion, updateMyPromotion, setMyPromotionScope,
  setMyPromotionStatus, listMyPromotions, getMyPromotion,
  PROMOTION_STATUS_FR, PROMOTION_SCOPE_FR, PROMOTION_DISCOUNT_TYPE_FR, PROMOTION_MODE_FR,
  promotionErrorMessageFr, isValidPromotionCode, normalizePromotionCode,
} from "../services/promotions.js";
import {
  getMarketplaceAdsCapabilities, createMyAdCampaign, listMyAdCampaigns, getMyAdCampaignDashboard,
  startMyAdCampaign, pauseMyAdCampaign, cancelMyAdCampaign,
  AD_CAMPAIGN_STATUS_FR, AD_FUNDING_STATUS_FR, AD_PLACEMENT_FR, adsErrorMessageFr,
} from "../services/ads.js";
import { getMyAccessContext, merchantSpaceIsReachable } from "../services/access.js";
import { merchantBlockedHtml, merchantBannerHtml } from "../ui/merchantAccess.js";
import { renderMerchantWalletWidget } from "../ui/merchantWalletWidget.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmtDate=(v)=>{const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})};
const loading=(t="Chargement…")=>`<div class="loading-state">${esc(t)}</div>`;
const errorBox=(t)=>`<div class="error-state">${esc(t)}</div>`;
const rowCurrency=(row)=>String(row?.currency||"HTG").toUpperCase()==="USD"?"USD":"HTG";
const rowAmount=(row,generic,legacy)=>Number(row?.[generic]??row?.[legacy]??0)||0;
const empty=(title,text)=>`<div class="empty-state"><div class="empty-icon"><i data-lucide="store"></i></div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
const badge=(s)=>{const k=String(s||"").toLowerCase(),c=/active|approved|ready|handed|paid/.test(k)?"green":/reject|cancel|suspend|closed/.test(k)?"red":/pending|new|prepar|accepted/.test(k)?"amber":"blue",label=k==="approved"?"Vérifié par VinHT":k==="pending"?"À vérifier":k==="rejected"?"Retiré par VinHT":s;return `<span class="badge ${c}">${esc(label||"—")}</span>`};

function gate(kind="auth"){
  const g=document.querySelector("[data-merchant-gate]"),c=document.querySelector("[data-merchant-content]");if(g)g.hidden=false;if(c)c.hidden=true;
  if(g){g.innerHTML=kind==="merchant"?`<div class="empty-state"><div class="empty-icon"><i data-lucide="store"></i></div><h3>Espace marchand non activé</h3><p>Votre compte n’est pas encore lié à une boutique marchand active.</p><a class="btn btn-blue" href="../merchant.html">Devenir marchand</a></div>`:`<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous pour ouvrir votre espace marchand.</p><button class="btn btn-blue" type="button" data-login>Se connecter</button></div>`;g.querySelector("[data-login]")?.addEventListener("click",()=>openAuthModal("login"));refreshIcons()}
}
function showContent(){const g=document.querySelector("[data-merchant-gate]"),c=document.querySelector("[data-merchant-content]");if(g)g.hidden=true;if(c)c.hidden=false}
function gateHtml(html){const g=document.querySelector("[data-merchant-gate]"),c=document.querySelector("[data-merchant-content]");if(g){g.hidden=false;g.innerHTML=html;g.querySelector("[data-merchant-access-retry]")?.addEventListener("click",()=>initMerchantPortal());}if(c)c.hidden=true;refreshIcons();}
function showBanner(html){const c=document.querySelector("[data-merchant-content]");if(!c)return;c.querySelector("[data-merchant-banner]")?.remove();if(!html)return;const d=document.createElement("div");d.setAttribute("data-merchant-banner","");d.innerHTML=html;c.prepend(d);refreshIcons();}
function fillIdentity(m){document.querySelectorAll("[data-merchant-name]").forEach(x=>x.textContent=m.shop_name||"Ma boutique");document.querySelectorAll("[data-merchant-type]").forEach(x=>x.textContent=m.merchant_type||"marchand");document.querySelectorAll("[data-merchant-initial]").forEach(x=>x.textContent=(m.shop_name||"V").charAt(0).toUpperCase())}

let _mpWalletDestroy=null;
async function dashboard(m){const host=document.querySelector("#merchantDashboardHost");if(!host)return;_mpWalletDestroy?.();_mpWalletDestroy=null;host.innerHTML=loading();try{const [products,orders,financial]=await Promise.all([getMyProducts(m.id),getMerchantOrders(m.id),getFinancialDashboard()]);const sum=financial?.summary||{},pending=orders.filter(o=>["new","accepted","preparing","ready"].includes(o.status)).length;host.innerHTML=`<div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Produits</div><div class="value">${products.length}</div><div class="delta">${products.filter(p=>p.approval_status==="approved").length} approuvés</div></div><div class="stat-card red-stat"><div class="label">Commandes</div><div class="value">${orders.length}</div><div class="delta">${pending} à traiter</div></div><div class="stat-card blue-stat"><div class="label">Ventes payées — HTG</div><div class="value" style="font-size:19px">${money(sum.gross_sales_htg)}</div><div class="delta">Commandes réellement payées</div></div><div class="stat-card green-stat"><div class="label">Net marchand — HTG</div><div class="value" style="font-size:19px">${money(sum.merchant_net_htg)}</div><div class="delta">Après commission et frais VinHT</div></div><div class="stat-card amber-stat"><div class="label">En attente / protégé</div><div class="value" style="font-size:19px">${money(sum.payout_pending_htg)}</div><div class="delta">En attente de libération</div></div><div class="stat-card green-stat"><div class="label">Envoyé vers FlexiCash</div><div class="value" style="font-size:19px">${money(sum.payout_sent_flexicash_htg)}</div><div class="delta">Transferts réellement effectués</div></div><div class="stat-card red-stat"><div class="label">Commission VinHT — HTG</div><div class="value" style="font-size:19px">${money(sum.commission_5pct_htg)}</div><div class="delta">Sur ventes payées</div></div><div class="stat-card amber-stat"><div class="label">Frais par unité — HTG</div><div class="value" style="font-size:19px">${money(sum.per_item_fees_htg)}</div><div class="delta">Sur unités vendues payées</div></div></div><div class="portal-card" id="mpWalletHost"></div><div class="quick-grid"><a class="quick-card" href="products.html"><div class="quick-icon"><i data-lucide="package-plus"></i></div><div><strong>Gérer les produits</strong><small>Stock, prix, statuts</small></div></a><a class="quick-card" href="orders.html"><div class="quick-icon"><i data-lucide="clipboard-list"></i></div><div><strong>Traiter les commandes</strong><small>Avancer les statuts</small></div></a><a class="quick-card" href="analytics.html"><div class="quick-icon"><i data-lucide="chart-no-axes-combined"></i></div><div><strong>Voir les analytics</strong><small>Vues, clics, wishlist</small></div></a><a class="quick-card" href="settings.html"><div class="quick-icon"><i data-lucide="settings-2"></i></div><div><strong>Paramètres boutique</strong><small>Nom, WhatsApp, zone</small></div></a></div><div class="portal-card"><div class="toolbar"><div><h3>Produits récents</h3></div><a class="btn btn-ghost btn-sm" href="products.html">Tout voir</a></div>${products.slice(0,5).map(p=>`<div class="settings-section"><div><strong>${esc(p.name)}</strong><p>${money(p.retail_price,p.currency)} · Stock ${esc(p.stock)}</p></div>${badge(p.approval_status)}</div>`).join("")||'<p class="muted">Aucun produit.</p>'}</div>`;refreshIcons();_mpWalletDestroy=renderMerchantWalletWidget(document.querySelector("#mpWalletHost"))}catch{host.innerHTML=errorBox("Impossible de charger le dashboard marchand.")}}

// Produits variantés (Feature #5) : le stock réel vit dans les variantes, pas
// dans products.stock. On détecte ces produits par lecture batch (RLS) de
// product_variants — jamais un second système de variantes, jamais un calcul
// de stock côté navigateur. En cas d'échec de détection, on reste fail-closed
// (pas d'édition du stock parent) plutôt que de supposer "sans variantes".
async function productsPage(m){const host=document.querySelector("#merchantProductsHost");if(!host)return;host.innerHTML=loading("Chargement de vos produits…");try{const rows=await getMyProducts(m.id);if(!rows.length){host.innerHTML=empty("Aucun produit","Ajoutez votre premier produit depuis le centre marchand.");refreshIcons();return}
  host.innerHTML=`<div class="toolbar"><div class="toolbar-group"><input class="input" id="merchantProductSearch" placeholder="Rechercher un produit"><select id="merchantProductStatus"><option value="">Tous statuts</option><option value="approved">Approuvés</option><option value="pending">En attente</option><option value="rejected">Rejetés</option></select></div><a class="btn btn-blue" href="../merchant-center.html#products">Ajouter / modifier</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Prix</th><th>Stock</th><th>Validation</th><th>Visible</th><th></th></tr></thead><tbody id="merchantProductsBody"></tbody></table></div>`;
  const body=host.querySelector("#merchantProductsBody");
  let variantSet=null,variantError=false;
  const loadVariants=async()=>{variantError=false;try{variantSet=await getVariantedProductIds(rows.map(r=>r.id))}catch{variantSet=null;variantError=true}};
  const stockCell=(p)=>{
    if(variantError)return `<div class="table-secondary">${esc(p.stock??0)}</div><div class="table-secondary" style="color:var(--red,#f31938)">Statut variantes indisponible</div><button class="btn btn-ghost btn-sm" type="button" data-variant-retry="${esc(p.id)}">Réessayer</button>`;
    if(variantSet&&variantSet.has(p.id))return `<div><strong>${esc(p.stock??0)}</strong> <span class="badge">Géré par variantes</span></div><a class="btn btn-ghost btn-sm" href="../merchant-center.html#products" style="margin-top:4px;display:inline-block">Gérer les variantes</a>`;
    return `<div class="toolbar-group"><input class="input" style="width:88px" type="number" min="0" value="${esc(p.stock)}" data-stock-input><button class="btn btn-ghost btn-sm" type="button" data-save-stock="${esc(p.id)}">Sauver</button></div>`;
  };
  const draw=()=>{const q=(host.querySelector("#merchantProductSearch").value||"").toLowerCase(),s=host.querySelector("#merchantProductStatus").value;const list=rows.filter(p=>(!q||p.name.toLowerCase().includes(q)||String(p.sku||"").toLowerCase().includes(q))&&(!s||p.approval_status===s));body.innerHTML=list.map(p=>`<tr><td><div class="table-primary">${esc(p.name)}</div><div class="table-secondary">${esc(p.sku||p.slug||"")}</div></td><td>${money(p.retail_price,p.currency)}</td><td>${stockCell(p)}</td><td>${badge(p.approval_status)}</td><td>${p.is_active?'<span class="badge green">Oui</span>':'<span class="badge">Non</span>'}</td><td><a class="btn btn-ghost btn-sm" href="../merchant-center.html#products">Éditer</a></td></tr>`).join("")||`<tr><td colspan="6">${empty("Aucun résultat","Modifiez vos filtres.")}</td></tr>`;body.querySelectorAll("[data-save-stock]").forEach(btn=>btn.addEventListener("click",async()=>{const input=btn.parentElement.querySelector("[data-stock-input]");btn.disabled=true;try{await setProductStock(btn.dataset.saveStock,input.value);const p=rows.find(x=>x.id===btn.dataset.saveStock);if(p)p.stock=parseInt(input.value,10)||0;showToast("Stock mis à jour ✓")}catch{showToast("Impossible de modifier le stock","red")}finally{btn.disabled=false}}));body.querySelectorAll("[data-variant-retry]").forEach(btn=>btn.addEventListener("click",async()=>{btn.disabled=true;await loadVariants();draw()}))};
  await loadVariants();draw();host.querySelector("#merchantProductSearch").addEventListener("input",draw);host.querySelector("#merchantProductStatus").addEventListener("change",draw)}catch{host.innerHTML=errorBox("Impossible de charger vos produits.")}}

async function ordersPage(m){
  const host=document.querySelector("#merchantOrdersHost");if(!host)return;host.innerHTML=loading("Chargement des commandes…");
  try{
    const orderRows=await getMerchantOrders(m.id);
    if(!orderRows.length){host.innerHTML=empty("Aucune commande","Les commandes contenant vos produits apparaîtront ici.");refreshIcons();return}
    const [items,parents]=await Promise.all([getMerchantOrderItems(orderRows.map(o=>o.id)),getOrdersByIds(orderRows.map(o=>o.order_id))]);
    const pmap=new Map(parents.map(o=>[o.id,o])),imap=new Map();
    for(const it of items){if(!imap.has(it.merchant_order_id))imap.set(it.merchant_order_id,[]);imap.get(it.merchant_order_id).push(it)}
    host.innerHTML=orderRows.map(o=>{const customer=pmap.get(o.order_id)||{},its=imap.get(o.id)||[],next=nextOrderStatus(o.status),currency=rowCurrency(o);return `<div class="portal-card" data-mo="${esc(o.id)}"><div class="toolbar"><div><strong>Commande #${esc(String(o.order_id).slice(0,8))}</strong>${String(o.environment||"").toLowerCase()==="demo"?' <span class="badge amber">MODE DEMO</span>':""}<div class="table-secondary">${esc(customer.full_name||"Client")} · ${esc(fmtDate(o.created_at))} · ${esc(currency)}</div></div><div class="toolbar-group">${badge(o.status)}${next?`<button class="btn btn-blue btn-sm" type="button" data-next-status="${esc(next)}">Passer à ${esc(next)}</button>`:""}</div></div>${its.map(it=>{const c=rowCurrency(it);return `<div class="settings-section"><div><strong>${esc(it.product_name)}</strong><p>Qté ${esc(it.quantity)} · ${esc(it.pricing_tier)}</p></div><strong>${money(rowAmount(it,"line_total_amount","line_total_htg"),c)}</strong></div>`}).join("")}<div class="settings-section"><div><strong>Total marchand</strong><p>Commission et frais calculés côté serveur.</p></div><strong>${money(rowAmount(o,"subtotal_amount","subtotal_htg"),currency)}</strong></div></div>`}).join("");
    host.querySelectorAll("[data-next-status]").forEach(btn=>btn.addEventListener("click",async()=>{const card=btn.closest("[data-mo]");btn.disabled=true;try{await updateMerchantOrderStatus(card.dataset.mo,btn.dataset.nextStatus);showToast("Statut mis à jour ✓");await ordersPage(m)}catch{showToast("Transition de statut refusée","red");btn.disabled=false}}))
  }catch{host.innerHTML=errorBox("Impossible de charger les commandes.")}
}

async function revenuePage(m){
  const host=document.querySelector("#merchantRevenueHost");if(!host)return;host.innerHTML=loading();
  try{
    const [rows,financial]=await Promise.all([getMerchantOrders(m.id),getFinancialDashboard()]);
    const parents=await getOrdersByIds(rows.map(o=>o.order_id));
    const paidIds=new Set(parents.filter(o=>String(o.payment_status||"").toLowerCase()==="paid").map(o=>String(o.id)));
    const usdPaid=rows.filter(o=>rowCurrency(o)==="USD"&&paidIds.has(String(o.order_id)));
    const usd={gross:usdPaid.reduce((s,o)=>s+rowAmount(o,"subtotal_amount","subtotal_htg"),0),commission:usdPaid.reduce((s,o)=>s+rowAmount(o,"platform_commission_amount","platform_commission_htg"),0),fees:usdPaid.reduce((s,o)=>s+rowAmount(o,"per_item_fee_amount","per_item_fee_htg"),0),payout:usdPaid.reduce((s,o)=>s+rowAmount(o,"payout_amount","payout_amount_htg"),0),count:usdPaid.length};
    const sum=financial?.summary||{};
    host.innerHTML=`<div class="portal-card"><div class="section-head"><div><h2>Revenus sur ventes payées — HTG</h2><small>Les agrégats HTG viennent du dashboard financier autoritaire. Les montants USD restent séparés, sans conversion.</small></div></div><div class="stat-grid" style="margin-top:14px"><div class="stat-card blue-stat"><div class="label">Ventes brutes — HTG</div><div class="value" style="font-size:19px">${money(sum.gross_sales_htg,"HTG")}</div></div><div class="stat-card green-stat"><div class="label">Net marchand — HTG</div><div class="value" style="font-size:19px">${money(sum.merchant_net_htg,"HTG")}</div></div><div class="stat-card red-stat"><div class="label">Commission VinHT — HTG</div><div class="value" style="font-size:19px">${money(sum.commission_5pct_htg,"HTG")}</div></div><div class="stat-card amber-stat"><div class="label">Frais fixes — HTG</div><div class="value" style="font-size:19px">${money(sum.per_item_fees_htg,"HTG")}</div></div></div></div><div class="portal-card"><div class="section-head"><div><h2>Revenus sur ventes payées — USD</h2><small>Sommes USD uniquement. Aucun taux de change n'est appliqué.</small></div></div><div class="stat-grid" style="margin-top:14px"><div class="stat-card blue-stat"><div class="label">Commandes payées — USD</div><div class="value">${usd.count}</div></div><div class="stat-card blue-stat"><div class="label">Ventes brutes — USD</div><div class="value" style="font-size:19px">${money(usd.gross,"USD")}</div></div><div class="stat-card red-stat"><div class="label">Commission VinHT — USD</div><div class="value" style="font-size:19px">${money(usd.commission,"USD")}</div></div><div class="stat-card amber-stat"><div class="label">Frais fixes — USD</div><div class="value" style="font-size:19px">${money(usd.fees,"USD")}</div></div><div class="stat-card green-stat"><div class="label">Payout marchand — USD</div><div class="value" style="font-size:19px">${money(usd.payout,"USD")}</div></div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Commande</th><th>Devise</th><th>Sous-total</th><th>Commission</th><th>Frais</th><th>Payout</th><th>Statut payout</th></tr></thead><tbody>${rows.map(o=>{const c=rowCurrency(o);return `<tr><td>${esc(fmtDate(o.created_at))}</td><td>#${esc(String(o.order_id).slice(0,8))}${String(o.environment||"").toLowerCase()==="demo"?' <span class="badge amber">DEMO</span>':""}</td><td><strong>${esc(c)}</strong></td><td>${money(rowAmount(o,"subtotal_amount","subtotal_htg"),c)}</td><td>${money(rowAmount(o,"platform_commission_amount","platform_commission_htg"),c)}</td><td>${money(rowAmount(o,"per_item_fee_amount","per_item_fee_htg"),c)}</td><td><strong>${money(rowAmount(o,"payout_amount","payout_amount_htg"),c)}</strong></td><td>${payoutStateHtml(o)}${o.payout_reference?`<div class="table-secondary">Réf ${esc(o.payout_reference)}</div>`:""}${o.payout_paid_at?`<div class="table-secondary">${esc(fmtDate(o.payout_paid_at))}</div>`:""}</td></tr>`}).join("")}</tbody></table></div>`;
  }catch{host.innerHTML=errorBox("Impossible de charger les revenus.")}
}

async function analyticsPage(m){const host=document.querySelector("#merchantAnalyticsHost");if(!host)return;host.innerHTML=loading();try{const [events,financial]=await Promise.all([getMerchantProductEvents(m.id),getFinancialDashboard()]);const counts={view:0,click:0,add_to_cart:0,wishlist:0},sum=financial?.summary||{};events.forEach(e=>{if(counts[e.event_type]!==undefined)counts[e.event_type]++});const max=Math.max(1,...Object.values(counts));host.innerHTML=`<div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Vues</div><div class="value">${counts.view}</div></div><div class="stat-card red-stat"><div class="label">Clics</div><div class="value">${counts.click}</div></div><div class="stat-card amber-stat"><div class="label">Ajouts panier</div><div class="value">${counts.add_to_cart}</div></div><div class="stat-card green-stat"><div class="label">Wishlist</div><div class="value">${counts.wishlist}</div></div></div><div class="portal-card"><h3>Interactions enregistrées</h3><div class="chart-bars">${Object.entries(counts).map(([k,v],i)=>`<div class="chart-bar ${i%2?'redbar':''}" style="height:${Math.max(8,Math.round(v/max*100))}%"><span>${esc(k)} · ${v}</span></div>`).join("")}</div><p class="chart-note">Données issues de <code>product_events</code>. Elles restent minimales jusqu’à l’intégration analytics complète.</p></div><div class="portal-card"><div class="section-head"><div><h2>Performance financière</h2><small>Une vente payée reste comptée même lorsque son payout est protégé temporairement.</small></div></div><div class="stat-grid" style="margin-top:14px"><div class="stat-card blue-stat"><div class="label">Ventes payées — HTG</div><div class="value">${esc(sum.paid_orders_count||0)}</div></div><div class="stat-card blue-stat"><div class="label">CA brut payé — HTG</div><div class="value" style="font-size:19px">${money(sum.gross_sales_htg)}</div></div><div class="stat-card green-stat"><div class="label">Net marchand — HTG</div><div class="value" style="font-size:19px">${money(sum.merchant_net_htg)}</div></div><div class="stat-card amber-stat"><div class="label">Fonds en attente / protégés</div><div class="value" style="font-size:19px">${money(sum.payout_pending_htg)}</div></div><div class="stat-card green-stat"><div class="label">Payouts envoyés</div><div class="value" style="font-size:19px">${money(sum.payout_sent_flexicash_htg)}</div><div class="delta">Transférés vers FlexiCash</div></div></div><p class="muted" style="font-size:11px;margin:10px 0 0">Vente réalisée ≠ argent disponible au retrait. Le solde disponible réel reste dans le wallet FlexiCash.</p></div>`}catch{host.innerHTML=errorBox("Impossible de charger les analytics.")}}

const MERCHANT_NOTIF_PAGE_SIZE = 20;
let _merchNotifRows = [], _merchNotifOffset = 0, _merchNotifHasMore = false, _merchNotifSeq = 0;

function merchantNotificationActionHtml(n) {
  if (!isSafeInternalActionPath(n.action_path)) return "";
  return `<a class="btn btn-outline-blue btn-sm" href="../${esc(n.action_path.replace(/^\//, ""))}">Voir</a>`;
}

async function runMerchantNotificationsSearch(reset) {
  const host = document.querySelector("#merchantNotificationsHost");
  const loadMoreWrap = document.querySelector("#merchantNotificationsLoadMoreWrap");
  if (!host) return;
  const seq = ++_merchNotifSeq;
  const offset = reset ? 0 : _merchNotifOffset;
  if (reset) { _merchNotifOffset = 0; _merchNotifRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#merchNotifLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listMyNotifications({ limit: MERCHANT_NOTIF_PAGE_SIZE, offset });
    if (seq !== _merchNotifSeq) return;
    const merged = reset ? result.rows : _merchNotifRows.concat(result.rows);
    const seen = new Set();
    _merchNotifRows = merged.filter((r) => { const id = String(r?.id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _merchNotifHasMore = result.hasMore;
    _merchNotifOffset = offset + result.rows.length;
    if (!_merchNotifRows.length) { host.innerHTML = empty("Aucune notification", "Les alertes liées à votre compte apparaîtront ici."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = `<div class="notification-list">${_merchNotifRows.map((n) => `<article class="notification-item level-${esc(n.level)} ${n.is_read ? "" : "unread"}" data-notification="${esc(n.id)}"><div class="notification-dot"><i data-lucide="bell"></i></div><div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><div class="notification-meta">${esc(fmtDate(n.created_at))}</div></div><div class="toolbar-group">${merchantNotificationActionHtml(n)}${n.is_read ? "" : `<button class="btn btn-ghost btn-sm" data-read type="button">Lu</button>`}</div></article>`).join("")}</div>`;
    refreshIcons();
    host.querySelectorAll("[data-read]").forEach((b) => b.addEventListener("click", async () => {
      const item = b.closest("[data-notification]"); b.disabled = true;
      try { await markMyNotificationRead(item.dataset.notification, true); refreshNotificationBadgeNow(); item.classList.remove("unread"); b.remove(); }
      catch (err) { b.disabled = false; showToast(notificationErrorMessageFr(err?.message, "Action impossible"), "red"); }
    }));
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _merchNotifHasMore ? `<button class="btn btn-outline-blue btn-sm" id="merchNotifLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#merchNotifLoadMore")?.addEventListener("click", () => runMerchantNotificationsSearch(false));
    }
  } catch (err) {
    if (seq !== _merchNotifSeq) return;
    host.innerHTML = errorBox(notificationErrorMessageFr(err?.message, "Impossible de charger les notifications."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

const MERCH_CAMPAIGN_PAGE_SIZE = 20;
let _merchCampaignRows = [], _merchCampaignOffset = 0, _merchCampaignHasMore = false, _merchCampaignSeq = 0;

function merchantCampaignRowHtml(c) {
  return `<div class="settings-section" data-campaign="${esc(c.campaign_id)}">
    <div><strong>${esc(c.title)}</strong><p>${esc(c.message)}</p><div class="table-secondary">${badge(c.status)} · ${esc(CAMPAIGN_STATUS_FR[c.status] || c.status)} · ${esc(fmtDate(c.created_at))} · ${esc(c.notifications_created ?? 0)} envoyée(s)</div></div>
    ${c.can_cancel ? `<button class="btn btn-outline-red btn-sm" data-cancel-campaign type="button">Annuler</button>` : ""}
  </div>`;
}

async function runMerchantCampaignsSearch(reset) {
  const host = document.querySelector("#merchantCampaignsHost");
  const loadMoreWrap = document.querySelector("#merchantCampaignsLoadMoreWrap");
  const countBadge = document.querySelector("#merchantCampaignsCount");
  if (!host) return;
  const seq = ++_merchCampaignSeq;
  const offset = reset ? 0 : _merchCampaignOffset;
  if (reset) { _merchCampaignOffset = 0; _merchCampaignRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#merchCampaignLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listMyNotificationCampaigns({ limit: MERCH_CAMPAIGN_PAGE_SIZE, offset });
    if (seq !== _merchCampaignSeq) return;
    const merged = reset ? result.rows : _merchCampaignRows.concat(result.rows);
    const seen = new Set();
    _merchCampaignRows = merged.filter((r) => { const id = String(r?.campaign_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _merchCampaignHasMore = result.hasMore;
    _merchCampaignOffset = offset + result.rows.length;
    if (countBadge) countBadge.textContent = String(result.total ?? _merchCampaignRows.length);
    if (!_merchCampaignRows.length) { host.innerHTML = empty("Aucune campagne", "Vos campagnes envoyées à vos abonnés apparaîtront ici."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = _merchCampaignRows.map(merchantCampaignRowHtml).join("");
    refreshIcons();
    host.querySelectorAll("[data-cancel-campaign]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!window.confirm("Annuler cette campagne ?")) return;
      const row = btn.closest("[data-campaign]"); btn.disabled = true;
      try { await cancelMyNotificationCampaign(row.dataset.campaign); showToast("Campagne annulée ✓"); await runMerchantCampaignsSearch(true); }
      catch (err) { btn.disabled = false; showToast(notificationErrorMessageFr(err?.message, "Impossible d'annuler cette campagne."), "red"); }
    }));
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _merchCampaignHasMore ? `<button class="btn btn-outline-blue btn-sm" id="merchCampaignLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#merchCampaignLoadMore")?.addEventListener("click", () => runMerchantCampaignsSearch(false));
    }
  } catch (err) {
    if (seq !== _merchCampaignSeq) return;
    host.innerHTML = errorBox(notificationErrorMessageFr(err?.message, "Impossible de charger vos campagnes."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

async function notificationsPage(){
  // initMerchantPortal() peut se ré-exécuter (ré-abonnement auth) et donc
  // rappeler notificationsPage() sur les mêmes éléments DOM statiques : un
  // garde "déjà câblé" évite d'empiler des listeners sur #merchantMarkAll /
  // #merchantCampaignForm, ce qui enverrait une même campagne plusieurs fois.
  const markAllBtn = document.querySelector("#merchantMarkAll");
  if (markAllBtn && !markAllBtn.dataset.wired) {
    markAllBtn.dataset.wired = "1";
    markAllBtn.addEventListener("click", async () => {
      try { await markAllMyNotificationsRead(); refreshNotificationBadgeNow(); showToast("Notifications marquées comme lues ✓"); await runMerchantNotificationsSearch(true); }
      catch (err) { showToast(notificationErrorMessageFr(err?.message, "Action impossible"), "red"); }
    });
  }
  // Refresh du preview à l'ouverture de la page (read-only, jamais mutatif) :
  // le marchand voit son quota 24h avant même de remplir le formulaire.
  refreshMerchantCampaignPreview();
  const campaignForm = document.querySelector("#merchantCampaignForm");
  if (campaignForm && !campaignForm.dataset.wired) {
    campaignForm.dataset.wired = "1";
    campaignForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(campaignForm);
      const title = (fd.get("title") || "").trim();
      const message = (fd.get("message") || "").trim();
      const actionPathRaw = (fd.get("action_path") || "").trim();
      const scheduledRaw = fd.get("scheduled_at");
      const msgBox = document.querySelector("#merchantCampaignFormMsg");
      const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
      if (actionPathRaw && !isSafeInternalActionPath(actionPathRaw)) { showMsg("Ce lien n'est pas un chemin VinHT interne valide (ex: /store.html?merchant=...).", false); return; }
      let scheduledAt = null;
      if (scheduledRaw) {
        const d = new Date(scheduledRaw);
        if (Number.isNaN(d.getTime())) { showMsg("Date de planification invalide.", false); return; }
        scheduledAt = d.toISOString();
      }
      const btn = campaignForm.querySelector('button[type="submit"]');
      // Verrou posé dès l'entrée du submit (pas seulement avant create) :
      // sinon deux clics rapides peuvent chacun lancer leur propre preview
      // avant que le premier n'ait eu le temps de désactiver le bouton.
      if (btn.dataset.submitting === "1") return;
      btn.dataset.submitting = "1";
      btn.disabled = true;
      try {
        // Preview obligatoire, read-only, immédiatement avant confirmation —
        // jamais de create Production sans que le marchand ait vu son quota
        // réel et le nombre de destinataires éligibles.
        let preview;
        try { preview = await getMyMerchantNotificationCampaignPreview(); }
        catch (err) { showMsg(notificationErrorMessageFr(err?.message, "Impossible de vérifier votre quota avant l'envoi."), false); return; }
        if (preview.remaining_last_24h <= 0) {
          showMsg(`Limite atteinte : ${preview.used_last_24h}/${preview.daily_limit} campagnes non annulées sur les dernières 24 heures.`, false);
          return;
        }
        const confirmText = `Abonnés : ${preview.followers_total}\nDestinataires in-app éligibles : ${preview.eligible_in_app_recipients}\nCampagnes utilisées sur 24 h : ${preview.used_last_24h} / ${preview.daily_limit}\nRestantes : ${preview.remaining_last_24h}\nEnvironnement : ${preview.environment}\n\nConfirmer l'envoi de cette campagne ?`;
        if (!window.confirm(confirmText)) return;

        const result = await createMyMerchantNotificationCampaign({ title, message, actionPath: actionPathRaw || null, scheduledAt });
        showMsg(campaignCreationResultMessageFr(result?.status), true);
        campaignForm.reset();
        await Promise.all([runMerchantCampaignsSearch(true), refreshMerchantCampaignPreview()]);
      } catch (err) {
        showMsg(notificationErrorMessageFr(err?.message, "Impossible d'envoyer cette campagne."), false);
      } finally {
        btn.dataset.submitting = "";
        // Le quota (0 restante) reste autoritaire : refreshMerchantCampaignPreview()
        // vient de tourner et réactivera/désactivera le bouton en conséquence ;
        // ne jamais le réactiver aveuglément ici.
        if (btn.dataset.quotaExhausted !== "1") btn.disabled = false;
      }
    });
  }
  await Promise.all([runMerchantNotificationsSearch(true), runMerchantCampaignsSearch(true)]);
}

async function refreshMerchantCampaignPreview() {
  const host = document.querySelector("#merchantCampaignPreviewHost");
  const submitBtn = document.querySelector('#merchantCampaignForm button[type="submit"]');
  if (!host) return;
  try {
    const p = await getMyMerchantNotificationCampaignPreview();
    host.innerHTML = `<div class="settings-section"><div><strong>Abonnés :</strong> ${esc(p.followers_total)} · <strong>Éligibles in-app :</strong> ${esc(p.eligible_in_app_recipients)}</div><div>${esc(p.used_last_24h)}/${esc(p.daily_limit)} campagnes utilisées (24 h) · ${esc(p.remaining_last_24h)} restante(s)${String(p.environment||"").toLowerCase()==="production"?' <span class="badge amber">PRODUCTION</span>':""}</div></div>`;
    // Le quota est autoritaire : à 0 restante, le submit reste désactivé
    // même si aucune soumission n'est en cours ; réactivé uniquement quand
    // le quota redevient positif ET qu'aucune soumission n'est en vol.
    if (submitBtn) {
      if (p.remaining_last_24h <= 0) {
        submitBtn.dataset.quotaExhausted = "1";
        submitBtn.disabled = true;
        host.innerHTML += errorBox(`Limite atteinte : ${p.used_last_24h}/${p.daily_limit} campagnes sur les dernières 24 h.`);
      } else {
        submitBtn.dataset.quotaExhausted = "";
        if (submitBtn.dataset.submitting !== "1") submitBtn.disabled = false;
      }
    }
  } catch (err) {
    host.innerHTML = errorBox(notificationErrorMessageFr(err?.message, "Impossible de charger l'aperçu de campagne."));
  }
}

// --- Feature #28 — Promotions marchand ---------------------------------
// promotion_mode / code / scope_type sont immuables après création (aucune
// RPC ne permet de les changer) : jamais de faux champ "modifiable" pour
// eux dans l'édition, toujours en lecture seule. Une promotion active doit
// être mise en pause avant update/scope (pause_promotion_before_edit /
// pause_promotion_before_scope_change) — le backend reste autoritaire.
let _promoCaps = null;
let _promoMerchantId = null;
let _promoStatusFilter = "";
let _promoRows = [];
let _promoOffset = 0;
let _promoHasMore = false;
let _promoSeq = 0;
const PROMO_PAGE_SIZE = 20;
const PROMO_MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;

// timestamptz (UTC) backend -> valeur locale pour <input type="datetime-local">.
// Ne jamais appliquer ceci à une colonne SQL `date` (pas de fuseau à corriger).
function toDatetimeLocalValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function promoDiscountLabel(p) {
  return p.discount_type === "percent" ? `${esc(p.discount_value)}%` : `${money(p.discount_value)}`;
}

function promoRowHtml(p) {
  return `<div class="settings-section" data-promo="${esc(p.promotion_id)}" style="cursor:pointer">
    <div><strong>${esc(p.name)}</strong>${p.mode === "code" ? ` · <code>${esc(p.code)}</code>` : ""}<p>${promoDiscountLabel(p)} · ${esc(PROMOTION_SCOPE_FR[p.scope_type] || p.scope_type)}</p></div>
    <span class="badge ${p.status === "active" ? "green" : p.status === "paused" ? "amber" : p.status === "disabled" ? "red" : "blue"}">${esc(PROMOTION_STATUS_FR[p.status] || p.status)}</span>
  </div>`;
}

async function runPromotionsListSearch(reset) {
  const host = document.querySelector("#promoListHost");
  const loadMoreWrap = document.querySelector("#promoListLoadMoreWrap");
  if (!host) return;
  const seq = ++_promoSeq;
  const offset = reset ? 0 : _promoOffset;
  if (reset) { _promoOffset = 0; _promoRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#promoListLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listMyPromotions({ status: _promoStatusFilter || null, limit: PROMO_PAGE_SIZE, offset });
    if (seq !== _promoSeq) return;
    const merged = reset ? result.rows : _promoRows.concat(result.rows);
    const seen = new Set();
    _promoRows = merged.filter((r) => { const id = String(r?.promotion_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _promoHasMore = result.hasMore;
    _promoOffset = offset + result.rows.length;
    if (!_promoRows.length) { host.innerHTML = empty("Aucune promotion", "Créez votre première promotion ci-dessus."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = _promoRows.map(promoRowHtml).join("");
    refreshIcons();
    host.querySelectorAll("[data-promo]").forEach((row) => row.addEventListener("click", () => showPromotionDetail(row.dataset.promo)));
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _promoHasMore ? `<button class="btn btn-outline-blue btn-sm" id="promoListLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#promoListLoadMore")?.addEventListener("click", () => runPromotionsListSearch(false));
    }
  } catch (err) {
    if (seq !== _promoSeq) return;
    host.innerHTML = errorBox(promotionErrorMessageFr(err?.message, "Impossible de charger vos promotions."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

function promoUsageHtml(u) {
  if (!u) return "";
  const fmt = (v) => v == null ? "—" : esc(v);
  return `<div class="settings-section"><div><strong>Utilisation</strong><p>Réservées ${fmt(u.reserved)} · Consommées ${fmt(u.consumed)} · Libérées ${fmt(u.released)}</p></div><strong>${u.discount_granted_htg == null ? "—" : money(u.discount_granted_htg)}</strong></div>`;
}

function promoScopeEditorHtml(promo, merchantProducts, categories, scopePickerError) {
  if (promo.scope_type === "all") return `<p class="muted" style="font-size:12px">Cette promotion s'applique à tout le catalogue éligible — aucun périmètre à configurer.</p>`;
  if (scopePickerError && (promo.scope_type === "products" || promo.scope_type === "categories")) {
    return `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>Options indisponibles</h3><p>${esc(scopePickerError)}</p><button class="btn btn-outline-blue btn-sm" type="button" data-promo-scope-retry="${esc(promo.promotion_id)}">Réessayer</button></div>`;
  }
  if (promo.scope_type === "products") {
    const selected = new Set((promo.products || []).map((x) => x.product_id || x.id || x));
    return `<div class="field"><label>Produits concernés</label><select class="input" name="scope_ids" multiple size="8">${merchantProducts.map((p) => `<option value="${esc(p.id)}" ${selected.has(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`;
  }
  if (promo.scope_type === "categories") {
    const selected = new Set((promo.categories || []).map((x) => x.category_id || x.id || x));
    return `<div class="field"><label>Catégories concernées</label><select class="input" name="scope_ids" multiple size="8">${categories.map((c) => `<option value="${esc(c.id)}" ${selected.has(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`;
  }
  // offers : aucun navigateur d'offres n'existe encore dans ce worktree — on
  // ne reconstruit pas un second Offer Engine, on accepte une liste d'IDs
  // bruts (usage avancé) plutôt que de fabriquer un faux picker.
  const selected = (promo.offers || []).map((x) => x.offer_id || x.id || x).join(", ");
  return `<div class="field"><label>IDs d'offres concernées (séparés par des virgules)</label><input class="input" name="scope_ids_raw" value="${esc(selected)}" placeholder="uuid-1, uuid-2"></div>`;
}

async function showPromotionDetail(promotionId) {
  const host = document.querySelector("#promoDetailHost");
  if (!host) return;
  host.innerHTML = loading("Chargement de la promotion…");
  let promo;
  try { promo = await getMyPromotion(promotionId); }
  catch (err) { host.innerHTML = errorBox(promotionErrorMessageFr(err?.message, "Impossible de charger cette promotion.")); return; }

  const canEdit = promo.status === "draft" || promo.status === "paused";
  const mustPauseFirst = promo.status === "active";

  let merchantProducts = [], categories = [], scopePickerError = null;
  if (promo.scope_type === "products" || promo.scope_type === "categories") {
    try {
      if (promo.scope_type === "products") merchantProducts = await getMyProducts(_promoMerchantId);
      if (promo.scope_type === "categories") categories = await getCategories();
    } catch (err) {
      scopePickerError = promotionErrorMessageFr(err?.message, "Impossible de charger les options de périmètre.");
    }
  }

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>${esc(promo.name)}</h3><span class="badge ${promo.status === "active" ? "green" : promo.status === "paused" ? "amber" : promo.status === "disabled" ? "red" : "blue"}">${esc(PROMOTION_STATUS_FR[promo.status] || promo.status)}</span></div>
      <div class="settings-section"><div><strong>Mode</strong><p>${esc(PROMOTION_MODE_FR[promo.mode] || promo.mode)}${promo.mode === "code" ? ` · Code <code>${esc(promo.code)}</code>` : ""}</p></div></div>
      <div class="settings-section"><div><strong>Périmètre</strong><p>${esc(PROMOTION_SCOPE_FR[promo.scope_type] || promo.scope_type)}</p></div></div>
      <p class="muted" style="font-size:11px">Mode, code et périmètre ne peuvent plus être modifiés après création — créez une nouvelle promotion pour en changer.</p>
      ${promoUsageHtml(promo.usage)}
      ${(() => {
        const canActivate = !!_promoCaps?.promotions_enabled && (promo.mode !== "automatic" || !!_promoCaps?.automatic_promotions_enabled);
        const activateDisabledAttr = canActivate ? "" : "disabled";
        const activateHint = !canActivate
          ? `<p class="muted" style="font-size:11px">${!_promoCaps?.promotions_enabled ? "Les promotions sont désactivées par VinHT — activation impossible pour le moment." : "Le mode automatique n'est pas encore activé par VinHT — activation impossible pour le moment."}</p>`
          : "";
        return `<div class="toolbar-group" style="margin-top:8px;flex-wrap:wrap">
        ${promo.status === "draft" ? `<button class="btn btn-blue btn-sm" data-promo-status="active" type="button" ${activateDisabledAttr}>Activer</button>` : ""}
        ${promo.status === "active" ? `<button class="btn btn-outline-blue btn-sm" data-promo-status="paused" type="button">Mettre en pause</button>` : ""}
        ${promo.status === "paused" ? `<button class="btn btn-blue btn-sm" data-promo-status="active" type="button" ${activateDisabledAttr}>Réactiver</button>` : ""}
        ${promo.status === "disabled" ? `<button class="btn btn-outline-blue btn-sm" data-promo-status="active" type="button" ${activateDisabledAttr}>Réactiver</button>` : ""}
      </div>${activateHint}`;
      })()}
      <div id="promoStatusMsg" style="font-size:12px;margin-top:6px;display:none"></div>
    </div>

    <div class="portal-card">
      <h3>Modifier</h3>
      ${mustPauseFirst ? `<p class="muted" style="font-size:12px">Mettez cette promotion en pause avant de modifier ses réglages ou son périmètre.</p>` : ""}
      <form id="promoEditForm" style="display:flex;flex-direction:column;gap:8px;${canEdit ? "" : "opacity:.5;pointer-events:none"}">
        <div class="field"><label>Nom</label><input class="input" name="name" maxlength="120" value="${esc(promo.name)}" required></div>
        <div class="field"><label>Description</label><textarea class="input" name="description" rows="2" maxlength="500">${esc(promo.description || "")}</textarea></div>
        <div class="customer-grid">
          <div class="field"><label>Type de remise</label><select class="input" name="discount_type"><option value="percent" ${promo.discount_type === "percent" ? "selected" : ""}>Pourcentage</option><option value="fixed_htg" ${promo.discount_type === "fixed_htg" ? "selected" : ""}>Montant fixe (HTG)</option></select></div>
          <div class="field"><label>Valeur</label><input class="input" type="number" name="discount_value" min="0" step="0.01" value="${esc(promo.discount_value)}" required></div>
          <div class="field"><label>Plafond HTG (facultatif)</label><input class="input" type="number" name="max_discount_htg" min="0.01" step="0.01" value="${promo.max_discount_htg ?? ""}"></div>
        </div>
        <div class="customer-grid">
          <div class="field"><label>Sous-total minimum</label><input class="input" type="number" name="min_subtotal_htg" min="0" step="1" value="${esc(promo.min_subtotal_htg ?? 0)}"></div>
          <div class="field"><label>Quantité minimum</label><input class="input" type="number" name="min_quantity" min="1" step="1" value="${esc(promo.min_quantity ?? 1)}"></div>
        </div>
        <div class="field"><label>Types de prix</label><div class="toolbar-group"><label style="font-size:13px;display:flex;gap:4px;align-items:center"><input type="checkbox" name="pricing_tier_retail" ${(promo.pricing_tiers || []).includes("retail") ? "checked" : ""}> Détail</label><label style="font-size:13px;display:flex;gap:4px;align-items:center"><input type="checkbox" name="pricing_tier_wholesale" ${(promo.pricing_tiers || []).includes("wholesale") ? "checked" : ""}> Gros</label></div></div>
        <div class="customer-grid">
          <div class="field"><label>Début</label><input class="input" type="datetime-local" name="starts_at" value="${esc(toDatetimeLocalValue(promo.starts_at))}" required></div>
          <div class="field"><label>Fin</label><input class="input" type="datetime-local" name="ends_at" value="${esc(toDatetimeLocalValue(promo.ends_at))}" required></div>
        </div>
        <div class="customer-grid">
          <div class="field"><label>Limite totale (vide = illimité)</label><input class="input" type="number" name="total_usage_limit" min="1" step="1" value="${promo.total_usage_limit ?? ""}"></div>
          <div class="field"><label>Limite par client</label><input class="input" type="number" name="per_user_usage_limit" min="1" max="100" step="1" value="${esc(promo.per_user_usage_limit ?? 1)}"></div>
        </div>
        <div id="promoEditMsg" style="font-size:12px;display:none"></div>
        <div class="toolbar-group"><button class="btn btn-dark btn-sm" type="submit" ${canEdit ? "" : "disabled"}>Enregistrer</button></div>
      </form>
    </div>

    ${promo.scope_type !== "all" ? `<div class="portal-card">
      <h3>Périmètre</h3>
      ${mustPauseFirst ? `<p class="muted" style="font-size:12px">Mettez cette promotion en pause avant de changer son périmètre.</p>` : ""}
      <form id="promoScopeForm" style="display:flex;flex-direction:column;gap:8px;${canEdit ? "" : "opacity:.5;pointer-events:none"}">
        ${promoScopeEditorHtml(promo, merchantProducts, categories, scopePickerError)}
        <div id="promoScopeMsg" style="font-size:12px;display:none"></div>
        <div class="toolbar-group"><button class="btn btn-outline-blue btn-sm" type="submit" ${canEdit && !scopePickerError ? "" : "disabled"}>Enregistrer le périmètre</button></div>
      </form>
    </div>` : ""}
  `;
  refreshIcons();
  host.querySelector("[data-promo-scope-retry]")?.addEventListener("click", () => showPromotionDetail(promotionId));

  host.querySelectorAll("[data-promo-status]").forEach((btn) => btn.addEventListener("click", async () => {
    const nextStatus = btn.dataset.promoStatus;
    const msgBox = host.querySelector("#promoStatusMsg");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    btn.disabled = true;
    try {
      await setMyPromotionStatus(promotionId, nextStatus);
    } catch (err) {
      showMsg(promotionErrorMessageFr(err?.message, "Impossible de changer le statut."), false);
      btn.disabled = false;
      return;
    }
    showToast("Statut mis à jour ✓");
    try {
      await Promise.all([showPromotionDetail(promotionId), runPromotionsListSearch(true)]);
    } catch {
      showMsg("Statut mis à jour, mais l'actualisation a échoué. Rechargez la page pour voir l'état à jour.", false);
    }
  }));

  const editForm = host.querySelector("#promoEditForm");
  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const fd = new FormData(editForm);
    const msgBox = host.querySelector("#promoEditMsg");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const pricingTiers = [fd.get("pricing_tier_retail") ? "retail" : null, fd.get("pricing_tier_wholesale") ? "wholesale" : null].filter(Boolean);
    if (!pricingTiers.length) { showMsg("Sélectionnez au moins un type de prix.", false); return; }
    const startsRaw = fd.get("starts_at"), endsRaw = fd.get("ends_at");
    if (!startsRaw || !endsRaw) { showMsg("Les dates de début et de fin sont obligatoires.", false); return; }
    const startsMs = new Date(startsRaw).getTime(), endsMs = new Date(endsRaw).getTime();
    if (!(endsMs > startsMs)) { showMsg("La date de fin doit être après la date de début.", false); return; }
    if (endsMs - startsMs > PROMO_MAX_DURATION_MS) { showMsg("La durée de la promotion ne peut pas dépasser 366 jours.", false); return; }
    const toIso = (v) => v ? new Date(v).toISOString() : null;
    const btn = editForm.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    try {
      await updateMyPromotion(promotionId, {
        name: (fd.get("name") || "").trim(),
        description: (fd.get("description") || "").trim() || null,
        discountType: fd.get("discount_type"),
        discountValue: Number(fd.get("discount_value")),
        maxDiscountHtg: fd.get("max_discount_htg") ? Number(fd.get("max_discount_htg")) : null,
        minSubtotalHtg: Number(fd.get("min_subtotal_htg") || 0),
        minQuantity: Number(fd.get("min_quantity") || 1),
        pricingTiers,
        startsAt: toIso(startsRaw),
        endsAt: toIso(endsRaw),
        totalUsageLimit: fd.get("total_usage_limit") ? Number(fd.get("total_usage_limit")) : null,
        perUserUsageLimit: Number(fd.get("per_user_usage_limit") || 1),
      });
    } catch (err) {
      showMsg(promotionErrorMessageFr(err?.message, "Impossible d'enregistrer ces modifications."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast("Promotion mise à jour ✓");
    btn.dataset.submitting = ""; btn.disabled = false;
    try {
      await Promise.all([showPromotionDetail(promotionId), runPromotionsListSearch(true)]);
    } catch {
      showMsg("Modifications enregistrées, mais l'actualisation a échoué. Rechargez la page pour voir l'état à jour.", false);
    }
  });

  const scopeForm = host.querySelector("#promoScopeForm");
  scopeForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    const msgBox = host.querySelector("#promoScopeMsg");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    const btn = scopeForm.querySelector('button[type="submit"]');
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let productIds = [], offerIds = [], categoryIds = [];
    const multi = scopeForm.querySelector('select[name="scope_ids"]');
    if (multi) {
      const ids = [...multi.selectedOptions].map((o) => o.value);
      if (promo.scope_type === "products") productIds = ids;
      if (promo.scope_type === "categories") categoryIds = ids;
    }
    const rawOffers = scopeForm.querySelector('input[name="scope_ids_raw"]');
    if (rawOffers) offerIds = rawOffers.value.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await setMyPromotionScope(promotionId, { productIds, offerIds, categoryIds });
    } catch (err) {
      // Leçon #24 : le draft (promotion_id) existe déjà — jamais recréer,
      // on ré-affiche ce même draft pour permettre un nouvel essai.
      showMsg(promotionErrorMessageFr(err?.message, "Impossible d'enregistrer ce périmètre. Réessayez sur cette même promotion."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast("Périmètre enregistré ✓");
    try {
      await showPromotionDetail(promotionId);
    } catch {
      showMsg("Périmètre enregistré, mais l'actualisation a échoué. Rechargez la page pour voir l'état à jour.", false);
    }
  });
}

async function promotionsPage(merchant) {
  _promoMerchantId = merchant?.id || null;
  const runtimeHost = document.querySelector("#promoRuntimeHost");
  const createCard = document.querySelector("#promoCreateCard");
  if (!runtimeHost) return;
  runtimeHost.innerHTML = loading("Chargement des promotions…");
  let caps;
  try { caps = await getPromotionCapabilities(); _promoCaps = caps; }
  catch (err) {
    runtimeHost.innerHTML = errorBox(promotionErrorMessageFr(err?.message, "Impossible de charger l'état des promotions."));
    if (createCard) createCard.hidden = true;
    // Le runtime seul a échoué à charger : la liste/le détail restent utilisables.
    document.querySelector("#promoStatusFilter")?.addEventListener("change", (e) => { _promoStatusFilter = e.target.value; runPromotionsListSearch(true); });
    await runPromotionsListSearch(true);
    return;
  }

  runtimeHost.innerHTML = caps.promotions_enabled
    ? `<div class="settings-section"><div><strong>Promotions</strong><p>Maximum ${esc(caps.max_active_promotions_per_merchant)} promotions actives.</p></div><span class="badge green">Activées${String(caps.environment || "").toLowerCase() === "demo" ? " (Demo)" : ""}</span></div>`
    : `<div class="empty-state"><div class="empty-icon"><i data-lucide="ticket-x"></i></div><h3>Promotions désactivées</h3><p>Les promotions sont actuellement désactivées par VinHT. Vos promotions existantes restent consultables ci-dessous.</p></div>`;
  refreshIcons();

  if (createCard) createCard.hidden = !caps.promotions_enabled;

  const modeSelect = document.querySelector("#promoModeSelect");
  if (modeSelect) {
    const modes = caps.automatic_promotions_enabled ? ["code", "automatic"] : ["code"];
    modeSelect.innerHTML = modes.map((m) => `<option value="${esc(m)}">${esc(PROMOTION_MODE_FR[m] || m)}</option>`).join("");
    const toggleCodeField = () => { const f = document.querySelector("#promoCodeField"); if (f) f.hidden = modeSelect.value !== "code"; };
    modeSelect.addEventListener("change", toggleCodeField);
    toggleCodeField();
  }
  const scopeSelect = document.querySelector("#promoScopeSelect");
  if (scopeSelect) scopeSelect.innerHTML = ["all", "products", "offers", "categories"].map((s) => `<option value="${esc(s)}">${esc(PROMOTION_SCOPE_FR[s] || s)}</option>`).join("");

  const createForm = document.querySelector("#promoCreateForm");
  if (createForm && !createForm.dataset.wired) {
    createForm.dataset.wired = "1";
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(createForm);
      const msgBox = document.querySelector("#promoCreateMsg");
      const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
      const mode = fd.get("mode");
      const codeRaw = normalizePromotionCode(fd.get("code"));
      if (mode === "code" && !isValidPromotionCode(codeRaw)) { showMsg("Code promo invalide (3 à 32 caractères : A-Z, 0-9, _ ou -).", false); return; }
      const pricingTiers = [fd.get("pricing_tier_retail") ? "retail" : null, fd.get("pricing_tier_wholesale") ? "wholesale" : null].filter(Boolean);
      if (!pricingTiers.length) { showMsg("Sélectionnez au moins un type de prix.", false); return; }
      const startsRaw = fd.get("starts_at"), endsRaw = fd.get("ends_at");
      if (!startsRaw || !endsRaw) { showMsg("Les dates de début et de fin sont obligatoires.", false); return; }
      const startsMs = new Date(startsRaw).getTime(), endsMs = new Date(endsRaw).getTime();
      if (!(endsMs > startsMs)) { showMsg("La date de fin doit être après la date de début.", false); return; }
      if (endsMs - startsMs > PROMO_MAX_DURATION_MS) { showMsg("La durée de la promotion ne peut pas dépasser 366 jours.", false); return; }
      const toIso = (v) => v ? new Date(v).toISOString() : null;
      const scopeType = fd.get("scope_type");
      const btn = createForm.querySelector('button[type="submit"]');
      if (btn.dataset.submitting === "1") return;
      btn.dataset.submitting = "1"; btn.disabled = true;
      let result;
      try {
        result = await createMyPromotion({
          mode,
          code: mode === "code" ? codeRaw : null,
          name: (fd.get("name") || "").trim(),
          description: (fd.get("description") || "").trim() || null,
          discountType: fd.get("discount_type"),
          discountValue: Number(fd.get("discount_value")),
          maxDiscountHtg: fd.get("max_discount_htg") ? Number(fd.get("max_discount_htg")) : null,
          minSubtotalHtg: Number(fd.get("min_subtotal_htg") || 0),
          minQuantity: Number(fd.get("min_quantity") || 1),
          scopeType,
          pricingTiers,
          startsAt: toIso(startsRaw),
          endsAt: toIso(endsRaw),
          totalUsageLimit: fd.get("total_usage_limit") ? Number(fd.get("total_usage_limit")) : null,
          perUserUsageLimit: Number(fd.get("per_user_usage_limit") || 1),
        });
      } catch (err) {
        showMsg(promotionErrorMessageFr(err?.message, "Impossible de créer cette promotion."), false);
        btn.dataset.submitting = ""; btn.disabled = false;
        return;
      }
      // La création a réussi : le promotion_id est réel et définitif, même si
      // l'actualisation ci-dessous échoue — ne jamais suggérer de recréer.
      showToast("Promotion créée en brouillon ✓");
      createForm.reset();
      btn.dataset.submitting = ""; btn.disabled = false;
      try {
        await runPromotionsListSearch(true);
        if (result?.promotion_id) await showPromotionDetail(result.promotion_id);
      } catch {
        showMsg(`Promotion créée (ID ${esc(result?.promotion_id || "")}), mais l'actualisation de la liste a échoué. Rechargez la page pour la retrouver.`, false);
      }
    });
  }

  document.querySelector("#promoStatusFilter")?.addEventListener("change", (e) => { _promoStatusFilter = e.target.value; runPromotionsListSearch(true); });

  await runPromotionsListSearch(true);
}

// --- Feature #29 — Publicité self-service marchand / Sponsored Products ---
// Le moteur Ads (marketplace_ads_runtime) est aujourd'hui désactivé et le
// fournisseur de financement FlexiCash n'est pas prêt (provider_required) :
// la création/le démarrage restent fail-closed, mais l'historique des
// campagnes reste toujours consultable même moteur OFF (même règle que #28).
// service_confirm_ad_campaign_funding_v1 est SERVICE ONLY — jamais un bouton
// frontend ne doit prétendre confirmer un financement ou un remboursement.
let _adsCaps = null;
let _adsStatusFilter = "";
let _adsRows = [];
let _adsOffset = 0;
let _adsHasMore = false;
let _adsSeq = 0;
const ADS_PAGE_SIZE = 20;
const ADS_MAX_DURATION_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000;

function adsCanCreate(caps) {
  return !!caps && caps.ads_enabled === true && caps.funding_provider_status === "ready";
}

function adsPlacementsLabel(placements) {
  return (Array.isArray(placements) ? placements : []).map((p) => AD_PLACEMENT_FR[p] || p).join(", ");
}

function adsRowHtml(c) {
  return `<div class="settings-section" data-ads-campaign="${esc(c.campaign_id)}" style="cursor:pointer">
    <div><strong>${esc(c.name)}</strong>${c.product_name ? ` · ${esc(c.product_name)}` : ""}<p>${esc(adsPlacementsLabel(c.placements))} · Budget ${money(c.total_budget_htg)}${c.remaining_budget_htg != null ? ` · Restant ${money(c.remaining_budget_htg)}` : ""}</p></div>
    <span class="badge ${c.status === "active" ? "green" : c.status === "paused" ? "amber" : (c.status === "cancelled" || c.status === "exhausted") ? "red" : "blue"}">${esc(AD_CAMPAIGN_STATUS_FR[c.status] || c.status)}</span>
  </div>`;
}

async function runAdsListSearch(reset) {
  const host = document.querySelector("#adsListHost");
  const loadMoreWrap = document.querySelector("#adsListLoadMoreWrap");
  if (!host) return;
  const seq = ++_adsSeq;
  const offset = reset ? 0 : _adsOffset;
  if (reset) { _adsOffset = 0; _adsRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#adsListLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await listMyAdCampaigns({ status: _adsStatusFilter || null, limit: ADS_PAGE_SIZE, offset });
    if (seq !== _adsSeq) return;
    const merged = reset ? result.rows : _adsRows.concat(result.rows);
    const seen = new Set();
    _adsRows = merged.filter((r) => { const id = String(r?.campaign_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    // Pas de total/has_more dans cette RPC : la fin de liste se déduit
    // uniquement du nombre de lignes reçues par rapport à la limite demandée.
    _adsHasMore = result.rows.length === ADS_PAGE_SIZE && result.rows.length > 0;
    _adsOffset = offset + result.rows.length;
    if (!_adsRows.length) { host.innerHTML = empty("Aucune campagne", "Vos campagnes publicitaires apparaîtront ici."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = _adsRows.map(adsRowHtml).join("");
    refreshIcons();
    host.querySelectorAll("[data-ads-campaign]").forEach((row) => row.addEventListener("click", () => showAdCampaignDetail(row.dataset.adsCampaign)));
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _adsHasMore ? `<button class="btn btn-outline-blue btn-sm" id="adsListLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#adsListLoadMore")?.addEventListener("click", async () => {
        const before = _adsRows.length;
        await runAdsListSearch(false);
        // Si le prochain appel ne retourne rien, on considère la liste terminée.
        if (_adsRows.length === before) _adsHasMore = false;
      });
    }
  } catch (err) {
    if (seq !== _adsSeq) return;
    host.innerHTML = errorBox(adsErrorMessageFr(err?.message, "Impossible de charger vos campagnes."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

function adsDashboardMetricHtml(label, value) {
  return `<div class="settings-section"><div><strong>${esc(label)}</strong></div><strong>${value}</strong></div>`;
}

async function showAdCampaignDetail(campaignId) {
  const host = document.querySelector("#adsDetailHost");
  if (!host) return;
  host.innerHTML = loading("Chargement de la campagne…");
  let dash;
  try { dash = await getMyAdCampaignDashboard(campaignId); }
  catch (err) { host.innerHTML = errorBox(adsErrorMessageFr(err?.message, "Impossible de charger cette campagne.")); return; }

  // Actions disponibles strictement selon le statut — le backend reste
  // autoritaire sur la transition réelle, ceci ne fait que proposer les
  // boutons pertinents (voir #29 §32).
  const canStart = dash.status === "paused" || (dash.status === "pending_funding" && dash.funding_status === "funded");
  const canPause = dash.status === "active" || dash.status === "scheduled";
  const canCancel = !["cancelled", "ended", "exhausted"].includes(dash.status);
  const startGated = !adsCanCreate(_adsCaps);

  const fmtOrDash = (v, formatter) => (v == null ? "—" : formatter(v));

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><h3>Campagne</h3><span class="badge ${dash.status === "active" ? "green" : dash.status === "paused" ? "amber" : (dash.status === "cancelled" || dash.status === "exhausted") ? "red" : "blue"}">${esc(AD_CAMPAIGN_STATUS_FR[dash.status] || dash.status)}</span></div>
      <div class="settings-section"><div><strong>Financement</strong><p>${esc(AD_FUNDING_STATUS_FR[dash.funding_status] || dash.funding_status)}</p></div></div>
      <div class="settings-section"><div><strong>Emplacements</strong><p>${esc(adsPlacementsLabel(dash.placements))}</p></div></div>
      ${dash.funding_status === "unfunded" ? `<div class="empty-state"><div class="empty-icon"><i data-lucide="clock"></i></div><h3>En attente de financement FlexiCash</h3><p>Le financement publicitaire FlexiCash n'est pas encore disponible. Aucune action de paiement n'est possible depuis cette page.</p></div>` : ""}
      <div class="toolbar-group" style="margin-top:8px;flex-wrap:wrap">
        ${canStart ? `<button class="btn btn-blue btn-sm" data-ads-action="start" type="button" ${startGated ? "disabled" : ""}>${dash.status === "paused" ? "Reprendre" : "Démarrer"}</button>` : ""}
        ${canPause ? `<button class="btn btn-outline-blue btn-sm" data-ads-action="pause" type="button">Mettre en pause</button>` : ""}
        ${canCancel ? `<button class="btn btn-outline-red btn-sm" data-ads-action="cancel" type="button">Annuler</button>` : ""}
      </div>
      ${canStart && startGated ? `<p class="muted" style="font-size:11px">Le moteur publicitaire ou le fournisseur de financement n'est pas encore prêt — démarrage impossible pour le moment.</p>` : ""}
      <div id="adsActionMsg" style="font-size:12px;margin-top:6px;display:none"></div>
    </div>

    <div class="portal-card">
      <h3>Performance</h3>
      ${adsDashboardMetricHtml("Budget", money(dash.budget_htg))}
      ${adsDashboardMetricHtml("Dépensé", money(dash.spent_htg))}
      ${adsDashboardMetricHtml("Restant", money(dash.remaining_budget_htg))}
      ${adsDashboardMetricHtml("Impressions", esc(dash.impressions ?? 0))}
      ${adsDashboardMetricHtml("Clics", esc(dash.clicks_raw ?? 0))}
      ${adsDashboardMetricHtml("Clics facturés", esc(dash.billable_clicks ?? 0))}
      ${adsDashboardMetricHtml("CTR", fmtOrDash(dash.ctr, (v) => `${(Number(v) * 100).toFixed(2)}%`))}
      ${adsDashboardMetricHtml("CPC moyen", fmtOrDash(dash.average_cpc_htg, (v) => money(v)))}
      ${adsDashboardMetricHtml("Commandes attribuées", esc(dash.attributed_orders ?? 0))}
      ${adsDashboardMetricHtml("Ventes attribuées", fmtOrDash(dash.attributed_sales_htg, (v) => money(v)))}
      ${adsDashboardMetricHtml("ROAS", fmtOrDash(dash.roas, (v) => `${Number(v).toFixed(2)}x`))}
    </div>
  `;
  refreshIcons();

  host.querySelectorAll("[data-ads-action]").forEach((btn) => btn.addEventListener("click", async () => {
    const action = btn.dataset.adsAction;
    const msgBox = host.querySelector("#adsActionMsg");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    if (action === "cancel" && !window.confirm("Annuler cette campagne publicitaire ?")) return;
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    let result;
    try {
      if (action === "start") result = await startMyAdCampaign(campaignId);
      else if (action === "pause") result = await pauseMyAdCampaign(campaignId);
      else if (action === "cancel") result = await cancelMyAdCampaign(campaignId);
    } catch (err) {
      const fallback = action === "start" ? "Impossible de démarrer cette campagne."
        : action === "pause" ? "Impossible de mettre cette campagne en pause."
        : "Impossible d'annuler cette campagne.";
      showMsg(adsErrorMessageFr(err?.message, fallback), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    if (action === "cancel" && result?.refund_required) {
      // Un remboursement peut être requis, mais rien ne prouve qu'il a été
      // exécuté par le fournisseur — jamais annoncer "Remboursement effectué".
      showToast("Campagne annulée ✓");
      showMsg("Un remboursement du budget publicitaire inutilisé doit être traité par VinHT.", true);
    } else {
      showToast(action === "start" ? (result?.status === "scheduled" ? "Campagne planifiée ✓" : "Campagne démarrée ✓") : action === "pause" ? "Campagne mise en pause ✓" : "Campagne annulée ✓");
    }
    try {
      await Promise.all([showAdCampaignDetail(campaignId), runAdsListSearch(true)]);
    } catch {
      showMsg("Action effectuée, mais l'actualisation a échoué. Rechargez la page pour voir l'état à jour.", false);
    }
  }));
}

async function adsPage(merchant) {
  const runtimeHost = document.querySelector("#adsRuntimeHost");
  const createCard = document.querySelector("#adsCreateCard");
  if (!runtimeHost) return;
  runtimeHost.innerHTML = loading("Chargement de la publicité VinHT…");
  let caps;
  try { caps = await getMarketplaceAdsCapabilities(); _adsCaps = caps; }
  catch (err) {
    runtimeHost.innerHTML = errorBox(adsErrorMessageFr(err?.message, "Impossible de charger l'état de la publicité VinHT."));
    if (createCard) createCard.hidden = true;
    // L'échec du runtime n'empêche pas de consulter l'historique existant.
    document.querySelector("#adsStatusFilter")?.addEventListener("change", (e) => { _adsStatusFilter = e.target.value; runAdsListSearch(true); });
    await runAdsListSearch(true);
    return;
  }

  const canCreate = adsCanCreate(caps);
  const tarifsHtml = caps.placements ? `<div class="settings-section"><div><strong>Tarifs actuels (coût par clic)</strong><p>Recherche ${esc(caps.placements.search)} HTG · Catégorie ${esc(caps.placements.category)} HTG · Fiche produit ${esc(caps.placements.product_page)} HTG · Accueil ${esc(caps.placements.home)} HTG</p></div></div>` : "";

  if (!caps.ads_enabled) {
    runtimeHost.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="megaphone-off"></i></div><h3>${esc(caps.message_fr || "Publicité VinHT — bientôt disponible.")}</h3><p>Le moteur publicitaire est prêt mais n'est pas encore activé par VinHT.</p></div>${tarifsHtml}`;
  } else if (caps.funding_provider_status !== "ready") {
    runtimeHost.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="clock"></i></div><h3>Financement FlexiCash : intégration fournisseur requise</h3><p>Le financement publicitaire FlexiCash n'est pas encore disponible.</p></div>${tarifsHtml}`;
  } else {
    runtimeHost.innerHTML = `<div class="settings-section"><div><strong>Publicité VinHT</strong><p>Coût par clic, jusqu'à ${esc(caps.max_campaign_days)} jours, budget ${esc(caps.min_campaign_budget_htg)}–${esc(caps.max_campaign_budget_htg)} HTG.</p></div><span class="badge green">Activée</span></div>${tarifsHtml}`;
  }
  refreshIcons();

  if (createCard) createCard.hidden = !canCreate;

  if (canCreate) {
    const createForm = document.querySelector("#adsCreateForm");
    if (createForm && !createForm.dataset.wired) {
      createForm.dataset.wired = "1";
      createForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(createForm);
        const msgBox = document.querySelector("#adsCreateMsg");
        const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
        const placements = [
          fd.get("placement_search") ? "search" : null,
          fd.get("placement_category") ? "category" : null,
          fd.get("placement_product_page") ? "product_page" : null,
          fd.get("placement_home") ? "home" : null,
        ].filter(Boolean);
        if (!placements.length) { showMsg("Sélectionnez au moins un emplacement.", false); return; }
        const productId = (fd.get("product_id") || "").trim();
        if (!productId) { showMsg("Le produit à sponsoriser est requis.", false); return; }
        const totalBudget = Number(fd.get("total_budget_htg"));
        if (caps.min_campaign_budget_htg != null && caps.max_campaign_budget_htg != null && (totalBudget < caps.min_campaign_budget_htg || totalBudget > caps.max_campaign_budget_htg)) {
          showMsg(`Le budget total doit être entre ${caps.min_campaign_budget_htg} et ${caps.max_campaign_budget_htg} HTG.`, false); return;
        }
        const dailyRaw = fd.get("daily_budget_htg");
        const dailyBudget = dailyRaw ? Number(dailyRaw) : null;
        if (dailyBudget != null && (dailyBudget <= 0 || dailyBudget > totalBudget)) { showMsg("Le budget journalier doit être supérieur à 0 et ne pas dépasser le budget total.", false); return; }
        const startRaw = fd.get("start_at"), endRaw = fd.get("end_at");
        if (!startRaw || !endRaw) { showMsg("Les dates de début et de fin sont obligatoires.", false); return; }
        const startsMs = new Date(startRaw).getTime(), endsMs = new Date(endRaw).getTime();
        if (!(endsMs > startsMs)) { showMsg("La date de fin doit être après la date de début.", false); return; }
        const maxDurationMs = caps.max_campaign_days ? caps.max_campaign_days * 24 * 60 * 60 * 1000 : ADS_MAX_DURATION_MS_DEFAULT;
        if (endsMs - startsMs > maxDurationMs) { showMsg(`La durée de la campagne ne peut pas dépasser ${caps.max_campaign_days || 30} jours.`, false); return; }
        const toIso = (v) => v ? new Date(v).toISOString() : null;
        const btn = createForm.querySelector('button[type="submit"]');
        if (btn.dataset.submitting === "1") return;
        btn.dataset.submitting = "1"; btn.disabled = true;
        let result;
        try {
          result = await createMyAdCampaign({
            name: (fd.get("name") || "").trim(),
            productId,
            offerId: null,
            placements,
            totalBudgetHtg: totalBudget,
            dailyBudgetHtg: dailyBudget,
            startAt: toIso(startRaw),
            endAt: toIso(endRaw),
          });
        } catch (err) {
          showMsg(adsErrorMessageFr(err?.message, "Impossible de créer cette campagne."), false);
          btn.dataset.submitting = ""; btn.disabled = false;
          return;
        }
        // La création a réussi : le campaign_id est réel et définitif, même si
        // l'actualisation ci-dessous échoue — ne jamais suggérer de recréer.
        showToast("Campagne créée — en attente de financement ✓");
        createForm.reset();
        btn.dataset.submitting = ""; btn.disabled = false;
        try {
          await runAdsListSearch(true);
          if (result?.campaign_id) await showAdCampaignDetail(result.campaign_id);
        } catch {
          showMsg(`Campagne créée (ID ${esc(result?.campaign_id || "")}), mais l'actualisation de la liste a échoué. Rechargez la page pour la retrouver.`, false);
        }
      });
    }
  }

  document.querySelector("#adsStatusFilter")?.addEventListener("change", (e) => { _adsStatusFilter = e.target.value; runAdsListSearch(true); });

  await runAdsListSearch(true);
}

async function settingsPage(m){const form=document.querySelector("#merchantSettingsForm");if(!form)return;form.shop_name.value=m.shop_name||"";form.description.value=m.description||"";form.whatsapp_number.value=m.whatsapp_number||"";form.delivery_zone.value=m.delivery_zone||"";form.addEventListener("submit",async e=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=true;try{await updateMyMerchantProfile({shopName:form.shop_name.value,description:form.description.value,whatsappNumber:form.whatsapp_number.value,deliveryZone:form.delivery_zone.value});showToast("Boutique mise à jour ✓")}catch{showToast("Impossible d’enregistrer","red")}finally{btn.disabled=false}})}


async function productNewPage(m){
  const host=document.querySelector("#merchantProductNewHost");if(!host)return;host.innerHTML=loading("Préparation du formulaire…");
  host.innerHTML=`<div class="portal-card"><h3>Publier un produit</h3><p class="muted">Le parcours complet permet d'ajouter 1 à 5 images et de préparer les variantes avant publication.</p><a class="btn btn-blue" href="../merchant-center.html#products">Ouvrir le parcours de publication</a></div>`;
  return;
}

// Même règle que productsPage() : un produit varianté n'expose plus de champ
// "Nouveau stock" éditable ici — le stock réel se gère variante par variante.
async function inventoryPage(m){
  const host=document.querySelector("#merchantInventoryHost");if(!host)return;host.innerHTML=loading();try{const rows=await getMyProducts(m.id);if(!rows.length){host.innerHTML=empty("Inventaire vide","Ajoutez votre premier produit pour gérer le stock ici.");refreshIcons();return}
  host.innerHTML=`<div class="toolbar"><input class="input" id="inventorySearch" placeholder="Rechercher dans l’inventaire"><a class="btn btn-dark btn-sm" href="product-new.html">Ajouter produit</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Statut</th><th>Stock actuel</th><th>Nouveau stock</th><th></th></tr></thead><tbody id="inventoryBody"></tbody></table></div>`;
  const body=host.querySelector("#inventoryBody");
  let variantSet=null,variantError=false;
  const loadVariants=async()=>{variantError=false;try{variantSet=await getVariantedProductIds(rows.map(r=>r.id))}catch{variantSet=null;variantError=true}};
  const draw=()=>{const q=(host.querySelector("#inventorySearch").value||"").toLowerCase();const list=rows.filter(p=>!q||p.name.toLowerCase().includes(q)||String(p.sku||"").toLowerCase().includes(q));body.innerHTML=list.map(p=>{
    const hasVariants=!variantError&&variantSet&&variantSet.has(p.id);
    let newStockCell,actionCell;
    if(variantError){newStockCell=`<span class="badge" style="color:var(--red,#f31938)">Statut variantes indisponible</span>`;actionCell=`<button class="btn btn-ghost btn-sm" type="button" data-variant-retry="${esc(p.id)}">Réessayer</button>`}
    else if(hasVariants){newStockCell=`<span class="badge">Géré par variantes</span>`;actionCell=`<a class="btn btn-ghost btn-sm" href="../merchant-center.html#products">Gérer les variantes</a>`}
    else{newStockCell=`<input class="input" data-stock-value type="number" min="0" value="${esc(p.stock)}" style="width:100px">`;actionCell=`<button class="btn btn-ghost btn-sm" data-stock-save type="button">Mettre à jour</button>`}
    return `<tr data-inventory="${esc(p.id)}"><td><div class="table-primary">${esc(p.name)}</div><div class="table-secondary">${esc(p.sku||p.slug||"")}</div></td><td>${badge(p.approval_status)}</td><td><strong>${esc(p.stock)}</strong></td><td>${newStockCell}</td><td>${actionCell}</td></tr>`;
  }).join("");body.querySelectorAll("[data-stock-save]").forEach(btn=>btn.addEventListener("click",async()=>{const tr=btn.closest("[data-inventory]");const input=tr.querySelector("[data-stock-value]");btn.disabled=true;try{await setProductStock(tr.dataset.inventory,input.value);const item=rows.find(x=>x.id===tr.dataset.inventory);if(item)item.stock=parseInt(input.value,10)||0;tr.children[2].innerHTML=`<strong>${esc(item.stock)}</strong>`;showToast("Stock mis à jour ✓")}catch{showToast("Mise à jour refusée","red")}finally{btn.disabled=false}}));body.querySelectorAll("[data-variant-retry]").forEach(btn=>btn.addEventListener("click",async()=>{btn.disabled=true;await loadVariants();draw()}))};
  await loadVariants();draw();host.querySelector("#inventorySearch").addEventListener("input",draw)}catch{host.innerHTML=errorBox("Impossible de charger l’inventaire.")}
}

// Bug corrigé : sur un produit varianté, setProductStock() n'est plus jamais
// appelé après updateProductContent(). Avant, l'étape 1 (contenu) pouvait
// réussir pendant que l'étape 2 (stock parent, refusée par le backend pour un
// produit varianté) échouait, donnant un faux message d'échec global alors
// que le contenu avait déjà changé. Détection via getProductVariants()
// (Feature #5, un seul produit ici -> pas de N+1). En cas d'échec de
// détection, le stock reste non éditable (fail-closed) avec un retry.
async function productEditPage(m){
  const host=document.querySelector("#merchantProductEditHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();try{const rows=await getMyProducts(m.id);const p=rows.find(x=>x.id===id);if(!p){host.innerHTML=empty("Produit introuvable","Ce produit n’appartient pas à votre boutique ou n’existe plus.");refreshIcons();return}
  let variantState="unknown";
  // available:false (produit non résolu côté contexte variantes) ne doit
  // JAMAIS être traité comme "sans variantes" : fail-closed explicite.
  try{const vc=await getProductVariants(p.id);variantState=vc.available===false?"unknown":vc.has_variants?"variant":"simple"}catch{variantState="unknown"}
  const stockFieldHtml=variantState==="simple"
    ?`<div class="field"><label>Stock</label><input name="stock" type="number" min="0" value="${esc(p.stock??0)}"></div>`
    :variantState==="variant"
    ?`<div class="field"><label>Stock</label><div class="table-secondary" style="padding:6px 0"><strong>${esc(p.stock??0)}</strong> — Stock géré par variantes</div><a class="btn btn-ghost btn-sm" href="../merchant-center.html#products">Gérer les variantes</a></div>`
    :`<div class="field"><label>Stock</label><div class="table-secondary" style="padding:6px 0"><strong>${esc(p.stock??0)}</strong> <span style="color:var(--red,#f31938)">Statut variantes indisponible</span></div><button class="btn btn-ghost btn-sm" type="button" id="mpEditVariantRetry">Réessayer</button></div>`;
  host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>${esc(p.name)}</h3><div class="table-secondary">${esc(p.sku||p.slug||"")} · ${p.approval_status}</div></div><a class="btn btn-ghost btn-sm" href="../merchant-center.html#products">Images / centre complet</a></div><form id="merchantEditProductForm"><div class="customer-grid"><div class="field"><label>Nom</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Prix détail</label><input name="retail_price" type="number" min="0" step="0.01" value="${esc(p.retail_price??"")}"></div><div class="field"><label>Prix comparé</label><input name="compare_at_price" type="number" min="0" step="0.01" value="${esc(p.compare_at_price??"")}"></div>${stockFieldHtml}<div class="field"><label>Prix gros</label><input name="wholesale_price" type="number" min="0" step="0.01" value="${esc(p.wholesale_price??"")}"></div><div class="field"><label>MOQ gros</label><input name="wholesale_min_qty" type="number" min="1" value="${esc(p.wholesale_min_qty??"")}"></div><div class="field" style="grid-column:1/-1"><label>Accroche</label><input name="tagline" value="${esc(p.tagline||"")}"></div><div class="field" style="grid-column:1/-1"><label>Description</label><textarea name="description">${esc(p.description||"")}</textarea></div></div><div class="toolbar" style="margin-top:14px"><span class="muted" style="font-size:9px">Toute édition de contenu repasse le produit en révision.</span><button class="btn btn-dark" type="submit">Enregistrer et renvoyer en validation</button></div></form></div>`;
  const editNote=host.querySelector("#merchantEditProductForm .muted");if(editNote)editNote.textContent="Les modifications seront signalées à VinHT pour un nouveau contrôle. Le produit reste visible pendant le contrôle, sauf s'il avait déjà été retiré par VinHT.";const editSubmit=host.querySelector("#merchantEditProductForm button[type=submit]");if(editSubmit)editSubmit.textContent="Enregistrer les modifications";
  host.querySelector("#mpEditVariantRetry")?.addEventListener("click",()=>productEditPage(m));
  const form=host.querySelector("#merchantEditProductForm");form.addEventListener("submit",async e=>{e.preventDefault();const btn=form.querySelector("button[type=submit]");btn.disabled=true;try{await updateProductContent(p.id,{name:form.name.value,tagline:form.tagline.value,description:form.description.value,retailPrice:form.retail_price.value,compareAtPrice:form.compare_at_price.value,wholesalePrice:form.wholesale_price.value,wholesaleMinQty:form.wholesale_min_qty.value});if(variantState==="simple"&&form.stock&&String(form.stock.value)!==String(p.stock))await setProductStock(p.id,form.stock.value);showToast("Produit mis à jour ✓");location.reload()}catch{showToast("Impossible de modifier le produit","red");btn.disabled=false}})}catch{host.innerHTML=errorBox("Impossible de charger ce produit.")}
}

async function orderDetailPage(m){
  const host=document.querySelector("#merchantOrderDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{
    const rows=await getMerchantOrders(m.id);const o=rows.find(x=>x.id===id||x.order_id===id);
    if(!o){host.innerHTML=empty("Commande introuvable","Cette commande n’est pas rattachée à votre boutique.");refreshIcons();return}
    const [items,parents]=await Promise.all([getMerchantOrderItems([o.id]),getOrdersByIds([o.order_id])]);const parent=parents[0]||{},next=nextOrderStatus(o.status),currency=rowCurrency(o);
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>Commande #${esc(String(o.order_id).slice(0,8))}</h3><div class="table-secondary">${esc(parent.full_name||"Client")} · ${esc(fmtDate(o.created_at))} · ${esc(currency)}</div></div><div class="toolbar-group">${badge(o.status)}${next?`<button class="btn btn-dark btn-sm" id="advanceOrder" type="button">Passer à ${esc(next)}</button>`:""}</div></div>${items.map(it=>{const c=rowCurrency(it);return `<div class="settings-section"><div><strong>${esc(it.product_name)}</strong><p>Qté ${esc(it.quantity)} · ${esc(it.pricing_tier)}</p></div><strong>${money(rowAmount(it,"line_total_amount","line_total_htg"),c)}</strong></div>`}).join("")}<div class="settings-section"><div><strong>Total marchand</strong><p>Snapshot serveur.</p></div><strong>${money(rowAmount(o,"subtotal_amount","subtotal_htg"),currency)}</strong></div></div>`;
    host.querySelector("#advanceOrder")?.addEventListener("click",async()=>{try{await updateMerchantOrderStatus(o.id,next);showToast("Statut mis à jour ✓");location.reload()}catch{showToast("Transition refusée","red")}})
  }catch{host.innerHTML=errorBox("Impossible de charger la commande.")}
}

function supportPage(m){const host=document.querySelector("#merchantSupportHost");if(!host)return;host.innerHTML=`<div class="quick-grid"><a class="quick-card" href="orders.html"><div class="quick-icon"><i data-lucide="clipboard-list"></i></div><div><strong>Problème de commande</strong><small>Ouvrez la commande concernée avant toute escalade.</small></div></a><a class="quick-card" href="products.html"><div class="quick-icon"><i data-lucide="package-search"></i></div><div><strong>Produit / validation</strong><small>Consultez le statut et le motif de rejet disponible.</small></div></a><a class="quick-card" href="../help.html"><div class="quick-icon"><i data-lucide="book-open"></i></div><div><strong>Centre d’aide</strong><small>Règles et fonctionnement de VinHT.</small></div></a><a class="quick-card" href="settings.html"><div class="quick-icon"><i data-lucide="store"></i></div><div><strong>Boutique</strong><small>Vérifiez vos informations opérationnelles.</small></div></a></div><div class="portal-card"><h3>Contexte boutique</h3><div class="settings-section"><div><strong>${esc(m.shop_name)}</strong><p>${esc(m.merchant_type)} · plan ${esc(m.plan_code)}</p></div>${badge(m.status)}</div><p class="muted" style="font-size:9px">Un système de ticket marchand n’est pas simulé tant qu’aucun stockage backend dédié n’est validé. Les actions ci-dessus restent néanmoins reliées aux vraies données et outils disponibles.</p></div>`;refreshIcons()}

let _mpAuthBound=false;let _mpLastUid=null;let _mpBooted=false;
export async function initMerchantPortal(){
  const page=document.body.dataset.merchantPage;if(!page)return;
  if(!_mpAuthBound){_mpAuthBound=true;onAuthChange((s)=>{const uid=(s&&s.user&&s.user.id)||null;if(_mpBooted&&uid===_mpLastUid)return;_mpBooted=true;_mpLastUid=uid;initMerchantPortal();});}
  const session=await getSession();
  _mpBooted=true;_mpLastUid=session?.user?.id||null;
  if(!session?.user){gate("auth");return;}
  // Skeleton discret pendant la résolution du contexte d'accès (évite le flash
  // "Devenir marchand"), sauf si le contenu est déjà affiché (re-boot auth).
  if(document.querySelector("[data-merchant-content]")?.hidden!==false){gateHtml(loading("Chargement de votre espace marchand…"));}
  const ctx=await getMyAccessContext();
  const access=ctx.merchant_access||{};
  document.querySelector("[data-merchant-content] [data-merchant-banner]")?.remove();
  if(!ctx.capabilities?.can_open_merchant_center){
    // États bloquants : demande en cours / refusée, provisioning, fermé,
    // pas encore marchand, indisponible.
    gateHtml(merchantBlockedHtml(access,{rootPrefix:"../",application:ctx.latest_merchant_application}));
    return;
  }
  let merchant;
  try{merchant=await getMyMerchant();}catch{gateHtml(merchantBlockedHtml({state:"unknown"},{rootPrefix:"../"}));return;}
  if(!merchant){gateHtml(merchantBlockedHtml(access,{rootPrefix:"../",application:ctx.latest_merchant_application}));return;}
  showContent();
  fillIdentity(merchant);
  // Bandeau non bloquant si l'espace est ouvert mais dégradé (pause / suspension).
  showBanner(merchantSpaceIsReachable(access.state)&&access.state!=="active"?merchantBannerHtml(access):"");
  if(page==="dashboard")await dashboard(merchant);else if(page==="products")await productsPage(merchant);else if(page==="orders"){/* merchantOrdersUx.js owns #merchantOrdersHost: access/identity only here. */}else if(page==="revenue")await revenuePage(merchant);else if(page==="analytics")await analyticsPage(merchant);else if(page==="notifications")await notificationsPage();else if(page==="promotions")await promotionsPage(merchant);else if(page==="ads")await adsPage(merchant);else if(page==="settings")await settingsPage(merchant);else if(page==="product-new")await productNewPage(merchant);else if(page==="inventory")await inventoryPage(merchant);else if(page==="product-edit")await productEditPage(merchant);else if(page==="order-detail")await orderDetailPage(merchant);else if(page==="support")supportPage(merchant);
  refreshIcons();
}
