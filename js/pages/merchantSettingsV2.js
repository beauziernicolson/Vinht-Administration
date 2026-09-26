import { getSession, onAuthChange } from "../services/auth.js";
import { getMyMerchantAddressContext, updateMyMerchantProfileV2 } from "../services/merchantSettingsV2.js";
import { showToast } from "../ui/toast.js";

const clean = (v) => String(v ?? "").trim();
let bound = false;
let hydratedUid = null;
let currentAddress = null;

function form() { return document.querySelector("#merchantSettingsForm"); }

function fillAddress(address = {}) {
  const f = form();
  if (!f) return;
  f.address_line1.value = address.address_line1 || "";
  f.address_line2.value = address.address_line2 || "";
  f.commune.value = address.commune || "";
  f.department.value = address.department || "";
  f.landmark.value = address.landmark || "";
  if (f.delivery_zone) f.delivery_zone.value = address.commune || "";
  const note = document.querySelector("#merchantDeliveryZoneNote");
  if (note) note.textContent = address.commune ? `Zone de livraison dérivée : ${address.commune}` : "La zone de livraison sera dérivée de la commune après validation.";
}

async function hydrate() {
  const session = await getSession();
  if (!session?.user || hydratedUid === session.user.id) return;
  hydratedUid = session.user.id;
  try {
    const ctx = await getMyMerchantAddressContext();
    currentAddress = ctx.business_address || null;
    fillAddress(currentAddress || {});
  } catch (e) {
    hydratedUid = null;
    const note = document.querySelector("#merchantDeliveryZoneNote");
    if (note) note.textContent = "Adresse business indisponible pour le moment.";
  }
}

function addressPayload(f) {
  const before = currentAddress || {};
  const next = {
    type: "address",
    address_line1: clean(f.address_line1.value),
    address_line2: clean(f.address_line2.value) || null,
    commune: clean(f.commune.value),
    department: clean(f.department.value),
    landmark: clean(f.landmark.value) || null,
    country_code: "HT",
  };
  const unchanged = clean(before.address_line1) === next.address_line1
    && clean(before.address_line2) === clean(next.address_line2)
    && clean(before.commune) === next.commune
    && clean(before.department) === next.department
    && clean(before.landmark) === clean(next.landmark);
  if (unchanged && before.latitude != null && before.longitude != null) {
    next.latitude = before.latitude;
    next.longitude = before.longitude;
  }
  return next;
}

async function submitV2(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  const f = e.currentTarget;
  const btn = f.querySelector('button[type="submit"]');
  if (btn?.dataset.submitting === "1") return;
  const address = addressPayload(f);
  if (!address.address_line1 || !address.commune || !address.department) {
    showToast("Adresse, commune et département sont obligatoires.", "red");
    return;
  }
  if (btn) { btn.dataset.submitting = "1"; btn.disabled = true; }
  try {
    const result = await updateMyMerchantProfileV2({
      shopName: f.shop_name.value,
      description: f.description.value,
      whatsappNumber: f.whatsapp_number.value,
      businessAddress: address,
    });
    currentAddress = result.business_address || address;
    fillAddress(currentAddress);
    showToast("Boutique et adresse mises à jour ✓");
  } catch (err) {
    const code = String(err?.message || "");
    const map = {
      address_line1_required: "Adresse business requise.",
      address_commune_required: "Commune requise.",
      address_department_required: "Département requis.",
      invalid_haiti_department: "Département haïtien invalide.",
      invalid_haiti_commune: "Commune invalide pour ce département.",
      invalid_address_coordinates: "Coordonnées d’adresse invalides.",
      shop_name_required: "Nom de boutique requis.",
    };
    showToast(map[code] || "Impossible d’enregistrer les paramètres de la boutique.", "red");
  } finally {
    if (btn) { btn.dataset.submitting = ""; btn.disabled = false; }
  }
}

export function initMerchantSettingsV2() {
  if (document.body?.dataset?.merchantPage !== "settings") return;
  const f = form();
  if (!f) return;
  if (!bound) {
    bound = true;
    // Capture=true : ce gestionnaire v2 remplace proprement l'ancien submit v1
    // sans modifier le gros contrôleur merchantPortal historique.
    f.addEventListener("submit", submitV2, true);
    onAuthChange(() => { hydratedUid = null; hydrate(); });
  }
  hydrate();
}
