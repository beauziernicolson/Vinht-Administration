import { adminGetCourier } from "../services/adminControl.js";
import { adminSetCourierAvailability } from "../services/adminCourierOwnership.js";
import { confirmAction, adminErrorFr } from "../ui/adminUi.js";
import { showToast } from "../ui/toast.js";
import { refreshIcons } from "../lib/icons.js";

let observer = null;
let scheduled = false;
const loading = [];

const availabilityLabel = (s) => ({ offline: "Hors ligne", available: "En ligne / Disponible", busy: "Occupé" }[s] || s || "—");
const isControlCenterSurface = () => document.body?.dataset?.adminPage === "control-center" || String(location.pathname || "").includes("/admin/control-center.html");

async function changeAvailability(courier, next, button) {
  const goingOnline = next === "available";
  const ok = await confirmAction({
    title: goingOnline ? `Mettre ${courier.full_name || "ce livreur"} en ligne ?` : `Mettre ${courier.full_name || "ce livreur"} hors ligne ?`,
    message: goingOnline
      ? "Le backend vérifiera que le profil est actif, que les opérations livreur sont ouvertes, que la zone de service est prête et que la capacité n’est pas atteinte."
      : "Cette action retire le livreur des nouvelles missions disponibles. Elle ne falsifie ni n’annule une mission déjà en cours.",
    consequences: goingOnline
      ? ["Le livreur pourra recevoir ou prendre de nouvelles missions selon le mode de dispatch.", "Le statut Occupé reste calculé automatiquement par la charge réelle."]
      : ["Le livreur reste actif administrativement.", "Les missions déjà en cours restent dans leur état réel."],
    requireReason: true,
    minReason: 5,
    reasonLabel: "Motif interne de l’override Admin",
    confirmLabel: goingOnline ? "Mettre en ligne" : "Mettre hors ligne",
    danger: !goingOnline,
  });
  if (!ok) return;
  button.disabled = true;
  try {
    const courierProfileId = courier.courier_profile_id || courier.id;
    if (!courierProfileId) throw new Error("courier_profile_required");
    await adminSetCourierAvailability(courierProfileId, next, ok.reason);
    showToast(goingOnline ? "Livreur mis en ligne ✓" : "Livreur mis hors ligne ✓");
    location.reload();
  } catch (err) {
    showToast(adminErrorFr(err, "Changement de disponibilité refusé par le backend."), "red");
    button.disabled = false;
  }
}

async function enhanceDetail(detail) {
  if (!detail || detail.dataset.adminAvailabilityReady === "1") return;
  const id = detail.dataset.courierDetail;
  if (!id || loading.includes(id)) return;
  loading.push(id);
  try {
    const courier = await adminGetCourier(id);
    if (!courier || !document.contains(detail)) return;
    detail.dataset.adminAvailabilityReady = "1";

    const section = document.createElement("div");
    section.className = "settings-section";
    section.dataset.adminCourierAvailability = "1";
    const status = courier.availability_status;
    const operational = courier.operational_status;
    const canGoOnline = operational === "active" && status === "offline";
    const canGoOffline = status !== "offline";

    section.innerHTML = `
      <div>
        <strong>Disponibilité — contrôle propriétaire</strong>
        <p class="muted" style="margin:4px 0 0">État : <b>${availabilityLabel(status)}</b> · profil : <b>${operational || "—"}</b>. Le statut « Occupé » est calculé par les missions et n’est jamais fabriqué par l’Admin.</p>
      </div>
      <div class="toolbar-group" data-admin-courier-availability-actions></div>`;

    const actions = section.querySelector("[data-admin-courier-availability-actions]");
    if (canGoOnline) {
      const online = document.createElement("button");
      online.type = "button";
      online.className = "btn btn-outline-blue btn-sm";
      online.textContent = "Mettre en ligne";
      online.addEventListener("click", () => changeAvailability(courier, "available", online));
      actions.appendChild(online);
    }
    if (canGoOffline) {
      const offline = document.createElement("button");
      offline.type = "button";
      offline.className = "btn btn-outline-red btn-sm";
      offline.textContent = "Mettre hors ligne";
      offline.addEventListener("click", () => changeAvailability(courier, "offline", offline));
      actions.appendChild(offline);
    }
    if (!canGoOnline && !canGoOffline) {
      const note = document.createElement("span");
      note.className = "muted";
      note.textContent = operational === "active" ? "Déjà hors ligne." : "Le profil doit être Actif avant de pouvoir être mis en ligne.";
      actions.appendChild(note);
    }
    detail.appendChild(section);
    refreshIcons();
  } catch (err) {
    console.warn("[VinHT] Admin courier availability ownership:", err?.message || err);
  } finally {
    const i = loading.indexOf(id);
    if (i >= 0) loading.splice(i, 1);
  }
}

function scan() {
  if (!isControlCenterSurface()) return;
  document.querySelectorAll(".cc-detail[data-courier-detail]").forEach((detail) => enhanceDetail(detail));
}

function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    scan();
  });
}

export function initAdminCourierAvailabilityOwnership() {
  if (!isControlCenterSurface()) return;
  scheduleScan();
  if (observer) return;
  const root = document.querySelector("#adminControlCenterHost") || document.documentElement;
  observer = new MutationObserver(scheduleScan);
  observer.observe(root, { childList: true, subtree: true });
}
