// Fondation frontend commune Adresse / Géographie (Frontend Bloc 3).
//
// Forme canonique standard (nouveaux payloads) :
//   { type: "address", address_line1, address_line2?, commune, department,
//     landmark?, phone?, label?, instructions?, latitude?, longitude? }
// address_line1 + commune + department sont la base minimale d'une adresse
// standard exploitable. latitude/longitude restent TOUJOURS optionnels.
//
// Point VinHT / point géré (jamais transformé en texte libre) :
//   { type: "pickup_point", pickup_point_id }
//   { type: "managed_point", secure_delivery_point_id }
//
// Ce module ne contient QUE de la logique de forme / présentation :
// normalisation, validation de structure, libellé d'affichage. Il ne décide
// JAMAIS d'une éligibilité livreur, d'une compatibilité de zone, d'une
// publication de mission ou d'un dispatch — ces décisions restent au backend
// (voir js/services/merchantDispatch.js, deliveryContract.js, courierPortal.js).
//
// Compatibilité legacy : le frontend doit savoir LIRE d'anciennes clés
// (city, departement, delivery_zone) si présentes, mais les NOUVEAUX
// payloads doivent utiliser commune/department/address_line1. Toute la
// conversion legacy est centralisée ici — jamais dupliquée page par page.

// Les 10 départements d'Haïti : fait géographique stable et public, utilisé
// UNIQUEMENT comme repli d'affichage (<select>/<datalist>) quand aucune
// source backend n'est disponible (voir js/services/geoHints.js, qui reste
// la source à privilégier — zones de service réellement actives). Ce n'est
// PAS un référentiel autoritaire de communes : aucune liste de communes
// n'est fournie ici, une liste "complète" serait nécessairement fausse ou
// incomplète et ne doit jamais être inventée côté frontend.
export const HAITI_DEPARTMENTS_FALLBACK = [
  "Artibonite", "Centre", "Grand'Anse", "Nippes", "Nord",
  "Nord-Est", "Nord-Ouest", "Ouest", "Sud", "Sud-Est",
];

const nonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const clean = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ---------------------------------------------------------------------------
// Type de localisation
// ---------------------------------------------------------------------------

// Un point géré est identifié par ID — jamais par texte libre. On ne
// mélange jamais une adresse standard et un point VinHT / point sécurisé.
export function isManagedPointInput(input) {
  if (!input || typeof input !== "object") return false;
  if (input.type === "pickup_point" || input.type === "managed_point" || input.type === "secure_delivery_point") return true;
  return nonEmpty(input.pickup_point_id) || nonEmpty(input.secure_delivery_point_id);
}

export function managedPointPayload(input) {
  if (!input || typeof input !== "object") return null;
  const type = clean(input.type);
  const pickupId = clean(input.pickup_point_id);
  const secureId = clean(input.secure_delivery_point_id);

  // Un point canonique porte exactement un identifiant. Un type déclaré
  // doit aussi correspondre à cet identifiant : on ne "répare" jamais une
  // structure ambiguë en choisissant arbitrairement un des deux IDs.
  if ((pickupId && secureId) || (!pickupId && !secureId)) return null;
  if (pickupId && type && type !== "pickup_point") return null;
  if (secureId && type && type !== "managed_point" && type !== "secure_delivery_point") return null;

  if (pickupId) return { type: "pickup_point", pickup_point_id: pickupId };
  return { type: "managed_point", secure_delivery_point_id: secureId };
}

// ---------------------------------------------------------------------------
// Normalisation (legacy -> canonique)
// ---------------------------------------------------------------------------

