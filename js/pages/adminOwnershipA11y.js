// Additive accessibility hardening for Admin Ownership surfaces.
// No business logic or handlers are changed: this module only names
// dynamically-rendered filter controls for assistive technologies.

const page = () => document.body?.dataset?.adminPage || "";

const FILTER_LABELS = [
  ["[data-f-status]", "Filtrer les livreurs par statut"],
  ["[data-a-status]", "Filtrer les Agents par statut"],
  ["[data-app-status]", "Filtrer les candidatures Agent par statut"],
  ["[data-d-status]", "Filtrer les dossiers marchands accompagnés par statut"],
];

function applyAccessibleNames() {
  if (page() !== "control-center") return;
  for (const [selector, label] of FILTER_LABELS) {
    document.querySelectorAll(selector).forEach((el) => {
      if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) {
        el.setAttribute("aria-label", label);
      }
    });
  }
}

export function initAdminOwnershipA11y() {
  if (page() !== "control-center") return;
  applyAccessibleNames();
  const observer = new MutationObserver(() => queueMicrotask(applyAccessibleNames));
  observer.observe(document.body, { childList: true, subtree: true });
}
