// Dashboard financier marchand (Feature #8 — FRONTEND VinHT uniquement).
//
// Synthèse financière : KPI -> détail des frais -> payouts -> historique -> export.
// Toutes les valeurs viennent des RPC backend (get_my_financial_dashboard_v1,
// list_my_financial_activity_v1, export_my_financial_activity_csv_v1). Aucun
// montant n'est calculé ici ; aucun "solde VinHT" n'est inventé.
//
// Les analyses avancées (top produits, conversion, tendances, comparaison de
// période, taux de remboursement analytique…) appartiennent à Feature #9.

import { getSession, onAuthChange } from "../services/auth.js";
import { openAuthModal } from "../ui/authModal.js";
import { refreshIcons } from "../lib/icons.js";
import { showToast } from "../ui/toast.js";
import {
  FINANCE_PERIOD_PRESETS,
  presetRange,
  customRange,
  getFinancialDashboard,
  listFinancialActivity,
  exportFinancialActivityCsv,
  financeErrorMessageFr,
} from "../services/merchantFinance.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const money = (v) =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(v) || 0)} HTG`;
const intFmt = (v) => new Intl.NumberFormat("fr-FR").format(Number(v) || 0);

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const HOST_SEL = "#merchantFinanceHost";
const GATE_SEL = "[data-finance-gate]";
const CONTENT_SEL = "[data-finance-content]";

