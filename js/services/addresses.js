// Carnet d'adresses — stockage LOCAL au navigateur uniquement (aucune table
// Supabase, aucune API serveur inventée). Voir addresses.html : « Adresses
// enregistrées sur cet appareil ».
//
// Forme structurée (voir js/services/addressContract.js) :
//   { id, label, fullName, phone, address_line1, address_line2, commune,
//     department, landmark, notes, isDefault }
// Les anciennes entrées ({ address, city }) sont migrées à la volée en
// lecture — jamais recréées, jamais perdues.
import { normalizeAddressInput, validateStandardAddress, isManagedPointInput } from "./addressContract.js";

const KEY = "vinht-saved-addresses-v1";

function migrateEntry(x) {
  if (!x || typeof x !== "object") return x;
  const a = normalizeAddressInput(x);
  return {
    id: x.id,
    label: String(x.label || "Adresse").trim() || "Adresse",
    fullName: String(x.fullName || "").trim(),
    phone: a.phone || String(x.phone || "").trim(),
    address_line1: a.address_line1,
    address_line2: a.address_line2,
    commune: a.commune,
    department: a.department,
    landmark: a.landmark,
    notes: String(x.notes || "").trim(),
    isDefault: !!x.isDefault,
    // Compat legacy : certaines pages (checkout prefill) lisent encore
    // .address / .city — dérivés, jamais une source de vérité séparée.
    address: a.address_line1,
    city: a.commune,
  };
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const rows = raw.map(migrateEntry).filter((x) => x && typeof x === "object");
    // Migration locale silencieuse : après la première lecture réussie, les
    // anciennes clés sont réellement remplacées par la forme structurée
    // (les alias address/city restent seulement pour compatibilité aval).
    if (JSON.stringify(raw) !== JSON.stringify(rows)) write(rows);
    return rows;
  } catch {
    return [];
  }
}
function write(v) {
  localStorage.setItem(KEY, JSON.stringify(v.slice(0, 8)));
}
function uid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function getAddresses() {
  return read();
}
export function getDefaultAddress() {
  const rows = read();
  return rows.find((x) => x.isDefault) || rows[0] || null;
}

export function saveAddress(input = {}) {
  if (isManagedPointInput(input)) throw new Error("managed-point-not-supported-in-address-book");
  const validation = validateStandardAddress(input);
  if (!validation.valid) {
    if (validation.errors.address_line1) throw new Error("address-required");
    if (validation.errors.commune) throw new Error("commune-required");
    if (validation.errors.department) throw new Error("department-required");
    if (validation.errors.coordinates) throw new Error("coordinates-invalid");
    throw new Error("invalid-address");
  }

  const items = read();
  const id = input.id || uid();
  const a = normalizeAddressInput(input);
  const next = {
    id,
    label: String(input.label || "Adresse").trim() || "Adresse",
    fullName: String(input.fullName || "").trim(),
    phone: a.phone || String(input.phone || "").trim(),
    address_line1: a.address_line1,
    address_line2: a.address_line2,
    commune: a.commune,
    department: a.department,
    landmark: a.landmark,
    notes: String(input.notes || "").trim(),
    isDefault: !!input.isDefault,
    address: a.address_line1,
    city: a.commune,
  };
  let out = items.filter((x) => x.id !== id);
  if (next.isDefault) out = out.map((x) => ({ ...x, isDefault: false }));
  out.unshift(next);
  write(out);
  return next;
}
export function removeAddress(id) {
  write(read().filter((x) => x.id !== id));
}
export function setDefaultAddress(id) {
  write(read().map((x) => ({ ...x, isDefault: x.id === id })));
}
export function clearAddresses() {
  localStorage.removeItem(KEY);
}
