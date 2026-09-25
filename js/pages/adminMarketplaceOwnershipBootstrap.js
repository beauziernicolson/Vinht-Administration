// Additive bootstrap for Control Center > Commerce.
// Does not alter the existing tab engine: it injects the Marketplace owner cockpit
// only when the Commerce tab has rendered its canonical #adminSettingsHost.

import { getMyRoles } from "../services/profile.js";
import { adminGetPlatformControlCenter } from "../services/admin.js?v=20260922-mega-a-v1";
import { renderAdminMarketplaceOwnership } from "./adminMarketplaceOwnership.js";

let observer = null;
let scheduled = false;
let adminAllowed = null;

function ensureMarketplaceStyles() {
  if (document.querySelector('link[data-admin-marketplace-ownership-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/css/admin-marketplace-ownership.css?v=20260923a";
  link.dataset.adminMarketplaceOwnershipCss = "1";
  document.head.appendChild(link);
}

async function canRenderAdmin() {
  if (adminAllowed !== null) return adminAllowed;
  const roles = await getMyRoles().catch(() => []);
  adminAllowed = Array.isArray(roles) && roles.includes("admin");
  return adminAllowed;
}

async function mountIfCommerceReady() {
  if (!String(location.pathname || "").includes("/admin/control-center.html")) return;
  if (!(await canRenderAdmin())) return;

  const settingsHost = document.querySelector("#adminControlCenterHost #adminSettingsHost");
  if (!settingsHost) return;
  const settingsCard = settingsHost.closest(".portal-card");
  if (!settingsCard?.parentElement) return;

  let host = document.querySelector("#adminMarketplaceOwnershipHost");
  if (host?.dataset?.rendering === "1" || host?.dataset?.ready === "1") return;
  if (!host) {
    host = document.createElement("div");
    host.id = "adminMarketplaceOwnershipHost";
    settingsCard.insertAdjacentElement("afterend", host);
  }
  host.dataset.rendering = "1";

  try {
    const cc = await adminGetPlatformControlCenter();
    // The tab may have changed while the async read was running.
    if (!document.contains(host) || !document.querySelector("#adminSettingsHost")) return;
    await renderAdminMarketplaceOwnership(host, { env: String(cc?.environment || "").toLowerCase() || null });
    host.dataset.ready = "1";
  } catch (err) {
    if (document.contains(host)) {
      host.innerHTML = `<div class="portal-card"><div class="error-state">Marketplace Admin indisponible. Les autres contrôles Commerce restent opérationnels.</div></div>`;
    }
    console.warn("[VinHT] Admin Marketplace ownership:", err?.message || err);
  } finally {
    if (document.contains(host)) host.dataset.rendering = "0";
  }
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(async () => {
    scheduled = false;
    await mountIfCommerceReady();
  });
}

export function initAdminMarketplaceOwnershipBootstrap() {
  if (!String(location.pathname || "").includes("/admin/control-center.html")) return;
  ensureMarketplaceStyles();
  scheduleMount();
  if (observer) return;
  const root = document.querySelector("#adminControlCenterHost") || document.documentElement;
  observer = new MutationObserver(scheduleMount);
  observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminMarketplaceOwnershipBootstrap, { once: true });
} else {
  initAdminMarketplaceOwnershipBootstrap();
}
