// Frontière unique entre le catalogue transactionnel et les fixtures visuelles.
// Seul un UUID Supabase peut représenter un produit achetable.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getProductType(id) {
  return UUID_RE.test(String(id || "")) ? "live" : "demo";
}

export function isLiveProductId(id) {
  return getProductType(id) === "live";
}

export function isDemoProduct(item) {
  return (item && item.productType) === "demo" || !isLiveProductId(item?.productId || item?.id);
}
