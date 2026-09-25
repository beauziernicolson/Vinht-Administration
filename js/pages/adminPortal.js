import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { getSession, onAuthChange } from "../services/auth.js";
import { getMyProfile, getMyRoles } from "../services/profile.js";
import { getAdminProducts, getAdminMerchants, getAdminOrders, getAdminUsers, getAdminProduct, getAdminMerchant, getAdminOrder, getAdminUser, getAdminCategories, setAdminCategoryActive, getAdminFeatured, setAdminFeaturedActive, addAdminFeatured, removeAdminFeatured, reviewAdminProduct, setUserCommerceEnvironment, adminGetIndividualPricing, adminSetIndividualUsdFee, adminSetIndividualTransactionCommission, adminGetMarketplaceLaunchOffer, adminSetMarketplaceLaunchOffer, adminGetUsdShippingPricing, adminSetUsdShippingPricing, adminSetUsdShippingActivation, adminGetPlatformControlCenter, adminListProfessionalSubscriptions, adminListFlexicashSellerConnections, adminGetEconomicDashboard, adminGetEconomicTimeseries, adminGetPaymentProviderAnalytics, adminListTopMerchants, adminListTopProducts, adminGetLogisticsControl, adminGetLogisticsDraft, adminResetLogisticsDraft, adminUpdateLogisticsDraft, adminPreflightLogistics, adminActivateLogisticsDraft, getAdminPayoutReversalAlerts } from "../services/admin.js?v=20260922-mega-a-v1";
import { showToast } from "../ui/toast.js";
import { initControlCenter } from "./adminControlCenter.js";
import { confirmAction, adminErrorFr, envBanner } from "../ui/adminUi.js";
import { MERCHANT_APPLICATION_STATUSES, adminListMerchantApplications, adminGetMerchantApplication, adminCountPendingMerchantApplications, adminApproveMerchantApplication, adminRejectMerchantApplication } from "../services/adminMerchantApplications.js";
import { adminGetUserSpaces, adminListOrderReports, ORDER_REPORT_STATUSES } from "../services/adminControl.js";
import { PAYOUT_STATUS_FR, isPayoutReversalRequired, payoutErrorMessageFr } from "../services/merchantFulfillment.js";
import { getAdminEnvironment } from "../services/admin.js?v=20260922-mega-a-v1";
import {
  adminCreateNotificationCampaign, adminListNotificationCampaigns, cancelMyNotificationCampaign,
  adminPreviewNotificationCampaign, campaignCreationResultMessageFr,
  CAMPAIGN_STATUS_FR, ADMIN_CAMPAIGN_CATEGORIES, ADMIN_CAMPAIGN_AUDIENCES, ADMIN_CAMPAIGN_AUDIENCE_FR,
  ADMIN_CAMPAIGN_PRIORITIES, CAMPAIGN_PRIORITY_FR, NOTIFICATION_CATEGORY_FR,
  isSafeInternalActionPath, notificationErrorMessageFr,
} from "../services/notifications.js";
import { getUiPreferences, setUiPreferences } from "../services/preferences.js";
import { openAuthModal } from "../ui/authModal.js";
import { adminListKycCases, adminGetKycContext, adminReviewKycDocument, adminRequestKycChanges, adminApproveKyc, adminRejectKyc, signedKycUrl, kycErrorMessage } from "../services/merchantKyc.js";
import {
  adminGetPromotionRuntime, adminSetPromotionRuntime, adminListMerchantPromotions, adminDisableMerchantPromotion,
  PROMOTION_STATUS_FR, PROMOTION_SCOPE_FR, promotionErrorMessageFr,
} from "../services/promotions.js";
import {
  adminListAdCampaigns, AD_CAMPAIGN_STATUS_FR, AD_FUNDING_STATUS_FR, AD_PLACEMENT_FR, adsErrorMessageFr,
} from "../services/ads.js";

const esc=(v)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmtDate=(v)=>{const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})};
const loading=(t="Chargement…")=>`<div class="loading-state">${esc(t)}</div>`,errorBox=(t)=>`<div class="error-state">${esc(t)}</div>`,empty=(a,b)=>`<div class="empty-state"><div class="empty-icon"><i data-lucide="shield"></i></div><h3>${esc(a)}</h3><p>${esc(b)}</p></div>`;
const badge=(s)=>{const k=String(s||"").toLowerCase(),c=/active|approved|paid|delivered|completed/.test(k)?"green":/rejected|cancel|suspend|closed|failed/.test(k)?"red":/pending|new|processing|preparing/.test(k)?"amber":"blue";return `<span class="badge ${c}">${esc(s||"—")}</span>`};
// Badge d'environnement commerce. N'affiche rien pour la Production (défaut) ;
// affiche un badge DEMO visible quand environment='demo'.
const envBadge=(e)=>String(e||"").toLowerCase()==="demo"?'<span class="badge amber">MODE DEMO</span>':"";
const rowCurrency=(row)=>String(row?.currency||"HTG").toUpperCase()==="USD"?"USD":"HTG";
const rowAmount=(row,generic,legacy)=>Number(row?.[generic]??row?.[legacy]??0)||0;

const KYC_STATE_FR={not_started:"Non commencé",draft:"En cours",changes_requested:"Corrections demandées",submitted:"Envoyé",under_review:"En examen",approved:"Approuvé",rejected:"Refusé",cancelled:"Annulé"};
const APPLICATION_STATUS_FR={pending:"En attente",approved:"Approuvée",rejected:"Refusée",cancelled:"Annulée"};
const REPORT_STATUS_FR={open:"Ouvert",investigating:"En cours",resolved:"Résolu",dismissed:"Classé"};
const kycBadge=(st)=>{if(!st)return '<span class="badge">Aucun</span>';const k=String(st).toLowerCase();const c=k==="approved"?"green":k==="rejected"||k==="changes_requested"?"red":k==="submitted"||k==="under_review"||k==="draft"?"amber":"blue";return `<span class="badge ${c}">${esc(KYC_STATE_FR[k]||st)}</span>`;};
async function kycCasesByApplication(){try{const cases=await adminListKycCases({limit:200});const m=new Map();for(const c of cases){if(c.merchant_application_id&&!m.has(c.merchant_application_id))m.set(c.merchant_application_id,c);}return m;}catch(e){console.warn("[VinHT] kyc cases:",e&&e.message);return new Map();}}

function gate(kind){const g=document.querySelector("[data-admin-gate]"),c=document.querySelector("[data-admin-content]");if(g)g.hidden=false;if(c)c.hidden=true;if(g){g.innerHTML=kind==="role"?empty("Accès administrateur requis","Votre compte n’a pas le rôle admin sur VinHT."):`<div class="empty-state"><div class="empty-icon"><i data-lucide="lock-keyhole"></i></div><h3>Connexion requise</h3><p>Connectez-vous avec un compte administrateur.</p><button class="btn btn-blue" type="button" data-admin-login>Se connecter</button></div>`;g.querySelector("[data-admin-login]")?.addEventListener("click",()=>openAuthModal("login"));refreshIcons()}}
function showContent(){const g=document.querySelector("[data-admin-gate]"),c=document.querySelector("[data-admin-content]");if(g)g.hidden=true;if(c)c.hidden=false}
function fillIdentity(profile,session){const name=profile?.full_name||session?.user?.email||"Admin";document.querySelectorAll("[data-admin-name]").forEach(x=>x.textContent=name);document.querySelectorAll("[data-admin-email]").forEach(x=>x.textContent=session?.user?.email||"");document.querySelectorAll("[data-admin-initial]").forEach(x=>x.textContent=String(name).charAt(0).toUpperCase())}

// --- Feature #32 — Admin Control Center -------------------------------
// Cockpit consolidé au-dessus de admin_get_platform_control_center_v1() :
// jamais un recalcul local de ces compteurs, jamais un fallback silencieux
// vers un dashboard rempli de zéros si le pivot échoue. Les écrans Admin
// spécialisés (KYC/produits/marchands/commandes/promotions/Ads/...) ne sont
// pas reconstruits ici — uniquement liés quand une vraie page existe déjà.
const CC_ATTENTION_FR = {
  kyc_pending: "KYC en attente",
  products_pending: "Produits en attente",
  couriers_pending_review: "Livreurs à examiner",
  trade_protection_open: "Trade Insurance ouverts",
  certifications_pending: "Certifications en attente",
  verification_badges_pending: "Badges de vérification en attente",
  seller_health_watch: "Seller Health — surveillance",
  seller_health_at_risk: "Seller Health — à risque",
  pro_past_due: "Abonnements Pro en retard",
  pro_suspended: "Abonnements Pro suspendus",
  flexicash_connections_not_ready: "Connexions FlexiCash non prêtes",
  delivery_issues: "Incidents de livraison",
};
// Uniquement des routes Admin réellement existantes dans ce dépôt — jamais
// une destination inventée pour un compteur qui n'a pas encore d'écran dédié.
const CC_ATTENTION_LINK = {
  kyc_pending: "applications.html",
  products_pending: "products.html",
  couriers_pending_review: "control-center.html#livreurs",
  delivery_issues: "control-center.html#missions",
  trade_protection_open: "control-center.html#confiance",
  certifications_pending: "control-center.html#confiance",
  verification_badges_pending: "control-center.html#confiance",
  pro_past_due: "control-center.html#paiements",
  pro_suspended: "control-center.html#paiements",
  flexicash_connections_not_ready: "control-center.html#paiements",
};
const CC_MARKETPLACE_FR = {
  merchants_total: "Marchands (total)",
  merchants_active: "Marchands actifs",
  products_active: "Produits actifs",
  orders_pending_payment: "Commandes — paiement en attente",
  payouts_pending: "Payouts en attente",
  active_promotions: "Promotions actives",
  ad_campaigns_total: "Campagnes Ads (total)",
};

function ccValueHtml(v) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : esc(v);
}

function ccAttentionRowHtml(key, value) {
  const label = CC_ATTENTION_FR[key] || key;
  const href = CC_ATTENTION_LINK[key];
  const numeric = value !== null && value !== undefined && Number.isFinite(Number(value));
  const positive = numeric && Number(value) > 0;
  const badgeCls = positive ? "amber" : numeric ? "" : "";
  const row = `<div class="settings-section"><div><strong>${esc(label)}</strong></div><span class="badge ${badgeCls}">${ccValueHtml(value)}</span></div>`;
  return href ? `<a href="${href}" style="text-decoration:none;color:inherit;display:block">${row}</a>` : row;
}

function ccMarketplaceRowHtml(key, value) {
  return `<div class="settings-section"><div><strong>${esc(CC_MARKETPLACE_FR[key] || key)}</strong></div><span class="badge">${ccValueHtml(value)}</span></div>`;
}

function controlCenterHtml(cc) {
  const attention = cc.attention && typeof cc.attention === "object" ? cc.attention : {};
  const marketplace = cc.marketplace && typeof cc.marketplace === "object" ? cc.marketplace : {};
  const runtime = cc.runtime && typeof cc.runtime === "object" ? cc.runtime : {};
  const promoRt = runtime.promotions && typeof runtime.promotions === "object" ? runtime.promotions : {};
  const adsRt = runtime.ads && typeof runtime.ads === "object" ? runtime.ads : {};
  const genAt = cc.generated_at ? new Date(cc.generated_at) : null;
  const genAtOk = genAt && !Number.isNaN(genAt.getTime());

  return `
    <div class="portal-card">
      <div class="toolbar"><h3 style="margin:0">Control Center</h3><span class="badge">${esc(cc.environment || "—")}</span></div>
      <p class="muted" style="font-size:11px">${genAtOk ? `Généré ${esc(genAt.toLocaleString("fr-FR"))}` : "Horodatage indisponible."}</p>
    </div>

    <div class="portal-card">
      <h3>Attention requise</h3>
      ${Object.keys(CC_ATTENTION_FR).map((k) => ccAttentionRowHtml(k, attention[k])).join("")}
    </div>

    <div class="portal-card">
      <h3>Marketplace</h3>
      ${Object.keys(CC_MARKETPLACE_FR).map((k) => ccMarketplaceRowHtml(k, marketplace[k])).join("")}
    </div>

    <div class="portal-card">
      <h3>Runtime</h3>
      <div class="settings-section"><div><strong>Promotions</strong><p>Actives : ${promoRt.enabled === true ? "oui" : promoRt.enabled === false ? "non" : "—"} · Automatiques : ${promoRt.automatic_enabled === true ? "oui" : promoRt.automatic_enabled === false ? "non" : "—"} · Max actives/marchand : ${ccValueHtml(promoRt.max_active_per_merchant)}</p></div><a class="btn btn-outline-blue btn-sm" href="promotions.html">Ouvrir</a></div>
      <div class="settings-section"><div><strong>Publicité VinHT</strong><p>${adsRt.enabled === true ? "Activée" : adsRt.enabled === false ? "Désactivée" : "—"} · Financement : ${esc(adsRt.funding_provider || "—")} (${esc(adsRt.funding_provider_status || "—")})</p>${adsRt.public_message_fr ? `<p class="muted" style="font-size:11px">${esc(adsRt.public_message_fr)}</p>` : ""}</div><a class="btn btn-outline-blue btn-sm" href="ads.html">Ouvrir</a></div>
    </div>

    <div class="portal-card">
      <h3>Abonnements Pro à surveiller</h3>
      <div id="ccProHost">${loading()}</div>
    </div>

    <div class="portal-card">
      <h3>Connexions FlexiCash à surveiller</h3>
      <div id="ccFlexicashHost">${loading()}</div>
    </div>
  `;
}

function ccProRowHtml(r) {
  return `<div class="settings-section"><div><strong>${esc(r.shop_name || "Marchand")}</strong><p>${esc(r.plan_code || "—")} · ${esc(r.status || "—")}${r.latest_invoice_status ? ` · Facture ${esc(r.latest_invoice_status)}${r.latest_invoice_amount_htg != null ? ` (${money(r.latest_invoice_amount_htg)})` : ""}` : ""}${r.latest_invoice_due_at ? ` · Échéance ${esc(fmtDate(r.latest_invoice_due_at))}` : ""}</p></div>${badge(r.status)}</div>`;
}

async function loadProSupervision() {
  const host = document.querySelector("#ccProHost");
  if (!host) return;
  try {
    const [pastDue, suspended] = await Promise.all([
      adminListProfessionalSubscriptions({ status: "past_due", limit: 5, offset: 0 }),
      adminListProfessionalSubscriptions({ status: "suspended", limit: 5, offset: 0 }),
    ]);
    const section = (title, result) => {
      const rows = result.rows || [];
      const countLine = result.total != null
        ? `${rows.length} affiché${rows.length > 1 ? "s" : ""} sur ${result.total}`
        : `${rows.length} affiché${rows.length > 1 ? "s" : ""}`;
      return `<div style="margin-bottom:10px"><div class="toolbar" style="margin-bottom:4px"><strong style="font-size:12px">${esc(title)}</strong><span class="muted" style="font-size:11px">${esc(countLine)}</span></div>${rows.length ? rows.map(ccProRowHtml).join("") : `<p class="muted" style="font-size:12px">Aucun.</p>`}</div>`;
    };
    host.innerHTML = section("En retard de paiement", pastDue) + section("Suspendus", suspended);
    refreshIcons();
  } catch {
    // Panne isolée : le reste du Control Center reste utilisable — jamais
    // "Aucun problème" affiché à la place d'une erreur réelle.
    host.innerHTML = errorBox("Données temporairement indisponibles.");
  }
}

function ccFlexicashRowHtml(r) {
  // payout_ready reste un booléen serveur tri-state du point de vue frontend :
  // true/false sont les seuls états affirmatifs, tout le reste (null/undefined/
  // absent) est un état "inconnu" — jamais assimilé à false (voir #32 correctif 1).
  const ready = r.payout_ready;
  const statusLabel = ready === true ? "Payout prêt" : ready === false ? "Payout non prêt" : "Statut payout indisponible";
  const badgeCls = ready === true ? "green" : ready === false ? "amber" : "";
  return `<div class="settings-section"><div><strong>${esc(r.shop_name || "Marchand")}</strong><p>${esc(r.status || "—")} · ${esc(r.connected_number_masked || "Non connecté")}${r.last_error_code ? ` · Erreur : ${esc(r.last_error_code)}` : ""}</p></div><span class="badge ${badgeCls}">${statusLabel}</span></div>`;
}

async function loadFlexicashSupervision() {
  const host = document.querySelector("#ccFlexicashHost");
  if (!host) return;
  try {
    // Pagination protégée : on parcourt les pages jusqu'à trouver 5 connexions
    // réellement payout_ready === false (jamais null/undefined assimilé à
    // false — voir #32 correctif 2), ou jusqu'à épuisement du dataset.
    const PAGE_SIZE = 20;
    const MAX_FOUND = 5;
    const MAX_PAGES = 25; // borne dure anti-boucle infinie même si has_more mentait
    let offset = 0;
    let scannedTotal = 0;
    let exhausted = false;
    const found = [];
    for (let page = 0; page < MAX_PAGES && found.length < MAX_FOUND; page++) {
      const result = await adminListFlexicashSellerConnections({ status: null, limit: PAGE_SIZE, offset });
      const rows = Array.isArray(result.rows) ? result.rows : [];
      scannedTotal += rows.length;
      for (const r of rows) {
        if (found.length >= MAX_FOUND) break;
        if (r.payout_ready === false) found.push(r);
      }
      if (!rows.length || result.hasMore !== true) { exhausted = true; break; }
      offset += rows.length; // progression réelle basée sur le nombre de lignes reçues
    }
    if (!found.length) {
      host.innerHTML = `<p class="muted" style="font-size:12px">Aucune connexion non prête trouvée${exhausted ? ` (dataset entièrement parcouru, ${scannedTotal} connexions)` : ` (aperçu sur ${scannedTotal} connexions)`}.</p>`;
      return;
    }
    const scopeNote = exhausted
      ? `Recherché sur l'ensemble du jeu de données (${scannedTotal} connexions parcourues).`
      : `Aperçu — recherche arrêtée après ${found.length} trouvée${found.length > 1 ? "s" : ""} sur ${scannedTotal} connexions parcourues.`;
    host.innerHTML = `<p class="muted" style="font-size:11px">${esc(scopeNote)}</p>` + found.map(ccFlexicashRowHtml).join("");
  } catch {
    host.innerHTML = errorBox("Données temporairement indisponibles.");
  }
}

