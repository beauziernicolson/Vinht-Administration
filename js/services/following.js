import { getSession } from "./auth.js";
import { listMyNotificationSubscriptions, setMyMerchantNotificationFollow } from "./notifications.js";

const KEY="vinht-followed-merchants-v1";
function clean(v){return [...new Set((Array.isArray(v)?v:[]).filter(x=>typeof x==="string"&&x.length>10))].slice(0,200)}

// --- Fallback local (visiteur anonyme uniquement) ---------------------------
// Un follow local ne reçoit jamais de notification serveur : il ne sert
// qu'à retrouver visuellement une boutique sur cet appareil tant que
// l'utilisateur n'est pas connecté.
export function getFollowedMerchantIds(){try{return clean(JSON.parse(localStorage.getItem(KEY)||"[]"))}catch{return[]}}
export function isMerchantFollowed(id){return !!id&&getFollowedMerchantIds().includes(id)}
export function followMerchant(id){if(!id)return getFollowedMerchantIds();const next=clean([...getFollowedMerchantIds(),id]);localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new CustomEvent("vinht:following",{detail:next}));return next}
export function unfollowMerchant(id){const next=getFollowedMerchantIds().filter(x=>x!==id);localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new CustomEvent("vinht:following",{detail:next}));return next}
export function toggleMerchantFollow(id){return isMerchantFollowed(id)?(unfollowMerchant(id),false):(followMerchant(id),true)}
export function clearFollowedMerchants(){localStorage.removeItem(KEY);window.dispatchEvent(new CustomEvent("vinht:following",{detail:[]}))}

// --- Vérité serveur (utilisateur authentifié) --------------------------------
// Pour un compte connecté, le localStorage n'est plus la source de vérité
// sur l'abonnement notifications : set_my_merchant_notification_follow_v1 /
// list_my_notification_subscriptions_v1 font foi.

export async function isAuthenticated() {
  try { return !!(await getSession())?.user; } catch { return false; }
}

export async function getFollowedMerchantIdsAuthoritative() {
  const rows = await listMyNotificationSubscriptions();
  return rows.filter((r) => r.topic_type === "merchant" && r.enabled === true).map((r) => r.topic_key);
}

export async function isMerchantFollowedRemote(merchantId) {
  if (!merchantId) return false;
  const rows = await listMyNotificationSubscriptions();
  const row = rows.find((r) => r.topic_type === "merchant" && r.topic_key === merchantId);
  return !!row?.enabled;
}

export async function setMerchantFollowRemote(merchantId, enabled) {
  return setMyMerchantNotificationFollow(merchantId, enabled);
}
