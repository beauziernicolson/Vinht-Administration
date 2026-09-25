const host = document.querySelector("#cpBodyHost");
let scheduled = false;

const STATUS_FR = {
  awaiting_fulfillment: "En attente de préparation",
  ready_waiting_dispatch: "Colis prêt",
  awaiting_assignment: "Mission disponible",
  assigned: "Mission attribuée",
  accepted: "Mission acceptée",
  at_pickup: "Arrivé au point de retrait",
  handoff_pending_merchant: "En attente du vendeur",
  picked_up: "Colis récupéré",
  in_transit: "Livraison en cours",
  arrived_destination: "Arrivé chez le client",
  delivered: "Livrée",
  issue: "Problème signalé",
  cancelled: "Annulée",
};

function translateText(el) {
  const raw = String(el?.textContent || "").trim();
  const key = raw.toLowerCase();
  const translated = STATUS_FR[key];
  if (translated && raw !== translated) el.textContent = translated;
}

function translatePortal() {
  scheduled = false;
  if (!host) return;
  host.querySelectorAll(".badge, .cp-timeline strong").forEach(translateText);
}

function scheduleTranslate() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(translatePortal);
}

export function initCourierStatusFrUx() {
  if (!host) return;
  scheduleTranslate();
  const observer = new MutationObserver(scheduleTranslate);
  observer.observe(host, { childList: true, subtree: true });
}
