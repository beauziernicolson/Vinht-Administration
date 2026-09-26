import {
  adminListProductImages,
  adminUploadProductImage,
  adminDeleteProductImage,
  adminProductImagePublicUrl,
  adminProductImageErrorFr,
} from "../services/adminProductImages.js";
import { confirmAction, esc } from "../ui/adminUi.js";
import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";

let observer = null;
let rendering = false;

const isProductDetail = () => document.body?.dataset?.adminPage === "product-detail" || String(location.pathname || "").includes("/admin/product-detail.html");
const productId = () => new URL(location.href).searchParams.get("id") || "";

function imageCard(row, productName) {
  const src = adminProductImagePublicUrl(row.storage_path);
  const badgeStyle = row.is_primary
    ? "color:#166534;background:#f0fdf4"
    : "color:#3f3f46;background:#f4f4f5";
  return `<figure style="margin:0;border:1px solid var(--line,#e7eaf2);border-radius:12px;padding:10px;display:grid;gap:8px;min-width:0">
    <img src="${esc(src)}" alt="${esc(row.alt_text || productName || "Image produit")}" style="width:100%;aspect-ratio:1/1;object-fit:contain;background:var(--soft,#f6f8fc);border-radius:8px">
    <figcaption style="display:grid;gap:6px">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="badge ${row.is_primary ? "green" : ""}" style="${badgeStyle}">${row.is_primary ? "Principale" : `Position ${esc(row.position)}`}</span></div>
      <small style="color:#52525b;overflow-wrap:anywhere">${esc(row.storage_path)}</small>
      <button class="btn btn-outline-red btn-sm" style="color:#ba1530;border-color:#ba1530" type="button" data-admin-delete-product-image="${esc(row.id)}">Retirer l’image…</button>
    </figcaption>
  </figure>`;
}

