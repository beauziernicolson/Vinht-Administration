import { getAdminMerchant } from "../services/admin.js?v=20260922-mega-a-v1";
import { adminUpdateMerchantOperationalProfile } from "../services/adminMerchantOwnership.js";
import { formModal, confirmAction, adminErrorFr, esc } from "../ui/adminUi.js";
import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";

const page = () => document.body?.dataset?.adminPage || "";
const clean = (v) => String(v ?? "").trim();

function addressFromMerchant(m) {
  return {
    address_line1: clean(m.business_address_line1),
    address_line2: clean(m.business_address_line2),
    commune: clean(m.business_commune),
    department: clean(m.business_department),
    landmark: clean(m.business_landmark),
  };
}

function addressChanged(before, values) {
  return before.address_line1 !== clean(values.line1)
    || before.address_line2 !== clean(values.line2)
    || before.commune !== clean(values.commune)
    || before.department !== clean(values.department)
    || before.landmark !== clean(values.landmark);
}

function addressLabel(m) {
  return [m.business_address_line1, m.business_address_line2, m.business_commune, m.business_department]
    .filter(Boolean).join(", ") || "Adresse business non configurée";
}

async function editMerchant(m) {
  const beforeAddress = addressFromMerchant(m);
  const f = await formModal({
    title: "Modifier le profil opérationnel — Admin",
    confirmLabel: "Continuer",
    intro: "Ces champs sont ceux que le marchand peut gérer lui-même. Aucun statut, plan, KYC, solde ou paramètre financier n’est modifié ici.",
    fields: [
      { name: "shop", label: "Nom de la boutique", value: m.shop_name || "", required: true },
      { name: "whatsapp", label: "WhatsApp", value: m.whatsapp_number || "" },
      { name: "description", label: "Description", type: "textarea", value: m.description || "" },
      { name: "line1", label: "Adresse business", value: beforeAddress.address_line1, required: !!m.business_address_ready },
      { name: "line2", label: "Complément d’adresse", value: beforeAddress.address_line2 },
      { name: "commune", label: "Commune", value: beforeAddress.commune, required: !!m.business_address_ready },
      { name: "department", label: "Département", value: beforeAddress.department, required: !!m.business_address_ready },
      { name: "landmark", label: "Point de repère", value: beforeAddress.landmark },
    ],
  });
  if (!f) return;

  const changedAddress = addressChanged(beforeAddress, f.values);
  let businessAddress = null;
  if (changedAddress) {
    if (!clean(f.values.line1) || !clean(f.values.commune) || !clean(f.values.department)) {
      showToast("Adresse, commune et département sont requis pour modifier l’adresse business.", "red");
      return;
    }
    businessAddress = {
      type: "address",
      address_line1: clean(f.values.line1),
      address_line2: clean(f.values.line2) || null,
      commune: clean(f.values.commune),
      department: clean(f.values.department),
      landmark: clean(f.values.landmark) || null,
      country_code: "HT",
    };
  }

  const ok = await confirmAction({
    title: `Modifier « ${m.shop_name || "ce marchand"} » ?`,
    env: m.environment,
    requireReason: true,
    minReason: 5,
    reasonLabel: "Motif interne de la correction",
    confirmLabel: "Enregistrer",
    consequences: [
      "L’action sera journalisée comme modification Admin.",
      changedAddress ? "La zone de livraison sera recalculée depuis la commune canonique." : "L’adresse business existante restera inchangée.",
      "Le plan, le statut, le KYC, la confiance et les données financières restent inchangés.",
    ],
  });
  if (!ok) return;

  try {
    await adminUpdateMerchantOperationalProfile({
      merchantId: m.id,
      shopName: f.values.shop,
      description: f.values.description,
      whatsappNumber: f.values.whatsapp,
      businessAddress,
      reason: ok.reason,
    });
    showToast("Profil marchand corrigé par l’Admin ✓");
    location.reload();
  } catch (e) {
    showToast(adminErrorFr(e, "Modification du profil marchand refusée."), "red");
  }
}

async function enhance() {
  if (page() !== "merchant-detail") return false;
  const host = document.querySelector("#adminMerchantDetailHost");
  if (!host || host.dataset.merchantOwnershipReady === "1" || !host.querySelector(".portal-card")) return false;
  const id = new URL(location.href).searchParams.get("id") || "";
  if (!id) return false;

  let m;
  try { m = await getAdminMerchant(id); }
  catch { return false; }
  if (!m) return false;

  host.dataset.merchantOwnershipReady = "1";
  const card = document.createElement("div");
  card.className = "portal-card";
  card.id = "adminMerchantOwnershipCard";
  card.innerHTML = `
    <div class="toolbar">
      <div><h3 style="margin:0">Contrôle propriétaire — boutique</h3><p class="muted" style="margin:3px 0 0">Correction auditée des informations opérationnelles du marchand.</p></div>
      <button class="btn btn-outline-blue btn-sm" type="button" data-edit-merchant-owner>Modifier…</button>
    </div>
    <div class="settings-section"><div><strong>WhatsApp</strong><p>${esc(m.whatsapp_number || "—")}</p></div></div>
    <div class="settings-section"><div><strong>Adresse business canonique</strong><p>${esc(addressLabel(m))}</p></div></div>
    <div class="settings-section"><div><strong>Zone de livraison dérivée</strong><p>${esc(m.delivery_zone || "—")}</p></div><span class="badge">${m.business_address_ready ? "Adresse prête" : "À compléter"}</span></div>`;
  host.append(card);
  card.querySelector("[data-edit-merchant-owner]")?.addEventListener("click", () => editMerchant(m));
  refreshIcons();
  return true;
}

export function initAdminMerchantOwnership() {
  if (page() !== "merchant-detail") return;
  enhance();
  const observer = new MutationObserver(async () => {
    if (await enhance()) observer.disconnect();
  });
  const host = document.querySelector("#adminMerchantDetailHost");
  if (host) observer.observe(host, { childList: true, subtree: true });
}
