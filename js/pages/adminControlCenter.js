// VinHT Control Center — page Admin unique (admin/control-center.html).
//
// Objectif : que l'admin administre l'entreprise sans développeur.
// Règle : UI Admin -> RPC Admin sécurisée -> validation backend -> audit.
// Jamais d'update direct de table critique. Les réglages avancés non requis au lancement sont explicitement classés post-lancement.

import { getSession } from "../services/auth.js";
import { getMyProfile } from "../services/profile.js";
import { showToast } from "../ui/toast.js";
import { adminCountPendingMerchantApplications } from "../services/adminMerchantApplications.js";
import { refreshIcons } from "../lib/icons.js";
import { getUiPreferences, setUiPreferences } from "../services/preferences.js";
import {
  esc, envBanner, envPill, onOff, chip, mountTabs, errorBox, confirmAction, adminErrorFr,
} from "../ui/adminUi.js";
import { getLogisticsRuntimeCapabilities } from "../services/adminControl.js";
import { adminGetPlatformControlCenter, setUserCommerceEnvironment } from "../services/admin.js?v=20260922-mega-a-v1";
import { renderCouriers, renderAgents } from "./adminCcPeople.js";
import { renderLogistics, renderMissions } from "./adminCcOps.js";
import { renderTrust, renderPayments } from "./adminCcTrust.js";

// Compteurs « attention » du cockpit -> onglet du Control Center (ou page admin
// existante). Uniquement des destinations qui existent réellement.
const ATTENTION = [
  { key: "kyc_pending", label: "KYC en attente", href: "applications.html" },
  { key: "products_pending", label: "Produits à examiner", href: "products.html" },
  { key: "couriers_pending_review", label: "Livreurs à examiner", href: "control-center.html#livreurs" },
  { key: "delivery_issues", label: "Incidents de livraison", href: "control-center.html#missions" },
  { key: "trade_protection_open", label: "Litiges Trade Insurance ouverts", href: "control-center.html#confiance" },
  { key: "certifications_pending", label: "Certifications en attente", href: "control-center.html#confiance" },
  { key: "verification_badges_pending", label: "Badges de vérification en attente", href: "control-center.html#confiance" },
  { key: "seller_health_at_risk", label: "Marchands à risque", href: "merchants.html" },
  { key: "pro_past_due", label: "Abonnements Pro en retard", href: "control-center.html#paiements" },
  { key: "pro_suspended", label: "Abonnements Pro suspendus", href: "control-center.html#paiements" },
  { key: "flexicash_connections_not_ready", label: "Connexions FlexiCash non prêtes", href: "control-center.html#paiements" },
];

const ctx = { env: null, userId: null, legacy: null };