async function dashboard() {
  const host = document.querySelector("#adminDashboardHost");
  if (!host) return;
  host.innerHTML = loading("Chargement du Control Center…");
  let cc;
  try {
    cc = await adminGetPlatformControlCenter();
  } catch {
    host.innerHTML = `<div class="portal-card">${errorBox("Impossible de charger le Control Center.")}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="ccRetry">Réessayer</button></div></div>`;
    host.querySelector("#ccRetry")?.addEventListener("click", () => dashboard());
    return;
  }
  host.innerHTML = controlCenterHtml(cc);
  refreshIcons();
  await Promise.all([loadProSupervision(), loadFlexicashSupervision()]);
}


async function merchants(){const host=document.querySelector("#adminMerchantsHost");if(!host)return;host.innerHTML=loading();try{const [ms,pendingCount,pendingRows]=await Promise.all([getAdminMerchants(),adminCountPendingMerchantApplications().catch(()=>null),adminListMerchantApplications({status:"pending",limit:20}).catch(()=>null)]);
  const appsCard=`<div class="toolbar"><span class="badge amber">${pendingCount?esc(pendingCount.count):"?"} en attente</span><a class="btn btn-ghost btn-sm" href="applications.html">Toutes les demandes</a></div>${pendingRows?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Boutique</th><th>Demandeur</th><th>Type</th><th>KYC</th><th>Date</th></tr></thead><tbody>${pendingRows.rows.map(a=>`<tr><td><a href="application-detail.html?id=${encodeURIComponent(a.id)}"><strong>${esc(a.shop_name)}</strong></a></td><td>${esc(a.full_name||a.email||"—")}</td><td>${esc(a.merchant_type)}</td><td>${kycBadge(a.kyc_status)}</td><td>${esc(fmtDate(a.created_at))}</td></tr>`).join("")||'<tr><td colspan="5">Aucune demande en attente.</td></tr>'}</tbody></table></div>`:errorBox("Demandes marchands indisponibles.")}`;host.innerHTML=`<div class="portal-card"><h3>Demandes marchands</h3>${appsCard}</div><div class="portal-card"><h3>Marchands actifs / enregistrés</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Boutique</th><th>Type</th><th>Plan</th><th>Statut</th><th>Confiance</th><th>Note</th><th>Date</th></tr></thead><tbody>${ms.map(m=>`<tr><td><strong><a href="merchant-detail.html?id=${encodeURIComponent(m.id)}">${esc(m.shop_name)}</a></strong> ${envBadge(m.environment)}</td><td>${esc(m.merchant_type)}</td><td>${esc(m.plan_code)}</td><td>${badge(m.status)}</td><td>${esc(m.trust_score)}/100</td><td>${esc(m.average_rating)}/5</td><td>${esc(fmtDate(m.created_at))}</td></tr>`).join("")}</tbody></table></div></div>`}catch{host.innerHTML=errorBox("Impossible de charger les marchands.")}}

async function orders(){
  const host=document.querySelector("#adminOrdersHost");if(!host)return;host.innerHTML=loading();
  try{
    const env=await getAdminEnvironment().catch(()=>null);
    const [rows,reversalAlerts]=await Promise.all([
      getAdminOrders(),
      env?getAdminPayoutReversalAlerts({environment:env,limit:200}).catch(()=>[]):Promise.resolve([]),
    ]);
    const reversalOrders=new Set(reversalAlerts.map(r=>String(r.order_id)));
    host.innerHTML=`<div class="toolbar"><div class="toolbar-group"><input class="input" id="aoQ" placeholder="Client / email / commande"><select id="aoStatus"><option value="">Tous statuts</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></div>${reversalOrders.size?`<span class="badge red">⚠ ${esc(reversalOrders.size)} versement(s) à régulariser</span>`:""}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Commande</th><th>Client</th><th>Paiement</th><th>Livraison</th><th>Devise</th><th>Total</th><th>Statut</th><th>Date</th></tr></thead><tbody id="aoBody"></tbody></table></div>`;
    const body=host.querySelector("#aoBody");
    const draw=()=>{
      const q=(host.querySelector("#aoQ").value||"").toLowerCase(),s=host.querySelector("#aoStatus").value;
      const list=rows.filter(o=>(!q||String(o.id).toLowerCase().includes(q)||String(o.full_name||"").toLowerCase().includes(q)||String(o.email||"").toLowerCase().includes(q))&&(!s||o.status===s));
      body.innerHTML=list.map(o=>{const currency=rowCurrency(o);const flagged=reversalOrders.has(String(o.id));return `<tr><td><strong><a href="order-detail.html?id=${encodeURIComponent(o.id)}">#${esc(String(o.id).slice(0,8))}</a></strong> ${envBadge(o.environment)}${flagged?' <span class="badge red" title="Versement déjà payé, régularisation requise">⚠ Reversal</span>':""}</td><td><div class="table-primary">${esc(o.full_name||"—")}</div><div class="table-secondary">${esc(o.email||o.phone||"")}</div></td><td>${badge(o.payment_status)}<div class="table-secondary">${esc(o.payment_method||"")}</div></td><td>${esc(o.delivery_type||"—")}</td><td><strong>${esc(currency)}</strong></td><td><strong>${money(rowAmount(o,"total_amount","total_htg"),currency)}</strong></td><td>${badge(o.status)}</td><td>${esc(fmtDate(o.created_at))}</td></tr>`}).join("");
    };
    draw();host.querySelector("#aoQ").addEventListener("input",draw);host.querySelector("#aoStatus").addEventListener("change",draw)
  }catch{host.innerHTML=errorBox("Impossible de charger les commandes.")}
}

async function users(){const host=document.querySelector("#adminUsersHost");if(!host)return;host.innerHTML=loading();try{const rows=await getAdminUsers();host.innerHTML=`<div class="toolbar"><input class="input" id="auQ" placeholder="Nom / email / rôle"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Utilisateur</th><th>Rôles</th><th>Téléphone</th><th>WhatsApp</th><th>Créé</th></tr></thead><tbody id="auBody"></tbody></table></div>`;const body=host.querySelector("#auBody");const draw=()=>{const q=(host.querySelector("#auQ").value||"").toLowerCase();const list=rows.filter(u=>!q||String(u.full_name||"").toLowerCase().includes(q)||String(u.email||"").toLowerCase().includes(q)||(u.roles||[]).join(" ").includes(q));body.innerHTML=list.map(u=>`<tr><td><div class="table-primary"><a href="user-detail.html?id=${encodeURIComponent(u.id)}">${esc(u.full_name||"Sans nom")}</a></div><div class="table-secondary">${esc(u.email||u.id)}</div></td><td>${(u.roles||[]).map(r=>badge(r)).join(" ")}</td><td>${esc(u.phone||"—")}</td><td>${u.whatsapp_updates?'<span class="badge green">Oui</span>':'<span class="badge">Non</span>'}</td><td>${esc(fmtDate(u.created_at))} ${envBadge(u.commerce_environment)}</td></tr>`).join("")};draw();host.querySelector("#auQ").addEventListener("input",draw)}catch{host.innerHTML=errorBox("Impossible de charger les utilisateurs.")}}

// --- Feature #33 — Admin Economic Analytics --------------------------------
// Cockpit économique Admin/CEO au-dessus des RPC #33 exclusivement. Aucune
// vérité financière n'est recomposée ici : GMV, revenu plateforme, contribution,
// refunds, payouts, CTR/success_rate déjà en pourcentage, etc. viennent
// littéralement du backend. "Contribution avant ajustements refunds" N'EST PAS
// un bénéfice net — voir data_quality.* qui le dit explicitement aujourd'hui.
function econMoney(v) { return Number.isFinite(v) ? money(v) : "—"; }
function econCount(v) { return Number.isFinite(v) ? esc(v) : "—"; }
function econPct(v) { return Number.isFinite(v) ? `${v.toFixed(2).replace(".", ",")} %` : "—"; }
function econBool(v, yes, no) { return v === true ? yes : v === false ? no : "—"; }

