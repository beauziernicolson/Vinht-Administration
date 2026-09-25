import { money } from "../lib/format.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "../ui/toast.js";
import { confirmAction, adminErrorFr } from "../ui/adminUi.js";
import {
  adminListMarketplaceOffers,
  adminSetMarketplaceOfferStatus,
  adminListDropshipAuthorizations,
  adminRevokeDropshipAuthorization,
  marketplaceOwnershipErrorFr,
} from "../services/adminMarketplaceOwnership.js";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const OFFER_STATUS_FR = { draft: "Brouillon", active: "Active", paused: "En pause", archived: "Archivée" };
const AUTH_STATUS_FR = { requested: "Demandée", approved: "Approuvée", rejected: "Refusée", revoked: "Révoquée" };
const KIND_FR = { direct: "Directe", dropship: "Dropship" };
const statusClass = (s) => s === "active" || s === "approved" ? "green" : s === "requested" || s === "draft" ? "amber" : s === "archived" || s === "revoked" || s === "rejected" ? "red" : "blue";
const badge = (label, s) => `<span class="badge ${statusClass(s)}">${esc(label)}</span>`;
const fmtDate = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); };

function offerPrice(row) {
  if (row.retail_price != null) return money(row.retail_price, row.currency || "HTG");
  if (row.wholesale_price != null) return money(row.wholesale_price, row.currency || "HTG");
  return "—";
}

function offerActions(row) {
  const parts = [];
  if (row.status === "active") parts.push(`<button class="btn btn-outline-blue btn-sm" type="button" data-offer-status="paused" data-offer-id="${esc(row.id)}">Mettre en pause</button>`);
  if (row.status === "paused" || row.status === "draft" || row.status === "archived") parts.push(`<button class="btn btn-outline-blue btn-sm" type="button" data-offer-status="active" data-offer-id="${esc(row.id)}">Réactiver</button>`);
  if (row.status !== "archived") parts.push(`<button class="btn btn-outline-red btn-sm" type="button" data-offer-status="archived" data-offer-id="${esc(row.id)}">Archiver</button>`);
  return parts.join("");
}

function offersRows(rows) {
  if (!rows.length) return `<div class="empty-state"><h3>Aucune offre</h3><p>Aucune offre Marketplace ne correspond aux filtres dans cet environnement.</p></div>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Offres Marketplace"><table class="data-table"><thead><tr><th>Produit / offre</th><th>Vendeur</th><th>Type</th><th>Prix</th><th>Statut</th><th>Dropship</th><th>Mise à jour</th><th>Actions</th></tr></thead><tbody>${rows.map((r) => `
    <tr>
      <td><strong>${esc(r.product_name || "Produit")}</strong><div class="muted" style="font-size:11px">${esc(r.seller_sku || r.id)}</div><div class="toolbar-group" style="margin-top:4px"><a href="product-detail.html?id=${encodeURIComponent(r.product_id)}" class="link-inline">Produit</a></div></td>
      <td><strong>${esc(r.seller_shop_name || "Marchand")}</strong><div class="muted" style="font-size:11px">Stock : ${esc(r.stock_owner_shop_name || "—")}</div><a href="merchant-detail.html?id=${encodeURIComponent(r.seller_merchant_id)}" class="link-inline">Marchand</a></td>
      <td>${badge(KIND_FR[r.offer_kind] || r.offer_kind, r.offer_kind === "dropship" ? "paused" : "active")}<div class="muted" style="font-size:11px">${esc(r.sales_mode || "—")} · ${esc(r.currency || "HTG")}</div></td>
      <td>${esc(offerPrice(r))}</td>
      <td>${badge(OFFER_STATUS_FR[r.status] || r.status, r.status)}</td>
      <td>${r.offer_kind === "direct" ? `${r.allow_dropshipping ? badge("Autorisé", "active") : badge("Non", "archived")}<div class="muted" style="font-size:11px">${Number(r.approved_dropship_authorizations || 0)} autorisation(s)</div>` : `<span class="muted">Source liée</span>`}</td>
      <td>${esc(fmtDate(r.updated_at))}</td>
      <td><div class="toolbar-group">${offerActions(r)}</div></td>
    </tr>`).join("")}</tbody></table></div>`;
}

