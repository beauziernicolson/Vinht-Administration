// Session analytique anonyme partagée pour l'attribution Sponsored Products.
// Une même clé brute doit relier impression -> clic -> commande.

import { getSupabase } from "./supabase.js";

const STORAGE_KEY = "vinht_analytics_session_key";
const PENDING_ORDER_LINK_KEY = "vinht_pending_order_analytics_link";
let volatileSessionKey = null;

function randomUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getAnalyticsSessionKey() {
  try {
    let key = sessionStorage.getItem(STORAGE_KEY);
    if (!key) {
      key = randomUuid();
      sessionStorage.setItem(STORAGE_KEY, key);
    }
    return key;
  } catch {
    if (!volatileSessionKey) volatileSessionKey = randomUuid();
    return volatileSessionKey;
  }
}

export async function getAnalyticsSessionHash() {
  const raw = getAnalyticsSessionKey();
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createClientEventId() {
  return randomUuid();
}

function rememberPendingOrderLink(orderId, sessionKey) {
  try {
    localStorage.setItem(PENDING_ORDER_LINK_KEY, JSON.stringify({ orderId, sessionKey, createdAt: Date.now() }));
  } catch {}
}

function clearPendingOrderLink(orderId) {
  try {
    const raw = localStorage.getItem(PENDING_ORDER_LINK_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (!orderId || pending?.orderId === orderId) localStorage.removeItem(PENDING_ORDER_LINK_KEY);
  } catch {}
}

async function performOrderAnalyticsLink(orderId, sessionKey) {
  const sb = getSupabase();
  if (!sb || !orderId || !sessionKey) return false;
  const { error } = await sb.rpc("link_my_order_analytics_session_v1", {
    p_order_id: orderId,
    p_session_key: sessionKey,
  });
  if (error) throw error;
  return true;
}

// Fail-open : la commande est déjà créée. On mémorise l'intention AVANT le
// premier await, de sorte qu'une redirection paiement puisse interrompre le RPC
// sans perdre l'attribution : le prochain boot VinHT réessaiera.
export async function linkOrderAnalyticsSession(orderId) {
  if (!orderId) return false;
  const sessionKey = getAnalyticsSessionKey();
  rememberPendingOrderLink(orderId, sessionKey);
  try {
    const linked = await performOrderAnalyticsLink(orderId, sessionKey);
    if (linked) clearPendingOrderLink(orderId);
    return linked;
  } catch (err) {
    console.warn("[VinHT] lien session analytics commande:", err && err.message);
    return false;
  }
}

// Relance sûre après retour de paiement/navigation. Aucun échec ici ne doit
// bloquer le boot, le checkout ou l'affichage d'une commande déjà créée.
export async function flushPendingOrderAnalyticsLink() {
  let pending = null;
  try {
    const raw = localStorage.getItem(PENDING_ORDER_LINK_KEY);
    if (!raw) return false;
    pending = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!pending?.orderId || !pending?.sessionKey) {
    clearPendingOrderLink();
    return false;
  }
  if (pending.createdAt && Date.now() - Number(pending.createdAt) > 7 * 24 * 60 * 60 * 1000) {
    clearPendingOrderLink(pending.orderId);
    return false;
  }
  try {
    const linked = await performOrderAnalyticsLink(pending.orderId, pending.sessionKey);
    if (linked) clearPendingOrderLink(pending.orderId);
    return linked;
  } catch (err) {
    console.warn("[VinHT] reprise lien analytics commande:", err && err.message);
    return false;
  }
}