// Un <input type="date"> ne porte pas de fuseau : on ancre nous-mêmes au
// minuit LOCAL, jamais à un new Date("YYYY-MM-DD") qui serait interprété UTC.
function econLocalDayStartIso(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
function econLocalNextDayStartIso(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return null;
  // Borne haute exclusive (< p_to) : le jour choisi doit être entièrement
  // inclus, donc on vise minuit local du jour SUIVANT.
  const dt = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

const ECON_TIMESERIES_METRICS = {
  gmv_htg: "GMV",
  customer_paid_htg: "Montant payé client",
  refunds_htg: "Refunds",
  commission_htg: "Commission VinHT",
  per_item_fees_htg: "Frais fixes par unité",
  subscription_revenue_htg: "Revenu abonnements",
  flexicash_discount_htg: "Rabais FlexiCash",
};

let _econSeq = 0;
let _econFromInput = "";
let _econToInput = "";
let _econTimeseriesGranularity = "day";
let _econTimeseriesMetric = "gmv_htg";
let _econTopMerchantsSort = "gmv";
let _econTopProductsSort = "sales";
// Séquences indépendantes pour ces contrôles internes : _econSeq protège
// uniquement les changements de période — deux changements rapides de
// granularité/métrique/tri dans la MÊME période partageraient sinon le même
// _econSeq et une réponse ancienne pourrait écraser une réponse plus récente.
let _econTimeseriesSeq = 0;
let _econTopMerchantsLocalSeq = 0;
let _econTopProductsLocalSeq = 0;

function econShellHtml() {
  return `
    <div class="portal-card">
      <div class="toolbar" style="flex-wrap:wrap;gap:10px">
        <div class="toolbar-group" style="flex-wrap:wrap">
          <div class="field"><label style="font-size:11px">Du</label><input class="input" type="date" id="econFrom" value="${esc(_econFromInput)}"></div>
          <div class="field"><label style="font-size:11px">Au</label><input class="input" type="date" id="econTo" value="${esc(_econToInput)}"></div>
          <button class="btn btn-dark btn-sm" type="button" id="econApply" style="align-self:flex-end">Appliquer</button>
        </div>
      </div>
      <p class="muted" style="font-size:11px">Laisser vide pour la période par défaut du serveur (≈ 30 jours, max 730 jours).</p>
      <div id="econPeriodEcho" class="muted" style="font-size:11px"></div>
    </div>
    <div id="econMainHost">${loading("Chargement des indicateurs économiques…")}</div>
  `;
}

function econSummaryHtml(cc) {
  const o = cc.orders, pr = cc.platform_revenue;
  return `<div class="stat-grid">
    <div class="stat-card blue-stat"><div class="label">GMV marchandise</div><div class="value">${econMoney(o.gmv_merchandise_htg)}</div><div class="delta">Après promotions marchands, avant rabais paiement</div></div>
    <div class="stat-card green-stat"><div class="label">Montant payé par les clients</div><div class="value">${econMoney(o.customer_paid_total_htg)}</div><div class="delta">Livraison incluse</div></div>
    <div class="stat-card amber-stat"><div class="label">Revenu plateforme brut</div><div class="value">${econMoney(pr.gross_platform_revenue_htg)}</div><div class="delta">Commission + revenus historiques/optionnels + étiquetage + Ads</div></div>
    <div class="stat-card red-stat"><div class="label">Contribution avant ajustements refunds</div><div class="value">${econMoney(pr.contribution_before_refund_adjustments_htg)}</div><div class="delta"><strong>Ce n'est pas le bénéfice net.</strong></div></div>
  </div>`;
}

function econRevenueHtml(pr) {
  const rows = [
    ["commission_htg", "Commission (5%)"],
    ["per_item_fees_htg", "Frais fixes par unité"],
    ["subscription_revenue_htg", "Revenu abonnements Pro (historique)"],
    ["labeling_revenue_htg", "Revenu étiquetage reconnu"],
    ["ad_revenue_htg", "Dépense Ads reconnue"],
    ["gross_platform_revenue_htg", "Total revenu plateforme brut"],
  ];
  return `<div class="portal-card"><h3>Revenus plateforme</h3>${rows.map(([k, label]) => `<div class="settings-section"><div><strong>${esc(label)}</strong></div><span class="badge">${econMoney(pr[k])}</span></div>`).join("")}</div>`;
}

function econCostHtml(pr) {
  return `<div class="portal-card"><h3>Coûts / contribution</h3>
    <div class="settings-section"><div><strong>Coût rabais FlexiCash</strong><p>Coût VinHT réel — financé dans la commission.</p></div><span class="badge">${econMoney(pr.flexicash_discount_cost_htg)}</span></div>
    <div class="settings-section"><div><strong>Coût estimé étiquetage</strong></div><span class="badge">${econMoney(pr.labeling_estimated_cost_htg)}</span></div>
    <div class="settings-section"><div><strong>Contribution avant ajustements refunds</strong><p><strong>Ce n'est pas le bénéfice net.</strong></p></div><span class="badge">${econMoney(pr.contribution_before_refund_adjustments_htg)}</span></div>
  </div>`;
}

function econRefundsHtml(o) {
  return `<div class="portal-card"><h3>Refunds</h3>
    <div class="settings-section"><div><strong>Commandes remboursées</strong></div><span class="badge">${econCount(o.refunded_orders_count)}</span></div>
    <div class="settings-section"><div><strong>Montant client remboursé</strong></div><span class="badge">${econMoney(o.refunded_customer_total_htg)}</span></div>
    <p class="muted" style="font-size:11px">Les refunds sont suivis séparément — non déduits localement de la contribution.</p>
  </div>`;
}

function econPayoutsHtml(p) {
  return `<div class="portal-card"><h3>Payouts</h3>
    <div class="settings-section"><div><strong>Envoyés sur la période</strong><p>Marqués payés (payout_paid_at) pendant la période sélectionnée.</p></div><span class="badge">${econMoney(p.sent_htg)} · ${econCount(p.sent_count)}</span></div>
    <div class="settings-section"><div><strong>En attente (backlog actuel)</strong><p>État courant, indépendant de la période sélectionnée.</p></div><span class="badge amber">${econMoney(p.pending_htg)} · ${econCount(p.pending_count)}</span></div>
  </div>`;
}

function econSubscriptionsHtml(s) {
  return `<div class="portal-card"><h3>Abonnements Pro</h3>
    <div class="settings-section"><div><strong>Revenu payé sur la période</strong></div><span class="badge">${econMoney(s.paid_revenue_htg)} · ${econCount(s.paid_invoices)} facture(s)</span></div>
    <div class="settings-section"><div><strong>Dû (backlog actuel)</strong><p>État courant, indépendant de la période sélectionnée.</p></div><span class="badge amber">${econMoney(s.due_htg)} · ${econCount(s.past_due_invoices)} en retard</span></div>
  </div>`;
}

function econLabelingHtml(l) {
  return `<div class="portal-card"><h3>Étiquetage</h3>
    <div class="settings-section"><div><strong>Revenu reconnu</strong></div><span class="badge">${econMoney(l.recognized_revenue_htg)}</span></div>
    <div class="settings-section"><div><strong>Coût estimé</strong></div><span class="badge">${econMoney(l.estimated_cost_htg)}</span></div>
    <div class="settings-section"><div><strong>Commandes complétées</strong></div><span class="badge">${econCount(l.completed_orders)}</span></div>
  </div>`;
}

function econAdsHtml(a) {
  return `<div class="portal-card"><h3>Ads</h3>
    <div class="settings-section"><div><strong>Dépense reconnue sur la période</strong></div><span class="badge">${econMoney(a.recognized_spend_htg)}</span></div>
    <div class="settings-section"><div><strong>Clics facturés</strong></div><span class="badge">${econCount(a.billable_clicks)}</span></div>
    <div class="settings-section"><div><strong>Campagnes actives (état courant)</strong></div><span class="badge">${econCount(a.active_campaigns)}</span></div>
  </div>`;
}

function econHealthHtml(h) {
  const sh = h.seller_health || {};
  return `<div class="portal-card"><h3>État marketplace (courant)</h3>
    <div class="stat-grid">
      <div class="stat-card blue-stat"><div class="label">Marchands (total)</div><div class="value">${econCount(h.merchants_total)}</div></div>
      <div class="stat-card green-stat"><div class="label">Marchands actifs</div><div class="value">${econCount(h.merchants_active)}</div></div>
      <div class="stat-card amber-stat"><div class="label">Marchands Pro</div><div class="value">${econCount(h.merchants_pro)}</div></div>
      <div class="stat-card blue-stat"><div class="label">Produits actifs</div><div class="value">${econCount(h.products_active)}</div></div>
    </div>
    <div class="settings-section"><div><strong>Seller Health</strong><p>Excellent ${econCount(sh.excellent)} · Bon ${econCount(sh.good)} · Surveillance ${econCount(sh.watch)} · À risque ${econCount(sh.at_risk)} · Nouveaux ${econCount(sh.new)}</p></div></div>
    <div class="settings-section"><div><strong>Trade Insurance ouverts</strong></div><span class="badge ${Number(h.open_trade_claims) > 0 ? "amber" : ""}">${econCount(h.open_trade_claims)}</span></div>
    <div class="settings-section"><div><strong>Incidents de livraison</strong></div><span class="badge ${Number(h.delivery_issues) > 0 ? "amber" : ""}">${econCount(h.delivery_issues)}</span></div>
  </div>`;
}

function econDataQualityHtml(cc) {
  const dq = cc.data_quality, def = cc.definitions || {};
  return `<div class="portal-card"><h3>Définitions / qualité des données</h3>
    <div class="settings-section"><div><strong>GMV</strong><p>${esc(def.gmv || "—")}</p></div></div>
    <div class="settings-section"><div><strong>Montant payé client</strong><p>${esc(def.customer_paid || "—")}</p></div></div>
    <div class="settings-section"><div><strong>Revenu plateforme</strong><p>${esc(def.platform_revenue || "—")}</p></div></div>
    <div class="settings-section"><div><strong>Contribution</strong><p>${esc(def.contribution || "—")}</p></div></div>
    <p class="muted" style="font-size:12px">${esc(dq.message_fr || "")}</p>
    <div class="settings-section"><div><strong>Revenu net après refunds</strong></div><span class="badge">${econBool(dq.refund_adjusted_net_revenue_available, "Disponible", "Non disponible")}</span></div>
    <div class="settings-section"><div><strong>Bénéfice net comptable</strong></div><span class="badge">${econBool(dq.net_profit_available, "Disponible", "Non disponible")}</span></div>
  </div>`;
}

function econMainHtml(cc) {
  return econSummaryHtml(cc)
    + econRevenueHtml(cc.platform_revenue)
    + econCostHtml(cc.platform_revenue)
    + econRefundsHtml(cc.orders)
    + econPayoutsHtml(cc.payouts)
    + econSubscriptionsHtml(cc.subscriptions)
    + econLabelingHtml(cc.labeling)
    + econAdsHtml(cc.ads)
    + econHealthHtml(cc.marketplace_health)
    + `<div class="portal-card"><h3>Évolution temporelle</h3><div id="econTimeseriesHost">${loading()}</div></div>`
    + `<div class="portal-card"><h3>Providers de paiement</h3><div id="econProvidersHost">${loading()}</div></div>`
    + `<div class="portal-card"><h3>Top 10 marchands</h3><div id="econTopMerchantsHost">${loading()}</div></div>`
    + `<div class="portal-card"><h3>Top 10 produits</h3><div id="econTopProductsHost">${loading()}</div></div>`
    + econDataQualityHtml(cc);
}

function econTimeseriesControlsHtml() {
  const metricOptions = Object.entries(ECON_TIMESERIES_METRICS).map(([k, label]) => `<option value="${esc(k)}" ${k === _econTimeseriesMetric ? "selected" : ""}>${esc(label)}</option>`).join("");
  const granOptions = ["day", "week", "month"].map((g) => `<option value="${g}" ${g === _econTimeseriesGranularity ? "selected" : ""}>${g === "day" ? "Jour" : g === "week" ? "Semaine" : "Mois"}</option>`).join("");
  return `<div class="toolbar-group" style="flex-wrap:wrap;margin-bottom:10px">
    <select class="input" id="econTsMetric">${metricOptions}</select>
    <select class="input" id="econTsGranularity">${granOptions}</select>
  </div>`;
}

async function loadEconTimeseries(seq) {
  const host = document.querySelector("#econTimeseriesHost");
  if (!host) return;
  const localSeq = ++_econTimeseriesSeq;
  const requestedGranularity = _econTimeseriesGranularity;
  const requestedMetric = _econTimeseriesMetric;
  host.innerHTML = econTimeseriesControlsHtml() + loading();
  wireEconTimeseriesControls();
  try {
    const ts = await adminGetEconomicTimeseries({
      from: econLocalDayStartIso(_econFromInput),
      to: econLocalNextDayStartIso(_econToInput),
      granularity: requestedGranularity,
    });
    if (seq !== _econSeq || localSeq !== _econTimeseriesSeq) return;
    const rows = ts.rows;
    const metricKey = requestedMetric;
    // Le wrapper valide déjà que chaque champ métrique est un nombre fini —
    // jamais de repli silencieux vers 0 si le contrat est respecté.
    const values = rows.map((r) => r[metricKey]);
    const max = Math.max(1, ...values.map((v) => Math.abs(v)));
    const bars = rows.length
      ? `<div class="chart-bars">${rows.map((r, i) => `<div class="chart-bar${values[i] < 0 ? " redbar" : ""}" style="height:${Math.max(4, Math.round((Math.abs(values[i]) / max) * 100))}%"><span>${esc(String(r.bucket))} · ${econMoney(r[metricKey])}</span></div>`).join("")}</div>`
      : `<p class="muted" style="font-size:12px">Aucune donnée sur cette période.</p>`;
    const table = rows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Période</th><th>${esc(ECON_TIMESERIES_METRICS[metricKey])}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(String(r.bucket))}</td><td>${econMoney(r[metricKey])}</td></tr>`).join("")}</tbody></table></div>`
      : "";
    host.innerHTML = econTimeseriesControlsHtml() + bars + table;
    wireEconTimeseriesControls();
    refreshIcons();
  } catch {
    if (seq !== _econSeq || localSeq !== _econTimeseriesSeq) return;
    host.innerHTML = econTimeseriesControlsHtml() + errorBox("Données temporairement indisponibles.");
    wireEconTimeseriesControls();
  }
}

function wireEconTimeseriesControls() {
  const metricSel = document.querySelector("#econTsMetric");
  const granSel = document.querySelector("#econTsGranularity");
  if (metricSel && !metricSel.dataset.wired) {
    metricSel.dataset.wired = "1";
    metricSel.addEventListener("change", (e) => { _econTimeseriesMetric = e.target.value; loadEconTimeseries(_econSeq); });
  }
  if (granSel && !granSel.dataset.wired) {
    granSel.dataset.wired = "1";
    granSel.addEventListener("change", (e) => { _econTimeseriesGranularity = e.target.value; loadEconTimeseries(_econSeq); });
  }
}

async function loadEconProviders(seq) {
  const host = document.querySelector("#econProvidersHost");
  if (!host) return;
  try {
    const pa = await adminGetPaymentProviderAnalytics({ from: econLocalDayStartIso(_econFromInput), to: econLocalNextDayStartIso(_econToInput) });
    if (seq !== _econSeq) return;
    const attemptsRows = pa.provider_attempts.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Provider</th><th>Tentatives</th><th>Payées</th><th>Échouées</th><th>Volume payé</th><th>Taux de succès</th></tr></thead><tbody>${pa.provider_attempts.map((p) => `<tr><td>${esc(p.provider)}</td><td>${econCount(p.attempts)}</td><td>${econCount(p.paid_attempts)}</td><td>${econCount(p.failed_attempts)}</td><td>${econMoney(p.paid_volume_htg)}</td><td>${econPct(p.success_rate_pct)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted" style="font-size:12px">Aucune tentative de paiement sur cette période.</p>`;
    const settledRows = pa.settled_orders_by_payment_method.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mode de paiement</th><th>Commandes payées</th><th>Volume payé</th><th>Rabais paiement</th></tr></thead><tbody>${pa.settled_orders_by_payment_method.map((s) => `<tr><td>${esc(s.payment_method)}</td><td>${econCount(s.paid_orders)}</td><td>${econMoney(s.paid_volume_htg)}</td><td>${econMoney(s.payment_discount_htg)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted" style="font-size:12px">Aucune commande réglée sur cette période.</p>`;
    host.innerHTML = `<h4 style="margin:0 0 6px">Tentatives par provider</h4>${attemptsRows}<h4 style="margin:14px 0 6px">Commandes réglées par mode de paiement</h4>${settledRows}`;
  } catch {
    if (seq !== _econSeq) return;
    host.innerHTML = errorBox("Données temporairement indisponibles.");
  }
}

function econTopMerchantsControlsHtml() {
  const sorts = { gmv: "GMV", platform_revenue: "Frais VinHT sur ventes", orders: "Commandes", payout: "Payout" };
  return `<div class="toolbar-group" style="margin-bottom:10px"><select class="input" id="econTopMerchantsSort">${Object.entries(sorts).map(([k, label]) => `<option value="${k}" ${k === _econTopMerchantsSort ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>`;
}

async function loadEconTopMerchants(seq) {
  const host = document.querySelector("#econTopMerchantsHost");
  if (!host) return;
  const localSeq = ++_econTopMerchantsLocalSeq;
  const requestedSort = _econTopMerchantsSort;
  host.innerHTML = econTopMerchantsControlsHtml() + loading();
  wireEconTopMerchantsControls();
  try {
    const rows = await adminListTopMerchants({ from: econLocalDayStartIso(_econFromInput), to: econLocalNextDayStartIso(_econToInput), sort: requestedSort, limit: 10, offset: 0 });
    if (seq !== _econSeq || localSeq !== _econTopMerchantsLocalSeq) return;
    const table = rows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Marchand</th><th>Type</th><th>Commandes</th><th>GMV</th><th>Frais VinHT sur ventes</th><th>Payout (période)</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${econCount(r.rank)}</td><td>${esc(r.shop_name)}</td><td>${esc(r.merchant_type || "—")}</td><td>${econCount(r.merchant_orders)}</td><td>${econMoney(r.gmv_htg)}</td><td>${econMoney(r.platform_revenue_htg)}</td><td>${econMoney(r.payout_htg)}</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:11px">Payout de la période — ne constitue pas une preuve de transfert réel par le provider.</p>`
      : `<p class="muted" style="font-size:12px">Aucun marchand sur cette période.</p>`;
    host.innerHTML = econTopMerchantsControlsHtml() + table;
    wireEconTopMerchantsControls();
  } catch {
    if (seq !== _econSeq || localSeq !== _econTopMerchantsLocalSeq) return;
    host.innerHTML = econTopMerchantsControlsHtml() + errorBox("Données temporairement indisponibles.");
    wireEconTopMerchantsControls();
  }
}

function wireEconTopMerchantsControls() {
  const sel = document.querySelector("#econTopMerchantsSort");
  if (sel && !sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", (e) => { _econTopMerchantsSort = e.target.value; loadEconTopMerchants(_econSeq); });
  }
}

function econTopProductsControlsHtml() {
  const sorts = { sales: "Ventes (HTG)", units: "Unités vendues", orders: "Commandes" };
  return `<div class="toolbar-group" style="margin-bottom:10px"><select class="input" id="econTopProductsSort">${Object.entries(sorts).map(([k, label]) => `<option value="${k}" ${k === _econTopProductsSort ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>`;
}

async function loadEconTopProducts(seq) {
  const host = document.querySelector("#econTopProductsHost");
  if (!host) return;
  const localSeq = ++_econTopProductsLocalSeq;
  const requestedSort = _econTopProductsSort;
  host.innerHTML = econTopProductsControlsHtml() + loading();
  wireEconTopProductsControls();
  try {
    const rows = await adminListTopProducts({ from: econLocalDayStartIso(_econFromInput), to: econLocalNextDayStartIso(_econToInput), sort: requestedSort, limit: 10, offset: 0 });
    if (seq !== _econSeq || localSeq !== _econTopProductsLocalSeq) return;
    const table = rows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Produit</th><th>Commandes payées</th><th>Unités vendues</th><th>Ventes (HTG)</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${econCount(r.rank)}</td><td><a href="product-detail.html?id=${encodeURIComponent(r.product_id)}">${esc(r.product_name)}</a></td><td>${econCount(r.paid_orders)}</td><td>${econCount(r.units_sold)}</td><td>${econMoney(r.sales_htg)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted" style="font-size:12px">Aucun produit vendu sur cette période.</p>`;
    host.innerHTML = econTopProductsControlsHtml() + table;
    wireEconTopProductsControls();
  } catch {
    if (seq !== _econSeq || localSeq !== _econTopProductsLocalSeq) return;
    host.innerHTML = econTopProductsControlsHtml() + errorBox("Données temporairement indisponibles.");
    wireEconTopProductsControls();
  }
}

function wireEconTopProductsControls() {
  const sel = document.querySelector("#econTopProductsSort");
  if (sel && !sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", (e) => { _econTopProductsSort = e.target.value; loadEconTopProducts(_econSeq); });
  }
}

async function runEconomicAnalytics() {
  const seq = ++_econSeq;
  const applyBtn = document.querySelector("#econApply");
  if (applyBtn) applyBtn.disabled = true;
  const mainHost = document.querySelector("#econMainHost");
  const periodEcho = document.querySelector("#econPeriodEcho");
  if (mainHost) mainHost.innerHTML = loading("Chargement des indicateurs économiques…");
  const from = econLocalDayStartIso(_econFromInput);
  const to = econLocalNextDayStartIso(_econToInput);
  let cc;
  try {
    cc = await adminGetEconomicDashboard({ from, to });
  } catch {
    if (seq !== _econSeq) return;
    if (mainHost) mainHost.innerHTML = `<div class="portal-card">${errorBox("Données économiques principales indisponibles.")}<div class="toolbar-group" style="margin-top:10px"><button class="btn btn-outline-blue btn-sm" type="button" id="econRetry">Réessayer</button></div></div>`;
    document.querySelector("#econRetry")?.addEventListener("click", () => runEconomicAnalytics());
    if (applyBtn) applyBtn.disabled = false;
    return;
  }
  if (seq !== _econSeq) return;
  // On affiche la période RÉELLEMENT retournée par le serveur — jamais une
  // période supposée côté client avant la réponse.
  if (periodEcho) periodEcho.textContent = cc.period?.from && cc.period?.to ? `Période appliquée : ${fmtDate(cc.period.from)} → ${fmtDate(cc.period.to)}` : "";
  if (mainHost) mainHost.innerHTML = econMainHtml(cc);
  refreshIcons();
  if (applyBtn) applyBtn.disabled = false;
  await Promise.all([
    loadEconTimeseries(seq),
    loadEconProviders(seq),
    loadEconTopMerchants(seq),
    loadEconTopProducts(seq),
  ]);
}

async function analytics() {
  const host = document.querySelector("#adminAnalyticsHost");
  if (!host) return;
  host.innerHTML = econShellHtml();
  const applyBtn = document.querySelector("#econApply");
  if (applyBtn && !applyBtn.dataset.wired) {
    applyBtn.dataset.wired = "1";
    applyBtn.addEventListener("click", () => {
      _econFromInput = document.querySelector("#econFrom")?.value || "";
      _econToInput = document.querySelector("#econTo")?.value || "";
      runEconomicAnalytics();
    });
  }
  await runEconomicAnalytics();
}

// Feature #27 — Admin ne lit plus directement la table `notifications` pour
// fabriquer un pseudo-dashboard : la liste/création/annulation passent par
// les RPC officielles admin_*_notification_campaign_v1.
let _adminCampaignSource = "", _adminCampaignStatus = "";
let _adminCampaignRows = [], _adminCampaignOffset = 0, _adminCampaignHasMore = false, _adminCampaignSeq = 0;
const ADMIN_CAMPAIGN_PAGE_SIZE = 20;

function adminCampaignRowHtml(c) {
  return `<div class="settings-section" data-admin-campaign="${esc(c.campaign_id)}">
    <div><strong>${esc(c.title)}</strong><p>${esc(c.message)}</p><div class="table-secondary">${badge(c.status)} ${esc(CAMPAIGN_STATUS_FR[c.status]||c.status)} · ${esc(NOTIFICATION_CATEGORY_FR[c.category]||c.category)} · Source : ${c.source_type==="merchant"?`Marchand${c.source_merchant_name?` (${esc(c.source_merchant_name)})`:""}`:"Admin"} · ${esc(fmtDate(c.created_at))} · ${esc(c.notifications_created??0)} envoyée(s)</div></div>
    ${c.can_cancel?`<button class="btn btn-outline-red btn-sm" data-admin-cancel-campaign type="button">Annuler</button>`:""}
  </div>`;
}

async function runAdminCampaignsSearch(reset){
  const host=document.querySelector("#adminNotificationsHost");
  const loadMoreWrap=document.querySelector("#adminCampaignsLoadMoreWrap");
  if(!host)return;
  const seq=++_adminCampaignSeq;
  const offset=reset?0:_adminCampaignOffset;
  if(reset){_adminCampaignOffset=0;_adminCampaignRows=[];host.innerHTML=loading();}
  else{const b=loadMoreWrap?.querySelector("#adminCampaignLoadMore");if(b)b.disabled=true;}
  try{
    const result=await adminListNotificationCampaigns({sourceType:_adminCampaignSource||null,status:_adminCampaignStatus||null,limit:ADMIN_CAMPAIGN_PAGE_SIZE,offset});
    if(seq!==_adminCampaignSeq)return;
    const merged=reset?result.rows:_adminCampaignRows.concat(result.rows);
    const seen=new Set();
    _adminCampaignRows=merged.filter(r=>{const id=String(r?.campaign_id||"");if(!id||seen.has(id))return false;seen.add(id);return true;});
    _adminCampaignHasMore=result.hasMore;
    _adminCampaignOffset=offset+result.rows.length;
    if(!_adminCampaignRows.length){host.innerHTML=empty("Aucune campagne","Aucune campagne pour ce filtre.");if(loadMoreWrap)loadMoreWrap.innerHTML="";refreshIcons();return}
    host.innerHTML=_adminCampaignRows.map(adminCampaignRowHtml).join("");
    refreshIcons();
    host.querySelectorAll("[data-admin-cancel-campaign]").forEach(btn=>btn.addEventListener("click",async()=>{
      if(!window.confirm("Annuler cette campagne ?"))return;
      const row=btn.closest("[data-admin-campaign]");btn.disabled=true;
      try{await cancelMyNotificationCampaign(row.dataset.adminCampaign);showToast("Campagne annulée ✓");await runAdminCampaignsSearch(true)}
      catch(err){btn.disabled=false;showToast(notificationErrorMessageFr(err?.message,"Impossible d'annuler cette campagne."),"red")}
    }));
    if(loadMoreWrap){
      loadMoreWrap.innerHTML=_adminCampaignHasMore?`<button class="btn btn-outline-blue btn-sm" id="adminCampaignLoadMore" type="button">Charger plus</button>`:"";
      loadMoreWrap.querySelector("#adminCampaignLoadMore")?.addEventListener("click",()=>runAdminCampaignsSearch(false));
    }
  }catch(err){
    if(seq!==_adminCampaignSeq)return;
    host.innerHTML=errorBox(notificationErrorMessageFr(err?.message,"Impossible de charger les campagnes."));
    if(loadMoreWrap)loadMoreWrap.innerHTML="";
  }
}

async function notifications(){
  const catSelect=document.querySelector("#adminCampaignCategory");
  const audSelect=document.querySelector("#adminCampaignAudience");
  const prioSelect=document.querySelector("#adminCampaignPriority");
  if(catSelect&&!catSelect.options.length)catSelect.innerHTML=ADMIN_CAMPAIGN_CATEGORIES.map(c=>`<option value="${esc(c)}">${esc(NOTIFICATION_CATEGORY_FR[c]||c)}</option>`).join("");
  if(audSelect&&!audSelect.options.length)audSelect.innerHTML=ADMIN_CAMPAIGN_AUDIENCES.map(a=>`<option value="${esc(a)}">${esc(ADMIN_CAMPAIGN_AUDIENCE_FR[a]||a)}</option>`).join("");
  if(prioSelect&&!prioSelect.options.length)prioSelect.innerHTML=ADMIN_CAMPAIGN_PRIORITIES.map(p=>`<option value="${esc(p)}"${p==="normal"?" selected":""}>${esc(CAMPAIGN_PRIORITY_FR[p]||p)}</option>`).join("");

  const sourceFilter=document.querySelector("#adminCampaignSourceFilter");
  if(sourceFilter&&!sourceFilter.dataset.wired){sourceFilter.dataset.wired="1";sourceFilter.addEventListener("change",(e)=>{_adminCampaignSource=e.target.value;runAdminCampaignsSearch(true)});}
  const statusFilter=document.querySelector("#adminCampaignStatusFilter");
  if(statusFilter&&!statusFilter.dataset.wired){statusFilter.dataset.wired="1";statusFilter.addEventListener("change",(e)=>{_adminCampaignStatus=e.target.value;runAdminCampaignsSearch(true)});}

  // Garde anti double-câblage : si cette fonction est un jour rappelée sur la
  // même page (ré-init auth), on n'empile jamais un second listener submit,
  // ce qui enverrait deux fois la même campagne (leçon #27 merchant).
  const form=document.querySelector("#adminCampaignForm");
  if(form&&!form.dataset.wired){
  form.dataset.wired="1";
  form.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const fd=new FormData(form);
    const title=(fd.get("title")||"").trim();
    const message=(fd.get("message")||"").trim();
    const actionPathRaw=(fd.get("action_path")||"").trim();
    const category=fd.get("category");
    const audienceType=fd.get("audience_type");
    const scheduledRaw=fd.get("scheduled_at");
    const msgBox=document.querySelector("#adminCampaignFormMsg");
    const showMsg=(text,ok)=>{if(msgBox){msgBox.textContent=text;msgBox.style.display="";msgBox.style.color=ok?"var(--green,#25a844)":"var(--red,#b0122a)"}};
    if(actionPathRaw&&!isSafeInternalActionPath(actionPathRaw)){showMsg("Ce lien n'est pas un chemin VinHT interne valide.",false);return}
    let scheduledAt=null;
    if(scheduledRaw){
      const d=new Date(scheduledRaw);
      if(Number.isNaN(d.getTime())){showMsg("Date de planification invalide.",false);return}
      scheduledAt=d.toISOString();
    }
    const btn=form.querySelector('button[type="submit"]');
    // Verrou posé dès l'entrée du submit (avant même le preview) : sinon deux
    // clics rapides peuvent chacun lancer leur propre preview avant que le
    // premier n'ait eu le temps de désactiver le bouton.
    if(btn.dataset.submitting==="1")return;
    btn.dataset.submitting="1";
    btn.disabled=true;
    try{
      // Preview obligatoire, read-only, jamais un create Production sans que
      // l'admin ait vu l'audience réelle et le nombre de destinataires éligibles.
      let preview;
      try{ preview=await adminPreviewNotificationCampaign({category,audienceType}); }
      catch(err){ showMsg(notificationErrorMessageFr(err?.message,"Impossible de prévisualiser cette campagne."),false); return }
      const envLabel=String(preview.environment||"").toLowerCase()==="production"?"ATTENTION — PRODUCTION\n\n":"";
      const confirmText=`${envLabel}Cette campagne peut créer des notifications pour ${preview.audience_total} utilisateur(s).\n${preview.eligible_in_app_recipients} destinataire(s) in-app sont actuellement éligibles.\nCatégorie : ${NOTIFICATION_CATEGORY_FR[preview.category]||preview.category}\nAudience : ${ADMIN_CAMPAIGN_AUDIENCE_FR[preview.audience_type]||preview.audience_type}\n\nConfirmer l'envoi ?`;
      if(!window.confirm(confirmText))return;

      const result=await adminCreateNotificationCampaign({category,title,message,audienceType,actionPath:actionPathRaw||null,priority:fd.get("priority"),scheduledAt});
      showMsg(campaignCreationResultMessageFr(result?.status),true);
      form.reset();
      await runAdminCampaignsSearch(true);
    }catch(err){
      showMsg(notificationErrorMessageFr(err?.message,"Impossible d'envoyer cette campagne."),false);
    }finally{btn.dataset.submitting="";btn.disabled=false}
  });
  }

  await runAdminCampaignsSearch(true);
}

// --- Feature #28 — Admin Promotions --------------------------------------
// admin_set_promotion_runtime_v1 change une disponibilité réelle pour tous
// les marchands d'un environnement : confirmation explicite obligatoire,
// motif obligatoire, jamais de mutation Production testée en QA. Après
// mutation, re-fetch admin_get_promotion_runtime_v1 (jamais un état local
// recalculé).
async function renderAdminPromoRuntime() {
  const host = document.querySelector("#adminPromoRuntimeHost");
  if (!host) return;
  host.innerHTML = loading();
  let rows;
  try { rows = await adminGetPromotionRuntime(null); }
  catch (err) { host.innerHTML = errorBox(promotionErrorMessageFr(err?.message, "Impossible de charger l'état des promotions.")); return; }
  host.innerHTML = rows.map((r) => `<div class="settings-section" data-promo-env="${esc(r.environment)}">
    <div><strong>${esc(r.environment === "production" ? "Production" : "Demo")}</strong><p>Max ${esc(r.max_active_promotions_per_merchant)} promotions actives par marchand · MAJ ${esc(fmtDate(r.updated_at))}</p></div>
    <div class="toolbar-group" style="flex-wrap:wrap">
      <span class="badge ${r.promotions_enabled ? "green" : ""}">${r.promotions_enabled ? "Promotions ON" : "Promotions OFF"}</span>
      <span class="badge ${r.automatic_promotions_enabled ? "green" : ""}">${r.automatic_promotions_enabled ? "Auto ON" : "Auto OFF"}</span>
      <button class="btn btn-outline-blue btn-sm" data-promo-runtime-edit type="button">Modifier</button>
    </div>
    <div class="settings-section" data-promo-runtime-form hidden style="flex-direction:column;align-items:stretch;gap:8px">
      <label style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-runtime-enabled ${r.promotions_enabled ? "checked" : ""}> Promotions activées</label>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-runtime-auto ${r.automatic_promotions_enabled ? "checked" : ""}> Promotions automatiques activées</label>
      <input class="input" type="text" data-runtime-reason placeholder="Motif (obligatoire)">
      <div class="toolbar-group"><button class="btn btn-dark btn-sm" data-promo-runtime-save type="button">Enregistrer</button><button class="btn btn-ghost btn-sm" data-promo-runtime-cancel type="button">Annuler</button></div>
      <div data-promo-runtime-msg style="font-size:12px;display:none"></div>
    </div>
  </div>`).join("");
  refreshIcons();

  host.querySelectorAll("[data-promo-runtime-edit]").forEach((btn) => btn.addEventListener("click", () => {
    btn.closest("[data-promo-env]").querySelector("[data-promo-runtime-form]").hidden = false;
  }));
  host.querySelectorAll("[data-promo-runtime-cancel]").forEach((btn) => btn.addEventListener("click", () => {
    btn.closest("[data-promo-runtime-form]").hidden = true;
  }));
  host.querySelectorAll("[data-promo-runtime-save]").forEach((btn) => btn.addEventListener("click", async () => {
    const section = btn.closest("[data-promo-env]");
    const environment = section.dataset.promoEnv;
    const enabled = section.querySelector("[data-runtime-enabled]").checked;
    const automaticEnabled = section.querySelector("[data-runtime-auto]").checked;
    const reason = (section.querySelector("[data-runtime-reason]").value || "").trim();
    const msgBox = section.querySelector("[data-promo-runtime-msg]");
    const showMsg = (text, ok) => { if (msgBox) { msgBox.textContent = text; msgBox.style.display = ""; msgBox.style.color = ok ? "var(--green,#25a844)" : "var(--red,#b0122a)"; } };
    if (!reason) { showMsg("Un motif est requis.", false); return; }
    const envLabel = environment === "production" ? "\n\nATTENTION — PRODUCTION\n\nVous êtes sur le point de modifier la disponibilité réelle des coupons pour les utilisateurs VinHT." : "";
    if (!window.confirm(`Modifier les promotions pour l'environnement ${environment} ?${envLabel}\n\nConfirmer ?`)) return;
    if (btn.dataset.submitting === "1") return;
    btn.dataset.submitting = "1"; btn.disabled = true;
    try {
      await adminSetPromotionRuntime({ environment, enabled, automaticEnabled, reason });
    } catch (err) {
      showMsg(promotionErrorMessageFr(err?.message, "Impossible de modifier ce runtime."), false);
      btn.dataset.submitting = ""; btn.disabled = false;
      return;
    }
    showToast("Runtime des promotions mis à jour ✓");
    try {
      await renderAdminPromoRuntime();
    } catch {
      showMsg("Runtime mis à jour, mais l'actualisation a échoué. Rechargez la page pour voir l'état à jour.", false);
    }
  }));
}

let _adminPromoStatusFilter = "";
let _adminPromoRows = [], _adminPromoOffset = 0, _adminPromoHasMore = false, _adminPromoSeq = 0;
const ADMIN_PROMO_PAGE_SIZE = 20;

function adminPromoRowHtml(p) {
  const discount = p.discount_type === "percent" ? `${esc(p.discount_value)}%` : money(p.discount_value);
  return `<div class="settings-section" data-admin-promo="${esc(p.promotion_id)}">
    <div><strong>${esc(p.shop_name || "Marchand")}</strong>${p.mode === "code" ? ` · <code>${esc(p.code)}</code>` : ""}<p>${esc(p.name)} · ${discount} · ${esc(PROMOTION_SCOPE_FR[p.scope_type] || p.scope_type)} · ${esc(p.consumed_count ?? p.usage?.consumed ?? 0)} utilisée(s) · ${money(p.discount_granted_htg ?? p.usage?.discount_granted_htg ?? 0)}</p></div>
    <div class="toolbar-group">
      <span class="badge ${p.status === "active" ? "green" : p.status === "disabled" ? "red" : p.status === "paused" ? "amber" : "blue"}">${esc(PROMOTION_STATUS_FR[p.status] || p.status)}</span>
      ${p.status !== "disabled" ? `<button class="btn btn-outline-red btn-sm" data-admin-promo-disable type="button">Désactiver</button>` : ""}
    </div>
  </div>`;
}

async function runAdminPromoListSearch(reset) {
  const host = document.querySelector("#adminPromoListHost");
  const loadMoreWrap = document.querySelector("#adminPromoListLoadMoreWrap");
  if (!host) return;
  const seq = ++_adminPromoSeq;
  const offset = reset ? 0 : _adminPromoOffset;
  if (reset) { _adminPromoOffset = 0; _adminPromoRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#adminPromoLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await adminListMerchantPromotions({ status: _adminPromoStatusFilter || null, limit: ADMIN_PROMO_PAGE_SIZE, offset });
    if (seq !== _adminPromoSeq) return;
    const merged = reset ? result.rows : _adminPromoRows.concat(result.rows);
    const seen = new Set();
    _adminPromoRows = merged.filter((r) => { const id = String(r?.promotion_id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _adminPromoHasMore = result.hasMore;
    _adminPromoOffset = offset + result.rows.length;
    if (!_adminPromoRows.length) { host.innerHTML = empty("Aucune promotion", "Aucune promotion pour ce filtre."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = _adminPromoRows.map(adminPromoRowHtml).join("");
    refreshIcons();
    host.querySelectorAll("[data-admin-promo-disable]").forEach((btn) => btn.addEventListener("click", async () => {
      const row = btn.closest("[data-admin-promo]");
      const reason = window.prompt("Motif de désactivation (obligatoire) :");
      if (reason === null) return;
      if (!reason.trim()) { showToast("Un motif est requis.", "red"); return; }
      if (!window.confirm("Confirmer la désactivation de cette promotion ?")) return;
      btn.disabled = true;
      try {
        await adminDisableMerchantPromotion(row.dataset.adminPromo, reason.trim());
      } catch (err) {
        showToast(promotionErrorMessageFr(err?.message, "Impossible de désactiver cette promotion."), "red");
        btn.disabled = false;
        return;
      }
      showToast("Promotion désactivée ✓");
      try {
        await runAdminPromoListSearch(true);
      } catch {
        showToast("Promotion désactivée, mais l'actualisation de la liste a échoué. Rechargez la page.", "red");
      }
    }));
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _adminPromoHasMore ? `<button class="btn btn-outline-blue btn-sm" id="adminPromoLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#adminPromoLoadMore")?.addEventListener("click", () => runAdminPromoListSearch(false));
    }
  } catch (err) {
    if (seq !== _adminPromoSeq) return;
    host.innerHTML = errorBox(promotionErrorMessageFr(err?.message, "Impossible de charger les promotions."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

async function adminPromotionsPage() {
  await renderAdminPromoRuntime();
  const statusFilter = document.querySelector("#adminPromoStatusFilter");
  if (statusFilter && !statusFilter.dataset.wired) {
    statusFilter.dataset.wired = "1";
    statusFilter.addEventListener("change", (e) => { _adminPromoStatusFilter = e.target.value; runAdminPromoListSearch(true); });
  }
  await runAdminPromoListSearch(true);
}

// --- Feature #29 — Admin Ads (supervision, lecture seule) -----------------
// Aucune RPC frontend d'activation du moteur Ads n'existe aujourd'hui —
// jamais de faux bouton Activer/Désactiver ni de mise à jour directe de
// marketplace_ads_runtime depuis cette page (voir #29 §29).
let _adminAdsStatusFilter = "";
let _adminAdsRows = [], _adminAdsOffset = 0, _adminAdsHasMore = false, _adminAdsSeq = 0;
const ADMIN_ADS_PAGE_SIZE = 20;

function adminAdsPlacementsLabel(placements) {
  return (Array.isArray(placements) ? placements : []).map((p) => AD_PLACEMENT_FR[p] || p).join(", ");
}

function adminAdsRowHtml(c) {
  return `<div class="settings-section" data-admin-ads="${esc(c.id)}">
    <div><strong>${esc(c.shop_name || "Marchand")}</strong> · ${esc(c.name)}<p>${esc(c.product_name || "")} · ${esc(adminAdsPlacementsLabel(c.placements))} · Budget ${money(c.total_budget_htg)} · Dépensé ${money(c.spent_htg)} · ${esc(c.impressions ?? 0)} impr. · ${esc(c.billable_clicks ?? c.clicks ?? 0)} clics facturés</p></div>
    <div class="toolbar-group">
      <span class="badge">${esc(AD_FUNDING_STATUS_FR[c.funding_status] || c.funding_status)}</span>
      <span class="badge ${c.status === "active" ? "green" : c.status === "paused" ? "amber" : (c.status === "cancelled" || c.status === "exhausted") ? "red" : "blue"}">${esc(AD_CAMPAIGN_STATUS_FR[c.status] || c.status)}</span>
    </div>
  </div>`;
}

async function runAdminAdsListSearch(reset) {
  const host = document.querySelector("#adminAdsListHost");
  const loadMoreWrap = document.querySelector("#adminAdsListLoadMoreWrap");
  if (!host) return;
  const seq = ++_adminAdsSeq;
  const offset = reset ? 0 : _adminAdsOffset;
  if (reset) { _adminAdsOffset = 0; _adminAdsRows = []; host.innerHTML = loading(); }
  else { const b = loadMoreWrap?.querySelector("#adminAdsLoadMore"); if (b) b.disabled = true; }
  try {
    const result = await adminListAdCampaigns({ status: _adminAdsStatusFilter || null, limit: ADMIN_ADS_PAGE_SIZE, offset });
    if (seq !== _adminAdsSeq) return;
    const merged = reset ? result.rows : _adminAdsRows.concat(result.rows);
    const seen = new Set();
    _adminAdsRows = merged.filter((r) => { const id = String(r?.id || ""); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    _adminAdsHasMore = result.hasMore;
    _adminAdsOffset = offset + result.rows.length;
    if (!_adminAdsRows.length) { host.innerHTML = empty("Aucune campagne", "Aucune campagne pour ce filtre."); if (loadMoreWrap) loadMoreWrap.innerHTML = ""; refreshIcons(); return; }
    host.innerHTML = _adminAdsRows.map(adminAdsRowHtml).join("");
    refreshIcons();
    if (loadMoreWrap) {
      loadMoreWrap.innerHTML = _adminAdsHasMore ? `<button class="btn btn-outline-blue btn-sm" id="adminAdsLoadMore" type="button">Charger plus</button>` : "";
      loadMoreWrap.querySelector("#adminAdsLoadMore")?.addEventListener("click", () => runAdminAdsListSearch(false));
    }
  } catch (err) {
    if (seq !== _adminAdsSeq) return;
    host.innerHTML = errorBox(adsErrorMessageFr(err?.message, "Impossible de charger les campagnes publicitaires."));
    if (loadMoreWrap) loadMoreWrap.innerHTML = "";
  }
}

async function adminAdsPage() {
  const statusFilter = document.querySelector("#adminAdsStatusFilter");
  if (statusFilter && !statusFilter.dataset.wired) {
    statusFilter.dataset.wired = "1";
    statusFilter.addEventListener("change", (e) => { _adminAdsStatusFilter = e.target.value; runAdminAdsListSearch(true); });
  }
  await runAdminAdsListSearch(true);
}

// opts.only : null (tout) | "commerce" (offre de lancement + livraison USD) | "logistics" (livreurs & marketplace)
// opts.env  : environnement admin courant ("demo" | "production") pour la livraison USD.
async function settings(hostArg,opts={}){
  const host=hostArg||document.querySelector("#adminSettingsHost");
  if(!host)return;
  const only=opts.only||null;
  let usdEnv=(opts.env==="demo"||opts.env==="production")?opts.env:null;
  if(!usdEnv){try{usdEnv=await getAdminEnvironment()}catch{usdEnv=null}}
  const p=getUiPreferences();
  host.innerHTML=`<div class="portal-card"><h3>Préférences d’interface</h3><p class="muted">Ces réglages concernent uniquement cet appareil. Ils ne prétendent pas modifier une configuration serveur VinHT.</p><form id="adminUiSettings"><div class="settings-section"><div><strong>Grille compacte</strong><p>Affiche davantage de lignes et de cartes dans les écrans d’administration.</p></div><label class="switch"><input type="checkbox" name="compact_grid"><span></span></label></div><div class="settings-section"><div><strong>Réduire les animations</strong><p>Réduit les animations visuelles sur cet appareil.</p></div><label class="switch"><input type="checkbox" name="reduce_motion"><span></span></label></div></form></div><div class="portal-card" id="individualPricingCard"><h3>Offre de lancement Marketplace</h3><div class="loading-state">Chargement de la campagne…</div></div><div class="portal-card" id="usdShippingPricingCard"><h3>Livraison USD — Production</h3><div class="loading-state">Chargement des paramètres logistiques…</div></div><div class="portal-card" id="courierLogisticsControlCard"><h3>Livreurs & marketplace — Production</h3><div class="loading-state">Chargement du contrôle logistique…</div></div><div class="portal-card"><h3>Paramètres opérationnels V1</h3><div class="settings-section"><div><strong>Approbation marchand</strong><p>Décision via <code>admin_approve_merchant_application_v1</code> / <code>admin_reject_merchant_application_v1</code> (rôle admin et environnement vérifiés serveur).</p></div><span class="badge green">RPC actif</span></div><div class="settings-section"><div><strong>Validation produits</strong><p>Décision via RPC <code>admin_review_product</code> (approve/reject, métadonnées serveur). Aucun UPDATE direct navigateur.</p></div><span class="badge green">RPC actif</span></div><div class="settings-section"><div><strong>Notifications</strong><p>Les campagnes admin/marchand passent par les RPC officielles (admin_list_notification_campaigns_v1, admin_create_notification_campaign_v1). Aucun faux provider SMS/WhatsApp n’est annoncé.</p></div><span class="badge green">RPC actif</span></div></div>`;
  if(only){
    const keep=only==="commerce"?["individualPricingCard","usdShippingPricingCard"]:["courierLogisticsControlCard"];
    [...host.children].forEach((ch)=>{if(!keep.includes(ch.id))ch.remove()});
  }
  const form=host.querySelector("#adminUiSettings");
  if(form){
    form.compact_grid.checked=!!p.compactGrid;
    form.reduce_motion.checked=!!p.reduceMotion;
    form.compact_grid.addEventListener("change",()=>setUiPreferences({compactGrid:form.compact_grid.checked}));
    form.reduce_motion.addEventListener("change",()=>setUiPreferences({reduceMotion:form.reduce_motion.checked}));
  }


  const courierLogisticsCard=host.querySelector("#courierLogisticsControlCard");
  const courierRequiredPatch={
    logistics_enabled:true,
    courier_operations_enabled:true,
    dispatch_enabled:true,
    courier_marketplace_enabled:true,
    assignment_mode:"marketplace",
  };
  const boolBadge=(v,on="ON",off="OFF")=>`<span class="badge ${v?"green":"amber"}">${v?on:off}</span>`;
  const preflightRows=(rows,cls)=>Array.isArray(rows)&&rows.length
    ? rows.map((r)=>`<div class="settings-section"><div><strong>${esc(r.code||"Contrôle")}</strong><p>${esc(r.message_fr||"")}</p></div><span class="badge ${cls}">${cls==="red"?"Bloquant":"Info"}</span></div>`).join("")
    : "";

  const renderCourierLogistics=({runtime,draft,preflight})=>{
    const settings=draft?.settings||{};
    const env=String(draft?.environment||runtime?.environment||"");
    const ready=preflight?.ready===true;
    const isProduction=env==="production";
    const runtimeReady=runtime?.logistics_enabled===true
      &&runtime?.courier_operations_enabled===true
      &&runtime?.dispatch_enabled===true
      &&runtime?.courier_marketplace_enabled===true
      &&["marketplace","hybrid"].includes(String(runtime?.assignment_mode||""));
    const draftPrepared=settings.logistics_enabled===true
      &&settings.courier_operations_enabled===true
      &&settings.dispatch_enabled===true
      &&settings.courier_marketplace_enabled===true
      &&["marketplace","hybrid"].includes(String(settings.assignment_mode||""));
    const canPrepare=isProduction;
    const canActivate=isProduction&&draftPrepared&&ready&&!runtimeReady;

    courierLogisticsCard.innerHTML=`
      <div class="toolbar">
        <div>
          <h3 style="margin:0">Livreurs & marketplace — ${isProduction?"Production":"Demo"}</h3>
          <p class="muted" style="margin:4px 0 0">Contrôle officiel : draft → preflight → activation. Les RPC logistiques travaillent sur l’environnement commerce courant de l’administrateur.</p>
        </div>
        <div class="toolbar-group">
          <span class="badge ${isProduction?"green":"amber"}">${isProduction?"PRODUCTION":"MODE DEMO"}</span>
          <span class="badge ${runtimeReady?"green":"amber"}">${runtimeReady?"Runtime actif":"Runtime désactivé"}</span>
        </div>
      </div>

      ${!isProduction?`
      <div class="error-state" style="margin:12px 0">
        <strong>Vous consultez actuellement l’environnement Demo.</strong>
        <div style="margin-top:5px">Les valeurs ON ci-dessous appartiennent à Demo. Elles n’activent pas les livreurs Production.</div>
        <button class="btn btn-blue btn-sm" id="switchCourierLogisticsProduction" type="button" style="margin-top:10px">Passer l’admin en Production</button>
      </div>`:""}

      <div class="settings-section"><div><strong>Logistique générale</strong><p>Nécessaire pour qu’un livreur actif puisse passer en ligne.</p></div>${boolBadge(runtime?.logistics_enabled===true)}</div>
      <div class="settings-section"><div><strong>Opérations livreur</strong><p>Autorise le statut En ligne / Hors ligne et les actions livreur.</p></div>${boolBadge(runtime?.courier_operations_enabled===true)}</div>
      <div class="settings-section"><div><strong>Dispatch</strong><p>Nécessaire pour publier et attribuer des missions.</p></div>${boolBadge(runtime?.dispatch_enabled===true)}</div>
      <div class="settings-section"><div><strong>Marketplace livreur</strong><p>Permet aux livreurs en ligne de voir et prendre les missions disponibles.</p></div>${boolBadge(runtime?.courier_marketplace_enabled===true)}</div>
      <div class="settings-section"><div><strong>Mode d’affectation</strong><p>Marketplace ou Hybride requis pour la liste des missions.</p></div><span class="badge">${esc(runtime?.assignment_mode||"—")}</span></div>

      <div class="${ready?"green-note":"error-state"}" style="margin:12px 0">
        <strong>Preflight : ${ready?"PRÊT":"BLOQUÉ"}</strong>
        <div style="margin-top:4px">Environnement : ${esc(env||"—")} · Draft : ${draftPrepared?"préparé":"non préparé"}</div>
      </div>
      ${preflightRows(preflight?.errors,"red")}
      ${preflightRows(preflight?.warnings,"amber")}

      <div class="settings-section">
        <div>
          <strong>Configuration minimale livreur</strong>
          <p>Réinitialise d’abord le draft sur le runtime actuel, puis active uniquement : logistique générale, opérations livreur, dispatch, marketplace et mode Marketplace. Les réglages de rémunération, GPS, candidatures et méthodes de livraison ne sont pas activés automatiquement.</p>
        </div>
        <button class="btn btn-outline-blue btn-sm" id="prepareCourierMarketplace" type="button" ${canPrepare?"":"disabled"}>${canPrepare?"Préparer":"Production requise"}</button>
      </div>

      <div class="settings-section">
        <div>
          <strong>Activation Production</strong>
          <p>${!isProduction
            ?"Vous êtes en Demo. Passez d’abord l’administrateur en Production pour lire et activer le vrai runtime Production."
            : runtimeReady
              ?"Le runtime Production est déjà prêt : les livreurs Production actifs peuvent passer en ligne."
              : canActivate
                ?"Le preflight Production est vert. Cette action publiera le draft comme nouvelle version Production."
                :"Activation impossible tant que le draft Production n’est pas préparé et que le preflight Production n’est pas vert."}</p>
        </div>
        <button class="btn btn-blue btn-sm" id="activateCourierMarketplace" type="button" ${canActivate?"":"disabled"}>Activer en Production</button>
      </div>
    `;

    courierLogisticsCard.querySelector("#switchCourierLogisticsProduction")?.addEventListener("click",async(e)=>{
      const btn=e.currentTarget;
      if(btn?.dataset.submitting==="1")return;
      if(!window.confirm("Basculer votre environnement commerce administrateur de Demo vers Production ? Les autres écrans Admin qui utilisent l’environnement courant afficheront ensuite les données Production."))return;
      if(btn){btn.dataset.submitting="1";btn.disabled=true;}
      try{
        const session=await getSession();
        const userId=session?.user?.id;
        if(!userId)throw new Error("not-authenticated");
        await setUserCommerceEnvironment(
          userId,
          "production",
          "Administration logistique Production"
        );
        const [nextRuntime,nextDraft,nextPreflight]=await Promise.all([
          adminGetLogisticsControl(),adminGetLogisticsDraft(),adminPreflightLogistics()
        ]);
        if(String(nextDraft?.environment||nextRuntime?.environment||"")!=="production"){
          throw new Error("production_environment_switch_not_applied");
        }
        showToast("Environnement Admin passé en Production ✓");
        renderCourierLogistics({runtime:nextRuntime,draft:nextDraft,preflight:nextPreflight});
      }catch(err){
        console.error("courier logistics environment switch",err);
        showToast("Impossible de basculer l’environnement Admin en Production.","red");
        if(btn){btn.dataset.submitting="";btn.disabled=false;}
      }
    });

    courierLogisticsCard.querySelector("#prepareCourierMarketplace")?.addEventListener("click",async(e)=>{
      const btn=e.currentTarget;
      if(!window.confirm("Préparer la configuration minimale livreur ? Le draft logistique non publié sera d’abord remis à l’état runtime actuel afin d’éviter d’activer d’anciens changements par accident."))return;
      btn.disabled=true;
      try{
        const reason="Préparation activation minimale livreurs marketplace";
        await adminResetLogisticsDraft(reason);
        await adminUpdateLogisticsDraft(courierRequiredPatch,reason);
        const [nextRuntime,nextDraft,nextPreflight]=await Promise.all([
          adminGetLogisticsControl(),adminGetLogisticsDraft(),adminPreflightLogistics()
        ]);
        showToast(nextPreflight?.ready?"Configuration livreur prête ✓":"Configuration préparée, mais le preflight bloque encore l’activation.",nextPreflight?.ready?"green":"red");
        renderCourierLogistics({runtime:nextRuntime,draft:nextDraft,preflight:nextPreflight});
      }catch(err){
        console.error("courier logistics prepare",err);
        showToast("Préparation de la configuration livreur refusée.","red");
        btn.disabled=false;
      }
    });

    courierLogisticsCard.querySelector("#activateCourierMarketplace")?.addEventListener("click",async(e)=>{
      const btn=e.currentTarget;
      btn.disabled=true;
      try{
        const check=await adminPreflightLogistics();
        if(check?.ready!==true){
          showToast("Le preflight logistique bloque l’activation.","red");
          const [rt,dr]=await Promise.all([adminGetLogisticsControl(),adminGetLogisticsDraft()]);
          renderCourierLogistics({runtime:rt,draft:dr,preflight:check});
          return;
        }
        if(!window.confirm("Activer maintenant les opérations livreur et le marketplace en Production ?")){btn.disabled=false;return;}
        await adminActivateLogisticsDraft("Activation opérations livreur et marketplace Production");
        const [nextRuntime,nextDraft,nextPreflight]=await Promise.all([
          adminGetLogisticsControl(),adminGetLogisticsDraft(),adminPreflightLogistics()
        ]);
        showToast("Opérations livreur et marketplace activés ✓");
        renderCourierLogistics({runtime:nextRuntime,draft:nextDraft,preflight:nextPreflight});
      }catch(err){
        console.error("courier logistics activate",err);
        showToast("Activation refusée par le backend. Vérifiez les blockers du preflight.","red");
        btn.disabled=false;
      }
    });
    refreshIcons();
  };

  const pricingCard=host.querySelector("#individualPricingCard");
  const phaseLabel=(phase)=>({prelaunch:"Pré-lancement gratuit",launch:"Offre active",standard:"Tarification normale"})[phase]||phase||"—";
  const renderPricing=(cfg)=>{
    const ind=cfg.individual||{},pro=cfg.professional||{};
    const waived=cfg.fixed_fees_waived===true;
    const enabled=cfg.enabled===true;
    const effectiveSimple=Number(ind.effective_per_item_fee_htg??0);
    const effectivePro=Number(pro.effective_monthly_fee_htg??0);
    const normalSimple=Number(ind.normal_per_item_fee_htg??0);
    const normalUsd=Number(ind.normal_per_item_fee_usd??0);
    const normalPro=Number(pro.normal_monthly_fee_htg??0);
    const commission=Number(cfg.commission_rate??0);

    pricingCard.innerHTML=`
      <div class="toolbar">
        <div>
          <h3 style="margin:0">Offre de lancement Marketplace</h3>
          <p class="muted" style="margin:4px 0 0">Le backend décide automatiquement si les frais fixes sont offerts selon les dates enregistrées.</p>
        </div>
        <span class="badge ${waived?"green":enabled?"amber":""}">${esc(phaseLabel(cfg.phase))}</span>
      </div>

      <div class="green-note" style="margin-bottom:12px">
        ${cfg.phase==="prelaunch"
          ? `La gratuité est déjà active. La période officielle commence le ${esc(fmtDate(cfg.start_date))} : les jours avant cette date ne réduisent pas la période.`
          : cfg.phase==="launch"
            ? "Les frais fixes sont actuellement offerts. Seule la commission Marketplace s’applique."
            : "La période gratuite est terminée ou désactivée : les tarifs normaux sont applicables."}
      </div>

      <div class="settings-section">
        <div><strong>Activer l’offre de lancement</strong><p>Désactiver cette option applique immédiatement les tarifs normaux aux nouvelles ventes.</p></div>
        <label class="switch"><input type="checkbox" id="launchOfferEnabled" ${enabled?"checked":""}><span></span></label>
      </div>

      <div class="settings-section">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%">
          <label><strong>Début officiel</strong><input class="input" id="launchOfferStart" type="date" value="${esc(cfg.start_date||"")}"></label>
          <label><strong>Fin / reprise des tarifs</strong><input class="input" id="launchOfferEnd" type="date" value="${esc(cfg.end_date||"")}"></label>
        </div>
      </div>

      <div class="settings-section">
        <div><strong>Tarification effective aujourd’hui</strong><p>Calcul serveur.</p></div>
        <div style="text-align:right">
          <strong>Individuel : ${esc(effectiveSimple)} HTG/article</strong><br>
          <strong>Pro : ${esc(effectivePro)} HTG/mois</strong><br>
          <span class="badge green">Commission ${esc(commission)} %</span>
        </div>
      </div>

      <div class="settings-section">
        <div style="width:100%">
          <strong>Tarifs normaux après l’offre</strong>
          <p>Ils restent enregistrés pendant la gratuité et reprennent automatiquement à la date de fin.</p>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px">
            <label>Individuel HTG / article<input class="input" id="launchSimpleHtg" type="number" min="0" step="0.01" value="${esc(normalSimple)}"></label>
            <label>Individuel USD / article<input class="input" id="launchSimpleUsd" type="number" min="0" step="0.01" value="${esc(normalUsd)}"></label>
            <label>Professionnel HTG / mois<input class="input" id="launchProMonthly" type="number" min="0.01" step="0.01" value="${esc(normalPro)}"></label>
            <label>Commission Marketplace (%)<input class="input" id="launchCommission" type="number" min="0" max="100" step="0.01" value="${esc(commission)}"></label>
          </div>
          <input class="input" id="launchOfferReason" maxlength="240" placeholder="Motif du changement (optionnel)" style="margin-top:8px">
        </div>
        <button class="btn btn-blue btn-sm" id="saveLaunchOffer" type="button">Enregistrer</button>
      </div>

      <div class="settings-section">
        <div><strong>Après la campagne</strong><p>Sans plan Pro actif, le marchand reste Individuel. Un marchand Pro actif entre dans la facturation mensuelle normale.</p></div>
        <span class="badge blue">Automatique</span>
      </div>
    `;

    const save=pricingCard.querySelector("#saveLaunchOffer");
    save?.addEventListener("click",async()=>{
      const nextEnabled=!!pricingCard.querySelector("#launchOfferEnabled")?.checked;
      const startDate=String(pricingCard.querySelector("#launchOfferStart")?.value||"");
      const endDate=String(pricingCard.querySelector("#launchOfferEnd")?.value||"");
      const individualFeeHtg=Number(pricingCard.querySelector("#launchSimpleHtg")?.value);
      const individualFeeUsd=Number(pricingCard.querySelector("#launchSimpleUsd")?.value);
      const professionalMonthlyFeeHtg=Number(pricingCard.querySelector("#launchProMonthly")?.value);
      const commissionRate=Number(pricingCard.querySelector("#launchCommission")?.value);
      const reason=String(pricingCard.querySelector("#launchOfferReason")?.value||"").trim()||null;

      if(!startDate||!endDate||startDate>=endDate){showToast("Les dates de l’offre sont invalides.","red");return}
      if([individualFeeHtg,individualFeeUsd,commissionRate].some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(professionalMonthlyFeeHtg)||professionalMonthlyFeeHtg<=0||commissionRate>100){
        showToast("Vérifiez les tarifs : le tarif Pro mensuel doit être supérieur à 0, et la commission doit rester entre 0 et 100 %.","red");return;
      }
      const localDate=String(cfg.local_date||"");
      const endsWaiverNow=waived&&(!nextEnabled||(localDate&&endDate<=localDate));
      if(endsWaiverNow&&!window.confirm("Cette modification met fin immédiatement à la gratuité des frais fixes. Les tarifs normaux s’appliqueront aux nouvelles ventes et la facturation Pro normale sera reprogrammée. Continuer ?"))return;

      save.disabled=true;
      try{
        const next=await adminSetMarketplaceLaunchOffer({
          enabled:nextEnabled,startDate,endDate,individualFeeHtg,individualFeeUsd,
          professionalMonthlyFeeHtg,commissionRate,reason,
        });
        showToast("Offre de lancement enregistrée ✓");
        renderPricing(next);
      }catch(e){
        console.error("launch offer admin update",e);
        showToast("Modification de l’offre de lancement refusée.","red");
        save.disabled=false;
      }
    });
  };

  const shippingCard=host.querySelector("#usdShippingPricingCard");
  const renderShipping=(cfg)=>{
    const value=(v)=>v===null||v===undefined?"":String(v);
    const usdEnabled=!!cfg.usd_logistics_enabled;
    const homeReady=usdEnabled&&!!cfg.usd_home_delivery_enabled&&cfg.usd_home_delivery_fee!==null&&cfg.usd_home_delivery_fee!==undefined;
    const customReady=usdEnabled&&!!cfg.usd_custom_location_enabled&&cfg.usd_custom_location_fee!==null&&cfg.usd_custom_location_fee!==undefined;
    const pickupReady=usdEnabled&&!!cfg.usd_pickup_enabled&&Number(cfg.real_active_pickup_points||0)>0&&cfg.usd_pickup_fee!==null&&cfg.usd_pickup_fee!==undefined;
    shippingCard.innerHTML=`
      <div class="toolbar"><div><h3 style="margin:0">Livraison USD — ${usdEnv==="demo"?"Demo":"Production"}</h3><p class="muted" style="margin:4px 0 0">Activation USD indépendante de la logistique HTG. Aucun montant HTG n'est converti automatiquement.</p></div><span class="badge ${usdEnabled?"green":"amber"}">${usdEnabled?"USD actif":"USD désactivé"}</span></div>

      <div class="settings-section"><div><strong>Activer la logistique USD</strong><p>Interrupteur maître USD uniquement. Il ne change jamais <code>logistics_enabled</code> pour HTG.</p></div><label class="switch"><input type="checkbox" id="usdLogisticsEnabled" ${usdEnabled?"checked":""}><span></span></label></div>
      <div class="settings-section"><div><strong>Autoriser livraison à domicile USD</strong><p>Frais actuel : ${cfg.usd_home_delivery_fee==null?"non configuré":esc(money(Number(cfg.usd_home_delivery_fee),"USD"))}</p></div><label class="switch"><input type="checkbox" id="usdHomeEnabled" ${cfg.usd_home_delivery_enabled?"checked":""}><span></span></label></div>
      <div class="settings-section"><div><strong>Autoriser adresse personnalisée USD</strong><p>Frais actuel : ${cfg.usd_custom_location_fee==null?"non configuré":esc(money(Number(cfg.usd_custom_location_fee),"USD"))}</p></div><label class="switch"><input type="checkbox" id="usdCustomEnabled" ${cfg.usd_custom_location_enabled?"checked":""}><span></span></label></div>
      <div class="settings-section"><div><strong>Autoriser point de retrait USD</strong><p>${esc(cfg.real_active_pickup_points||0)} vrai point Production actif. Les points QA ne comptent jamais.</p></div><label class="switch"><input type="checkbox" id="usdPickupEnabled" ${cfg.usd_pickup_enabled?"checked":""} ${Number(cfg.real_active_pickup_points||0)>0?"":"disabled"}><span></span></label></div>

      <div class="settings-section"><div><strong>Livraison à domicile (USD)</strong><p>Tarif fixe USD.</p><input class="input" id="usdHomeDeliveryFee" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(cfg.usd_home_delivery_fee))}" placeholder="Non configuré"></div><span class="badge ${homeReady?"green":"amber"}">${homeReady?"Prêt":"Non prêt"}</span></div>
      <div class="settings-section"><div><strong>Adresse personnalisée (USD)</strong><p>Tarif fixe USD distinct.</p><input class="input" id="usdCustomLocationFee" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(cfg.usd_custom_location_fee))}" placeholder="Non configuré"></div><span class="badge ${customReady?"green":"amber"}">${customReady?"Prêt":"Non prêt"}</span></div>
      <div class="settings-section"><div><strong>Point de retrait (USD)</strong><p>Tarif fixe USD pour les vrais points VinHT Production.</p><input class="input" id="usdPickupFee" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(value(cfg.usd_pickup_fee))}" placeholder="Non configuré"></div><span class="badge ${pickupReady?"green":"amber"}">${pickupReady?"Prêt":"Non prêt"}</span></div>

      <div class="settings-section"><div><strong>Motif</strong><p>Optionnel, enregistré dans l'audit logistique.</p><input class="input" id="usdShippingReason" type="text" maxlength="240" placeholder="Ex. ajustement logistique USD"></div><div class="toolbar-group"><button class="btn btn-ghost btn-sm" id="saveUsdShippingActivation" type="button">Enregistrer l'activation</button><button class="btn btn-blue btn-sm" id="saveUsdShippingPricing" type="button">Enregistrer les tarifs</button></div></div>
      <div class="green-note">État HTG global : ${cfg.logistics_enabled?"actif":"désactivé"}. Ces interrupteurs USD n'y touchent jamais.</div>
    `;

    const pricingBtn=shippingCard.querySelector("#saveUsdShippingPricing");
    const activationBtn=shippingCard.querySelector("#saveUsdShippingActivation");
    const reason=()=>String(shippingCard.querySelector("#usdShippingReason")?.value||"").trim()||null;
    const setBusy=(v)=>{if(pricingBtn)pricingBtn.disabled=!!v;if(activationBtn)activationBtn.disabled=!!v};

    pricingBtn?.addEventListener("click",async()=>{
      const read=(id)=>String(shippingCard.querySelector(id)?.value??"").trim();
      const parse=(raw)=>raw===""?null:Number(raw);
      const home=parse(read("#usdHomeDeliveryFee")),custom=parse(read("#usdCustomLocationFee")),pickup=parse(read("#usdPickupFee"));
      if([home,custom,pickup].some(v=>v!==null&&(!Number.isFinite(v)||v<0))){showToast("Les tarifs USD doivent être supérieurs ou égaux à 0.","red");return}
      setBusy(true);
      try{
        const next=await adminSetUsdShippingPricing({
          environment:usdEnv,
          homeDeliveryFeeUsd:home,
          customLocationFeeUsd:custom,
          pickupFeeUsd:pickup,
          reason:reason(),
        });
        showToast("Tarifs de livraison USD enregistrés ✓");
        renderShipping(next);
      }catch{showToast("Modification des tarifs de livraison USD refusée.","red");setBusy(false)}
    });

    activationBtn?.addEventListener("click",async()=>{
      const enabled=!!shippingCard.querySelector("#usdLogisticsEnabled")?.checked;
      const homeEnabled=!!shippingCard.querySelector("#usdHomeEnabled")?.checked;
      const customEnabled=!!shippingCard.querySelector("#usdCustomEnabled")?.checked;
      const pickupEnabled=!!shippingCard.querySelector("#usdPickupEnabled")?.checked;
      setBusy(true);
      try{
        const next=await adminSetUsdShippingActivation({
          environment:usdEnv,
          enabled,
          homeEnabled,
          customEnabled,
          pickupEnabled,
          reason:reason(),
        });
        showToast("Activation logistique USD enregistrée ✓");
        renderShipping(next);
      }catch(e){
        const msg=String(e?.message||e||"");
        showToast(/real_pickup_point_required/.test(msg)?"Ajoutez d'abord un vrai point de retrait Production.":/fee_required/.test(msg)?"Configurez d'abord le tarif USD du mode activé.":"Modification de l'activation USD refusée.","red");
        setBusy(false);
      }
    });
  };

  if(pricingCard){
    try{
      const pricing=await adminGetMarketplaceLaunchOffer();
      renderPricing(pricing);
    }catch{
      pricingCard.innerHTML=`<h3>Offre de lancement Marketplace</h3><div class="error-state">Impossible de charger la campagne serveur.</div>`;
    }
  }
  if(shippingCard){
    try{
      const shipping=await adminGetUsdShippingPricing(usdEnv);
      renderShipping(shipping);
    }catch{
      shippingCard.innerHTML=`<h3>Livraison USD — ${usdEnv==="demo"?"Demo":"Production"}</h3><div class="error-state">Impossible de charger les paramètres de livraison USD.</div>`;
    }
  }
  if(courierLogisticsCard){
    try{
      const [runtime,draft,preflight]=await Promise.all([
        adminGetLogisticsControl(),adminGetLogisticsDraft(),adminPreflightLogistics()
      ]);
      renderCourierLogistics({runtime,draft,preflight});
    }catch(err){
      console.error("courier logistics control",err);
      courierLogisticsCard.innerHTML=`<h3>Livreurs & marketplace</h3><div class="error-state">Impossible de charger le contrôle logistique serveur.</div>`;
    }
  }
  refreshIcons();
}

export function renderAdminSettingsInto(host,opts){return settings(host,opts)}


async function applications(){
  // RPC Admin environment-aware uniquement (services/adminMerchantApplications.js) : aucun SELECT direct.
  const host=document.querySelector("#adminApplicationsHost");if(!host)return;host.innerHTML=loading();
  const state={status:"",q:""};
  const draw=async()=>{
    host.innerHTML=`<div class="toolbar"><div class="toolbar-group"><input class="input" id="aaQ" placeholder="Boutique / email / nom" value="${esc(state.q)}"><select id="aaStatus"><option value="">Tous statuts</option>${MERCHANT_APPLICATION_STATUSES.map(s=>`<option value="${esc(s)}" ${s===state.status?"selected":""}>${esc(APPLICATION_STATUS_FR[s]||s)}</option>`).join("")}</select></div><span class="badge amber" id="aaPendingCount">…</span></div><div id="aaList">${loading()}</div><p class="muted" style="font-size:10px">Ouvrir une demande pour approuver (crée la boutique + le rôle marchand) ou refuser avec motif — transaction serveur, limitée à l’environnement admin courant.</p>`;
    host.querySelector("#aaStatus").addEventListener("change",(e)=>{state.status=e.target.value;draw()});
    host.querySelector("#aaQ").addEventListener("input",(e)=>{state.q=e.target.value;drawRows()});
    adminCountPendingMerchantApplications().then(r=>{const pc=host.querySelector("#aaPendingCount");if(pc)pc.textContent=`${r.count} en attente`}).catch(()=>{const pc=host.querySelector("#aaPendingCount");if(pc)pc.textContent="compteur indisponible"});
    let rows=[];
    try{const r=await adminListMerchantApplications({status:state.status||null,limit:100});rows=r.rows;state.rows=rows;state.total=r.total}
    catch(err){host.querySelector("#aaList").innerHTML=errorBox(adminErrorFr(err,"Impossible de charger les demandes marchands."));return}
    drawRows();
  };
  const drawRows=()=>{
    const list=host.querySelector("#aaList");if(!list||!state.rows)return;
    const q=state.q.toLowerCase();
    const rows=state.rows.filter(a=>!q||String(a.shop_name||"").toLowerCase().includes(q)||String(a.email||"").toLowerCase().includes(q)||String(a.full_name||"").toLowerCase().includes(q));
    list.innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Boutique</th><th>Demandeur</th><th>Type</th><th>Plan</th><th>Statut</th><th>KYC</th><th>Date</th><th></th></tr></thead><tbody>${rows.map(a=>`<tr><td><strong>${esc(a.shop_name)}</strong> ${envBadge(a.environment)}</td><td><div class="table-primary">${esc(a.full_name||"—")}</div><div class="table-secondary">${esc(a.email||"")}</div></td><td>${esc(a.merchant_type)}</td><td>${esc(a.requested_plan_code)}</td><td>${badge(a.status)}</td><td>${kycBadge(a.kyc_status)}</td><td>${esc(fmtDate(a.created_at))}</td><td><a class="btn btn-ghost btn-sm" href="application-detail.html?id=${encodeURIComponent(a.id)}">Ouvrir</a></td></tr>`).join("")||'<tr><td colspan="8">Aucune demande.</td></tr>'}</tbody></table></div>`;
  };
  await draw();
}
const productStatusLabel = (product) => product.approval_status === "approved" ? "Vérifié par VinHT" : product.approval_status === "rejected" ? "Retiré par VinHT" : product.is_active ? "À vérifier" : "À revérifier";
const productStatusBadge = (product) => `<span class="badge ${product.approval_status === "approved" ? "green" : product.approval_status === "rejected" ? "red" : "amber"}">${productStatusLabel(product)}</span>`;
async function productsV2(){
  const host=document.querySelector("#adminProductsHost"); if(!host)return; host.innerHTML=loading();
  const head=document.querySelector(".portal-head"); if(head){const h=head.querySelector("h1"),p=head.querySelector("p");if(h)h.textContent="Contrôle catalogue";if(p)p.textContent="Vérification a posteriori des produits déjà publiés.";}
  try{
    const rows=await getAdminProducts();
    host.innerHTML=`<div class="toolbar"><div class="toolbar-group"><input class="input" id="apQ" placeholder="Nom / SKU / marchand"><select id="apStatus"><option value="">Tous statuts</option><option value="pending">À vérifier / revérifier</option><option value="approved">Vérifié par VinHT</option><option value="rejected">Retiré par VinHT</option></select></div><span class="badge amber" id="apPendingCount"></span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Marchand</th><th>Prix</th><th>Stock</th><th>Contrôle</th><th>Publié</th><th>Créé</th></tr></thead><tbody id="apBody"></tbody></table></div><p class="muted" style="font-size:10px">Contrôle a posteriori : « À vérifier » indique un produit déjà publié ; « À revérifier » indique un produit resté hors ligne après un retrait précédent. Ouvrez une fiche pour décider.</p>`;
    const target=new URL(location.href).searchParams.get("product")||"";
    if(target){const exact=rows.find((p)=>p.id===target);if(exact){host.querySelector("#apQ").value=exact.name||target;}}
    host.querySelector("#apPendingCount").textContent=`${rows.filter((p)=>p.approval_status==="pending").length} à contrôler`;
    const body=host.querySelector("#apBody");
    const draw=()=>{const q=(host.querySelector("#apQ").value||"").toLowerCase(),s=host.querySelector("#apStatus").value;const list=rows.filter((p)=>(!q||p.name.toLowerCase().includes(q)||String(p.sku||"").toLowerCase().includes(q)||String(p.merchants?.shop_name||"").toLowerCase().includes(q)||p.id===target)&&(!s||p.approval_status===s));body.innerHTML=list.map((p)=>`<tr data-admin-product="${esc(p.id)}" style="${p.id===target?"outline:3px solid var(--blue,#0b2edc);outline-offset:-3px;background:#eef3ff":""}"><td><div class="table-primary"><a href="product-detail.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a> ${envBadge(p.environment)}</div><div class="table-secondary">${esc(p.sku||String(p.id).slice(0,8))}</div></td><td>${esc(p.merchants?.shop_name||"—")}</td><td>${money(p.retail_price,p.currency||"HTG")}</td><td>${esc(p.stock)}</td><td>${productStatusBadge(p)}</td><td>${p.is_active?'<span class="badge green">Oui</span>':'<span class="badge">Non</span>'}</td><td>${esc(fmtDate(p.created_at))}</td></tr>`).join("")||`<tr><td colspan="7">Aucun résultat.</td></tr>`;if(target)requestAnimationFrame(()=>body.querySelector(`[data-admin-product="${CSS.escape(target)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}));};
    draw(); host.querySelector("#apQ").addEventListener("input",draw);host.querySelector("#apStatus").addEventListener("change",draw);
  }catch{host.innerHTML=errorBox("Impossible de charger les produits.");}
}

async function productDetailV2(){
  const host=document.querySelector("#adminProductDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{const p=await getAdminProduct(id);if(!p){host.innerHTML=empty("Produit introuvable","Ce produit n’existe pas ou n’est plus accessible.");return;}
    const pending=p.approval_status==="pending";
    const pendingNotice=pending?(p.is_active?'<div class="green-note" style="margin:14px 0"><strong>Ce produit est déjà publié sur VinHT.</strong><br>Le contrôle admin ne bloque pas sa mise en vente.</div>':'<div class="empty-state" style="margin:14px 0;padding:14px;text-align:left"><strong>Ce produit reste hors ligne à la suite d’un retrait précédent.</strong><br>Une vérification positive pourra le republier.</div>'):"";
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><span class="portal-kicker">Contrôle catalogue</span><h3>${esc(p.name)}</h3><div class="table-secondary">${esc(p.sku||p.slug||p.id)}</div></div><div class="toolbar-group">${productStatusBadge(p)} ${p.is_active?'<span class="badge green">Publié</span>':'<span class="badge">Hors ligne</span>'}</div></div>${pendingNotice}<div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Prix détail</div><div class="value" style="font-size:18px">${money(p.retail_price,p.currency)}</div></div><div class="stat-card green-stat"><div class="label">Stock</div><div class="value">${esc(p.stock)}</div></div><div class="stat-card amber-stat"><div class="label">Marchand</div><div class="value" style="font-size:14px">${esc(p.merchants?.shop_name||"—")}</div></div></div><div class="settings-section"><div><strong>Description</strong><p>${esc(p.description||p.tagline||"Aucune description")}</p></div></div><div class="settings-section"><div><strong>Contrôle catalogue</strong><p>${p.rejection_reason?`Motif : ${esc(p.rejection_reason)}`:"Aucun motif enregistré."}</p></div>${productStatusBadge(p)}</div>${pending?`<div class="settings-section"><div><strong>Actions de modération</strong><p>${p.is_active?"Marquer comme vérifié conserve la publication.":"Marquer comme vérifié republiera le produit."} Retirer du catalogue exige un motif.</p></div><div class="toolbar-group"><button class="btn btn-blue btn-sm" id="apProductApprove">Marquer comme vérifié</button><button class="btn btn-outline-red btn-sm" id="apProductReject">Retirer du catalogue</button></div></div>`:""}</div>`;
    const approve=host.querySelector("#apProductApprove"),reject=host.querySelector("#apProductReject");
    approve?.addEventListener("click",async()=>{approve.disabled=true;if(reject)reject.disabled=true;try{await reviewAdminProduct(p.id,"approve");showToast("Produit marqué comme vérifié ✓");location.reload();}catch{showToast("Contrôle impossible","red");approve.disabled=false;if(reject)reject.disabled=false;}});
    reject?.addEventListener("click",async()=>{const reason=window.prompt("Motif du retrait (obligatoire, visible par le marchand) :");if(reason===null)return;if(!reason.trim()){showToast("Motif obligatoire","red");return;}reject.disabled=true;if(approve)approve.disabled=true;try{await reviewAdminProduct(p.id,"reject",reason);showToast("Produit retiré du catalogue ✓");location.reload();}catch{showToast("Retrait impossible","red");reject.disabled=false;if(approve)approve.disabled=false;}});refreshIcons();
  }catch{host.innerHTML=errorBox("Impossible de charger le produit.");}
}

async function productDetail(){
  const host=document.querySelector("#adminProductDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
}

async function applicationDetail(){
  const host=document.querySelector("#adminApplicationDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{
    const {application:a}=await adminGetMerchantApplication(id);
    const kcase=a.kyc||null;const kycOk=!!(kcase&&kcase.status==="approved");
    const rows=[['Nom complet',a.full_name],['Email',a.email],['Téléphone',a.phone],['WhatsApp',a.whatsapp_number],['Boutique',a.shop_name],['Type',a.merchant_type],['Plan demandé',a.requested_plan_code],['Statut',a.status],['Catégories',(a.product_categories||[]).join(', ')],['Description',a.shop_description],['Motif rejet',a.rejection_reason],['Créée',fmtDate(a.created_at)]];
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>${esc(a.shop_name)} ${envBadge(a.environment)}</h3><div class="table-secondary">Demande ${esc(String(a.id).slice(0,8))}</div></div>${badge(a.status)}</div>${rows.map(([k,v])=>`<div class="settings-section"><div><strong>${esc(k)}</strong><p>${esc(v??"—")}</p></div></div>`).join("")}${a.status==='pending'?`<div class="settings-section"><div><strong>Décision</strong><p>${kycOk?"Approuver crée la boutique active + le rôle marchand dans une seule transaction serveur.":"Le KYC doit être approuvé avant l'activation de cette boutique."} Refuser exige un motif (visible par le demandeur).</p></div><div class="toolbar-group"><button class="btn btn-blue btn-sm" id="approveMerchantApplication" ${kycOk?"":"disabled title=\"KYC non approuvé\""}>Approuver</button><button class="btn btn-outline-red btn-sm" id="rejectMerchantApplication">Refuser</button></div></div>`:''}</div><div class="portal-card"><div class="toolbar"><div><h3>Vérification d'identité (KYC)</h3></div>${kycBadge(kcase?kcase.status:null)}</div>${kcase?`<div class="settings-section"><div><strong>Dossier</strong><p>Soumis le ${esc(fmtDate(kcase.submitted_at))}${kcase.decision_reason?` · motif : ${esc(kcase.decision_reason)}`:""}</p></div><a class="btn btn-blue btn-sm" href="kyc-case.html?id=${encodeURIComponent(kcase.case_id)}">Ouvrir le dossier KYC</a></div>`:`<p class="muted" style="font-size:12px;margin:8px 0 0">Le demandeur n'a pas encore commencé sa vérification d'identité.</p>`}</div>`;
    const amAppr=host.querySelector('#approveMerchantApplication'),amRej=host.querySelector('#rejectMerchantApplication');
    amAppr?.addEventListener('click',async()=>{
      const ok=await confirmAction({title:`Approuver ${a.shop_name} ?`,env:a.environment,confirmLabel:"Approuver",consequences:["La boutique est créée et activée, le rôle marchand est accordé.","L'opération est limitée à l'environnement admin courant."]});
      if(!ok)return;
      amAppr.disabled=true;if(amRej)amRej.disabled=true;
      try{await adminApproveMerchantApplication(a.id);showToast('Marchand approuvé ✓');location.reload()}
      catch(err){const m=String(err&&(err.message||err.code)||"");showToast(/kyc_approval_required/.test(m)?kycErrorMessage(err):/already exists/.test(m)?'Un marchand existe déjà pour ce compte.':adminErrorFr(err,'Approbation refusée'),'red');amAppr.disabled=false;if(amRej)amRej.disabled=false}
    });
    amRej?.addEventListener('click',async()=>{
      const ok=await confirmAction({title:`Refuser la demande de ${a.shop_name} ?`,env:a.environment,requireReason:true,minReason:3,reasonLabel:"Motif du refus (obligatoire, visible par le demandeur)",confirmLabel:"Refuser",danger:true,consequences:["Le demandeur est informé du refus et du motif."]});
      if(!ok)return;
      amRej.disabled=true;if(amAppr)amAppr.disabled=true;
      try{await adminRejectMerchantApplication(a.id,ok.reason);showToast('Candidature refusée ✓');location.reload()}
      catch(err){showToast(adminErrorFr(err,'Refus impossible'),'red');amRej.disabled=false;if(amAppr)amAppr.disabled=false}
    });
    refreshIcons();
  }catch(err){
    const m=String(err&&(err.message||err.code)||"");
    host.innerHTML=/merchant_application_not_found/.test(m)?empty("Demande introuvable","Cette demande n’existe pas dans l’environnement admin courant."):errorBox(adminErrorFr(err,"Impossible de charger la demande."));
    refreshIcons();
  }
}
async function merchantDetail(){
  const host=document.querySelector("#adminMerchantDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{const m=await getAdminMerchant(id);if(!m){host.innerHTML=empty("Marchand introuvable","Cette boutique n’existe pas.");refreshIcons();return}host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>${esc(m.shop_name)}</h3><div class="table-secondary">${esc(m.merchant_type)} · plan ${esc(m.plan_code)}</div></div>${badge(m.status)}</div><div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Confiance</div><div class="value">${esc(m.trust_score)}</div><div class="delta">${esc(m.trust_level)}</div></div><div class="stat-card red-stat"><div class="label">Note</div><div class="value">${esc(m.average_rating)}</div><div class="delta">${esc(m.rating_count)} avis</div></div><div class="stat-card green-stat"><div class="label">Commandes réussies</div><div class="value">${esc(m.successful_orders_count)}</div></div><div class="stat-card amber-stat"><div class="label">Plaintes</div><div class="value">${esc(m.complaints_count)}</div></div></div><div class="settings-section"><div><strong>Description</strong><p>${esc(m.description||"—")}</p></div></div><div class="settings-section"><div><strong>Zone</strong><p>${esc(m.delivery_zone||"—")}</p></div></div><div class="settings-section"><div><strong>Utilisateur lié</strong><p><code>${esc(m.user_id)}</code></p></div></div><a class="btn btn-ghost btn-sm" href="../store.html?merchant=${encodeURIComponent(m.id)}">Voir la boutique publique</a></div>`;refreshIcons()}catch{host.innerHTML=errorBox("Impossible de charger le marchand.")}
}

async function orderDetail(){
  const host=document.querySelector("#adminOrderDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{
    const o=await getAdminOrder(id);if(!o){host.innerHTML=empty("Commande introuvable","Cette commande n’existe pas.");refreshIcons();return}
    const currency=rowCurrency(o);
    const subtotal=rowAmount(o,"subtotal_amount","subtotal_htg"),discount=rowAmount(o,"payment_discount_amount","payment_discount_htg"),shipping=rowAmount(o,"shipping_amount","shipping_htg"),total=rowAmount(o,"total_amount","total_htg");
    host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>Commande #${esc(String(o.id).slice(0,8))}</h3><div class="table-secondary">${esc(fmtDate(o.created_at))} · ${esc(o.full_name||"Client")} · ${esc(currency)}</div></div><div class="toolbar-group">${badge(o.status)} ${badge(o.payment_status)} ${envBadge(o.environment)}</div></div><div class="settings-section"><div><strong>Client</strong><p>${esc(o.full_name||"—")} · ${esc(o.email||o.phone||"—")}</p></div></div><div class="settings-section"><div><strong>Livraison</strong><p>${esc(o.delivery_type||"—")}${o.delivery_address&&typeof o.delivery_address==="object"?` — ${esc([o.delivery_address.address,o.delivery_address.city].filter(Boolean).join(", "))}`:o.pickup_point_code?` — point ${esc(o.pickup_point_code)}`:""}</p></div></div>${(o.items||[]).map(it=>{const c=rowCurrency(it);return `<div class="settings-section"><div><strong>${esc(it.product_name||"Produit")}</strong><p>Qté ${esc(it.quantity)} · ${esc(it.pricing_tier||"")} · PU ${money(rowAmount(it,"unit_price_amount","unit_price_htg"),c)}</p></div><strong>${money(rowAmount(it,"line_total_amount","line_total_htg"),c)}</strong></div>`}).join("")}<div class="settings-section"><div><strong>Sous-total</strong></div><strong>${money(subtotal,currency)}</strong></div><div class="settings-section"><div><strong>Remise paiement</strong><p>${esc(o.payment_method||"—")}</p></div><strong>${discount?"− "+money(discount,currency):money(0,currency)}</strong></div><div class="settings-section"><div><strong>Livraison</strong></div><strong>${money(shipping,currency)}</strong></div><div class="settings-section"><div><strong>Total final</strong></div><strong>${money(total,currency)}</strong></div></div><div class="portal-card"><h3>Allocations marchands</h3>${(o.merchant_orders||[]).map(m=>{
      const c=rowCurrency(m);
      const reversal=isPayoutReversalRequired(m.payout_status,m.payout_error);
      const payoutLabel=PAYOUT_STATUS_FR[m.payout_status]||m.payout_status||"—";
      return `<div class="settings-section" style="flex-direction:column;align-items:stretch;gap:6px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><strong>${esc(String(m.merchant_id).slice(0,8))}</strong> ${envBadge(m.environment)}<p>Statut ${esc(m.status||"—")} · versement ${reversal?`<span style="color:#b0122a;font-weight:800">${esc(payoutLabel)} ⚠</span>`:esc(payoutLabel)} · ${esc(c)}<br>Sous-total ${money(rowAmount(m,"subtotal_amount","subtotal_htg"),c)} · commission ${money(rowAmount(m,"platform_commission_amount","platform_commission_htg"),c)} · frais/article ${money(rowAmount(m,"per_item_fee_amount","per_item_fee_htg"),c)}${m.payout_provider?`<br>Fournisseur versement : ${esc(m.payout_provider)}${m.payout_environment?` (${esc(m.payout_environment)})`:""}`:""}${m.payout_reference?`<br>Référence versement : <code>${esc(m.payout_reference)}</code>`:""}${m.payout_paid_at?`<br>Versé le : ${esc(fmtDate(m.payout_paid_at))}`:""}</p></div><strong>${money(rowAmount(m,"payout_amount","payout_amount_htg"),c)}</strong></div>${reversal?`<div class="error-state" style="margin:0"><strong>⚠ Versement déjà payé — régularisation requise</strong><p style="margin:4px 0 0">${esc(payoutErrorMessageFr(m.payout_error))} Le statut reste « Payé » : VinHT n'a jamais repris cette somme automatiquement. <code>${esc(m.payout_error)}</code></p></div>`:m.payout_error?`<div class="settings-section" style="padding:6px 0"><span style="color:var(--red,#f31938);font-size:12px">${esc(payoutErrorMessageFr(m.payout_error))} <code>${esc(m.payout_error)}</code></span></div>`:""}</div>`;
    }).join("")||'<p class="muted">Aucune allocation.</p>'}</div>`;
    refreshIcons()
  }catch{host.innerHTML=errorBox("Impossible de charger la commande.")}
}

const SPACE_STATE_FR={active:"Actif",pending_review:"En attente de validation",paused:"En pause",suspended:"Suspendu",rejected:"Refusé",closed:"Fermé",pending:"En attente",approved:"Approuvé",available:"Disponible",offline:"Hors ligne",busy:"Occupé"};
async function loadUserSpaces(el,userId){
  if(!el)return;
  try{
    const d=await adminGetUserSpaces(userId);
    const sf=(v)=>SPACE_STATE_FR[v]||v||"—";
    const rows=(space,fmt)=>space?.present&&Array.isArray(space.rows)&&space.rows.length
      ? space.rows.map((r)=>`<p>${fmt(r)}</p>`).join("")
      : "<p>Aucun espace dans cet environnement.</p>";
    el.innerHTML=`<p class="muted" style="font-size:11px">Environnement affiché : <strong>${d.environment==="demo"?"DEMO":"PRODUCTION"}</strong></p>
      <div class="settings-section"><div><strong>Rôles</strong><p>${(d.roles||[]).map((r)=>badge(r)).join(" ")||"Aucun rôle"}</p></div></div>
      <div class="settings-section"><div><strong>Marchand</strong>${rows(d.spaces?.merchant,(r)=>`${esc(r.shop_name||"Boutique")} · ${esc(r.merchant_type||"—")} · plan ${esc(r.plan_code||"—")} · ${badge(sf(r.status))}`)}</div></div>
      <div class="settings-section"><div><strong>Livreur</strong>${rows(d.spaces?.courier,(r)=>`${badge(sf(r.operational_status))} · disponibilité : ${esc(sf(r.availability_status))} · ${esc(r.vehicle_type||"—")}`)}</div></div>
      <div class="settings-section"><div><strong>Agent</strong>${rows(d.spaces?.agent,(r)=>`${esc(r.display_name||"Agent")} · ${badge(sf(r.status))}`)}</div></div>
      <p class="muted" style="font-size:11px;margin-top:8px">Lecture serveur autoritaire via admin_get_user_spaces_v1. Les décisions se prennent depuis le Control Center.</p>`;
  }catch{el.innerHTML=errorBox("Impossible de charger les espaces de cet utilisateur.")}
}
async function userDetail(){
  const host=document.querySelector("#adminUserDetailHost");if(!host)return;const id=new URL(location.href).searchParams.get("id")||"";host.innerHTML=loading();
  try{const u=await getAdminUser(id);if(!u){host.innerHTML=empty("Utilisateur introuvable","Ce profil n’existe pas.");refreshIcons();return}const uEnv=String(u.commerce_environment||"production").toLowerCase();const uEnvTarget=uEnv==="demo"?"production":"demo";host.innerHTML=`<div class="portal-card"><div class="toolbar"><div><h3>${esc(u.full_name||"Sans nom")}</h3><div class="table-secondary">${esc(u.email||u.id)}</div></div><div class="toolbar-group">${(u.roles||[]).map(badge).join(" ")} ${envBadge(uEnv)}</div></div><div class="settings-section"><div><strong>Environnement commerce</strong><p>${uEnv==="demo"?"Demo — commandes et paiements isolés (Sandbox FlexiCash, aucun argent réel).":"Production — environnement réel."} Le client ne choisit jamais lui-même ; décision serveur via RPC admin.</p></div><button class="btn ${uEnvTarget==="demo"?"btn-blue":"btn-outline-red"} btn-sm" id="auEnvToggle" type="button">${uEnvTarget==="demo"?"Passer en mode Demo":"Repasser en Production"}</button></div><div class="settings-section"><div><strong>Téléphone</strong><p>${esc(u.phone||"—")}</p></div></div><div class="settings-section"><div><strong>Adresse</strong><p>${esc(u.address||"—")}</p></div></div><div class="settings-section"><div><strong>WhatsApp</strong><p>Préférence profil</p></div>${u.whatsapp_updates?'<span class="badge green">Activé</span>':'<span class="badge">Désactivé</span>'}</div><div class="settings-section"><div><strong>ID</strong><p><code>${esc(u.id)}</code></p></div></div></div><div class="portal-card"><h3>Espaces et états</h3><div id="auSpaces">${loading()}</div></div>`;loadUserSpaces(host.querySelector("#auSpaces"),u.id);const envBtn=host.querySelector("#auEnvToggle");envBtn?.addEventListener("click",async()=>{const toDemo=uEnvTarget==="demo";const res=await confirmAction({title:toDemo?"Passer ce compte en mode Demo":"Repasser ce compte en Production",message:`Compte : ${u.full_name||u.email||u.id}. Environnement actuel : ${uEnv==="demo"?"DEMO":"PRODUCTION"}.`,consequences:toDemo?["Ses commandes et paiements seront isolés en Demo (Sandbox FlexiCash, aucun argent réel).","Il ne verra plus les données Production.","Le backend refuse le changement si le compte a déjà une activité (produits, commandes)."]:["Le compte redevient réel : commandes et paiements en Production.","Il ne verra plus les données Demo.","Le backend refuse le changement si le compte a déjà une activité (produits, commandes)."],env:uEnv,requireReason:true,minReason:5,reasonLabel:"Motif (audité)",confirmLabel:toDemo?"Passer en Demo":"Repasser en Production",danger:!toDemo});if(!res)return;envBtn.disabled=true;try{await setUserCommerceEnvironment(u.id,uEnvTarget,res.reason);showToast(`Environnement commerce : ${toDemo?"Demo":"Production"} ✓`);location.reload()}catch(err){showToast(adminErrorFr(err,"Changement d'environnement refusé."),"red");envBtn.disabled=false}});refreshIcons()}catch{host.innerHTML=errorBox("Impossible de charger l’utilisateur.")}
}

async function categories(){
  const host=document.querySelector("#adminCategoriesHost");if(!host)return;host.innerHTML=loading();
  try{const rows=await getAdminCategories();const render=()=>{host.innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Catégorie</th><th>Slug</th><th>Position</th><th>État</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr data-cat="${esc(c.id)}"><td><div class="table-primary">${esc(c.name)}</div><div class="table-secondary">${esc(c.description||"")}</div></td><td>${esc(c.slug)}</td><td>${esc(c.position)}</td><td>${c.is_active?'<span class="badge green">Active</span>':'<span class="badge">Inactive</span>'}</td><td><button class="btn btn-ghost btn-sm" data-toggle-cat type="button">${c.is_active?'Désactiver':'Activer'}</button></td></tr>`).join("")}</tbody></table></div>`;host.querySelectorAll("[data-toggle-cat]").forEach(b=>b.addEventListener("click",async()=>{const tr=b.closest("[data-cat]"),c=rows.find(x=>x.id===tr.dataset.cat);b.disabled=true;try{const out=await setAdminCategoryActive(c.id,!c.is_active);c.is_active=out.is_active;render()}catch{b.disabled=false}}))};render()}catch{host.innerHTML=errorBox("Impossible de charger les catégories.")}
}

async function featured(){
  const host=document.querySelector("#adminFeaturedHost");if(!host)return;host.innerHTML=loading();
  try{let rows=await getAdminFeatured();const render=()=>{host.innerHTML=`<div class="portal-card"><form id="featuredAdd" class="toolbar"><div class="toolbar-group"><input class="input" name="product_id" placeholder="UUID produit approuvé" required><input class="input" name="position" type="number" min="0" value="0" style="width:90px"></div><button class="btn btn-dark btn-sm" type="submit">Ajouter</button></form><p class="muted" style="font-size:9px">La table featured est administrable sous RLS admin. Le produit reste soumis à ses propres règles de visibilité.</p></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Produit</th><th>Position</th><th>Actif</th><th>Fenêtre</th><th></th></tr></thead><tbody>${rows.map(f=>`<tr data-featured="${esc(f.id)}"><td><div class="table-primary">${esc(f.products?.name||f.product_id)}</div><div class="table-secondary">${esc(f.product_id)}</div></td><td>${esc(f.position)}</td><td>${f.is_active?'<span class="badge green">Oui</span>':'<span class="badge">Non</span>'}</td><td>${esc(f.starts_at?fmtDate(f.starts_at):"—")} → ${esc(f.ends_at?fmtDate(f.ends_at):"—")}</td><td><div class="toolbar-group"><button class="btn btn-ghost btn-sm" data-featured-toggle type="button">${f.is_active?'Désactiver':'Activer'}</button><button class="btn btn-outline-red btn-sm" data-featured-remove type="button">Retirer</button></div></td></tr>`).join("")||'<tr><td colspan="5">Aucun produit mis en avant.</td></tr>'}</tbody></table></div>`;host.querySelector("#featuredAdd")?.addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector("button");btn.disabled=true;try{await addAdminFeatured(form.product_id.value.trim(),form.position.value);rows=await getAdminFeatured();render()}catch{btn.disabled=false}});host.querySelectorAll("[data-featured-toggle]").forEach(b=>b.addEventListener("click",async()=>{const tr=b.closest("[data-featured]"),f=rows.find(x=>x.id===tr.dataset.featured);try{await setAdminFeaturedActive(f.id,!f.is_active);f.is_active=!f.is_active;render()}catch{}}));host.querySelectorAll("[data-featured-remove]").forEach(b=>b.addEventListener("click",async()=>{const tr=b.closest("[data-featured]");try{await removeAdminFeatured(tr.dataset.featured);rows=rows.filter(x=>x.id!==tr.dataset.featured);render()}catch{}}))};render()}catch{host.innerHTML=errorBox("Impossible de charger les produits mis en avant.")}
}

async function disputes(){
  // RPC Admin environment-aware (admin_list_order_reports_v1) : plus de lecture globale d'order_reports.
  const host=document.querySelector("#adminDisputesHost");if(!host)return;host.innerHTML=loading();
  const state={status:""};
  const draw=async()=>{
    host.innerHTML=`<div class="toolbar"><div class="toolbar-group"><select id="adStatus"><option value="">Tous statuts</option>${ORDER_REPORT_STATUSES.map(s=>`<option value="${esc(s)}" ${s===state.status?"selected":""}>${esc(REPORT_STATUS_FR[s]||s)}</option>`).join("")}</select></div></div><div id="adList">${loading()}</div>`;
    host.querySelector("#adStatus").addEventListener("change",(e)=>{state.status=e.target.value;draw()});
    try{
      const r=await adminListOrderReports({status:state.status||null,limit:100});
      const list=host.querySelector("#adList");
      if(!r.rows.length){list.innerHTML=empty("Aucun signalement","Aucun litige ou signalement de commande n’est enregistré dans cet environnement.");refreshIcons();return}
      list.innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Commande</th><th>Rapporteur</th><th>Marchand</th><th>Type / raison</th><th>Statut</th><th>Date</th></tr></thead><tbody>${r.rows.map(x=>`<tr><td><a href="order-detail.html?id=${encodeURIComponent(x.order_id||"")}">#${esc(String(x.order_id||"").slice(0,8))}</a><div class="table-secondary">${esc([x.order_status,x.payment_status,x.currency].filter(Boolean).join(" · "))} ${envBadge(x.environment)}</div></td><td><code>${esc(String(x.reporter_user_id||"").slice(0,8))}</code></td><td><code>${esc(String(x.merchant_id||"").slice(0,8))}</code></td><td><div class="table-primary">${esc(x.report_type||"Signalement")}</div><div class="table-secondary">${esc(x.message||"")}</div></td><td>${badge(x.status||"open")}</td><td>${esc(fmtDate(x.created_at))}</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:12px">${esc(r.total??r.rows.length)} signalement(s).</p>`;
    }catch(err){host.querySelector("#adList").innerHTML=errorBox(adminErrorFr(err,"Impossible de charger les signalements."))}
  };
  await draw();
}
async function security(profile,session,roles){
  const host=document.querySelector("#adminSecurityHost");if(!host)return;host.innerHTML=`<div class="stat-grid"><div class="stat-card blue-stat"><div class="label">Session</div><div class="value" style="font-size:16px">Active</div><div class="delta">${esc(session?.user?.email||"—")}</div></div><div class="stat-card green-stat"><div class="label">Rôle admin</div><div class="value" style="font-size:16px">${roles.includes("admin")?"Oui":"Non"}</div></div><div class="stat-card amber-stat"><div class="label">Service role navigateur</div><div class="value" style="font-size:16px">Absent</div></div><div class="stat-card red-stat"><div class="label">Écritures critiques</div><div class="value" style="font-size:16px">RPC requis</div></div></div><div class="portal-card"><h3>Garde-fous frontend admin</h3><div class="settings-section"><div><strong>RLS</strong><p>Les lectures et écritures frontend restent exécutées avec la session authentifiée et dépendent des politiques RLS.</p></div><span class="badge green">Enforced</span></div><div class="settings-section"><div><strong>Approbation marchand / produit</strong><p>Écritures multi-étapes via RPC <code>SECURITY DEFINER</code> (rôle admin et environnement vérifiés serveur) : <code>admin_approve_merchant_application_v1</code>, <code>admin_reject_merchant_application_v1</code>, <code>admin_review_product</code>.</p></div><span class="badge green">RPC atomique</span></div><div class="settings-section"><div><strong>Identité admin</strong><p>${esc(profile?.full_name||session?.user?.email||"Admin")}</p></div>${roles.map(badge).join(" ")}</div></div>`;refreshIcons()
}


async function kycCaseDetail(){
  const host=document.querySelector("#adminKycCaseDetailHost");if(!host)return;
  const caseId=new URL(location.href).searchParams.get("id")||"";
  if(!caseId){host.innerHTML=empty("Dossier introuvable","Aucun identifiant de dossier KYC n'a été fourni.");refreshIcons();return;}
  host.innerHTML=loading("Chargement du dossier KYC…");
  let ctx,listRow=null;
  try{
    ctx=await adminGetKycContext(caseId);
    try{const cases=await adminListKycCases({limit:200});listRow=cases.find(c=>c.id===caseId)||null;}catch(e){}
  }catch(err){
    console.warn("[VinHT] kyc case:",err&&(err.message||err));
    host.innerHTML=errorBox(kycErrorMessage(err,"Impossible de charger ce dossier KYC."));
    return;
  }
  if(!ctx||!ctx.case){host.innerHTML=empty("Dossier introuvable","Ce dossier KYC n'existe pas ou n'est plus accessible.");refreshIcons();return;}

  const st=ctx.state||{};
  const adm=ctx.admin||{};
  const app=ctx.application||{};
  const mer=ctx.merchant||{};
  const user=(listRow&&listRow.user)||{};
  const shopName=app.shop_name||mer.shop_name||"—";

  const docSection=async(type,label)=>{
    const d=(ctx.documents||[]).find(x=>x.is_current&&x.document_type===type)||null;
    let media=`<p class="muted" style="font-size:12px">Aucun document ${label.toLowerCase()} fourni.</p>`;
    if(d){
      let url=null;try{url=await signedKycUrl(d.storage_path,120);}catch(e){}
      const isPdf=String(d.mime_type||"").includes("pdf");
      if(url&&isPdf) media=`<a class="btn btn-outline-blue btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir le document (PDF)</a>`;
      else if(url) media=`<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(label)}" style="max-width:100%;max-height:260px;border:1px solid var(--line,#e7eaf2);border-radius:10px;object-fit:contain;background:#f6f8fc"></a>`;
      else media=`<p class="muted" style="font-size:12px">Aperçu momentanément indisponible.</p><button class="btn btn-outline-blue btn-sm" type="button" data-kyc-doc-retry="${esc(d.storage_path)}" data-kyc-doc-retry-label="${esc(label)}">Réessayer / ouvrir le document</button>`;
    }
    const rej=d&&d.status==="rejected"&&d.review_reason?`<div class="error-state" style="margin-top:6px;font-size:12px"><strong>Motif :</strong> ${esc(d.review_reason)}</div>`:"";
    // Une fois une décision prise sur CE document, on n'affiche plus Accepter/Refuser
    // pour lui (même si le dossier reste globalement révisable pour l'autre document) :
    // sinon le bouton "Accepter" reste visible et laisse croire que rien n'a été décidé.
    const pending=d&&d.status==="uploaded";
    const controls=(pending&&adm.can_review)?`<div class="toolbar-group" style="margin-top:8px"><button class="btn btn-blue btn-sm" data-kyc-doc-accept="${esc(d.id)}">Accepter</button><button class="btn btn-outline-red btn-sm" data-kyc-doc-reject="${esc(d.id)}">Refuser</button></div>`
      :d&&d.status==="accepted"?`<p style="margin-top:8px;font-size:12px;color:var(--green,#1f9d4d);font-weight:700">Accepté ✓</p>`
      :"";
    return `<div class="portal-card"><div class="toolbar"><div><h3>${esc(label)}</h3></div>${d?badge(d.status):'<span class="badge">Manquant</span>'}</div>${media}${rej}${controls}</div>`;
  };

  const idHtml=await docSection("identity_document","Pièce d'identité");
  const selfieHtml=await docSection("selfie","Selfie de vérification");

  const approveNote=adm.can_approve?"":(
    (adm.unreviewed_current_documents>0?`${adm.unreviewed_current_documents} document(s) restent à examiner. `:"")+
    ((adm.missing_required_documents&&adm.missing_required_documents.length)?`Documents manquants : ${esc(adm.missing_required_documents.join(", "))}. `:"")+
    (String(st.code)==="approved"?"Ce dossier est déjà approuvé. ":"")
  );

  host.innerHTML=`
    <div class="portal-card"><div class="toolbar"><div><h3>${esc(shopName)}</h3><div class="table-secondary">Dossier ${esc(String(ctx.case.id).slice(0,8))} · <a href="applications.html">Demandes marchands</a></div></div><div class="toolbar-group">${kycBadge(st.code||ctx.case.status)}</div></div>
      <div class="settings-section"><div><strong>${esc(st.title||"Vérification")}</strong><p>${esc(st.message||"")}</p></div></div>
      <div class="settings-section"><div><strong>Demandeur</strong><p>${esc(user.full_name||"—")} · ${esc(user.email||"—")}${user.phone?` · ${esc(user.phone)}`:""}</p></div></div>
      <div class="settings-section"><div><strong>Demande</strong><p>${esc(app.merchant_type||mer.merchant_type||"—")} · plan ${esc(app.requested_plan_code||mer.plan_code||"—")} · envoyé le ${esc(fmtDate(ctx.case.submitted_at)||"—")}</p></div></div>
    </div>
    ${idHtml}
    ${selfieHtml}
    <div class="portal-card"><h3>Décision KYC</h3>
      <div class="toolbar-group" style="margin-top:8px">
        ${adm.can_request_changes?`<button class="btn btn-outline-blue btn-sm" id="kycRequestChanges">Demander des corrections</button>`:""}
        <button class="btn btn-blue btn-sm" id="kycApprove" ${adm.can_approve?"":"disabled"}>Approuver le KYC</button>
        ${adm.can_reject?`<button class="btn btn-outline-red btn-sm" id="kycReject">Refuser le KYC</button>`:""}
      </div>
      ${approveNote?`<p class="muted" style="font-size:12px;margin:8px 0 0">${approveNote}</p>`:""}
    </div>`;

  const reload=()=>kycCaseDetail();
  host.querySelectorAll("[data-kyc-doc-retry]").forEach(b=>b.addEventListener("click",async()=>{
    b.disabled=true;const t0=b.textContent;b.textContent="Génération du lien…";
    try{
      const url=await signedKycUrl(b.dataset.kycDocRetry,120);
      if(url) window.open(url,"_blank","noopener");
      else showToast("Aperçu toujours indisponible. Réessayez dans un instant.","red");
    }catch(err){showToast(kycErrorMessage(err,"Aperçu indisponible."),"red");}
    finally{b.disabled=false;b.textContent=t0;}
  }));
  host.querySelectorAll("[data-kyc-doc-accept]").forEach(b=>b.addEventListener("click",async()=>{b.disabled=true;try{await adminReviewKycDocument(b.dataset.kycDocAccept,"accepted");showToast("Document accepté ✓");reload();}catch(err){showToast(kycErrorMessage(err,"Action impossible."),"red");b.disabled=false;}}));
  host.querySelectorAll("[data-kyc-doc-reject]").forEach(b=>b.addEventListener("click",async()=>{const r=window.prompt("Motif du refus (obligatoire, visible par le demandeur) :");if(r===null)return;if(!r.trim()){showToast("Motif obligatoire","red");return;}b.disabled=true;try{await adminReviewKycDocument(b.dataset.kycDocReject,"rejected",r.trim());showToast("Document refusé ✓");reload();}catch(err){showToast(kycErrorMessage(err,"Action impossible."),"red");b.disabled=false;}}));
  host.querySelector("#kycRequestChanges")?.addEventListener("click",async()=>{const r=window.prompt("Motif / corrections demandées (obligatoire, visible par le demandeur) :");if(r===null)return;if(!r.trim()){showToast("Motif obligatoire","red");return;}try{await adminRequestKycChanges(ctx.case.id,r.trim());showToast("Corrections demandées ✓");reload();}catch(err){showToast(kycErrorMessage(err,"Action impossible."),"red");}});
  host.querySelector("#kycApprove")?.addEventListener("click",async(e)=>{const b=e.currentTarget;b.disabled=true;try{await adminApproveKyc(ctx.case.id,null);showToast("KYC approuvé ✓");reload();}catch(err){showToast(kycErrorMessage(err,"Approbation impossible."),"red");b.disabled=false;}});
  host.querySelector("#kycReject")?.addEventListener("click",async()=>{const r=window.prompt("Motif du refus du KYC (obligatoire, visible par le demandeur) :");if(r===null)return;if(!r.trim()){showToast("Motif obligatoire","red");return;}try{await adminRejectKyc(ctx.case.id,r.trim());showToast("KYC refusé ✓");reload();}catch(err){showToast(kycErrorMessage(err,"Action impossible."),"red");}});
  refreshIcons();
}

async function mountAdminEnvBar(){
  const main=document.querySelector(".portal-main");if(!main||main.querySelector("[data-admin-envbar]"))return;
  const wrap=document.createElement("div");wrap.setAttribute("data-admin-envbar","");
  try{const env=await getAdminEnvironment();wrap.innerHTML=envBanner(env)}
  catch{wrap.innerHTML=`<div class="cc-envbar cc-envbar-prod" role="alert"><div><strong>Environnement admin indisponible</strong> <span class="muted">Impossible de le lire depuis votre profil : aucune liste Produits/Commandes/Marchands ne sera affichée tant qu'il est inconnu.</span></div></div>`}
  main.insertBefore(wrap,main.firstChild);
}
export async function initAdminPortal(){
  const page=document.body.dataset.adminPage;if(!page)return;
  const session=await getSession();if(!session?.user){gate("auth");onAuthChange(s=>{if(s?.user)location.reload()});return}
  let roles=[];try{roles=await getMyRoles()}catch{}if(!roles.includes("admin")){gate("role");return}
  showContent();let profile=null;try{profile=await getMyProfile()}catch{}fillIdentity(profile,session);
  if(page!=="control-center")await mountAdminEnvBar();
  if(page==="dashboard")await dashboard();
  else if(page==="products")await productsV2();
  else if(page==="product-detail")await productDetailV2();
  else if(page==="applications")await applications();
  else if(page==="application-detail")await applicationDetail();
  else if(page==="kyc-case")await kycCaseDetail();
  else if(page==="merchants")await merchants();
  else if(page==="merchant-detail")await merchantDetail();
  else if(page==="orders")await orders();
  else if(page==="order-detail")await orderDetail();
  else if(page==="users")await users();
  else if(page==="user-detail")await userDetail();
  else if(page==="categories")await categories();
  else if(page==="featured")await featured();
  else if(page==="disputes")await disputes();
  else if(page==="analytics")await analytics();
  else if(page==="notifications")await notifications();
  else if(page==="promotions")await adminPromotionsPage();
  else if(page==="ads")await adminAdsPage();
  else if(page==="security")await security(profile,session,roles);
  else if(page==="settings")settings();
  else if(page==="control-center")await initControlCenter({renderLegacySettings:(host,opts)=>settings(host,opts)});
  refreshIcons();
}