async function renderGeneral(body) {
  const p = getUiPreferences();
  body.innerHTML = `
    <div class="portal-card"><div class="toolbar"><div><h3 style="margin:0">Environnement</h3>
      <p class="muted" style="margin:2px 0 0">Votre profil admin détermine l'environnement de <strong>toutes</strong> les listes et actions du Control Center.</p></div>
      <div class="toolbar-group">${envPill(ctx.env)}<button class="btn btn-outline-blue btn-sm" type="button" data-switch-env>Passer en ${ctx.env === "demo" ? "Production" : "Demo"}…</button></div></div>
      <p class="muted" style="font-size:12px">Demo et Production ne se mélangent jamais : les événements Demo n'apparaissent pas dans les listes Production, et inversement. Les écrans qui lisent directement des tables (produits, commandes, marchands) suivent l'environnement de cet admin, affiché ci-dessus.</p></div>
    <div class="portal-card"><h3 style="margin-top:0">État des services</h3><div data-runtime><div class="loading-state">Lecture de la configuration…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Attention requise</h3><div data-attention><div class="loading-state">Chargement…</div></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Préférences d'affichage (cet appareil)</h3>
      <form data-ui><div class="settings-section"><div><strong>Grille compacte</strong><p>Plus de lignes dans les écrans d'administration.</p></div><label class="switch"><input type="checkbox" name="compact_grid" ${p.compactGrid ? "checked" : ""}><span></span></label></div>
      <div class="settings-section"><div><strong>Réduire les animations</strong><p>Uniquement sur cet appareil ; aucune configuration serveur.</p></div><label class="switch"><input type="checkbox" name="reduce_motion" ${p.reduceMotion ? "checked" : ""}><span></span></label></div></form></div>`;

  body.querySelector("[data-switch-env]").addEventListener("click", switchEnv);
  const f = body.querySelector("[data-ui]");
  f.compact_grid.addEventListener("change", () => setUiPreferences({ compactGrid: f.compact_grid.checked }));
  f.reduce_motion.addEventListener("change", () => setUiPreferences({ reduceMotion: f.reduce_motion.checked }));

  const rt = body.querySelector("[data-runtime]");
  getLogisticsRuntimeCapabilities().then((c) => {
    const m = c.delivery_methods || {};
    const methodRow = (label, v) => `<span style="margin-right:12px">${esc(label)} ${onOff(v && (v.available ?? v) === true, "dispo", "indispo")}</span>`;
    rt.innerHTML = `
      <div class="settings-section"><div><strong>Logistique</strong><p>${c.public_message_fr ? esc(c.public_message_fr) : "Interrupteur général de la livraison."}</p></div>${onOff(c.logistics_enabled === true)}</div>
      <div class="settings-section"><div><strong>Dispatch</strong><p>Publication et attribution des missions.</p></div>${onOff(c.dispatch_enabled === true)}</div>
      <div class="settings-section"><div><strong>Opérations livreur</strong><p>Passage en ligne et actions livreur.</p></div>${onOff(c.courier_operations_enabled === true)}</div>
      <div class="settings-section"><div><strong>Marketplace livreur</strong><p>Les livreurs voient et prennent les missions.</p></div>${onOff(c.courier_marketplace_enabled === true)}</div>
      <div class="settings-section"><div><strong>Mode d'assignation</strong><p>admin · marketplace · hybride.</p></div>${chip(c.assignment_mode || "—")}</div>
      <div class="settings-section"><div><strong>Méthodes de livraison</strong><p>${methodRow("Domicile", m.home)}${methodRow("Point VinHT", m.pickup_point)}${methodRow("Rencontre sécurisée", m.secure_meeting)}</p></div></div>
      <div class="settings-section"><div><strong>Signaux de présence client</strong><p>Le client peut signaler « en route / arrivé / lieu non sûr ».</p></div>${onOff(c.customer_presence_signals_enabled === true)}</div>
      <p class="muted" style="font-size:12px">Modification : onglet <a href="#logistique">Logistique</a> (brouillon → contrôle → activation, avec motif et audit).</p>`;
  }).catch((e) => { rt.innerHTML = errorBox(adminErrorFr(e, "Configuration logistique indisponible.")); });

  const att = body.querySelector("[data-attention]");
  adminGetPlatformControlCenter().then((cc) => {
    const a = cc.attention && typeof cc.attention === "object" ? cc.attention : {};
    att.innerHTML = ATTENTION.map((r) => {
      const v = a[r.key];
      const n = Number.isFinite(Number(v)) ? Number(v) : null;
      return `<a class="settings-section cc-linkrow" href="${esc(r.href)}"><div><strong>${esc(r.label)}</strong></div><span class="badge ${n > 0 ? "amber" : ""}">${n === null ? "—" : esc(n)}</span></a>`;
    }).join("");
  }).catch((e) => { att.innerHTML = errorBox(adminErrorFr(e, "Compteurs indisponibles.")); });
}

async function switchEnv() {
  const target = ctx.env === "demo" ? "production" : "demo";
  const ok = await confirmAction({
    title: `Passer votre compte admin en ${target === "demo" ? "DEMO" : "PRODUCTION"} ?`,
    message: "Cette bascule change l'environnement de toutes vos listes et actions admin (elle ne migre aucune donnée).",
    consequences: target === "production"
      ? ["Vous verrez et modifierez des données Production (clients et argent réels).", "Les actions dangereuses restent protégées par confirmation et motif."]
      : ["Vous verrez uniquement des données Demo.", "Aucune donnée Production n'est modifiée."],
    requireReason: true, minReason: 5, confirmLabel: "Changer d'environnement", danger: target === "production",
  });
  if (!ok) return;
  try { await setUserCommerceEnvironment(ctx.userId, target, ok.reason); showToast("Environnement modifié ✓"); location.reload(); }
  catch (e) { showToast(adminErrorFr(e, "Changement d'environnement refusé."), "red"); }
}