// Lit les anciennes clés (city, departement, delivery_zone, address) sans
// jamais les écrire dans un nouveau payload. Tolérant : ne lève jamais.
export function normalizeAddressInput(raw) {
  if (!raw || typeof raw !== "object") {
    return { address_line1: "", address_line2: "", commune: "", department: "", landmark: "", phone: "", label: "", instructions: "", latitude: null, longitude: null };
  }
  const address_line1 = clean(raw.address_line1 ?? raw.address ?? raw.street ?? raw.address_line ?? "");
  const address_line2 = clean(raw.address_line2 ?? "");
  // legacy commune : city (checkout historique) ; delivery_zone en tout
  // dernier recours (ancienne saisie libre parfois utilisée comme commune).
  const commune = clean(raw.commune ?? raw.city ?? raw.town ?? raw.delivery_zone ?? "");
  // legacy department : departement (orthographe FR sans accent utilisée
  // par d'anciens formulaires / imports).
  const department = clean(raw.department ?? raw.departement ?? "");
  const landmark = clean(raw.landmark ?? raw.repere ?? "");
  const phone = clean(raw.phone ?? "");
  const label = clean(raw.label ?? "");
  const instructions = clean(raw.instructions ?? raw.delivery_notes ?? raw.notes ?? "");
  const latitude = raw.latitude === undefined || raw.latitude === null || raw.latitude === "" ? null : Number(raw.latitude);
  const longitude = raw.longitude === undefined || raw.longitude === null || raw.longitude === "" ? null : Number(raw.longitude);

  return {
    address_line1, address_line2, commune, department, landmark, phone, label, instructions,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

// ---------------------------------------------------------------------------
// Coordonnées
// ---------------------------------------------------------------------------

export function coordinatesAreValid(latitude, longitude) {
  if (latitude === null || latitude === undefined || latitude === "") {
    // Les deux doivent être absentes ensemble, ou toutes les deux valides —
    // jamais une seule (même règle que le backend, voir courierPortal.js /
    // merchantDispatch.js "coordinates_incomplete").
    return longitude === null || longitude === undefined || longitude === "";
  }
  if (longitude === null || longitude === undefined || longitude === "") return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ---------------------------------------------------------------------------
// Validation (messages UX en français, jamais une erreur technique/JSON)
// ---------------------------------------------------------------------------

// → { valid, errors: { address_line1?, commune?, department?, coordinates? } }
export function validateStandardAddress(input, { requireCoordinates = false } = {}) {
  if (isManagedPointInput(input)) {
    // Un point géré n'est pas évalué comme une adresse standard, mais il doit
    // quand même porter UN identifiant canonique cohérent avec son type.
    const managed = managedPointPayload(input);
    return managed
      ? { valid: true, errors: {} }
      : { valid: false, errors: { managed_point: "Le point VinHT sélectionné est invalide." } };
  }

  const a = normalizeAddressInput(input);
  const errors = {};
  if (!nonEmpty(a.address_line1) || a.address_line1.replace(/\s+/g, "").length < 3) {
    errors.address_line1 = "Indique l'adresse ou la rue.";
  }
  if (!nonEmpty(a.commune)) {
    errors.commune = "Choisis ou indique une commune.";
  }
  if (!nonEmpty(a.department)) {
    errors.department = "Indique le département.";
  }

  // Vérifier les valeurs BRUTES : normalizeAddressInput convertit
  // volontairement une valeur non numérique en null pour la présentation.
  // Utiliser la valeur normalisée ici ferait passer "abc" comme "absent".
  const rawLat = input?.latitude;
  const rawLng = input?.longitude;
  const hasLat = nonEmpty(rawLat);
  const hasLng = nonEmpty(rawLng);
  if (requireCoordinates && (!hasLat || !hasLng)) {
    errors.coordinates = "Les coordonnées GPS sont requises.";
  } else if ((hasLat || hasLng) && !coordinatesAreValid(rawLat, rawLng)) {
    errors.coordinates = "Les coordonnées GPS ne sont pas valides.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function isStandardAddressComplete(input) {
  return validateStandardAddress(input).valid;
}

// ---------------------------------------------------------------------------
// Payload canonique (jamais de concaténation quand la structure existe)
// ---------------------------------------------------------------------------

// Construit le payload structuré à envoyer au backend. Ne renvoie jamais une
// simple chaîne concaténée — seulement les champs structurés présents.
export function canonicalAddressPayload(input) {
  if (isManagedPointInput(input)) return managedPointPayload(input);
  const a = normalizeAddressInput(input);
  const out = { type: "address", address_line1: a.address_line1, commune: a.commune, department: a.department };
  if (nonEmpty(a.address_line2)) out.address_line2 = a.address_line2;
  if (nonEmpty(a.landmark)) out.landmark = a.landmark;
  if (nonEmpty(a.phone)) out.phone = a.phone;
  if (nonEmpty(a.label)) out.label = a.label;
  if (nonEmpty(a.instructions)) out.instructions = a.instructions;
  if (coordinatesAreValid(a.latitude, a.longitude) && nonEmpty(a.latitude)) {
    out.latitude = Number(a.latitude);
    out.longitude = Number(a.longitude);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Libellé d'affichage
// ---------------------------------------------------------------------------

// N'affiche que les champs réellement présents, jamais de JSON brut, jamais
// de champ fabriqué. Dédupe address/address_line1 quand ils portent la même
// valeur (repris du comportement existant dans courierPortal.js).
// Ex.: "12 Rue Capois — Port-au-Prince, Ouest"
export function addressLabel(input, { fallback = "—" } = {}) {
  if (!input || typeof input !== "object") return fallback;
  if (isManagedPointInput(input)) {
    // Un point géré s'affiche à partir des données résolues fournies par le
    // backend. On conserve son identité (nom) ET son adresse structurée si
    // elle est disponible, sans jamais fabriquer de texte ou d'adresse.
    if (!managedPointPayload(input)) return fallback;
    const name = clean(input.name || input.partner_name || input.label || "");
    const street = [clean(input.address_line1 ?? input.address ?? ""), clean(input.address_line2 ?? "")]
      .filter(nonEmpty).join(", ");
    const place = [
      clean(input.commune ?? input.city ?? input.delivery_zone ?? ""),
      clean(input.department ?? input.departement ?? ""),
    ].filter(nonEmpty).join(", ");
    const location = [street, place].filter(nonEmpty).join(" — ");
    const parts = [name, location].filter(nonEmpty);
    return parts.length ? parts.join(" — ") : fallback;
  }
  const a = normalizeAddressInput(input);
  const streetCandidates = [a.address_line1, a.address_line2].filter(nonEmpty);
  const seen = new Set();
  const street = streetCandidates.filter((v) => (seen.has(v) ? false : (seen.add(v), true))).join(", ");
  const place = [a.commune, a.department].filter(nonEmpty).join(", ");
  const parts = [street, place].filter(nonEmpty);
  if (!parts.length) return fallback;
  return parts.join(" — ");
}

// Ligne courte "commune, département" seule (listes, résumés compacts).
export function placeLabel(input, { fallback = "" } = {}) {
  if (!input || typeof input !== "object") return fallback;
  const a = normalizeAddressInput(input);
  const place = [a.commune, a.department].filter(nonEmpty).join(", ");
  return place || fallback;
}
