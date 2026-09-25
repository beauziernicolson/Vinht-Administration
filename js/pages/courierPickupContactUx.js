import { getSupabase } from "../services/supabase.js";

const bodyHost = document.querySelector("#cpBodyHost");
let activeTaskId = null;
let requestSeq = 0;
let retryTimer = null;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[m]));

function phoneDigits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 8) d = `509${d}`;
  return d;
}

function telHref(raw) {
  const d = phoneDigits(raw);
  return d ? `+${d}` : "";
}

async function getContact(taskId) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase non configuré");
  const { data, error } = await sb.rpc("get_my_delivery_pickup_contact_v1", {
    p_delivery_task_id: taskId,
  });
  if (error) throw error;
  return data || {};
}

function contactHtml(contact) {
  const phone = String(contact?.phone || "").trim();
  const whatsapp = String(contact?.whatsapp_phone || phone).trim();
  const call = telHref(phone);
  const wa = phoneDigits(whatsapp);

  if (!contact?.available || !phone) {
    return `<div id="cpPickupSellerContact" class="settings-section" style="flex-direction:column;align-items:stretch;gap:8px">
      <div><strong>Contacter le vendeur</strong><p>Le vendeur n’a pas encore ajouté de numéro de contact pour cette mission. VinHT actualisera cette information automatiquement.</p></div>
      <button class="btn btn-ghost btn-sm" type="button" id="cpRefreshSellerContact">Actualiser le contact</button>
    </div>`;
  }

  return `<div id="cpPickupSellerContact" class="settings-section" style="flex-direction:column;align-items:stretch;gap:9px">
    <div><strong>Contacter le vendeur</strong><p>${esc(contact.shop_name || "Vendeur VinHT")} · ${esc(phone)}</p><p class="muted" style="font-size:11px">Utilisez ces boutons si vous devez confirmer le point de retrait ou prévenir le vendeur de votre arrivée.</p></div>
    <div class="toolbar-group">
      ${call ? `<a class="btn btn-outline-blue btn-sm" href="tel:${esc(call)}"><i data-lucide="phone"></i> Appeler le vendeur</a>` : ""}
      ${wa ? `<a class="btn btn-blue btn-sm" target="_blank" rel="noopener noreferrer" href="https://wa.me/${esc(wa)}"><i data-lucide="message-circle"></i> Écrire sur WhatsApp</a>` : ""}
    </div>
  </div>`;
}

async function renderContact() {
  if (!bodyHost || !activeTaskId || !document.querySelector("#cpDetailActionsHost")) return;
  const seq = ++requestSeq;
  try {
    const contact = await getContact(activeTaskId);
    if (seq !== requestSeq || !document.querySelector("#cpDetailActionsHost")) return;
    document.querySelector("#cpPickupSellerContact")?.remove();
    const actions = document.querySelector("#cpDetailActionsHost");
    actions?.insertAdjacentHTML("beforebegin", contactHtml(contact));
    renderedTaskId = activeTaskId;
    window.lucide?.createIcons?.();
    document.querySelector("#cpRefreshSellerContact")?.addEventListener("click", renderContact);

    if (!contact?.available) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (document.querySelector("#cpDetailActionsHost") && activeTaskId) renderContact();
      }, 10000);
    }
  } catch (err) {
    console.warn("courier seller contact unavailable", err);
  }
}

// renderContact() modifie lui-même le DOM observé : sans cette garde, chaque
// insertion du panneau relançait detectDetail -> renderContact -> nouvel appel
// RPC, en boucle tant que le détail restait ouvert.
let renderedTaskId = null;

function detectDetail() {
  if (document.querySelector("#cpDetailActionsHost") && activeTaskId) {
    if (renderedTaskId === activeTaskId && document.querySelector("#cpPickupSellerContact")) return;
    setTimeout(renderContact, 80);
  } else if (!document.querySelector("#cpDetailActionsHost")) {
    document.querySelector("#cpPickupSellerContact")?.remove();
    renderedTaskId = null;
  }
}

function init() {
  if (!bodyHost) return;

  bodyHost.addEventListener("click", (event) => {
    const taskCard = event.target.closest?.("[data-task-id]");
    if (taskCard?.dataset.taskId) {
      activeTaskId = taskCard.dataset.taskId;
      setTimeout(detectDetail, 120);
    }
  }, true);

  const observer = new MutationObserver(detectDetail);
  observer.observe(bodyHost, { childList: true, subtree: true });
}

window.addEventListener("load", () => setTimeout(init, 220));