async function renderCommerce(body) {
  body.innerHTML = `
    <div class="portal-card"><h3 style="margin-top:0">Raccourcis Commerce</h3>
      <div class="settings-section"><div><strong>Demandes marchands & KYC</strong><p>Candidatures, dossiers d'identité. <span class="badge amber" data-pending-apps>…</span></p></div><a class="btn btn-outline-blue btn-sm" href="applications.html">Ouvrir</a></div>
      <div class="settings-section"><div><strong>Promotions</strong><p>Runtime promotions et campagnes marchandes.</p></div><a class="btn btn-outline-blue btn-sm" href="promotions.html">Ouvrir</a></div>
      <div class="settings-section"><div><strong>Publicité (Ads)</strong><p>Campagnes et financement.</p></div><a class="btn btn-outline-blue btn-sm" href="ads.html">Ouvrir</a></div>
      <div class="settings-section"><div><strong>Notifications & campagnes</strong><p>Diffusion aux utilisateurs.</p></div><a class="btn btn-outline-blue btn-sm" href="notifications.html">Ouvrir</a></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Offre de lancement, tarifs et livraison USD</h3>
      <p class="muted">Réglages modifiables via RPC Admin (frais Individuel, abonnement Pro, commission, tarifs de livraison USD).</p><div id="adminSettingsHost"></div></div>
    <div class="portal-card"><h3 style="margin-top:0">Réglages avancés — post-lancement</h3>
      <p class="muted">Ces éditeurs ne bloquent pas le lancement : les valeurs métier actuellement validées restent autoritaires côté serveur. Ils sont planifiés après stabilisation du lancement.</p>
      <div class="settings-section"><div><strong>Commission et frais du plan Professionnel</strong><p>POST-LAUNCH / NON-BLOCKING — les prix et la commission Pro validés restent gérés par le moteur et l'offre de lancement ; aucun éditeur libre avant stabilisation.</p></div>${chip("Post-launch","blue")}</div>
      <div class="settings-section"><div><strong>Politique complète de facturation Pro</strong><p>POST-LAUNCH / NON-BLOCKING — lecture autoritaire et kill-switch Production sont maintenant disponibles dans Paiements ; l'éditeur complet (grâce, suspension, pause) reste volontairement différé.</p></div>${chip("Post-launch","blue")}</div>
      <div class="settings-section"><div><strong>Canaux de notification</strong><p>POST-LAUNCH / NON-BLOCKING — activation par canal/environnement à livrer après stabilisation des opérations.</p></div>${chip("Post-launch","blue")}</div>
      <div class="settings-section"><div><strong>Paramètres de réputation vendeur</strong><p>POST-LAUNCH / NON-BLOCKING — le moteur serveur reste autoritaire ; l'éditeur des poids/seuils sera ajouté après observation de données réelles.</p></div>${chip("Post-launch","blue")}</div>
    </div>`;
  adminCountPendingMerchantApplications()
    .then((r) => { const el = body.querySelector("[data-pending-apps]"); if (el) el.textContent = `${r.count} en attente`; })
    .catch(() => { const el = body.querySelector("[data-pending-apps]"); if (el) el.textContent = "compteur indisponible"; });
  if (typeof ctx.legacy === "function") {
    try { await ctx.legacy(body.querySelector("#adminSettingsHost"), { only: "commerce", env: ctx.env }); }
    catch (e) { body.querySelector("#adminSettingsHost").innerHTML = errorBox(adminErrorFr(e, "Réglages indisponibles.")); }
  }
  refreshIcons();
}

function tabsList() {
  return [
    { id: "general", label: "Général", render: renderGeneral },
    { id: "commerce", label: "Commerce", render: renderCommerce },
    { id: "logistique", label: "Logistique", render: (b) => renderLogistics(b, { env: ctx.env }) },
    { id: "missions", label: "Missions", render: (b) => renderMissions(b, { env: ctx.env }) },
    { id: "livreurs", label: "Livreurs", render: (b) => renderCouriers(b, { env: ctx.env }) },
    { id: "agents", label: "Agents", render: (b) => renderAgents(b, { env: ctx.env }) },
    { id: "confiance", label: "Confiance & sécurité", render: (b) => renderTrust(b, { env: ctx.env }) },
    { id: "paiements", label: "Paiements", render: (b) => renderPayments(b, { env: ctx.env }) },
  ];
}

export async function initControlCenter({ renderLegacySettings } = {}) {
  const host = document.querySelector("#adminControlCenterHost");
  if (!host) return;
  ctx.legacy = renderLegacySettings || null;
  try { const s = await getSession(); ctx.userId = s?.user?.id || null; } catch { /* ignoré */ }

  host.innerHTML = `<div data-cc-envbanner></div><div class="cc-tabs" role="tablist" data-cc-tabs></div><div data-cc-body></div>`;
  try {
    const cc = await adminGetPlatformControlCenter();
    ctx.env = String(cc.environment || "").toLowerCase();
  } catch {
    try { const pr = await getMyProfile(); ctx.env = String(pr?.commerce_environment || "").toLowerCase(); } catch { ctx.env = null; }
  }
  host.querySelector("[data-cc-envbanner]").innerHTML = ctx.env
    ? envBanner(ctx.env)
    : `<div class="cc-envbar cc-envbar-unknown"><strong>Environnement admin indisponible.</strong> <span class="muted">Les actions restent protégées côté serveur.</span></div>`;

  const tabs = tabsList();
  mountTabs(host, tabs, {
    initial: "general",
    onShow: async (tab, body) => { await tab.render(body, { env: ctx.env }); refreshIcons(); },
  });
}