function authorizationRows(rows) {
  if (!rows.length) return `<div class="empty-state"><h3>Aucune autorisation</h3><p>Aucune relation dropshipping ne correspond au filtre.</p></div>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Autorisations dropshipping"><table class="data-table"><thead><tr><th>Produit</th><th>Fournisseur</th><th>Vendeur</th><th>Statut</th><th>Conditions</th><th>Offres actives</th><th>Actions</th></tr></thead><tbody>${rows.map((r) => `
    <tr>
      <td><strong>${esc(r.product_name || "Produit")}</strong><div class="muted" style="font-size:11px">Source : ${esc(r.source_offer_id)}</div></td>
      <td>${esc(r.supplier_shop_name || "—")}</td>
      <td>${esc(r.vendeur_shop_name || "—")}</td>
      <td>${badge(AUTH_STATUS_FR[r.status] || r.status, r.status)}<div class="muted" style="font-size:11px">Source ${esc(r.source_offer_status || "—")}${r.source_allows_dropshipping ? " · dropship ON" : " · dropship OFF"}</div></td>
      <td><div class="muted" style="font-size:11px">Fournisseur : ${r.supplier_unit_price_htg == null ? "—" : esc(money(r.supplier_unit_price_htg, "HTG"))}<br>Min : ${r.min_resale_price_htg == null ? "—" : esc(money(r.min_resale_price_htg, "HTG"))}<br>Max : ${r.max_resale_price_htg == null ? "—" : esc(money(r.max_resale_price_htg, "HTG"))}</div></td>
      <td>${esc(Number(r.active_derived_offers || 0))}</td>
      <td>${["requested","approved"].includes(r.status) ? `<button class="btn btn-outline-red btn-sm" type="button" data-revoke-auth="${esc(r.id)}">Révoquer…</button>` : "—"}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

export async function renderAdminMarketplaceOwnership(host, { env = null } = {}) {
  if (!host) return;
  const offerState = { status: "", kind: "", search: "", offset: 0, limit: 50 };
  const authState = { status: "", offset: 0, limit: 50 };

  host.innerHTML = `
    <div class="portal-card">
      <div class="toolbar"><div><h3 style="margin:0">Marketplace — contrôle propriétaire</h3><p class="muted" style="margin:4px 0 0">Supervision des offres et autorisations dropshipping. Les prix commerciaux restent gérés par les parcours marchands ; l’Admin peut intervenir sur la disponibilité et la sécurité.</p></div>${env ? `<span class="badge ${env === "demo" ? "amber" : "green"}">${esc(String(env).toUpperCase())}</span>` : ""}</div>
      <form data-offer-filters class="toolbar" style="margin-top:12px;align-items:end">
        <label class="field"><span>Recherche</span><input class="input" name="search" placeholder="Produit, marchand ou SKU"></label>
        <label class="field"><span>Statut</span><select class="input" name="status"><option value="">Tous</option><option value="active">Actives</option><option value="paused">En pause</option><option value="draft">Brouillons</option><option value="archived">Archivées</option></select></label>
        <label class="field"><span>Type</span><select class="input" name="kind"><option value="">Tous</option><option value="direct">Directes</option><option value="dropship">Dropship</option></select></label>
        <button class="btn btn-outline-blue btn-sm" type="submit">Filtrer</button>
      </form>
      <div data-offers style="margin-top:12px"><div class="loading-state">Chargement des offres…</div></div>
      <div class="toolbar" data-offer-pager style="margin-top:10px"></div>
    </div>

    <div class="portal-card">
      <div class="toolbar"><div><h3 style="margin:0">Autorisations dropshipping</h3><p class="muted" style="margin:4px 0 0">L’Admin peut révoquer une autorisation pour protéger la plateforme. Toute offre dropship dérivée encore active est alors mise en pause automatiquement.</p></div></div>
      <form data-auth-filters class="toolbar" style="margin-top:12px;align-items:end">
        <label class="field"><span>Statut</span><select class="input" name="status"><option value="">Tous</option><option value="requested">Demandées</option><option value="approved">Approuvées</option><option value="rejected">Refusées</option><option value="revoked">Révoquées</option></select></label>
        <button class="btn btn-outline-blue btn-sm" type="submit">Filtrer</button>
      </form>
      <div data-auths style="margin-top:12px"><div class="loading-state">Chargement des autorisations…</div></div>
      <div class="toolbar" data-auth-pager style="margin-top:10px"></div>
    </div>`;

  const offersHost = host.querySelector("[data-offers]");
  const authHost = host.querySelector("[data-auths]");
  const offerPager = host.querySelector("[data-offer-pager]");
  const authPager = host.querySelector("[data-auth-pager]");

  async function loadOffers() {
    offersHost.innerHTML = `<div class="loading-state">Chargement des offres…</div>`;
    try {
      const d = await adminListMarketplaceOffers(offerState);
      offersHost.innerHTML = offersRows(d.rows);
      offerPager.innerHTML = `<span class="muted" style="font-size:11px">${d.total == null ? d.rows.length : `${Math.min(d.offset + 1, d.total)}–${Math.min(d.offset + d.rows.length, d.total)} sur ${d.total}`}</span><div class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" data-prev ${d.offset <= 0 ? "disabled" : ""}>Précédent</button><button class="btn btn-ghost btn-sm" type="button" data-next ${!d.hasMore ? "disabled" : ""}>Suivant</button></div>`;
      offerPager.querySelector("[data-prev]")?.addEventListener("click", () => { offerState.offset = Math.max(0, offerState.offset - offerState.limit); loadOffers(); });
      offerPager.querySelector("[data-next]")?.addEventListener("click", () => { offerState.offset += offerState.limit; loadOffers(); });
      offersHost.querySelectorAll("[data-offer-status]").forEach((b) => b.addEventListener("click", async () => {
        const target = b.dataset.offerStatus;
        const label = target === "active" ? "Réactiver cette offre ?" : target === "paused" ? "Mettre cette offre en pause ?" : "Archiver cette offre ?";
        const ok = await confirmAction({
          title: label,
          env,
          requireReason: true,
          minReason: 5,
          danger: target === "archived",
          confirmLabel: target === "active" ? "Réactiver" : target === "paused" ? "Mettre en pause" : "Archiver",
          consequences: target === "active"
            ? ["Une offre dropship ne peut être réactivée que si son autorisation et son offre source sont encore valides.", "L’action est auditée comme override Admin."]
            : ["L’offre ne sera plus proposée comme offre active.", "Aucune commande passée ni historique n’est supprimé.", "L’action est auditée comme override Admin."],
        });
        if (!ok) return;
        b.disabled = true;
        try { await adminSetMarketplaceOfferStatus(b.dataset.offerId, target, ok.reason); showToast("Statut Marketplace modifié ✓"); await loadOffers(); await loadAuths(); }
        catch (e) { showToast(marketplaceOwnershipErrorFr(e, adminErrorFr(e, "Action Marketplace refusée.")), "red"); b.disabled = false; }
      }));
      refreshIcons();
    } catch (e) {
      offersHost.innerHTML = `<div class="error-state">${esc(marketplaceOwnershipErrorFr(e, "Offres Marketplace indisponibles."))}</div>`;
      offerPager.innerHTML = "";
    }
  }

  async function loadAuths() {
    authHost.innerHTML = `<div class="loading-state">Chargement des autorisations…</div>`;
    try {
      const d = await adminListDropshipAuthorizations(authState);
      authHost.innerHTML = authorizationRows(d.rows);
      authPager.innerHTML = `<span class="muted" style="font-size:11px">${d.total == null ? d.rows.length : `${Math.min(d.offset + 1, d.total)}–${Math.min(d.offset + d.rows.length, d.total)} sur ${d.total}`}</span><div class="toolbar-group"><button class="btn btn-ghost btn-sm" type="button" data-prev ${d.offset <= 0 ? "disabled" : ""}>Précédent</button><button class="btn btn-ghost btn-sm" type="button" data-next ${!d.hasMore ? "disabled" : ""}>Suivant</button></div>`;
      authPager.querySelector("[data-prev]")?.addEventListener("click", () => { authState.offset = Math.max(0, authState.offset - authState.limit); loadAuths(); });
      authPager.querySelector("[data-next]")?.addEventListener("click", () => { authState.offset += authState.limit; loadAuths(); });
      authHost.querySelectorAll("[data-revoke-auth]").forEach((b) => b.addEventListener("click", async () => {
        const ok = await confirmAction({
          title: "Révoquer cette autorisation dropshipping ?",
          env,
          requireReason: true,
          minReason: 5,
          danger: true,
          confirmLabel: "Révoquer",
          consequences: ["L’autorisation passe à Révoquée.", "Les offres dropship dérivées encore actives sont mises en pause automatiquement.", "Le fournisseur et le vendeur conservent leur historique ; rien n’est supprimé."],
        });
        if (!ok) return;
        b.disabled = true;
        try {
          const r = await adminRevokeDropshipAuthorization(b.dataset.revokeAuth, ok.reason);
          showToast(`Autorisation révoquée ✓${Number(r?.paused_derived_offers || 0) ? ` · ${r.paused_derived_offers} offre(s) mise(s) en pause` : ""}`);
          await loadAuths(); await loadOffers();
        } catch (e) { showToast(marketplaceOwnershipErrorFr(e, adminErrorFr(e, "Révocation refusée.")), "red"); b.disabled = false; }
      }));
      refreshIcons();
    } catch (e) {
      authHost.innerHTML = `<div class="error-state">${esc(marketplaceOwnershipErrorFr(e, "Autorisations dropshipping indisponibles."))}</div>`;
      authPager.innerHTML = "";
    }
  }

  host.querySelector("[data-offer-filters]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    offerState.search = f.search.value.trim();
    offerState.status = f.status.value;
    offerState.kind = f.kind.value;
    offerState.offset = 0;
    loadOffers();
  });
  host.querySelector("[data-auth-filters]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    authState.status = f.status.value;
    authState.offset = 0;
    loadAuths();
  });

  await Promise.allSettled([loadOffers(), loadAuths()]);
  refreshIcons();
}
