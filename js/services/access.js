// Contexte d'accès multi-rôles — SOURCE PRINCIPALE côté frontend.
//
// Appelle le RPC backend `get_my_access_context_v1()` (créé côté Supabase par
// l'équipe backend). Le frontend NE recalcule PAS les règles : il consomme
// `capabilities`, `surfaces`, `merchant_access` tels que renvoyés.
//
// Rôles de sécurité cumulables : client / merchant / courier / admin.
// `producteur` / `revendeur` / `vendeur` NE sont PAS des rôles : c'est
// `merchant.merchant_type` (libellé fourni par le backend).

import { getSupabase } from "./supabase.js";
import { getSession, onAuthChange } from "./auth.js";

const EMPTY_CAPS = Object.freeze({
  can_shop: false,
  can_open_merchant_center: false,
  can_sell: false,
  can_deliver: false,
  can_agent: false,
  can_admin: false,
});

const NO_AGENT_ACCESS = Object.freeze({ state: "not_agent", message_fr: "", has_profile: false, can_operate: false, can_apply: false });
const NO_COURIER_ACCESS = Object.freeze({ state: "not_courier", message_fr: "", has_profile: false, can_apply: false, can_deliver: false });

// Forme retournée quand personne n'est connecté (aucun appel RPC).
const LOGGED_OUT = Object.freeze({
  authenticated: false,
  version: 1,
  user_id: null,
  roles: [],
  capabilities: EMPTY_CAPS,
  surfaces: [],
  merchant_access: Object.freeze({ state: "logged_out", message_fr: "", can_apply: false, has_merchant: false }),
  merchant: null,
  latest_merchant_application: null,
  agent_access: NO_AGENT_ACCESS,
  agent: null,
  latest_agent_application: null,
  courier_access: NO_COURIER_ACCESS,
  courier: null,
  error: null,
});

// Messages de repli si le backend n'en fournit pas (il en fournit normalement).
const STATE_FALLBACK_FR = {
  active: "Votre espace marchand est actif.",
  paused: "Votre boutique est en pause : la vente est temporairement désactivée.",
  suspended: "Votre boutique est suspendue. Contactez le support VinHT.",
  closed: "Votre boutique est fermée.",
  pending: "Votre espace marchand est en cours d'activation.",
  provisioning_required: "Votre compte marchand est en cours d'activation.",
  application_pending: "Votre demande marchand est en cours d'examen.",
  application_rejected: "Votre demande marchand a été refusée.",
  not_merchant: "Vous n'avez pas encore de compte marchand.",
  unknown: "Informations marchand momentanément indisponibles.",
};

export function merchantStateMessage(access) {
  const state = access?.state || "unknown";
  return (access && String(access.message_fr || "").trim()) || STATE_FALLBACK_FR[state] || STATE_FALLBACK_FR.unknown;
}

// Les états qui autorisent l'ouverture de l'espace marchand (même dégradé).
export function merchantSpaceIsReachable(state) {
  return state === "active" || state === "paused" || state === "suspended";
}

let _cache = null;
let _cacheUserId = null;
let _inflight = null;

// Invalide le cache dès que la session change (login / logout / OAuth / refresh).
onAuthChange(() => {
  _cache = null;
  _cacheUserId = null;
  _inflight = null;
});

export function invalidateAccessContext() {
  _cache = null;
  _cacheUserId = null;
  _inflight = null;
}

function normalize(raw, userId) {
  const caps = (raw && typeof raw.capabilities === "object" && raw.capabilities) || {};
  const ma = (raw && typeof raw.merchant_access === "object" && raw.merchant_access) || {};
  const aa = (raw && typeof raw.agent_access === "object" && raw.agent_access) || {};
  const ca = (raw && typeof raw.courier_access === "object" && raw.courier_access) || {};
  return {
    authenticated: true,
    version: Number(raw && raw.version) || 1,
    user_id: (raw && raw.user_id) || userId || null,
    roles: Array.isArray(raw && raw.roles) ? raw.roles : [],
    capabilities: {
      can_shop: caps.can_shop === true,
      can_open_merchant_center: caps.can_open_merchant_center === true,
      can_sell: caps.can_sell === true,
      can_deliver: caps.can_deliver === true,
      can_agent: caps.can_agent === true,
      can_admin: caps.can_admin === true,
    },
    surfaces: Array.isArray(raw && raw.surfaces) ? raw.surfaces : [],
    merchant_access: {
      state: ma.state || "not_merchant",
      message_fr: ma.message_fr || "",
      can_apply: ma.can_apply === true,
      has_merchant: ma.has_merchant === true,
    },
    merchant: (raw && raw.merchant) || null,
    latest_merchant_application: (raw && raw.latest_merchant_application) || null,
    agent_access: {
      state: aa.state || "not_agent",
      message_fr: aa.message_fr || "",
      has_profile: aa.has_profile === true,
      can_operate: aa.can_operate === true,
      can_apply: aa.can_apply === true,
    },
    agent: (raw && raw.agent) || null,
    latest_agent_application: (raw && raw.latest_agent_application) || null,
    courier_access: {
      state: ca.state || "not_courier",
      message_fr: ca.message_fr || "",
      has_profile: ca.has_profile === true,
      can_apply: ca.can_apply === true,
      can_deliver: ca.can_deliver === true,
    },
    courier: (raw && raw.courier) || null,
    error: null,
  };
}

async function callRpc(sb) {
  const { data, error } = await sb.rpc("get_my_access_context_v1");
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid_access_context");
  return data;
}

// Retourne toujours un objet exploitable (jamais throw). Gère :
//  - non connecté / Supabase absent -> LOGGED_OUT
//  - session expirée / authentication_required -> LOGGED_OUT
//  - erreur réseau -> 1 retry, puis dernier contexte connu (error:"stale") ou
//    coquille authentifiée vide (error:"unavailable")
export async function getMyAccessContext({ force = false } = {}) {
  const sb = getSupabase();
  if (!sb) return { ...LOGGED_OUT, error: "not_configured" };

  let session = null;
  try { session = await getSession(); } catch { /* traité comme déconnecté */ }
  const userId = (session && session.user && session.user.id) || null;

  if (!userId) {
    _cache = null;
    _cacheUserId = null;
    return { ...LOGGED_OUT };
  }

  if (!force && _cache && _cacheUserId === userId) return _cache;
  if (_inflight && _cacheUserId === userId && !force) return _inflight;

  _cacheUserId = userId;
  _inflight = (async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ctx = normalize(await callRpc(sb), userId);
        _cache = ctx;
        return ctx;
      } catch (e) {
        lastErr = e;
        const sig = String((e && (e.message || e.code || e.hint)) || "").toLowerCase();
        if (
          sig.includes("authentication_required") ||
          sig.includes("jwt") ||
          sig.includes("not-authenticated") ||
          e?.code === "PGRST301"
        ) {
          _cache = null;
          return { ...LOGGED_OUT };
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
    }
    console.warn("[VinHT] access context indisponible:", (lastErr && (lastErr.message || lastErr.code)) || lastErr);
    if (_cache && _cacheUserId === userId) return { ..._cache, error: "stale" };
    return {
      ...LOGGED_OUT,
      authenticated: true,
      user_id: userId,
      error: "unavailable",
      merchant_access: { state: "unknown", message_fr: "", can_apply: false, has_merchant: false },
    };
  })();

  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}