async function renderCard(host) {
  if (rendering) return;
  const id = productId();
  if (!id || !host || !host.querySelector(".portal-card")) return;
  rendering = true;

  let card = host.querySelector("#adminProductImagesOwnership");
  if (!card) {
    card = document.createElement("section");
    card.className = "portal-card";
    card.id = "adminProductImagesOwnership";
    host.appendChild(card);
  }
  card.innerHTML = `<h3 style="margin-top:0">Images produit — contrôle propriétaire</h3><div class="loading-state">Chargement des images…</div>`;

  try {
    const ctx = await adminListProductImages(id);
    const rows = ctx.rows || [];
    const max = Number(ctx.max_images || 5);
    const remaining = Math.max(0, max - rows.length);
    const product = ctx.product || {};

    card.innerHTML = `
      <div class="toolbar">
        <div><h3 style="margin:0">Images produit — contrôle propriétaire</h3><p style="margin:4px 0 0;color:#52525b">${rows.length} / ${max} image(s). Ajout et retrait Admin audités ; aucune modification financière ou logistique.</p></div>
        <span class="badge" style="color:#3f3f46;background:#f4f4f5">${esc(String(ctx.environment || "").toUpperCase())}</span>
      </div>
      ${rows.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px">${rows.map((row) => imageCard(row, product.name)).join("")}</div>` : `<div class="empty-state" style="margin-top:14px">Aucune image enregistrée pour ce produit.</div>`}
      <div class="settings-section" style="display:block;margin-top:14px">
        <div><strong>Ajouter des images</strong><p style="color:#52525b">JPG, PNG, WebP ou GIF · 10 Mo maximum par fichier · ${remaining} emplacement(s) disponible(s).</p></div>
        <div style="display:grid;gap:10px;margin-top:10px">
          <input class="input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple data-admin-product-image-files ${remaining ? "" : "disabled"} aria-label="Images à ajouter">
          <input class="input" type="text" maxlength="240" value="${esc(product.name || "")}" data-admin-product-image-alt placeholder="Texte alternatif" ${remaining ? "" : "disabled"} aria-label="Texte alternatif des images">
          <div><button class="btn btn-outline-blue btn-sm" type="button" data-admin-upload-product-images ${remaining ? "" : "disabled"}>Ajouter les images…</button></div>
        </div>
      </div>`;

    card.querySelector("[data-admin-upload-product-images]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const files = Array.from(card.querySelector("[data-admin-product-image-files]")?.files || []);
      if (!files.length) return showToast("Choisissez au moins une image.", "red");
      if (files.length > remaining) return showToast(`Maximum ${remaining} image(s) supplémentaire(s) pour ce produit.`, "red");

      const ok = await confirmAction({
        title: `Ajouter ${files.length} image(s) à « ${product.name || "ce produit"} » ?`,
        message: "Les fichiers seront placés dans le bucket produit existant puis enregistrés par le backend Admin.",
        consequences: ["Maximum 5 images par produit.", "L’action sera journalisée avec votre compte Admin.", "Aucun statut de validation du produit n’est modifié."],
        requireReason: true,
        minReason: 5,
        reasonLabel: "Motif interne de l’ajout",
        confirmLabel: "Ajouter",
      });
      if (!ok) return;

      button.disabled = true;
      const alt = String(card.querySelector("[data-admin-product-image-alt]")?.value || product.name || "").trim();
      let added = 0;
      try {
        for (let i = 0; i < files.length; i += 1) {
          await adminUploadProductImage({
            productId: product.id,
            merchantId: product.merchant_id,
            file: files[i],
            altText: alt,
            position: rows.length + i,
            isPrimary: rows.length === 0 && i === 0,
            reason: ok.reason,
          });
          added += 1;
        }
        showToast(`${added} image(s) ajoutée(s) par l’Admin ✓`);
        await renderCardFresh(host);
      } catch (err) {
        showToast(`${added ? `${added} image(s) ajoutée(s). ` : ""}${adminProductImageErrorFr(err, "Ajout d’image refusé.")}`, "red");
        await renderCardFresh(host);
      } finally {
        button.disabled = false;
      }
    });

    card.querySelectorAll("[data-admin-delete-product-image]").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = rows.find((x) => x.id === button.dataset.adminDeleteProductImage);
        if (!row) return;
        const ok = await confirmAction({
          title: "Retirer cette image du produit ?",
          message: row.is_primary ? "Cette image est principale. La prochaine image disponible deviendra automatiquement principale." : "L’image ne sera plus associée au produit.",
          consequences: ["La ligne métier est supprimée côté serveur.", "Le fichier Storage est ensuite nettoyé par l’Admin.", "L’action est auditée."],
          requireReason: true,
          minReason: 5,
          reasonLabel: "Motif interne du retrait",
          confirmLabel: "Retirer",
          danger: true,
        });
        if (!ok) return;
        button.disabled = true;
        try {
          const result = await adminDeleteProductImage(row.id, ok.reason);
          if (result.cleanupError) showToast("Image retirée du produit, mais le nettoyage du fichier Storage devra être revérifié.", "red");
          else showToast("Image retirée par l’Admin ✓");
          await renderCardFresh(host);
        } catch (err) {
          showToast(adminProductImageErrorFr(err, "Retrait de l’image refusé."), "red");
          button.disabled = false;
        }
      });
    });

    refreshIcons();
  } catch (err) {
    card.innerHTML = `<h3 style="margin-top:0">Images produit — contrôle propriétaire</h3><div class="error-state">${esc(adminProductImageErrorFr(err, "Gestion des images indisponible."))}</div>`;
  } finally {
    rendering = false;
  }
}

async function renderCardFresh(host) {
  const old = host.querySelector("#adminProductImagesOwnership");
  if (old) old.remove();
  rendering = false;
  await renderCard(host);
}

function scan() {
  if (!isProductDetail()) return;
  const host = document.querySelector("#adminProductDetailHost");
  if (host && !host.querySelector("#adminProductImagesOwnership")) renderCard(host);
}

export function initAdminProductImagesOwnership() {
  if (!isProductDetail()) return;
  scan();
  if (observer) return;
  const root = document.querySelector("#adminProductDetailHost") || document.documentElement;
  observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAdminProductImagesOwnership, { once: true });
else initAdminProductImagesOwnership();
