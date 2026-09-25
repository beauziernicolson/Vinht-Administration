// Suggestions de département / commune pour les formulaires d'adresse.
//
// Source : zones de service réellement actives (list_delivery_service_zones_v1).
// Ce sont des SUGGESTIONS (<datalist>), jamais une liste fermée : le backend
// valide l'adresse et compare communes/départements sans tenir compte des
// accents ; proposer les libellés canoniques évite simplement qu'un livreur
// ou un client saisisse « Petion-Ville » là où la zone est « Pétion-Ville ».

import { getSupabase } from "./supabase.js";

let _cache = null;
let _inflight = null;

export async function getGeoHints() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const empty = { departments: [], communes: [], enabled: false };
    try {
      const sb = getSupabase();
      if (!sb) return (_cache = empty);
      const { data, error } = await sb.rpc("list_delivery_service_zones_v1", { p_for: "home" });
      if (error || !data || typeof data !== "object") return (_cache = empty);
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const uniq = (k) => [...new Set(rows.map((r) => String(r?.[k] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
      return (_cache = { departments: uniq("department"), communes: uniq("commune"), enabled: data.enabled === true });
    } catch {
      return (_cache = empty);
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// Attache des <datalist> aux champs marqués data-geo="department" | "commune"
// à l'intérieur de `root`. Sans zone active, ne fait rien (saisie libre).
export async function attachGeoHints(root) {
  if (!root) return;
  const inputs = root.querySelectorAll?.("[data-geo]");
  if (!inputs || !inputs.length) return;
  const hints = await getGeoHints();
  const lists = { department: hints.departments, commune: hints.communes };
  if (!lists.department.length && !lists.commune.length) return;
  for (const kind of ["department", "commune"]) {
    if (!lists[kind].length) continue;
    const id = `geoHints_${kind}`;
    let dl = document.getElementById(id);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = id;
      document.body.appendChild(dl);
    }
    dl.innerHTML = lists[kind].map((v) => `<option value="${String(v).replace(/"/g, "&quot;")}"></option>`).join("");
    root.querySelectorAll(`[data-geo="${kind}"]`).forEach((el) => el.setAttribute("list", id));
  }
}