// Statuts de ligne d'activité (ne rien inventer : ce sont les statuts de
// paiement de commande / de facture d'abonnement renvoyés tels quels).
const STATUS_FR = {
  paid: ["Payé", "green"],
  pending: ["En attente", "amber"],
  refunded: ["Remboursé", "red"],
  failed: ["Échoué", "red"],
  due: ["À payer", "amber"],
  past_due: ["En retard", "red"],
  void: ["Annulée", ""],
  waived: ["Offerte", ""],
};
const PAYOUT_FR = {
  paid: ["Envoyé", "green"],
  pending: ["En attente", "amber"],
  processing: ["En cours", "amber"],
  failed: ["Échec", "red"],
  cancelled: ["Annulé", ""],
};
function badge(map, key) {
  const [label, tone] = map[key] || [key || "—", ""];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

let PAGE_SIZE = 50;
let state = {
  presetKey: "30",
  from: null,
  to: null,
  customFrom: "",
  customTo: "",
  offset: 0,
  dashboard: null,
  activity: null,
  loading: false,
};

function el(sel) {
  return document.querySelector(sel);
}
function gateHtml(html) {
  const g = el(GATE_SEL);
  const c = el(CONTENT_SEL);
  if (g) {
    g.hidden = false;
    g.innerHTML = html;
  }
  if (c) c.hidden = true;
  refreshIcons();
}
function showContent() {
  const g = el(GATE_SEL);
  const c = el(CONTENT_SEL);
  if (g) g.hidden = true;
  if (c) c.hidden = false;
}
function fillIdentity(m) {
  const name = (m && m.shop_name) || "Ma boutique";
  document.querySelectorAll("[data-merchant-name]").forEach((x) => (x.textContent = name));
  document.querySelectorAll("[data-merchant-type]").forEach((x) => (x.textContent = "Marchand VinHT"));
  document
    .querySelectorAll("[data-merchant-initial]")
    .forEach((x) => (x.textContent = String(name).charAt(0).toUpperCase() || "V"));
}

function resolveRange() {
  if (state.presetKey === "custom") {
    if (!state.customFrom || !state.customTo) return null;
    return customRange(state.customFrom, state.customTo);
  }
  const preset = FINANCE_PERIOD_PRESETS.find((p) => p.key === state.presetKey);
  return presetRange(preset ? preset.days : 30);
}

// --- Rendu --------------------------------------------------------------
function periodBarHtml() {
  const btns = FINANCE_PERIOD_PRESETS.map(
    (p) =>
      `<button type="button" class="btn ${
        state.presetKey === p.key ? "btn-blue" : "btn-outline-blue"
      } btn-sm" data-fin-preset="${p.key}">${esc(p.label)}</button>`
  ).join("");
  const custom =
    state.presetKey === "custom"
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
          <label class="field" style="margin:0"><span>Du</span><input type="date" data-fin-from value="${esc(
            state.customFrom
          )}"></label>
          <label class="field" style="margin:0"><span>Au</span><input type="date" data-fin-to value="${esc(
            state.customTo
          )}"></label>
          <button type="button" class="btn btn-blue btn-sm" data-fin-apply>Appliquer</button>
        </div>`
      : "";
  return `
    <div class="portal-card" id="finPeriodCard">
      <div class="toolbar" style="align-items:flex-start">
        <div>
          <h2 style="margin:0">Période</h2>
          <p class="muted" style="margin:4px 0 0" id="finPeriodLabel">—</p>
        </div>
        <button type="button" class="btn btn-outline-blue btn-sm" data-fin-export>
          <i data-lucide="download"></i> Exporter en CSV
        </button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${btns}</div>
      ${custom}
      <div id="finPeriodMsg" style="display:none;font-size:12px;margin-top:8px"></div>
      <div id="finExportMsg" style="display:none;font-size:12px;margin-top:8px"></div>
    </div>`;
}

function kpiHtml(sum) {
  const cards = [
    ["Ventes brutes payées", money(sum.gross_sales_htg), "blue-stat", `${intFmt(sum.paid_orders_count)} commande(s) payée(s)`],
    ["Net marchand", money(sum.merchant_net_htg), "green-stat", "Après commission et frais VinHT"],
    ["Unités vendues", intFmt(sum.units_sold), "", "Sur commandes payées"],
    ["Commission VinHT 5 %", money(sum.commission_5pct_htg), "red-stat", "Sur ventes payées"],
    ["Frais par unité", money(sum.per_item_fees_htg), "amber-stat", "Facturés à l'unité"],
    ["Total frais VinHT sur ventes", money(sum.vinht_sales_fees_htg), "", "Commission + frais par unité"],
    ["Rabais FlexiCash 2 %", money(sum.flexicash_discount_htg), "amber-stat", "Financé par la commission VinHT"],
    ["Revenu net VinHT / GES", money(sum.vinht_net_sales_revenue_htg), "blue-stat", "Commission + frais − rabais FlexiCash"],
    ["Payouts FlexiCash envoyés", money(sum.payout_sent_flexicash_htg), "green-stat", "Réellement transférés"],
    ["Payouts en attente", money(sum.payout_pending_htg), "amber-stat", "Sur ventes payées, pas encore versés"],
    ["Ventes remboursées", money(sum.refunded_sales_htg), "red-stat", `${intFmt(sum.refunds_count)} remboursement(s)`],
    ["Abonnement Pro payé", money(sum.professional_subscription_paid_htg), "", `${intFmt(sum.professional_subscription_paid_invoices)} facture(s)`],
    ["Abonnement Pro dû", money(sum.professional_subscription_due_htg), "amber-stat", `${intFmt(sum.professional_subscription_due_invoices)} facture(s)`],
  ];
  return `
    <div class="portal-card">
      <div class="section-head"><div><h2>Indicateurs clés</h2><small>Synthèse financière de la période. HTG.</small></div></div>
      <div class="stat-grid" style="margin-top:14px">
        ${cards
          .map(
            ([label, value, cls, delta]) => `
          <div class="stat-card ${cls}">
            <div class="label">${esc(label)}</div>
            <div class="value" style="font-size:19px">${esc(value)}</div>
            <div class="delta">${esc(delta)}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function feeBreakdownHtml(d) {
  const sum = d.summary;
  const fb = d.fee_breakdown || {};
  const isPro = String(d.merchant && d.merchant.plan_code) === "professional";
  const showSub =
    isPro ||
    Number(sum.professional_subscription_paid_htg) > 0 ||
    Number(sum.professional_subscription_due_htg) > 0;

  const rows = [
    [fb.commission_label || "Commission VinHT 5 %", money(sum.commission_5pct_htg), "Prélevée sur chaque vente payée"],
    [fb.per_item_label || "Frais par unité", money(sum.per_item_fees_htg), "Montant fixe par unité vendue — affiché séparément de la commission"],
    ["Total frais bruts VinHT sur ventes", money(sum.vinht_sales_fees_htg), "Commission 5 % + frais par unité"],
    [fb.flexicash_discount_label || "Rabais FlexiCash 2 %", `− ${money(sum.flexicash_discount_htg)}`, "Financé par la commission VinHT"],
    [fb.vinht_net_sales_revenue_label || "Revenu net VinHT / GES", money(sum.vinht_net_sales_revenue_htg), "Commission + frais − rabais FlexiCash"],
  ];
  const subRows = showSub
    ? [
        [
          fb.subscription_label || "Abonnement Professionnel",
          `${money(sum.professional_subscription_paid_htg)} payé · ${money(sum.professional_subscription_due_htg)} dû`,
          "Charge distincte — jamais incluse dans la commission de vente",
        ],
        ["Total charges VinHT payées (période)", money(sum.total_vinht_charges_paid_htg), "Commission + frais par unité + abonnement payé"],
      ]
    : [];

  return `
    <div class="portal-card">
      <div class="section-head"><div><h2>Détail des frais VinHT</h2>
        <small>La commission 5 % et les frais par unité sont toujours affichés séparément.</small></div></div>
      <div style="margin-top:10px">
        ${[...rows, ...subRows]
          .map(
            ([label, value, note]) => `
          <div class="settings-section">
            <div><strong>${esc(label)}</strong><p class="muted" style="margin:2px 0 0;font-size:12px">${esc(note)}</p></div>
            <strong>${esc(value)}</strong>
          </div>`
          )
          .join("")}
      </div>
      <p class="muted" style="font-size:11px;margin:10px 0 0">Sur un paiement FlexiCash, le client bénéficie d’un rabais de 2 % financé par VinHT à l’intérieur de sa commission. Le revenu net VinHT / GES peut donc être inférieur aux frais bruts affichés.</p>
      ${
        showSub
          ? `<p class="muted" style="font-size:11px;margin:10px 0 0">Plan ${
              isPro ? "Professionnel" : "Individuel"
            } — l'abonnement 5 000 HTG/mois est facturé à part et n'est jamais déduit d'un versement de vente.</p>`
          : ""
      }
    </div>`;
}

function payoutHtml(d) {
  const sum = d.summary;
  const p = d.payout || {};
  const refundedAfterPayout = Number(sum.refunded_after_payout_count) > 0;
  return `
    <div class="portal-card">
      <div class="section-head"><div><h2>Payouts FlexiCash</h2>
        <small>${esc(p.message_fr || "VinHT affiche les montants liés à vos ventes.")}</small></div></div>
      <div class="stat-grid" style="margin-top:12px">
        <div class="stat-card green-stat"><div class="label">Envoyés vers FlexiCash</div>
          <div class="value" style="font-size:19px">${esc(money(sum.payout_sent_flexicash_htg))}</div>
          <div class="delta">Transferts réellement effectués</div></div>
        <div class="stat-card amber-stat"><div class="label">En attente</div>
          <div class="value" style="font-size:19px">${esc(money(sum.payout_pending_htg))}</div>
          <div class="delta">Ventes payées non encore versées</div></div>
      </div>
      ${
        refundedAfterPayout
          ? `<p class="muted" style="font-size:12px;margin:12px 0 0">
              Explication : ${esc(money(sum.payout_sent_on_refunded_orders_htg))} ont déjà été envoyés vers FlexiCash
              sur ${esc(intFmt(sum.refunded_after_payout_count))} commande(s) ensuite remboursée(s).
              Ce montant reste inclus dans « Envoyés vers FlexiCash » ci-dessus.</p>`
          : ""
      }
      <p class="muted" style="font-size:11px;margin:10px 0 0">
        VinHT n'affiche pas de « solde » ni de « wallet ». Votre solde disponible réel est dans FlexiCash.</p>
    </div>`;
}

function activityRowHtml(r) {
  const isSub = r.type === "subscription";
  const typeCell = isSub
    ? `<span class="badge">Charge abonnement</span>`
    : `<span class="badge blue">Vente</span>`;
  const ref = r.reference_id ? String(r.reference_id).slice(0, 8) : "—";
  return `
    <tr>
      <td>${esc(fmtDate(r.occurred_at))}</td>
      <td>${typeCell}</td>
      <td>${esc(ref)}</td>
      <td>${badge(STATUS_FR, r.status)}</td>
      <td>${isSub ? "—" : esc(money(r.gross_htg))}</td>
      <td>${isSub ? "—" : esc(money(r.commission_htg))}</td>
      <td>${isSub ? "—" : esc(money(r.per_item_fee_htg))}</td>
      <td>${isSub ? "—" : esc(money(r.vinht_fees_htg))}</td>
      <td>${isSub ? "—" : esc(money(r.merchant_net_htg))}</td>
      <td>${isSub ? esc(money(r.subscription_expense_htg)) : "—"}</td>
      <td>${
        isSub
          ? "—"
          : badge(PAYOUT_FR, r.payout_status) +
            (r.payout_reference ? `<div class="table-secondary">Réf ${esc(r.payout_reference)}</div>` : "") +
            (r.payout_paid_at ? `<div class="table-secondary">${esc(fmtDate(r.payout_paid_at))}</div>` : "")
      }</td>
      <td>${esc(r.payment_method || "—")}</td>
      <td>${isSub ? "—" : esc(intFmt(r.units))}</td>
    </tr>`;
}

function activityHtml(act) {
  const rows = Array.isArray(act && act.rows) ? act.rows : [];
  const total = Number(act && act.total) || 0;
  const start = total ? state.offset + 1 : 0;
  const end = Math.min(state.offset + PAGE_SIZE, total);
  const body = rows.length
    ? rows.map(activityRowHtml).join("")
    : `<tr><td colspan="13" class="muted" style="text-align:center;padding:18px">Aucune activité financière sur cette période.</td></tr>`;
  return `
    <div class="portal-card">
      <div class="section-head"><div><h2>Historique financier</h2>
        <small>Ventes et charges d'abonnement, du plus récent au plus ancien.</small></div>
        <span class="muted" style="font-size:12px">${
          total ? `${intFmt(start)}–${intFmt(end)} sur ${intFmt(total)}` : "0 ligne"
        }</span>
      </div>
      <div class="table-wrap" style="overflow-x:auto;margin-top:12px">
        <table class="data-table" style="min-width:1100px">
          <thead><tr>
            <th>Date</th><th>Type</th><th>Référence</th><th>Statut</th>
            <th>Ventes brutes</th><th>Commission</th><th>Frais unité</th><th>Frais VinHT</th>
            <th>Net marchand</th><th>Abonnement</th><th>Payout</th><th>Moyen de paiement</th><th>Unités</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" data-fin-prev ${state.offset <= 0 ? "disabled" : ""}>Précédent</button>
        <button type="button" class="btn btn-ghost btn-sm" data-fin-next ${
          act && act.has_more ? "" : "disabled"
        }>Suivant</button>
      </div>
    </div>`;
}

function emptyOverviewHtml(d) {
  return `<div class="portal-card" style="text-align:center;padding:28px">
    <p style="margin:0 0 4px;font-weight:700">Aucune vente sur cette période</p>
    <p class="muted" style="margin:0;font-size:13px">${esc(
      d.message_fr || "Dès votre première vente payée, vos indicateurs financiers apparaîtront ici."
    )}</p>
  </div>`;
}

function render() {
  const host = el(HOST_SEL);
  if (!host) return;
  const d = state.dashboard;
  const act = state.activity;

  if (!d || d.state === "merchant_required") {
    host.innerHTML = `<div class="portal-card">${esc(
      (d && d.message_fr) || "Vous devez disposer d'un espace marchand pour consulter vos finances."
    )}</div>`;
    return;
  }

  const sum = d.summary || {};
  const hasActivity =
    Number(sum.paid_orders_count) > 0 ||
    Number(sum.refunds_count) > 0 ||
    Number(sum.professional_subscription_paid_htg) > 0 ||
    Number(sum.professional_subscription_due_htg) > 0;

  host.innerHTML = `
    ${periodBarHtml()}
    ${hasActivity ? "" : emptyOverviewHtml(d)}
    ${kpiHtml(sum)}
    ${feeBreakdownHtml(d)}
    ${payoutHtml(d)}
    ${act ? activityHtml(act) : `<div class="portal-card muted">Chargement de l'historique…</div>`}
  `;

  const pl = el("#finPeriodLabel");
  if (pl && d.period) pl.textContent = `${fmtDateTime(d.period.from)} → ${fmtDateTime(d.period.to)}`;

  wireEvents();
  refreshIcons();
}

function setPeriodMsg(text, tone) {
  const m = el("#finPeriodMsg");
  if (!m) return;
  m.textContent = text || "";
  m.style.color = tone === "ok" ? "var(--green,#25a844)" : "var(--red,#f31938)";
  m.style.display = text ? "" : "none";
}
function setExportMsg(text, tone) {
  const m = el("#finExportMsg");
  if (!m) return;
  m.textContent = text || "";
  m.style.color = tone === "warn" ? "var(--amber,#b26b00)" : tone === "ok" ? "var(--green,#25a844)" : "var(--red,#f31938)";
  m.style.display = text ? "" : "none";
}

function wireEvents() {
  document.querySelectorAll("[data-fin-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.finPreset;
      state.presetKey = key;
      state.offset = 0;
      if (key === "custom") {
        if (!state.customTo) {
          const now = new Date();
          const back = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          state.customFrom = ymd(back);
          state.customTo = ymd(now);
        }
        render();
        return;
      }
      reload();
    })
  );
  const fromI = el("[data-fin-from]");
  const toI = el("[data-fin-to]");
  if (fromI) fromI.addEventListener("change", () => (state.customFrom = fromI.value));
  if (toI) toI.addEventListener("change", () => (state.customTo = toI.value));
  el("[data-fin-apply]")?.addEventListener("click", () => {
    state.offset = 0;
    reload();
  });
  el("[data-fin-prev]")?.addEventListener("click", () => {
    if (state.offset <= 0) return;
    state.offset = Math.max(0, state.offset - PAGE_SIZE);
    reloadActivity();
  });
  el("[data-fin-next]")?.addEventListener("click", () => {
    if (!state.activity || !state.activity.has_more) return;
    state.offset += PAGE_SIZE;
    reloadActivity();
  });
  el("[data-fin-export]")?.addEventListener("click", runExport);
}

async function reload() {
  setPeriodMsg("");
  setExportMsg("");
  let range;
  try {
    range = resolveRange();
  } catch (err) {
    setPeriodMsg(financeErrorMessageFr(err));
    return;
  }
  if (!range) {
    setPeriodMsg("Choisissez une date de début et une date de fin.");
    return;
  }
  state.from = range.from;
  state.to = range.to;
  state.loading = true;
  try {
    const [dash, act] = await Promise.all([
      getFinancialDashboard({ from: range.from, to: range.to }),
      listFinancialActivity({ from: range.from, to: range.to, limit: PAGE_SIZE, offset: 0 }),
    ]);
    state.dashboard = dash;
    state.activity = act;
    state.offset = 0;
    render();
  } catch (err) {
    console.warn("[VinHT] finances:", err && (err.message || err));
    const host = el(HOST_SEL);
    if (host) {
      host.innerHTML = `
        ${periodBarHtml()}
        <div class="portal-card error-state">${esc(financeErrorMessageFr(err))}
          <button class="btn btn-outline-blue btn-sm" type="button" data-fin-retry style="margin-left:8px">Réessayer</button>
        </div>`;
      wireEvents();
      el("[data-fin-retry]")?.addEventListener("click", reload);
      refreshIcons();
    }
  } finally {
    state.loading = false;
  }
}

async function reloadActivity() {
  try {
    const act = await listFinancialActivity({
      from: state.from,
      to: state.to,
      limit: PAGE_SIZE,
      offset: state.offset,
    });
    state.activity = act;
    render();
  } catch (err) {
    console.warn("[VinHT] historique finances:", err && (err.message || err));
    showToast(financeErrorMessageFr(err), "red");
  }
}

async function runExport(e) {
  const btn = e.currentTarget;
  setExportMsg("");
  if (!state.from || !state.to) return;
  btn.disabled = true;
  const t0 = btn.textContent;
  btn.textContent = "Export…";
  try {
    const res = await exportFinancialActivityCsv({ from: state.from, to: state.to });
    if (!res || res.state === "merchant_required" || !res.content) {
      setExportMsg("Export indisponible pour le moment.");
      return;
    }
    // Le CSV est utilisé TEL QUEL : content / filename / mime_type du backend.
    const blob = new Blob([res.content], { type: res.mime_type || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.filename || "vinht-finances.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (res.truncated) {
      setExportMsg(
        `Export limité aux ${intFmt(res.max_rows || 5000)} lignes les plus récentes (limite backend). Réduisez la période pour un export complet.`,
        "warn"
      );
    } else {
      setExportMsg(`Export généré (${intFmt(res.row_count || 0)} ligne(s)).`, "ok");
    }
  } catch (err) {
    console.warn("[VinHT] export CSV finances:", err && (err.message || err));
    setExportMsg(financeErrorMessageFr(err, "L'export a échoué. Réessayez."));
  } finally {
    btn.disabled = false;
    btn.textContent = t0;
  }
}

// --- Boot -------------------------------------------------------------
let booted = false;
async function boot() {
  if (!el(HOST_SEL)) return; // pas la page finances
  const session = await getSession();
  if (!session || !session.user) {
    gateHtml(`<div style="text-align:center;padding:28px">
      <h3 style="margin:0 0 8px">Connexion requise</h3>
      <p class="muted" style="margin:0 0 16px;font-size:13px">Connectez-vous pour accéder à votre dashboard financier.</p>
      <button class="btn btn-blue" type="button" id="finLoginBtn">Se connecter</button></div>`);
    el("#finLoginBtn")?.addEventListener("click", () => openAuthModal("login"));
    return;
  }
  showContent();
  try {
    const probe = await getFinancialDashboard({});
    fillIdentity(probe && probe.merchant);
  } catch (e) {
    /* l'erreur sera affichée par reload() */
  }
  await reload();
}

function init() {
  if (!el(HOST_SEL)) return;
  if (!booted) {
    booted = true;
    boot();
  }
  let lastUid = null;
  onAuthChange((s) => {
    const uid = (s && s.user && s.user.id) || null;
    if (uid === lastUid) return;
    lastUid = uid;
    boot();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
