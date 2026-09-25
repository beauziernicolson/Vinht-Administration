import { getUiPreferences } from "./preferences.js";
const KEY = "vinht-recent-products-v1";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; }
  catch { return []; }
}
function write(items) { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 40))); }

export function trackRecentlyViewed(productId) {
  if (!productId || !getUiPreferences().recentTracking) return;
  const items = read().filter((x) => x?.productId !== productId);
  items.unshift({ productId, viewedAt: new Date().toISOString() });
  write(items);
}
export function getRecentlyViewed() { return read(); }
export function getRecentlyViewedIds() { return read().map((x) => x.productId).filter(Boolean); }
export function clearRecentlyViewed() { localStorage.removeItem(KEY); }
